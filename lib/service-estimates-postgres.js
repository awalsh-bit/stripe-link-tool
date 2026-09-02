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
ALTER TABLE service_estimates ADD COLUMN IF NOT EXISTS contact_pref TEXT NOT NULL DEFAULT '';
ALTER TABLE service_estimates ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;
ALTER TABLE service_estimates ADD COLUMN IF NOT EXISTS stale_flagged_at TIMESTAMPTZ;
ALTER TABLE service_estimates ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE service_estimates ADD COLUMN IF NOT EXISTS closed_by_email TEXT NOT NULL DEFAULT '';
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

// ePASS prints everything in CAPS; client-facing text reads better in proper
// case. Applied to names, brand/product, complaints, and part descriptions —
// never to model numbers, serials, or SV numbers. Words that already contain
// lowercase are left alone (except the Mc-name pattern, e.g. McNALLEN).
const CASE_KEEP = new Set(["AC", "HVAC", "GE", "LG", "TV", "DCS", "BTU", "KW", "OEM", "USA", "TX", "HP", "SS", "CU", "FT", "LH", "RH", "ID", "OD", "PC", "II", "III", "IV", "OK", "UV", "PVC", "RPM", "PSI", "CFM"]);
const CASE_BRANDS = {
  SUBZERO: "Sub-Zero", "SUB-ZERO": "Sub-Zero", KITCHENAID: "KitchenAid",
  JENNAIR: "JennAir", "JENN-AIR": "JennAir", ULINE: "U-Line", "U-LINE": "U-Line",
  SPEEDQUEEN: "Speed Queen", GE: "GE", LG: "LG"
};
export function properCase(text) {
  const fixWord = (w) => {
    if (!w) return w;
    if (/^Mc[A-Z]{2,}$/.test(w)) return "Mc" + w.charAt(2) + w.slice(3).toLowerCase();
    if (/[a-z]/.test(w)) return w;              // already mixed case — trust it
    if (CASE_BRANDS[w]) return CASE_BRANDS[w];
    if (CASE_KEEP.has(w)) return w;
    if (/\d/.test(w)) return w;                 // part refs, sizes ("EGX80HLC", "501")
    if (w.length <= 2 && !/[AEIOUY]/.test(w)) return w; // consonant acronyms
    return w.charAt(0) + w.slice(1).toLowerCase();
  };
  return String(text || "")
    .trim()
    .replace(/,(?=\S)/g, ", ")                  // "DRIER,SVCE" → "DRIER, SVCE"
    .split(/(\s+)/)
    .map((chunk) => (/\s/.test(chunk) || /\d/.test(chunk))
      ? chunk                                   // whitespace, or a part ref like "UC-15IP"
      : chunk.split(/([\/&\-'’"().,])/).map(fixWord).join(""))
    .join("");
}

// ePASS prints names as "LASTNAME, FIRST" — flip to "First Last" for
// client-facing use ("Kuhs, Glennette & Don" → "Glennette & Don Kuhs").
export function flipName(raw) {
  const s = String(raw || "").trim();
  const i = s.indexOf(",");
  if (i < 0) return properCase(s);
  const last = s.slice(0, i).trim();
  const rest = s.slice(i + 1).trim();
  return properCase(rest && last ? `${rest} ${last}` : (rest || last));
}

const PHONE_RE = /\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}/;
const normPhone = (s) => {
  const m = String(s || "").match(PHONE_RE);
  if (!m) return "";
  const d = m[0].replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : "";
};

// SV numbers on the prints: "SV00122934", or a sub-ticket "SV00122934-1"
// (a "dash one" — a follow-up visit on the same ticket). The PDF text layer
// sometimes lands the suffix in its own cell, so a bare number followed by
// a "-1" cell is stitched back together.
const SV_RE = /^SV\d{6,}(?:-\d{1,2})?$/;
function findSvNumber(rows) {
  for (const r of rows) {
    for (let i = 0; i < r.cells.length; i++) {
      const t = r.cells[i].t.trim();
      if (!SV_RE.test(t)) continue;
      const next = (r.cells[i + 1]?.t || "").trim();
      return !t.includes("-") && /^-\d{1,2}$/.test(next) ? t + next : t;
    }
  }
  return "";
}

// The Work Order print carries appliance + contact detail the plain invoice
// doesn't: Brand/Product/Model#/Serial#, the client's phone, and the
// Reference # field where the office notes CALL PREF / TEXT PREF.
function parseWorkOrderRows(rows) {
  const warnings = [];
  const out = {
    format: "workorder",
    svNumber: "", date: "", customerName: "", customerNumber: "", salesperson: "",
    phone: "", contactPref: "", reference: "",
    brand: "", product: "", model: "", serial: "", technician: "", complaint: "",
    parts: [], laborTotal: 0, laborEntries: 0, shippingTotal: 0,
    subTotal: null, tax: null, taxBase: null, invoiceTotal: null, deposits: null, balance: null,
    warnings
  };

  const cellAfter = (labelRe) => {
    for (const r of rows) {
      const i = r.cells.findIndex((c) => labelRe.test(c.t.trim()));
      if (i >= 0) {
        const next = r.cells[i + 1];
        if (next) return next.t.trim();
        // label and value sometimes land in one cell ("Reference #: CALL PREF")
        const inline = r.cells[i].t.trim().replace(labelRe, "").trim();
        if (inline) return inline;
      }
    }
    return "";
  };

  out.svNumber = findSvNumber(rows);
  out.date = (cellAfter(/^Date Ordered:$/) .match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [""])[0];
  out.reference = cellAfter(/^Reference #:/);
  if (/call\s*pref/i.test(out.reference)) out.contactPref = "call";
  else if (/te?xt\s*pref/i.test(out.reference)) out.contactPref = "text";
  else if (/e-?mail\s*pref/i.test(out.reference)) out.contactPref = "email";
  out.technician = properCase(cellAfter(/^Technician:$/));
  out.brand = properCase(cellAfter(/^Brand:$/));
  out.product = properCase(cellAfter(/^Product:$/));
  out.model = cellAfter(/^Model #:$/);
  out.serial = cellAfter(/^Serial #:$/);
  out.salesperson = out.technician;

  // Bill To name: first LASTNAME, FIRST style cell below a Bill To label.
  // Some prints leave page 1's values blank and carry them on page 2, so
  // check every Bill To block until a name turns up.
  const billToRows = rows.filter((r) => r.cells.some((c) => /^Bill To:$/.test(c.t.trim())));
  outer: for (const billToRow of billToRows) {
    const below = rows.filter((r) => r.page === billToRow.page && r.y < billToRow.y && r.y > billToRow.y - 700);
    for (const r of below) {
      const nameCell = r.cells.find((c) => c.x < 6000 && /^[A-Z][A-Za-z'".&\- ]+,\s*[A-Z]/.test(c.t.trim()));
      if (nameCell) { out.customerName = flipName(nameCell.t.trim()); break outer; }
    }
  }
  for (const svcAtRow of rows.filter((r) => r.cells.some((c) => /^Service At:$/.test(c.t.trim())))) {
    const num = svcAtRow.cells.find((c) => /^\d{10}$/.test(c.t.trim()));
    if (num) { out.customerNumber = num.t.trim(); break; }
  }
  // The client's phone row carries "Phone:" in BOTH the Bill To and
  // Service At columns; the store's own header phone (512-894-0907) is a
  // single label and is excluded regardless.
  const phoneRows = rows.filter((r) => r.cells.some((c) => /^Phone:$/.test(c.t.trim())) && r.cells.some((c) => PHONE_RE.test(c.t)));
  phoneRows.sort((a, b) => b.cells.filter((c) => /^Phone:$/.test(c.t.trim())).length - a.cells.filter((c) => /^Phone:$/.test(c.t.trim())).length);
  for (const r of phoneRows) {
    const p = normPhone(r.cells.map((c) => c.t).join(" "));
    if (p && p !== "512-894-0907") { out.phone = p; break; }
  }
  const complaintRow = rows.find((r) => r.cells.some((c) => /^Complaint:$/.test(c.t.trim())));
  if (complaintRow) {
    out.complaint = properCase(complaintRow.cells.filter((c) => !/^Complaint:$/.test(c.t.trim())).map((c) => c.t.trim()).join(" ").slice(0, 300));
  }

  // Line items + totals
  for (const r of rows) {
    let cells = [...r.cells];
    // trailing tax/backorder flag cells (*, *BO*, *= TAX Exempt)
    while (cells.length && /^\*|BO\*?$/.test(cells[cells.length - 1].t.trim()) && moneyOf(cells[cells.length - 1].t) == null) cells.pop();
    if (cells.length < 2) continue;
    const joinedAll = cells.map((c) => c.t.trim()).join(" ");
    const ext = moneyOf(cells[cells.length - 1].t);
    if (ext == null) continue;

    if (/sub\s*total/i.test(joinedAll)) { out.subTotal = ext; continue; }
    if (/%\s*TAX|TAX tax on/i.test(joinedAll)) {
      out.tax = ext;
      const base = moneyOf(cells[cells.length - 2]?.t ?? "");
      if (base != null) out.taxBase = base;
      continue;
    }
    if (/invoice\s*total/i.test(joinedAll)) { out.invoiceTotal = ext; continue; }
    if (/^payment\b/i.test(joinedAll)) { out.deposits = ext; continue; }
    if (/^balance\b/i.test(joinedAll)) { out.balance = ext; continue; }

    const unit = moneyOf(cells[cells.length - 2]?.t ?? "");
    if (unit == null) continue; // notes/comment rows
    let label = cells.slice(0, cells.length - 2).map((c) => c.t.trim());
    // qty cell ("1", "2", ".00") sits just before unit cost
    let qty = 1;
    const maybeQty = label[label.length - 1];
    if (/^\d{1,3}$/.test(maybeQty) || /^\.\d{2}$/.test(maybeQty)) {
      qty = /^\d{1,3}$/.test(maybeQty) ? Number(maybeQty) : 1;
      label = label.slice(0, -1);
    }
    const joined = label.join(" ");
    if (!joined) continue;
    if (/^labor\b/i.test(joined)) {
      out.laborTotal = Math.round((out.laborTotal + ext) * 100) / 100;
      out.laborEntries++;
    } else if (/shipping\s*&?\s*handling/i.test(joined)) {
      out.shippingTotal = Math.round((out.shippingTotal + ext) * 100) / 100;
    } else {
      const model = label.length > 1 && /^[A-Z0-9][A-Z0-9\-\/]{3,}$/i.test(label[0]) ? label[0] : "";
      const description = properCase((model ? label.slice(1) : label).join(" "));
      out.parts.push({ qty, model, description, ext });
    }
  }

  // Some work-order prints list items WITHOUT per-line prices (just a Qty
  // column) and only carry totals. Item rows there look like
  // [part#, description, SV09, qty] — collect them price-less so the team
  // can still see what's on the order; the client sees one parts&labor line.
  if (!out.parts.length && !out.laborEntries && out.subTotal != null) {
    out.noLinePricing = true;
    const seen = new Set();
    for (const r of rows) {
      const cells = r.cells;
      if (cells.length < 2) continue;
      const lastC = cells[cells.length - 1];
      if (!(lastC.x > 10500 && /^\d{1,3}$/.test(lastC.t.trim()))) continue;
      const qty = Number(lastC.t.trim());
      const textCells = cells.slice(0, -1)
        .map((c) => c.t.trim())
        .filter((t) => t && !/^SV\d{1,4}$/.test(t) && moneyOf(t) == null);
      if (!textCells.length) continue;
      const joined = textCells.join(" ");
      const key = joined + "|" + qty;
      if (seen.has(key)) continue; // pages repeat the header block
      seen.add(key);
      if (/shipping\s*&?\s*handling/i.test(joined)) continue; // rolled into the total
      const code = textCells.length > 1 ? textCells[0] : "";
      const description = properCase(textCells.length > 1 ? textCells.slice(1).join(" ") : textCells[0]);
      // ZN/RE service codes are labor line items, not parts
      if (/^(ZN|RE)[A-Z0-9\-]*$/i.test(code) || /^service zone/i.test(description)) {
        out.laborEntries++;
      } else {
        out.parts.push({ qty, model: code, description, ext: null });
      }
    }
  }

  if (!out.svNumber) warnings.push("Couldn't find the SV invoice number.");
  if (out.invoiceTotal == null) warnings.push("Couldn't find the invoice total.");
  const partsTotal = out.noLinePricing ? null : Math.round(out.parts.reduce((sum, p) => sum + p.ext, 0) * 100) / 100;
  out.partsTotal = partsTotal;
  if (!out.noLinePricing && out.subTotal != null) {
    const sum = Math.round((partsTotal + out.laborTotal + out.shippingTotal) * 100) / 100;
    if (Math.abs(sum - out.subTotal) > 0.02) {
      warnings.push(`Line items sum to $${sum.toFixed(2)} but the subtotal reads $${out.subTotal.toFixed(2)} — double-check the summary before sending.`);
    }
  }
  if (!out.parts.length && !out.laborEntries) {
    const err = new Error("No parts or labor lines found — is this the ePASS work-order print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }
  return out;
}

// Parse the ePASS service quote/invoice PDF into the client-facing summary.
export function extractServiceEstimateFromPdf(buffer) {
  const rows = pdfTextRows(buffer);
  if (!rows.length) {
    const err = new Error("Couldn't read any text from that PDF — is it the ePASS invoice print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }

  // The Work Order print (preferred — has model/serial/phone/preference)
  // announces itself; anything else falls to the plain-invoice parser.
  const isWorkOrder = rows.some((r) => r.cells.some((c) => /--\s*Work Order\s*--|^Date Ordered:$/.test(c.t.trim())));
  if (isWorkOrder) return parseWorkOrderRows(rows);

  const flat = rows.map((r) => ({ ...r, text: r.cells.map((c) => c.t.trim()).join(" · ") }));
  const warnings = [];
  const out = {
    format: "invoice",
    svNumber: "", date: "", customerName: "", customerNumber: "", salesperson: "",
    phone: "", contactPref: "", reference: "",
    parts: [], laborTotal: 0, laborEntries: 0, shippingTotal: 0,
    subTotal: null, tax: null, invoiceTotal: null, deposits: null, balance: null,
    warnings
  };

  // Header fields (page 1)
  out.svNumber = findSvNumber(flat);
  for (const r of flat) {
    for (const c of r.cells) {
      const t = c.t.trim();
      if (!out.date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) out.date = t;
    }
  }
  // Bill-To block: first text cell at the Bill To x-column below the header.
  const billTo = rows.find((r) => r.page === 0 && r.cells.some((c) => c.x > 1000 && c.x < 2200 && /[A-Za-z]/.test(c.t) && c.y < 12400 && c.y > 12000));
  if (billTo) out.customerName = flipName(billTo.cells.find((c) => c.x > 1000 && c.x < 2200)?.t.trim() || "");
  for (const r of flat) {
    const custIdx = r.cells.findIndex((c) => /^\d{10}$/.test(c.t.trim()) && c.x < 2000);
    if (custIdx >= 0 && !out.customerNumber) out.customerNumber = r.cells[custIdx].t.trim();
  }
  const spRow = rows.find((r) => r.cells.some((c) => c.t.trim() === "SERVICE"));
  if (spRow) {
    const sp = spRow.cells.find((c) => c.x > 6000 && c.x < 9500 && /[A-Za-z] [A-Za-z]/.test(c.t));
    if (sp) out.salesperson = properCase(sp.t.trim());
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
      const description = properCase((rest.length > 1 ? rest.slice(1) : rest).join(" "));
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
    contactPref: row.contact_pref || "",
    emailedAt: row.emailed_at?.toISOString?.() || null,
    summary: row.summary || {},
    status: row.status,
    response: row.response || {},
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at?.toISOString?.() || null,
    viewedAt: row.viewed_at?.toISOString?.() || null,
    respondedAt: row.responded_at?.toISOString?.() || null,
    closedAt: row.closed_at?.toISOString?.() || null,
    closedByEmail: row.closed_by_email || ""
  };
}

// Close an estimate from the internal list (housekeeping — the loop is
// closed, or it was a test/dead entry). Closed estimates leave the active
// list, stop accepting client responses, and are skipped by the stale
// sweep. Reopen undoes it.
export async function setServiceEstimateClosed(token, closed, byEmail = "") {
  const pool = await getReadyPool();
  const result = await pool.query(
    closed
      ? `UPDATE service_estimates SET closed_at = NOW(), closed_by_email = $2 WHERE token = $1 RETURNING *`
      : `UPDATE service_estimates SET closed_at = NULL, closed_by_email = '' WHERE token = $1 RETURNING *`,
    closed ? [String(token || ""), String(byEmail || "").trim().toLowerCase()] : [String(token || "")]
  );
  return result.rows[0] ? mapEstimate(result.rows[0]) : null;
}

// Prefill: if this phone (or customer number) already has an email on file
// from the online shop profiles, offer it — never guessed, always shown to
// the rep before use.
export async function lookupKnownClientEmail({ phone = "", customerNumber = "" }) {
  const pool = await getReadyPool();
  const digits = String(phone || "").replace(/\D/g, "");
  try {
    if (digits.length === 10) {
      const r = await pool.query(
        `SELECT email FROM shop_shoppers
         WHERE regexp_replace(phone, '\\D', '', 'g') = $1 AND email <> '' LIMIT 1`,
        [digits]
      );
      if (r.rows[0]?.email) return { email: r.rows[0].email, source: "online shop profile" };
    }
    const cn = String(customerNumber || "").replace(/\D/g, "");
    if (cn.length === 10) {
      const r = await pool.query(
        `SELECT email FROM shop_shoppers
         WHERE regexp_replace(phone, '\\D', '', 'g') = $1 AND email <> '' LIMIT 1`,
        [cn]
      );
      if (r.rows[0]?.email) return { email: r.rows[0].email, source: "online shop profile" };
    }
  } catch {}
  return null;
}

// Estimates the client never opened: still in "sent" after the wait window
// and not yet flagged. The sweep flags Senior Customer Service to chase.
export async function listStaleSentEstimates(hours) {
  const pool = await getReadyPool();
  const h = Math.max(Number(hours) || 48, 1);
  const result = await pool.query(
    `SELECT * FROM service_estimates
      WHERE status = 'sent'
        AND stale_flagged_at IS NULL
        AND closed_at IS NULL
        AND created_at < NOW() - ($1 || ' hours')::interval
      ORDER BY created_at ASC
      LIMIT 100`,
    [String(h)]
  );
  return result.rows.map(mapEstimate);
}

export async function markServiceEstimateStaleFlagged(token) {
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE service_estimates SET stale_flagged_at = NOW() WHERE token = $1`,
    [String(token || "")]
  );
}

export async function markServiceEstimateEmailed(token, contactEmail) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `UPDATE service_estimates
     SET emailed_at = NOW(), contact_email = COALESCE(NULLIF($2, ''), contact_email)
     WHERE token = $1 RETURNING *`,
    [String(token || ""), String(contactEmail || "").trim().toLowerCase().slice(0, 200)]
  );
  return r.rows[0] ? mapEstimate(r.rows[0]) : null;
}

export async function createServiceEstimate({ svNumber, estimateName, customerName, customerNumber, contactPhone, contactEmail, contactPref = "", summary, byEmail, byName }) {
  const pool = await getReadyPool();
  const token = crypto.randomBytes(18).toString("base64url");
  const result = await pool.query(
    `INSERT INTO service_estimates
       (token, sv_number, estimate_name, customer_name, customer_number, contact_phone, contact_email, contact_pref, summary, created_by_email, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
     RETURNING *`,
    [
      token,
      String(svNumber || "").toUpperCase().slice(0, 30),
      String(estimateName || "").slice(0, 120),
      String(customerName || "").slice(0, 160),
      String(customerNumber || "").slice(0, 30),
      String(contactPhone || "").slice(0, 40),
      String(contactEmail || "").trim().toLowerCase().slice(0, 200),
      ["call", "text", "email"].includes(contactPref) ? contactPref : "",
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
  const status = choice === "approve" ? "approved" : choice === "elsewhere" ? "elsewhere" : "shopping";
  const response = choice === "approve"
    ? { choice: "approve" }
    : choice === "elsewhere"
      ? { choice: "elsewhere", notes: String(notes || "").trim().slice(0, 1000) }
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
