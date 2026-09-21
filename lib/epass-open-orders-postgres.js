import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// ePASS OPEN ORDERS — straight from the database (2026-09-19).
//
// scripts/epass-odbc-pull.ps1 reads ePASS through the 32-bit COMPANY1 DSN on
// the showroom server, writes CSVs to W:\Agility\epass\ for people, and drops
// one JSON bundle per run into W:\Agility\outbox\epass-open-orders\, which
// scripts/epass-agent.ps1 pushes here (kind "epass-open-orders"). This module
// keeps the latest bundle whole — every column ePASS gave us, minus the
// deny-listed ones the script never sends — so the reports that today rely
// on hand-exported OE-23 / Invoice Maintenance files can be moved onto it
// one at a time without another pull.
//
//   epass_open_orders          one row per open sales invoice (R/S/AC/CAB)
//   epass_open_order_lines     InvoiceModel rows (+ Model brand/product/SKU)
//   epass_open_order_serials   InvoiceSerial rows
//   epass_open_order_misc      InvoiceMisc rows
//   epass_open_order_models    Model master (+ supplier) for every model on a line
//   epass_on_hand_serials      Serial master, every unit in stock, with the invoice it is promised to
//   epass_open_po_lines        POModel lines not yet received (+ PO supplier / ETA) for those models
//   epass_open_orders_meta     when, from where, how many, which columns
//
// The service bundle (kind "epass-open-service": SV/WTY tickets not finished,
// with labor + LaborRate description, parts, comments, notes) lands the same
// way in epass_open_service / _labor / _items / _comments / _notes / _meta.
//
// Each run REPLACES the four tables (they are "what is open right now", the
// same way the OE-23 upload replaces open_sales_orders). Invoices that
// disappear between runs were finished or cancelled in ePASS.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS epass_open_orders (
  code TEXT PRIMARY KEY,
  inv_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  job_status TEXT NOT NULL DEFAULT '',
  date_created TEXT NOT NULL DEFAULT '',
  sold_to_code TEXT NOT NULL DEFAULT '',
  sold_to_name TEXT NOT NULL DEFAULT '',
  bill_to_code TEXT NOT NULL DEFAULT '',
  salesperson TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_orders_type ON epass_open_orders (inv_type);
CREATE INDEX IF NOT EXISTS epass_open_orders_sold_to ON epass_open_orders (sold_to_code);
CREATE TABLE IF NOT EXISTS epass_open_order_lines (
  id BIGSERIAL PRIMARY KEY,
  invoice_code TEXT NOT NULL,
  model_code TEXT NOT NULL DEFAULT '',
  line_timestamp TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_order_lines_inv ON epass_open_order_lines (invoice_code);
CREATE INDEX IF NOT EXISTS epass_open_order_lines_model ON epass_open_order_lines (model_code);
CREATE TABLE IF NOT EXISTS epass_open_order_serials (
  id BIGSERIAL PRIMARY KEY,
  invoice_code TEXT NOT NULL,
  model_code TEXT NOT NULL DEFAULT '',
  serial_code TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_order_serials_inv ON epass_open_order_serials (invoice_code);
CREATE TABLE IF NOT EXISTS epass_open_order_misc (
  id BIGSERIAL PRIMARY KEY,
  invoice_code TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_order_misc_inv ON epass_open_order_misc (invoice_code);
CREATE TABLE IF NOT EXISTS epass_open_order_models (
  model_code TEXT PRIMARY KEY,
  brand TEXT NOT NULL DEFAULT '',
  supplier_code TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_on_hand_serials (
  id BIGSERIAL PRIMARY KEY,
  serial_code TEXT NOT NULL DEFAULT '',
  model_code TEXT NOT NULL DEFAULT '',
  ordered_for TEXT NOT NULL DEFAULT '',
  location_code TEXT NOT NULL DEFAULT '',
  date_received TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_on_hand_serials_model ON epass_on_hand_serials (model_code);
CREATE INDEX IF NOT EXISTS epass_on_hand_serials_for ON epass_on_hand_serials (ordered_for);
CREATE TABLE IF NOT EXISTS epass_open_po_lines (
  id BIGSERIAL PRIMARY KEY,
  po_code TEXT NOT NULL DEFAULT '',
  model_code TEXT NOT NULL DEFAULT '',
  back_order_invoice TEXT NOT NULL DEFAULT '',
  supplier_code TEXT NOT NULL DEFAULT '',
  eta TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_po_lines_model ON epass_open_po_lines (model_code);
CREATE INDEX IF NOT EXISTS epass_open_po_lines_inv ON epass_open_po_lines (back_order_invoice);
CREATE TABLE IF NOT EXISTS epass_open_service (
  code TEXT PRIMARY KEY,
  inv_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  job_status TEXT NOT NULL DEFAULT '',
  date_created TEXT NOT NULL DEFAULT '',
  schedule_date TEXT NOT NULL DEFAULT '',
  sold_to_code TEXT NOT NULL DEFAULT '',
  sold_to_name TEXT NOT NULL DEFAULT '',
  sold_to_zip TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_service_status ON epass_open_service (job_status);
CREATE TABLE IF NOT EXISTS epass_open_service_labor (
  id BIGSERIAL PRIMARY KEY, invoice_code TEXT NOT NULL, trip_no INT, tech_code TEXT NOT NULL DEFAULT '', labor_code TEXT NOT NULL DEFAULT '', raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_service_labor_inv ON epass_open_service_labor (invoice_code);
CREATE TABLE IF NOT EXISTS epass_open_service_items (
  id BIGSERIAL PRIMARY KEY, invoice_code TEXT NOT NULL, trip_no INT, item_code TEXT NOT NULL DEFAULT '', raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_service_items_inv ON epass_open_service_items (invoice_code);
CREATE TABLE IF NOT EXISTS epass_open_service_comments (
  id BIGSERIAL PRIMARY KEY, invoice_code TEXT NOT NULL, raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_service_comments_inv ON epass_open_service_comments (invoice_code);
CREATE TABLE IF NOT EXISTS epass_open_service_notes (
  id BIGSERIAL PRIMARY KEY, invoice_code TEXT NOT NULL, raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_open_service_notes_inv ON epass_open_service_notes (invoice_code);
CREATE TABLE IF NOT EXISTS epass_open_service_meta (
  id INTEGER PRIMARY KEY,
  pulled_at TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT '',
  machine TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  columns JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_open_orders_meta (
  id INTEGER PRIMARY KEY,
  pulled_at TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT '',
  machine TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  columns JSONB NOT NULL DEFAULT '{}'::jsonb
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

// ePASS column names vary in case between tables/versions; read them loosely.
const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (key != null && row[key] != null && row[key] !== "") return String(row[key]).trim();
  }
  return "";
};
const rowsOf = (bundle, name) => (Array.isArray(bundle?.datasets?.[name]) ? bundle.datasets[name] : []).filter((r) => r && typeof r === "object");
const columnsOf = (rows) => (rows.length ? Object.keys(rows[0]) : []);

export function parseOpenOrdersBundle(bufferOrText) {
  const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString("utf8") : String(bufferOrText || "");
  let bundle;
  try { bundle = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("Not a JSON bundle from epass-odbc-pull.ps1."); }
  if (!bundle || typeof bundle !== "object" || !bundle.datasets) throw new Error("Bundle has no datasets.");
  const orders = rowsOf(bundle, "open-orders");
  if (!orders.length) throw new Error("Bundle has no open orders.");
  if (!pick(orders[0], "Code")) throw new Error("Open-order rows have no Code column.");
  return bundle;
}

export async function replaceEpassOpenOrders(bundle, { filename = "" } = {}) {
  const pool = await getReadyPool();
  const orders = rowsOf(bundle, "open-orders");
  const lines = rowsOf(bundle, "open-order-lines");
  const serials = rowsOf(bundle, "open-order-serials");
  const misc = rowsOf(bundle, "open-order-misc");
  const modelRows = rowsOf(bundle, "open-order-models");
  const onHand = rowsOf(bundle, "on-hand-serials");
  const poLines = rowsOf(bundle, "open-po-lines");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM epass_open_orders");
    await client.query("DELETE FROM epass_open_order_lines");
    await client.query("DELETE FROM epass_open_order_serials");
    await client.query("DELETE FROM epass_open_order_misc");
    await client.query("DELETE FROM epass_open_order_models");
    // The two newer datasets only replace what they carry: an older pull
    // script (or a failed query, which the script logs and skips) leaves the
    // previous units / PO lines in place rather than wiping them.
    if (onHand.length) {
      await client.query("DELETE FROM epass_on_hand_serials");
      for (const r of onHand) {
        await client.query(`INSERT INTO epass_on_hand_serials (serial_code, model_code, ordered_for, location_code, date_received, raw) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [pick(r, "Code"), pick(r, "ModelCode"), pick(r, "OrderedForInvoiceCode") || pick(r, "InvoiceCode"), pick(r, "LocationCode"), pick(r, "DateReceived").slice(0, 10), JSON.stringify(r)]);
      }
    }
    if (poLines.length) {
      await client.query("DELETE FROM epass_open_po_lines");
      for (const r of poLines) {
        await client.query(`INSERT INTO epass_open_po_lines (po_code, model_code, back_order_invoice, supplier_code, eta, raw) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [pick(r, "POCode"), pick(r, "ModelCode"), pick(r, "BackOrderInvoiceCode"), pick(r, "SupplierCode"), (pick(r, "ETADateMostUpdated") || pick(r, "ETADate") || pick(r, "RequestedDeliveryDate")).slice(0, 10), JSON.stringify(r)]);
      }
    }
    const seenModels = new Set();
    for (const r of modelRows) {
      const code = pick(r, "Code"); if (!code || seenModels.has(code)) continue; seenModels.add(code);
      await client.query(`INSERT INTO epass_open_order_models (model_code, brand, supplier_code, supplier_name, raw) VALUES ($1,$2,$3,$4,$5::jsonb)`, [code, pick(r, "BrandCode"), pick(r, "SupplierCode"), pick(r, "Supplier_Description"), JSON.stringify(r)]);
    }
    const seen = new Set();
    for (const r of orders) {
      const code = pick(r, "Code");
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const name = [pick(r, "SoldToFirstName"), pick(r, "SoldToLastName")].filter(Boolean).join(" ") || pick(r, "SoldToName", "SoldToCompany");
      await client.query(
        `INSERT INTO epass_open_orders (code, inv_type, status, job_status, date_created, sold_to_code, sold_to_name, bill_to_code, salesperson, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [code, pick(r, "InvTypeCode"), pick(r, "Status"), pick(r, "JobStatusCode"), pick(r, "DateCreated").slice(0, 10), pick(r, "SoldToCode"), name, pick(r, "BillToCode"), pick(r, "SalespersonCode", "SalesPersonCode", "Salesperson"), JSON.stringify(r)]
      );
    }
    for (const r of lines) {
      const inv = pick(r, "InvoiceCode"); if (!inv) continue;
      await client.query(`INSERT INTO epass_open_order_lines (invoice_code, model_code, line_timestamp, raw) VALUES ($1,$2,$3,$4::jsonb)`, [inv, pick(r, "ModelCode"), pick(r, "LineTimeStamp"), JSON.stringify(r)]);
    }
    for (const r of serials) {
      const inv = pick(r, "InvoiceCode"); if (!inv) continue;
      await client.query(`INSERT INTO epass_open_order_serials (invoice_code, model_code, serial_code, raw) VALUES ($1,$2,$3,$4::jsonb)`, [inv, pick(r, "ModelCode"), pick(r, "SerialCode"), JSON.stringify(r)]);
    }
    for (const r of misc) {
      const inv = pick(r, "InvoiceCode"); if (!inv) continue;
      await client.query(`INSERT INTO epass_open_order_misc (invoice_code, raw) VALUES ($1,$2::jsonb)`, [inv, JSON.stringify(r)]);
    }
    const counts = { orders: seen.size, lines: lines.length, serials: serials.length, misc: misc.length, models: seenModels.size, onHand: onHand.length, poLines: poLines.length };
    const columns = { "open-orders": columnsOf(orders), "open-order-lines": columnsOf(lines), "open-order-serials": columnsOf(serials), "open-order-misc": columnsOf(misc), "open-order-models": columnsOf(modelRows), "on-hand-serials": columnsOf(onHand), "open-po-lines": columnsOf(poLines) };
    await client.query(
      `INSERT INTO epass_open_orders_meta (id, pulled_at, received_at, source, machine, filename, counts, columns) VALUES (1,$1,NOW(),$2,$3,$4,$5::jsonb,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET pulled_at = EXCLUDED.pulled_at, received_at = NOW(), source = EXCLUDED.source, machine = EXCLUDED.machine, filename = EXCLUDED.filename, counts = EXCLUDED.counts, columns = EXCLUDED.columns`,
      [String(bundle.pulledAt || ""), String(bundle.source || ""), String(bundle.machine || ""), String(filename || "").slice(0, 200), JSON.stringify(counts), JSON.stringify(columns)]
    );
    await client.query("COMMIT");
    return counts;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getEpassOpenOrdersMeta() {
  const pool = await getReadyPool();
  const meta = (await pool.query(`SELECT pulled_at, received_at, source, machine, filename, counts, columns FROM epass_open_orders_meta WHERE id = 1`)).rows[0] || null;
  const byType = (await pool.query(`SELECT inv_type, status, COUNT(*)::int AS n FROM epass_open_orders GROUP BY inv_type, status ORDER BY inv_type, status`)).rows;
  return { meta, byType };
}

// One open invoice with everything ePASS holds on it (for the office and for
// wiring reports onto this feed).
export async function getEpassOpenOrder(code) {
  const pool = await getReadyPool();
  const c = String(code || "").trim().toUpperCase();
  const order = (await pool.query(`SELECT * FROM epass_open_orders WHERE code = $1`, [c])).rows[0];
  if (!order) return null;
  const [lines, serials, misc, onHand, poLines] = await Promise.all([
    pool.query(`SELECT raw FROM epass_open_order_lines WHERE invoice_code = $1 ORDER BY id`, [c]),
    pool.query(`SELECT raw FROM epass_open_order_serials WHERE invoice_code = $1 ORDER BY id`, [c]),
    pool.query(`SELECT raw FROM epass_open_order_misc WHERE invoice_code = $1 ORDER BY id`, [c]),
    pool.query(`SELECT raw FROM epass_on_hand_serials WHERE ordered_for = $1 ORDER BY model_code, id`, [c]),
    pool.query(`SELECT raw FROM epass_open_po_lines WHERE back_order_invoice = $1 ORDER BY model_code, id`, [c])
  ]);
  // onHand: units in stock promised to this invoice (not yet taken);
  // poLines: units still on a purchase order that was cut for it.
  return { ...order, lines: lines.rows.map((r) => r.raw), serials: serials.rows.map((r) => r.raw), misc: misc.rows.map((r) => r.raw), onHand: onHand.rows.map((r) => r.raw), poLines: poLines.rows.map((r) => r.raw) };
}

export async function listEpassOpenOrders({ type = "", q = "", limit = 500 } = {}) {
  const pool = await getReadyPool();
  const where = [], params = [];
  if (type) { params.push(type.toUpperCase()); where.push(`inv_type = $${params.length}`); }
  if (q) { params.push(`%${q.toUpperCase()}%`); where.push(`(UPPER(code) LIKE $${params.length} OR UPPER(sold_to_name) LIKE $${params.length} OR UPPER(sold_to_code) LIKE $${params.length})`); }
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 5000));
  const r = await pool.query(`SELECT code, inv_type, status, job_status, date_created, sold_to_code, sold_to_name, bill_to_code, salesperson FROM epass_open_orders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date_created DESC, code LIMIT $${params.length}`, params);
  return r.rows;
}

// ---- service tickets (kind "epass-open-service") ----------------------------
export function parseOpenServiceBundle(bufferOrText) {
  const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString("utf8") : String(bufferOrText || "");
  let bundle;
  try { bundle = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("Not a JSON bundle from epass-odbc-pull.ps1."); }
  if (!bundle || typeof bundle !== "object" || !bundle.datasets) throw new Error("Bundle has no datasets.");
  const tickets = rowsOf(bundle, "open-service");
  if (!tickets.length) throw new Error("Bundle has no open service tickets.");
  if (!pick(tickets[0], "Code")) throw new Error("Service rows have no Code column.");
  return bundle;
}

export async function replaceEpassOpenService(bundle, { filename = "" } = {}) {
  const pool = await getReadyPool();
  const tickets = rowsOf(bundle, "open-service");
  const labor = rowsOf(bundle, "open-service-labor");
  const items = rowsOf(bundle, "open-service-items");
  const comments = rowsOf(bundle, "open-service-comments");
  const notes = rowsOf(bundle, "open-service-notes");
  const intOrNull = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of ["epass_open_service", "epass_open_service_labor", "epass_open_service_items", "epass_open_service_comments", "epass_open_service_notes"]) await client.query(`DELETE FROM ${t}`);
    const seen = new Set();
    for (const r of tickets) {
      const code = pick(r, "Code");
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const name = [pick(r, "SoldToFirstName"), pick(r, "SoldToLastName")].filter(Boolean).join(" ");
      await client.query(
        `INSERT INTO epass_open_service (code, inv_type, status, job_status, date_created, schedule_date, sold_to_code, sold_to_name, sold_to_zip, brand, model, serial, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [code, pick(r, "InvTypeCode"), pick(r, "Status"), pick(r, "JobStatusCode"), pick(r, "DateCreated").slice(0, 10), (pick(r, "SvcScheduleDate") || pick(r, "ScheduleDate")).slice(0, 10), pick(r, "SoldToCode"), name, pick(r, "SoldToZipCode").slice(0, 10), pick(r, "SvcBrandCode"), pick(r, "SvcModel"), pick(r, "SvcSerial"), JSON.stringify(r)]
      );
    }
    for (const r of labor) { const inv = pick(r, "InvoiceCode"); if (!inv) continue; await client.query(`INSERT INTO epass_open_service_labor (invoice_code, trip_no, tech_code, labor_code, raw) VALUES ($1,$2,$3,$4,$5::jsonb)`, [inv, intOrNull(pick(r, "TripNo")), pick(r, "TechnicianCode"), pick(r, "LaborRateCode"), JSON.stringify(r)]); }
    for (const r of items) { const inv = pick(r, "InvoiceCode"); if (!inv) continue; await client.query(`INSERT INTO epass_open_service_items (invoice_code, trip_no, item_code, raw) VALUES ($1,$2,$3,$4::jsonb)`, [inv, intOrNull(pick(r, "TripNo")), pick(r, "ItemCode"), JSON.stringify(r)]); }
    for (const r of comments) { const inv = pick(r, "InvoiceCode"); if (!inv) continue; await client.query(`INSERT INTO epass_open_service_comments (invoice_code, raw) VALUES ($1,$2::jsonb)`, [inv, JSON.stringify(r)]); }
    for (const r of notes) { const inv = pick(r, "Code", "InvoiceCode"); if (!inv) continue; await client.query(`INSERT INTO epass_open_service_notes (invoice_code, raw) VALUES ($1,$2::jsonb)`, [inv, JSON.stringify(r)]); }
    const counts = { tickets: seen.size, labor: labor.length, items: items.length, comments: comments.length, notes: notes.length };
    const columns = { "open-service": columnsOf(tickets), "open-service-labor": columnsOf(labor), "open-service-items": columnsOf(items), "open-service-comments": columnsOf(comments), "open-service-notes": columnsOf(notes) };
    await client.query(
      `INSERT INTO epass_open_service_meta (id, pulled_at, received_at, source, machine, filename, counts, columns) VALUES (1,$1,NOW(),$2,$3,$4,$5::jsonb,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET pulled_at = EXCLUDED.pulled_at, received_at = NOW(), source = EXCLUDED.source, machine = EXCLUDED.machine, filename = EXCLUDED.filename, counts = EXCLUDED.counts, columns = EXCLUDED.columns`,
      [String(bundle.pulledAt || ""), String(bundle.source || ""), String(bundle.machine || ""), String(filename || "").slice(0, 200), JSON.stringify(counts), JSON.stringify(columns)]
    );
    await client.query("COMMIT");
    return counts;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getEpassOpenServiceMeta() {
  const pool = await getReadyPool();
  const meta = (await pool.query(`SELECT pulled_at, received_at, source, machine, filename, counts, columns FROM epass_open_service_meta WHERE id = 1`)).rows[0] || null;
  const byStatus = (await pool.query(`SELECT inv_type, job_status, COUNT(*)::int AS n FROM epass_open_service GROUP BY inv_type, job_status ORDER BY inv_type, job_status`)).rows;
  return { meta, byStatus };
}
export async function listEpassOpenService({ type = "", status = "", q = "", limit = 500 } = {}) {
  const pool = await getReadyPool();
  const where = [], params = [];
  if (type) { params.push(type.toUpperCase()); where.push(`inv_type = $${params.length}`); }
  if (status) { params.push(status.toUpperCase()); where.push(`job_status = $${params.length}`); }
  if (q) { params.push(`%${q.toUpperCase()}%`); where.push(`(UPPER(code) LIKE $${params.length} OR UPPER(sold_to_name) LIKE $${params.length} OR UPPER(model) LIKE $${params.length} OR UPPER(serial) LIKE $${params.length})`); }
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 5000));
  const r = await pool.query(`SELECT code, inv_type, status, job_status, date_created, schedule_date, sold_to_code, sold_to_name, sold_to_zip, brand, model, serial FROM epass_open_service ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date_created DESC, code LIMIT $${params.length}`, params);
  return r.rows;
}
export async function getEpassOpenService(code) {
  const pool = await getReadyPool();
  const c = String(code || "").trim().toUpperCase();
  const ticket = (await pool.query(`SELECT * FROM epass_open_service WHERE code = $1`, [c])).rows[0];
  if (!ticket) return null;
  const [labor, items, comments, notes] = await Promise.all([
    pool.query(`SELECT raw FROM epass_open_service_labor WHERE invoice_code = $1 ORDER BY trip_no NULLS FIRST, id`, [c]),
    pool.query(`SELECT raw FROM epass_open_service_items WHERE invoice_code = $1 ORDER BY trip_no NULLS FIRST, id`, [c]),
    pool.query(`SELECT raw FROM epass_open_service_comments WHERE invoice_code = $1 ORDER BY id`, [c]),
    pool.query(`SELECT raw FROM epass_open_service_notes WHERE invoice_code = $1 ORDER BY id`, [c])
  ]);
  return { ...ticket, labor: labor.rows.map((r) => r.raw), items: items.rows.map((r) => r.raw), comments: comments.rows.map((r) => r.raw), notes: notes.rows.map((r) => r.raw) };
}
