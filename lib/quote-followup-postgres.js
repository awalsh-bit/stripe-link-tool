import { getPostgresPool } from "./data-postgres.js";
import { toDateStr } from "./salesperson-activity.js";
import { listSalespersonNames } from "./sales-order-detail-postgres.js";

// ---------------------------------------------------------------------------
// Quote Follow-Up (quote-follow-up.html) — the ePASS Invoice Maintenance
// quote export (Inv Type Q / Status Open) uploaded here, matched against the
// OE-23 sales_order_detail warehouse to find conversions, and grouped into
// per-customer opportunities each salesperson works down.
//
//   quote_followup_quotes — one row per quote number, upserted by upload.
//   An upload REPLACES the open set: every quote absent from the newest file
//   flips is_open = false (it closed in ePASS).
//
//   quote_followup_dispositions — what a salesperson decided about a quote:
//   missing_conversion (they typed the sales order number), followup (moved
//   to the follow-up queue), or lost (with an optional comment). Survives
//   re-uploads; keyed by quote number so a whole opportunity card can be
//   dispositioned in one action across its quote numbers.
//
// Conversion rule (Andrew, 2026-08-17): an OE-23 order with the SAME customer
// number AND the SAME salesperson code, finished on/after the quote date,
// converts the quote. A customer-only match by a different salesperson does
// NOT convert — it surfaces as a "converted by <other SP>" note instead.
// ---------------------------------------------------------------------------

const QUOTE_FOLLOWUP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS quote_followup_quotes (
  quote_number TEXT PRIMARY KEY,
  sp_code TEXT NOT NULL DEFAULT '',
  date_created TEXT NOT NULL DEFAULT '',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  job_status TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_filename TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_qfq_sp ON quote_followup_quotes (sp_code);
CREATE INDEX IF NOT EXISTS idx_qfq_customer ON quote_followup_quotes (customer_number);
CREATE INDEX IF NOT EXISTS idx_qfq_open ON quote_followup_quotes (is_open);

CREATE TABLE IF NOT EXISTS quote_followup_uploads (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quote_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quote_followup_dispositions (
  quote_number TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '',
  sales_order_number TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service client leads ride this board too (Andrew, 2026-08-27): a lead is
-- an opportunity regardless of whether ePASS ever cut a quote for it.
ALTER TABLE quote_followup_quotes ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'epass';
ALTER TABLE quote_followup_quotes ADD COLUMN IF NOT EXISTS lead_token TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_qfq_lead_token ON quote_followup_quotes (lead_token);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(QUOTE_FOLLOWUP_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function text(value) {
  if (value == null) return "";
  return String(value).replace(/[\s ]+/g, " ").trim();
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// ---------------------------------------------------------------------------
// Parser — the Invoice Maintenance export ("ExportInvoice_*.xlsx"). Row 1 is
// the report title, the header row carries "Inv Type" / "Invoice #" / etc.
// Columns are located by header name so ePASS column reordering can't break
// the upload. Only Inv Type Q rows are kept (the export is quote-filtered,
// but a wider export shouldn't poison the table).
// ---------------------------------------------------------------------------
export function parseInvoiceMaintenanceQuotes(grid) {
  if (!Array.isArray(grid)) return { quotes: [], warnings: ["Empty workbook."] };

  let headerIdx = -1;
  let cols = null;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] || [];
    // ePASS stars whichever column the grid was sorted by when exporting
    // ("* Date Created" one day, "* Job Status" the next) — strip the
    // asterisk so the sort order can never change the column mapping.
    const names = row.map((c) => text(c).toLowerCase().replace(/^\*\s*/, ""));
    if (names.includes("inv type") && names.some((n) => n === "invoice #" || n === "invoice#")) {
      headerIdx = r;
      cols = {};
      for (let c = 0; c < names.length; c++) {
        if (names[c] && cols[names[c]] == null) cols[names[c]] = c;
      }
      break;
    }
  }
  if (headerIdx < 0) {
    return { quotes: [], warnings: [], notInvoiceMaintenance: true };
  }

  const col = (name) => (cols[name] != null ? cols[name] : -1);
  const iType = col("inv type");
  const iSp = col("sp");
  const iDate = col("date created");
  const iInv = col("invoice #") >= 0 ? col("invoice #") : col("invoice#");
  const iPay = col("payment type code");
  const iBalance = col("balance");
  const iTotal = col("total");
  const iStatus = col("status");
  const iJob = col("job status");
  const iCust = col("customer #") >= 0 ? col("customer #") : col("customer#");
  const iName = col("name");
  const iAddr = col("address");
  const iZip = col("zip code") >= 0 ? col("zip code") : col("zip");
  const iRef = col("reference");

  const warnings = [];
  const quotes = [];
  const seen = new Set();
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const invType = text(iType >= 0 ? row[iType] : "").toUpperCase();
    const quoteNumber = text(iInv >= 0 ? row[iInv] : "").toUpperCase();
    if (!quoteNumber) continue;
    if (invType && invType !== "Q") continue; // not a quote row
    const status = text(iStatus >= 0 ? row[iStatus] : "");
    if (status && status.toLowerCase() !== "open") continue; // export should be open-only
    if (seen.has(quoteNumber)) {
      warnings.push(`Duplicate quote ${quoteNumber} — kept the first row.`);
      continue;
    }
    seen.add(quoteNumber);
    quotes.push({
      quoteNumber,
      spCode: text(iSp >= 0 ? row[iSp] : "").toUpperCase(),
      dateCreated: toDateStr(iDate >= 0 ? row[iDate] : ""),
      total: money(iTotal >= 0 ? row[iTotal] : 0),
      balance: money(iBalance >= 0 ? row[iBalance] : 0),
      customerNumber: text(iCust >= 0 ? row[iCust] : ""),
      customerName: text(iName >= 0 ? row[iName] : ""),
      address: text(iAddr >= 0 ? row[iAddr] : ""),
      zip: text(iZip >= 0 ? row[iZip] : ""),
      jobStatus: text(iJob >= 0 ? row[iJob] : ""),
      paymentType: text(iPay >= 0 ? row[iPay] : ""),
      reference: text(iRef >= 0 ? row[iRef] : "")
    });
  }
  return { quotes, warnings };
}

// Upload replaces the open-quote set: everything currently open flips closed,
// then the file's quotes upsert back to open. Dispositions are untouched.
export async function replaceOpenQuotes(quotes, { filename, byEmail, byName }) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Only ePASS-sourced quotes close when they drop off the export —
    // service leads are not in the export and live until worked.
    await client.query(`UPDATE quote_followup_quotes SET is_open = FALSE WHERE is_open AND source = 'epass'`);
    for (const q of quotes) {
      await client.query(
        `INSERT INTO quote_followup_quotes (
           quote_number, sp_code, date_created, total, balance, customer_number, customer_name,
           address, zip, job_status, payment_type, reference, is_open, first_seen_at, last_seen_at, source_filename
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW(),NOW(),$13)
         ON CONFLICT (quote_number) DO UPDATE SET
           sp_code = EXCLUDED.sp_code,
           date_created = EXCLUDED.date_created,
           total = EXCLUDED.total,
           balance = EXCLUDED.balance,
           customer_number = EXCLUDED.customer_number,
           customer_name = EXCLUDED.customer_name,
           address = EXCLUDED.address,
           zip = EXCLUDED.zip,
           job_status = EXCLUDED.job_status,
           payment_type = EXCLUDED.payment_type,
           reference = EXCLUDED.reference,
           is_open = TRUE,
           last_seen_at = NOW(),
           source_filename = EXCLUDED.source_filename`,
        [
          q.quoteNumber, q.spCode, q.dateCreated, q.total, q.balance,
          q.customerNumber, q.customerName, q.address, q.zip,
          q.jobStatus, q.paymentType, q.reference,
          String(filename || "").slice(0, 300)
        ]
      );
    }
    await client.query(
      `INSERT INTO quote_followup_uploads (filename, uploaded_by, uploaded_by_name, quote_count)
       VALUES ($1, $2, $3, $4)`,
      [String(filename || "").slice(0, 300), String(byEmail || "").toLowerCase().slice(0, 200), String(byName || "").slice(0, 200), quotes.length]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return quotes.length;
}

// ---------------------------------------------------------------------------
// Service client leads → follow-up rows. Created when a client declines a
// repair to shop instead; the DIBS claim stamps the salesperson. Conversion
// for these rows is name-matched: ANY sales order for the same customer name
// finished within 30 days of the lead converts it (no sp requirement — the
// sale counts however it was written).
// ---------------------------------------------------------------------------
export function serviceLeadQuoteNumber(svNumber, token) {
  return `SVL-${String(svNumber || token || "").toUpperCase().slice(0, 24)}`;
}

export async function upsertServiceLeadQuote({ token, svNumber, customerName, phone, applianceText = "", estimateTotal = 0, dateCreated = "" }) {
  const pool = await getReadyPool();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateCreated) ? dateCreated : new Date().toISOString().slice(0, 10);
  const quoteNumber = serviceLeadQuoteNumber(svNumber, token);
  await pool.query(
    `INSERT INTO quote_followup_quotes (
       quote_number, sp_code, date_created, total, balance, customer_number, customer_name,
       address, zip, job_status, payment_type, reference, is_open, source, lead_token, source_filename
     ) VALUES ($1, '', $2, $3, 0, '', $4, $5, '', 'SERVICE LEAD', '', $6, TRUE, 'service_lead', $7, 'estimate-approvals')
     ON CONFLICT (quote_number) DO UPDATE SET
       customer_name = EXCLUDED.customer_name,
       total = EXCLUDED.total,
       reference = EXCLUDED.reference,
       address = EXCLUDED.address,
       is_open = TRUE,
       last_seen_at = NOW()`,
    [
      quoteNumber,
      day,
      money(estimateTotal),
      text(customerName).slice(0, 200),
      text(phone).slice(0, 40), // address column doubles as the contact number on lead rows
      text(applianceText ? `Replacing ${applianceText} — declined $${money(estimateTotal).toFixed(2)} repair` : `Declined repair ${svNumber || ""}`).slice(0, 300),
      String(token || "").slice(0, 60)
    ]
  );
  return quoteNumber;
}

// DIBS claim → the lead belongs to that salesperson's board column.
// Pass an empty code on unclaim to put it back in the unassigned pool.
// Open ePASS quotes already on file for a customer number — checked before
// a service lead fans out as DIBS, so a client who already has a quote goes
// to the rep who wrote it instead of the whole floor (Andrew, 2026-09-02).
export async function listOpenQuotesForCustomer(customerNumber) {
  const num = String(customerNumber || "").trim();
  if (!num) return [];
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT quote_number, sp_code, date_created, total, reference, customer_name
       FROM quote_followup_quotes
      WHERE is_open AND source = 'epass' AND customer_number = $1
      ORDER BY date_created DESC LIMIT 5`,
    [num]
  );
  return r.rows.map((row) => ({
    quoteNumber: row.quote_number, spCode: row.sp_code || "", dateCreated: row.date_created || "",
    total: Number(row.total) || 0, reference: row.reference || "", customerName: row.customer_name || ""
  }));
}

export async function setServiceLeadQuoteOwner(token, spCode) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `UPDATE quote_followup_quotes SET sp_code = $2, last_seen_at = NOW()
     WHERE lead_token = $1 AND source = 'service_lead' RETURNING quote_number`,
    [String(token || "").slice(0, 60), String(spCode || "").toUpperCase().slice(0, 10)]
  );
  return r.rows.length > 0;
}

// no_followup = the team's "they purchased anyway" flag for auto-lost
// QUOTE 2s: counts as a converted sale (no order number), never as lost.
const DISPOSITION_STATUSES = new Set(["missing_conversion", "followup", "lost", "no_followup"]);

// One action per opportunity card — every quote number on the card gets the
// same disposition. "reopen" clears them back to the working queue.
export async function saveQuoteDisposition({ quoteNumbers, action, salesOrderNumber = "", comment = "", byEmail = "", byName = "" }) {
  const pool = await getReadyPool();
  const numbers = (Array.isArray(quoteNumbers) ? quoteNumbers : [quoteNumbers])
    .map((n) => text(n).toUpperCase()).filter(Boolean);
  if (!numbers.length) throw new Error("No quote numbers provided.");

  if (action === "reopen") {
    await pool.query(`DELETE FROM quote_followup_dispositions WHERE quote_number = ANY($1)`, [numbers]);
    return { cleared: numbers.length };
  }
  if (!DISPOSITION_STATUSES.has(action)) throw new Error("Unknown action.");
  const so = text(salesOrderNumber).toUpperCase().slice(0, 40);
  if (action === "missing_conversion" && !so) {
    throw new Error("Enter the sales order number the quote converted to.");
  }

  for (const n of numbers) {
    await pool.query(
      `INSERT INTO quote_followup_dispositions (quote_number, status, sales_order_number, comment, by_email, by_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (quote_number) DO UPDATE SET
         status = EXCLUDED.status,
         sales_order_number = EXCLUDED.sales_order_number,
         comment = EXCLUDED.comment,
         by_email = EXCLUDED.by_email,
         by_name = EXCLUDED.by_name,
         updated_at = NOW()`,
      [
        n, action,
        action === "missing_conversion" ? so : "",
        action === "lost" ? text(comment).slice(0, 500) : "",
        String(byEmail || "").toLowerCase().slice(0, 200),
        String(byName || "").slice(0, 200)
      ]
    );
  }
  return { saved: numbers.length };
}

// Ownership guard for non-executives: which of these quotes belong to spCode?
export async function listQuoteOwners(quoteNumbers) {
  const pool = await getReadyPool();
  const numbers = (Array.isArray(quoteNumbers) ? quoteNumbers : [quoteNumbers])
    .map((n) => text(n).toUpperCase()).filter(Boolean);
  if (!numbers.length) return {};
  const r = await pool.query(
    `SELECT quote_number, sp_code FROM quote_followup_quotes WHERE quote_number = ANY($1)`,
    [numbers]
  );
  const owners = {};
  for (const row of r.rows) owners[row.quote_number] = row.sp_code;
  return owners;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d)) return dateStr;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Quotes for the same customer created within 30 days of the opportunity's
// first quote share one card (Andrew: "key the open, non-converted quotes
// into groups based on customer number and quotes created within 30 days").
function groupQuotes(quotes) {
  const byCustomer = new Map();
  for (const q of quotes) {
    const key = `${q.spCode}|${q.customerNumber || q.quoteNumber}`;
    if (!byCustomer.has(key)) byCustomer.set(key, []);
    byCustomer.get(key).push(q);
  }
  const groups = [];
  for (const [, list] of byCustomer) {
    list.sort((a, b) => (a.dateCreated < b.dateCreated ? -1 : a.dateCreated > b.dateCreated ? 1 : 0));
    let current = null;
    for (const q of list) {
      if (!current || (q.dateCreated && q.dateCreated > addDays(current.firstDate, 30))) {
        current = { firstDate: q.dateCreated, quotes: [] };
        groups.push(current);
      }
      current.quotes.push(q);
    }
  }
  return groups.map((g) => {
    const first = g.quotes[0];
    return {
      key: `${first.spCode}|${first.customerNumber}|${g.firstDate}`,
      spCode: first.spCode,
      customerNumber: first.customerNumber,
      customerName: first.customerName,
      address: first.address,
      zip: first.zip,
      firstDate: g.firstDate,
      lastDate: g.quotes[g.quotes.length - 1].dateCreated,
      total: Math.round(g.quotes.reduce((s, q) => s + q.total, 0) * 100) / 100,
      source: g.quotes.some((q) => q.source === "service_lead") ? "service_lead" : "epass",
      leadNote: g.quotes.map((q) => (q.source === "service_lead" ? q.reference : "")).find(Boolean) || "",
      quotes: g.quotes,
      otherSpConversion: g.quotes.map((q) => q.otherSpConversion).find(Boolean) || null,
      followupBy: g.quotes.map((q) => q.dispositionBy).find(Boolean) || "",
      followupAt: g.quotes.map((q) => q.dispositionAt).find(Boolean) || null
    };
  }).sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

// This is a SALES tool (Andrew, 2026-08-18): only salespeople whose employee
// directory job title is one of these appear — service techs, designers, and
// house codes are omitted. Matching is by title label (renames migrate the
// directory rows, so labels stay consistent). If NOBODY in the directory
// holds these titles yet, the filter stands down rather than blanking the
// board for everyone.
export const QUOTE_SALES_TITLES = ["Showroom Consultant", "Field Sales Consultant"];

export async function getQuoteSalesCodes() {
  const pool = await getReadyPool();
  try {
    const r = await pool.query(
      `SELECT DISTINCT upper(trim(code)) AS code
       FROM employee_directory
       WHERE trim(code) <> ''
         AND archived = FALSE
         AND LOWER(trim(commission_plan)) = ANY($1)`,
      [QUOTE_SALES_TITLES.map((t) => t.toLowerCase())]
    );
    const codes = r.rows.map((row) => row.code);
    return { codes, active: codes.length > 0 };
  } catch {
    // employee_directory not created yet — nothing to filter against.
    return { codes: [], active: false };
  }
}

const isValidDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// The whole board in one shot: working queue + follow-up queue as grouped
// opportunity cards, converted (auto via OE-23 match, or manual with the
// typed sales order number) and lost as flat lists, plus the per-salesperson
// 5-bucket scoreboard. QUOTE 2s never require work: an OE-23 match converts
// them, no match auto-loses them. from/to bound the quote-created date.
export async function getQuoteFollowupBoard({ spCode = null, from = "", to = "" } = {}) {
  const pool = await getReadyPool();
  // listSalespersonNames touches the OE-23 warehouse first so a fresh
  // environment has sales_order_detail before the LATERAL join below.
  const spNames = await listSalespersonNames().catch(() => ({}));
  const sales = await getQuoteSalesCodes();
  const fromDay = isValidDay(from) ? from : "";
  const toDay = isValidDay(to) ? to : "";

  const result = await pool.query(
    `SELECT q.*,
            d.status AS disp_status, d.sales_order_number AS disp_so, d.comment AS disp_comment,
            d.by_name AS disp_by, d.updated_at AS disp_at,
            conv.invoice AS conv_invoice, conv.finish_date AS conv_finish, conv.revenue AS conv_revenue,
            other.salesperson_code AS other_sp, other.invoice AS other_invoice, other.finish_date AS other_finish
     FROM quote_followup_quotes q
     LEFT JOIN quote_followup_dispositions d ON d.quote_number = q.quote_number
     LEFT JOIN LATERAL (
       SELECT o.invoice, o.finish_date, o.revenue
       FROM sales_order_detail o
       WHERE CASE
         -- ePASS quotes: same customer number + same salesperson, on/after quote date.
         WHEN q.source <> 'service_lead' THEN
           q.customer_number <> ''
           AND o.customer_number = q.customer_number
           AND o.salesperson_code = q.sp_code
           AND o.finish_date >= q.date_created
         -- Service leads: ANY order for the same customer NAME within 30 days.
         ELSE
           q.customer_name <> ''
           AND upper(trim(o.customer_name)) = upper(trim(q.customer_name))
           AND o.finish_date >= q.date_created
           AND o.finish_date <= to_char(q.date_created::date + INTERVAL '30 days', 'YYYY-MM-DD')
       END
       ORDER BY o.finish_date, o.invoice
       LIMIT 1
     ) conv ON TRUE
     LEFT JOIN LATERAL (
       SELECT o.invoice, o.finish_date, o.salesperson_code
       FROM sales_order_detail o
       WHERE q.source <> 'service_lead'
         AND q.customer_number <> ''
         AND o.customer_number = q.customer_number
         AND o.salesperson_code <> q.sp_code
         AND o.salesperson_code <> ''
         AND o.finish_date >= q.date_created
       ORDER BY o.finish_date, o.invoice
       LIMIT 1
     ) other ON TRUE
     WHERE ($1::text IS NULL OR q.sp_code = $1)
       AND ($2::boolean IS FALSE OR q.sp_code = ANY($3)
            OR (q.source = 'service_lead' AND q.sp_code = ''))
       AND ($4::text = '' OR q.date_created >= $4)
       AND ($5::text = '' OR q.date_created <= $5)
       AND (q.is_open OR d.status IS NOT NULL OR upper(trim(q.job_status)) = 'QUOTE 2')`,
    [spCode ? String(spCode).toUpperCase() : null, sales.active, sales.codes, fromDay, toDay]
  );

  const queueQuotes = [];
  const followupQuotes = [];
  const converted = [];
  const lost = [];
  let closedUnmatched = 0;

  for (const row of result.rows) {
    const quote = {
      quoteNumber: row.quote_number,
      spCode: row.sp_code,
      dateCreated: row.date_created,
      total: Number(row.total),
      customerNumber: row.customer_number,
      customerName: row.customer_name,
      address: row.address,
      zip: row.zip,
      jobStatus: row.job_status,
      isOpen: row.is_open,
      source: row.source || "epass",
      reference: row.reference || "",
      otherSpConversion: row.other_sp ? { spCode: row.other_sp, invoice: row.other_invoice, finishDate: row.other_finish } : null,
      dispositionBy: row.disp_by || "",
      dispositionAt: row.disp_at?.toISOString?.() || null
    };
    const isQuote2 = String(row.job_status || "").trim().toUpperCase() === "QUOTE 2";
    if (row.disp_status === "lost") {
      lost.push({ ...quote, how: "manual", comment: row.disp_comment || "", by: row.disp_by || "", at: quote.dispositionAt });
    } else if (row.disp_status === "missing_conversion") {
      converted.push({ ...quote, how: "manual", orderNumber: row.disp_so || "", by: row.disp_by || "", at: quote.dispositionAt });
    } else if (row.disp_status === "no_followup") {
      converted.push({ ...quote, how: "flagged", orderNumber: "", by: row.disp_by || "", at: quote.dispositionAt });
    } else if (row.conv_invoice) {
      converted.push({ ...quote, how: "auto", orderNumber: row.conv_invoice, orderDate: row.conv_finish, orderRevenue: Number(row.conv_revenue), supersededFollowup: row.disp_status === "followup" });
    } else if (isQuote2) {
      // QUOTE 2 with no matching sales order → lost by rule, no work required.
      lost.push({ ...quote, how: "auto", comment: "QUOTE 2 — closed without a sales order", by: "", at: null });
    } else if (row.disp_status === "followup") {
      followupQuotes.push(quote);
    } else if (row.is_open) {
      queueQuotes.push(quote);
    } else {
      closedUnmatched++;
    }
  }

  converted.sort((a, b) => ((a.orderDate || a.at || "") < (b.orderDate || b.at || "") ? 1 : -1));
  lost.sort((a, b) => ((a.at || a.dateCreated || "") < (b.at || b.dateCreated || "") ? 1 : -1));

  const queue = groupQuotes(queueQuotes);
  const followup = groupQuotes(followupQuotes);

  // ---- per-salesperson scoreboard (the pie) ----
  // Buckets 1–2 count ORDERS (direct R/S entries vs orders that closed a
  // quote); buckets 3–5 count OPPORTUNITIES from this board (working cards,
  // follow-up cards, lost quotes). All bounded by the same date range —
  // quotes by created date, orders by finish date.
  const statCodes = new Set();
  if (spCode) statCodes.add(String(spCode).toUpperCase());
  else if (sales.active) sales.codes.forEach((c) => statCodes.add(c));
  else result.rows.forEach((r) => r.sp_code && statCodes.add(r.sp_code));

  const stats = {};
  const bucket = (code) => (stats[code] ||= { code, name: spNames[code] || "", direct: 0, converted: 0, working: 0, followup: 0, lost: 0 });
  const convOrders = new Map(); // code -> Set of order invoices that closed a quote
  const flaggedCustomers = new Map(); // code -> Set of customers flagged "purchased — no follow-up"
  for (const c of converted) {
    if (c.how === "flagged") {
      const fset = flaggedCustomers.get(c.spCode) || new Set();
      fset.add(c.customerNumber || c.quoteNumber);
      flaggedCustomers.set(c.spCode, fset);
      continue;
    }
    const set = convOrders.get(c.spCode) || new Set();
    if (c.orderNumber) set.add(c.orderNumber);
    convOrders.set(c.spCode, set);
  }
  for (const [code, set] of convOrders) if (statCodes.has(code)) bucket(code).converted = set.size;
  for (const [code, fset] of flaggedCustomers) if (statCodes.has(code)) bucket(code).converted += fset.size;
  for (const g of queue) if (statCodes.has(g.spCode)) bucket(g.spCode).working++;
  for (const g of followup) if (statCodes.has(g.spCode)) bucket(g.spCode).followup++;
  for (const l of lost) if (statCodes.has(l.spCode)) bucket(l.spCode).lost++;

  if (statCodes.size) {
    try {
      const orders = await pool.query(
        `SELECT salesperson_code AS code, array_agg(invoice) AS invoices
         FROM sales_order_detail
         WHERE invoice ~ '^[RS][0-9]'
           AND salesperson_code = ANY($1)
           AND ($2::text = '' OR finish_date >= $2)
           AND ($3::text = '' OR finish_date <= $3)
         GROUP BY salesperson_code`,
        [[...statCodes], fromDay, toDay]
      );
      for (const row of orders.rows) {
        const closed = convOrders.get(row.code) || new Set();
        bucket(row.code).direct = row.invoices.filter((inv) => !closed.has(inv)).length;
      }
    } catch {
      // OE-23 warehouse missing — direct-sales bucket stays 0.
    }
  }
  // Close rate (Andrew, 2026-08-18): closed business (direct entries +
  // quote conversions) over total opportunities (all five buckets).
  const scoreboard = Object.values(stats)
    .filter((s) => s.direct + s.converted + s.working + s.followup + s.lost > 0)
    .map((s) => {
      const totalOpps = s.direct + s.converted + s.working + s.followup + s.lost;
      return { ...s, closeRate: totalOpps > 0 ? Math.round(((s.direct + s.converted) / totalOpps) * 1000) / 10 : null };
    })
    .sort((a, b) => (b.direct + b.converted) - (a.direct + a.converted) || a.code.localeCompare(b.code));

  const upload = await pool.query(
    `SELECT filename, uploaded_by_name, uploaded_at, quote_count
     FROM quote_followup_uploads ORDER BY id DESC LIMIT 1`
  );
  const u = upload.rows[0] || null;

  return {
    queue,
    followup,
    converted,
    lost,
    scoreboard,
    closedUnmatched,
    spNames,
    salesFilterActive: sales.active,
    salesCodes: sales.codes,
    range: { from: fromDay, to: toDay },
    lastUpload: u ? {
      filename: u.filename,
      byName: u.uploaded_by_name,
      at: u.uploaded_at?.toISOString?.() || null,
      quoteCount: Number(u.quote_count)
    } : null
  };
}

// ePASS Upload Center: when the quote export was last loaded.
export async function getLatestQuoteUploadMeta() {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT filename, uploaded_by_name, uploaded_at, quote_count
     FROM quote_followup_uploads ORDER BY id DESC LIMIT 1`
  );
  const u = r.rows[0];
  return u ? {
    filename: u.filename,
    byName: u.uploaded_by_name,
    uploadedAt: u.uploaded_at?.toISOString?.() || null,
    quoteCount: Number(u.quote_count)
  } : null;
}

// Exec filter dropdown: every salesperson code on an open or dispositioned
// quote, with open-queue counts.
export async function listQuoteSalespeople() {
  const pool = await getReadyPool();
  const spNames = await listSalespersonNames().catch(() => ({}));
  const sales = await getQuoteSalesCodes();
  const r = await pool.query(
    `SELECT q.sp_code, COUNT(*) FILTER (WHERE q.is_open AND d.quote_number IS NULL) AS open_count, COUNT(*) AS total
     FROM quote_followup_quotes q
     LEFT JOIN quote_followup_dispositions d ON d.quote_number = q.quote_number
     WHERE (q.is_open OR d.quote_number IS NOT NULL)
       AND ($1::boolean IS FALSE OR q.sp_code = ANY($2))
     GROUP BY q.sp_code
     ORDER BY open_count DESC, q.sp_code`,
    [sales.active, sales.codes]
  );
  return r.rows.map((row) => ({
    code: row.sp_code,
    name: spNames[row.sp_code] || "",
    openCount: Number(row.open_count),
    total: Number(row.total)
  }));
}
