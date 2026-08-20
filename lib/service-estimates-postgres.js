import crypto from "crypto";
import zlib from "zlib";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Service Estimate Approvals (service-estimates.html + public estimate.html)
// — the Podium-replacement flow. Client Care scans the ePASS service quote
// PDF (SV…), the parser builds a parts/labor/tax summary, and the client
// gets a link to either APPROVE the estimate or SHOP FOR A REPLACEMENT
// (with product-direction + visit preferences). A shopping response fires
// the showroom-lead notification (same routing as new web orders).
// ---------------------------------------------------------------------------

const SERVICE_ESTIMATES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS service_estimates (
  id BIGSERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  sv_number TEXT NOT NULL DEFAULT '',
  estimate_name TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_number TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'sent',
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sve_status ON service_estimates (status);
CREATE INDEX IF NOT EXISTS idx_sve_created ON service_estimates (created_at);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SERVICE_ESTIMATES_SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

// ---------------------------------------------------------------------------
// PDF text extraction — the ePASS invoice/quote PDFs are simple PDF 1.2
// files with FlateDecode content streams and plain (Td/Tm + Tj) text
// operators, so a purpose-built scanner beats adding a PDF dependency.
// Each content stream is one page; text items carry (x, y) so rows can be
// reconstructed by y-band and read left → right.
// ---------------------------------------------------------------------------
function pdfTextRows(buffer) {
  const pages = [];
  let idx = 0;
  while (true) {
    const s = buffer.indexOf("stream", idx);
    if (s < 0) break;
    let start = s + 6;
    if (buffer[start] === 0x0d) start++;
    if (buffer[start] === 0x0a) start++;
    const e = buffer.indexOf("endstream", start);
    if (e < 0) break;
    let text = null;
    try {
      text = zlib.inflateSync(buffer.slice(start, e)).toString("latin1");
    } catch {
      text = buffer.slice(start, e).toString("latin1");
    }
    if (text && /\bTj\b/.test(text)) pages.push(text);
    idx = e + 9;
  }

  const rows = [];
  for (let p = 0; p < pages.length; p++) {
    const items = [];
    let x = 0, y = 0;
    const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+(?:Td|TD)|(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let m;
    while ((m = re.exec(pages[p]))) {
      if (m[1] !== undefined && m[8] === undefined && m[7] === undefined) {
        x += Number(m[1]); y += Number(m[2]);
      } else if (m[7] !== undefined && m[8] !== undefined) {
        x = Number(m[7]); y = Number(m[8]);
      } else if (m[9] !== undefined) {
        const t = m[9].replace(/\\([()\\])/g, "$1").replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
        if (t.trim()) items.push({ x, y, t });
      }
    }
    // Band items into rows by y (row height in these files is ~230 units).
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let band = null;
    for (const item of items) {
      if (!band || Math.abs(band.y - item.y) > 90) {
        band = { page: p, y: item.y, cells: [] };
        rows.push(band);
      }
      band.cells.push(item);
    }
  }
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}

const moneyOf = (s) => {
  const m = String(s).trim().replace(/,/g, "").match(/^-?\d+(?:\.\d{1,2})?$/);
  return m ? Math.round(Number(m[0]) * 100) / 100 : null;
};

// Parse the ePASS service quote/invoice PDF into the client-facing summary.
export function extractServiceEstimateFromPdf(buffer) {
  const rows = pdfTextRows(buffer);
  if (!rows.length) {
    const err = new Error("Couldn't read any text from that PDF — is it the ePASS invoice print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }

  const flat = rows.map((r) => ({ ...r, text: r.cells.map((c) => c.t.trim()).join(" · ") }));
  const warnings = [];
  const out = {
    svNumber: "", date: "", customerName: "", customerNumber: "", salesperson: "",
    parts: [], laborTotal: 0, laborEntries: 0, shippingTotal: 0,
    subTotal: null, tax: null, invoiceTotal: null, deposits: null, balance: null,
    warnings
  };

  // Header fields (page 1)
  for (const r of flat) {
    for (const c of r.cells) {
      const t = c.t.trim();
      if (!out.svNumber && /^[A-Z]{1,3}\d{6,}$/.test(t) && t.startsWith("SV")) out.svNumber = t;
      if (!out.date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) out.date = t;
    }
  }
  // Bill-To block: first text cell at the Bill To x-column below the header.
  const billTo = rows.find((r) => r.page === 0 && r.cells.some((c) => c.x > 1000 && c.x < 2200 && /[A-Za-z]/.test(c.t) && c.y < 12400 && c.y > 12000));
  if (billTo) out.customerName = billTo.cells.find((c) => c.x > 1000 && c.x < 2200)?.t.trim() || "";
  for (const r of flat) {
    const custIdx = r.cells.findIndex((c) => /^\d{10}$/.test(c.t.trim()) && c.x < 2000);
    if (custIdx >= 0 && !out.customerNumber) out.customerNumber = r.cells[custIdx].t.trim();
  }
  const spRow = rows.find((r) => r.cells.some((c) => c.t.trim() === "SERVICE"));
  if (spRow) {
    const sp = spRow.cells.find((c) => c.x > 6000 && c.x < 9500 && /[A-Za-z] [A-Za-z]/.test(c.t));
    if (sp) out.salesperson = sp.t.trim();
  }

  // Line items: any row whose last two cells are money (PRICE, EXT PRICE)
  // in the item table's x-range. Classify Labor / Shipping & Handling /
  // parts; indented sub-description rows have no money and are skipped.
  for (const r of rows) {
    const cells = r.cells;
    if (cells.length < 2) continue;
    const last = cells[cells.length - 1];
    const prev = cells[cells.length - 2];
    const ext = moneyOf(last.t);
    const price = moneyOf(prev.t);
    if (ext == null || price == null) continue;
    if (last.x < 9500) continue; // totals block handled separately
    const label = cells.slice(0, cells.length - 2).map((c) => c.t.trim()).filter(Boolean);
    const joined = label.join(" ");
    if (!joined) continue;
    if (/^labor\b/i.test(joined)) {
      out.laborTotal = Math.round((out.laborTotal + ext) * 100) / 100;
      out.laborEntries++;
    } else if (/shipping\s*&?\s*handling/i.test(joined)) {
      out.shippingTotal = Math.round((out.shippingTotal + ext) * 100) / 100;
    } else {
      // "1 · 7006964 · DRIER,SVCE" → qty, model, description
      const qty = /^\d+$/.test(label[0]) ? Number(label[0]) : 1;
      const rest = /^\d+$/.test(label[0]) ? label.slice(1) : label;
      const model = rest.length > 1 ? rest[0] : "";
      const description = (rest.length > 1 ? rest.slice(1) : rest).join(" ");
      out.parts.push({ qty, model, description, ext });
    }
  }

  // Totals block (authoritative)
  for (const r of flat) {
    const cellText = r.cells.map((c) => c.t.trim());
    const amount = moneyOf(cellText[cellText.length - 1]);
    if (amount == null) continue;
    const labelText = cellText.slice(0, -1).join(" ").toUpperCase();
    if (/SUB\s*TOTAL/.test(labelText)) out.subTotal = amount;
    else if (/INVOICE\s*TOTAL/.test(labelText)) out.invoiceTotal = amount;
    else if (/\bTAX\b/.test(labelText)) out.tax = amount;
    else if (/DEPOSITS/.test(labelText)) out.deposits = amount;
    else if (/BALANCE/.test(labelText)) out.balance = amount;
  }

  if (!out.svNumber) warnings.push("Couldn't find the SV invoice number.");
  if (out.invoiceTotal == null) warnings.push("Couldn't find the invoice total.");
  const partsTotal = Math.round(out.parts.reduce((s, p) => s + p.ext, 0) * 100) / 100;
  out.partsTotal = partsTotal;
  if (out.subTotal != null) {
    const sum = Math.round((partsTotal + out.laborTotal + out.shippingTotal) * 100) / 100;
    if (Math.abs(sum - out.subTotal) > 0.02) {
      warnings.push(`Line items sum to $${sum.toFixed(2)} but the subtotal reads $${out.subTotal.toFixed(2)} — double-check the summary before sending.`);
    }
  }
  if (!out.parts.length && !out.laborEntries) {
    const err = new Error("No parts or labor lines found — is this the ePASS service quote print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
function mapEstimate(row) {
  return {
    id: Number(row.id),
    token: row.token,
    svNumber: row.sv_number,
    estimateName: row.estimate_name,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    summary: row.summary || {},
    status: row.status,
    response: row.response || {},
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at?.toISOString?.() || null,
    viewedAt: row.viewed_at?.toISOString?.() || null,
    respondedAt: row.responded_at?.toISOString?.() || null
  };
}

export async function createServiceEstimate({ svNumber, estimateName, customerName, customerNumber, contactPhone, contactEmail, summary, byEmail, byName }) {
  const pool = await getReadyPool();
  const token = crypto.randomBytes(18).toString("base64url");
  const result = await pool.query(
    `INSERT INTO service_estimates
       (token, sv_number, estimate_name, customer_name, customer_number, contact_phone, contact_email, summary, created_by_email, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     RETURNING *`,
    [
      token,
      String(svNumber || "").toUpperCase().slice(0, 30),
      String(estimateName || "").slice(0, 120),
      String(customerName || "").slice(0, 160),
      String(customerNumber || "").slice(0, 30),
      String(contactPhone || "").slice(0, 40),
      String(contactEmail || "").trim().toLowerCase().slice(0, 200),
      JSON.stringify(summary || {}),
      String(byEmail || "").toLowerCase().slice(0, 200),
      String(byName || "").slice(0, 160)
    ]
  );
  return mapEstimate(result.rows[0]);
}

export async function listServiceEstimates() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM service_estimates ORDER BY created_at DESC LIMIT 300`);
  return result.rows.map(mapEstimate);
}

export async function getServiceEstimateByToken(token) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM service_estimates WHERE token = $1`, [String(token || "")]);
  return result.rows[0] ? mapEstimate(result.rows[0]) : null;
}

export async function markServiceEstimateViewed(token) {
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE service_estimates SET status = 'viewed', viewed_at = COALESCE(viewed_at, NOW())
     WHERE token = $1 AND status = 'sent'`,
    [String(token || "")]
  );
}

// First response wins — a link can't flip from approved to shopping later.
export async function saveServiceEstimateResponse(token, { choice, productDirection = "", visit = "", notes = "" }) {
  const pool = await getReadyPool();
  const status = choice === "approve" ? "approved" : "shopping";
  const response = choice === "approve"
    ? { choice: "approve" }
    : {
        choice: "shop",
        productDirection: String(productDirection || "").slice(0, 40),
        visit: String(visit || "").slice(0, 40),
        notes: String(notes || "").trim().slice(0, 1000)
      };
  const result = await pool.query(
    `UPDATE service_estimates
     SET status = $2, response = $3::jsonb, responded_at = NOW(), viewed_at = COALESCE(viewed_at, NOW())
     WHERE token = $1 AND status IN ('sent', 'viewed')
     RETURNING *`,
    [String(token || ""), status, JSON.stringify(response)]
  );
  return result.rows[0] ? mapEstimate(result.rows[0]) : null;
}
