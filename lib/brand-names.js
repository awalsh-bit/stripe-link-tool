// ---------------------------------------------------------------------------
// Brand name normalization (Andrew 10/7). ePASS brand codes are 5-character
// stubs (SPEED, KA, PROF, SZ / SUBZ...) and the same maker can hide behind
// more than one of them; NetSuite's item export carries the proper brand
// ("Speed Queen", "Sub-Zero") per model. One resolver, used by Brand Sales
// and the Quote Follow-Up brand filter, turns any (model, brand code, ePASS
// brand description) into ONE display name so every spelling of a brand
// lands in the same row / chip.
//
// Precedence for a code's name: the NetSuite brand most models of that code
// agree on (proper case preferred) -> the ePASS Brand master description ->
// the known-code table below -> the code title-cased. Two codes that resolve
// to the same name merge (canonical key = lower-cased alphanumerics).
// ---------------------------------------------------------------------------

export const EPASS_BRAND_NAMES = {
  SPEED: "Speed Queen", SQ: "Speed Queen", KA: "KitchenAid", KITCH: "KitchenAid", PROF: "GE Profile", CAFE: "Café", MONO: "Monogram",
  SCOT: "Scotsman", SZ: "Sub-Zero", SUBZ: "Sub-Zero", WOLF: "Wolf", COVE: "Cove", THERM: "Thermador", JENN: "JennAir", JENNA: "JennAir",
  WHIRL: "Whirlpool", MAYT: "Maytag", FRIG: "Frigidaire", ELECT: "Electrolux", SAMS: "Samsung", FP: "Fisher & Paykel", FISH: "Fisher & Paykel",
  BLUE: "BlueStar", VIK: "Viking", GAGG: "Gaggenau", UL: "U-Line", ULINE: "U-Line", BERT: "Bertazzoni", LIEB: "Liebherr", ZEPH: "Zephyr",
  VENT: "Vent-A-Hood", VAH: "Vent-A-Hood", INSIN: "InSinkErator", HEST: "Hestan", TWIN: "Twin Eagles", ALFRE: "Alfresco", MARV: "Marvel",
  PERL: "Perlick", PANAS: "Panasonic", HISEN: "Hisense", HOTP: "Hotpoint", BLOMB: "Blomberg", AVANT: "Avanti", BROAN: "Broan", DACOR: "Dacor",
  MIELE: "Miele", BOSCH: "Bosch", TRANE: "Trane", TRUE: "True", ASKO: "Asko", SMEG: "Smeg", LYNX: "Lynx", DCS: "DCS", GE: "GE", LG: "LG",
  AMANA: "Amana", BEKO: "Beko", DANBY: "Danby", SHARP: "Sharp", HAIER: "Haier", ZLINE: "ZLINE", SUMM: "Summit", BLAZE: "Blaze", COYOT: "Coyote"
};

export const canonBrandKey = (x) => String(x || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const titleCaseBrand = (x) => String(x || "").trim().replace(/[A-Za-z0-9']+/g, (w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
const hasLower = (s) => /[a-z]/.test(String(s || ""));

// brandMap: { MODEL: { brand, ... } } from the NetSuite item import
//           (getModelBrandMap()). Keys are looked up as given and upper-cased.
// samples:  [{ model, brandCode, brand }] - anything that pairs a model with
//           its ePASS brand code (and optionally the ePASS Brand master's
//           description). Every sample teaches the resolver a code.
export function createBrandResolver({ brandMap = {}, samples = [] } = {}) {
  const nsOf = (model) => { const k = String(model || "").trim(); const hit = brandMap[k] || brandMap[k.toUpperCase()]; return String(hit?.brand || "").trim(); };
  const byCode = new Map(); // code -> { netsuite: Map(name -> n), epass: "" }
  const learn = (s) => {
    const code = String(s?.brandCode || "").trim().toUpperCase();
    if (!code) return;
    const e = byCode.get(code) || { netsuite: new Map(), epass: "" };
    const ns = nsOf(s.model);
    if (ns) e.netsuite.set(ns, (e.netsuite.get(ns) || 0) + 1);
    if (!e.epass && s.brand && canonBrandKey(s.brand) !== canonBrandKey(code)) e.epass = String(s.brand).trim();
    byCode.set(code, e);
  };
  for (const s of samples) learn(s);

  const displayByCode = new Map();
  const nameForCode = (codeRaw) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    if (!code) return "";
    if (displayByCode.has(code)) return displayByCode.get(code);
    const e = byCode.get(code) || { netsuite: new Map(), epass: "" };
    // the NetSuite name most models of this code agree on, proper case preferred
    const ns = [...e.netsuite.entries()].sort((a, b) => (hasLower(b[0]) - hasLower(a[0])) || (b[1] - a[1]) || (b[0].length - a[0].length))[0]?.[0] || "";
    const name = ns || e.epass || EPASS_BRAND_NAMES[code] || titleCaseBrand(code);
    const display = hasLower(name) ? name : titleCaseBrand(name);
    displayByCode.set(code, display);
    return display;
  };

  // canon(name) -> display, so "SUB-ZERO" (ePASS) and "Sub-Zero" (NetSuite) merge
  const displayFor = new Map();
  const register = (raw) => {
    if (!raw) return "";
    const key = canonBrandKey(raw);
    const cur = displayFor.get(key);
    if (!cur || (!hasLower(cur) && hasLower(raw))) displayFor.set(key, hasLower(raw) ? raw : titleCaseBrand(raw));
    return displayFor.get(key);
  };
  // The display name for a model / code / ePASS description trio.
  const brandOf = ({ model, brandCode, brand } = {}) => {
    const code = String(brandCode || "").trim().toUpperCase();
    const raw = (code ? nameForCode(code) : "") || nsOf(model) || String(brand || "").trim();
    return register(raw);
  };
  // After every row has been through brandOf once, displayOf gives the
  // final spelling for the group (proper case wins over all-caps).
  const displayOf = (raw) => displayFor.get(canonBrandKey(raw)) || raw;
  const keyOf = (x) => canonBrandKey(x);
  return { learn, nameForCode, brandOf, displayOf, keyOf, register, displayFor, codes: () => [...byCode.keys()] };
}

// Brand -> supplier straight from NetSuite (Andrew 10/7: "the supplier brand
// mapping is done in NetSuite's data"). For every NetSuite brand, the
// primary supplier / preferred vendor most of its items carry - from the
// item-catalog import (model_brand_map.vendor) and the Ordering Report's
// items CSV (netsuite_items.primary_supplier). Keyed by canonical brand.
// Either table may be missing on a fresh environment; both are guarded.
export async function loadNetsuiteBrandSuppliers(pool) {
  const tally = new Map(); // canon brand -> Map(supplier -> n)
  const add = (brand, supplier, n) => {
    const k = canonBrandKey(brand), sName = String(supplier || "").trim();
    if (!k || !sName) return;
    const m = tally.get(k) || new Map();
    m.set(sName, (m.get(sName) || 0) + (Number(n) || 1));
    tally.set(k, m);
  };
  try { for (const r of (await pool.query(`SELECT brand, vendor, COUNT(*)::int AS n FROM model_brand_map WHERE brand <> '' AND vendor <> '' GROUP BY 1, 2`)).rows) add(r.brand, r.vendor, r.n); } catch {}
  try { for (const r of (await pool.query(`SELECT brand, primary_supplier, COUNT(*)::int AS n FROM netsuite_items WHERE brand <> '' AND primary_supplier <> '' GROUP BY 1, 2`)).rows) add(r.brand, r.primary_supplier, r.n); } catch {}
  const out = {};
  for (const [k, m] of tally) out[k] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return out;
}
