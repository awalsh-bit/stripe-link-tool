import { getPostgresPool } from "./data-postgres.js";
import { orderRowFromInvoice } from "./epass-feed-orders.js";
import { estimateOutcome, listServiceEstimatesForTicket } from "./service-estimates-postgres.js";
import { STATUS_DEFS } from "./service-journey-postgres.js";

// ---------------------------------------------------------------------------
// Ticket Audit (Andrew 11/16): everything Agility knows about ONE ticket, in
// the order it happened - the "What happened" list from Closed Estimates,
// for any service ticket, sales order, quote or web order.
//
// Nothing here is new data. It reads what other parts of Agility already
// keep and lays it on one line of time:
//
//   Agility's own records (exact time, who did it)
//     service request form, card on file, payment links, card reader and
//     saved-card charges, refunds            <- handed in by server.js, which
//                                               owns those ledgers
//     service estimates                      service_estimates
//     service board status changes           sj_jobs, sj_status_history
//     web shop orders                        shop_orders
//     delivery runs                          delivery_stops, delivery_runs
//     quote follow-up decisions              quote_followup_dispositions
//
//   ePASS, as the 15-minute feed mirrors it (a DATE, rarely a person)
//     the order while it is open             epass_open_orders, epass_open_service
//     the order once finished                sales_order_detail, epass_service_history
//     payments keyed in ePASS                epass_payments
//     units sold and whether they came back  epass_sold_serials
//     return lines                           sales_order_lines (qty < 0)
//     quotes                                 quote_followup_quotes
//
// ePASS tells us how an order stands today, not how it got there. What it
// does keep on an open order (checked against 200 real open invoices, 11/16)
// is when it was written and by whom, when it was LAST changed and by whom,
// and when it was finished and by whom - each with a time. A finished order
// keeps only its finish date, and a payment its date and who keyed it. A
// line with no time says "date only". Every source is optional:
// a table that does not exist yet, or a query that fails, drops its lines
// and nothing else. Cost and margin columns are never selected.
// ---------------------------------------------------------------------------

const TZ = process.env.APP_TIMEZONE || "America/Chicago";

// ---- ticket numbers --------------------------------------------------------
// One spelling per ticket: letters then digits, leading zeros and a trailing
// sub-invoice ("-1") dropped. "sv00124641", "SV124641-1" -> SV124641.
export function ticketKey(value) {
  const raw = String(value || "").toUpperCase().trim();
  const web = /^WEB[-\s]?0*(\d+)$/.exec(raw);
  if (web) return { key: "WEB" + web[1], bare: false, web: true };
  const cleaned = raw.replace(/-\d{1,2}$/, "").replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 4 || !/\d/.test(cleaned)) return null;
  return { key: cleaned.replace(/^([A-Z]*)0+(?=\d)/, "$1"), bare: /^\d+$/.test(cleaned), web: false };
}
// The same normalising, in SQL, for a text column.
const NORM = (col) => `regexp_replace(regexp_replace(upper(btrim(${col})), '-[0-9]{1,2}$', ''), '^([A-Z]*)0+([0-9])', '\\1\\2')`;

const money = (v) => { const n = Number(v) || 0; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const dollars = (v) => Math.round((Number(v) || 0) * 100) / 100;
const clean = (v, max = 200) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
// "2026-11-13", "11/13/2026", a Date, an ISO stamp -> "2026-11-13" (or "")
// ePASS writes "no date" as 1899-12-30 (13 of 200 real pickup dates), so
// anything before 1990 is read as blank rather than shown as a date.
export function dayOf(v) {
  if (!v) return "";
  let d = "";
  if (v instanceof Date) d = Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  else {
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) d = `${m[1]}-${m[2]}-${m[3]}`;
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))) d = `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return d && d >= "1990-01-01" ? d : "";
}
// An ePASS date and its clock time ("2026-09-21", "11:20") are the store's
// own time with no zone. This is that moment as an ISO instant, or "" when
// there is no usable time (the line then stays "date only").
export function storeInstant(day, time) {
  const d = dayOf(day);
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(String(time || "").trim());
  if (!d || !m) return "";
  let h = Number(m[1]); const min = Number(m[2]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  if (h > 23 || min > 59) return "";
  const guess = Date.parse(`${d}T${String(h).padStart(2, "0")}:${m[2]}:00Z`);
  if (Number.isNaN(guess)) return "";
  // What the store's clock reads at an instant, as if it were UTC. Shifting
  // by the difference lands on the right moment; a second pass settles the
  // few hours a year when the first guess falls on the other side of a
  // daylight-saving change.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const wall = (t) => { const parts = fmt.formatToParts(new Date(t)); const part = (k) => Number(parts.find((x) => x.type === k).value); return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")); };
  let t = guess - (wall(guess) - guess);
  t = guess - (wall(t) - t);
  return new Date(t).toISOString();
}
// "2026-11-21" -> "Nov 21, 2026", for reading
const niceDay = (v) => { const d = dayOf(v); if (!d) return ""; const t = new Date(d + "T12:00:00Z"); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }); };
const isoOf = (v) => (v instanceof Date ? (Number.isNaN(v.getTime()) ? "" : v.toISOString()) : v ? String(v) : "");
// the calendar day an instant falls on at the store
const localDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: TZ }); };

async function pool() {
  const p = await getPostgresPool();
  if (!p) throw new Error("DATABASE_URL is not configured.");
  return p;
}
// A source that isn't there (table not created yet, feed never loaded) is an empty source.
const rowsOf = (p, sql, params) => p.query(sql, params).then((r) => r.rows).catch(() => []);

// ---- gathering --------------------------------------------------------------
// Everything the database holds for one ticket number. `typed` is what the
// person entered. A bare number that fits more than one ticket ("124641"
// when both SV124641 and R124641 exist) comes back as { choices } instead.
export async function collectTicketRecords(typed) {
  const t = ticketKey(typed);
  if (!t) return { error: "Enter a ticket, order or quote number (for example SV00124641)." };
  const p = await pool();
  let key = t.key;

  // A source that fails for any reason other than "that table does not exist
  // yet" is named in `unread`, so the page can say which lines are missing
  // rather than show a ticket that only looks complete.
  const unread = new Set();
  const read = (name, sql, params) => p.query(sql, params).then((r) => r.rows).catch((err) => {
    if (err.code !== "42P01") { unread.add(name); console.warn(`Ticket Audit: could not read ${name} —`, err.message); }
    return [];
  });

  if (t.bare) {
    // which lettered tickets end in these digits? ($1 in the text first: a cheap test that spares most rows the rewriting)
    const ends = (col) => `strpos(${col}, $1) > 0 AND regexp_replace(${NORM(col)}, '^[A-Z]+', '') = $1`;
    const found = (await Promise.all([
      ["sj_jobs", "sv_number"], ["epass_open_orders", "code"], ["epass_open_service", "code"], ["epass_service_history", "code"],
      ["open_sales_orders", "invoice"], ["sales_order_detail", "invoice"], ["quote_followup_quotes", "quote_number"], ["service_estimates", "sv_number"]
    ].map(([table, col]) => rowsOf(p, `SELECT DISTINCT ${NORM(col)} AS k FROM ${table} WHERE ${ends(col)}`, [key])))).flat().map((r) => r.k).filter(Boolean);
    const keys = [...new Set(found)];
    if (keys.length > 1) return { choices: keys.sort() };
    if (keys.length === 1) key = keys[0];
  }

  // "this column is this ticket": $1 is the ticket's one spelling, $2 its
  // digits. The digits-in-the-text test comes first because it is cheap and
  // rules out nearly every row before the spelling is worked out.
  const is = (col) => `(strpos(${col}, $2) > 0 AND ${NORM(col)} = $1)`;
  const at = [key, (key.match(/\d+/g) || [""]).sort((a, b) => b.length - a.length)[0]];

  const [jobs, history, openSalesFeed, openServiceFeed, serviceHistory, finished, openSales, epassPayments, payTypes, units, returnLines, quotes, webOrders, stops, estimates] = await Promise.all([
    read("the service board", `SELECT sv_number, customer_name, customer_code, phone, email, address1, city, zip, unit_brand, unit_model, unit_serial, problem_text, status, route_date::text AS route_date, assigned_tech, epass_status, epass_finish_date::text AS epass_finish_date, epass_created_at::text AS epass_created_at, closed_at, first_seen_at, total::float AS total, balance::float AS balance, payment_type
                 FROM sj_jobs WHERE ${is("sv_number")}`, at),
    read("the service board's status history", `SELECT from_status, to_status, changed_at, actor_type, actor_id, trigger_event, note FROM sj_status_history WHERE ${is("sv_number")} ORDER BY changed_at, id LIMIT 200`, at),
    read("ePASS open orders", `SELECT code, raw FROM epass_open_orders WHERE ${is("code")} ORDER BY code`, at),
    read("ePASS open service tickets", `SELECT code, raw FROM epass_open_service WHERE ${is("code")} ORDER BY code`, at),
    read("ePASS finished service tickets", `SELECT code, raw FROM epass_service_history WHERE ${is("code")} ORDER BY code LIMIT 6`, at),
    read("ePASS finished orders", `SELECT invoice, department, salesperson, finish_date, customer_number, customer_name, reference, invoice_total::float AS invoice_total, service_type
                 FROM sales_order_detail WHERE ${is("invoice")} ORDER BY finish_date, invoice`, at),
    read("ePASS open orders", `SELECT invoice, salesperson, customer_name, customer_number, start_date, invoice_total::float AS invoice_total, department FROM open_sales_orders WHERE ${is("invoice")} ORDER BY invoice`, at),
    read("payments keyed in ePASS", `SELECT invoice, payment_type, paid_on, post_date, amount::float AS amount, status, raw FROM epass_payments WHERE ${is("invoice")} ORDER BY paid_on, id`, at),
    rowsOf(p, `SELECT code, description FROM epass_payment_types`, []),
    read("units sold", `SELECT invoice, serial, model, finish_date, start_date, selling_price::float AS selling_price, returned, status, customer_number, customer_name
                 FROM epass_sold_serials WHERE ${is("invoice")} ORDER BY invoice, model, serial LIMIT 200`, at),
    read("return lines", `SELECT invoice, source_month, line_type, product, serial_number, qty::float AS qty, revenue::float AS revenue
                 FROM sales_order_lines WHERE qty < 0 AND ${is("invoice")} ORDER BY source_month, id LIMIT 100`, at),
    read("Quote Follow-Up", `SELECT q.quote_number, q.sp_code, q.date_created, q.total::float AS total, q.customer_number, q.customer_name, q.is_open, q.source, q.conv_invoice, q.conv_finish, q.matched_at,
                      d.status AS d_status, d.sales_order_number AS d_order, d.comment AS d_comment, d.by_name AS d_by, d.by_email AS d_email, d.updated_at AS d_at
                 FROM quote_followup_quotes q LEFT JOIN quote_followup_dispositions d ON d.quote_number = q.quote_number
                WHERE ${is("q.quote_number")} OR ${is("q.conv_invoice")} OR ${is("d.sales_order_number")}
                ORDER BY q.date_created LIMIT 12`, at),
    t.web ? read("web orders", `SELECT * FROM shop_orders WHERE upper(order_number) = $1 LIMIT 3`, ["WEB-" + key.slice(3)])
      : read("web orders", `SELECT * FROM shop_orders WHERE ${is("epass_ticket")} LIMIT 3`, at),
    read("delivery runs", `SELECT s.id, s.order_ref, s.customer_name, s.phone, s.status, s.window_text, s.arrived_at, s.departed_at, s.completed_at, s.signed_name, s.exception_note, s.texts, s.created_at,
                      jsonb_array_length(COALESCE(s.photos, '[]'::jsonb)) AS photo_count, r.run_date::text AS run_date, r.name AS run_name, r.driver_name
                 FROM delivery_stops s JOIN delivery_runs r ON r.id = s.run_id WHERE ${is("s.order_ref")} ORDER BY s.id LIMIT 20`, at),
    t.web ? [] : listServiceEstimatesForTicket(key).catch((err) => { unread.add("service estimates"); console.warn("Ticket Audit: could not read service estimates —", err.message); return []; })
  ]);
  // one list of "how ePASS shows it": open tickets first, then the finished service copy
  const seenCode = new Set();
  const openOrders = [...openServiceFeed.map((o) => ({ ...o, service: true, open: true })), ...openSalesFeed.map((o) => ({ ...o, service: /^SV/i.test(o.code), open: true })), ...serviceHistory.map((o) => ({ ...o, service: true, open: false }))]
    .filter((o) => (seenCode.has(o.code) ? false : seenCode.add(o.code)));
  return { typed: clean(typed, 60), key, web: t.web, bare: t.bare && key === t.key, unread: [...unread], jobs, history, openOrders, finished, openSales, epassPayments, payTypes, units, returnLines, quotes, webOrders, stops, estimates };
}

// ---- the timeline -------------------------------------------------------------
// One line: { id, at, dateOnly, phase, tone, label, text, sub, quote, source,
// by, payment }. `at` is an ISO instant, or YYYY-MM-DD (dateOnly), or YYYY-MM
// (a month, for return lines that only carry their commission month).
// phase orders lines within one day: 0 = a date with no time that opens the
// day (an order written), 1 = an exact time, 2 = a date with no time that
// closes it (finished, a payment keyed in ePASS).
const line = (o) => ({ id: "", at: "", dateOnly: false, phase: 1, tone: "", label: "", text: "", sub: "", quote: "", source: "Agility", by: "", payment: null, amount: null, loose: false, ...o });

const brandCase = (m) => String(m || "").replace(/^(visa|mastercard|amex|discover|diners|jcb|unionpay)\b/i, (b) => ({ visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners", jcb: "JCB", unionpay: "UnionPay" }[b.toLowerCase()]));
const LINK_STATE = { sent: "not paid yet", viewed: "opened, not paid", ach_pending: "bank payment pending", cancelled: "cancelled" };
function ledgerLines(events = []) {
  const out = [];
  for (const x of events) {
    const by = x.by ? ` by ${x.by}` : "";
    const card = (c) => `${c.brand ? brandCase(c.brand.charAt(0).toUpperCase() + c.brand.slice(1)) + " " : "card "}•••• ${c.last4 || "????"}`;
    if (x.kind === "request") {
      const what = { hvac: "HVAC service request", "hvac-quote": "HVAC quote request", install_damage: "Install damage report" }[x.requestType] || "Service request";
      out.push(line({ id: x.id, at: x.at, tone: "request", label: `${what} submitted`, text: "by the client", sub: x.card ? `card saved on file: ${card(x.card)}` : x.cardRequired ? "no card on file" : "" }));
    } else if (x.kind === "ticket") out.push(line({ id: x.id, at: x.at, tone: "request", label: `Ticket ${x.ticket || ""} entered`.replace(/\s+/g, " "), text: `on the request${by}`, by: x.by || "" }));
    else if (x.kind === "card_request") out.push(line({ id: x.id, at: x.at, tone: x.state === "cancelled" ? "off" : "", label: "Card request link sent", text: by.trim(), sub: x.state === "waiting" ? "not completed" : x.state === "cancelled" ? "cancelled" : "", by: x.by || "" }));
    else if (x.kind === "card_saved") out.push(line({ id: x.id, at: x.at, label: "Card saved on file", sub: x.detail || "" }));
    else if (x.kind === "link_sent") out.push(line({ id: x.id, at: x.at, tone: x.state === "cancelled" ? "off" : "", label: `${x.deposit ? "Deposit link" : "Payment link"} sent`, text: `for ${money(x.amount)}${by}`, sub: LINK_STATE[x.state] || "", by: x.by || "" }));
    else if (x.kind === "link_cancelled") out.push(line({ id: x.id, at: x.at, tone: "off", label: "Payment link cancelled", text: `(${money(x.amount)})`, sub: x.reason || "" }));
    else if (x.kind === "paid") {
      const method = x.method && x.method !== "card" ? brandCase(x.method) : "";
      const o = x.how === "saved_card" ? { label: `Saved card charged ${money(x.amount)}`, text: by.trim(), sub: method }
        : x.how === "reader" ? { label: `Paid ${money(x.amount)}`, text: `at the card reader${by}`, sub: method }
          : x.how === "balance" ? { label: `Balance charged ${money(x.amount)}`, text: "to the card on file" }
            : { label: `Paid ${money(x.amount)}`, text: "through the payment link", sub: x.method || "card" };
      out.push(line({ id: x.id, at: x.at, tone: "paid", by: x.by || "", ...o, amount: dollars(x.amount), payment: x.paymentIntentId ? { paymentIntentId: x.paymentIntentId, amount: dollars(x.amount) } : null }));
    } else if (x.kind === "refund") out.push(line({ id: x.id, at: x.at, tone: "refund", label: `Refunded ${money(x.amount)}`, text: by.trim(), sub: [brandCase(x.method), x.reason].filter(Boolean).join(" · "), quote: x.note || "", by: x.by || "", amount: dollars(x.amount) }));
    // filed in Agility under the digits alone (no letters), outside Repair Service
    if (x.loose && out.length && out[out.length - 1].id === x.id) { const l = out[out.length - 1]; l.loose = true; l.sub = [l.sub, "filed under the number alone, with no letters"].filter(Boolean).join(" · "); }
  }
  return out;
}

function estimateLines(estimates = []) {
  const out = [];
  for (const e of estimates) {
    const o = estimateOutcome(e), r = e.response || {}, id = `est:${e.token}`;
    const name = e.estimateName ? ` “${clean(e.estimateName, 60)}”` : "";
    out.push(line({ id: id + ":created", at: e.createdAt, label: `Estimate${name} created`, text: `by ${e.createdByName || e.createdByEmail || "staff"}`, by: e.createdByName || "" }));
    (e.sends || []).forEach((s, i) => out.push(line({ id: `${id}:send${i}`, at: s.at, label: `Estimate ${s.variant === "reminder" ? "reminder " : ""}${s.channel === "text" ? "texted" : "emailed"}`, text: `${s.to ? "to " + s.to : ""}${s.by ? " by " + s.by : ""}`.trim(), by: s.by || "" })));
    if (e.viewedAt && !(r.resolvedByStaff && e.viewedAt === e.respondedAt)) out.push(line({ id: id + ":viewed", at: e.viewedAt, label: "Client opened the estimate link" }));
    if (r.resolvedByStaff) out.push(line({ id: id + ":answer", at: r.resolvedAt || e.respondedAt, label: `${r.staffName || r.staffEmail || "Staff"} recorded the estimate as ${o.outcomeLabel}`, quote: r.staffNotes || "", by: r.staffName || "" }));
    else if (e.respondedAt && !["sent", "viewed"].includes(e.status)) out.push(line({ id: id + ":answer", at: e.respondedAt, tone: e.status === "approved" ? "done" : "", label: `Client answered the estimate: ${o.outcomeLabel}`, quote: r.notes || "" }));
    (e.reopens || []).forEach((x, i) => {
      if (x.closedAt) out.push(line({ id: `${id}:reclosed${i}`, at: x.closedAt, label: "Estimate closed", text: `${x.outcomeLabel ? "as " + x.outcomeLabel : ""}${x.closedByEmail ? " by " + x.closedByEmail : ""}`.trim() }));
      out.push(line({ id: `${id}:reopen${i}`, at: x.at, tone: "request", label: "Estimate reopened", text: `by ${x.byName || x.byEmail || "staff"}`, by: x.byName || "" }));
    });
    if (e.closedAt) out.push(line({ id: id + ":closed", at: e.closedAt, tone: "done", label: "Estimate closed", text: `as ${o.outcomeLabel}${e.closedByEmail ? " by " + e.closedByEmail : ""}` }));
  }
  return out;
}

const statusName = (code) => (code && STATUS_DEFS[code] ? STATUS_DEFS[code][0] : "");
const webName = (w) => clean([w?.customer?.firstName, w?.customer?.lastName].filter(Boolean).join(" ") || w?.customer?.name, 120);
function serviceLines(rec, haveWritten, haveFinished) {
  const out = [];
  const job = rec.jobs[0];
  for (const [i, h] of rec.history.entries()) {
    const to = h.to_status || "", from = h.from_status || "";
    const who = h.actor_type === "system" ? "" : clean(h.actor_id, 80);
    out.push(line({
      id: `sj:${i}`, at: isoOf(h.changed_at), tone: ["SO8", "SO8I"].includes(to) ? "done" : ["SO7", "SO9"].includes(to) ? "off" : "",
      label: `Service status: ${statusName(to) || to}`, text: who ? `by ${who}` : "", by: who,
      sub: [to && statusName(to) ? to : "", from ? `from ${from}` : "", h.actor_type === "system" ? "automatic" : ""].filter(Boolean).join(" · "),
      quote: /^service request svc_/i.test(h.note || "") ? "" : clean(h.note, 200), source: "Service board"
    }));
  }
  if (job) {
    if (!haveWritten.done && dayOf(job.epass_created_at)) { haveWritten.done = true; out.push(line({ id: "sj:written", at: dayOf(job.epass_created_at), dateOnly: true, phase: 0, label: "Ticket written in ePASS", source: "ePASS" })); }
    if (!haveFinished.done && dayOf(job.epass_finish_date)) { haveFinished.done = true; out.push(line({ id: "sj:finished", at: dayOf(job.epass_finish_date), dateOnly: true, phase: 2, tone: "done", label: "Ticket finished in ePASS", source: "ePASS" })); }
  }
  return out;
}

const rawText = (raw, key) => { const k = Object.keys(raw || {}).find((x) => x.toLowerCase() === key.toLowerCase()); return k ? clean(raw[k], 400) : ""; };
// An order still in the open feed that ePASS has already finished (status "Not Posted"): the day it was finished.
const finishedOpenDay = (o) => (o.open ? dayOf(rawText(o.raw, "DateFinished")) : "");
function epassOrderLines(rec, haveWritten, haveFinished, payTypeName) {
  const out = [];
  const severalOpen = rec.openOrders.filter((x) => x.open).length > 1;
  for (const o of rec.openOrders) {
    const row = orderRowFromInvoice(o.raw || {}, { service: o.service }) || {};
    const what = o.service ? "Ticket" : /^Q/i.test(o.code) ? "Quote" : "Order";
    const created = dayOf(row.dateCreated), createdAt = storeInstant(created, rawText(o.raw, "TimeCreated"));
    if (!haveWritten.done && created) {
      haveWritten.done = true;
      // UserCreated is who keyed it; the salesperson code is not a "by" for a service ticket (it is the tech)
      const by = row.userCreated || (o.service ? "" : row.sp);
      out.push(line({ id: `eo:${o.code}:written`, at: createdAt || created, dateOnly: !createdAt, phase: 0, label: `${what} written in ePASS`, text: by ? `by ${by}` : "", source: "ePASS", by }));
    }
    if (!o.open) continue;
    // The open-order feed is the whole ePASS header, so it also says when the
    // order was last saved and by whom (never what was changed)...
    const changed = dayOf(rawText(o.raw, "DateModified")), changedAt = storeInstant(changed, rawText(o.raw, "TimeModified")), changedBy = rawText(o.raw, "UserModified");
    if (changed && (changedAt || changed) !== (createdAt || created)) {
      out.push(line({ id: `eo:${o.code}:changed`, at: changedAt || changed, dateOnly: !changedAt, phase: 2, source: "ePASS", by: changedBy, label: `${what} last changed in ePASS`, text: [severalOpen ? o.code : "", changedBy ? `by ${changedBy}` : ""].filter(Boolean).join(" "), sub: "ePASS keeps who and when, not what was changed" }));
    }
    // ...and, once it is finished but not yet posted ("Not Posted"), when and by whom.
    const done = finishedOpenDay(o), doneAt = storeInstant(done, rawText(o.raw, "TimeFinished")), doneBy = rawText(o.raw, "UserFinished");
    if (done) {
      haveFinished.done = true;
      out.push(line({ id: `fin:${o.code}`, at: doneAt || done, dateOnly: !doneAt, phase: 2, tone: "done", source: "ePASS", by: doneBy, label: `${what} finished in ePASS`, text: [severalOpen ? o.code : "", doneBy ? `by ${doneBy}` : ""].filter(Boolean).join(" "), sub: "not posted yet" }));
    }
  }
  if (!haveWritten.done) {
    const start = rec.openSales.map((r) => dayOf(r.start_date)).concat(rec.units.map((u) => dayOf(u.start_date))).filter(Boolean).sort()[0];
    if (start) { haveWritten.done = true; out.push(line({ id: "eo:written", at: start, dateOnly: true, phase: 0, label: "Order written in ePASS", source: "ePASS" })); }
  }
  for (const [i, pmt] of rec.epassPayments.entries()) {
    const day = dayOf(pmt.paid_on) || dayOf(pmt.post_date);
    if (!day || !pmt.amount) continue;
    const type = payTypeName(pmt.payment_type), keyedBy = rawText(pmt.raw, "UserCreated");
    out.push(line({
      id: `ep:${i}`, at: day, dateOnly: true, phase: 2, tone: pmt.amount < 0 ? "paidback" : "posted", source: "ePASS", amount: dollars(pmt.amount), by: keyedBy,
      label: pmt.amount < 0 ? `${money(Math.abs(pmt.amount))} paid back in ePASS` : `${money(pmt.amount)} posted in ePASS`,
      text: [type ? `as ${type}` : "", keyedBy ? `keyed by ${keyedBy}` : ""].filter(Boolean).join(", "), sub: [pmt.invoice && rec.epassPayments.some((x) => x.invoice !== pmt.invoice) ? pmt.invoice : "", clean(pmt.status, 30)].filter(Boolean).join(" · ")
    }));
  }
  for (const f of rec.finished) {
    if (!dayOf(f.finish_date)) continue;
    haveFinished.done = true;
    out.push(line({ id: `fin:${f.invoice}`, at: dayOf(f.finish_date), dateOnly: true, phase: 2, tone: "done", source: "ePASS", label: /^SV/i.test(f.invoice) ? "Ticket finished in ePASS" : Number(f.invoice_total) < 0 ? "Credit invoice finished in ePASS" : "Order finished in ePASS", text: [f.invoice, f.department, f.salesperson].filter(Boolean).join(" · "), sub: f.invoice_total ? money(f.invoice_total) : "" }));
  }
  // a finished service ticket the commission upload does not carry: the 3-year service history has it
  for (const o of rec.openOrders.filter((x) => !x.open)) {
    const row = orderRowFromInvoice(o.raw || {}, { service: true }) || {};
    const finishDay = dayOf(rawText(o.raw, "DateFinished")) || dayOf(row.finishDate);
    if (haveFinished.done || !finishDay) continue;
    haveFinished.done = true;
    out.push(line({ id: `fin:${o.code}`, at: finishDay, dateOnly: true, phase: 2, tone: "done", source: "ePASS", label: "Ticket finished in ePASS", text: [o.code, row.sp ? "tech " + row.sp : ""].filter(Boolean).join(" · "), sub: row.total ? money(row.total) : "", quote: rawText(o.raw, "SvcPerformedDesc") }));
  }
  for (const [i, l] of rec.returnLines.entries()) {
    // the day its invoice finished when we have it; otherwise only the commission month it was reported in
    const when = dayOf(rec.finished.find((f) => f.invoice === l.invoice)?.finish_date) || (/^\d{4}-\d{2}$/.test(l.source_month || "") ? l.source_month : "");
    if (!when) continue;
    out.push(line({ id: `ret:${i}`, at: when, dateOnly: true, phase: 2, tone: "return", source: "ePASS", label: `Returned: ${clean(l.product, 60) || clean(l.line_type, 30) || "line"}`, text: `${l.qty} on ${l.invoice}`, sub: [l.serial_number ? `serial ${l.serial_number}` : "", l.revenue ? money(l.revenue) : ""].filter(Boolean).join(" · ") }));
  }
  return out;
}

const DISPOSITION = { missing_conversion: "marked sold", followup: "marked for follow-up", lost: "marked lost", no_followup: "marked no follow-up needed" };
function quoteLines(rec) {
  const out = [];
  for (const q of rec.quotes) {
    const own = ticketKey(q.quote_number)?.key === rec.key;
    const tag = own ? "Quote" : `Quote ${q.quote_number}`;
    if (dayOf(q.date_created)) out.push(line({ id: `q:${q.quote_number}:written`, at: dayOf(q.date_created), dateOnly: true, phase: 0, source: q.source === "epass" ? "ePASS" : "Agility", label: `${tag} written`, text: q.sp_code ? `by ${q.sp_code}` : "", sub: q.total ? money(q.total) : "", by: q.sp_code || "" }));
    if (q.d_status && q.d_at) out.push(line({ id: `q:${q.quote_number}:disp`, at: isoOf(q.d_at), tone: q.d_status === "lost" ? "off" : "", label: `${tag} ${DISPOSITION[q.d_status] || q.d_status}`, text: `${q.d_order ? "on order " + q.d_order + " " : ""}by ${q.d_by || q.d_email || "staff"}`.trim(), quote: q.d_comment || "", by: q.d_by || "" }));
    if (q.conv_invoice && q.matched_at) out.push(line({ id: `q:${q.quote_number}:conv`, at: isoOf(q.matched_at), tone: "done", label: own ? `Matched to order ${q.conv_invoice}` : `${tag} matched to this order`, sub: "matched by customer and salesperson when the feed was read, not at the moment of the sale" }));
  }
  return out;
}

function webOrderLines(rec) {
  const out = [];
  for (const w of rec.webOrders) {
    const id = `web:${w.order_number}`, total = Number(w.totals?.total ?? w.totals?.grandTotal ?? 0), cs = w.card_summary || {};
    out.push(line({ id: id + ":placed", at: isoOf(w.created_at), tone: "request", label: `Web order ${w.order_number} placed`, text: "by the client on the online shop", sub: [total ? money(total) : "", cs.last4 ? `card on file: ${cs.brand ? brandCase(cs.brand) + " " : ""}•••• ${cs.last4}` : ""].filter(Boolean).join(" · ") }));
    if (w.claimed_at) out.push(line({ id: id + ":claimed", at: isoOf(w.claimed_at), label: "Web order claimed", text: `by ${w.claimed_by_name || w.claimed_by_email || "a consultant"}`, by: w.claimed_by_name || "" }));
    if (w.completed_at) out.push(line({ id: id + ":entered", at: isoOf(w.completed_at), tone: "done", label: `Entered in ePASS${w.epass_ticket ? " as " + w.epass_ticket : ""}`, text: w.claimed_by_name ? `by ${w.claimed_by_name}` : "", by: w.claimed_by_name || "" }));
    if (w.canceled_at) out.push(line({ id: id + ":cancel", at: isoOf(w.canceled_at), tone: "off", label: "Web order cancelled", sub: clean(w.cancel_reason, 160) }));
  }
  return out;
}

const TEXT_KIND = { morning: "morning of delivery", next_stop: "you're next", completed: "delivered" };
function deliveryLines(rec) {
  const out = [];
  for (const s of rec.stops) {
    const id = `del:${s.id}`, run = [s.run_name, s.driver_name].filter(Boolean).join(" · ");
    out.push(line({ id: id + ":added", at: isoOf(s.created_at), source: "Delivery", label: "Added to a delivery run", text: dayOf(s.run_date) ? `for ${niceDay(s.run_date)}` : "", sub: [s.run_name, s.driver_name, s.window_text].filter(Boolean).join(" · ") }));
    for (const [i, t] of (Array.isArray(s.texts) ? s.texts : []).entries()) {
      if (!t?.at) continue;
      out.push(line({ id: `${id}:text${i}`, at: t.at, source: "Delivery", tone: t.ok === false ? "off" : "", label: t.ok === false ? "Delivery text failed" : "Delivery text sent to the client", text: TEXT_KIND[t.kind] ? `(${TEXT_KIND[t.kind]})` : t.kind ? `(${clean(t.kind, 30).replace(/_/g, " ")})` : "", sub: t.ok === false ? clean(t.error, 120) : "" }));
    }
    if (s.arrived_at) out.push(line({ id: id + ":arrived", at: isoOf(s.arrived_at), source: "Delivery", label: "Truck arrived", sub: run }));
    if (s.completed_at && s.status === "done") out.push(line({ id: id + ":done", at: isoOf(s.completed_at), source: "Delivery", tone: "done", label: "Delivered", text: s.signed_name ? `signed for by ${s.signed_name}` : "", sub: Number(s.photo_count) ? `${s.photo_count} photo${Number(s.photo_count) === 1 ? "" : "s"}` : "" }));
    if (["exception", "skipped"].includes(s.status)) out.push(line({ id: id + ":exception", at: isoOf(s.completed_at || s.departed_at || s.arrived_at || s.created_at), source: "Delivery", tone: "off", label: s.status === "skipped" ? "Delivery stop skipped" : "Delivery exception", quote: clean(s.exception_note, 200) }));
  }
  return out;
}

// Sort key: the store-local day, then the phase, then the exact instant.
function sortKey(l) {
  if (!l.dateOnly) return `${localDay(l.at)}|1|${l.at}`;
  const day = /^\d{4}-\d{2}$/.test(l.at) ? `${l.at}-31` : l.at; // a month sorts after its days
  return `${day}|${l.phase === 0 ? 0 : 2}|`;
}

// records: what collectTicketRecords returned. ledger: the Agility payment
// story for the same number(s) - { events: [...] } from server.js, or null.
export function buildTicketAudit(rec, ledger = null) {
  const payName = new Map((rec.payTypes || []).map((r) => [String(r.code || "").toUpperCase(), clean(r.description, 60)]));
  const payTypeName = (code) => { const c = String(code || "").toUpperCase(); return payName.get(c) ? `${payName.get(c)} (${c})` : c; };
  const haveWritten = { done: false }, haveFinished = { done: false };
  const lines = [
    ...webOrderLines(rec), ...quoteLines(rec),
    ...epassOrderLines(rec, haveWritten, haveFinished, payTypeName), ...serviceLines(rec, haveWritten, haveFinished),
    ...estimateLines(rec.estimates), ...ledgerLines(ledger?.events), ...deliveryLines(rec)
  ].filter((l) => l.at && l.label);
  const seen = new Set();
  // `day` is the store's calendar day the line belongs under (a month, YYYY-MM, when that is all we know)
  const events = lines.filter((l) => (seen.has(l.id) ? false : seen.add(l.id))).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .map(({ phase, ...l }) => ({ ...l, day: l.dateOnly ? l.at : localDay(l.at) }));

  // ---- the header: who, what kind of ticket, how it stands
  const job = rec.jobs[0], open = rec.openOrders[0], openRow = open ? orderRowFromInvoice(open.raw || {}, { service: open.service }) || {} : null;
  const fin = rec.finished[0], est = rec.estimates[0], web = rec.webOrders[0], ownQuote = rec.quotes.find((q) => ticketKey(q.quote_number)?.key === rec.key);
  const led = ledger?.contact || {};
  // the ticket's own number as ePASS spells it (leading zeros kept), not one of its sub-invoices
  const number = rec.web && web ? web.order_number
    : String(job?.sv_number || open?.code || fin?.invoice || rec.openSales[0]?.invoice || ownQuote?.quote_number || est?.svNumber || rec.typed).toUpperCase().trim().replace(/-\d{1,2}$/, "");
  const kind = rec.web ? "web" : ownQuote || /^Q\d/.test(rec.key) ? "quote" : job || est || /^SV/.test(rec.key) ? "service" : "sales";
  const customerName = clean(job?.customer_name || openRow?.name || fin?.customer_name || rec.openSales[0]?.customer_name || est?.customerName || webName(web) || ownQuote?.customer_name || rec.stops[0]?.customer_name || led.name || rec.units[0]?.customer_name, 120);
  const phone = clean(job?.phone || est?.contactPhone || web?.customer?.phone || rec.stops[0]?.phone || led.phone, 30);
  const email = clean(job?.email || est?.contactEmail || web?.customer?.email || led.email || openRow?.billToEmail, 120);
  const customerNumber = clean(job?.customer_code || openRow?.customerNumber || fin?.customer_number || rec.openSales[0]?.customer_number || est?.customerNumber || ownQuote?.customer_number, 40);

  const historyFinish = rec.openOrders.filter((o) => !o.open).map((o) => dayOf(rawText(o.raw, "DateFinished")) || dayOf((orderRowFromInvoice(o.raw || {}, { service: true }) || {}).finishDate)).filter(Boolean).sort().pop();
  // The 15-minute feed is the fresher word on what is open. A row there that
  // ePASS has already finished ("Not Posted") is finished, not open.
  const feedOpen = rec.openOrders.filter((o) => o.open), unposted = feedOpen.filter((o) => finishedOpenDay(o));
  const stillOpen = feedOpen.length ? feedOpen.length > unposted.length : rec.openSales.length > 0;
  const lastFinish = rec.finished.map((f) => dayOf(f.finish_date)).filter(Boolean).sort().pop() || historyFinish || unposted.map(finishedOpenDay).sort().pop() || dayOf(job?.epass_finish_date);
  const state = web?.canceled_at && !rec.finished.length ? { tone: "off", label: "Cancelled" }
    : lastFinish && stillOpen && feedOpen.length ? { tone: "open", label: "Partly finished" }
      : lastFinish && unposted.length ? { tone: "done", label: "Finished, not posted" }
      : lastFinish ? { tone: "done", label: "Finished" }
      : job && ["SO7", "SO9"].includes(job.status) ? { tone: "off", label: statusName(job.status) }
        : kind === "quote" ? (ownQuote?.conv_invoice ? { tone: "done", label: "Converted" } : ownQuote && !ownQuote.is_open ? { tone: "", label: "Closed" } : { tone: "open", label: "Open quote" })
          : stillOpen || (job && !job.closed_at) ? { tone: "open", label: "Open" }
            : web && !web.completed_at ? { tone: "open", label: "Waiting to be entered" }
              : { tone: "", label: events.length ? "On file" : "Nothing found" };

  const facts = [];
  if (job) {
    if (job.status) facts.push(["Service status", `${statusName(job.status) || job.status}${statusName(job.status) ? ` (${job.status})` : ""}`]);
    if (job.route_date && !lastFinish) facts.push(["Scheduled", `${niceDay(job.route_date)}${job.assigned_tech ? " · tech " + job.assigned_tech : ""}`]);
    if (job.unit_brand || job.unit_model) facts.push(["Unit", [job.unit_brand, job.unit_model, job.unit_serial ? "serial " + job.unit_serial : ""].filter(Boolean).join(" · ")]);
  }
  if (openRow) {
    if (openRow.status || openRow.jobStatus) facts.push(["ePASS status", [openRow.status, openRow.jobStatus].filter(Boolean).join(" · ")]);
    if (!job && niceDay(openRow.schedDate)) facts.push(["Scheduled in ePASS", niceDay(openRow.schedDate)]);
    if (niceDay(openRow.pickupDate)) facts.push(["Pickup date", niceDay(openRow.pickupDate)]);
    if (openRow.paymentType) facts.push(["Payment type", payTypeName(openRow.paymentType)]);
  }
  const address = clean([job?.address1, job?.city, job?.zip].filter(Boolean).join(", ") || [openRow?.address, openRow?.zip].filter(Boolean).join(", "), 160);
  if (address) facts.push(["Address", address]);
  if (fin?.reference || openRow?.reference) facts.push(["Reference", clean(fin?.reference || openRow?.reference, 120)]);

  // ---- money: two separate books, never added together
  const paid = events.filter((e) => e.tone === "paid"), refunds = events.filter((e) => e.tone === "refund");
  const agilityPaid = dollars(paid.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const agilityRefunded = dollars(refunds.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const epassPosted = dollars(rec.epassPayments.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const finishedCodes = new Set(rec.finished.map((f) => String(f.invoice).toUpperCase()));
  const epassCopies = rec.openOrders.filter((o) => !finishedCodes.has(String(o.code).toUpperCase()));
  const finishedTotal = rec.finished.reduce((s, f) => s + (Number(f.invoice_total) || 0), 0);
  const openTotal = epassCopies.length ? epassCopies.reduce((s, o) => s + ((orderRowFromInvoice(o.raw || {}, { service: o.service }) || {}).total || 0), 0)
    : rec.openSales.filter((o) => !finishedCodes.has(String(o.invoice).toUpperCase())).reduce((s, o) => s + (Number(o.invoice_total) || 0), 0);
  const orderTotal = rec.finished.length || epassCopies.length || rec.openSales.length ? dollars(finishedTotal + openTotal)
    : job?.total != null ? Number(job.total) : ownQuote ? Number(ownQuote.total) || null : web ? Number(web.totals?.total) || null : null;
  // what is still owed only means something while ePASS has the ticket open
  const balance = open?.open ? openRow.balance : job && !lastFinish && job.balance != null ? Number(job.balance) : null;

  // ---- other numbers this ticket points at
  const related = [];
  const relate = (num, why) => { const k = ticketKey(num)?.key; if (k && k !== rec.key && !related.some((r) => r.key === k)) related.push({ key: k, number: String(num).toUpperCase(), why }); };
  for (const q of rec.quotes) { if (ticketKey(q.quote_number)?.key !== rec.key) relate(q.quote_number, "quote"); if (q.conv_invoice) relate(q.conv_invoice, "order it became"); if (q.d_order) relate(q.d_order, "order it was sold on"); }
  for (const w of rec.webOrders) { if (!rec.web) relate(w.order_number, "web order"); else if (w.epass_ticket) relate(w.epass_ticket, "ePASS ticket"); }
  const subInvoices = [...new Set([...rec.finished.map((f) => f.invoice), ...rec.openOrders.map((o) => o.code), ...rec.openSales.map((o) => o.invoice)].map((s) => String(s).toUpperCase()))].filter((s) => /-\d{1,2}$/.test(s));

  return {
    number, key: rec.key, kind, kindLabel: { service: "Service ticket", sales: "Sales order", quote: "Quote", web: "Web order" }[kind], state,
    customerName, customerNumber, phone, email, facts,
    timeZone: TZ, events,
    money: { agilityPaid, agilityRefunded, agilityNet: dollars(agilityPaid - agilityRefunded), paidCount: paid.length, refundCount: refunds.length, epassPosted, epassCount: rec.epassPayments.length, orderTotal, balance },
    units: rec.units.map((u) => ({ invoice: u.invoice, model: clean(u.model, 60), serial: clean(u.serial, 60), price: u.selling_price || null, returned: Boolean(u.returned) })),
    related, subInvoices,
    sources: sourceList(rec, ledger)
  };
}
// Which records answered, so an empty section reads as "no record" and not "nothing happened".
function sourceList(rec, ledger) {
  return [
    ["Payments and refunds taken through Agility", (ledger?.events || []).length],
    ["Service request and estimates", rec.estimates.length + (ledger?.events || []).filter((e) => e.kind === "request").length],
    ["Service board", rec.jobs.length ? rec.history.length || 1 : 0],
    ["ePASS open orders and tickets", rec.openOrders.filter((o) => o.open).length + rec.openSales.length],
    ["ePASS finished orders and tickets", rec.finished.length + rec.openOrders.filter((o) => !o.open).length],
    ["Payments keyed in ePASS (last 13 months)", rec.epassPayments.length],
    ["Quote Follow-Up", rec.quotes.length],
    ["Online shop", rec.webOrders.length],
    ["Delivery runs", rec.stops.length]
  ].map(([name, count]) => ({ name, count }));
}

// ---- finding a ticket by who it is for -----------------------------------------
// Name, phone or email -> the tickets on file for them, newest first. The
// Agility payment ledgers are searched by server.js and merged with this.
export async function searchTicketRecords(q, { limit = 40 } = {}) {
  const raw = clean(q, 80);
  const term = raw.replace(/[%_\\]/g, "").trim(); // no wildcards of the searcher's own
  if (term.length < 3) return [];
  const p = await pool();
  const digits = term.replace(/\D/g, "");
  const byPhone = digits.length >= 7 && !/[a-z@]/i.test(term);
  const byEmail = !byPhone && term.includes("@");
  const byName = !byPhone && !byEmail;
  const like = `%${term}%`, emailLike = `%${term.toLowerCase()}%`, phoneLike = `%${digits.slice(-10)}%`;
  const out = [];
  const add = (number, kind, customerName, when, what) => { const k = ticketKey(number); if (k) out.push({ number: String(number).toUpperCase(), key: k.key, kind, customerName: clean(customerName, 120), when: isoOf(when) || "", what }); };

  // This person's ePASS customer numbers, so their orders are found even
  // when the name on a ticket is written differently ("DELGADO ROSA").
  const customers = await rowsOf(p,
    byPhone ? `SELECT code FROM epass_customers WHERE EXISTS (SELECT 1 FROM unnest(phones) ph WHERE ph LIKE $1) ORDER BY date_modified DESC NULLS LAST LIMIT 25`
      : byEmail ? `SELECT code FROM epass_customers WHERE EXISTS (SELECT 1 FROM unnest(emails) em WHERE lower(em) LIKE $1) ORDER BY date_modified DESC NULLS LAST LIMIT 25`
        : `SELECT code FROM epass_customers WHERE name ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1 OR (last_name || ' ' || first_name) ILIKE $1 ORDER BY date_modified DESC NULLS LAST LIMIT 25`,
    [byPhone ? phoneLike : byEmail ? emailLike : like]);
  const codes = customers.map((c) => c.code).filter(Boolean);

  // WHERE for one table: the contact detail typed (when the table has that
  // column), or one of the customer numbers above. null = nothing to match on.
  const where = ({ name, phones = [], email, code }) => {
    const parts = [], params = [];
    const use = (sqlFor, value) => { params.push(value); parts.push(sqlFor(`$${params.length}`)); };
    if (byPhone && phones.length) use(($) => phones.map((c) => `regexp_replace(${c}, '[^0-9]', '', 'g') LIKE ${$}`).join(" OR "), phoneLike);
    if (byEmail && email) use(($) => `lower(${email}) LIKE ${$}`, emailLike);
    if (byName && name) use(($) => `${name} ILIKE ${$}`, like);
    if (code && codes.length) use(($) => `${code} = ANY(${$}::text[])`, codes);
    return parts.length ? { sql: parts.map((x) => `(${x})`).join(" OR "), params } : null;
  };
  const run = (w, sqlFor) => (w ? rowsOf(p, sqlFor(w.sql), w.params) : Promise.resolve([]));

  const [jobs, ests, webs, fin, open, quotes] = await Promise.all([
    run(where({ name: "customer_name", phones: ["phone", "phone_alt"], email: "email", code: "customer_code" }),
      (w) => `SELECT sv_number, customer_name, status, COALESCE(epass_created_at::text, to_char(first_seen_at, 'YYYY-MM-DD')) AS at, closed_at FROM sj_jobs WHERE ${w} ORDER BY first_seen_at DESC LIMIT 30`),
    run(where({ name: "customer_name", phones: ["contact_phone"], email: "contact_email", code: "customer_number" }),
      (w) => `SELECT sv_number, customer_name, created_at, closed_at FROM service_estimates WHERE sv_number <> '' AND (${w}) ORDER BY created_at DESC LIMIT 30`),
    run(where({ name: "(COALESCE(customer->>'firstName','') || ' ' || COALESCE(customer->>'lastName',''))", phones: ["COALESCE(customer->>'phone','')"], email: "COALESCE(customer->>'email','')" }),
      (w) => `SELECT order_number, customer, status, created_at, epass_ticket FROM shop_orders WHERE ${w} ORDER BY created_at DESC LIMIT 20`),
    run(where({ name: "customer_name", code: "customer_number" }), (w) => `SELECT invoice, customer_name, finish_date FROM sales_order_detail WHERE ${w} ORDER BY finish_date DESC LIMIT 40`),
    run(where({ name: "customer_name", code: "customer_number" }), (w) => `SELECT invoice, customer_name, start_date FROM open_sales_orders WHERE ${w} ORDER BY start_date DESC LIMIT 30`),
    run(where({ name: "customer_name", code: "customer_number" }), (w) => `SELECT quote_number, customer_name, date_created, total::float AS total, is_open FROM quote_followup_quotes WHERE ${w} ORDER BY date_created DESC LIMIT 30`)
  ]);
  for (const r of jobs) add(r.sv_number, "service", r.customer_name, r.at, `Service ticket · ${statusName(r.status) || r.status || (r.closed_at ? "closed" : "open")}`);
  for (const r of ests) add(r.sv_number, "service", r.customer_name, r.created_at, `Service estimate · ${r.closed_at ? "closed" : "open"}`);
  for (const r of webs) add(r.order_number, "web", webName(r), r.created_at, `Web order · ${r.status}${r.epass_ticket ? " · ePASS " + r.epass_ticket : ""}`);
  for (const r of fin) add(r.invoice, /^SV/i.test(r.invoice) ? "service" : "sales", r.customer_name, dayOf(r.finish_date), `${/^SV/i.test(r.invoice) ? "Service ticket" : "Sales order"} · finished ${niceDay(r.finish_date)}`);
  for (const r of open) add(r.invoice, /^SV/i.test(r.invoice) ? "service" : /^Q/i.test(r.invoice) ? "quote" : "sales", r.customer_name, dayOf(r.start_date), `${/^Q/i.test(r.invoice) ? "Quote" : "Open order"} · written ${niceDay(r.start_date)}`);
  for (const r of quotes) add(r.quote_number, "quote", r.customer_name, dayOf(r.date_created), `Quote · ${money(r.total)}${r.is_open ? " · open" : ""}`);
  return mergeTicketHits(out, limit);
}
// One row per ticket: the first description wins, the newest date is kept.
export function mergeTicketHits(rows, limit = 40) {
  const base = (n) => String(n || "").toUpperCase().replace(/-\d{1,2}$/, ""); // the ticket, not one of its sub-invoices
  const byKey = new Map();
  for (const r of rows) {
    const cur = byKey.get(r.key);
    if (!cur) { byKey.set(r.key, { ...r, number: base(r.number), also: [] }); continue; }
    if (r.what && r.what !== cur.what && !cur.also.includes(r.what) && cur.also.length < 3) cur.also.push(r.what);
    if (base(r.number).length > cur.number.length) cur.number = base(r.number); // the spelling with its leading zeros
    if (!cur.customerName && r.customerName) cur.customerName = r.customerName;
    if (String(r.when) > String(cur.when)) cur.when = r.when;
    if (cur.kind === "sales" && r.kind !== "sales") cur.kind = r.kind;
  }
  // A payment filed under the digits alone ("98765") belongs with the one
  // lettered ticket that has those digits ("A0098765"), when there is just one.
  for (const [key, row] of [...byKey]) {
    if (!/^\d+$/.test(key)) continue;
    const homes = [...byKey.keys()].filter((k) => k !== key && k.replace(/^[A-Z]+/, "") === key);
    if (homes.length !== 1) continue;
    const home = byKey.get(homes[0]);
    for (const w of [row.what, ...row.also]) if (w && w !== home.what && !home.also.includes(w) && home.also.length < 3) home.also.push(w);
    if (String(row.when) > String(home.when)) home.when = row.when;
    byKey.delete(key);
  }
  return [...byKey.values()].sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, limit);
}
