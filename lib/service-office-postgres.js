import { boardInternals, setJobStatus, CLOSED_STATUSES, runStatusRules } from "./service-journey-postgres.js";

// ---------------------------------------------------------------------------
// SERVICE OFFICE QUEUES (service-office.html, Client Care) — Andrew, 9/22:
// "we need to get the office queues side of things live so Kezia can start
// entering part ETAs; the logic in the tool needs the ETAs to place SO4s."
//
// The parts queue is every open ticket that is waiting on parts:
//   SO3 / SO3PRE   approved, parts to order          → needs a PO + ETA
//   SO4 / SO4B / SO4H  parts ordered (backordered / shipped to customer)
//                                                    → needs an ETA if it has none
//   SO4PRE         install held, part not here       → same
//   SO5            parts in, schedule the install    → the board's job now
// The ETA is Agility's own field (ePASS has nowhere to put it); the board
// reads it: an SO4* with an ETA is placeable from ETA + 2 business days, one
// without sits in Unscheduled under "waiting on part ETA". "Part is here"
// moves the ticket to SO5 the normal way (status change + packet for ePASS).
// ---------------------------------------------------------------------------

const { getReadyPool, getJobRow, updateJob, addHistory } = boardInternals;
export const PARTS_STATUSES = ["SO3", "SO3PRE", "SO4", "SO4B", "SO4H", "SO4PRE", "SO5"];
const dateStr = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);

// The PO-lines table belongs to the feed (lib/epass-open-orders-postgres.js);
// make sure it exists before the first bundle after deploy so the queue
// never fails on a missing relation.
let poTableReady = null;
async function ensurePoTable(pool) {
  if (!poTableReady) poTableReady = pool.query(`CREATE TABLE IF NOT EXISTS epass_open_service_po (
    id BIGSERIAL PRIMARY KEY, invoice_code TEXT NOT NULL, po_code TEXT NOT NULL DEFAULT '', item_code TEXT NOT NULL DEFAULT '', supplier_code TEXT NOT NULL DEFAULT '', supplier_name TEXT NOT NULL DEFAULT '',
    qty_ordered NUMERIC(10,2), qty_received NUMERIC(10,2), eta_date TEXT NOT NULL DEFAULT '', date_ordered TEXT NOT NULL DEFAULT '', received BOOLEAN NOT NULL DEFAULT FALSE, raw JSONB NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS epass_open_service_po_inv ON epass_open_service_po (invoice_code)`).catch((e) => { poTableReady = null; throw e; });
  return poTableReady;
}
export async function listPartsQueue() {
  const pool = await getReadyPool();
  await ensurePoTable(pool);
  const rows = (await pool.query(
    `SELECT j.*, t.name AS tech_name, o.name AS owner_name,
            (SELECT COALESCE(json_agg(json_build_object('model', l.model, 'description', l.description, 'qty', l.qty, 'status', l.raw->>'Status', 'loc', l.raw->>'Location') ORDER BY l.line_no), '[]'::json) FROM sj_job_lines l WHERE l.sv_number = j.sv_number) AS lines,
            (SELECT COALESCE(json_agg(json_build_object('po', p.po_code, 'item', p.item_code, 'supplier', NULLIF(p.supplier_name, ''), 'supplierCode', p.supplier_code, 'qty', p.qty_ordered, 'received', p.qty_received, 'eta', NULLIF(p.eta_date, ''), 'ordered', NULLIF(p.date_ordered, ''), 'done', p.received) ORDER BY p.po_code, p.id), '[]'::json) FROM epass_open_service_po p WHERE p.invoice_code = j.sv_number) AS po_lines
     FROM sj_jobs j
     LEFT JOIN sj_techs t ON t.sp_code = j.assigned_tech
     LEFT JOIN sj_techs o ON o.sp_code = j.owner_tech
     WHERE j.closed_at IS NULL AND NOT (j.in_feed = FALSE AND j.source = 'import') AND j.status = ANY($1)
     ORDER BY j.parts_eta NULLS FIRST, j.status_changed_at, j.sv_number`, [PARTS_STATUSES])).rows;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return rows.map((j) => {
    const eta = dateStr(j.parts_eta);
    const bucket = j.status === "SO5" ? "arrived" : !eta ? "needs_eta" : eta <= today ? "due" : "on_order";
    return {
      sv: j.sv_number, st: j.status, since: j.status_changed_at ? new Date(j.status_changed_at).toISOString() : null,
      cust: j.customer_name || "", phone: j.phone || "", addr: [j.address1, j.city].filter(Boolean).join(", "), zip: String(j.zip || "").slice(0, 5),
      unit: [j.unit_brand, j.unit_category, j.unit_model].filter(Boolean).join(" "), serial: j.unit_serial || "", problem: j.problem_text || "",
      tech: j.assigned_tech || "", techName: j.tech_name || j.assigned_tech || "", owner: j.owner_tech || "", ownerName: j.owner_name || j.owner_tech || "",
      day: dateStr(j.route_date), win: j.time_window || "",
      eta, po: j.parts_po || "", note: j.parts_note || "", etaBy: j.parts_eta_by || "", etaAt: j.parts_eta_at ? new Date(j.parts_eta_at).toISOString() : null,
      lines: Array.isArray(j.lines) ? j.lines : [], wty: !!j.is_warranty, bucket, epassSt: j.epass_status || "",
      // From ePASS's PO lines (the ODBC feed): PO number, supplier and the
      // buyer's ETA when keyed — Kezia only has to type the ETA.
      poLines: Array.isArray(j.po_lines) ? j.po_lines : [],
      epassPo: [...new Set((Array.isArray(j.po_lines) ? j.po_lines : []).map((p) => p.po).filter(Boolean))].join(", "),
      epassSupplier: [...new Set((Array.isArray(j.po_lines) ? j.po_lines : []).map((p) => p.supplier || p.supplierCode).filter(Boolean))].join(", "),
      epassEta: (Array.isArray(j.po_lines) ? j.po_lines : []).map((p) => p.eta).filter(Boolean).sort().pop() || ""
    };
  });
}

export async function setPartsEta({ sv, eta, po, note, by = "" }) {
  const pool = await getReadyPool();
  const code = String(sv || "").trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, code);
    if (!job) throw new Error(`${code} is not on the board.`);
    if (job.closed_at || CLOSED_STATUSES.includes(job.status)) throw new Error(`${code} is closed.`);
    const changes = { updated_at: new Date() };
    if (eta !== undefined) { const d = eta && /^\d{4}-\d{2}-\d{2}$/.test(eta) ? eta : null; changes.parts_eta = d; changes.parts_eta_by = String(by || "").slice(0, 120); changes.parts_eta_at = new Date(); }
    if (po !== undefined) changes.parts_po = String(po || "").trim().slice(0, 40);
    if (note !== undefined) changes.parts_note = String(note || "").trim().slice(0, 300);
    await updateJob(client, code, changes);
    const was = dateStr(job.parts_eta);
    if (eta !== undefined && was !== (changes.parts_eta || null)) {
      await addHistory(client, { sv: code, from: job.status, to: job.status, actorType: "staff", actorId: by, trigger: "office.parts_eta", note: `parts ETA ${was || "—"} → ${changes.parts_eta || "—"}${changes.parts_po ? " · PO " + changes.parts_po : ""}` });
    }
    await client.query("COMMIT");
    return { sv: code, eta: changes.parts_eta ?? was, po: changes.parts_po ?? job.parts_po, note: changes.parts_note ?? job.parts_note };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

// The box came in: SO5 (parts in, schedule the install), with the packet
// for the office to key into ePASS — the same path as any status change.
export async function markPartsReceived({ sv, by = "", note = "" }) {
  const code = String(sv || "").trim().toUpperCase();
  const pool = await getReadyPool();
  const before = (await pool.query(`SELECT status FROM sj_jobs WHERE sv_number = $1`, [code])).rows[0]?.status || null;
  const r = await setJobStatus(code, { status: "SO5", reasonCode: "parts_received", note: note || "parts received at the shop", byEmail: by });
  await pool.query(`UPDATE sj_jobs SET parts_eta = COALESCE(parts_eta, CURRENT_DATE), updated_at = NOW() WHERE sv_number = $1`, [code]);
  // SO5 rule: the install goes to the owning tech's first open day (doc 21) —
  // and the page says where it landed.
  let rules = null;
  try { rules = await runStatusRules(code, { from: before, byEmail: by }); } catch (err) { rules = { error: err.message }; }
  const techName = rules?.placement?.tech ? (await pool.query(`SELECT name FROM sj_techs WHERE sp_code = $1`, [rules.placement.tech])).rows[0]?.name || rules.placement.tech : "";
  return { ...r, rules: rules?.outcome || null, placement: rules?.placement ? { ...rules.placement, techName } : null, ruleError: rules?.error || null };
}
