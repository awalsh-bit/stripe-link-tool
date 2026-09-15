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
export function pdfTextRows(buffer) {
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

// Some PDF printers (Microsoft Print to PDF, browser "Save as PDF") write
// hex-encoded CID glyphs in TJ arrays inside object streams, which the
// lightweight scanner above can't read. pdf.js can. Its coordinates are in
// points; ePASS's own print uses 1/20-point units, so scale by 20 to keep
// every column threshold in the parsers valid for both.
let pdfjsPromise = null;
async function pdfTextRowsViaPdfjs(buffer) {
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await pdfjsPromise;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const rows = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        const t = String(it.str || "");
        if (!t.trim()) continue;
        items.push({ x: it.transform[4] * 20, y: it.transform[5] * 20, w: (it.width || 0) * 20, t });
      }
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      let band = null;
      for (const item of items) {
        if (!band || Math.abs(band.y - item.y) > 90) { band = { page: p - 1, y: item.y, cells: [] }; rows.push(band); }
        // pdf.js splits a line wherever word spacing changes; glue pieces
        // back together when the gap is under ~8pt so "SUBZERO, BUILT IN …"
        // stays one cell while real column gaps stay separate.
        const prev = band.cells[band.cells.length - 1];
        if (prev && item.x - (prev.x + prev.w) < 160 && item.x >= prev.x) {
          prev.t = prev.t.replace(/\s+$/, "") + " " + item.t.replace(/^\s+/, "");
          prev.w = item.x + item.w - prev.x;
        } else {
          band.cells.push({ x: item.x, y: item.y, w: item.w, t: item.t });
        }
      }
    }
  } finally {
    try { await (doc.cleanup?.() ?? doc.destroy?.()); } catch { /* freed with the document */ }
  }
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}

// Rows from whichever extractor can read the file.
export async function pdfTextRowsAny(buffer) {
  let rows = [];
  try { rows = pdfTextRows(buffer); } catch { rows = []; }
  if (rows.length) return rows;
  try { return await pdfTextRowsViaPdfjs(buffer); } catch (err) { console.error("pdf.js text extraction failed:", err.message); return []; }
}

export const moneyOf = (s) => {
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
const COMPANY_WORDS = /\b(LLC|INC|CO|CORP|LTD|LP|HOMES?|BUILDERS?|CONSTRUCTION|CONTRACTORS?|DESIGNS?|GROUP|CUSTOM|DEVELOPMENT|PROPERTIES|REMODEL(ING)?|INTERIORS?|ARCHITECTS?|SERVICES?|ENTERPRISES?|PARTNERS|COMPANY|ASSOCIATES|MANAGEMENT|INVESTMENTS?|VENTURES?|RANCH|CHURCH|SCHOOL|HOTEL|RESTAURANT)\b/i;
export function flipName(raw) {
  const s = String(raw || "").trim();
  const i = s.indexOf(",");
  if (i < 0) return properCase(s);
  const last = s.slice(0, i).trim();
  const rest = s.slice(i + 1).trim();
  // "BUILD CO LLC, Joshua Cummins" is a company + contact, not LAST, FIRST
  if (COMPANY_WORDS.test(last)) {
    const company = properCase(last).replace(/\bLlc\b/g, "LLC").replace(/\bInc\b/g, "Inc");
    return rest ? `${company} — ${properCase(rest)}` : company;
  }
  return properCase(rest && last ? `${rest} ${last}` : (rest || last));
}

const PHONE_RE = /\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}/;
export const normPhone = (s) => {
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

// ---------------------------------------------------------------------------
// LINE CLASSES. Every priced line on an ePASS service print is one of:
//   labor        "Labor <tech>"                       → laborTotal / laborEntries
//   shipping     "(Service) Shipping & Handling"      → shippingTotal
//   refrigerant  "R-134a Refrigerant (Per Lb)", R-410A, R-22, R-32, R-454B,
//                "Freon" — HVAC charge lines (Andrew, 2026-09-15). Sold by
//                the pound, no part number, so they are NOT parts: they get
//                their own section on the client's page and are exempt from
//                the parts-quality gate.
//   part         everything else (part number + description)
// ---------------------------------------------------------------------------
const REFRIGERANT_RE = /\brefrigerant\b|\bfreon\b|\bR-?(?:12|22|32|134a|290|404a|407c|410a|448a|449a|454b|507|600a)\b|\bpuron\b/i;
export function classifyEstimateLine(joined) {
  const t = String(joined || "");
  if (/^labor\b/i.test(t)) return "labor";
  if (/shipping\s*&?\s*handling/i.test(t)) return "shipping";
  if (REFRIGERANT_RE.test(t)) return "refrigerant";
  return "part";
}
const QUOTE_RE = /^Q\d{6,}$/;
function findQuoteNumber(rows) {
  for (const r of rows) {
    for (let i = 0; i < r.cells.length; i++) {
      const t = r.cells[i].t.trim();
      if (QUOTE_RE.test(t)) return t;
      const inline = t.match(/^INVOICE #:\s*(Q\d{6,})$/i);
      if (inline) return inline[1];
    }
  }
  return "";
}
// Refrigerant lines print as "R-134a Refrigerant (Per Lb)  qty  unit  ext";
// the description is the whole label, the unit price is per pound.
function pushRefrigerant(out, { qty, description, unit, ext }) {
  out.refrigerant = out.refrigerant || [];
  out.refrigerant.push({ qty, description, unit, ext });
  out.refrigerantTotal = Math.round(((out.refrigerantTotal || 0) + (ext || 0)) * 100) / 100;
}

// The Work Order print carries appliance + contact detail the plain invoice
// doesn't: Brand/Product/Model#/Serial#, the client's phone, and the
// Reference # field where the office notes CALL PREF / TEXT PREF.
//
// The ePASS QUOTE print ("--Estimate--", INVOICE # Q00084556, Inv Type
// QUOTE) is the same layout minus the appliance block: it carries
// Salesperson (the tech), Ship To with the client's account number, and a
// Special Request line. It parses here too (format "quote"); there is no SV
// yet, so the quote number stands in for it until the office adds one.
function parseWorkOrderRows(rows) {
  const warnings = [];
  const out = {
    format: "workorder",
    svNumber: "", date: "", customerName: "", customerNumber: "", salesperson: "",
    phone: "", contactPref: "", reference: "",
    brand: "", product: "", model: "", serial: "", technician: "", complaint: "",
    parts: [], laborTotal: 0, laborEntries: 0, shippingTotal: 0, refrigerant: [], refrigerantTotal: 0,
    subTotal: null, tax: null, taxBase: null, invoiceTotal: null, deposits: null, balance: null,
    quoteNumber: "", specialRequest: "",
    warnings
  };
  const isQuote = rows.some((r) => r.cells.some((c) => /--\s*Estimate\s*--/.test(c.t.trim())))
    || rows.some((r) => r.cells.some((c) => /^Inv Type:$/.test(c.t.trim())) && r.cells.some((c) => /^QUOTE$/i.test(c.t.trim())));
  if (isQuote) out.format = "quote";

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
  out.quoteNumber = findQuoteNumber(rows);
  out.date = (cellAfter(/^Date Ordered:$/) .match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [""])[0];
  out.reference = cellAfter(/^Reference #:/);
  out.specialRequest = cellAfter(/^Special Request:$/).slice(0, 300);
  const prefSource = `${out.reference} ${out.specialRequest}`;
  if (/call\s*pref/i.test(prefSource)) out.contactPref = "call";
  else if (/te?xt\s*pref/i.test(prefSource)) out.contactPref = "text";
  else if (/e-?mail\s*pref/i.test(prefSource)) out.contactPref = "email";
  out.technician = properCase(cellAfter(/^Technician:$/)) || (isQuote ? properCase(cellAfter(/^Salesperson:$/)) : "");
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
  for (const svcAtRow of rows.filter((r) => r.cells.some((c) => /^(Service At|Ship To):$/.test(c.t.trim())))) {
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
  const paymentsByLabel = new Map();
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
    // "Payments . . . 169.95" (and "A/R Payments") — money the client has
    // already put down, usually the diagnostic fee. Summed if both print.
    // Multi-page prints repeat the totals block, so the same "Payments"
    // line can appear twice — keep one amount per label (Payments, A/R
    // Payments, Deposits) and sum the distinct labels.
    if (/\b(payments?|deposits?)\b/i.test(joinedAll) && !/adjustment/i.test(joinedAll)) {
      const label = cells.slice(0, -1).map((c) => c.t.trim()).join(" ").replace(/[.\s:]+$/g, "").toUpperCase();
      paymentsByLabel.set(label, ext);
      continue;
    }
    if (/\bbalance\b/i.test(joinedAll)) { out.balance = ext; continue; }

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
    // the SV02-style order-type column on quote prints is not description
    label = label.filter((t) => !/^SV\d{1,4}$/.test(t));
    const joined = label.join(" ");
    if (!joined) continue;
    const kind = classifyEstimateLine(joined);
    if (kind === "labor") {
      out.laborTotal = Math.round((out.laborTotal + ext) * 100) / 100;
      out.laborEntries++;
      // "Labor  Diogo Assis" — the tech's name rides the labor line on quotes
      const who = label.slice(1).join(" ").trim();
      if (!out.technician && /^[A-Za-z][A-Za-z'.\- ]+ [A-Za-z][A-Za-z'.\- ]+$/.test(who)) out.technician = properCase(who);
    } else if (kind === "shipping") {
      out.shippingTotal = Math.round((out.shippingTotal + ext) * 100) / 100;
    } else if (kind === "refrigerant") {
      pushRefrigerant(out, { qty, description: label.join(" ").replace(/\s+/g, " "), unit, ext });
    } else {
      const model = label.length > 1 && /^[A-Z0-9][A-Z0-9\-\/]{3,}$/i.test(label[0]) ? label[0] : "";
      const description = properCase((model ? label.slice(1) : label).join(" "));
      out.parts.push({ qty, model, description, ext });
    }
  }

  if (paymentsByLabel.size) out.deposits = Math.round([...paymentsByLabel.values()].reduce((a, b) => a + b, 0) * 100) / 100;

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
      if (classifyEstimateLine(joined) === "refrigerant") { pushRefrigerant(out, { qty, description: joined, unit: null, ext: null }); continue; }
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

  if (!out.svNumber && out.quoteNumber) {
    // A quote has no service ticket yet — the Q number identifies it until
    // the office converts it and adds the SV.
    out.svNumber = out.quoteNumber;
  }
  if (!out.svNumber) warnings.push("Couldn't find the SV invoice number.");
  if (out.invoiceTotal == null) warnings.push("Couldn't find the invoice total.");
  const partsTotal = out.noLinePricing ? null : Math.round(out.parts.reduce((sum, p) => sum + p.ext, 0) * 100) / 100;
  out.partsTotal = partsTotal;
  if (!out.noLinePricing && out.subTotal != null) {
    const sum = Math.round((partsTotal + out.laborTotal + out.shippingTotal + (out.refrigerantTotal || 0)) * 100) / 100;
    if (Math.abs(sum - out.subTotal) > 0.02) {
      warnings.push(`Line items sum to $${sum.toFixed(2)} but the subtotal reads $${out.subTotal.toFixed(2)} — double-check the summary before sending.`);
    }
  }
  if (!out.parts.length && !out.laborEntries && !(out.refrigerant || []).length) {
    const err = new Error("No parts or labor lines found — is this the ePASS work-order print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }
  return enforcePartsQuality(out);
}

// ---------------------------------------------------------------------------
// PARTS QUALITY GATE (Andrew, 2026-09-10): the client's page must ALWAYS show
// the part numbers and descriptions, so a PDF whose parts table did not parse
// cleanly is refused at scan time rather than producing a bare-total link.
//
//   ok           every part line has a part number AND a description
//   labor-only   no part lines at all, but labor was found (a legitimate
//                labor-only repair — allowed, and the client page says so)
//   otherwise    an error naming the lines that came through incomplete
//
// The gate is exported so the create endpoint can re-check a summary that
// was edited in the browser.
// ---------------------------------------------------------------------------
export function assessPartsQuality(summary) {
  const parts = Array.isArray(summary?.parts) ? summary.parts : [];
  // labor and refrigerant lines are legitimate on their own (an HVAC
  // recharge is refrigerant + labor and no parts)
  const labor = Number(summary?.laborEntries || 0) > 0 || (Array.isArray(summary?.refrigerant) && summary.refrigerant.length > 0);
  const problems = [];
  parts.forEach((p, i) => {
    const model = String(p?.model || "").trim();
    const description = String(p?.description || "").trim();
    if (!model && !description) problems.push(`line ${i + 1}: no part number or description`);
    else if (!model) problems.push(`line ${i + 1} ("${description.slice(0, 40)}"): no part number`);
    else if (!description) problems.push(`line ${i + 1} (${model}): no description`);
  });
  if (!parts.length && !labor) {
    return { ok: false, laborOnly: false, partCount: 0, problems: ["no parts or labor lines were found"] };
  }
  if (!parts.length) return { ok: true, laborOnly: true, partCount: 0, problems: [] };
  return { ok: problems.length === 0, laborOnly: false, partCount: parts.length, problems };
}

export function partsQualityError(quality) {
  const err = new Error(
    quality.partCount
      ? `The parts on this PDF didn't parse cleanly — ${quality.problems.join("; ")}. The client's page always shows part numbers and descriptions, so re-export the ePASS service quote (the Work Order print parses best) and scan it again.`
      : "No parts or labor lines were found on this PDF — is this the ePASS service quote print? Re-export it and scan again."
  );
  err.code = "PARTS_INCOMPLETE";
  err.quality = quality;
  return err;
}

// What the client has already paid (diagnostic fee / deposit) and what the
// repair will actually cost them on top of it. The printed Balance wins
// when it's there; otherwise total minus payments.
export function settleBalance(out) {
  if (!out) return out;
  const total = out.invoiceTotal != null ? Number(out.invoiceTotal) : null;
  const paid = out.deposits != null && Number(out.deposits) > 0 ? Math.round(Number(out.deposits) * 100) / 100 : 0;
  let due = null;
  if (out.balance != null && Number(out.balance) >= 0) due = Math.round(Number(out.balance) * 100) / 100;
  else if (total != null) due = Math.round(Math.max(0, total - paid) * 100) / 100;
  out.paid = paid;
  out.amountDue = due != null ? due : total;
  // A printed balance that disagrees with total − payments means a credit or
  // adjustment the team should know about.
  if (total != null && due != null && paid && Math.abs(total - paid - due) > 0.02) {
    out.warnings = out.warnings || [];
    out.warnings.push(`The print's balance ($${due.toFixed(2)}) isn't total minus payments ($${(total - paid).toFixed(2)}) — check for adjustments before sending.`);
  }
  return out;
}

function enforcePartsQuality(out) {
  settleBalance(out);
  const quality = assessPartsQuality(out);
  out.partsQuality = quality;
  if (!quality.ok) throw partsQualityError(quality);
  return out;
}

// Parse the ePASS service quote/invoice PDF into the client-facing summary.
export async function extractServiceEstimateFromPdf(buffer) {
  const rows = await pdfTextRowsAny(buffer);
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
    parts: [], laborTotal: 0, laborEntries: 0, shippingTotal: 0, refrigerant: [], refrigerantTotal: 0,
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
    const kind = classifyEstimateLine(joined);
    if (kind === "labor") {
      out.laborTotal = Math.round((out.laborTotal + ext) * 100) / 100;
      out.laborEntries++;
    } else if (kind === "shipping") {
      out.shippingTotal = Math.round((out.shippingTotal + ext) * 100) / 100;
    } else if (kind === "refrigerant") {
      const qty = /^\d+$/.test(label[0]) ? Number(label[0]) : 1;
      const rest = /^\d+$/.test(label[0]) ? label.slice(1) : label;
      pushRefrigerant(out, { qty, description: rest.join(" "), unit: price, ext });
    } else {
      // "1 · 7006964 · DRIER,SVCE" → qty, model, description
      const qty = /^\d+$/.test(label[0]) ? Number(label[0]) : 1;
      const rest = /^\d+$/.test(label[0]) ? label.slice(1) : label;
      const model = rest.length > 1 ? rest[0] : "";
      const description = properCase((rest.length > 1 ? rest.slice(1) : rest).join(" "));
      out.parts.push({ qty, model, description, ext });
    }
  }

  // Totals block (authoritative). Payment lines are kept one-per-label so a
  // totals block repeated on page 2 doesn't double the amount paid.
  const paymentsByLabel = new Map();
  for (const r of flat) {
    const cellText = r.cells.map((c) => c.t.trim());
    const amount = moneyOf(cellText[cellText.length - 1]);
    if (amount == null) continue;
    const labelText = cellText.slice(0, -1).join(" ").toUpperCase();
    if (/SUB\s*TOTAL/.test(labelText)) out.subTotal = amount;
    else if (/INVOICE\s*TOTAL/.test(labelText)) out.invoiceTotal = amount;
    else if (/\bTAX\b/.test(labelText)) out.tax = amount;
    else if (/\b(DEPOSITS?|PAYMENTS?)\b/.test(labelText) && !/ADJUSTMENT/.test(labelText)) paymentsByLabel.set(labelText.replace(/[.\s:]+$/g, ""), amount);
    else if (/\bBALANCE\b/.test(labelText)) out.balance = amount;
  }

  if (paymentsByLabel.size) out.deposits = Math.round([...paymentsByLabel.values()].reduce((a, b) => a + b, 0) * 100) / 100;

  if (!out.svNumber) warnings.push("Couldn't find the SV invoice number.");
  if (out.invoiceTotal == null) warnings.push("Couldn't find the invoice total.");
  const partsTotal = Math.round(out.parts.reduce((s, p) => s + p.ext, 0) * 100) / 100;
  out.partsTotal = partsTotal;
  if (out.subTotal != null) {
    const sum = Math.round((partsTotal + out.laborTotal + out.shippingTotal + (out.refrigerantTotal || 0)) * 100) / 100;
    if (Math.abs(sum - out.subTotal) > 0.02) {
      warnings.push(`Line items sum to $${sum.toFixed(2)} but the subtotal reads $${out.subTotal.toFixed(2)} — double-check the summary before sending.`);
    }
  }
  if (!out.parts.length && !out.laborEntries && !(out.refrigerant || []).length) {
    const err = new Error("No parts or labor lines found — is this the ePASS service quote print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }
  return enforcePartsQuality(out);
}

// ---------------------------------------------------------------------------
// PARTS ETA (Andrew, 2026-09-10). Three modes, stored on the summary as
// summary.eta = { mode, from, to, technician } and rendered on the client's
// page as the "what happens next" line:
//   stock     "Once approved, we will order the parts listed ... and schedule
//             your technician [Name] to return [Today+3 .. Today+6 business
//             days]" — skips Sat/Sun.
//   backorder no date can be promised; we contact them when the parts land.
//   date      the team picks one date or a range.
//
// The dates are LIVE (Andrew, 2026-09-10): what's stored is the range as
// entered plus the day it was entered (basedOn). Every time the client opens
// the page, liveEta() re-bases the range on today — stock is always
// today+3..today+6, and a specific range keeps the same business-day
// distance from "today" that it had from the day it was entered — so a
// client who waits a week never reads a Tuesday–Friday that has already
// gone by. Once they respond, the range freezes on the day they responded.
// ---------------------------------------------------------------------------
const ETA_MODES = new Set(["stock", "backorder", "date"]);

function centralToday() {
  // The office plans in Central time; a link created at 11pm CT is "today"
  // in Texas even though it is tomorrow in UTC.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addBusinessDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  let left = Number(days) || 0;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

// Central-time calendar date of any instant (ISO string or Date).
export function centralDateOf(when) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Business days from `fromIso` (exclusive) to `toIso` (inclusive); 0 when
// `toIso` is not after `fromIso`. A weekend `toIso` counts as the Friday
// before it.
export function businessDaysBetween(fromIso, toIso) {
  if (!fromIso || !toIso || toIso <= fromIso) return 0;
  const d = new Date(`${fromIso}T12:00:00Z`);
  const end = new Date(`${toIso}T12:00:00Z`);
  let n = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

// The ETA as the client should read it on `asOf` (default: today, Central).
export function liveEta(eta, asOf = centralToday()) {
  if (!eta || !eta.mode) return eta;
  if (eta.mode === "backorder") return { ...eta, liveAsOf: asOf };
  if (eta.mode === "stock") {
    return { ...eta, from: addBusinessDays(asOf, 3), to: addBusinessDays(asOf, 6), liveAsOf: asOf };
  }
  // specific date(s): keep the business-day distance from the day it was
  // entered. Entered Sep 22–24 on Sep 10 (8 business days out, 2 long) and
  // read on Sep 17 → Sep 29 – Oct 1.
  const basedOn = /^\d{4}-\d{2}-\d{2}$/.test(eta.basedOn || "") ? eta.basedOn : "";
  if (!basedOn || !eta.from || asOf <= basedOn) return { ...eta, liveAsOf: asOf };
  const lead = businessDaysBetween(basedOn, eta.from);
  const span = businessDaysBetween(eta.from, eta.to || eta.from);
  const from = addBusinessDays(asOf, lead);
  const to = addBusinessDays(from, span);
  return { ...eta, from, to, liveAsOf: asOf };
}

export function formatEtaDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

// Normalise what the team sent into what gets stored. Throws on a bad
// specific-date entry so a link never goes out with an unreadable ETA.
export function normalizeEta(input, { technician = "" } = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const mode = ETA_MODES.has(raw.mode) ? raw.mode : "stock";
  const tech = String(raw.technician || technician || "").trim().slice(0, 80);
  const today = centralToday();
  if (mode === "stock") {
    return { mode, from: addBusinessDays(today, 3), to: addBusinessDays(today, 6), technician: tech, basedOn: today };
  }
  if (mode === "backorder") return { mode, from: "", to: "", technician: tech, basedOn: today };
  const from = String(raw.from || "").trim();
  const to = String(raw.to || "").trim() || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const err = new Error("Pick the return-visit date (or a date range) for the specific-date ETA.");
    err.code = "ETA_DATE_REQUIRED";
    throw err;
  }
  if (to < from) {
    const err = new Error("The ETA range ends before it starts — check the dates.");
    err.code = "ETA_DATE_REQUIRED";
    throw err;
  }
  return { mode, from, to, technician: tech, basedOn: today };
}

// The sentence the client reads. One place, so the page, the email and the
// text cannot disagree.
export function etaMessage(eta) {
  if (!eta || !eta.mode) return "";
  const who = eta.technician ? `your technician ${eta.technician}` : "your technician";
  if (eta.mode === "backorder") {
    return "Once approved, we will order the parts listed to complete the repair. Unfortunately, the parts required are out of stock with all of our distributors and the manufacturer, so please be advised that we cannot provide a reliable date for a return visit. Once they arrive, we will contact you to arrange a time that works for you.";
  }
  const from = formatEtaDate(eta.from), to = formatEtaDate(eta.to);
  const when = !from ? "" : (eta.to && eta.to !== eta.from ? `between ${from} and ${to}` : `on ${from}`);
  return `Once approved, we will order the parts listed to complete the repair and schedule ${who} to return ${when}.`.replace(/\s+\./g, ".");
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
// Staff resolution: the client answered by phone / Podium text instead of
// the link. Sets the final status with a note, stamps the response, and
// closes the estimate in one step. 'diagnostic' = paid the diag fee and is
// not repairing or replacing; 'comped' = the repair (or fee) was written
// off — goodwill, warranty gray area, or a service miss.
export const STAFF_RESOLUTIONS = ["approved", "comped", "shopping", "diagnostic"];
export const OUTCOME_LABELS = { approved: "Approved", comped: "Comped", shopping: "Shopping", elsewhere: "Went elsewhere", diagnostic: "Diagnostic only", sent: "No response", viewed: "No response" };
export async function resolveServiceEstimate(token, { status, notes = "", byEmail = "", byName = "" } = {}) {
  if (!STAFF_RESOLUTIONS.includes(status)) throw new Error("Choose Approved, Comped, Shopping, or Diagnostic only.");
  const note = String(notes || "").trim().slice(0, 1000);
  if (!note) throw new Error("Add a note on how the client confirmed (e.g. Podium text, phone call).");
  const pool = await getReadyPool();
  const response = { resolvedByStaff: true, staffEmail: String(byEmail || "").toLowerCase(), staffName: String(byName || ""), staffNotes: note, resolvedAt: new Date().toISOString() };
  const result = await pool.query(
    `UPDATE service_estimates
        SET status = $2, response = COALESCE(response, '{}'::jsonb) || $3::jsonb, responded_at = COALESCE(responded_at, NOW()), viewed_at = COALESCE(viewed_at, NOW()),
            closed_at = NOW(), closed_by_email = $4
      WHERE token = $1 AND status IN ('sent', 'viewed')
      RETURNING *`,
    [String(token || ""), status, JSON.stringify(response), String(byEmail || "").trim().toLowerCase()]
  );
  return result.rows[0] ? mapEstimate(result.rows[0]) : null;
}

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

// Active list: everything not yet closed. Closed estimates live on their
// own page (listClosedServiceEstimates).
export async function listServiceEstimates() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM service_estimates WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 300`);
  return result.rows.map(mapEstimate);
}

// Closed estimates for one calendar month (YYYY-MM, in the app time zone)
// or all of them. Ordered newest close first.
export async function listClosedServiceEstimates({ month = "", timeZone = "America/Chicago" } = {}) {
  const pool = await getReadyPool();
  const m = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : "";
  const result = m
    ? await pool.query(
        `SELECT * FROM service_estimates
          WHERE closed_at IS NOT NULL AND to_char(closed_at AT TIME ZONE $2, 'YYYY-MM') = $1
          ORDER BY closed_at DESC LIMIT 2000`,
        [m, timeZone]
      )
    : await pool.query(`SELECT * FROM service_estimates WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 2000`, []);
  return result.rows.map(mapEstimate);
}

// Months (YYYY-MM) that have at least one closed estimate, newest first —
// feeds the month picker.
export async function listClosedEstimateMonths(timeZone = "America/Chicago") {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT to_char(closed_at AT TIME ZONE $1, 'YYYY-MM') AS month, COUNT(*)::int AS count
       FROM service_estimates WHERE closed_at IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`,
    [timeZone]
  );
  return result.rows.map((r) => ({ month: r.month, count: r.count }));
}

// How a closed estimate ended, for reporting. Client answers via the link
// and staff resolutions both count; an estimate closed while still
// sent/viewed is "No response".
export function estimateOutcome(estimate) {
  const status = String(estimate?.status || "");
  const outcome = ["sent", "viewed"].includes(status) ? "none" : status;
  const r = estimate?.response || {};
  return {
    outcome,
    outcomeLabel: OUTCOME_LABELS[status] || status,
    resolvedBy: r.resolvedByStaff ? "staff" : ["sent", "viewed"].includes(status) ? "" : "client",
    resolverName: r.resolvedByStaff ? String(r.staffName || r.staffEmail || "") : "",
    notes: r.resolvedByStaff ? String(r.staffNotes || "") : String(r.notes || "")
  };
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
export async function saveServiceEstimateResponse(token, { choice, productDirection = "", visit = "", notes = "", proceededAnyway = false }) {
  const pool = await getReadyPool();
  const status = choice === "approve" ? "approved" : choice === "elsewhere" ? "elsewhere" : "shopping";
  // proceededAnyway: the tech had marked the repair "not recommended" and the
  // client confirmed the repair over the replacement suggestion.
  const response = choice === "approve"
    ? (proceededAnyway ? { choice: "approve", proceededAnyway: true } : { choice: "approve" })
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
