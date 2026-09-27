import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// ePASS CASH OPS FEED (kind "epass-finance", 2026-09-26).
//
// ePASS is Wilson's book of record for AR and AP (Andrew 9/26), so the Cash
// Ops Projection reads the real ledgers instead of modeling them:
//
//   epass_ar_current        ARCurrent — open receivables (invoice / payment /
//                           adjustment rows per customer; net by invoice)
//   epass_ap_current        APCurrent — open payables (bills, payments, holds)
//   epass_ap_current_po     APCurrentPO / APTransactionPO — which POs a bill covers
//   epass_payments          InvoicePayment, last 13 months (type, date, amount —
//                           never a card column: the pull sends an explicit list)
//   epass_payment_types     PaymentType lookup (AR / COD / Finance flags)
//   epass_suppliers         Supplier terms columns
//   epass_po_open_lines     POModel lines still to receive (+ PO header, cost, ETA)
//   epass_po_received       POs received / costed in the last 120 days
//   epass_supplier_invoices POSupplierInvoice, last 120 days
//   epass_finance_meta      when, from where, how many
//
// Every run REPLACES the tables ("what is open right now"). Rows keep the raw
// record as JSONB plus the handful of typed columns the projection groups on.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS epass_ar_current (
  id BIGSERIAL PRIMARY KEY,
  customer_code TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  record_type TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_type TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_ap_current (
  id BIGSERIAL PRIMARY KEY,
  supplier_code TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  record_type TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  on_hold BOOLEAN NOT NULL DEFAULT FALSE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_ap_current_po (
  supplier_code TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  po_code TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'current',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_payments (
  id BIGSERIAL PRIMARY KEY,
  invoice TEXT NOT NULL DEFAULT '',
  bill_to TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  paid_on TEXT NOT NULL DEFAULT '',
  post_date TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS epass_payments_paid_on ON epass_payments (paid_on);
CREATE TABLE IF NOT EXISTS epass_payment_types (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  is_ar BOOLEAN NOT NULL DEFAULT FALSE,
  is_cod BOOLEAN NOT NULL DEFAULT FALSE,
  is_finance BOOLEAN NOT NULL DEFAULT FALSE,
  net_days INTEGER,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_suppliers (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  due_days INTEGER,
  due_date_terms TEXT NOT NULL DEFAULT '',
  discount_days INTEGER,
  discount_pct NUMERIC(8,3),
  floor_plan_days INTEGER,
  inventory_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  obsolete BOOLEAN NOT NULL DEFAULT FALSE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_po_open_lines (
  id BIGSERIAL PRIMARY KEY,
  po_code TEXT NOT NULL DEFAULT '',
  supplier_code TEXT NOT NULL DEFAULT '',
  model_code TEXT NOT NULL DEFAULT '',
  qty_open NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  eta TEXT NOT NULL DEFAULT '',
  date_ordered TEXT NOT NULL DEFAULT '',
  for_invoice TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE epass_po_open_lines ADD COLUMN IF NOT EXISTS unreleased BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE epass_po_open_lines ADD COLUMN IF NOT EXISTS rdd TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS epass_po_received (
  po_code TEXT PRIMARY KEY,
  supplier_code TEXT NOT NULL DEFAULT '',
  date_received TEXT NOT NULL DEFAULT '',
  date_costed TEXT NOT NULL DEFAULT '',
  total_received NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_costed NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_supplier_invoices (
  supplier_code TEXT NOT NULL DEFAULT '',
  supplier_invoice TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_ar_customers (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  credit_limit NUMERIC(14,2),
  credit_hold BOOLEAN NOT NULL DEFAULT FALSE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS epass_finance_meta (
  id INTEGER PRIMARY KEY,
  pulled_at TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT '',
  machine TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  counts JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- Supplier payment terms Wilson actually pays on (Andrew 9/26): invoices
-- batch at billing-close days, half is due ~30 days out on the next due day,
-- the balance net 60. One row per supplier code; '*' is the default template.
CREATE TABLE IF NOT EXISTS supplier_payment_terms (
  supplier_code TEXT PRIMARY KEY,
  close_days JSONB NOT NULL DEFAULT '[5,20]',
  due_days JSONB NOT NULL DEFAULT '[8,23]',
  installments JSONB NOT NULL DEFAULT '[{"pct":50,"days":30},{"pct":50,"days":60}]',
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
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
    const key = Object.keys(row).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (key != null && row[key] != null && row[key] !== "") return String(row[key]).trim();
  }
  return "";
};
const rowsOf = (bundle, name) => (Array.isArray(bundle?.datasets?.[name]) ? bundle.datasets[name] : []).filter((r) => r && typeof r === "object");
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const day = (v) => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return u ? `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}` : ""; };
const bool = (v) => /^(1|true|y|yes)$/i.test(String(v ?? "").trim());
const intOrNull = (v) => { const n = Number(String(v ?? "").trim()); return Number.isInteger(n) ? n : null; };

export function parseFinanceBundle(bufferOrText) {
  const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString("utf8") : String(bufferOrText || "");
  let bundle;
  try { bundle = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new Error("Not a JSON bundle from epass-odbc-pull.ps1."); }
  if (!bundle || typeof bundle !== "object" || !bundle.datasets) throw new Error("Bundle has no datasets.");
  return bundle;
}

export async function replaceEpassFinance(bundle, { filename = "" } = {}) {
  const pool = await getReadyPool();
  const ar = rowsOf(bundle, "ar-current"), ap = rowsOf(bundle, "ap-current"), apPo = rowsOf(bundle, "ap-current-po"), apTxPo = rowsOf(bundle, "ap-transaction-po");
  const payments = rowsOf(bundle, "payments"), types = rowsOf(bundle, "payment-types"), suppliers = rowsOf(bundle, "suppliers");
  const poOpen = rowsOf(bundle, "open-po-lines"), poRcv = rowsOf(bundle, "po-received"), supInv = rowsOf(bundle, "supplier-invoices"), customers = rowsOf(bundle, "ar-customers");
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query("BEGIN");
    // Datasets that failed on the pull side arrive empty: keep the previous rows.
    if (ar.length) {
      await client.query("DELETE FROM epass_ar_current");
      for (const r of ar) await client.query(`INSERT INTO epass_ar_current (customer_code, invoice, record_type, transaction_date, due_date, amount, payment_type, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [pick(r, "CustomerCode"), pick(r, "Invoice"), pick(r, "RecordType"), day(pick(r, "TransactionDate")), day(pick(r, "DueDate")), num(pick(r, "Amount")), pick(r, "PaymentTypeCode"), JSON.stringify(r)]);
    }
    if (ap.length) {
      await client.query("DELETE FROM epass_ap_current");
      for (const r of ap) await client.query(`INSERT INTO epass_ap_current (supplier_code, invoice, record_type, transaction_date, due_date, amount, on_hold, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [pick(r, "SupplierCode"), pick(r, "Invoice"), pick(r, "RecordType"), day(pick(r, "TransactionDate")), day(pick(r, "DueDate")), num(pick(r, "Amount")), bool(pick(r, "InvoiceHold")), JSON.stringify(r)]);
    }
    if (apPo.length || apTxPo.length) {
      await client.query("DELETE FROM epass_ap_current_po");
      for (const [src, rows] of [["current", apPo], ["transaction", apTxPo]]) for (const r of rows) await client.query(`INSERT INTO epass_ap_current_po (supplier_code, invoice, po_code, source, raw) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [pick(r, "SupplierCode"), pick(r, "Invoice"), pick(r, "POCode"), src, JSON.stringify(r)]);
    }
    if (payments.length) {
      await client.query("DELETE FROM epass_payments");
      for (const r of payments) await client.query(`INSERT INTO epass_payments (invoice, bill_to, payment_type, paid_on, post_date, amount, status, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [pick(r, "InvoiceCode"), pick(r, "BillToCode"), pick(r, "PaymentTypeCode"), day(pick(r, "DateStamp")), day(pick(r, "PostDate")), num(pick(r, "Amount")), pick(r, "Status") || pick(r, "AuthStatus"), JSON.stringify(r)]);
    }
    if (types.length) {
      await client.query("DELETE FROM epass_payment_types");
      for (const r of types) await client.query(`INSERT INTO epass_payment_types (code, description, is_ar, is_cod, is_finance, net_days, raw) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (code) DO NOTHING`,
        [pick(r, "Code"), pick(r, "Description"), bool(pick(r, "AR")), bool(pick(r, "COD")), bool(pick(r, "Finance")), intOrNull(pick(r, "NetDays")), JSON.stringify(r)]);
    }
    if (suppliers.length) {
      await client.query("DELETE FROM epass_suppliers");
      for (const r of suppliers) await client.query(`INSERT INTO epass_suppliers (code, description, due_days, due_date_terms, discount_days, discount_pct, floor_plan_days, inventory_supplier, obsolete, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (code) DO NOTHING`,
        [pick(r, "Code"), pick(r, "Description"), intOrNull(pick(r, "DueDays")), pick(r, "DueDateTerms"), intOrNull(pick(r, "DiscountDays")), num(pick(r, "DiscountPercentage")) || null, intOrNull(pick(r, "POFloorPlanDays")), bool(pick(r, "InventorySupplier")), bool(pick(r, "Obsolete")), JSON.stringify(r)]);
    }
    if (poOpen.length) {
      await client.query("DELETE FROM epass_po_open_lines");
      for (const r of poOpen) {
        const qtyOpen = Math.max(0, num(pick(r, "QtyOrdered")) - num(pick(r, "QtyReceived")));
        const unit = num(pick(r, "UnitCost")) || num(pick(r, "QuotedCost")) || num(pick(r, "StandardCost"));
        await client.query(`INSERT INTO epass_po_open_lines (po_code, supplier_code, model_code, qty_open, unit_cost, eta, date_ordered, for_invoice, unreleased, rdd, raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [pick(r, "POCode"), pick(r, "SupplierCode"), pick(r, "ModelCode"), qtyOpen, unit, day(pick(r, "ETADateMostUpdated") || pick(r, "ETADate") || pick(r, "RequestedDeliveryDate")), day(pick(r, "DateOrdered")), pick(r, "BackOrderInvoiceCode"), bool(pick(r, "Unreleased")), day(pick(r, "RequestedDeliveryDate") || pick(r, "PO_RequestedDeliveryDate")), JSON.stringify(r)]);
      }
    }
    if (poRcv.length) {
      await client.query("DELETE FROM epass_po_received");
      for (const r of poRcv) await client.query(`INSERT INTO epass_po_received (po_code, supplier_code, date_received, date_costed, total_received, total_costed, raw) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (po_code) DO NOTHING`,
        [pick(r, "Code"), pick(r, "SupplierCode"), day(pick(r, "DateReceived")), day(pick(r, "DateCosted")), num(pick(r, "TotalReceived")), num(pick(r, "TotalCosted")), JSON.stringify(r)]);
    }
    if (supInv.length) {
      await client.query("DELETE FROM epass_supplier_invoices");
      for (const r of supInv) await client.query(`INSERT INTO epass_supplier_invoices (supplier_code, supplier_invoice, invoice_date, raw) VALUES ($1,$2,$3,$4::jsonb)`,
        [pick(r, "SupplierCode"), pick(r, "SupplierInvoice"), day(pick(r, "InvoiceDate")), JSON.stringify(r)]);
    }
    if (customers.length) {
      await client.query("DELETE FROM epass_ar_customers");
      for (const r of customers) {
        const name = [pick(r, "LastName"), pick(r, "FirstName")].filter(Boolean).join(", ");
        await client.query(`INSERT INTO epass_ar_customers (code, name, account_type, payment_type, credit_limit, credit_hold, raw) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (code) DO NOTHING`,
          [pick(r, "Code"), name, pick(r, "AccountType"), pick(r, "PaymentTypeCode"), num(pick(r, "CreditLimit")) || null, bool(pick(r, "CreditHold")), JSON.stringify(r)]);
      }
    }
    Object.assign(counts, { customers: customers.length, ar: ar.length, ap: ap.length, apPo: apPo.length + apTxPo.length, payments: payments.length, paymentTypes: types.length, suppliers: suppliers.length, poOpenLines: poOpen.length, poReceived: poRcv.length, supplierInvoices: supInv.length });
    await client.query(`INSERT INTO epass_finance_meta (id, pulled_at, received_at, source, machine, filename, counts) VALUES (1, $1, NOW(), $2, $3, $4, $5::jsonb)
      ON CONFLICT (id) DO UPDATE SET pulled_at = EXCLUDED.pulled_at, received_at = NOW(), source = EXCLUDED.source, machine = EXCLUDED.machine, filename = EXCLUDED.filename, counts = EXCLUDED.counts`,
      [String(bundle.pulledAt || ""), String(bundle.source || ""), String(bundle.machine || ""), String(filename || "").slice(0, 200), JSON.stringify(counts)]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; }
  finally { client.release(); }
  return counts;
}

export async function getEpassFinanceMeta() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM epass_finance_meta WHERE id = 1`);
  const m = r.rows[0];
  return m ? { pulledAt: m.pulled_at, receivedAt: m.received_at?.toISOString?.() || null, source: m.source, machine: m.machine, filename: m.filename, counts: m.counts || {} } : null;
}

// Everything the projection needs, in one read.
export async function financeRows() {
  const pool = await getReadyPool();
  const q = (sql) => pool.query(sql).then((r) => r.rows).catch(() => []);
  const [ar, ap, apPo, payments, types, suppliers, poOpen, poRcv, terms, meta, customers] = await Promise.all([
    q(`SELECT customer_code, invoice, record_type, transaction_date, due_date, amount::float AS amount, payment_type, raw FROM epass_ar_current`),
    q(`SELECT supplier_code, invoice, record_type, transaction_date, due_date, amount::float AS amount, on_hold, raw FROM epass_ap_current`),
    q(`SELECT supplier_code, invoice, po_code, source FROM epass_ap_current_po`),
    q(`SELECT invoice, bill_to, payment_type, paid_on, post_date, amount::float AS amount, status FROM epass_payments`),
    q(`SELECT code, description, is_ar, is_cod, is_finance, net_days FROM epass_payment_types`),
    q(`SELECT code, description, due_days, due_date_terms, discount_days, discount_pct::float AS discount_pct, floor_plan_days, inventory_supplier, obsolete FROM epass_suppliers`),
    q(`SELECT po_code, supplier_code, model_code, qty_open::float AS qty_open, unit_cost::float AS unit_cost, eta, date_ordered, for_invoice, unreleased, rdd, raw FROM epass_po_open_lines`),
    q(`SELECT po_code, supplier_code, date_received, date_costed, total_received::float AS total_received, total_costed::float AS total_costed, raw FROM epass_po_received`),
    q(`SELECT supplier_code, close_days, due_days, installments, note, updated_by, updated_at FROM supplier_payment_terms`),
    getEpassFinanceMeta().catch(() => null),
    q(`SELECT code, name, account_type, payment_type, credit_limit::float AS credit_limit, credit_hold FROM epass_ar_customers`)
  ]);
  return { ar, ap, apPo, payments, paymentTypes: types, suppliers, poOpen, poReceived: poRcv, terms, meta, customers };
}

// ---- supplier payment terms ------------------------------------------------
const cleanDayList = (v, fallback) => { const l = [...new Set((Array.isArray(v) ? v : String(v || "").split(/[,\s]+/)).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b); return l.length ? l : fallback; };
const cleanInstallments = (v) => {
  const list = (Array.isArray(v) ? v : []).map((i) => ({ pct: Math.round(Number(i?.pct) * 100) / 100, days: Math.round(Number(i?.days)) })).filter((i) => i.pct > 0 && i.pct <= 100 && Number.isInteger(i.days) && i.days >= 0 && i.days <= 365);
  const total = list.reduce((s, i) => s + i.pct, 0);
  if (!list.length || Math.abs(total - 100) > 0.01) throw new Error("Installments must add up to 100%.");
  return list;
};
export async function listSupplierTerms() {
  const pool = await getReadyPool();
  return (await pool.query(`SELECT * FROM supplier_payment_terms ORDER BY (supplier_code = '*') DESC, supplier_code`)).rows.map((r) => ({
    supplierCode: r.supplier_code, closeDays: r.close_days, dueDays: r.due_days, installments: r.installments, note: r.note || "", updatedBy: r.updated_by || "", updatedAt: r.updated_at?.toISOString?.() || null
  }));
}
export async function saveSupplierTerms({ supplierCode, closeDays, dueDays, installments, note = "", byEmail = "" }) {
  const code = String(supplierCode || "").trim().toUpperCase().slice(0, 40) || "*";
  const pool = await getReadyPool();
  const row = [code, JSON.stringify(cleanDayList(closeDays, [5, 20])), JSON.stringify(cleanDayList(dueDays, [8, 23])), JSON.stringify(cleanInstallments(installments)), String(note || "").slice(0, 200), String(byEmail || "").toLowerCase().slice(0, 200)];
  await pool.query(`INSERT INTO supplier_payment_terms (supplier_code, close_days, due_days, installments, note, updated_by, updated_at) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,NOW())
    ON CONFLICT (supplier_code) DO UPDATE SET close_days = EXCLUDED.close_days, due_days = EXCLUDED.due_days, installments = EXCLUDED.installments, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, row);
  return listSupplierTerms();
}
export async function deleteSupplierTerms(supplierCode) {
  const code = String(supplierCode || "").trim().toUpperCase();
  if (!code || code === "*") throw new Error("The default template can be edited but not removed.");
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM supplier_payment_terms WHERE supplier_code = $1`, [code]);
  return listSupplierTerms();
}
