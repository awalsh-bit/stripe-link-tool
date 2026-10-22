import { read as readWorkbook, utils as xlsxUtils, write as writeWorkbook } from "xlsx";

// ---------------------------------------------------------------------------
// PO ETA IMPORT BUILDER (Purchasing, Andrew 2026-10-20).
//
// Purchasing pushes POs out to match jobs, and the vendor's answer (new ETA,
// acknowledged requested date) then has to be keyed back into ePASS PO by PO,
// which never happens — so Cash Ops Projection sees a wall of ETAs in the
// past. ePASS has an "ETA Date Import" utility that takes a workbook with four
// columns (Import Type = Models, Item/Model = Code):
//
//     A  PO #          B  Model code          C  ETA date          D  Requested delivery
//
// This module turns a raw vendor-portal export into exactly that file:
//
//   1. readVendorWorkbook   any .xlsx/.xls/.csv the portal spits out -> sheets,
//                           header row found, cells as strings/dates
//   2. guessMapping         which columns hold PO / model / ETA / requested /
//                           qty / status (vendor hints first, generic words
//                           second); the page lets the buyer correct it and the
//                           corrected map is saved per vendor for next time
//   3. extractRows          typed rows (dates -> YYYY-MM-DD)
//   4. matchRows            each vendor row against the open PO lines in the
//                           ePASS finance feed (epass_po_open_lines): exact PO,
//                           then alphanumeric, then "vendor PO contains ours";
//                           model exact, then alphanumeric, then unique prefix
//                           (vendors tack colour / revision suffixes on). Rows
//                           whose ETA and requested date already match ePASS
//                           are "same" and left out of the import by default.
//   5. buildImportFile      the four-column file, no header row: CSV by
//                           default (dates as mm/dd/yyyy text), or the old
//                           .xls / .xlsx workbooks if the utility wants those.
//
// Reference (col E) and serial type are deliberately NOT written — Andrew
// does not want those touched from an import right now.
//
// Vendor-specific cleaners live in VENDORS below. Until the real portal
// exports arrive they are header hints only; the generic path handles any
// column layout the buyer maps by hand once.
// ---------------------------------------------------------------------------

export const VENDORS = [
  {
    key: "whirlpool", label: "Whirlpool (Whirlpool · Maytag · KitchenAid · JennAir)",
    // Whirlpool partner portal "Order Status Report" (sample 2026-10-20): a
    // title block, account line and totals strip, then the grid on row 6
    // with merged cells (blank filler columns). Rows are grouped by delivery
    // date with a "Totals:" row after each group (no PO, no model → skipped).
    //   ORDER#        Whirlpool's order number (not ours)
    //   PO NUMBER     our PO ("39325", "BC_S145")
    //   MODEL NUMBER  model code
    //   QTY ORDERED / QTY DELIVERED / QTY READY FOR DELIVERY / QTY REMAINING
    //   QTY REMAINING TO DELIVER BY   the ETA ("10/21/2026")
    // There is no requested-delivery column — column D falls back to ePASS's
    // current RDD so the import never blanks it (Andrew: they rarely change).
    hints: {
      po: [/^po\s*number$/i, /customer\s*po/i, /\bpo\s*(number|#|no)?\b/i, /purchase\s*order/i],
      model: [/^model\s*number$/i, /\bmodel\b/i, /\bmaterial\b/i, /\bitem\b/i, /\bsku\b/i],
      eta: [/remaining\s*to\s*deliver\s*by/i, /\bdeliver\s*by\b/i, /\b(est|estimated|expected|revised|sched\w*)\b.*\b(ship|deliver|arrival|date)/i, /\beta\b/i, /\bship\s*date\b/i, /\bdelivery\s*date\b/i],
      rdd: [/\brequest(ed)?\b.*\b(delivery|ship|date)/i, /\brdd\b/i, /\bwant(ed)?\s*date\b/i, /\bcustomer\s*request/i],
      qty: [/^qty\s*ordered$/i, /\b(open|remaining|backorder\w*|order(ed)?)\s*qty\b/i, /\bqty\b/i, /\bquantity\b/i],
      status: [/\bstatus\b/i]
    },
    derive({ row, headers }) {
      // Nothing to re-date; just say when Whirlpool shows units sitting ready.
      const col = (re) => { const i = headers.findIndex((h) => re.test(h)); return i < 0 ? null : Number(String(row[i] ?? "").replace(/[^0-9.-]/g, "")); };
      const ready = col(/^qty\s*ready/i); const delivered = col(/^qty\s*delivered$/i); const ordered = col(/^qty\s*ordered$/i);
      const notes = [];
      if (Number.isFinite(ready) && ready > 0) notes.push(`Whirlpool: ${ready} ready for delivery`);
      if (Number.isFinite(delivered) && delivered > 0 && Number.isFinite(ordered)) notes.push(`Whirlpool: ${delivered} of ${ordered} already delivered`);
      return { notes };
    }
  },
  {
    key: "ge", label: "GE Appliances",
    // GE Appliances dealer portal "Orders" export (sample 2026-10-20): one
    // row per order line, header on row 1, no merges, no totals.
    //   P.O.#                    our PO ("39053", "P221", "S180-1")
    //   Product # / Ordered Item model code (identical in the sample)
    //   Req. Delivery Date       requested date, "08/06/2026"
    //   Target Arrival Date      GE's original target, "08/21/26" — goes stale
    //   Expected Available Date  GE's current estimate, "11/09/26" — the ETA
    //   Delivery Appointment     set once a delivery is booked — firmest date
    //   Line Status              Backorder Hold | Backorder Available | Awaiting Shipping
    //   Product Status           Prod TBD | In Transit | On Hand | Expires
    //   Quantity Ordered / Reserved Quantity
    // ETA rule: Delivery Appointment, else Expected Available Date, else
    // Target Arrival Date. Several lines of one model on one PO are normal
    // (one row per unit) — the earliest date wins, per the general rule.
    hints: {
      po: [/^p\.?o\.?\s*#?$/i, /customer\s*po/i, /\bp\.?o\.?\s*(number|#|no)?\b/i, /purchase\s*order/i],
      model: [/^product\s*#?$/i, /\bmodel\b/i, /\bordered\s*item\b/i, /\bitem\b/i, /\bsku\b/i, /\bproduct\b/i],
      model2: [/^ordered\s*item$/i],
      eta: [/^expected\s*available\s*date$/i, /\b(est|estimated|expected|promise[d]?|sched\w*|projected)\b.*\b(ship|deliver|arrival|available|date)/i, /\beta\b/i, /\bship\s*date\b/i, /\bdelivery\s*date\b/i],
      rdd: [/^req\.?\s*delivery\s*date$/i, /\brequest(ed)?\b.*\b(delivery|ship|date)/i, /\breq\.?\s*(delivery|ship)/i, /\brdd\b/i, /\bwant(ed)?\s*date\b/i],
      qty: [/^quantity\s*ordered$/i, /\b(open|remaining|backorder\w*|order(ed)?)\s*(qty|quantity)\b/i, /\bqty\b/i, /\bquantity\b/i],
      status: [/^line\s*status$/i, /\bstatus\b/i]
    },
    derive({ row, headers, eta, status }) {
      const col = (re) => { const i = headers.findIndex((h) => re.test(h)); return i < 0 ? null : row[i]; };
      const appt = parseDate(col(/^delivery\s*appointment$/i));
      const target = parseDate(col(/^target\s*arrival\s*date$/i));
      const prod = cellText(col(/^product\s*status$/i));
      const reserved = Number(String(col(/^reserved\s*quantity$/i) ?? "").replace(/[^0-9.-]/g, ""));
      const notes = [];
      let out = eta;
      if (appt) { out = appt; notes.push(`GE delivery appointment ${mdy(appt)}${eta && eta !== appt ? ` (expected available ${mdy(eta)})` : ""}`); }
      else if (!out && target) { out = target; notes.push(`GE: no expected-available date — target arrival ${mdy(target)} used`); }
      else if (out && target && target !== out) notes.push(`GE expected available ${mdy(out)} (original target ${mdy(target)})`);
      const flags = [status, prod].filter(Boolean);
      if (flags.length) notes.push(`GE: ${flags.join(" · ")}${Number.isFinite(reserved) && reserved > 0 ? ` · ${reserved} reserved` : ""}`);
      return { eta: out, notes };
    }
  },
  {
    key: "bsh", label: "BSH (Bosch · Thermador · Gaggenau)",
    // BSH portal "order status" export (sample 2026-10-20): one row per
    // order item, serial-number continuation rows underneath with every
    // column blank except Delivery / Serial (skipped — no PO, no material).
    //   PO Number           our PO ("38835", "P230")
    //   Material            model code
    //   Pref. Delivery Date requested date, "AUG/07/2026"
    //   Estimated date      free text: "Estimated arrival of items:\r\n 1 pcs on NOV/05/2026"
    //                       or "Items in stock:\r\n 4 pcs on OCT/20/2026 \r\n 8 pcs on OCT/21/2026",
    //                       sometimes both blocks (part in stock, rest estimated)
    //   Delivery Status     "not confirmed" | "Delivery confirmed to the 10/30/2026"
    //                       | "to the 10/29/2026 3 unit(s) confirmed" | "Delivery completed"
    //   Req.Qty. / Conf.Qty.
    // ETA rule: a date in Delivery Status is BSH's commitment and wins;
    // otherwise the earliest date in the Estimated text (first units land).
    // "Delivery completed" rows are shipped and are left out.
    hints: {
      po: [/^po\s*number$/i, /customer\s*(po|reference|order)/i, /\bpo\s*(number|#|no)?\b/i, /purchase\s*order/i, /\byour\s*(reference|order)/i],
      model: [/^material$/i, /\bmaterial\b/i, /\bmodel\b/i, /\bitem\b/i, /\barticle\b/i, /\bsku\b/i],
      eta: [/^estimated\s*date$/i, /\b(est|estimated|expected|confirmed|planned|sched\w*)\b.*\b(ship|deliver|arrival|date)/i, /\beta\b/i, /\bdelivery\s*date\b/i, /\bship\s*date\b/i],
      rdd: [/^pref\.?\s*delivery\s*date$/i, /\bpref\w*\s*(delivery|ship)/i, /\brequest(ed)?\b.*\b(delivery|ship|date)/i, /\brdd\b/i, /\bwish\s*date\b/i, /\bwant(ed)?\s*date\b/i],
      qty: [/^req\.?\s*qty\.?$/i, /\b(open|remaining|backorder\w*|order(ed)?|req\w*)\s*(qty|quantity)\b/i, /\bqty\b/i, /\bquantity\b/i],
      status: [/^delivery\s*status$/i, /\bstatus\b/i]
    },
    derive({ etaRaw, status }) {
      const notes = [];
      if (/delivery\s+completed/i.test(status)) return { skip: "delivered", notes };
      const confirmed = status.match(/to the\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
      const parts = datesInText(etaRaw);
      if (confirmed) {
        const eta = parseDate(confirmed[1]);
        const units = status.match(/(\d+)\s*unit/i);
        if (eta) notes.push(`BSH confirmed ${mdy(eta)}${units ? ` for ${units[1]} unit(s)` : ""}${parts.length ? `; estimated: ${parts.map((p) => `${p.qty ?? "?"} on ${mdy(p.date)}`).join(", ")}` : ""}`);
        return { eta, notes };
      }
      if (parts.length) {
        const eta = parts.map((p) => p.date).sort()[0];
        if (parts.length > 1) notes.push(`BSH estimate in parts — earliest used: ${parts.map((p) => `${p.qty ?? "?"} on ${mdy(p.date)}${p.stock ? " (in stock)" : ""}`).join(", ")}`);
        else if (parts[0].stock) notes.push("BSH: in stock, not yet confirmed");
        else notes.push("BSH estimated arrival, not yet confirmed");
        return { eta, notes };
      }
      return { eta: "", notes };
    }
  },
  {
    key: "szwc", label: "Sub-Zero · Wolf · Cove",
    // Sub-Zero Group "Open Orders Detail" CSV (sample 2026-10-20): a title
    // block (customer, run time, search criteria) then the grid on row 8,
    // ending with "Day Total" rows. One row per order line.
    //   P.O. Number               our PO ("39698")
    //   Item                      Sub-Zero's item number ("5910009") — alt. model
    //   Item Description          the model as we know it ("DW2451", "CL4850UFD/O",
    //                             "ID-24R") or an accessory description
    //                             ("KIT,PNL,ASSY,24,4,PH") — primary model
    //   Request Date              requested date
    //   Estimated Available Date  the ETA (blank on a rare line)
    //   Open Qty / Promise Qty / Ship Qty
    //   Shipping Instruction      "Delivered" = delivery method, NOT a status
    hints: {
      po: [/^p\.?o\.?\s*number$/i, /customer\s*po/i, /\bp\.?o\.?\s*(number|#|no)?\b/i, /purchase\s*order/i, /\bdealer\s*(po|order)/i],
      model: [/^item\s*description$/i, /\bmodel\b/i, /\bproduct\b/i, /\bsku\b/i, /\bitem\b/i],
      model2: [/^item$/i, /\bitem\s*(number|#|no)\b/i],
      eta: [/^estimated\s*available\s*date$/i, /\b(est|estimated|expected|sched\w*|projected|promise[d]?)\b.*\b(ship|deliver|arrival|available|date)/i, /\beta\b/i, /\bship\s*date\b/i, /\bdelivery\s*date\b/i],
      rdd: [/^request\s*date$/i, /\brequest(ed)?\b.*\b(delivery|ship|date)/i, /\brdd\b/i, /\bwant(ed)?\s*date\b/i],
      qty: [/^open\s*qty\.?$/i, /\b(open|remaining|backorder\w*|order(ed)?)\s*qty\b/i, /\bqty\b/i, /\bquantity\b/i],
      status: [/^(line|order)\s*status$/i]
    },
    // Sub-Zero delivers to Wilson on Thursdays. Their Request Date is the
    // Tuesday their warehouse picks for that Thursday's truck, so ePASS gets
    // the pick date + 2 business days (Tue -> Thu; a Monday pick in a holiday
    // week -> Wed; Thu -> Mon). The Estimated Available Date is the same kind
    // of warehouse date and gets the same +2 (10/21). A month-only estimate
    // becomes the third Thursday of that month (Andrew 10/20).
    derive({ row, headers, eta, etaRaw, rdd }) {
      const col = (re) => { const i = headers.findIndex((h) => re.test(h)); return i < 0 ? null : row[i]; };
      const promise = Number(col(/^promise\s*qty$/i)); const open = Number(col(/^open\s*qty$/i)); const shipped = Number(col(/^ship\s*qty$/i));
      const comment = cellText(col(/^comments?$/i));
      const notes = []; const out = {};
      if (etaRaw && !parseDate(etaRaw) && monthOnly(etaRaw)) {
        out.eta = thirdThursday(monthOnly(etaRaw));
        notes.push(`Sub-Zero gave a month only ("${etaRaw}") — third Thursday ${mdy(out.eta)} used (Thursday trucks)`);
      } else if (eta) {
        // A full Estimated Available Date is when their warehouse has it,
        // same as the request date - the truck is two business days later
        // (Andrew 10/21: ePASS should show the day it lands at Wilson).
        out.eta = addBusinessDays(eta, 2);
        notes.push(`Sub-Zero available ${mdy(eta)} (${DAY_NAMES[weekdayOf(eta)]}) — truck two business days later, ETA ${mdy(out.eta)} written`);
      }
      if (rdd) {
        const dow = weekdayOf(rdd);
        out.rdd = addBusinessDays(rdd, 2);
        if (dow === 2) notes.push(`Sub-Zero request date ${mdy(rdd)} is the Tuesday pick — Thursday truck ${mdy(out.rdd)} written`);
        else if (dow === 1) notes.push(`Sub-Zero request date ${mdy(rdd)} is a Monday pick (holiday week) — Wednesday truck ${mdy(out.rdd)} written`);
        else notes.push(`Sub-Zero request date ${mdy(rdd)} is a ${DAY_NAMES[dow]} pick — truck two business days later, ${mdy(out.rdd)} written`);
      }
      if (Number.isFinite(promise) && Number.isFinite(open) && promise < open) notes.push(`Sub-Zero: ${promise} of ${open} promised`);
      if (Number.isFinite(shipped) && shipped > 0) notes.push(`Sub-Zero: ${shipped} shipped`);
      if (comment) notes.push(`Sub-Zero comment: ${comment}`);
      return { ...out, notes };
    }
  },
  {
    key: "other", label: "Other vendor (map the columns)",
    hints: {
      po: [/customer\s*po/i, /\bpo\s*(number|#|no)?\b/i, /purchase\s*order/i],
      model: [/\bmodel\b/i, /\bmaterial\b/i, /\bitem\b/i, /\bsku\b/i, /\bproduct\b/i],
      eta: [/\b(est|estimated|expected|revised|sched\w*|projected|promise[d]?|confirmed)\b.*\b(ship|deliver|arrival|date)/i, /\beta\b/i, /\bship\s*date\b/i, /\bdelivery\s*date\b/i],
      rdd: [/\brequest(ed)?\b.*\b(delivery|ship|date)/i, /\brdd\b/i, /\bwant(ed)?\s*date\b/i],
      qty: [/\b(open|remaining|backorder\w*|order(ed)?)\s*qty\b/i, /\bqty\b/i, /\bquantity\b/i],
      status: [/\bstatus\b/i]
    }
  }
];
export const FIELDS = ["po", "model", "model2", "eta", "rdd", "qty", "status"];
export const vendorByKey = (key) => VENDORS.find((v) => v.key === String(key || "").toLowerCase()) || VENDORS[VENDORS.length - 1];

// ---- normalisation -------------------------------------------------------
export const normPo = (v) => String(v == null ? "" : v).trim().toUpperCase();
export const alnum = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
const cellText = (v) => v == null ? "" : (v instanceof Date ? isoDay(v) : String(v).trim());

export function isoDay(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  // Workbook dates are read as UTC-midnight; take the UTC fields so the day never slips.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const valid = (y, m, d) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : "";

// Anything a portal might put in a date cell -> YYYY-MM-DD, or "" when it is
// not a date (blank, "TBD", "Backordered", "-", ...).
export function parseDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return isoDay(v);
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) { // Excel serial
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isoDay(d);
    }
    return "";
  }
  const s = String(v).trim();
  if (!s) return "";
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ ,T].*)?$/))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(y, +m[1], +m[2]);
  }
  if ((m = s.match(/^(\d{1,2})[ \-]([A-Za-z]{3,5})[ \-,]+(\d{2,4})(?:[ ,T].*)?$/))) {
    const mo = MONTHS[m[2].toLowerCase()]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return mo ? valid(y, mo, +m[1]) : "";
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?[\/ .-]+(\d{1,2}),?[\/ .-]+(\d{4})(?:[ ,T].*)?$/))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo ? valid(+m[3], mo, +m[2]) : "";
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return valid(+m[1], +m[2], +m[3]);
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /\d{4}/.test(s)) { const d = new Date(t); return valid(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  return "";
}
export const mdy = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "";

// "02/2027", "2027-02", "Feb 2027", "February/2027" -> first of that month.
export function monthOnly(v) {
  const t = String(v == null ? "" : v).trim(); let m;
  if ((m = t.match(/^(\d{1,2})[\/.-](\d{4})$/))) return valid(+m[2], +m[1], 1);
  if ((m = t.match(/^(\d{4})[\/.-](\d{1,2})$/))) return valid(+m[1], +m[2], 1);
  if ((m = t.match(/^([A-Za-z]{3,9})\.?[\/ .-]+(\d{4})$/))) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; return mo ? valid(+m[2], mo, 1) : ""; }
  return "";
}

// Calendar helpers on YYYY-MM-DD strings (UTC, so no DST surprises).
export const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
export const addDays = (iso, n) => isoDay(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000));
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function addBusinessDays(iso, n) {
  let d = iso; let left = n;
  while (left > 0) { d = addDays(d, 1); const w = weekdayOf(d); if (w !== 0 && w !== 6) left--; }
  return d;
}
// Third Thursday of the month that holds `iso`.
export function thirdThursday(iso) {
  const first = `${iso.slice(0, 7)}-01`;
  const offset = (4 - weekdayOf(first) + 7) % 7; // days from the 1st to the first Thursday
  return addDays(first, offset + 14);
}

// Every date hiding in a free-text cell ("4 pcs on OCT/20/2026 / 8 pcs on
// OCT/21/2026", "Items in stock: ..."), with the quantity in front of it when
// there is one. Used when a vendor's "date" column is really a paragraph.
const DATE_TOKEN = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|[A-Za-z]{3,9}[\/ .-]+\d{1,2},?[\/ .-]+\d{4}|\d{1,2}[ -][A-Za-z]{3,5}[ -,]+\d{2,4})/g;
export function datesInText(text) {
  const s = String(text || ""); if (!s) return [];
  const out = []; let m; let lastLabel = "";
  const labels = [...s.matchAll(/(items? in stock|estimated arrival[^:]*|confirmed|expected|available)\s*:?/gi)].map((x) => ({ i: x.index, stock: /stock|available/i.test(x[1]) }));
  while ((m = DATE_TOKEN.exec(s))) {
    const date = parseDate(m[1]); if (!date) continue;
    const before = s.slice(Math.max(0, m.index - 24), m.index);
    const q = before.match(/(\d+)\s*(pcs?|pieces?|units?|unit\(s\)|ea)?\s*(on|by|for)?\s*$/i);
    const lab = labels.filter((l) => l.i < m.index).pop();
    lastLabel = lab ? (lab.stock ? "stock" : "est") : lastLabel;
    out.push({ date, qty: q ? Number(q[1]) : null, stock: lastLabel === "stock" });
  }
  return out;
}

// ---- 1. read the portal export -------------------------------------------
export function readVendorWorkbook(buffer, filename = "") {
  if (!buffer || !buffer.length) throw new Error("The export file is empty.");
  let wb;
  try { wb = readWorkbook(buffer, { type: "buffer", cellDates: true, raw: false }); }
  catch (err) { throw new Error(`Could not read ${filename || "that file"} as a workbook or CSV: ${err.message}`); }
  const sheets = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const grid = xlsxUtils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (!grid.length) continue;
    const headerRow = findHeaderRow(grid);
    if (headerRow < 0) continue;
    const headerCells = grid[headerRow] || [];
    const isTotals = (r) => { const first = r.find((c) => c != null && String(c).trim() !== ""); return /^[a-z ]*totals?\s*:?$/i.test(String(first ?? "").trim()); };
    const kept = grid.slice(headerRow + 1).map((r, i) => ({ n: headerRow + i + 2, r: r || [] })).filter(({ r }) => r.some((c) => c != null && String(c).trim() !== "") && !isTotals(r));
    const width = Math.max(headerCells.length, ...kept.map(({ r }) => r.length));
    // Merged-cell exports (Whirlpool's portal) are the ugly case: a heading
    // merged across N:P while the value underneath is merged across M:P, the
    // next heading S:T with its value in T:U, and so on — nothing lines up.
    // So every merged range on the header row becomes one logical column,
    // and on each data row every cell (or merged range) is handed to the
    // heading whose span sits closest to it. Columns outside every heading
    // span stay single; a header-less one survives only when more than half
    // the rows use it. Each logical column keeps its real sheet letter.
    const merges = ws["!merges"] || [];
    const spans = []; const covered = new Set();
    for (const m of merges) {
      if (m.s.r !== headerRow || m.e.c <= m.s.c) continue;
      const cols = []; for (let c = m.s.c; c <= m.e.c; c++) { cols.push(c); covered.add(c); }
      spans.push(cols);
    }
    for (let c = 0; c < width; c++) if (!covered.has(c)) spans.push([c]);
    spans.sort((x, y) => x[0] - y[0]);
    const centre = (cols) => (cols[0] + cols[cols.length - 1]) / 2;
    const mergesByRow = new Map();
    for (const m of merges) { if (m.e.c > m.s.c) { if (!mergesByRow.has(m.s.r)) mergesByRow.set(m.s.r, []); mergesByRow.get(m.s.r).push([m.s.c, m.e.c]); } }
    // One logical row: value per heading span.
    const logical = (r, rowIdx) => {
      const out = new Array(spans.length).fill(null);
      const rowMerges = mergesByRow.get(rowIdx) || [];
      for (let c = 0; c < width; c++) {
        const v = r[c]; if (v == null || String(v).trim() === "") continue;
        const mr = rowMerges.find((m) => m[0] === c);
        const cols = mr ? [mr[0], mr[1]] : [c, c];
        let best = -1; let bestScore = Infinity;
        spans.forEach((sp, i) => {
          const lo = Math.max(cols[0], sp[0]); const hi = Math.min(cols[1], sp[sp.length - 1]);
          if (hi < lo) return; // no overlap
          const score = Math.abs(centre(sp) - (cols[0] + cols[1]) / 2) - (hi - lo + 1) * 0.01;
          if (score < bestScore) { bestScore = score; best = i; }
        });
        if (best >= 0 && out[best] == null) out[best] = v;
      }
      return out;
    };
    const headerLogical = logical(headerCells, headerRow);
    const rowsLogical = kept.map(({ r, n }) => logical(r, n - 1));
    const colIndex = []; const headers = []; const letters = [];
    spans.forEach((cols, i) => {
      const h = cellText(headerLogical[i]);
      const filled = rowsLogical.filter((lr) => lr[i] != null).length;
      if (!h && !(kept.length && filled > kept.length / 2)) return;
      colIndex.push(i); headers.push(h || `Column ${colLetter(cols[0])}`); letters.push(colLetter(cols[0]));
    });
    sheets.push({ name, headerRow, headers, letters, rowCount: kept.length, rowNumbers: kept.map((k) => k.n), rows: rowsLogical.map((lr) => colIndex.map((i) => lr[i])) });
  }
  if (!sheets.length) throw new Error(`No rows with a header line found in ${filename || "that file"}.`);
  return { filename, sheets };
}
export const colLetter = (i) => { let s = ""; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

// The header is the first row where most cells are short text and at least
// three are filled (portals love a title block above the grid).
// The header is the row (in the first 40) with the most short-text cells —
// numbers, dates and long sentences ("Please note: ...") do not count, so a
// title block, account line or totals strip above the grid loses to it, and
// data rows (numbers, dates, codes) never beat it. Ties go to the earlier row.
function findHeaderRow(grid) {
  const limit = Math.min(grid.length, 40);
  let best = -1; let bestN = 0;
  for (let i = 0; i < limit; i++) {
    const cells = (grid[i] || []).filter((c) => c != null && String(c).trim() !== "");
    if (cells.length < 3) continue;
    const texty = cells.filter((c) => typeof c === "string" && c.trim().length <= 48 && !/^[\d.,\s-]+$/.test(c.trim()) && !parseDate(c.trim())).length;
    if (texty >= 3 && texty > bestN) { best = i; bestN = texty; }
  }
  return best >= 0 ? best : (grid.length ? 0 : -1);
}

// ---- 2. which column is which ---------------------------------------------
export function guessMapping(headers, vendorKey = "other", sampleRows = []) {
  const vendor = vendorByKey(vendorKey);
  const mapping = {}; const used = new Set();
  const pick = (field) => {
    for (const re of vendor.hints[field] || []) {
      const idx = headers.findIndex((h, i) => !used.has(i) && re.test(h));
      if (idx >= 0) { used.add(idx); return idx; }
    }
    return null;
  };
  // Dates first so "Requested Ship Date" is not swallowed by a loose ETA pattern.
  mapping.rdd = pick("rdd");
  mapping.eta = pick("eta");
  mapping.po = pick("po");
  mapping.model = pick("model");
  mapping.model2 = pick("model2");
  mapping.qty = pick("qty");
  mapping.status = pick("status");
  // Fallbacks from the data itself when the headers were no help.
  if (mapping.eta == null || mapping.po == null || mapping.model == null) {
    const scores = headers.map((_, i) => used.has(i) ? null : columnProfile(sampleRows, i));
    if (mapping.eta == null) { const i = best(scores, "date"); if (i != null) { mapping.eta = i; used.add(i); scores[i] = null; } }
    if (mapping.po == null) { const i = best(scores, "po"); if (i != null) { mapping.po = i; used.add(i); scores[i] = null; } }
    if (mapping.model == null) { const i = best(scores, "model"); if (i != null) { mapping.model = i; used.add(i); scores[i] = null; } }
  }
  return mapping;
}
function columnProfile(rows, i) {
  const vals = rows.slice(0, 60).map((r) => r[i]).filter((v) => v != null && String(v).trim() !== "");
  if (!vals.length) return { date: 0, po: 0, model: 0 };
  const n = vals.length;
  const date = vals.filter((v) => parseDate(v)).length / n;
  const po = vals.filter((v) => /^[A-Z]{0,3}\d{4,}(-\d+)?$/i.test(String(v).trim())).length / n;
  const model = vals.filter((v) => /^[A-Z]{1,5}\d{2,}[A-Z0-9-]*$/i.test(String(v).trim()) && !/^\d+$/.test(String(v).trim())).length / n;
  return { date, po, model };
}
function best(scores, kind) {
  let bi = null; let bs = 0.6;
  scores.forEach((s, i) => { if (s && s[kind] > bs) { bs = s[kind]; bi = i; } });
  return bi;
}
export function headerSignature(headers) {
  return headers.map((h) => String(h || "").trim().toLowerCase()).join("|");
}
// A saved vendor map is reused when the file's headers still line up with it
// (same names in the same places); otherwise we re-guess and the buyer checks.
export function applySavedMapping(headers, saved) {
  if (!saved || !saved.mapping) return null;
  if (saved.headersSig && saved.headersSig === headerSignature(headers)) return { ...saved.mapping };
  const names = saved.headerNames || {};
  const out = {}; let hits = 0;
  for (const f of FIELDS) {
    const want = names[f]; if (!want) { out[f] = null; continue; }
    const idx = headers.findIndex((h) => String(h).trim().toLowerCase() === String(want).trim().toLowerCase());
    out[f] = idx >= 0 ? idx : null; if (idx >= 0) hits++;
  }
  return hits >= 3 && out.po != null && out.model != null ? out : null;
}

// ---- 3. typed rows --------------------------------------------------------
export function extractRows(sheet, mapping, vendorKey = "other") {
  if (mapping.po == null || mapping.model == null) throw new Error("Pick the PO # column and the model column first.");
  if (mapping.eta == null && mapping.rdd == null) throw new Error("Pick at least one date column (ETA or requested delivery).");
  const vendor = vendorByKey(vendorKey);
  const get = (r, f) => mapping[f] == null ? null : r[mapping[f]];
  const out = [];
  sheet.rows.forEach((r, i) => {
    const po = cellText(get(r, "po")); const model = cellText(get(r, "model")); const model2 = cellText(get(r, "model2"));
    if (!po && !model) return; // continuation rows (BSH serial lines) carry neither
    const qtyRaw = get(r, "qty");
    const qty = qtyRaw == null || qtyRaw === "" ? null : Number(String(qtyRaw).replace(/[^0-9.-]/g, ""));
    const etaRaw = cellText(get(r, "eta")); const rddRaw = cellText(get(r, "rdd")); const status = cellText(get(r, "status"));
    let eta = parseDate(get(r, "eta")); let rdd = parseDate(get(r, "rdd"));
    const notes = []; let skip = "";
    if (!eta && etaRaw) { // a paragraph instead of a date: earliest date in it
      const parts = datesInText(etaRaw);
      if (parts.length) { eta = parts.map((p) => p.date).sort()[0]; if (parts.length > 1) notes.push(`several dates in the ETA cell — earliest used: ${parts.map((p) => `${p.qty ?? "?"} on ${mdy(p.date)}`).join(", ")}`); }
    }
    if (!eta && etaRaw) { // month-only estimate ("02/2027", "Feb 2027") -> the 1st of that month
      const mo = monthOnly(etaRaw);
      if (mo) { eta = mo; notes.push(`vendor gave a month only ("${etaRaw}") — the 1st of that month is used`); }
    }
    if (!rdd && rddRaw) { const parts = datesInText(rddRaw); if (parts.length) rdd = parts.map((p) => p.date).sort()[0]; }
    if (typeof vendor.derive === "function") {
      const d = vendor.derive({ etaRaw, rddRaw, status, eta, rdd, row: r, headers: sheet.headers, mapping }) || {};
      if (d.skip) skip = d.skip;
      if (d.eta !== undefined) eta = d.eta;
      if (d.rdd !== undefined) rdd = d.rdd;
      if (Array.isArray(d.notes) && d.notes.length) { notes.length = 0; notes.push(...d.notes); }
    }
    out.push({
      row: sheet.rowNumbers ? sheet.rowNumbers[i] : sheet.headerRow + i + 2, // 1-based sheet row for the buyer
      po, model, model2, eta, etaRaw, rdd, rddRaw,
      qty: Number.isFinite(qty) ? qty : null,
      status, skip, notes
    });
  });
  return out;
}

// ---- 4. match against ePASS open PO lines ---------------------------------
const CANCEL_RE = /\b(cancel+ed|cancelled|void(ed)?|closed|deleted|rejected)\b/i;

export function matchRows({ rows, openLines, vendorKey = "other", today = "" }) {
  const vendor = vendorByKey(vendorKey);
  const byPo = new Map(); const byPoAlnum = new Map();
  for (const l of openLines || []) {
    const code = normPo(l.po_code); if (!code) continue;
    if (!byPo.has(code)) byPo.set(code, []); byPo.get(code).push(l);
    const a = alnum(code); if (!byPoAlnum.has(a)) byPoAlnum.set(a, []); byPoAlnum.get(a).push(l);
  }
  const poKeysAlnum = [...byPoAlnum.keys()].filter((k) => k.length >= 4);

  // Collapse the vendor's rows to one per PO+model (split shipments show
  // as several rows); the earliest ETA wins because that is when the first
  // unit lands and the job can be scheduled.
  const groups = new Map();
  for (const r of rows) {
    const key = `${alnum(r.po)}|${alnum(r.model)}`;
    if (!groups.has(key)) groups.set(key, { first: r, rows: [] });
    groups.get(key).rows.push(r);
  }

  const out = [];
  for (const { first, rows: grp } of groups.values()) {
    const notes = [...new Set(grp.flatMap((r) => r.notes || []))];
    const delivered = grp.every((r) => r.skip === "delivered");
    const cancelled = !delivered && grp.every((r) => r.skip === "cancelled" || (r.status && CANCEL_RE.test(r.status)));
    const live = grp.filter((r) => !r.skip && !(r.status && CANCEL_RE.test(r.status)));
    const use = live.length ? live : grp;
    const etas = use.map((r) => r.eta).filter(Boolean).sort();
    const rdds = use.map((r) => r.rdd).filter(Boolean).sort();
    const eta = etas[0] || ""; const rdd = rdds[0] || "";
    if (grp.length > 1) notes.push(`${grp.length} vendor rows for this PO + model${etas.length > 1 && etas[0] !== etas[etas.length - 1] ? ` — earliest ETA used (${etas.map(mdy).join(", ")})` : ""}`);
    if (use.some((r) => r.etaRaw && !r.eta)) notes.push(`vendor ETA cell says "${use.find((r) => r.etaRaw && !r.eta).etaRaw}"`);

    const poMatch = findPo(first.po, byPo, byPoAlnum, poKeysAlnum);
    const base = { po: first.po, model: first.model, vendorEta: eta, vendorRdd: rdd, qty: first.qty, status: first.status, rows: grp.map((r) => r.row), notes, lines: [], epassPo: "", epassModel: "", epassEta: "", epassRdd: "", supplier: "", qtyOpen: null, newEta: eta, newRdd: rdd };
    if (delivered) { out.push({ ...base, state: "delivered", include: false }); continue; }
    if (cancelled) { out.push({ ...base, state: "cancelled", include: false }); continue; }
    if (!poMatch) { out.push({ ...base, state: "no-po", include: false, notes: [...notes, "PO is not an open PO in the ePASS feed (received, closed, or typed differently on the portal)"] }); continue; }
    if (poMatch.how !== "exact") notes.push(`PO matched ${poMatch.how}: portal "${first.po}" → ePASS ${poMatch.code}`);
    let lines = findModel(first.model, poMatch.lines);
    if (!lines.length && first.model2) { lines = findModel(first.model2, poMatch.lines); if (lines.length) notes.push(`model matched by the vendor's item # ${first.model2}`); }
    if (!lines.length) {
      out.push({ ...base, state: "no-model", include: false, epassPo: poMatch.code, supplier: poMatch.lines[0]?.supplier_code || "", notes: [...notes, `model is not an open line on ${poMatch.code} (open: ${[...new Set(poMatch.lines.map((l) => l.model_code))].slice(0, 6).join(", ")})`] });
      continue;
    }
    const l0 = lines[0];
    const epassEta = lines.map((l) => l.eta || "").filter(Boolean).sort()[0] || "";
    const epassRdd = lines.map((l) => l.rdd || "").filter(Boolean).sort()[0] || "";
    const qtyOpen = lines.reduce((s, l) => s + (Number(l.qty_open) || 0), 0);
    if (l0.model_code !== first.model.trim().toUpperCase()) notes.push(`model matched as ePASS ${l0.model_code}`);
    if (lines.length > 1) notes.push(`${lines.length} open lines for this model on the PO — the ePASS import updates them all`);
    const newEta = eta; // never invent an ETA
    const newRdd = rdd || epassRdd; // keep ePASS's requested date when the portal has none
    if (!newEta) { out.push({ ...base, state: "no-eta", include: false, lines, epassPo: poMatch.code, epassModel: l0.model_code, epassEta, epassRdd, supplier: l0.supplier_code || "", qtyOpen, newEta, newRdd, notes: [...notes, "no ETA from the vendor on this line"] }); continue; }
    const changed = newEta !== epassEta || (newRdd && newRdd !== epassRdd);
    if (today && newEta < today) notes.push("vendor ETA is already in the past");
    out.push({ ...base, state: changed ? "changed" : "same", include: changed, lines, epassPo: poMatch.code, epassModel: l0.model_code, epassEta, epassRdd, supplier: l0.supplier_code || "", qtyOpen, newEta, newRdd });
  }
  out.sort((a, b) => rank(a.state) - rank(b.state) || a.po.localeCompare(b.po) || a.model.localeCompare(b.model));
  const summary = { total: out.length, changed: 0, same: 0, "no-po": 0, "no-model": 0, "no-eta": 0, cancelled: 0, delivered: 0 };
  for (const r of out) summary[r.state] = (summary[r.state] || 0) + 1;
  return { rows: out, summary, vendor: vendor.key };
}
const rank = (s) => ({ changed: 0, "no-eta": 1, "no-model": 2, "no-po": 3, same: 4, cancelled: 5, delivered: 6 })[s] ?? 9;

function findPo(raw, byPo, byPoAlnum, poKeysAlnum) {
  const code = normPo(raw); if (!code) return null;
  if (byPo.has(code)) return { code, lines: byPo.get(code), how: "exact" };
  const a = alnum(code);
  if (byPoAlnum.has(a)) return { code: normPo(byPoAlnum.get(a)[0].po_code), lines: byPoAlnum.get(a), how: "ignoring punctuation" };
  const stripped = a.replace(/^0+/, "");
  if (stripped !== a && byPoAlnum.has(stripped)) return { code: normPo(byPoAlnum.get(stripped)[0].po_code), lines: byPoAlnum.get(stripped), how: "without leading zeros" };
  // Portals pad ("PO0012345"), suffix ("12345-1", "12345/2") or prefix our number.
  const hits = poKeysAlnum.filter((k) => a.length > k.length && (a.endsWith(k) || a.startsWith(k) || a.includes(k)));
  if (hits.length === 1) return { code: normPo(byPoAlnum.get(hits[0])[0].po_code), lines: byPoAlnum.get(hits[0]), how: "by containing our PO number" };
  return null;
}
function findModel(raw, lines) {
  const want = String(raw || "").trim().toUpperCase(); if (!want) return [];
  let hit = lines.filter((l) => String(l.model_code || "").toUpperCase() === want);
  if (hit.length) return hit;
  const a = alnum(want);
  hit = lines.filter((l) => alnum(l.model_code) === a);
  if (hit.length) return hit;
  // Colour / revision suffixes: WRX735SDHZ00 vs WRX735SDHZ, or the portal's short code.
  const models = [...new Set(lines.map((l) => alnum(l.model_code)))];
  const pref = models.filter((m) => m.length >= 5 && a.length >= 5 && (a.startsWith(m) || m.startsWith(a)));
  if (pref.length === 1) return lines.filter((l) => alnum(l.model_code) === pref[0]);
  return [];
}

// ---- 5. the ePASS import file ---------------------------------------------
// Four columns, no header, one row per PO + model. Dates are real Excel dates
// shown as mm/dd/yyyy; `datesAsText` writes the string instead if the utility
// insists on text.
export const IMPORT_FORMATS = {
  csv: { ext: "csv", mime: "text/csv; charset=utf-8", label: "CSV" },
  xls: { ext: "xls", mime: "application/vnd.ms-excel", label: "Excel 97-2003 (.xls)" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel (.xlsx)" }
};
// `format`: csv (default — ePASS's utility read .xlsx as a blank form,
// Andrew 10/20), xls (the old binary workbook), xlsx. `header` adds a
// title row (off by default — the utility is driven by column letters).
// `datesAsText` only matters for the Excel formats: real dates shown as
// mm/dd/yyyy, or the text "mm/dd/yyyy"; CSV is always text.
export function buildImportFile(rows, { format = "csv", header = false, datesAsText = false } = {}) {
  const clean = rows.filter((r) => r && r.po && r.model && r.eta);
  if (!clean.length) throw new Error("Nothing to import — no rows with a PO, model and ETA.");
  const fmt = IMPORT_FORMATS[format] ? format : "csv";
  const HEAD = ["PO", "Model", "ETA", "ReqDelivery"];
  const lines = clean.map((r) => [String(r.po).trim(), String(r.model).trim().toUpperCase(), r.eta, r.rdd || ""]);
  if (fmt === "csv") {
    const q = (v) => { const t = String(v ?? ""); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const out = (header ? [HEAD] : []).concat(lines.map((l) => [l[0], l[1], mdy(l[2]), mdy(l[3])]));
    return { buffer: Buffer.from(out.map((l) => l.map(q).join(",")).join("\r\n") + "\r\n", "utf8"), rows: clean.length, format: fmt, ...IMPORT_FORMATS[fmt] };
  }
  const toCell = (iso) => {
    if (!iso) return "";
    if (datesAsText) return mdy(iso);
    return { v: new Date(`${iso}T00:00:00Z`), t: "d", z: "mm/dd/yyyy" };
  };
  const aoa = (header ? [HEAD] : []).concat(lines.map((l) => [l[0], l[1], toCell(l[2]), toCell(l[3])]));
  const ws = xlsxUtils.aoa_to_sheet(aoa, { cellDates: true });
  if (!datesAsText) {
    for (let i = 0; i < aoa.length; i++) {
      for (const col of ["C", "D"]) { const cell = ws[`${col}${i + 1}`]; if (cell && cell.t === "d") cell.z = "mm/dd/yyyy"; }
    }
  }
  ws["!cols"] = [{ wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 }];
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, ws, "ETA Import");
  return { buffer: writeWorkbook(wb, { type: "buffer", bookType: fmt === "xls" ? "biff8" : "xlsx", cellDates: true }), rows: clean.length, format: fmt, ...IMPORT_FORMATS[fmt] };
}
// Kept for callers that only know the workbook form.
export function buildImportWorkbook(rows, { datesAsText = false } = {}) {
  return buildImportFile(rows, { format: "xlsx", datesAsText });
}
