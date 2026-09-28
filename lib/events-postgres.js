import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// EVENTS (Andrew, 2026-09-28: "an Agility user should be able to set up an
// event that posts to service.wilsonappliance.com").
//
//   events          what a person sets up on Event RSVPs: name, when, where,
//                   the story, capacity, guest types with target seats
//                   (18–20 designers / 2 SZ-Wolf reps / 2–4 Wilson sales),
//                   hero image, RSVP deadline. status: draft → published →
//                   archived; visibility: listed (on /events) or link-only.
//   event_invitees  the roster — one row per person, invited or walk-in:
//                   Planned / Pending / Confirmed / Declined / Waitlist,
//                   invited by, follow-up, notes (the RSVP tracker workbook,
//                   in a table). An online RSVP attaches to its roster row
//                   (matched by email, then name) or adds one.
//   event_rsvps     every online submission, as sent (audit + updates).
//
// Replaces data/events.json + data/event-rsvps.json (ephemeral on Render);
// migrateLegacyEvents() pulls those in once when the tables are empty.
// ---------------------------------------------------------------------------

export const INVITEE_STATUSES = ["Planned", "Pending", "Confirmed", "Declined", "Waitlist"];
export const EVENT_STATUSES = ["draft", "published", "archived"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  highlights JSONB NOT NULL DEFAULT '[]',
  starts_at TEXT NOT NULL DEFAULT '',
  ends_at TEXT NOT NULL DEFAULT '',
  doors_note TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  hero_image_url TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  max_guests INTEGER NOT NULL DEFAULT 1,
  rsvp_deadline TEXT NOT NULL DEFAULT '',
  guest_types JSONB NOT NULL DEFAULT '[]',
  ask_company BOOLEAN NOT NULL DEFAULT TRUE,
  visibility TEXT NOT NULL DEFAULT 'listed',
  status TEXT NOT NULL DEFAULT 'draft',
  public_path TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status, starts_at);
CREATE TABLE IF NOT EXISTS event_invitees (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  guest_type TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  invited_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Planned',
  date_invited TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  guest_count INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'roster',
  rsvp_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_invitees_event ON event_invitees (event_id, status);
CREATE TABLE IF NOT EXISTS event_rsvps (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invitee_id UUID,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  guest_type TEXT NOT NULL DEFAULT '',
  guest_count INTEGER NOT NULL DEFAULT 1,
  attending BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT '',
  wants_email BOOLEAN NOT NULL DEFAULT FALSE,
  wants_text BOOLEAN NOT NULL DEFAULT FALSE,
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps (event_id, updated_at DESC);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

const text = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
const phone10 = (raw) => { const d = String(raw || "").replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; };
const emailKey = (raw) => String(raw || "").trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nameKey = (n) => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
const intOr = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const isoOrEmpty = (v) => { const s = text(v, 40); return s && !Number.isNaN(Date.parse(s)) ? s : ""; };

export function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function cleanGuestTypes(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const name = text(typeof t === "string" ? t : t?.name, 60);
    if (!name || out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    const min = t?.targetMin == null || t?.targetMin === "" ? null : Math.max(0, intOr(t.targetMin, 0));
    const max = t?.targetMax == null || t?.targetMax === "" ? null : Math.max(0, intOr(t.targetMax, 0));
    out.push({ name, targetMin: min, targetMax: max, public: t?.public !== false && t?.public !== "false" });
  }
  return out;
}

function cleanHighlights(list) {
  const src = Array.isArray(list) ? list : String(list || "").split(/\r?\n/);
  return src.map((h) => text(h, 200)).filter(Boolean).slice(0, 12);
}

function mapEvent(r) {
  return {
    id: r.id, slug: r.slug, name: r.name, subtitle: r.subtitle, description: r.description, highlights: r.highlights || [],
    startsAt: r.starts_at, endsAt: r.ends_at, doorsNote: r.doors_note, location: r.location, address: r.address, heroImageUrl: r.hero_image_url,
    capacity: r.capacity, maxGuests: r.max_guests, rsvpDeadline: r.rsvp_deadline, guestTypes: r.guest_types || [], askCompany: r.ask_company,
    visibility: r.visibility, status: r.status, publicPath: r.public_path, contactName: r.contact_name, contactEmail: r.contact_email,
    createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at?.toISOString?.() || null, updatedAt: r.updated_at?.toISOString?.() || null
  };
}
const mapInvitee = (r) => ({
  id: r.id, eventId: r.event_id, name: r.name, company: r.company, guestType: r.guest_type, email: r.email, phone: r.phone, invitedBy: r.invited_by,
  status: r.status, dateInvited: r.date_invited, followUp: r.follow_up, notes: r.notes, guestCount: r.guest_count, source: r.source, rsvpId: r.rsvp_id,
  createdAt: r.created_at?.toISOString?.() || null, updatedAt: r.updated_at?.toISOString?.() || null
});
const mapRsvp = (r) => ({
  id: r.id, eventId: r.event_id, inviteeId: r.invitee_id, fullName: r.full_name, email: r.email, phone: r.phone, company: r.company, guestType: r.guest_type,
  guestCount: r.guest_count, attending: r.attending, notes: r.notes, wantsEmailUpdates: r.wants_email, wantsTextUpdates: r.wants_text,
  createdAt: r.created_at?.toISOString?.() || null, updatedAt: r.updated_at?.toISOString?.() || null
});

// ---- events ---------------------------------------------------------------
function eventFields(body, existing = null) {
  const name = text(body?.name, 120) || existing?.name || "";
  if (!name) throw new Error("Give the event a name.");
  const startsAt = isoOrEmpty(body?.startsAt ?? existing?.startsAt);
  const endsAt = isoOrEmpty(body?.endsAt ?? existing?.endsAt);
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error("The end time is before the start time.");
  const capacity = body?.capacity == null || body?.capacity === "" ? (existing && body?.capacity === undefined ? existing.capacity : null) : Math.max(0, intOr(body.capacity, 0)) || null;
  const visibility = ["listed", "link"].includes(String(body?.visibility || "")) ? String(body.visibility) : existing?.visibility || "listed";
  return {
    name, subtitle: text(body?.subtitle ?? existing?.subtitle, 160), description: text(body?.description ?? existing?.description, 6000),
    highlights: cleanHighlights(body?.highlights ?? existing?.highlights ?? []),
    startsAt, endsAt, doorsNote: text(body?.doorsNote ?? existing?.doorsNote, 160),
    location: text(body?.location ?? existing?.location, 160), address: text(body?.address ?? existing?.address, 240),
    heroImageUrl: /^https?:\/\//i.test(text(body?.heroImageUrl ?? existing?.heroImageUrl, 500)) ? text(body?.heroImageUrl ?? existing?.heroImageUrl, 500) : "",
    capacity, maxGuests: Math.min(12, Math.max(1, intOr(body?.maxGuests ?? existing?.maxGuests, 1))),
    rsvpDeadline: isoOrEmpty(body?.rsvpDeadline ?? existing?.rsvpDeadline),
    guestTypes: cleanGuestTypes(body?.guestTypes ?? existing?.guestTypes ?? []),
    askCompany: body?.askCompany == null ? (existing ? existing.askCompany : true) : Boolean(body.askCompany),
    visibility, contactName: text(body?.contactName ?? existing?.contactName, 80), contactEmail: emailKey(text(body?.contactEmail ?? existing?.contactEmail, 120))
  };
}

export async function createEvent(body, { by = "" } = {}) {
  const pool = await getReadyPool();
  const f = eventFields(body);
  let slug = slugify(body?.slug || f.name) || `event-${Date.now()}`;
  for (let i = 2; i < 50; i++) {
    const taken = await pool.query(`SELECT 1 FROM events WHERE slug = $1`, [slug]);
    if (!taken.rows[0]) break;
    slug = `${slugify(body?.slug || f.name)}-${i}`;
  }
  const id = crypto.randomUUID();
  const r = await pool.query(
    `INSERT INTO events (id, slug, name, subtitle, description, highlights, starts_at, ends_at, doors_note, location, address, hero_image_url, capacity, max_guests, rsvp_deadline, guest_types, ask_company, visibility, status, contact_name, contact_email, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,'draft',$19,$20,$21,$21) RETURNING *`,
    [id, slug, f.name, f.subtitle, f.description, JSON.stringify(f.highlights), f.startsAt, f.endsAt, f.doorsNote, f.location, f.address, f.heroImageUrl, f.capacity, f.maxGuests, f.rsvpDeadline, JSON.stringify(f.guestTypes), f.askCompany, f.visibility, f.contactName, f.contactEmail, text(by, 120)]
  );
  return mapEvent(r.rows[0]);
}

export async function updateEvent(id, body, { by = "" } = {}) {
  const pool = await getReadyPool();
  const cur = await getEvent(id);
  if (!cur) return null;
  const f = eventFields(body, cur);
  let slug = cur.slug;
  if (body?.slug != null && slugify(body.slug) && slugify(body.slug) !== cur.slug) {
    const want = slugify(body.slug);
    const taken = await pool.query(`SELECT 1 FROM events WHERE slug = $1 AND id <> $2`, [want, id]);
    if (taken.rows[0]) throw new Error(`The link "${want}" is already used by another event.`);
    slug = want;
  }
  const r = await pool.query(
    `UPDATE events SET slug=$2, name=$3, subtitle=$4, description=$5, highlights=$6::jsonb, starts_at=$7, ends_at=$8, doors_note=$9, location=$10, address=$11, hero_image_url=$12, capacity=$13, max_guests=$14, rsvp_deadline=$15, guest_types=$16::jsonb, ask_company=$17, visibility=$18, contact_name=$19, contact_email=$20, updated_by=$21, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [id, slug, f.name, f.subtitle, f.description, JSON.stringify(f.highlights), f.startsAt, f.endsAt, f.doorsNote, f.location, f.address, f.heroImageUrl, f.capacity, f.maxGuests, f.rsvpDeadline, JSON.stringify(f.guestTypes), f.askCompany, f.visibility, f.contactName, f.contactEmail, text(by, 120)]
  );
  return mapEvent(r.rows[0]);
}

export async function setEventStatus(id, status, { by = "" } = {}) {
  if (!EVENT_STATUSES.includes(status)) throw new Error("status must be draft, published, or archived.");
  const pool = await getReadyPool();
  const cur = await getEvent(id);
  if (!cur) return null;
  if (status === "published" && !cur.startsAt) throw new Error("Set the event date before publishing.");
  const r = await pool.query(`UPDATE events SET status=$2, updated_by=$3, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, status, text(by, 120)]);
  return mapEvent(r.rows[0]);
}

export async function deleteEvent(id) {
  const pool = await getReadyPool();
  return (await pool.query(`DELETE FROM events WHERE id = $1`, [id])).rowCount > 0;
}

export async function getEvent(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM events WHERE id = $1`, [id]);
  return r.rows[0] ? mapEvent(r.rows[0]) : null;
}

export async function getEventBySlug(slug) {
  const s = slugify(slug);
  if (!s) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM events WHERE slug = $1`, [s]);
  return r.rows[0] ? mapEvent(r.rows[0]) : null;
}

// Roster arithmetic shared by the admin page and the public page.
export function summarizeRoster(event, invitees) {
  const seats = (i) => Math.max(1, Number(i.guestCount) || 1);
  const by = (st) => invitees.filter((i) => i.status === st);
  const confirmedSeats = by("Confirmed").reduce((a, i) => a + seats(i), 0);
  const pendingSeats = by("Pending").reduce((a, i) => a + seats(i), 0);
  const types = (event.guestTypes || []).map((t) => ({
    name: t.name, targetMin: t.targetMin, targetMax: t.targetMax, public: t.public !== false,
    confirmed: invitees.filter((i) => i.status === "Confirmed" && i.guestType === t.name).reduce((a, i) => a + seats(i), 0),
    pending: invitees.filter((i) => i.status === "Pending" && i.guestType === t.name).reduce((a, i) => a + seats(i), 0)
  }));
  const untyped = invitees.filter((i) => i.status === "Confirmed" && !(event.guestTypes || []).some((t) => t.name === i.guestType)).reduce((a, i) => a + seats(i), 0);
  return {
    capacity: event.capacity, confirmed: confirmedSeats, pending: pendingSeats, planned: by("Planned").length, declined: by("Declined").length, waitlist: by("Waitlist").length,
    remaining: event.capacity == null ? null : Math.max(0, event.capacity - confirmedSeats),
    full: event.capacity != null && confirmedSeats >= event.capacity,
    tracked: invitees.length, types, untypedConfirmed: untyped
  };
}

export async function listEvents({ status = "all" } = {}) {
  const pool = await getReadyPool();
  const where = status === "all" ? "" : `WHERE status = $1`;
  const r = await pool.query(`SELECT * FROM events ${where} ORDER BY starts_at DESC NULLS LAST, created_at DESC`, status === "all" ? [] : [status]);
  const events = r.rows.map(mapEvent);
  if (!events.length) return [];
  const inv = await pool.query(`SELECT * FROM event_invitees WHERE event_id = ANY($1::uuid[])`, [events.map((e) => e.id)]);
  const rsvpCounts = await pool.query(`SELECT event_id, COUNT(*)::int AS n, MAX(updated_at) AS last FROM event_rsvps WHERE event_id = ANY($1::uuid[]) GROUP BY 1`, [events.map((e) => e.id)]);
  const rc = new Map(rsvpCounts.rows.map((x) => [x.event_id, x]));
  return events.map((e) => ({
    ...e,
    summary: summarizeRoster(e, inv.rows.filter((x) => x.event_id === e.id).map(mapInvitee)),
    rsvpCount: rc.get(e.id)?.n || 0, lastRsvpAt: rc.get(e.id)?.last?.toISOString?.() || null
  }));
}

// ---- roster ---------------------------------------------------------------
export async function listInvitees(eventId) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM event_invitees WHERE event_id = $1 ORDER BY CASE status WHEN 'Confirmed' THEN 0 WHEN 'Pending' THEN 1 WHEN 'Waitlist' THEN 2 WHEN 'Planned' THEN 3 ELSE 4 END, lower(name)`, [eventId]);
  return r.rows.map(mapInvitee);
}

function cleanInvitee(row, event) {
  const status = INVITEE_STATUSES.find((s) => s.toLowerCase() === String(row?.status || "").trim().toLowerCase()) || "Planned";
  const gt = text(row?.guestType, 60);
  const known = (event?.guestTypes || []).find((t) => t.name.toLowerCase() === gt.toLowerCase());
  return {
    name: text(row?.name, 120), company: text(row?.company, 120), guestType: known ? known.name : gt,
    email: emailKey(text(row?.email, 120)), phone: phone10(row?.phone), invitedBy: text(row?.invitedBy, 60).toUpperCase(),
    status, dateInvited: text(row?.dateInvited, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? text(row.dateInvited, 10) : "", followUp: text(row?.followUp, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? text(row.followUp, 10) : "",
    notes: text(row?.notes, 1000), guestCount: Math.min(12, Math.max(1, intOr(row?.guestCount, 1)))
  };
}

// Bulk add (paste / import). Existing names on the roster are updated
// rather than duplicated (matched by email, else by name).
export async function addInvitees(eventId, rows, { by = "" } = {}) {
  const pool = await getReadyPool();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found.");
  const existing = await listInvitees(eventId);
  let added = 0, updated = 0;
  for (const raw of Array.isArray(rows) ? rows.slice(0, 500) : []) {
    const c = cleanInvitee(raw, event);
    if (!c.name) continue;
    const match = existing.find((i) => (c.email && i.email === c.email) || nameKey(i.name) === nameKey(c.name));
    if (match) {
      await pool.query(
        `UPDATE event_invitees SET company = CASE WHEN $2 <> '' THEN $2 ELSE company END, guest_type = CASE WHEN $3 <> '' THEN $3 ELSE guest_type END,
           email = CASE WHEN $4 <> '' THEN $4 ELSE email END, phone = CASE WHEN $5 <> '' THEN $5 ELSE phone END, invited_by = CASE WHEN $6 <> '' THEN $6 ELSE invited_by END,
           status = CASE WHEN $7 <> 'Planned' OR status = 'Planned' THEN $7 ELSE status END, date_invited = CASE WHEN $8 <> '' THEN $8 ELSE date_invited END,
           follow_up = CASE WHEN $9 <> '' THEN $9 ELSE follow_up END, notes = CASE WHEN $10 <> '' THEN $10 ELSE notes END, updated_at = NOW()
         WHERE id = $1`,
        [match.id, c.company, c.guestType, c.email, c.phone, c.invitedBy, c.status, c.dateInvited, c.followUp, c.notes]
      );
      updated++;
    } else {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO event_invitees (id, event_id, name, company, guest_type, email, phone, invited_by, status, date_invited, follow_up, notes, guest_count, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'roster')`,
        [id, eventId, c.name, c.company, c.guestType, c.email, c.phone, c.invitedBy || text(by, 60).toUpperCase(), c.status, c.dateInvited, c.followUp, c.notes, c.guestCount]
      );
      existing.push({ id, ...c });
      added++;
    }
  }
  return { added, updated };
}

export async function updateInvitee(eventId, inviteeId, patch) {
  const pool = await getReadyPool();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found.");
  const cur = (await pool.query(`SELECT * FROM event_invitees WHERE id = $1 AND event_id = $2`, [inviteeId, eventId])).rows[0];
  if (!cur) throw new Error("Invitee not found.");
  const merged = cleanInvitee({ ...mapInvitee(cur), ...patch }, event);
  if (!merged.name) throw new Error("Name is required.");
  const r = await pool.query(
    `UPDATE event_invitees SET name=$3, company=$4, guest_type=$5, email=$6, phone=$7, invited_by=$8, status=$9, date_invited=$10, follow_up=$11, notes=$12, guest_count=$13, updated_at=NOW()
      WHERE id=$1 AND event_id=$2 RETURNING *`,
    [inviteeId, eventId, merged.name, merged.company, merged.guestType, merged.email, merged.phone, merged.invitedBy, merged.status, merged.dateInvited, merged.followUp, merged.notes, merged.guestCount]
  );
  return mapInvitee(r.rows[0]);
}

export async function deleteInvitee(eventId, inviteeId) {
  const pool = await getReadyPool();
  return (await pool.query(`DELETE FROM event_invitees WHERE id = $1 AND event_id = $2`, [inviteeId, eventId])).rowCount > 0;
}

// The RSVP tracker workbook (Invitee / Design Firm / Guest Type / Invited By /
// Status / Date Invited / Follow-Up / Notes) or any sheet with a name column.
export function inviteesFromGrid(grid) {
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  let headerRow = -1, cols = {};
  const want = { name: ["invitee", "name", "guest", "attendee"], company: ["design firm / company", "company", "firm", "design firm", "organization"], guestType: ["guest type", "type", "category"],
    invitedBy: ["invited by", "invited", "owner"], status: ["status", "rsvp status", "rsvp"], dateInvited: ["date invited", "invited on", "date"], followUp: ["follow-up", "follow up", "followup"], notes: ["notes", "note", "comments"], email: ["email", "e-mail"], phone: ["phone", "mobile", "cell"] };
  for (let r = 0; r < Math.min(grid.length, 30) && headerRow < 0; r++) {
    const cells = (grid[r] || []).map(norm);
    const found = {};
    for (const [key, names] of Object.entries(want)) { const idx = cells.findIndex((c) => names.includes(c)); if (idx >= 0) found[key] = idx; }
    if (found.name != null && Object.keys(found).length >= 2) { headerRow = r; cols = found; }
  }
  if (headerRow < 0) throw new Error("Couldn't find the header row (looked for an 'Invitee' or 'Name' column).");
  const dateOf = (v) => {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    const s = String(v ?? "").trim(); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  };
  const rows = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const g = grid[r] || [];
    const at = (k) => (cols[k] == null ? "" : g[cols[k]]);
    const name = String(at("name") ?? "").trim();
    if (!name || /^tip:/i.test(name)) continue;
    rows.push({ name, company: at("company"), guestType: at("guestType"), invitedBy: at("invitedBy"), status: at("status"), dateInvited: dateOf(at("dateInvited")), followUp: dateOf(at("followUp")), notes: at("notes"), email: at("email"), phone: at("phone") });
  }
  return rows;
}

// ---- online RSVP ----------------------------------------------------------
export function publicEventView(event, invitees) {
  const s = summarizeRoster(event, invitees);
  const now = Date.now();
  const deadlinePassed = event.rsvpDeadline && Date.parse(event.rsvpDeadline) < now;
  const over = event.endsAt ? Date.parse(event.endsAt) < now : event.startsAt ? Date.parse(event.startsAt) + 6 * 3600000 < now : false;
  return {
    slug: event.slug, name: event.name, subtitle: event.subtitle, description: event.description, highlights: event.highlights,
    startsAt: event.startsAt, endsAt: event.endsAt, doorsNote: event.doorsNote, location: event.location, address: event.address, heroImageUrl: event.heroImageUrl,
    maxGuests: event.maxGuests, askCompany: event.askCompany, contactName: event.contactName, contactEmail: event.contactEmail,
    guestTypes: (event.guestTypes || []).filter((t) => t.public !== false).map((t) => t.name),
    capacity: event.capacity, spotsRemaining: s.remaining, full: s.full,
    rsvpOpen: event.status === "published" && !deadlinePassed && !over, deadlinePassed: Boolean(deadlinePassed), over
  };
}

export async function listPublicEvents() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM events WHERE status = 'published' AND visibility = 'listed' ORDER BY starts_at ASC NULLS LAST`);
  const events = r.rows.map(mapEvent);
  const out = [];
  for (const e of events) {
    const inv = (await pool.query(`SELECT * FROM event_invitees WHERE event_id = $1`, [e.id])).rows.map(mapInvitee);
    const v = publicEventView(e, inv);
    if (!v.over) out.push(v);
  }
  return out;
}

export async function getPublicEvent(slug) {
  const event = await getEventBySlug(slug);
  if (!event || event.status === "draft") return null;
  const invitees = await listInvitees(event.id);
  return publicEventView(event, invitees);
}

export async function submitRsvp(slug, body, { ip = "" } = {}) {
  const pool = await getReadyPool();
  const event = await getEventBySlug(slug);
  if (!event || event.status !== "published") throw new Error("This event isn't taking RSVPs right now.");
  const invitees = await listInvitees(event.id);
  const view = publicEventView(event, invitees);
  const fullName = text(body?.fullName, 120);
  const email = emailKey(text(body?.email, 120));
  const phone = phone10(body?.phone);
  const attending = body?.attending !== false && String(body?.attending || "yes") !== "no";
  const wantsEmail = Boolean(body?.wantsEmailUpdates), wantsText = Boolean(body?.wantsTextUpdates);
  if (!fullName) throw new Error("Please tell us your name.");
  if (!email && !phone) throw new Error("Please share an email address or phone number so we can confirm your spot.");
  if (email && !isEmail(email)) throw new Error("That email address doesn't look right.");
  if (phone && phone.length !== 10) throw new Error("Please enter a 10-digit phone number.");
  if (wantsText && !phone) throw new Error("A phone number is needed for text updates.");
  if (!view.rsvpOpen && attending) throw new Error(view.deadlinePassed ? "The RSVP deadline for this event has passed — call the store and we'll do our best." : "This event isn't taking RSVPs right now.");
  const guestCount = attending ? Math.min(event.maxGuests, Math.max(1, intOr(body?.guestCount, 1))) : 0;
  const gtRaw = text(body?.guestType, 60);
  const guestType = view.guestTypes.find((t) => t.toLowerCase() === gtRaw.toLowerCase()) || "";
  if (attending && view.guestTypes.length && !guestType) throw new Error("Please tell us which best describes you.");
  const company = text(body?.company, 120);
  const notes = text(body?.notes, 1000);

  // Roster row: by email, then by name; else a walk-in row.
  let row = invitees.find((i) => email && i.email === email) || invitees.find((i) => nameKey(i.name) === nameKey(fullName)) || null;
  // Seats: a full event puts a new "yes" on the waitlist instead of a seat.
  let status = attending ? "Confirmed" : "Declined";
  if (attending && event.capacity != null) {
    const seatsWithoutMe = view.confirmed - (row && row.status === "Confirmed" ? Math.max(1, row.guestCount || 1) : 0);
    if (seatsWithoutMe + guestCount > event.capacity) status = "Waitlist";
  }
  const rsvpId = crypto.randomUUID();
  const existingRsvp = row?.rsvpId ? (await pool.query(`SELECT id FROM event_rsvps WHERE id = $1`, [row.rsvpId])).rows[0] : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (existingRsvp) {
      await client.query(
        `UPDATE event_rsvps SET full_name=$2, email=$3, phone=$4, company=$5, guest_type=$6, guest_count=$7, attending=$8, notes=$9, wants_email=$10, wants_text=$11, ip=$12, updated_at=NOW() WHERE id=$1`,
        [existingRsvp.id, fullName, email, phone, company, guestType, Math.max(1, guestCount), attending, notes, wantsEmail, wantsText, text(ip, 60)]
      );
    } else {
      await client.query(
        `INSERT INTO event_rsvps (id, event_id, invitee_id, full_name, email, phone, company, guest_type, guest_count, attending, notes, wants_email, wants_text, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [rsvpId, event.id, row?.id || null, fullName, email, phone, company, guestType, Math.max(1, guestCount), attending, notes, wantsEmail, wantsText, text(ip, 60)]
      );
    }
    const rid = existingRsvp ? existingRsvp.id : rsvpId;
    if (row) {
      await client.query(
        `UPDATE event_invitees SET email = CASE WHEN $2 <> '' THEN $2 ELSE email END, phone = CASE WHEN $3 <> '' THEN $3 ELSE phone END,
           company = CASE WHEN $4 <> '' THEN $4 ELSE company END, guest_type = CASE WHEN $5 <> '' THEN $5 ELSE guest_type END,
           status = $6, guest_count = $7, notes = CASE WHEN $8 <> '' THEN left(notes || CASE WHEN notes = '' THEN '' ELSE E'\\n' END || 'RSVP: ' || $8, 1000) ELSE notes END,
           rsvp_id = $9, updated_at = NOW() WHERE id = $1`,
        [row.id, email, phone, company, guestType, status, Math.max(1, guestCount), notes, rid]
      );
    } else {
      row = { id: crypto.randomUUID() };
      await client.query(
        `INSERT INTO event_invitees (id, event_id, name, company, guest_type, email, phone, invited_by, status, date_invited, notes, guest_count, source, rsvp_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8,'',$9,$10,'online',$11)`,
        [row.id, event.id, fullName, company, guestType, email, phone, status, notes ? "RSVP: " + notes : "", Math.max(1, guestCount), rid]
      );
      await client.query(`UPDATE event_rsvps SET invitee_id = $2 WHERE id = $1`, [rid, row.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const first = fullName.split(/\s+/)[0];
  const message = !attending ? `Thanks for letting us know, ${first} — we'll miss you this time.`
    : status === "Waitlist" ? `${first}, the event is full right now — you're on the waitlist and we'll reach out if a spot opens.`
    : existingRsvp ? `Your RSVP is updated, ${first}. See you at ${event.name}!`
    : `You're in, ${first}! We'll see you at ${event.name}.`;
  return { ok: true, status, updated: Boolean(existingRsvp), message };
}

export async function listRsvps(eventId) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM event_rsvps WHERE event_id = $1 ORDER BY updated_at DESC`, [eventId]);
  return r.rows.map(mapRsvp);
}

// ---- one-time import of data/events.json + data/event-rsvps.json ---------
export async function migrateLegacyEvents(legacyEvents, legacyRsvps) {
  const pool = await getReadyPool();
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM events`)).rows[0].n;
  if (n > 0) return { skipped: "events already in Postgres" };
  let events = 0, rsvps = 0;
  for (const e of legacyEvents || []) {
    const slug = slugify(e.slug); if (!slug) continue;
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO events (id, slug, name, subtitle, starts_at, ends_at, location, public_path, status, visibility, guest_types, max_guests, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'link',$10::jsonb,12,'migration') ON CONFLICT (slug) DO NOTHING`,
      [id, slug, text(e.name, 120) || "Untitled Event", text(e.subtitle, 160), isoOrEmpty(e.startsAt), isoOrEmpty(e.endsAt), text(e.location, 160), text(e.publicPath, 120),
        e.status === "archived" ? "archived" : "published", JSON.stringify(["Homeowner", "Builder", "Designer", "Outdoor Cooking Fan", "Other"].map((name) => ({ name, targetMin: null, targetMax: null, public: true })))]
    );
    events++;
    for (const r of (legacyRsvps || []).filter((x) => slugify(x.eventSlug) === slug)) {
      const rid = crypto.randomUUID(), iid = crypto.randomUUID();
      const guestCount = Math.max(1, intOr(r.guestCount, 1));
      await pool.query(
        `INSERT INTO event_rsvps (id, event_id, invitee_id, full_name, email, phone, guest_type, guest_count, attending, wants_email, wants_text, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11,$12)`,
        [rid, id, iid, text(r.fullName, 120), emailKey(r.email), phone10(r.phone), text(r.attendeeType, 60), guestCount, Boolean(r.wantsEmailUpdates), Boolean(r.wantsTextUpdates), r.createdAt || new Date().toISOString(), r.updatedAt || r.createdAt || new Date().toISOString()]
      );
      await pool.query(
        `INSERT INTO event_invitees (id, event_id, name, guest_type, email, phone, status, guest_count, source, rsvp_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'Confirmed',$7,'online',$8,$9)`,
        [iid, id, text(r.fullName, 120), text(r.attendeeType, 60), emailKey(r.email), phone10(r.phone), guestCount, rid, r.createdAt || new Date().toISOString()]
      );
      rsvps++;
    }
  }
  return { events, rsvps };
}
