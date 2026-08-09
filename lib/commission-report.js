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

  for (const row of rows) {
    const c0 = cellText(row?.[0]);

    if (c0 === "Invoice #") { sawHeader = true; continue; }

    if (c0 === "Salesperson:") {
      currentCode = cellText(row[1]).toUpperCase();
      currentName = cellText(row[2]);
      continue;
    }

    if (INVOICE_RE.test(c0.toUpperCase())) {
      const invoice = c0.toUpperCase();
      lines.push({
        invoice,
        baseInvoice: baseInvoice(invoice),
        customer: cellText(row[1]),
        lineType: cellText(row[2]) || "Model",
        product: cellText(row[3]),
        qty: toNumber(row[4]),
        revenue: toNumber(row[5]),
        serialType: cellText(row[6]),
        serialCost: row[7] == null || row[7] === "" ? null : toNumber(row[7]),
        salespersonCode: currentCode,
        salespersonName: currentName
      });
      continue;
    }
    // Anything else (blank rows, the trailing count row) is ignored.
  }

  if (!sawHeader) {
    warnings.push("Header row (Invoice # / Customer / Line …) not found — column positions assumed.");
  }
  if (!lines.length) {
    throw new Error("No line items found — is this the commission report export?");
  }

  const invoices = new Set(lines.map((l) => l.baseInvoice));
  const revenueTotal = Math.round(lines.reduce((s, l) => s + l.revenue, 0) * 100) / 100;
  const serialCostTotal = Math.round(lines.reduce((s, l) => s + (l.serialCost || 0), 0) * 100) / 100;
  const salespeople = new Set(lines.map((l) => l.salespersonCode).filter(Boolean));

  return {
    lines,
    invoiceCount: invoices.size,
    revenueTotal,
    serialCostTotal,
    salespersonCount: salespeople.size,
    warnings
  };
}
