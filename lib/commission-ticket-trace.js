// ---------------------------------------------------------------------------
// WHERE DID A TICKET LAND ON THE COMMISSION STATEMENTS? (Andrew 11/18: "the -1
// ticket carrying the B36CD80SNS that was delivered and stayed in the client's
// home wasn't on the sales commission report".)
//
// The statements are built a month at a time from the units on that month's
// FINISHED tickets (epass_sold_serials -> sales_order_lines -> the engine in
// field-sales-commissions.js). A unit can look "missing" for a handful of
// ordinary reasons, none of which the statement itself can show:
//   - its ticket finished in another month (R00015948 on 10/30 and
//     R00015948-1 on 11/3 are two different statements)
//   - it is listed, but in the folded "excluded lines" (RTV / SVC / omitted)
//   - it is listed but held (invoice unpaid), or pays 0% (margin floor, no cost)
//   - the month runs from an uploaded Crystal report instead of the feed
//   - the ticket has no salesperson, or a department the plans do not pay
// traceCommissionTicket reads one ticket with all of its suffix tickets
// (-1, -2 ...) and says, unit by unit, which statement it is on and how it is
// treated there. Read only: it changes nothing. No cost or margin is carried.
// ---------------------------------------------------------------------------

const up = (v) => String(v ?? "").trim().toUpperCase();
const money = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (r) => `${Math.round((Number(r) || 0) * 10000) / 100}%`;
const niceDay = (d) => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ""; };
const EXCLUDED_TYPES = new Set(["RTV", "SVC"]);

// "r00015948-1 " -> "R00015948": the ticket family every suffix belongs to.
export const baseTicketOf = (typed) => up(typed).replace(/\s+/g, "").replace(/-\d+$/, "");
export const isTicketNumber = (base) => /^[A-Z]{1,4}\d{3,12}$/.test(String(base || ""));

function linesFor(statements, unit) {
  const hits = [];
  for (const st of statements || []) {
    for (const [section, list] of [["new", st.newLines], ["closeout", st.closeoutLines], ["excluded", st.excludedLines]]) {
      for (const l of list || []) {
        if (up(l.invoice) === unit.invoice && up(l.product) === unit.model && up(l.serialNumber) === unit.serial) hits.push({ st, section, line: l });
      }
    }
  }
  return hits;
}

// One statement line -> { status, text }.
function describeHit({ st, section, line }, label) {
  const who = `${st.name || st.code}'s ${label} statement`;
  const share = line.split ? " (split sale: this is their half)" : "";
  if (section === "excluded") return { status: "excluded", text: `Listed under "excluded lines" on ${who}; it pays nothing (${line.reason || "not commissioned"}).` };
  if (line.held) return { status: "held", text: `On ${who}, held: the invoice still shows a balance in ePASS. It pays once the balance clears.` };
  const kind = section === "closeout" ? "Closeout" : (st.sectionNewTitle || "New Serial Inventory");
  if (!(Number(line.rate) > 0)) {
    const why = line.belowFloor ? "the margin is under the plan's floor"
      : line.noMarginData ? "ePASS has no cost for the unit, so no margin tier applies"
      : line.notSelect ? "on the Showroom plan only lines marked Select pay"
      : "its rate is 0%";
    return { status: "zero", text: `On ${who} under ${kind}${share}, but it pays nothing: ${why}.` };
  }
  return { status: "pays", text: `Pays on ${who}: ${kind}, ${pct(line.rate)} of ${money(line.revenue)} = ${money(line.commission)}${share}.` };
}

// units            epass_sold_serials rows of the family: { invoice, serial, model, finishDate, department,
//                  salespersonCode, salesperson2Code, returned, serialType, price }
// statementsByMonth { "YYYY-MM": statements[] }  (computeFieldCommissionMonth, only months that resolved)
// lineSources      { "YYYY-MM": { auto, filename } | null }  where that month's lines came from
// posts            { "YYYY-MM": [{ code, postedAt }] }       statements already posted to reps
// names            { CODE: "Proper Name" }
export function traceCommissionTicket({ ticket, units = [], statementsByMonth = {}, lineSources = {}, posts = {}, names = {}, monthLabel = (m) => m, commissionedDepartments = ["Appliance", "HVAC Sales"] } = {}) {
  const base = baseTicketOf(ticket);
  const rows = (Array.isArray(units) ? units : []).map((u) => ({
    invoice: up(u.invoice), serial: up(u.serial), model: up(u.model), finishDate: String(u.finishDate || "").slice(0, 10), department: String(u.department || ""),
    salespersonCode: up(u.salespersonCode), salesperson2Code: up(u.salesperson2Code), returned: !!u.returned, serialType: up(u.serialType), price: u.price == null ? null : Number(u.price)
  })).filter((u) => u.invoice);
  if (!rows.length) return { ticket: base, found: false, summary: [], tickets: [] };
  const nameOf = (code) => names[code] || code;
  const pays = new Set(commissionedDepartments.map((d) => d.toUpperCase()));

  // every time a serial came back, anywhere in the family
  const returns = rows.filter((u) => u.returned && u.serial);
  const cameBack = (u) => returns.find((r) => r.serial === u.serial && r.model === u.model && r.invoice !== u.invoice && r.finishDate >= u.finishDate);

  const byInvoice = new Map();
  for (const u of rows) { if (!byInvoice.has(u.invoice)) byInvoice.set(u.invoice, []); byInvoice.get(u.invoice).push(u); }

  const summary = [];
  const tickets = [...byInvoice.entries()].sort((a, b) => (a[1][0].finishDate || "9").localeCompare(b[1][0].finishDate || "9") || a[0].localeCompare(b[0])).map(([invoice, list]) => {
    const head = list[0];
    const month = /^\d{4}-\d{2}/.test(head.finishDate) ? head.finishDate.slice(0, 7) : "";
    const label = month ? monthLabel(month) : "";
    const codes = [head.salespersonCode, head.salesperson2Code].filter(Boolean);
    const notes = [];

    // an exchange: a unit came back and the same model went out on the same ticket
    for (const back of list.filter((u) => u.returned)) {
      const out = list.find((u) => !u.returned && u.model === back.model && u.serial !== back.serial);
      if (!out) continue;
      notes.push(`Exchange on this ticket: ${back.model} ${back.serial} came back and ${out.serial} went out.`);
      const first = rows.find((u) => !u.returned && u.serial === back.serial && u.model === back.model && u.invoice !== invoice && u.finishDate <= back.finishDate);
      const firstMonth = first && /^\d{4}-\d{2}/.test(first.finishDate) ? first.finishDate.slice(0, 7) : "";
      summary.push(`The ${out.model} the customer kept is serial ${out.serial}, on ${invoice}${head.finishDate ? `, finished ${niceDay(head.finishDate)}` : ""}.${label ? ` That makes it a ${label} line` : ""}`
        + (first && firstMonth && firstMonth !== month ? `, not ${monthLabel(firstMonth)}, where the first unit (${back.serial}) sold on ${first.invoice}.` : label ? "." : ""));
    }

    const statements = month ? statementsByMonth[month] : null;
    const source = month ? lineSources[month] : null;
    const posted = new Map(((month && posts[month]) || []).map((p) => [up(p.code), p.postedAt || ""]));

    const outUnits = list.map((u) => {
      const why = [];
      const later = cameBack(u);
      if (u.returned) why.push("ePASS flags this unit Returned on this ticket.");
      else if (EXCLUDED_TYPES.has(u.serialType) && later) why.push(`ePASS types this serial ${u.serialType} today because it came back on ${later.invoice}${later.finishDate ? ` (${niceDay(later.finishDate)})` : ""}. The statement reads the serial's type as ePASS holds it now, not as it was the day it sold.`);
      else if (EXCLUDED_TYPES.has(u.serialType)) why.push(`ePASS types this serial ${u.serialType}.`);
      else if (later) why.push(`This unit came back on ${later.invoice}${later.finishDate ? ` (${niceDay(later.finishDate)})` : ""}.`);

      let status = "missing", text = "";
      const hits = statements ? linesFor(statements, u) : [];
      if (hits.length) {
        const said = hits.map((h) => describeHit(h, label));
        // the best news first: a line that pays outranks one that is held, zero or excluded
        const rank = { pays: 0, held: 1, zero: 2, excluded: 3 };
        said.sort((a, b) => rank[a.status] - rank[b.status]);
        status = said[0].status;
        text = said.map((s) => s.text).join(" ");
        for (const h of hits) {
          const at = posted.get(up(h.st.code));
          if (at) why.push(`${h.st.name || h.st.code}'s ${label} statement was posted to them ${niceDay(String(at).slice(0, 10))}. Their copy stays as it was posted until it is posted again.`);
        }
      } else if (!month) {
        text = "The ticket has no finish date in the feed, so it belongs to no statement month.";
      } else if (!pays.has(u.department.toUpperCase())) {
        text = `${u.department || "This department's"} tickets are not on the unit commission plans.`;
      } else if (!statements) {
        text = `${label} has no statements yet.`;
      } else if (source && !source.auto) {
        text = `${label} runs from an uploaded commission report${source.filename ? ` (${source.filename})` : ""}, not the ePASS feed, and that upload does not list this unit. Run ${label} and use "Use the ePASS feed instead" to put the month back on the feed.`;
      } else if (!codes.length) {
        text = "The ticket has no salesperson in ePASS, so no statement can carry it.";
      } else if ((statements || []).some((st) => codes.includes(up(st.code)) && st.planKey === "hvac")) {
        text = `${codes.map(nameOf).join(" + ")} is on the HVAC Selling Tech plan, which pays on whole jobs, not on units.`;
      } else {
        text = `Not on ${label}'s statements. The month rebuilds from the feed every ten minutes: run ${label} again, and if it is still missing the build needs a look.`;
      }
      return { model: u.model, serial: u.serial, price: u.price, returned: u.returned, serialType: u.serialType, status, text, why: [...new Set(why)] };
    });

    return { invoice, finishDate: head.finishDate, month, monthLabel: label, department: head.department, salespersonCode: codes.join("+"), salesperson: codes.map(nameOf).join(" + "), notes, units: outUnits };
  });

  return { ticket: base, found: true, summary: [...new Set(summary)], tickets };
}
