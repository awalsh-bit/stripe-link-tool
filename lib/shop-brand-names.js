// ---------------------------------------------------------------------------
// One name per brand (Andrew 11/18: "the brand list is a
// bit of a mess - we need to map the ePASS brand codes over to the actual
// full names of the brands - should be the proper spelling and format in
// NetSuite").
//
// The shop took a unit's brand from wherever it found one: the model's
// NetSuite record, an older upload that stored the ePASS code or its
// description, the clearance list, or the bare code with its first letter
// capitalized. So one maker could be listed as BOSCH and Bosch, and codes
// showed up as brands (Art, Fabr, Fulgo, GOZ, JA).
//
// data/shop-brand-names.json holds:
//   names  NetSuite's brand list, spelled as NetSuite spells it
//   codes  every ePASS brand code -> the brand it belongs to
//   epass  every ePASS brand code -> its description in the ePASS brand master
//
// A unit's brand is, in order:
//   1. the brand on the model's own NetSuite record
//   2. the brand its ePASS brand code maps to
//   3. whatever name came with it, when that is a NetSuite brand under
//      another spelling, an ePASS code, or an ePASS description
//   4. the name the shop used before (nothing is lost for a brand the table
//      has never heard of)
// ---------------------------------------------------------------------------

// Later the same day: "I'm good with updating other places like Promo builder
// too, there's no reason other than the five character epass brand field
// limit that we use those." So Promo Builder and Inventory Lookup use the
// namer below, and lib/brand-names.js (Brand Sales, Quote Follow-Up, the
// clearance list) reads the same table through brandIndex.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const loose = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const allCaps = (v) => !/[a-z]/.test(String(v ?? ""));

// The table, read once per process: the file only changes with a push.
const TABLE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "shop-brand-names.json");
let tableCache = null;
export function loadBrandTable(file = TABLE_FILE) {
  if (file === TABLE_FILE && tableCache) return tableCache;
  let table = { names: [], codes: {}, epass: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    table = { names: Array.isArray(raw.names) ? raw.names : [], codes: raw.codes && typeof raw.codes === "object" ? raw.codes : {}, epass: raw.epass && typeof raw.epass === "object" ? raw.epass : {} };
  } catch {}
  if (file === TABLE_FILE) tableCache = table;
  return table;
}

// Lookups over a table. known(raw) answers for a NetSuite name under any
// spelling, an ePASS code, or an ePASS description; "" when it is none of them.
export function brandIndex(table = {}) {
  const byName = new Map(), byCode = new Map(), byDesc = new Map();
  for (const n of Array.isArray(table?.names) ? table.names : []) {
    const name = String(n ?? "").trim(), k = loose(name);
    if (k && !byName.has(k)) byName.set(k, name);
  }
  for (const [c, n] of Object.entries(table?.codes || {})) {
    const code = String(c ?? "").trim().toUpperCase(), name = String(n ?? "").trim();
    if (code && name) byCode.set(code, byName.get(loose(name)) || name);
  }
  for (const [c, d] of Object.entries(table?.epass || {})) {
    const name = byCode.get(String(c ?? "").trim().toUpperCase()), k = loose(d);
    if (name && k && !byDesc.has(k)) byDesc.set(k, name);
  }
  const known = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    return byName.get(loose(s)) || byCode.get(s.toUpperCase()) || byDesc.get(loose(s)) || "";
  };
  const forCode = (code) => byCode.get(String(code ?? "").trim().toUpperCase()) || "";
  const spelled = (name) => byName.get(loose(name)) || "";
  return { byName, byCode, byDesc, known, forCode, spelled, codes: () => Object.fromEntries(byCode) };
}

// The short form, for a screen that has no NetSuite record to ask - only an
// ePASS code and maybe the name that came with it: the code's brand, else the
// name when the table knows it, else the name as it came, else the code.
let fileIndex = null;
const theIndex = () => fileIndex || (fileIndex = brandIndex(loadBrandTable()));
export function properBrandName(brandCode, brand) {
  const given = String(brand ?? "").trim();
  return theIndex().forCode(brandCode) || theIndex().known(given) || given || String(brandCode ?? "").trim().toUpperCase();
}
// A NetSuite brand under any spelling -> NetSuite's spelling; anything else as given.
export const netsuiteSpelling = (name) => theIndex().spelled(name) || String(name ?? "").trim();

export function createShopBrandNamer(table = {}, brandMap = {}) {
  const { byName, byCode, known } = brandIndex(table);
  const recordOf = (model) => { const k = String(model ?? "").trim(); return (k && (brandMap[k] || brandMap[k.toUpperCase()])) || null; };

  return function nameBrand({ model, brandCode, brand } = {}) {
    const ns = recordOf(model);
    const code = String(brandCode ?? "").trim().toUpperCase();
    const own = String(ns?.brand ?? "").trim();
    if (ns && ns.source === "netsuite" && own) return byName.get(loose(own)) || own;
    if (code && byCode.has(code)) return byCode.get(code);
    return known(own) || known(brand) || String(brand ?? "").trim() || own || code;
  };
}

// The last step, over the finished list: two spellings of one name become
// one. A spelling with lower-case letters beats an all-capitals one; otherwise
// the first seen stays. Returns how many entries it changed.
export function unifyBrandSpellings(...lists) {
  const spell = new Map();
  const all = lists.flat().filter((x) => x && typeof x === "object");
  for (const it of all) {
    const b = String(it.brand ?? "").trim(), k = loose(b);
    if (!k) continue;
    const cur = spell.get(k);
    if (!cur || (allCaps(cur) && !allCaps(b))) spell.set(k, b);
  }
  let changed = 0;
  for (const it of all) {
    const s = spell.get(loose(it.brand));
    if (s && s !== it.brand) { it.brand = s; changed++; }
  }
  return changed;
}
