// ---------------------------------------------------------------------------
// Sales invoice / sales order PDF scanner for Send a Payment Link.
//
// Reads the ePASS retail invoice print (the "INVOICE" sheet with Bill To /
// Ship To, the Customer # / Payment Type / Salesperson strip, the QTY /
// MODEL # / DESCRIPTION / PRICE / EXT PRICE table and the SUB TOTAL / TAX /
// INVOICE TOTAL / DEPOSITS / BALANCE block) and returns what the payment-link
// form needs prefilled: order number, client, phone, amount, a description,
// the salesperson, and the lines so the team can eyeball the scan.
//
// Nothing here creates a link or contacts anyone — it fills a form the team
// still reviews and submits.
// ---------------------------------------------------------------------------
import { pdfTextRowsAny, moneyOf, normPhone, properCase, flipName } from "./service-estimates-postgres.js";

const ORDER_RE = /^[RS]\d{6,}(?:-\d{1,2})?$/i;

function cellAfter(rows, labelRe) {
  for (const r of rows) {
    const i = r.cells.findIndex((c) => labelRe.test(c.t.trim()));
    if (i >= 0) {
      const next = r.cells[i + 1];
      if (next) return next.t.trim();
    }
  }
  return "";
}

// Value printed on the row BELOW a header strip label, in the same column.
function valueBelow(rows, labelRe, tolerance = 900) {
  for (const r of rows) {
    const label = r.cells.find((c) => labelRe.test(c.t.trim()));
    if (!label) continue;
    const below = rows
      .filter((o) => o.page === r.page && o.y < r.y && o.y > r.y - 700)
      .sort((a, b) => b.y - a.y);
    for (const o of below) {
      const hit = o.cells.find((c) => Math.abs(c.x - label.x) < tolerance && c.t.trim());
      if (hit) return hit.t.trim();
    }
  }
  return "";
}

// Street-type words dropped from the description address ("4424 BOB WIRE RD"
// → "4424 Bob Wire"). Anything after the type (unit, apt, #) goes with it.
const STREET_TYPES = new Set(["RD","ROAD","DR","DRIVE","AVE","AV","AVENUE","CIR","CIRCLE","ST","STREET","LN","LANE","BLVD","BOULEVARD","CT","COURT","WAY","PL","PLACE","TRL","TRAIL","PKWY","PARKWAY","HWY","HIGHWAY","LOOP","CV","COVE","TER","TERR","TERRACE","TRCE","TRACE","PASS","PATH","RUN","XING","CROSSING","BND","BEND","HOLW","HOLLOW","PT","POINT","RDG","RIDGE","VW","VIEW","CRK","CREEK","PARK","SQ","SQUARE","ROW","WALK","CRES","CRESCENT","MNR","MANOR","EST","ESTATES","GLN","GLEN","VLY","VALLEY","MDW","MEADOW","MDWS","MEADOWS","HTS","HEIGHTS","EXPY","FM","CR"]);

export function shortStreet(street) {
  let words = String(street || "").trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.,]+$/, ""));
  if (!words.length) return "";
  // drop a trailing unit: "#12", "APT 4", "UNIT B", "STE 100"
  const unitAt = words.findIndex((w, i) => i > 0 && /^(#|APT|UNIT|STE|SUITE|BLDG|LOT)/i.test(w));
  if (unitAt > 0) words = words.slice(0, unitAt);
  // drop the street type only when it's the last word ("Bob Wire Rd" → "Bob
  // Wire"); "Sunset Ridge Cir" keeps Ridge, "Hwy 290" / "Ranch Road 12" keep
  // the numbered route.
  if (words.length > 2 && STREET_TYPES.has(words[words.length - 1].toUpperCase())) words = words.slice(0, -1);
  return words.map((w, i) => (i === 0 && /^\d/.test(w)) || /^[NSEW]{1,2}$/i.test(w) || /^(FM|CR|RR)$/i.test(w) ? w.toUpperCase() : properCase(w)).join(" ");
}

// Street line of the Ship To block (falls back to Bill To): the first
// "number + words" row under the label in that column.
function addressOf(rows, labelRe, colMin, colMax) {
  const label = rows.find((r) => r.cells.some((c) => labelRe.test(c.t.trim())));
  if (!label) return "";
  const below = rows.filter((r) => r.page === label.page && r.y < label.y && r.y > label.y - 900).sort((a, b) => b.y - a.y);
  for (const r of below) {
    const c = r.cells.find((c) => c.x >= colMin && c.x < colMax && /^\d+[A-Z]?\s+\S/.test(c.t.trim()) && !/^\d{10}$/.test(c.t.trim()));
    if (c) return c.t.trim().replace(/\s{2,}/g, " ");
  }
  return "";
}

// ePASS classification → the plain product name the client would use.
// "LG HOME APPLIANCES, WASHER/DRYER COMBO, Black S" → "Laundry Center".
// Unmatched categories fall through as the ePASS wording, proper-cased.
const CATEGORY_NAMES = [
  // Order matters: the specific product before the word it contains
  // (DISHWASHER before WASHER, MICROWAVE before OVEN, RANGE HOOD before
  // RANGE, WINE REFRIGERATOR before REFRIGERATOR) - 9/25, dishwashers were
  // landing as "Washer".
  [/DISHWASHER|DISH\s*WASHER/, "Dishwasher"],
  [/WASHER\s*\/\s*DRYER|LAUNDRY\s*CENTER|WASH\s*TOWER|STACK/, "Laundry Center"],
  [/DRYER/, "Dryer"],
  [/WASHER/, "Washer"],
  [/WINE/, "Wine Cooler"],
  [/BEVERAGE/, "Beverage Center"],
  [/ICE\s*MAKER|ICEMAKER/, "Ice Maker"],
  [/REFRIGERATOR|FRIDGE|REFRIG/, "Refrigerator"],
  [/FREEZER/, "Freezer"],
  [/MICROWAVE/, "Microwave"],
  [/HOOD|VENT/, "Vent Hood"],
  [/WALL\s*OVEN|OVEN/, "Wall Oven"],
  [/COOKTOP|RANGETOP/, "Cooktop"],
  [/RANGE|STOVE/, "Range"],
  [/DISPOSAL|DISPOSER/, "Disposal"],
  [/COMPACTOR/, "Trash Compactor"],
  [/GRILL/, "Grill"],
  [/WATER\s*HEATER/, "Water Heater"],
  [/MINI\s*SPLIT|DUCTLESS/, "Mini Split"],
  [/HEAT\s*PUMP/, "Heat Pump"],
  [/CONDENS|AIR\s*COND|A\/C/, "AC System"],
  [/FURNACE/, "Furnace"],
  [/AIR\s*HANDLER/, "Air Handler"]
];

export function categoryName(classification) {
  const seg = String(classification || "").split(",")[1] || "";
  const up = seg.trim().toUpperCase();
  if (!up) return "";
  for (const [re, name] of CATEGORY_NAMES) if (re.test(up)) return name;
  return properCase(up);
}

// Description (50 chars max, shown in Paid History) — brand + product, never
// the model number (Andrew, 2026-09-10):
//   one product   → "LG Laundry Center"
//   two products  → "Wolf Range and KitchenAid Refrigerator"
//                   ("LG Washer and Dryer" when the brand is shared)
//   anything else → "Project at 4424 Bob Wire"  (ship-to street, no Rd/Dr/Ave)
export function describeOrder(out) {
  const lastName = String(out.customerName || "").trim().split(/\s+/).pop() || "";
  const brandOf = (l) => l && l.classification ? properCase(l.classification.split(",")[0].replace(/\s+(home\s+)?appliances?$/i, "").trim()) : "";
  const productOf = (l) => categoryName(l && l.classification) || (l ? l.description.split(",")[0].trim() : "");
  const products = (out.lines || []).filter((l) => l.model);
  const address = shortStreet(out.shipToStreet);
  let description = "";
  if (products.length === 1) {
    description = [brandOf(products[0]), productOf(products[0])].filter(Boolean).join(" ");
  } else if (products.length === 2) {
    const [a, b] = products;
    const ba = brandOf(a), bb = brandOf(b);
    description = ba && ba === bb
      ? `${ba} ${productOf(a)} and ${productOf(b)}`
      : `${[ba, productOf(a)].filter(Boolean).join(" ")} and ${[bb, productOf(b)].filter(Boolean).join(" ")}`;
  } else if (address) {
    description = `Project at ${address}`;
  } else {
    const first = (out.lines || [])[0];
    description = [lastName, first ? first.description.split(",")[0] : ""].filter(Boolean).join(" — ");
  }
  return { productCount: products.length, description: description.slice(0, 50) };
}

export async function extractSalesInvoiceFromPdf(buffer) {
  const rows = await pdfTextRowsAny(buffer);
  if (!rows.length) {
    const err = new Error("Couldn't read any text from that PDF — is it the ePASS invoice / sales order print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }
  const warnings = [];
  const out = {
    format: "sales_invoice",
    invoiceNumber: "", date: "", customerName: "", customerNumber: "", phone: "", altPhone: "",
    salesperson: "", paymentType: "", invoiceType: "", shipToStreet: "", billToStreet: "",
    lines: [], subTotal: null, tax: null, invoiceTotal: null, deposits: null, balance: null,
    warnings
  };

  // Order number: printed under "Invoice Number" in the header box; the
  // first R/S number anywhere on the page is the fallback.
  for (const r of rows) {
    for (const c of r.cells) {
      const t = c.t.trim();
      if (!out.invoiceNumber && ORDER_RE.test(t)) out.invoiceNumber = t.toUpperCase();
      if (!out.date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) out.date = t;
    }
  }

  // Header strip: Customer # / Payment Type / Invoice Type / Salesperson / Alt Phone #
  out.customerNumber = valueBelow(rows, /^Customer #$/);
  out.paymentType = valueBelow(rows, /^Payment Type$/);
  out.invoiceType = valueBelow(rows, /^Invoice Type$/);
  out.salesperson = properCase(valueBelow(rows, /^Salesperson$/));
  out.altPhone = normPhone(valueBelow(rows, /^Alt Phone #$/));
  if (!/^\d{10}$/.test(out.customerNumber)) out.customerNumber = "";

  // Bill To name: first "LAST, FIRST" cell under the Bill To label.
  const billTo = rows.find((r) => r.cells.some((c) => /^Bill To:$/.test(c.t.trim())));
  if (billTo) {
    const below = rows.filter((r) => r.page === billTo.page && r.y < billTo.y && r.y > billTo.y - 700).sort((a, b) => b.y - a.y);
    for (const r of below) {
      const nameCell = r.cells.find((c) => c.x < 6000 && /^[A-Z][A-Za-z'".&\- ]+,\s*[A-Z]/.test(c.t.trim()));
      if (nameCell) { out.customerName = flipName(nameCell.t.trim()); break; }
    }
  }
  out.billToStreet = addressOf(rows, /^Bill To:$/, 0, 6000);
  out.shipToStreet = addressOf(rows, /^Ship To:$/, 6000, 12000) || out.billToStreet;
  // Wilson's retail account numbers are the client's phone number.
  out.phone = out.altPhone || (out.customerNumber ? normPhone(out.customerNumber) : "");
  const shipToNum = cellAfter(rows, /^Ship To:$/);
  if (!out.customerNumber && /^\d{10}$/.test(shipToNum)) { out.customerNumber = shipToNum; out.phone = out.phone || normPhone(shipToNum); }

  // Line items: rows whose last two cells are money, in the price columns.
  // Continuation description rows (no money) attach to the line above.
  let current = null;
  for (const r of rows) {
    const cells = r.cells;
    if (!cells.length) continue;
    const joinedAll = cells.map((c) => c.t.trim()).join(" ");
    const last = cells[cells.length - 1];
    const ext = moneyOf(last.t);
    if (ext != null && last.x > 9500) {
      const label = joinedAll.toUpperCase();
      if (/SUB\s*TOTAL/.test(label)) { out.subTotal = ext; current = null; continue; }
      if (/INVOICE\s*TOTAL/.test(label)) { out.invoiceTotal = ext; current = null; continue; }
      if (/\bTAX\b/.test(label)) { out.tax = ext; current = null; continue; }
      if (/DEPOSITS?/.test(label)) { out.deposits = ext; current = null; continue; }
      if (/BALANCE/.test(label)) { out.balance = ext; current = null; continue; }
      const price = moneyOf(cells[cells.length - 2]?.t ?? "");
      if (price == null) continue;
      const text = cells.slice(0, cells.length - 2).map((c) => c.t.trim()).filter(Boolean);
      // payment rows ("Payment  Check  25,000.00") are money received, not products
      if (/^payments?$/i.test(text[0] || "")) { current = null; continue; }
      const qty = /^-?\d{1,3}$/.test(text[0]) ? Number(text[0]) : 1;
      const rest = /^-?\d{1,3}$/.test(text[0]) ? text.slice(1) : text;
      const model = rest.length > 1 && /^[A-Z0-9][A-Z0-9\-\/.]{3,}$/i.test(rest[0]) ? rest[0] : "";
      const description = (model ? rest.slice(1) : rest).join(" ");
      current = { qty, model, description, price, ext };
      out.lines.push(current);
      continue;
    }
    // continuation text directly under an item, in the description column
    if (current && cells.length === 1 && cells[0].x > 3000 && cells[0].x < 4000 && ext == null) {
      const t = cells[0].t.trim();
      if (/^[A-Z][A-Z &\/,]+,/.test(t)) { current.classification = current.classification || t; }
      else if (/^(RETAIL IN-HOME|Includes delivering|Installation and|non-professional|ze product|requiring additional|based on specific|days of purchase)/i.test(t)) { current = null; }
      else current.description = (current.description + " " + t).trim();
    }
  }

  if (!out.invoiceNumber) warnings.push("Couldn't find the sales order / invoice number.");
  if (!out.customerName) warnings.push("Couldn't find the Bill To name.");
  if (out.invoiceTotal == null && out.balance == null) {
    const err = new Error("Couldn't find the invoice total or balance — is this the ePASS invoice / sales order print?");
    err.code = "NOT_EPASS_PDF";
    throw err;
  }
  if (!out.lines.length) warnings.push("No product lines were found — check the order number and amount by hand.");

  // What the link is for: the amount still owed, and a short description
  // built from the client and the main product.
  const amountDue = out.balance != null && out.balance > 0 ? out.balance : out.invoiceTotal;
  out.amountDue = amountDue;
  out.amountBasis = out.balance != null && out.balance > 0 && out.deposits ? "balance" : (out.balance != null && out.balance > 0 ? "balance" : "invoice total");
  const described = describeOrder(out);
  out.productCount = described.productCount;
  out.suggestedDescription = described.description;
  // Deposit option for the team: 50% collected up front, computed as 51%
  // of the amount due rounded DOWN to the dollar (Andrew, 2026-09-10).
  out.depositAmount = amountDue != null ? Math.floor(amountDue * 0.51) : null;
  return out;
}
