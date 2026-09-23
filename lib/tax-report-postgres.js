import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// SALES TAX REPORT — Andrew, 2026-09-23: "I dropped a TAX REPORT that I built
// for our sales tax audit in Crystal. It is a nightmare to code there and I'd
// like to give Will the autonomy to run it himself."
//
// The Crystal report is one row per POSTED invoice for a posted-date range:
//   DatePosted · Sales Invoice · ShipTo/BillTo first+last name (added by the auditor 9/23) · SoldToCity · SoldToState · Tax2Code ·
//   Tax2Total · GrossTotal
// where GrossTotal is the pre-tax invoice total (SerialTotal + ItemTotal +
// LaborTotal + MiscTotal + WtyTotal; a $157 diagnostic carries $12.95 of tax
// = 8.25% of 157). Those seven columns are reproduced exactly, in that
// order, so the audit output matches what was already submitted; then the
// report adds what Crystal could not: the taxable vs exempt base per invoice
// (from every line's Tax2 flag), all three tax totals, the effective rate,
// the bill-to jurisdiction, and totals by city.
//
// Fed by the epass-tax bundle (scripts/epass-odbc-pull.ps1): every posted
// invoice of every type in a DatePosted slice + its model / item / misc /
// labor lines with their Tax1/2/3 flags. Backfill by year, then a daily
// refresh of the last three posted months. Upserted by invoice code.
//
// Nothing here is a filing — it is the record as ePASS posted it.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS epass_tax_invoices (
  code TEXT PRIMARY KEY,
  inv_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  date_posted DATE,
  date_finished DATE,
  salesperson TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  customer_code TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  bill_city TEXT NOT NULL DEFAULT '',
  bill_state TEXT NOT NULL DEFAULT '',
  bill_zip TEXT NOT NULL DEFAULT '',
  ship_first TEXT NOT NULL DEFAULT '',
  ship_last TEXT NOT NULL DEFAULT '',
  bill_first TEXT NOT NULL DEFAULT '',
  bill_last TEXT NOT NULL DEFAULT '',
  tax2_code TEXT NOT NULL DEFAULT '',
  tax2_pct NUMERIC(8,4),
  tax3_pct NUMERIC(8,4),
  tax1_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  tax2_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  tax3_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  jurisdiction TEXT NOT NULL DEFAULT '',
  serial_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  item_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  labor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  misc_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  wty_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax1 NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax2 NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax3 NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable_base NUMERIC(12,2),
  exempt_base NUMERIC(12,2),
  line_count INTEGER NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE epass_tax_invoices ADD COLUMN IF NOT EXISTS ship_first TEXT NOT NULL DEFAULT '';
ALTER TABLE epass_tax_invoices ADD COLUMN IF NOT EXISTS ship_last TEXT NOT NULL DEFAULT '';
ALTER TABLE epass_tax_invoices ADD COLUMN IF NOT EXISTS bill_first TEXT NOT NULL DEFAULT '';
ALTER TABLE epass_tax_invoices ADD COLUMN IF NOT EXISTS bill_last TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS epass_tax_invoices_posted ON epass_tax_invoices (date_posted);
CREATE INDEX IF NOT EXISTS epass_tax_invoices_city ON epass_tax_invoices (state, city);
CREATE TABLE IF NOT EXISTS epass_tax_lines (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  line_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax1 BOOLEAN NOT NULL DEFAULT FALSE,
  tax2 BOOLEAN NOT NULL DEFAULT FALSE,
  tax3 BOOLEAN NOT NULL DEFAULT FALSE,
  warranty BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS epass_tax_lines_code ON epass_tax_lines (code);
CREATE TABLE IF NOT EXISTS epass_tax_meta (
  id INT PRIMARY KEY,
  last_pulled_at TEXT NOT NULL DEFAULT '',
  last_received_at TIMESTAMPTZ,
  last_filename TEXT NOT NULL DEFAULT '',
  last_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  slices JSONB NOT NULL DEFAULT '[]'::jsonb
);
`;
let ready = null;
async function pool() { const p = await getPostgresPool(); if (!ready) ready = p.query(SCHEMA_SQL).catch((e) => { ready = null; throw e; }); await ready; return p; }

const up = (v) => String(v ?? "").trim().toUpperCase();
const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const truthy = (v) => v === true || v === 1 || /^(1|y|yes|true|t)$/i.test(String(v ?? "").trim());
const dateOnly = (v) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && s > "1900-01-01" ? s : null; };
const dstr = (d) => (d instanceof Date ? d.toLocaleDateString("en-CA") : d ? String(d).slice(0, 10) : "");
const pick = (r, ...keys) => { for (const k of keys) { if (r && r[k] != null && r[k] !== "") return r[k]; } return ""; };
const rowsOf = (bundle, name) => (Array.isArray(bundle?.datasets?.[name]) ? bundle.datasets[name] : []);

export async function processTaxBundle(bundle, { filename = "" } = {}) {
  const p = await pool();
  const invoices = rowsOf(bundle, "tax-invoices");
  const lineSets = { model: rowsOf(bundle, "tax-models"), item: rowsOf(bundle, "tax-items"), misc: rowsOf(bundle, "tax-misc"), labor: rowsOf(bundle, "tax-labor") };
  const counts = { invoices: 0, lines: 0 };
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const codes = [];
    for (const r of invoices) {
      const code = up(pick(r, "Code")); if (!code) continue; codes.push(code);
      const totals = ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal"].map((k) => num(pick(r, k)));
      const gross = r2(totals.reduce((a, b) => a + b, 0));
      await client.query(
        `INSERT INTO epass_tax_invoices (code, inv_type, status, department, branch, date_posted, date_finished, salesperson, payment_type, customer_code, customer_name, city, state, zip, bill_city, bill_state, bill_zip, ship_first, ship_last, bill_first, bill_last,
           tax2_code, tax2_pct, tax3_pct, tax1_exempt, tax2_exempt, tax3_exempt, jurisdiction, serial_total, item_total, labor_total, misc_total, wty_total, gross, tax1, tax2, tax3, raw, loaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38::jsonb,NOW())
         ON CONFLICT (code) DO UPDATE SET inv_type = EXCLUDED.inv_type, status = EXCLUDED.status, department = EXCLUDED.department, branch = EXCLUDED.branch, date_posted = EXCLUDED.date_posted, date_finished = EXCLUDED.date_finished, salesperson = EXCLUDED.salesperson, payment_type = EXCLUDED.payment_type,
           customer_code = EXCLUDED.customer_code, customer_name = EXCLUDED.customer_name, city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, bill_city = EXCLUDED.bill_city, bill_state = EXCLUDED.bill_state, bill_zip = EXCLUDED.bill_zip, ship_first = EXCLUDED.ship_first, ship_last = EXCLUDED.ship_last, bill_first = EXCLUDED.bill_first, bill_last = EXCLUDED.bill_last,
           tax2_code = EXCLUDED.tax2_code, tax2_pct = EXCLUDED.tax2_pct, tax3_pct = EXCLUDED.tax3_pct, tax1_exempt = EXCLUDED.tax1_exempt, tax2_exempt = EXCLUDED.tax2_exempt, tax3_exempt = EXCLUDED.tax3_exempt, jurisdiction = EXCLUDED.jurisdiction,
           serial_total = EXCLUDED.serial_total, item_total = EXCLUDED.item_total, labor_total = EXCLUDED.labor_total, misc_total = EXCLUDED.misc_total, wty_total = EXCLUDED.wty_total, gross = EXCLUDED.gross, tax1 = EXCLUDED.tax1, tax2 = EXCLUDED.tax2, tax3 = EXCLUDED.tax3, raw = EXCLUDED.raw, loaded_at = NOW()`,
        [code, up(pick(r, "InvTypeCode")), up(pick(r, "Status")), str(pick(r, "Department"), 40), str(pick(r, "BranchCode"), 20), dateOnly(pick(r, "DatePosted")), dateOnly(pick(r, "DateFinished", "InvFinishDate")), up(pick(r, "Salesperson1Code")), up(pick(r, "PaymentTypeCode")),
          up(pick(r, "SoldToCode")), str([pick(r, "SoldToFirstName"), pick(r, "SoldToLastName")].filter(Boolean).join(" "), 120), up(pick(r, "SoldToCity")), up(pick(r, "SoldToState")).slice(0, 2), str(pick(r, "SoldToZipCode"), 10).slice(0, 5),
          up(pick(r, "BillToCity")), up(pick(r, "BillToState")).slice(0, 2), str(pick(r, "BillToZipCode"), 10).slice(0, 5),
          str(pick(r, "SoldToFirstName"), 60), str(pick(r, "SoldToLastName"), 60), str(pick(r, "BillToFirstName"), 60), str(pick(r, "BillToLastName"), 60),
          up(pick(r, "Tax2Code")), pick(r, "Tax2Percentage") === "" ? null : Number(pick(r, "Tax2Percentage")) || 0, pick(r, "Tax3Percentage") === "" ? null : Number(pick(r, "Tax3Percentage")) || 0,
          truthy(pick(r, "Tax1Exempt")), truthy(pick(r, "Tax2Exempt")), truthy(pick(r, "Tax3Exempt")), str(pick(r, "TTRJurisdictionCode"), 40),
          ...totals, gross, num(pick(r, "Tax1Total")), num(pick(r, "Tax2Total")), num(pick(r, "Tax3Total")), JSON.stringify(r)]);
      counts.invoices++;
    }
    if (codes.length) await client.query(`DELETE FROM epass_tax_lines WHERE code = ANY($1)`, [codes]);
    const codeSet = new Set(codes);
    for (const [kind, rows] of Object.entries(lineSets)) {
      for (const r of rows) {
        const code = up(pick(r, "InvoiceCode")); if (!code || !codeSet.has(code)) continue;
        await client.query(`INSERT INTO epass_tax_lines (code, kind, line_code, description, qty, price, total, tax1, tax2, tax3, warranty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [code, kind, up(pick(r, "LineCode")).slice(0, 60), str(pick(r, "LineDesc"), 200), num(pick(r, "Qty")), num(pick(r, "SellingPrice")), num(pick(r, "Total")), truthy(pick(r, "Tax1")), truthy(pick(r, "Tax2")), truthy(pick(r, "Tax3")), truthy(pick(r, "Warranty"))]);
        counts.lines++;
      }
    }
    // taxable vs exempt base per invoice, from the lines' Tax2 flag
    if (codes.length) await client.query(
      `UPDATE epass_tax_invoices i SET taxable_base = s.taxable, exempt_base = s.exempt, line_count = s.n
         FROM (SELECT code, COALESCE(SUM(total) FILTER (WHERE tax2), 0) AS taxable, COALESCE(SUM(total) FILTER (WHERE NOT tax2), 0) AS exempt, COUNT(*)::int AS n FROM epass_tax_lines WHERE code = ANY($1) GROUP BY code) s
        WHERE i.code = s.code`, [codes]);
    const slice = { pulledAt: bundle.pulledAt || "", since: bundle.taxSince || "", until: bundle.taxUntil || "", ...counts, at: new Date().toISOString() };
    await client.query(`INSERT INTO epass_tax_meta (id, last_pulled_at, last_received_at, last_filename, last_counts, slices) VALUES (1,$1,NOW(),$2,$3::jsonb,$4::jsonb)
      ON CONFLICT (id) DO UPDATE SET last_pulled_at = EXCLUDED.last_pulled_at, last_received_at = NOW(), last_filename = EXCLUDED.last_filename, last_counts = EXCLUDED.last_counts,
        slices = (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(epass_tax_meta.slices || EXCLUDED.slices) x ORDER BY x->>'at' DESC LIMIT 40) s)`,
      [bundle.pulledAt || "", String(filename || "").slice(0, 120), JSON.stringify(counts), JSON.stringify([slice])]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  return counts;
}

export async function taxStatus() {
  const p = await pool();
  const meta = (await p.query(`SELECT * FROM epass_tax_meta WHERE id = 1`)).rows[0];
  const n = (await p.query(`SELECT COUNT(*)::int AS n, MIN(date_posted)::text AS first, MAX(date_posted)::text AS last FROM epass_tax_invoices`)).rows[0];
  const months = (await p.query(`SELECT to_char(date_posted, 'YYYY-MM') AS m, COUNT(*)::int AS n FROM epass_tax_invoices WHERE date_posted IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows;
  return { invoices: n.n, firstPosted: n.first, lastPosted: n.last, months: months.map((r) => ({ month: r.m, invoices: r.n })), lastReceivedAt: meta?.last_received_at ? new Date(meta.last_received_at).toISOString() : null, lastPulledAt: meta?.last_pulled_at || "", slices: meta?.slices || [] };
}

const mapRow = (r) => ({
  // Crystal's seven columns, in Crystal's order
  datePosted: dstr(r.date_posted), invoice: r.code, city: r.city, state: r.state, tax2Code: r.tax2_code, tax2: Number(r.tax2) || 0, gross: Number(r.gross) || 0,
  // the auditor's added requirement: ship-to and bill-to name, first and last kept apart (ePASS SoldTo = ship-to)
  shipFirst: r.ship_first || "", shipLast: r.ship_last || "", billFirst: r.bill_first || "", billLast: r.bill_last || "",
  shipName: [r.ship_first, r.ship_last].filter(Boolean).join(" "), billName: [r.bill_first, r.bill_last].filter(Boolean).join(" "),
  // and the rest
  type: r.inv_type, status: r.status, dateFinished: dstr(r.date_finished), customer: r.customer_name, customerCode: r.customer_code, zip: r.zip, billCity: r.bill_city, billState: r.bill_state, billZip: r.bill_zip,
  tax2Pct: r.tax2_pct == null ? null : Number(r.tax2_pct), tax3Pct: r.tax3_pct == null ? null : Number(r.tax3_pct), exempt: { tax1: !!r.tax1_exempt, tax2: !!r.tax2_exempt, tax3: !!r.tax3_exempt }, jurisdiction: r.jurisdiction,
  serial: Number(r.serial_total) || 0, item: Number(r.item_total) || 0, labor: Number(r.labor_total) || 0, misc: Number(r.misc_total) || 0, wty: Number(r.wty_total) || 0,
  tax1: Number(r.tax1) || 0, tax3: Number(r.tax3) || 0, taxTotal: r2((Number(r.tax1) || 0) + (Number(r.tax2) || 0) + (Number(r.tax3) || 0)),
  taxableBase: r.taxable_base == null ? null : Number(r.taxable_base), exemptBase: r.exempt_base == null ? null : Number(r.exempt_base), lines: Number(r.line_count) || 0,
  effectiveRate: Number(r.gross) ? r2(((Number(r.tax1) || 0) + (Number(r.tax2) || 0) + (Number(r.tax3) || 0)) / Number(r.gross) * 10000) / 100 : null,
  salesperson: r.salesperson, paymentType: r.payment_type, department: r.department
});

// The report: posted-date range, optional filters, rows + totals + by-city.
export async function taxReport({ from, to, type = "", city = "", state = "", taxCode = "", q = "", limit = 20000 } = {}) {
  const p = await pool();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ""))) throw new Error("Give a posted-date range (from / to).");
  const params = [from, to]; const where = [`date_posted >= $1`, `date_posted <= $2`];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (type) add(`inv_type = ?`, up(type));
  if (city) add(`city = ?`, up(city));
  if (state) add(`state = ?`, up(state).slice(0, 2));
  if (taxCode) add(`tax2_code = ?`, up(taxCode));
  if (q) add(`(code ILIKE ? OR customer_name ILIKE ? OR customer_code ILIKE ? OR bill_first ILIKE ? OR bill_last ILIKE ?)`.replace(/\?/g, () => `$${params.length + 1}`), `%${str(q, 60)}%`);
  const rows = (await p.query(`SELECT * FROM epass_tax_invoices WHERE ${where.join(" AND ")} ORDER BY date_posted, code LIMIT $${params.length + 1}`, [...params, Math.max(1, Math.min(100000, Number(limit) || 20000))])).rows.map(mapRow);
  const sum = (k) => r2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
  const totals = { invoices: rows.length, gross: sum("gross"), tax1: sum("tax1"), tax2: sum("tax2"), tax3: sum("tax3"), taxTotal: sum("taxTotal"), taxableBase: sum("taxableBase"), exemptBase: sum("exemptBase"), serial: sum("serial"), item: sum("item"), labor: sum("labor"), misc: sum("misc"), wty: sum("wty") };
  totals.effectiveRate = totals.gross ? r2(totals.taxTotal / totals.gross * 10000) / 100 : null;
  totals.rateOnTaxable = totals.taxableBase ? r2(totals.tax2 / totals.taxableBase * 10000) / 100 : null;
  const group = (key) => { const m = new Map(); for (const r of rows) { const k = r[key] || "(blank)"; const g = m.get(k) || { key: k, invoices: 0, gross: 0, taxableBase: 0, tax2: 0, taxTotal: 0 }; g.invoices++; g.gross += r.gross; g.taxableBase += r.taxableBase || 0; g.tax2 += r.tax2; g.taxTotal += r.taxTotal; m.set(k, g); } return [...m.values()].map((g) => ({ ...g, gross: r2(g.gross), taxableBase: r2(g.taxableBase), tax2: r2(g.tax2), taxTotal: r2(g.taxTotal) })).sort((a, b) => b.taxTotal - a.taxTotal || b.gross - a.gross); };
  const coverage = (await p.query(`SELECT to_char(date_posted, 'YYYY-MM') AS m, COUNT(*)::int AS n FROM epass_tax_invoices WHERE date_posted >= date_trunc('month', $1::date) AND date_posted <= $2 GROUP BY 1 ORDER BY 1`, [from, to])).rows;
  return { from, to, rows, totals, byCity: group("city"), byType: group("type"), byTaxCode: group("tax2Code"), coverage: coverage.map((r) => ({ month: r.m, invoices: r.n })) };
}
export async function taxInvoiceLines(code) {
  const p = await pool();
  const inv = (await p.query(`SELECT * FROM epass_tax_invoices WHERE code = $1`, [up(code)])).rows[0];
  if (!inv) return null;
  const lines = (await p.query(`SELECT * FROM epass_tax_lines WHERE code = $1 ORDER BY kind, id`, [up(code)])).rows.map((l) => ({ kind: l.kind, code: l.line_code, desc: l.description, qty: Number(l.qty) || 0, price: Number(l.price) || 0, total: Number(l.total) || 0, tax1: !!l.tax1, tax2: !!l.tax2, tax3: !!l.tax3, warranty: !!l.warranty }));
  return { ...mapRow(inv), lineItems: lines };
}
