// ---------------------------------------------------------------------------
// Salesperson Activity Report parser (ePASS OE-23 export, legacy .xls).
// Pure grid-in / data-out — the server reads the workbook with the `xlsx`
// package and hands this module a 2D array (sheet_to_json header:1).
//
// Layout (verified against a real export):
//   Header block: "Report period:  From: <date>  To: <date>".
//   "Salesperson: <NAME>" section rows group tickets per salesperson
//   (the "All Records" filter line near the top is not a section).
//   Each ticket is a 5-row block keyed by column D labels:
//     row 1: invoice #        L:  <values>
//     row 2: finish date/ref  C:  <values>
//     row 3: (blank)
//     row 4: customer number  P:  <values>
//     row 5: customer name    %:  <values>
//   Value columns (E..M): Product, Parts, Labor, Wty, Misc, Tax Adj,
//   Taxes, Total (no Tax), Invoice TOTAL.
//   "Totals for:" blocks give per-salesperson checksums; "Grand Total:"
//   gives the report-wide checksum. Both are verified at parse time.
//
// Department mapping (per Andrew):
//   SV → Repair Service (service + warranty), CB/MD → Kitchen Design,
//   AC → HVAC Sales, R/S → Appliance. Anything else lands in "Other".
// ---------------------------------------------------------------------------

export const VALUE_COLUMNS = ["product", "parts", "labor", "wty", "misc", "taxAdj", "taxes", "totalNoTax", "invoiceTotal"];
const FIRST_VALUE_COL = 4; // column E

// SV ticket classification (per Andrew, from the OE-23's customer rows):
// COD tickets bill the real customer — a numeric, phone-style customer
// number. Warranty tickets bill the MANUFACTURER's account — an alpha key
// like "SPEEDQUEEN" with the bill-to name ("ALLIANCE LAUNDRY SPEEDQUEEN
// WARRANT"). Customer number 5128940907 is Wilson's own "WACA Warranty"
// goodwill bucket (credit-to-quota for techs on install / client-sat fixes).
export const WACA_WARRANTY_CUSTOMER = "5128940907";

export function serviceTypeForTicket({ invoice, customerNumber }) {
  const inv = String(invoice || "").toUpperCase();
  if (!inv.startsWith("SV")) return "";
  const num = String(customerNumber || "").trim();
  if (num === WACA_WARRANTY_CUSTOMER) return "WACA Warranty";
  if (num && !/^\d+$/.test(num)) return "Manufacturer Warranty";
  return "COD";
}

export function departmentForInvoice(invoice) {
  const inv = String(invoice || "").toUpperCase();
  if (inv.startsWith("SV")) return "Repair Service";
  if (inv.startsWith("CB")) return "Kitchen Design";
  if (inv.startsWith("MD")) return "Kitchen Design"; // modifications roll into cabinetry for now
  if (inv.startsWith("AC")) return "HVAC Sales";
  if (inv.startsWith("R") || inv.startsWith("S")) return "Appliance";
  return "Other";
}

function cellText(value) {
  return String(value == null ? "" : value).trim();
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Dates arrive as strings ("2026-08-06 00:00:00", "Aug 1, 2026"), Date
// objects, or Excel serial numbers depending on the reader.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function toDateStr(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value > 20000 && value < 60000) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = cellText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (month) return `${named[3]}-${String(month).padStart(2, "0")}-${String(named[2]).padStart(2, "0")}`;
  }
  return "";
}

function readValues(row) {
  const out = {};
  VALUE_COLUMNS.forEach((key, i) => { out[key] = toNumber(row?.[FIRST_VALUE_COL + i]); });
  return out;
}

function label(row) {
  return cellText(row?.[3]).replace(/\s+/g, "").toUpperCase(); // "L:", "C:", "P:", "%:"
}

function addInto(sum, values) {
  for (const key of VALUE_COLUMNS) sum[key] = Math.round(((sum[key] || 0) + values[key]) * 100) / 100;
}

export function parseActivityGrid(grid) {
  const rows = Array.isArray(grid) ? grid : [];
  const warnings = [];
  const tickets = [];
  let periodFrom = "";
  let periodTo = "";
  let currentSalesperson = "";
  let sectionSum = null;
  let grandChecksum = null;
  let reportedInvoiceCount = null;

  const finishSection = (totalsRow) => {
    if (!sectionSum || !totalsRow) return;
    const reported = readValues(totalsRow);
    for (const key of ["totalNoTax", "invoiceTotal", "product", "labor"]) {
      if (Math.abs((sectionSum[key] || 0) - reported[key]) > 0.02) {
        warnings.push(`Checksum mismatch for ${currentSalesperson} (${key}): parsed ${sectionSum[key] || 0} vs report ${reported[key]}.`);
        break;
      }
    }
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const c0 = cellText(row[0]);

    if (c0.startsWith("Report period")) {
      // ... From: <date> ... To: <date> — dates sit in the cells after the labels.
      for (let c = 1; c < row.length - 1; c++) {
        const t = cellText(row[c]).replace(":", "").toLowerCase();
        if (t === "from") periodFrom = toDateStr(row[c + 1]) || periodFrom;
        if (t === "to") periodTo = toDateStr(row[c + 1]) || periodTo;
      }
      continue;
    }

    if (c0.startsWith("Salesperson:")) {
      const name = cellText(row[2]);
      if (name && name.toLowerCase() !== "all records") {
        currentSalesperson = name;
        sectionSum = {};
      }
      continue;
    }

    if (c0.startsWith("Totals for")) {
      finishSection(row);
      sectionSum = null;
      continue;
    }

    if (c0.startsWith("Grand Total")) {
      grandChecksum = readValues(row);
      continue;
    }

    if (c0.startsWith("Number of Invoi")) {
      // Appears per salesperson section AND once at the very end for the
      // whole report — the last occurrence is the report-wide count.
      const count = toNumber(row[1]) || toNumber(row[2]) || toNumber(row[3]);
      if (count !== 0) reportedInvoiceCount = count;
      continue;
    }

    // Ticket block: invoice-looking value in column A with an L: label.
    if (/^[A-Z]{1,3}\d{4,}/.test(c0) && label(row) === "L:" && currentSalesperson) {
      const block = { "L:": row };
      for (let j = i + 1; j <= i + 5 && j < rows.length; j++) {
        const lb = label(rows[j]);
        if (lb && !block[lb]) block[lb] = rows[j];
      }
      if (!block["C:"]) continue; // not a real ticket block

      const list = readValues(block["L:"]);
      const cost = readValues(block["C:"]);
      const profit = block["P:"] ? readValues(block["P:"]) : null;

      const customerNumber = cellText(block["P:"]?.[0]);
      tickets.push({
        invoice: c0,
        department: departmentForInvoice(c0),
        serviceType: serviceTypeForTicket({ invoice: c0, customerNumber }),
        salesperson: currentSalesperson,
        finishDate: toDateStr(block["C:"][0]),
        reference: cellText(block["C:"][1]),
        customerNumber,
        customerName: cellText(block["%:"]?.[0]),
        list,
        cost,
        profit: profit || { totalNoTax: Math.round((list.totalNoTax - cost.totalNoTax) * 100) / 100 }
      });
      if (sectionSum) addInto(sectionSum, list);
    }
  }

  if (!tickets.length) {
    throw new Error("No ticket blocks found — is this the Salesperson Activity Report (OE-23) export?");
  }

  // Report-wide checksums.
  const grandSum = {};
  for (const ticket of tickets) addInto(grandSum, ticket.list);
  if (grandChecksum) {
    for (const key of ["totalNoTax", "invoiceTotal"]) {
      if (Math.abs((grandSum[key] || 0) - grandChecksum[key]) > 0.05) {
        warnings.push(`Grand total mismatch (${key}): parsed ${grandSum[key] || 0} vs report ${grandChecksum[key]}.`);
      }
    }
  } else {
    warnings.push("No Grand Total row found to verify against.");
  }
  if (reportedInvoiceCount != null && reportedInvoiceCount !== tickets.length) {
    warnings.push(`Invoice count mismatch: parsed ${tickets.length} vs report ${reportedInvoiceCount}.`);
  }

  return {
    periodFrom,
    periodTo,
    tickets,
    grandListTotals: grandSum,
    reportedInvoiceCount,
    warnings
  };
}

// Revenue rollups. Revenue = List "Total (no Tax)"; profit and cost likewise
// exclude tax so margins are apples-to-apples.
export function rollupByDepartment(tickets) {
  const departments = {};
  for (const ticket of tickets) {
    const dept = departments[ticket.department] ||= { revenue: 0, cost: 0, profit: 0, tickets: 0 };
    dept.revenue = Math.round((dept.revenue + ticket.list.totalNoTax) * 100) / 100;
    dept.cost = Math.round((dept.cost + ticket.cost.totalNoTax) * 100) / 100;
    dept.profit = Math.round((dept.profit + (ticket.profit.totalNoTax || 0)) * 100) / 100;
    dept.tickets++;
  }
  return departments;
}

// Repair-tech comp inputs: COD labor, COD parts margin, and warranty labor
// (manufacturer + WACA broken out), rolled up per tech from SV tickets.
export function rollupServiceTech(tickets) {
  const techs = {};
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const t of tickets) {
    if (!t.serviceType) continue;
    const tech = techs[t.salesperson] ||= {
      codLabor: 0, codPartsMargin: 0, codTickets: 0,
      mfgWtyLabor: 0, mfgWtyTickets: 0,
      wacaLabor: 0, wacaTickets: 0
    };
    const labor = Number(t.list?.labor) || 0;
    if (t.serviceType === "COD") {
      tech.codLabor = r2(tech.codLabor + labor);
      tech.codPartsMargin = r2(tech.codPartsMargin + (Number(t.list?.parts) || 0) - (Number(t.cost?.parts) || 0));
      tech.codTickets++;
    } else if (t.serviceType === "Manufacturer Warranty") {
      tech.mfgWtyLabor = r2(tech.mfgWtyLabor + labor);
      tech.mfgWtyTickets++;
    } else if (t.serviceType === "WACA Warranty") {
      tech.wacaLabor = r2(tech.wacaLabor + labor);
      tech.wacaTickets++;
    }
  }
  for (const tech of Object.values(techs)) {
    tech.wtyLabor = r2(tech.mfgWtyLabor + tech.wacaLabor);
  }
  return techs;
}

export function rollupBySalesperson(tickets) {
  const people = {};
  for (const ticket of tickets) {
    const person = people[ticket.salesperson] ||= { revenue: 0, profit: 0, tickets: 0 };
    person.revenue = Math.round((person.revenue + ticket.list.totalNoTax) * 100) / 100;
    person.profit = Math.round((person.profit + (ticket.profit.totalNoTax || 0)) * 100) / 100;
    person.tickets++;
  }
  return people;
}
