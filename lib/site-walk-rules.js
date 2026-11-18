/*
 * Site walk — the rules, with no database in them.
 *
 * Everything here takes plain objects and returns plain objects, so it can be
 * tested with `node --test` and no Postgres (platform notes §5, §7.3).
 *
 * WHAT THIS FILE DOES NOT DO, ON PURPOSE
 * The phone computes every verdict, status, correction and count, and sends
 * them as values in the sync payload ("wilson.sitewalk/2"). This module checks
 * the payload is one of ours and lifts the walk-level values into columns. It
 * never recomputes a verdict. A second implementation of the arithmetic is how
 * a builder ends up holding a packet that says one thing and a dashboard that
 * says another; there is one place a number is computed, and it is
 * site-walk-core.js in the browser.
 */

export const ACCEPTED_SCHEMAS = ["wilson.sitewalk/2"];
export const STAGE_CODES = ["setup", "ready-to-walk", "in-field", "ready-to-send", "sent"];
export const ACCESS_ROUTES = ["ground", "entry-steps", "interior-stairs", "elevator", "lift"];
export const ACCESS_STATES = ["clear", "tight", "blocked"];

/* The walk as the phone holds it is stored beside the summary so another
   device can be handed the walk. A walk larger than this is stored without
   its document rather than rejected (same cap as sitewalk_sync.py). */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/* A payload the server will never accept. The route answers 400, which tells
   the phone to stop retrying and show the message; any other failure leaves
   the walk in the phone's outbox, which is the safe default. */
export class PayloadError extends Error {
  constructor(message) { super(message); this.name = "PayloadError"; }
}

const str = (v, max) => {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return max ? s.slice(0, max) : s;
};
const int = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const isoStamp = (v) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : "";
};
const isoDate = (v) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const oneOf = (v, list, label, { nullable = true } = {}) => {
  const s = str(v);
  if (!s) {
    if (nullable) return "";
    throw new PayloadError(`${label} is required.`);
  }
  if (!list.includes(s)) throw new PayloadError(`${label} "${s}" is not one of: ${list.join(", ")}.`);
  return s;
};

/* ---------- the shared spec library (v0.9.85) ------------------------------
   One row per thing a person changed in the spec library: an entry that
   replaces the built-in for a model number ("model"), or the opening numbers
   somebody confirmed against a manufacturer sheet ("dims"). The pages hold
   the rules for what an entry means; the server only keeps rows, so a
   correction made at one desk is the library at every desk. */
export const LIBRARY_KINDS = ["model", "dims"];
export const MAX_LIBRARY_ROW_BYTES = 2 * 1024 * 1024;

/**
 * Check one library row a page sent.
 * @param {object} body  { kind, key, doc } or { kind, key, deleted: true }
 * @returns {{kind: string, key: string, doc: object|null, deleted: boolean}}
 */
export function readLibraryRow(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PayloadError("The library row is not a JSON object.");
  const kind = str(body.kind, 16);
  if (!LIBRARY_KINDS.includes(kind)) throw new PayloadError("A library row is a model or a set of confirmed dimensions.");
  const key = str(body.key, 160);
  if (!key) throw new PayloadError("A library row needs a key.");
  /* a model key is the model number with only its letters and digits; a
     dims key is that, a bar, and the install type */
  if (kind === "model" && !/^[A-Z0-9]+$/.test(key)) throw new PayloadError("A model key is the model number, letters and digits only.");
  if (kind === "dims" && !/^[A-Z0-9]+\|.+$/.test(key)) throw new PayloadError("A dimensions key is the model, a bar, and the install type.");
  const deleted = body.deleted === true;
  const doc = deleted ? null : body.doc;
  if (!deleted && (!doc || typeof doc !== "object" || Array.isArray(doc))) throw new PayloadError("A library row needs its entry.");
  if (doc && JSON.stringify(doc).length > MAX_LIBRARY_ROW_BYTES) throw new PayloadError("That library entry is over 2 MB.");
  return { kind, key, doc, deleted };
}

/** The shape the pages read a library row in. */
export function libraryRow(r) {
  return {
    kind: r.kind, key: r.lib_key, doc: r.deleted_at ? null : r.doc, deleted: !!r.deleted_at,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "", updatedBy: r.updated_by_name || r.updated_by || ""
  };
}

/**
 * Check a sync payload and lift the walk-level values out of it.
 * Returns the row to write. Throws PayloadError on anything unusable.
 *
 * @param {object} payload  what SW.syncPayload(walk) produced in the browser
 * @returns {object} row    column values for sw_walks, plus `document` and `payload`
 */
export function readSyncPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadError("The payload is not a JSON object.");
  }
  const schema = str(payload.schema);
  if (!ACCEPTED_SCHEMAS.includes(schema)) {
    throw new PayloadError(`Payload schema "${schema}" is not supported. This server accepts ${ACCEPTED_SCHEMAS.join(", ")}.`);
  }
  const walk = payload.walk;
  if (!walk || typeof walk !== "object") throw new PayloadError("The payload has no walk.");
  const walkId = str(walk.clientId, 80);
  if (!walkId) throw new PayloadError("The walk has no clientId, so it cannot be synced idempotently.");
  if (!SAFE_ID.test(walkId)) throw new PayloadError("That walk id is not one of ours.");
  if (!Array.isArray(payload.openings)) throw new PayloadError("The payload has no openings array.");

  const roll = payload.rollup && typeof payload.rollup === "object" ? payload.rollup : {};
  const access = walk.access && typeof walk.access === "object" ? walk.access : {};

  /* The document: the client's own walk object, handed back to any device that
     opens the walk. Never read for meaning on the server. */
  let document = payload.walkDocument && typeof payload.walkDocument === "object" ? payload.walkDocument : null;
  if (document && Buffer.byteLength(JSON.stringify(document)) > MAX_DOCUMENT_BYTES) document = null;

  /* The derived answers (rollup + one entry per opening), kept whole so the
     reporting tables of step two can be filled from stored rows, and so SQL can
     reach an opening today with jsonb operators. The document is not repeated
     inside it. */
  const derived = { schema, exportedAt: str(payload.exportedAt), walk, rollup: roll, openings: payload.openings };

  return {
    walk_id: walkId,
    job_no: str(walk.jobNo, 60),
    project: str(walk.project, 200),
    builder: str(walk.builder, 200),
    builder_contact: str(walk.builderContact, 150),
    builder_email: str(walk.builderEmail, 320),
    address: str(walk.address, 400),
    walk_date: isoDate(walk.walkDate),
    walked_by: str(walk.walkedBy, 150),
    sales_name: str(walk.salesName, 150),
    sales_email: str(walk.salesEmail, 320),
    stage: oneOf(walk.stageCode, STAGE_CODES, "walk.stageCode") || "setup",
    opening_count: int(roll.openings, payload.openings.length),
    walked_count: int(roll.walked),
    ready_count: int(roll.readyCount),
    verify_count: int(roll.verifyCount),
    modify_count: int(roll.modifyCount),
    decision_count: int(roll.decisionCount),
    open_count: int(roll.openCount),
    blocker_count: int(roll.blockerCount),
    is_deliverable: roll.deliverable === true,
    access_route: oneOf(access.route, ACCESS_ROUTES, "walk.access.route"),
    access_state: oneOf(access.state, ACCESS_STATES, "walk.access.state"),
    client_updated_at: isoStamp(walk.updatedAt),
    client_sent_at: isoStamp(walk.sentAt),
    device: str(payload.device, 400),
    schema,
    document,
    payload: derived
  };
}

/**
 * Newest wins, by the walk's own revision stamp.
 *
 * A phone that has been offline can post an older snapshot after a newer one
 * already landed; storing it would silently undo work. ISO-8601 stamps from
 * one clock family compare correctly as strings, which is what the phone and
 * the Python reference both do.
 *
 * @param {{client_updated_at?: string}|null} stored   the row already held, or null
 * @param {{client_updated_at?: string}} incoming      the row readSyncPayload returned
 * @returns {"CREATED"|"UPDATED"|"IGNORED_STALE"}
 */
export function decideWrite(stored, incoming) {
  if (!stored) return "CREATED";
  const a = incoming.client_updated_at || "", b = stored.client_updated_at || "";
  if (a && b && a < b) return "IGNORED_STALE";
  return "UPDATED";
}

/**
 * May this walk's packet go to the builder?
 * The one gate (Cayden, 16 Nov 2026): the person who walked the job cleans up
 * the notes and signs off; until then nothing is sent.
 *
 * @param {{signed_off_at?: any, stage?: string}} row
 * @returns {{ok: boolean, why: string}}
 */
export function canSend(row) {
  if (!row) return { ok: false, why: "That walk is not on the server." };
  if (!row.signed_off_at) return { ok: false, why: "The walk has not been signed off yet." };
  return { ok: true, why: "" };
}

/**
 * May this walk be signed off?  Every opening walked and the jobsite access
 * answered — which is what the phone calls "ready-to-send" — or already sent.
 */
export function canSignOff(row) {
  if (!row) return { ok: false, why: "That walk is not on the server." };
  if (row.stage !== "ready-to-send" && row.stage !== "sent") {
    return { ok: false, why: "The walk is not finished in the field yet (" + (row.stage || "no stage") + ")." };
  }
  return { ok: true, why: "" };
}

/* The office queue row, in the key names site-walk-office.js already reads
   (they were the SQLite column names of the standalone server). Changing them
   means editing the page; keeping them means the page is unchanged. */
export function queueRow(r) {
  return {
    ClientWalkId: r.walk_id,
    JobNo: r.job_no, ProjectName: r.project, BuilderNameSnapshot: r.builder,
    WalkDate: r.walk_date, WalkedByNameSnapshot: r.walked_by,
    StageCode: r.stage,
    OpeningCount: r.opening_count, WalkedCount: r.walked_count,
    ReadyCount: r.ready_count, ModifyCount: r.modify_count,
    DecisionCount: r.decision_count, OpenCount: r.open_count,
    IsDeliverable: r.is_deliverable ? 1 : 0,
    AccessRoute: r.access_route, AccessState: r.access_state,
    SignedOffAt: r.signed_off_at, SignedOffBy: r.signed_off_by_name,
    PacketSentAt: r.packet_sent_at, PacketSentTo: r.packet_sent_to,
    ArchivedAt: r.archived_at || null,
    LastSyncedAt: r.last_synced_at, LastSyncedBy: r.last_synced_by,
    ClientUpdatedAt: r.client_updated_at || ""
  };
}

/* What a device is offered. The list carries summaries only (`walk` is null):
   a phone's pick-up screen must not download every unsent walk whole each
   time it is refreshed. The document comes with the one walk a device opens
   (pull ?client=<id>). */
export function offerRow(r) {
  return {
    clientId: r.walk_id,
    project: r.project || "", jobNo: r.job_no || "", address: r.address || "", builder: r.builder || "",
    walkDate: r.walk_date || "",
    stageCode: r.stage || "", openings: r.opening_count || 0, walked: r.walked_count || 0,
    updatedAt: r.client_updated_at || "", syncedAt: r.last_synced_at || "",
    signedOffAt: r.signed_off_at || "", signedOffBy: r.signed_off_by_name || "",
    archivedAt: r.archived_at || "",
    walk: r.document || null
  };
}

/* ------------------------------------------------------------ notifications
   What a walk has to say to people, derived from the stored row every time it
   is asked for. Nothing is written anywhere, so the feed cannot drift from the
   walks. `key` is deterministic: whatever shows these (createPushedNotification,
   a dashboard poll) dedupes and owns read/unread on it.

   Three kinds, same keys as the standalone tool:
     WALK_READY_FOR_REVIEW  sitewalk:<walk>:ready   finished in the field, not signed off yet
     WALK_PACKET_SENT       sitewalk:<walk>:sent    receipt
     WALK_SALES_ITEM        sitewalk:<walk>:sales:<action or opening id>
                            one per correction the walker handed to the salesperson */
export const OWNER_GROUP = {
  builder: "builder", cabinet: "builder", electrician: "builder", plumber: "builder",
  trim: "builder", countertop: "builder", hvac: "builder", flooring: "builder",
  wilson: "wilson", internal: "wilson", sales: "sales"
};
const ownerGroup = (o) => OWNER_GROUP[str(o && o.owner, 20)] || "builder";

/**
 * @param {object} row  a sw_walks row (summary columns + payload)
 * @returns {Array<{key, kind, salesEmail, salesName, walkedBy, clientWalkId, project, jobNo, title, body, eventAt}>}
 */
export function walkEvents(row) {
  if (!row) return [];
  const out = new Map();
  const job = row.project || row.job_no || "a jobsite";
  const stamp = (v) => (v instanceof Date ? v.toISOString() : str(v));
  const base = {
    salesEmail: row.sales_email || "", salesName: row.sales_name || "", walkedBy: row.walked_by || "",
    clientWalkId: row.walk_id, project: row.project || "", jobNo: row.job_no || ""
  };
  if (row.stage === "ready-to-send" && !row.signed_off_at) {
    const actions = (row.modify_count || 0) + (row.decision_count || 0);
    out.set(`sitewalk:${row.walk_id}:ready`, {
      key: `sitewalk:${row.walk_id}:ready`, kind: "WALK_READY_FOR_REVIEW", ...base,
      title: "Site walk back from the field — sign off & send",
      body: `${job}: ${row.walked_count || 0} of ${row.opening_count || 0} openings walked` +
        (actions ? `, ${actions} need builder action` : "") + (row.walked_by ? `, walked by ${row.walked_by}` : "") +
        ". Clean up the notes, check the punch list and photos, then sign off.",
      eventAt: stamp(row.last_synced_at)
    });
  }
  if (row.packet_sent_at) {
    out.set(`sitewalk:${row.walk_id}:sent`, {
      key: `sitewalk:${row.walk_id}:sent`, kind: "WALK_PACKET_SENT", ...base,
      title: "Site walk packet sent",
      body: `${job}: packet sent to ${row.packet_sent_to || "the builder"}` +
        (row.signed_off_by_name ? `, signed off by ${row.signed_off_by_name}` : "") + ".",
      eventAt: stamp(row.packet_sent_at)
    });
  }
  const openings = (row.payload && Array.isArray(row.payload.openings)) ? row.payload.openings : [];
  for (const op of openings) {
    const where = [op.location, op.model].map((x) => str(x)).filter(Boolean).join(" · ");
    const items = [];
    for (const f of (op.findings || [])) if (f && typeof f === "object" && ownerGroup(f) === "sales" && str(f.detail)) items.push({ id: str(f.actionId || f.id, 40), text: str(f.detail) });
    for (const a of (op.actions || [])) if (a && typeof a === "object" && ownerGroup(a) === "sales" && str(a.text)) items.push({ id: str(a.id, 40), text: str(a.text) });
    for (const it of items) {
      const key = `sitewalk:${row.walk_id}:sales:${it.id || str(op.clientId, 60)}`;
      if (out.has(key)) continue;
      out.set(key, {
        key, kind: "WALK_SALES_ITEM", ...base,
        title: "Spec decision needed from the site walk",
        body: `${job} — ${where || "an opening"}: ${it.text}`,
        eventAt: stamp(row.last_synced_at)
      });
    }
  }
  return [...out.values()];
}
