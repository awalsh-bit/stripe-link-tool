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
  /^[RS]\d{7,}(-\d+)?$/i, // ePASS invoice / sales order numbers
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

export async function extractModelsFromPdfBuffer(buffer) {
  const { getDocument } = await getPdfjs();
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false
  }).promise;

  const found = [];
  const seen = new Set();

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const rows = buildRows(content.items);

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

  return found;
}
