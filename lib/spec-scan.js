// ---------------------------------------------------------------------------
// ePASS sales order "scanner": pulls model numbers out of an ePASS invoice /
// sales order PDF so salespeople don't have to type them.
//
// How it works: ePASS invoices are generated text PDFs with a line-item table
// headed QTY | MODEL # | DESCRIPTION | PRICE | EXT PRICE. We read the text
// with real x/y positions (pdfjs), find the MODEL # column on each page, and
// collect the tokens that sit in that column — so order numbers, phone
// numbers, and description text never leak in. Filters drop non-product rows
// (protection plans, payment rows). Steel Cod's found/not-found response is
// the final validator; this list is a starting point the user confirms.
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);

let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

// Non-product tokens that legitimately appear in the MODEL # column.
const MODEL_BLACKLIST = [
  /^APPL\d*-LP$/i,       // protection plan SKUs
  /^PAYMENT$/i,
  /^DELIVERY$/i,
  /^INSTALL(ATION)?$/i,
  /^LABOR$/i,
  /^[QRS]\d{7,}(-\d+)?$/i, // ePASS quote / invoice / sales order numbers
  /^\d{10}$/,             // phone / customer numbers
  /^\d{5}(-\d{4})?$/      // zip codes
];

function isPlausibleModel(token) {
  const t = String(token || "").trim();
  if (t.length < 3 || t.length > 25) return false;
  if (!/^[A-Z0-9][A-Z0-9\-./]*$/i.test(t)) return false;
  if (!/\d/.test(t)) return false; // every real model/part number has a digit
  return !MODEL_BLACKLIST.some((re) => re.test(t));
}

// Group positioned text items into visual rows by y (with tolerance), each
// row sorted by x.
function buildRows(items) {
  const rows = [];
  for (const item of items) {
    const str = String(item.str || "").trim();
    if (!str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = Number(item.width) || 0;
    let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, width, str });
  }
  rows.sort((a, b) => b.y - a.y); // top of page first (PDF y grows upward)
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}

// ---------------------------------------------------------------------------
// Ship To extraction — client name, address, and phone from the invoice's
// Ship To block (page 1). Layout: "Ship To:" label, then an indented column
// of lines: optional customer/phone number, name line(s), street line(s),
// city/state/zip. The first line starting with a digit (or PO BOX) begins
// the address; everything above it (minus pure numbers) is the name.
// ---------------------------------------------------------------------------

function titleCaseLine(line) {
  const words = String(line || "").split(/\s+/);
  return words
    .map((word, i) => {
      // A 2-letter uppercase token stays uppercase only when it reads as a
      // state abbreviation (followed by a zip): "TX 78701" keeps, street
      // "ST" title-cases.
      if (/^[A-Z]{2},?$/.test(word) && /^\d{5}(-\d{4})?$/.test(words[i + 1] || "")) return word;
      // Ordinals and mixed digit-leading tokens: "5TH" -> "5th", zips stay.
      if (/^\d/.test(word)) return word.toLowerCase() === word ? word : word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    // Re-capitalize after hyphens/apostrophes inside words: O'brien -> O'Brien
    .replace(/([A-Za-z])(['’-])([a-z])/g, (m, a, sep, b) => a + sep + b.toUpperCase());
}

// "SCHWEITZER, SHARON" -> "Sharon Schweitzer" — but only for simple person
// names (one comma, short alphabetic sides). Project names like
// "BRADY RESIDENCE- PLAZA LOFTS 12" pass through untouched.
function normalizeShipToName(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  const m = name.match(/^([A-Za-z' -]{2,40}),\s*([A-Za-z' -]{2,40})$/);
  if (m && m[1].trim().split(" ").length <= 3 && m[2].trim().split(" ").length <= 3) {
    return titleCaseLine(m[2].trim() + " " + m[1].trim());
  }
  return titleCaseLine(name);
}

// The quote / sales order number: Q…, R…, or S… followed by a zero-padded
// run of digits (Q00012345 / R00015347 / S00062359), sometimes with a -1
// suffix on split orders.
const ORDER_NUMBER = /^[QRS]0\d{6,}(-\d+)?$/;

// ePASS calls it the "invoice number"; quote exports may say "Quote Number"
// or "Order Number" instead. Three strategies, most precise first:
// 1) the token directly under a recognized header box;
// 2) any standalone cell anywhere that matches the strict Q/R/S format;
// 3) the format embedded in longer text (e.g. "Quote #: Q00012345") or a
//    number split across adjacent text fragments in a row.
function extractSalesOrder(rows) {
  let headerCell = null;
  let headerY = null;
  for (const row of rows) {
    const cell = row.cells.find((c) =>
      /^(Invoice|Quote|Order|Sales\s*Order)\s*(Number|No\.?|#)$/i.test(c.str.trim()));
    if (cell) {
      headerCell = cell;
      headerY = row.y;
      break;
    }
  }

  if (headerCell) {
    let best = null;
    for (const row of rows) {
      if (row.y >= headerY) continue; // only below the header
      for (const cell of row.cells) {
        if (Math.abs(cell.x - headerCell.x) > 70) continue;
        const token = cell.str.trim().toUpperCase();
        if (/^[A-Z]{0,2}\d{5,}(-\d+)?$/.test(token)) {
          if (!best || row.y > best.y) best = { y: row.y, token }; // closest below
        }
      }
    }
    if (best) return best.token;
  }

  for (const row of rows) {
    for (const cell of row.cells) {
      const token = cell.str.trim().toUpperCase();
      if (ORDER_NUMBER.test(token)) return token;
    }
  }

  for (const row of rows) {
    const joined = row.cells.map((c) => c.str).join("").toUpperCase();
    const m = joined.match(/[QRS]0\d{6,}(-\d+)?/);
    if (m) return m[0];
  }

  return "";
}

function extractShipTo(rows) {
  let shipCell = null;
  let shipRowY = null;
  for (const row of rows) {
    const cell = row.cells.find((c) => /^Ship\s*To:?$/i.test(c.str));
    if (cell) {
      shipCell = cell;
      shipRowY = row.y;
      break;
    }
  }
  if (!shipCell) return null;

  // The block ends where the Customer # / Payment Type table begins.
  let bottomY = shipRowY - 130;
  for (const row of rows) {
    if (row.y < shipRowY && row.cells.some((c) => /^Customer\s*#$/i.test(c.str))) {
      bottomY = Math.max(bottomY, row.y);
      break;
    }
  }

  const lines = [];
  for (const row of rows) {
    if (row.y >= shipRowY - 1 || row.y <= bottomY + 6) continue;
    const cells = row.cells.filter((c) => c.x >= shipCell.x + 5 && c.x <= shipCell.x + 300);
    if (!cells.length) continue;
    lines.push({ y: row.y, text: cells.map((c) => c.str).join(" ").replace(/\s+/g, " ").trim() });
  }
  lines.sort((a, b) => b.y - a.y); // top to bottom
  if (!lines.length) return null;

  let phone = "";
  const textLines = [];
  for (const line of lines) {
    if (/^\d{7,11}$/.test(line.text)) {
      if (!phone) phone = line.text;
      continue; // customer/phone number line, not part of name/address
    }
    if (line.text) textLines.push(line.text);
  }
  if (!textLines.length) return null;

  let addressStart = textLines.findIndex((t, i) => i > 0 && (/^\d/.test(t) || /^P\.?O\.?\s*BOX/i.test(t)));
  if (addressStart === -1) addressStart = Math.min(1, textLines.length);

  const name = normalizeShipToName(textLines.slice(0, addressStart).join(" "));
  const address = textLines.slice(addressStart).map(titleCaseLine).join(", ");

  return {
    name,
    address,
    phone: phone.length === 10 ? phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : phone
  };
}

export async function extractModelsFromPdfBuffer(buffer) {
  const data = await extractQuoteDataFromPdfBuffer(buffer);
  return data.models;
}

export async function extractQuoteDataFromPdfBuffer(buffer) {
  const { getDocument } = await getPdfjs();
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    // Uploaded PDFs are data, not programs: keep both PDF-JS scripting
    // pathways off (GHSA-hq66-cqwq-w95j workaround; we only read text).
    isEvalSupported: false,
    enableScripting: false
  }).promise;

  const found = [];
  const seen = new Set();
  let customer = null;
  let salesOrder = "";

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const rows = buildRows(content.items);

      if (pageNum === 1) {
        customer = extractShipTo(rows);
      }
      if (!salesOrder) {
        salesOrder = extractSalesOrder(rows); // any page — quote layouts vary
      }

      // Locate this page's line-item header to learn the column geometry.
      // NOTE: the "MODEL #" header is CENTERED over the column while values
      // are left-aligned (values start ~30pt left of the header text), so the
      // value band is anchored between the QTY column and the header.
      let modelX = null;
      let descX = null;
      let qtyX = null;
      let headerY = null;
      for (const row of rows) {
        const modelCell = row.cells.find((c) => /^MODEL\s*#?$/i.test(c.str));
        const qtyCell = row.cells.find((c) => /^QTY$/i.test(c.str));
        if (modelCell && qtyCell) {
          modelX = modelCell.x;
          qtyX = qtyCell.x;
          headerY = row.y;
          const descCell = row.cells.find((c) => /^DESCRIPTION$/i.test(c.str));
          descX = descCell ? descCell.x : modelCell.x + 180;
          break;
        }
      }
      if (modelX == null) continue; // page without a line-item table

      const bandStart = qtyX + 12;       // right of the QTY digits
      const bandEnd = modelX + 45;       // within the model column

      for (const row of rows) {
        if (row.y >= headerY - 4) continue; // only rows BELOW the header

        // Model cell: text that STARTS in the model column band.
        const cell = row.cells.find((c) => c.x >= bandStart && c.x <= bandEnd && c.x < descX - 30);
        if (!cell) continue;

        // A model can be split into adjacent fragments ("DF48450DG" + "/S/P");
        // join only fragments that continue right where the previous ends.
        let token = cell.str;
        let cursorEnd = cell.x + cell.width;
        for (const next of row.cells) {
          if (next === cell || next.x <= cell.x) continue;
          if (next.x < descX - 30 && next.x <= cursorEnd + 3 && /^[A-Z0-9\-./]+$/i.test(next.str)) {
            token += next.str;
            cursorEnd = next.x + next.width;
          }
        }
        token = token.trim().toUpperCase();

        if (isPlausibleModel(token) && !seen.has(token)) {
          seen.add(token);
          found.push(token);
        }
      }
    }
  } finally {
    await doc.destroy().catch(() => {});
  }

  return {
    models: found,
    salesOrder,
    customer: customer || { name: "", address: "", phone: "" }
  };
}
