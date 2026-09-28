import { getPostgresPool } from "./data-postgres.js";
import { departmentForInvoice } from "./salesperson-activity.js";
import { modelDiscountsFromFeed } from "./epass-feed-finished.js";

// ---------------------------------------------------------------------------
// SOLD SERIALS FROM THE ePASS FEED (Andrew, 2026-09-28: "rework the Brand
// Sales report to use the data from the ePASS serial import").
//
// The finished-orders bundle already carries every InvoiceSerial row of every
// invoice finished in the window (that is where the OE-23 product cost comes
// from). This module keeps those rows one per unit instead of summing them
// away, priced from the InvoiceModel line the serial was committed to and
// netted with that line's linked ePASS discount, with the brand straight
// from the Model / Brand masters (finished-model-master). Brand Sales reads
// this table; the commission-report Model lines are no longer involved.
//
//   epass_sold_serials   one row per (invoice, serial, model, seq)
//   epass_model_master   brand / product / description per model, accumulated
//                        from every bundle (so history keeps its brand even
//                        when a model drops out of the current window)
//
// Rows for an invoice are replaced whenever that invoice arrives in a bundle
// (a returned unit flips Returned; a re-finished ticket re-prices), and an
// invoice that stops being FINISHED (voided / reopened) is removed when the
// bundle's window still covers it and it is absent.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS epass_model_master (
  model TEXT PRIMARY KEY,
  brand_code TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS epass_sold_serials (
  invoice TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 1,
  base_invoice TEXT NOT NULL DEFAULT '',
  finish_date TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  inv_type TEXT NOT NULL DEFAULT '',
  salesperson_code TEXT NOT NULL DEFAULT '',
  customer_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_price_code TEXT NOT NULL DEFAULT '',
  new_used TEXT NOT NULL DEFAULT '',
  returned BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT '',
  line_ts TEXT NOT NULL DEFAULT '',
  line_found BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invoice, serial, model, seq)
);
ALTER TABLE epass_sold_serials ADD COLUMN IF NOT EXISTS start_date TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_ess_finish ON epass_sold_serials (finish_date);
CREATE INDEX IF NOT EXISTS idx_ess_start ON epass_sold_serials (start_date);
CREATE INDEX IF NOT EXISTS idx_ess_model ON epass_sold_serials (model);
CREATE TABLE IF NOT EXISTS epass_sold_serials_meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pulled_at TEXT NOT NULL DEFAULT '',
  finished_since TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  serials INTEGER NOT NULL DEFAULT 0,
  invoices INTEGER NOT NULL DEFAULT 0,
  unpriced INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row || {}).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (key != null && row[key] != null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
};
const rows = (d, name) => (Array.isArray(d?.[name]) ? d[name] : []).filter((r) => r && typeof r === "object");
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (v) => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return u ? `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}` : ""; };
const bool = (v) => /^(1|true|y|yes)$/i.test(String(v ?? "").trim());
const up = (v, max = 80) => String(v || "").trim().toUpperCase().slice(0, max);
const baseInvoiceOf = (inv) => inv.replace(/-\d+$/, "");

// Model master rows → { MODEL: { brandCode, brand, productCode, description, sku } }
export function modelMasterFromFeed(datasets) {
  const out = {};
  for (const r of rows(datasets, "finished-model-master")) {
    const model = up(pick(r, "Code"));
    if (!model) continue;
    out[model] = {
      brandCode: up(pick(r, "BrandCode"), 40),
      brand: pick(r, "Brand_Description").slice(0, 120),
      productCode: up(pick(r, "ProductCode"), 40),
      description: pick(r, "Description").slice(0, 200),
      sku: pick(r, "SKU").slice(0, 80)
    };
  }
  return out;
}

// The bundle's finished-* datasets → one row per sold unit.
//   price     the InvoiceModel line's SellingPrice (per unit) — the serial's
//             ModelLineTimeStamp names the line; without a stamp the first
//             line of that model on the invoice is used
//   discount  that line's linked ePASS discount (negative), split evenly
//             across the units on the line
//   cost      InvoiceSerial.UnitCost
export function soldSerialsFromFeed(datasets, { since = "" } = {}) {
  const d = datasets || {};
  const headers = new Map();
  for (const r of rows(d, "finished-orders")) {
    const invoice = up(pick(r, "Code"), 40);
    if (!invoice) continue;
    const finishDate = day(pick(r, "InvFinishDate")) || day(pick(r, "DateFinished"));
    if (!finishDate || (since && finishDate < since)) continue;
    const bill = [pick(r, "BillToLastName"), pick(r, "BillToFirstName")].filter(Boolean).join(" ");
    const sold = [pick(r, "SoldToLastName"), pick(r, "SoldToFirstName")].filter(Boolean).join(" ");
    headers.set(invoice, {
      invoice, finishDate, startDate: day(pick(r, "InvStartDate")) || day(pick(r, "DateCreated")), department: departmentForInvoice(invoice), invType: up(pick(r, "InvTypeCode"), 10),
      salespersonCode: up(pick(r, "Salesperson1Code"), 20), customerNumber: (pick(r, "BillToCode") || pick(r, "SoldToCode")).slice(0, 40),
      customerName: (bill || sold).slice(0, 160)
    });
  }
  // Model lines: by stamp, and by invoice+model for stampless serials.
  const byStamp = new Map(), byInvoiceModel = new Map();
  for (const r of rows(d, "finished-models")) {
    const invoice = up(pick(r, "InvoiceCode"), 40), model = up(pick(r, "ModelCode"));
    if (!invoice || !model) continue;
    const qty = num(pick(r, "QtyShipped")) || num(pick(r, "QtyOrdered")) || 1;
    const sellingPrice = r2(num(pick(r, "SellingPrice")) || (num(pick(r, "Total")) / qty));
    const line = { invoice, ts: pick(r, "LineTimeStamp").slice(0, 60), model, qty, sellingPrice, listPriceCode: up(pick(r, "ListPriceCode"), 20), newUsed: up(pick(r, "NewUsed"), 10), discount: 0 };
    if (line.ts) byStamp.set(invoice + "|" + line.ts, line);
    const k = invoice + "|" + model;
    if (!byInvoiceModel.has(k)) byInvoiceModel.set(k, []);
    byInvoiceModel.get(k).push(line);
  }
  const discounts = modelDiscountsFromFeed(d);
  for (const [invoice, lines] of Object.entries(discounts)) {
    if (invoice.startsWith("_")) continue;
    for (const dl of lines) {
      const line = (dl.lineTimeStamp && byStamp.get(invoice + "|" + dl.lineTimeStamp))
        || (byInvoiceModel.get(invoice + "|" + up(dl.model)) || []).find((l) => !l.discount);
      if (line) line.discount = r2(line.discount + dl.discount);
    }
  }
  const out = [];
  const seqs = new Map();
  let unpriced = 0;
  for (const r of rows(d, "finished-serials")) {
    const invoice = up(pick(r, "InvoiceCode"), 40);
    const h = headers.get(invoice);
    if (!h) continue;
    const model = up(pick(r, "ModelCode"));
    const serial = up(pick(r, "SerialCode"), 80);
    const ts = pick(r, "ModelLineTimeStamp").slice(0, 60);
    const line = (ts && byStamp.get(invoice + "|" + ts)) || (byInvoiceModel.get(invoice + "|" + model) || [])[0] || null;
    if (!line) unpriced++;
    const key = `${invoice}|${serial}|${model}`;
    const seq = (seqs.get(key) || 0) + 1;
    seqs.set(key, seq);
    out.push({
      invoice, serial, model, seq, baseInvoice: baseInvoiceOf(invoice),
      finishDate: h.finishDate, startDate: h.startDate, department: h.department, invType: h.invType, salespersonCode: h.salespersonCode,
      customerNumber: h.customerNumber, customerName: h.customerName,
      sellingPrice: line ? line.sellingPrice : 0,
      discount: line && line.discount ? r2(line.discount / Math.max(1, line.qty)) : 0,
      unitCost: r2(num(pick(r, "UnitCost"))),
      listPriceCode: line?.listPriceCode || "", newUsed: line?.newUsed || "",
      returned: bool(pick(r, "Returned")), status: up(pick(r, "Status"), 20),
      lineTs: ts || line?.ts || "", lineFound: !!line
    });
  }
  return { serials: out, invoices: headers, unpriced };
}

export async function replaceEpassSoldSerials(bundle, { filename = "" } = {}) {
  const pool = await getReadyPool();
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(bundle?.finishedSince || "")) ? String(bundle.finishedSince) : "";
  const master = modelMasterFromFeed(bundle?.datasets);
  const { serials, invoices, unpriced } = soldSerialsFromFeed(bundle?.datasets, { since });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [model, m] of Object.entries(master)) {
      await client.query(
        `INSERT INTO epass_model_master (model, brand_code, brand, product_code, description, sku, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (model) DO UPDATE SET brand_code = EXCLUDED.brand_code, brand = EXCLUDED.brand, product_code = EXCLUDED.product_code,
           description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE epass_model_master.description END,
           sku = CASE WHEN EXCLUDED.sku <> '' THEN EXCLUDED.sku ELSE epass_model_master.sku END, updated_at = NOW()`,
        [model, m.brandCode, m.brand, m.productCode, m.description, m.sku]
      );
    }
    // Invoices the bundle covers are rewritten wholesale; within the window
    // an invoice that no longer appears (voided / reopened) is dropped.
    if (since) await client.query(`DELETE FROM epass_sold_serials WHERE finish_date >= $1 AND NOT (invoice = ANY($2::text[]))`, [since, [...invoices.keys()]]);
    const invList = [...invoices.keys()];
    for (let i = 0; i < invList.length; i += 500) await client.query(`DELETE FROM epass_sold_serials WHERE invoice = ANY($1::text[])`, [invList.slice(i, i + 500)]);
    const cols = ["invoice", "serial", "model", "seq", "base_invoice", "finish_date", "start_date", "department", "inv_type", "salesperson_code", "customer_number", "customer_name",
      "selling_price", "discount", "unit_cost", "list_price_code", "new_used", "returned", "status", "line_ts", "line_found"];
    for (let i = 0; i < serials.length; i += 200) {
      const chunk = serials.slice(i, i + 200);
      const params = [];
      const tuples = chunk.map((s) => {
        const row = [s.invoice, s.serial, s.model, s.seq, s.baseInvoice, s.finishDate, s.startDate, s.department, s.invType, s.salespersonCode, s.customerNumber, s.customerName,
          s.sellingPrice, s.discount, s.unitCost, s.listPriceCode, s.newUsed, s.returned, s.status, s.lineTs, s.lineFound];
        return "(" + row.map((v) => `$${params.push(v)}`).join(", ") + ", NOW())";
      });
      await client.query(
        `INSERT INTO epass_sold_serials (${cols.join(", ")}, updated_at) VALUES ${tuples.join(", ")}
         ON CONFLICT (invoice, serial, model, seq) DO UPDATE SET
           base_invoice = EXCLUDED.base_invoice, finish_date = EXCLUDED.finish_date, start_date = EXCLUDED.start_date, department = EXCLUDED.department, inv_type = EXCLUDED.inv_type,
           salesperson_code = EXCLUDED.salesperson_code, customer_number = EXCLUDED.customer_number, customer_name = EXCLUDED.customer_name,
           selling_price = EXCLUDED.selling_price, discount = EXCLUDED.discount, unit_cost = EXCLUDED.unit_cost, list_price_code = EXCLUDED.list_price_code,
           new_used = EXCLUDED.new_used, returned = EXCLUDED.returned, status = EXCLUDED.status, line_ts = EXCLUDED.line_ts, line_found = EXCLUDED.line_found, updated_at = NOW()`,
        params
      );
    }
    await client.query(
      `INSERT INTO epass_sold_serials_meta (id, pulled_at, finished_since, filename, serials, invoices, unpriced, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET pulled_at = EXCLUDED.pulled_at, finished_since = EXCLUDED.finished_since, filename = EXCLUDED.filename,
         serials = EXCLUDED.serials, invoices = EXCLUDED.invoices, unpriced = EXCLUDED.unpriced, updated_at = NOW()`,
      [String(bundle?.pulledAt || ""), since, String(filename || "").slice(0, 200), serials.length, invoices.size, unpriced]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { serials: serials.length, invoices: invoices.size, models: Object.keys(master).length, unpriced };
}

export async function getEpassSoldSerialsMeta() {
  const pool = await getReadyPool();
  const [meta, cov] = await Promise.all([
    pool.query(`SELECT pulled_at, finished_since, filename, serials, invoices, unpriced, updated_at FROM epass_sold_serials_meta WHERE id = 1`),
    pool.query(`SELECT MIN(finish_date) AS min, MAX(finish_date) AS max, COUNT(*)::int AS rows FROM epass_sold_serials WHERE finish_date <> ''`)
  ]);
  const m = meta.rows[0] || null;
  return { last: m ? { ...m, updatedAt: m.updated_at } : null, coverage: { from: cov.rows[0]?.min || "", to: cov.rows[0]?.max || "", rows: cov.rows[0]?.rows || 0 } };
}

// Brand Sales: per-model roll-up in a window, two ways side by side
// (Andrew 9/28: "when the sales team wrote the model to a ticket vs when
// they delivered it"):
//   delivered  units whose invoice FINISHED in the window (revenue, cost,
//              margin, discounts, returns, orders) — epass_sold_serials by
//              finish_date
//   written    units whose invoice was STARTED in the window (InvStartDate,
//              else DateCreated): the same serial table by start_date PLUS
//              the model lines of invoices still open in ePASS (the open
//              book) — those have no serials yet, so QtyOrdered counts
// Returned units are excluded from both. A model can appear with written
// units and no deliveries (or the reverse).
const dateIn = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
export async function listSoldSerialsByModel({ from = "", to = "", department = "" } = {}) {
  const pool = await getReadyPool();
  const params = [];
  const where = [`s.finish_date <> ''`];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); where.push(`s.finish_date >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); where.push(`s.finish_date <= $${params.length}`); }
  if (department) { params.push(department); where.push(`upper(s.department) = upper($${params.length})`); }
  const result = await pool.query(
    `SELECT s.model,
            COUNT(*) FILTER (WHERE NOT s.returned)::int AS units,
            COUNT(*) FILTER (WHERE s.returned)::int AS returned,
            COALESCE(SUM(s.selling_price) FILTER (WHERE NOT s.returned), 0)::float AS list_revenue,
            COALESCE(SUM(s.discount) FILTER (WHERE NOT s.returned), 0)::float AS discount,
            COALESCE(SUM(s.selling_price + s.discount) FILTER (WHERE NOT s.returned), 0)::float AS revenue,
            COALESCE(SUM(s.unit_cost) FILTER (WHERE NOT s.returned), 0)::float AS cost,
            COUNT(DISTINCT s.base_invoice) FILTER (WHERE NOT s.returned)::int AS orders,
            COUNT(*) FILTER (WHERE NOT s.line_found)::int AS unpriced
       FROM epass_sold_serials s
      WHERE ${where.join(" AND ")}
      GROUP BY 1`,
    params
  );
  // Written (finished side): the same table by start date.
  const wParams = [];
  const wWhere = [`s.start_date <> ''`, `NOT s.returned`];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { wParams.push(from); wWhere.push(`s.start_date >= $${wParams.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { wParams.push(to); wWhere.push(`s.start_date <= $${wParams.length}`); }
  if (department) { wParams.push(department); wWhere.push(`upper(s.department) = upper($${wParams.length})`); }
  const written = await pool.query(
    `SELECT s.model, COUNT(*)::int AS units, COUNT(DISTINCT s.base_invoice)::int AS orders,
            COALESCE(SUM(s.selling_price + s.discount), 0)::float AS revenue
       FROM epass_sold_serials s WHERE ${wWhere.join(" AND ")} GROUP BY 1`,
    wParams
  );
  // Written (open side): model lines of invoices still open in ePASS.
  const openLines = await pool.query(
    `SELECT l.model_code AS model, l.invoice_code AS invoice, l.raw AS line, o.raw AS header
       FROM epass_open_order_lines l JOIN epass_open_orders o ON o.code = l.invoice_code`
  ).then((r) => r.rows).catch(() => []);
  const openByModel = new Map();
  const lineBrand = new Map();
  for (const r of openLines) {
    const model = up(r.model); if (!model) continue;
    const start = day(pick(r.header, "InvStartDate")) || day(pick(r.header, "DateCreated"));
    if (!dateIn(start, from, to)) continue;
    if (department && departmentForInvoice(r.invoice).toUpperCase() !== department.toUpperCase()) continue;
    const qty = num(pick(r.line, "QtyOrdered")) || 1;
    const price = num(pick(r.line, "SellingPrice")) || (num(pick(r.line, "Total")) / qty);
    const cur = openByModel.get(model) || { units: 0, orders: new Set(), revenue: 0 };
    cur.units += qty; cur.orders.add(baseInvoiceOf(up(r.invoice, 40))); cur.revenue += price * qty;
    openByModel.set(model, cur);
    if (!lineBrand.has(model)) lineBrand.set(model, { brandCode: up(pick(r.line, "Model_BrandCode"), 40), productCode: up(pick(r.line, "Model_ProductCode"), 40), description: pick(r.line, "Model_Description").slice(0, 200) });
  }
  // Merge the three views per model.
  const models = new Map();
  const ensure = (model) => { if (!models.has(model)) models.set(model, { model, units: 0, returned: 0, listRevenue: 0, discount: 0, revenue: 0, cost: 0, margin: 0, orders: 0, unpriced: 0, written: 0, writtenFinished: 0, writtenOpen: 0, writtenOrders: 0, writtenRevenue: 0 }); return models.get(model); };
  for (const r of result.rows) {
    const m = ensure(r.model);
    Object.assign(m, { units: r.units, returned: r.returned, listRevenue: r2(r.list_revenue), discount: r2(r.discount), revenue: r2(r.revenue), cost: r2(r.cost), margin: r2(r.revenue - r.cost), orders: r.orders, unpriced: r.unpriced });
  }
  for (const r of written.rows) { const m = ensure(r.model); m.writtenFinished = r.units; m.writtenOrders += r.orders; m.writtenRevenue = r2(m.writtenRevenue + r.revenue); }
  for (const [model, o] of openByModel) { const m = ensure(model); m.writtenOpen = o.units; m.writtenOrders += o.orders.size; m.writtenRevenue = r2(m.writtenRevenue + o.revenue); }
  for (const m of models.values()) m.written = m.writtenFinished + m.writtenOpen;
  // Brand / description: the ePASS model master, else the open line's Model join.
  const codes = [...models.keys()];
  const master = codes.length ? await pool.query(`SELECT model, brand_code, brand, product_code, description FROM epass_model_master WHERE model = ANY($1::text[])`, [codes]) : { rows: [] };
  const masterBy = new Map(master.rows.map((r) => [r.model, r]));
  const out = [...models.values()].map((m) => {
    const mm = masterBy.get(m.model), lb = lineBrand.get(m.model);
    return { ...m, brandCode: mm?.brand_code || lb?.brandCode || "", brand: mm?.brand || "", productCode: mm?.product_code || lb?.productCode || "", description: mm?.description || lb?.description || "" };
  }).sort((a, b) => b.revenue - a.revenue || b.written - a.written);
  const [cov, deps] = await Promise.all([
    pool.query(`SELECT MIN(finish_date) AS min, MAX(finish_date) AS max, MIN(NULLIF(start_date, '')) AS start_min FROM epass_sold_serials WHERE finish_date <> ''`),
    pool.query(`SELECT DISTINCT department FROM epass_sold_serials WHERE department <> '' ORDER BY 1`)
  ]);
  return {
    models: out,
    coverage: { from: cov.rows[0]?.min || "", to: cov.rows[0]?.max || "", startFrom: cov.rows[0]?.start_min || "", openLines: openLines.length },
    departments: deps.rows.map((r) => r.department)
  };
}

// The units behind one model in the window (drawer on the report).
export async function listSoldSerialsForModel({ model, from = "", to = "", department = "" } = {}) {
  const pool = await getReadyPool();
  const params = [up(model)];
  const where = [`s.model = $1`, `s.finish_date <> ''`];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); where.push(`s.finish_date >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); where.push(`s.finish_date <= $${params.length}`); }
  if (department) { params.push(department); where.push(`upper(s.department) = upper($${params.length})`); }
  const r = await pool.query(
    `SELECT invoice, serial, finish_date, start_date, department, salesperson_code, customer_name, selling_price::float, discount::float, unit_cost::float, list_price_code, new_used, returned, status, line_found
       FROM epass_sold_serials s WHERE ${where.join(" AND ")} ORDER BY finish_date DESC, invoice, serial`,
    params
  );
  const units = r.rows.map((x) => ({
    invoice: x.invoice, serial: x.serial, finishDate: x.finish_date, startDate: x.start_date, department: x.department, salespersonCode: x.salesperson_code, customerName: x.customer_name,
    sellingPrice: r2(x.selling_price), discount: r2(x.discount), net: r2(x.selling_price + x.discount), unitCost: r2(x.unit_cost),
    listPriceCode: x.list_price_code, newUsed: x.new_used, returned: x.returned, status: x.status, lineFound: x.line_found
  }));
  // Written in the window but not yet delivered: the model's lines on the open book.
  const openRows = await pool.query(
    `SELECT l.invoice_code AS invoice, l.raw AS line, o.raw AS header FROM epass_open_order_lines l JOIN epass_open_orders o ON o.code = l.invoice_code WHERE l.model_code = $1`,
    [up(model)]
  ).then((x) => x.rows).catch(() => []);
  const open = [];
  for (const o of openRows) {
    const start = day(pick(o.header, "InvStartDate")) || day(pick(o.header, "DateCreated"));
    if (!dateIn(start, from, to)) continue;
    if (department && departmentForInvoice(o.invoice).toUpperCase() !== department.toUpperCase()) continue;
    const qty = num(pick(o.line, "QtyOrdered")) || 1;
    open.push({
      invoice: up(o.invoice, 40), startDate: start, qty, sellingPrice: r2(num(pick(o.line, "SellingPrice")) || (num(pick(o.line, "Total")) / qty)),
      status: up(pick(o.header, "Status"), 20), jobStatus: up(pick(o.header, "JobStatusCode"), 30), scheduleDate: day(pick(o.header, "ScheduleDate")),
      salespersonCode: up(pick(o.header, "Salesperson1Code"), 20),
      customerName: [pick(o.header, "SoldToLastName"), pick(o.header, "SoldToFirstName")].filter(Boolean).join(" ").slice(0, 160)
    });
  }
  open.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return { units, open };
}
