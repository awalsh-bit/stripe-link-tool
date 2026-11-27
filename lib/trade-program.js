// ---------------------------------------------------------------------------
// Trade Partner Rebate Program: the terms (Andrew 11/27).
//
// data/trade-program.json is the one place the program is written down: the
// year, the three tiers, the two bonuses, the worked example and the rules.
// The flyer on the Trade Partners page (Agility, signed-in, page grant) and
// the registration page builders are sent (/trade-partner) are both drawn
// from it, so they cannot disagree.
//
// Two views of the same file:
//   tradeProgramFull()    everything, for the flyer. Signed-in only.
//   tradeProgramPublic()  what the registration page needs. The rates and
//                         tier lines are left out unless the file says
//                         "showRatesOnRegistration": true. Andrew: "this
//                         flyer would not be available to the public".
// ---------------------------------------------------------------------------
import { promises as fs } from "fs";
import path from "path";

// What kind of company is registering (the form's list; the key is stored).
export const TRADE_BUSINESS_TYPES = [
  ["custom_builder", "Custom home builder"],
  ["production_builder", "Production builder"],
  ["remodeler", "Remodeler"],
  ["designer", "Interior designer"],
  ["architect", "Architect"],
  ["developer", "Developer or property manager"],
  ["other", "Other"]
];
export const TRADE_PROJECT_RANGES = ["1 to 5", "6 to 15", "16 to 40", "More than 40"];

const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

export const tradeMoney = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
// 1 -> "1", 1.5 -> "1.5" (for "+1%", "1–2%", "4%"); the tier table uses one decimal ("1.0%").
export const tradeRate = (n) => String(Math.round(Number(n) * 100) / 100);
export const tradeRate1 = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);

// Read and check the file's contents. Throws with a plain reason when the
// file can't describe a program (no tiers, a rate that isn't a number), so a
// typing slip shows up as "the program terms can't be read" and not as a
// flyer with "NaN%" on it.
export function normalizeTradeProgram(raw) {
  if (!raw || typeof raw !== "object") throw new Error("The program terms file is empty.");
  const year = Math.round(num(raw.programYear));
  if (!(year >= 2024 && year <= 2100)) throw new Error("programYear is missing.");
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .map((t) => ({ name: str(t?.name, 30), min: Math.round(num(t?.min)), rate: num(t?.rate) }))
    .filter((t) => t.name || Number.isFinite(t.min) || Number.isFinite(t.rate));
  if (!tiers.length) throw new Error("The program has no tiers.");
  for (const t of tiers) {
    if (!t.name) throw new Error("A tier has no name.");
    if (!(t.min > 0)) throw new Error(`The ${t.name} tier needs the purchases it starts at.`);
    if (!(t.rate > 0 && t.rate <= 25)) throw new Error(`The ${t.name} tier needs a rate between 0 and 25.`);
  }
  tiers.sort((a, b) => a.min - b.min);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].min === tiers[i - 1].min) throw new Error(`${tiers[i - 1].name} and ${tiers[i].name} start at the same amount.`);
    if (tiers[i].rate < tiers[i - 1].rate) throw new Error(`${tiers[i].name} pays less than ${tiers[i - 1].name}.`);
  }
  const bonus = (b, what) => {
    if (b == null) return null;
    const rate = num(b.rate);
    if (!(rate > 0 && rate <= 25)) throw new Error(`The ${what} bonus needs a rate between 0 and 25.`);
    return rate;
  };
  const sbRate = bonus(raw.selectBrands, "select brands");
  const brands = (Array.isArray(raw.selectBrands?.brands) ? raw.selectBrands.brands : []).map((b) => str(b, 40)).filter(Boolean).slice(0, 12);
  if (sbRate && !brands.length) throw new Error("The select brands bonus lists no brands.");
  const payRate = bonus(raw.payment, "payment");
  const ex = raw.example && typeof raw.example === "object" ? raw.example : {};
  const c = raw.contact && typeof raw.contact === "object" ? raw.contact : {};
  return {
    year,
    name: str(raw.name, 80) || "Trade Partner Rebate Program",
    registrationOpen: raw.registrationOpen !== false,
    showRatesOnRegistration: raw.showRatesOnRegistration === true,
    tiers,
    selectBrands: sbRate ? { rate: sbRate, brands } : null,
    payment: payRate ? { rate: payRate, label: str(raw.payment.label, 40) || "Check or ACH", detail: str(raw.payment.detail, 120) || "On invoices paid by check or ACH within terms" } : null,
    example: { purchases: Math.max(0, Math.round(num(ex.purchases)) || 0), selectBrands: Math.max(0, Math.round(num(ex.selectBrands)) || 0) },
    payout: str(raw.payout, 40),
    terms: (Array.isArray(raw.terms) ? raw.terms : []).map((t) => str(t, 900)).filter(Boolean).slice(0, 6),
    contact: {
      company: str(c.company, 80) || "Wilson AC & Appliance",
      address: str(c.address, 160),
      phone: str(c.phone, 30),
      website: str(c.website, 80)
    }
  };
}

// The tier a year's purchases land in (null under the first tier).
export function tradeTierFor(program, purchases) {
  let hit = null;
  for (const t of program.tiers) if (Number(purchases) >= t.min) hit = t;
  return hit;
}

// What a year would pay: { tier, lines: [{ label, amount }], total }.
// Hitting a tier pays its rate on every qualifying dollar, from the first.
export function tradeRebateFor(program, { purchases = 0, selectBrands = 0, byCheckOrAch = 0 } = {}) {
  const p = Math.max(0, Number(purchases) || 0);
  const tier = tradeTierFor(program, p);
  if (!tier) return { tier: null, lines: [], total: 0 };
  const lines = [{ label: `${tier.name} ${tradeRate(tier.rate)}% × ${tradeMoney(p)}`, amount: Math.round(p * tier.rate) / 100 }];
  const sb = Math.min(p, Math.max(0, Number(selectBrands) || 0));
  if (program.selectBrands && sb > 0) lines.push({ label: `Select brands ${tradeRate(program.selectBrands.rate)}% × ${tradeMoney(sb)}`, amount: Math.round(sb * program.selectBrands.rate) / 100 });
  const pay = Math.min(p, Math.max(0, Number(byCheckOrAch) || 0));
  if (program.payment && pay > 0) lines.push({ label: `Check/ACH ${tradeRate(program.payment.rate)}% × ${tradeMoney(pay)}`, amount: Math.round(pay * program.payment.rate) / 100 });
  return { tier, lines, total: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100 };
}

// The ranges the form offers for "about how much do you buy in a year":
// under the first tier, each tier's span, then "not sure".
export function tradeEstimateRanges(program) {
  const t = program.tiers;
  const out = [`Under ${tradeMoney(t[0].min)}`];
  t.forEach((tier, i) => out.push(i + 1 < t.length ? `${tradeMoney(tier.min)} to ${tradeMoney(t[i + 1].min - 1)}` : `${tradeMoney(tier.min)} or more`));
  out.push("Not sure yet");
  return out;
}

// Everything the flyer shows, worked out: ranges, "with bonuses", the
// headline rate and the example's arithmetic. Signed-in pages only.
export function tradeProgramFull(program) {
  const bonuses = (program.selectBrands?.rate || 0) + (program.payment?.rate || 0);
  const tiers = program.tiers.map((t, i) => ({
    name: t.name, min: t.min, rate: t.rate,
    range: i + 1 < program.tiers.length ? `${tradeMoney(t.min)} – ${tradeMoney(program.tiers[i + 1].min - 1)}` : `${tradeMoney(t.min)}+`,
    base: `${tradeRate1(t.rate)}%`,
    withBonuses: `up to ${tradeRate1(t.rate + bonuses)}%`
  }));
  const low = program.tiers[0].rate, high = program.tiers[program.tiers.length - 1].rate;
  const ex = program.example.purchases > 0
    ? tradeRebateFor(program, { purchases: program.example.purchases, selectBrands: program.example.selectBrands, byCheckOrAch: program.example.purchases })
    : null;
  return {
    year: program.year, name: program.name, registrationOpen: program.registrationOpen, showRatesOnRegistration: program.showRatesOnRegistration,
    tiers,
    baseRange: low === high ? `${tradeRate(low)}%` : `${tradeRate(low)}–${tradeRate(high)}%`,
    maxRate: `${tradeRate(high + bonuses)}%`,
    selectBrands: program.selectBrands ? { rate: `+${tradeRate(program.selectBrands.rate)}%`, brands: program.selectBrands.brands } : null,
    payment: program.payment ? { rate: `+${tradeRate(program.payment.rate)}%`, label: program.payment.label, detail: program.payment.detail } : null,
    example: ex && ex.tier
      ? {
          intro: `${tradeMoney(program.example.purchases)} in annual purchases${program.selectBrands && program.example.selectBrands > 0 ? `, ${tradeMoney(program.example.selectBrands)} in select brands` : ""}${program.payment ? ", all paid by ACH" : ""}:`,
          lines: ex.lines.map((l) => ({ label: l.label, amount: tradeMoney(l.amount) })),
          total: tradeMoney(ex.total)
        }
      : null,
    payout: program.payout, terms: program.terms, contact: program.contact
  };
}

// What the registration page is sent. No rates, no tier lines, no example
// unless the file switches them on.
export function tradeProgramPublic(program) {
  const full = program.showRatesOnRegistration ? tradeProgramFull(program) : null;
  return {
    year: program.year, name: program.name, registrationOpen: program.registrationOpen,
    payout: program.payout, terms: program.terms,
    contact: { company: program.contact.company, phone: program.contact.phone, website: program.contact.website },
    businessTypes: TRADE_BUSINESS_TYPES.map(([key, label]) => ({ key, label })),
    projectRanges: TRADE_PROJECT_RANGES,
    estimateRanges: tradeEstimateRanges(program),
    rates: full ? { tiers: full.tiers.map(({ name, range, base, withBonuses }) => ({ name, range, base, withBonuses })), maxRate: full.maxRate, selectBrands: full.selectBrands, payment: full.payment } : null
  };
}

// The file, read at most every 30 seconds.
let memo = { at: 0, dir: "", value: null };
export async function loadTradeProgram(dataDir) {
  if (memo.value && memo.dir === dataDir && Date.now() - memo.at < 30 * 1000) return memo.value;
  const raw = JSON.parse(await fs.readFile(path.join(dataDir, "trade-program.json"), "utf8"));
  const value = normalizeTradeProgram(raw);
  memo = { at: Date.now(), dir: dataDir, value };
  return value;
}
export function forgetTradeProgram() { memo = { at: 0, dir: "", value: null }; }
