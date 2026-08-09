// ---------------------------------------------------------------------------
// Commission report parser (ePASS export, .xlsx). Pure grid-in / data-out —
// the server reads the workbook with the `xlsx` package and hands this
// module a 2D array (sheet_to_json header:1).
//
// Layout (verified against a real June 2026 export):
//   Row 1 header: Invoice # | Customer | Line | Product | Qty | Revenue |
//                 Serial Type | SerialCost
//   "Salesperson: CODE  Full Name" rows open each section.
//   Data rows: one per line item. Line is "Model" or "Wty"; Wty rows carry
//   no serial type/cost. Invoices can have suffixes ("AC00010530-1") and the
//   same model can appear more than once on an order (legitimate).
//   A trailing count-ish row (e.g. just "1") is ignored.
//
// Only R / S / AC tickets appear (commissioned sales); SV and CB do not.
//
// FORMATS: v1 (8 columns: Invoice, Customer, Line, Product, Qty, Revenue,
// Serial Type, SerialCost) and v2 (11 columns, after Andrew added serials in
// Crystal: Invoice, Customer, Line Type, Model, SERIAL NUMBER, Qty, Selling
// Price, SPLIT FACTOR, commission (ignored), Serial Type, Serial Cost). The
// raw v2 export ships with misaligned header labels — data positions are
// authoritative, so both the raw and header-corrected variants parse the
// same. v2 also lists every salesperson (including non-commissioned owners),
// so split pairs are complete, and "Sales / Wty Volume:" section-total rows
// are ignored like any non-invoice row.
//
// SPLITS: when two salespeople split a sale, ePASS lists the same line under
// EACH person's section — revenue divided between them (not always 50/50)
// but the FULL serial cost repeated on every half. Left raw, revenue reads
// low and cost double-counts. parseCommissionGrid merges each cross-
// salesperson group back into one whole line (revenue = sum of the halves,
// cost counted once) flagged split=true with the partner codes. Duplicates
// within ONE section (real multi-unit purchases, RTV swap pairs) are left
// untouched.
// ---------------------------------------------------------------------------

const INVOICE_RE = /^[A-Z]{1,3}\d{4,}(-\d+)?$/;

function cellText(value) {
  return String(value == null ? "" : value).trim();
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// "AC00010530-1" → "AC00010530" so lines join to the OE-23 order rows.
export function baseInvoice(invoice) {
  return cellText(invoice).toUpperCase().split("-")[0];
}

export function parseCommissionGrid(grid) {
  const rows = Array.isArray(grid) ? grid : [];
  const lines = [];
  const warnings = [];
  let currentCode = "";
  let currentName = "";
  let sawHeader = false;
  let format = null; // "v1" | "v2"

  for (const row of rows) {
    const c0 = cellText(row?.[0]);

    if (c0 === "Invoice #") {
      sawHeader = true;
      // v2 headers mention serials or Ext Price/Split (the raw Crystal export
      // carries misaligned labels, but these words only exist in v2).
      const headerText = (row || []).map(cellText).join("|").toLowerCase();
      format = /serial number|serialcode|ext price|selling price/.test(headerText) ? "v2" : "v1";
      continue;
    }

    if (c0 === "Salesperson:") {
      currentCode = cellText(row[1]).toUpperCase();
      currentName = cellText(row[2]);
      continue;
    }

    if (INVOICE_RE.test(c0.toUpperCase())) {
      const invoice = c0.toUpperCase();
      if (!format) {
        // No header row — sniff from data shape: v2 rows carry qty at index 5
        // and a value out at index 10; v1 rows have numeric qty at index 4.
        format = (row[10] != null && row[10] !== "") || typeof row[4] === "string" && typeof row[5] === "number"
          ? "v2" : "v1";
        warnings.push(`Header row not found — detected ${format} format from data shape.`);
      }
      if (format === "v2") {
        const factor = toNumber(row[7]);
        lines.push({
          invoice,
          baseInvoice: baseInvoice(invoice),
          customer: cellText(row[1]),
          lineType: cellText(row[2]) || "Model",
          product: cellText(row[3]),
          serialNumber: cellText(row[4]),
          qty: toNumber(row[5]),
          revenue: toNumber(row[6]),
          splitFactor: factor > 0 && factor < 1 ? factor : 1,
          serialType: cellText(row[9]),
          serialCost: row[10] == null || row[10] === "" ? null : toNumber(row[10]),
          salespersonCode: currentCode,
          salespersonName: currentName
        });
      } else {
        lines.push({
          invoice,
          baseInvoice: baseInvoice(invoice),
          customer: cellText(row[1]),
          lineType: cellText(row[2]) || "Model",
          product: cellText(row[3]),
          serialNumber: "",
          qty: toNumber(row[4]),
          revenue: toNumber(row[5]),
          splitFactor: 1,
          serialType: cellText(row[6]),
          serialCost: row[7] == null || row[7] === "" ? null : toNumber(row[7]),
          salespersonCode: currentCode,
          salespersonName: currentName
        });
      }
      continue;
    }
    // Anything else (blank rows, "Sales / Wty Volume:" section totals, the
    // trailing count row) is ignored.
  }

  if (!sawHeader) {
    warnings.push("Header row (Invoice # / Customer / Line …) not found — column positions assumed.");
  }
  if (!lines.length) {
    throw new Error("No line items found — is this the commission report export?");
  }

  const merged = mergeSplitLines(lines);

  const invoices = new Set(merged.map((l) => l.baseInvoice));
  const revenueTotal = Math.round(merged.reduce((s, l) => s + l.revenue, 0) * 100) / 100;
  const serialCostTotal = Math.round(merged.reduce((s, l) => s + (l.serialCost || 0), 0) * 100) / 100;
  const salespeople = new Set(lines.map((l) => l.salespersonCode).filter(Boolean));

  return {
    lines: merged,
    format: format || "v1",
    invoiceCount: invoices.size,
    revenueTotal,
    serialCostTotal,
    splitLineCount: merged.filter((l) => l.split).length,
    salespersonCount: salespeople.size,
    warnings
  };
}

// Merge cross-salesperson duplicate groups (splits) into whole lines.
// Group key: raw invoice + line type + product. A group spanning more than
// one salesperson code is a split: revenue is made whole by summing every
// half, while qty and serial cost — repeated in full under each person —
// are divided by the number of people (mirrored sections, so a two-unit
// split of n people has 2n rows and the division restores the two units).
function mergeSplitLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.invoice}\u0000${line.lineType}\u0000${line.product}\u0000${line.serialNumber || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  const out = [];
  for (const group of groups.values()) {
    const codes = [...new Set(group.map((l) => l.salespersonCode).filter(Boolean))].sort();
    if (group.length < 2 || codes.length < 2) {
      for (const l of group) {
        if ((l.splitFactor || 1) < 1) {
          // v2 orphan half: the split factor tells us the share directly.
          out.push({
            ...l,
            revenue: Math.round(l.revenue / l.splitFactor * 10000) / 10000,
            split: true,
            splitPartners: l.salespersonCode
          });
        } else {
          out.push({ ...l, split: false, splitPartners: "" });
        }
      }
      continue;
    }

    const n = codes.length;
    const costs = group.map((l) => l.serialCost).filter((c) => c != null);
    const first = group[0];
    out.push({
      ...first,
      qty: Math.round(group.reduce((s, l) => s + l.qty, 0) / n * 100) / 100,
      revenue: Math.round(group.reduce((s, l) => s + l.revenue, 0) * 10000) / 10000,
      serialCost: costs.length ? Math.round(costs.reduce((s, c) => s + c, 0) / n * 10000) / 10000 : null,
      salespersonCode: codes.join("+"),
      salespersonName: [...new Set(group.map((l) => l.salespersonName).filter(Boolean))].join(" + "),
      split: true,
      splitPartners: codes.join("+")
    });
  }
  return out;
}
