// ---------------------------------------------------------------------------
// Catalog resolver — NetSuite first, ePASS as the fallback (Andrew 10/26:
// "Agility needs to be all NetSuite formatted").
//
// One place every page asks "what do we call this?":
//   resolveModel(model, epass)  → brand, supplier, category/class/subclass,
//                                 description, discontinued — from NetSuite
//                                 when the item exists there, else from the
//                                 ePASS facts the caller already has, tagged
//                                 source: "epass" so the page can say so.
//   supplierLabel(epassCode)    → the NetSuite supplier name for an ePASS
//                                 supplier code (POs, bills, model master),
//                                 with the code kept for cross-reference.
//   shopBucketFor(ns, prod)     → the storefront bucket (Ref, DW, Range …)
//                                 derived from the NetSuite merch class, else
//                                 from the ePASS product code.
//
// Supplier aliases (ePASS code → NetSuite supplier) come, in order, from the
// Ordering Report's Settings (epass_supplier_map — the manual override),
// what the models themselves say (the NetSuite supplier most of that ePASS
// code's models carry, when ≥ 3 models and ≥ 70 % agree), the seeded
// DEFAULT_EPASS_SUPPLIER_MAP, and finally a first-word match against the
// NetSuite supplier list. The same rule the Ordering Report has used since
// 9/22, now shared.
//
// Everything is memoized for five minutes; `invalidateCatalog()` after an
// import or a settings save.
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";
import { getModelBrandMap } from "./shop-postgres.js";
import { DEFAULT_EPASS_SUPPLIER_MAP, getWrittenModelsSettings } from "./written-models.js";
import { EPASS_BRAND_NAMES } from "./brand-names.js";

const normModel = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const NOISE = new Set(["corporation", "corp", "inc", "group", "usa", "home", "appliances", "appliance", "distribution", "distributing", "distributors", "manufacturing", "brands", "electronics", "south", "central", "co", "company", "parts", "part", "llc", "ltd", "the", "of", "sales"]);
const keyWord = (name) => { const toks = String(name || "").toLowerCase().replace(/^\d{3,}\s+/, "").replace(/[.,&()'’]/g, " ").split(/[\s/-]+/).filter((t) => t && !NOISE.has(t)); return toks[0] || ""; };
const EPASS_ALIAS = { westye: "sub", wolf: "sub", subzero: "sub", sub: "sub", gec: "ge", geappliances: "ge", lgeus: "lg", wp001: "whirlpool", bshparts: "bsh", compbr: "composition", fisherpayk: "fisher" };

// NetSuite merch class (by its leading code) → storefront bucket. The shop's
// tabs and merchandising order are keyed by these buckets; the ePASS product
// code map below is the fallback for models NetSuite has not classified.
const BUCKET_BY_CLASS_CODE = {
  // Accessory classes (107 refrigerator accessories, 149 cooking accessories,
  // 154 ventilation components, 220 laundry accessories, 816 grill
  // accessories) are deliberately absent: accessories stay off the listings.
  102: "Ref", 104: "Ref", 108: "Ref", 114: "Ref",
  120: "DW",
  130: "Range", 132: "Range", 136: "Range",
  134: "CT",
  138: "Oven", 142: "Oven", 144: "Oven",
  140: "MW",
  152: "Vent",
  160: "Coffee",
  204: "Lau", 206: "Lau", 208: "Lau", 210: "Lau",
  806: "Outdoor", 808: "Outdoor", 810: "Outdoor", 812: "Outdoor", 820: "Outdoor"
};
// ePASS product code → bucket (the pre-NetSuite map, kept as the fallback).
export const BUCKET_BY_EPASS_PROD = {
  REALL: "Ref", REBFD: "Ref", REBIB: "Ref", REBIF: "Ref", REBIW: "Ref", REDRA: "Ref", REFRE: "Ref", REFWI: "Ref", RESXS: "Ref", RETOP: "Ref", REUC: "Ref",
  IMUC: "IM", COFFE: "Coffee",
  DW: "DW", DWDRA: "DW",
  RADF: "Range", RAELE: "Range", RAGAS: "Range", RAIND: "Range", RAPRO: "Range",
  CTELE: "CT", CTGAS: "CT", CTIND: "CT", CTPRO: "CT",
  OVELE: "Oven", OVMW: "Oven", OVSPE: "Oven", OVSTE: "Steam Ov",
  MW: "MW", MWBI: "MW", MWCON: "MW", MWDR: "MW", MWOTR: "MW",
  VHDD: "Vent", VHINS: "Vent", VHISL: "Vent", VHOOD: "Vent",
  WASHF: "Lau", WASHT: "Lau", DRELE: "Lau", DRGAS: "Lau",
  GROUT: "Outdoor", PIZZA: "Outdoor"
};
// Subclass overrides (Andrew 10/26): a few subclasses need a different bucket
// from their class — ice machines keep their own tab, and the panel / trim-kit /
// accessory subclasses that sit inside product classes stay off the listings.
const BUCKET_BY_SUBCLASS_CODE = {
  1104: "IM",                     // Built-in Ice Machine (under 104 Built-in Refrigeration)
  1130: "", 1132: "",             // built-in refrigeration panels / accessories
  1328: "",                       // undercounter door panels
  1334: "", 1335: "", 1336: "",   // dishwasher install accessories / door panels & handles / cleaning
  1404: "", 1406: "",             // microwave trim kits
  1409: "", 1413: ""              // warming / vacuum drawer panel fronts
};
export function shopBucketFor(ns, prod) {
  const sub = Number(String(ns?.merchSubclass || "").trim().split(/\s+/)[0]);
  if (sub && Object.prototype.hasOwnProperty.call(BUCKET_BY_SUBCLASS_CODE, sub)) return BUCKET_BY_SUBCLASS_CODE[sub];
  const code = Number(String(ns?.merchClass || "").trim().split(/\s+/)[0]);
  // A NetSuite class decides, even when the decision is "not a listable
  // class" (accessories): only a model with NO NetSuite class falls back to
  // the ePASS product code.
  if (code) return BUCKET_BY_CLASS_CODE[code] || "";
  return BUCKET_BY_EPASS_PROD[String(prod || "").toUpperCase()] || "";
}

let memo = { at: 0, value: null, promise: null };
export function invalidateCatalog() { memo = { at: 0, value: null, promise: null }; }

async function safeRows(pool, sql, params = []) { try { return (await pool.query(sql, params)).rows; } catch { return []; } }

async function build() {
  const pool = await getPostgresPool();
  const [brandMap, settings, nsSuppliers, nsVendorRows, openModels, onHandModels, epassSuppliers] = await Promise.all([
    getModelBrandMap().catch(() => ({})),
    getWrittenModelsSettings().catch(() => ({ epassSupplierMap: {} })),
    pool ? safeRows(pool, `SELECT DISTINCT primary_supplier AS s FROM netsuite_items WHERE primary_supplier <> '' UNION SELECT DISTINCT vendor FROM model_brand_map WHERE vendor <> ''`) : [],
    pool ? safeRows(pool, `SELECT brand, primary_supplier, COUNT(*)::int AS n FROM netsuite_items WHERE brand <> '' AND primary_supplier <> '' GROUP BY 1, 2`) : [],
    pool ? safeRows(pool, `SELECT model_code, supplier_code, supplier_name FROM epass_open_order_models WHERE supplier_code <> ''`) : [],
    pool ? safeRows(pool, `SELECT model_code, MAX(raw->>'SupplierCode') AS supplier_code FROM epass_on_hand_serials WHERE raw->>'SupplierCode' <> '' GROUP BY model_code`) : [],
    pool ? safeRows(pool, `SELECT code, description FROM epass_suppliers`) : []
  ]);

  // NetSuite items by normalized model.
  const byModel = new Map();
  for (const [model, v] of Object.entries(brandMap)) {
    if (v.source !== "netsuite") continue;
    byModel.set(normModel(model), { model, brand: v.brand || "", description: v.description || "", vendor: v.vendor || "", merchCategory: v.merchCategory || "", merchClass: v.merchClass || "", merchSubclass: v.merchSubclass || "", discontinued: !!v.discontinued });
  }
  // Snapshot-sourced rows (ePASS feed) are kept separately as the fallback.
  const epassRows = new Map();
  for (const [model, v] of Object.entries(brandMap)) if (v.source !== "netsuite") epassRows.set(normModel(model), v);

  const supplierList = [...new Set(nsSuppliers.map((r) => r.s).filter(Boolean))].sort();
  const nsByKey = new Map(); for (const v of supplierList) { const k = keyWord(v); if (k && !nsByKey.has(k)) nsByKey.set(k, v); }
  const canonical = (name) => {
    const raw = String(name || "").trim(); if (!raw) return "";
    if (supplierList.includes(raw)) return raw;
    let k = keyWord(raw); const flat = raw.toLowerCase().replace(/\s+/g, "");
    if (EPASS_ALIAS[flat]) k = EPASS_ALIAS[flat]; else if (EPASS_ALIAS[k]) k = EPASS_ALIAS[k];
    return nsByKey.get(k) || "";
  };

  // Brand → usual NetSuite supplier (majority vote).
  const brandSupplier = new Map();
  { const best = new Map(); for (const r of nsVendorRows) { const k = keyWord(r.brand) || r.brand.toLowerCase(); const cur = best.get(k); if (!cur || r.n > cur.n) best.set(k, { supplier: r.primary_supplier, n: r.n }); } for (const [k, v] of best) brandSupplier.set(k, v.supplier); }

  // ePASS supplier code → NetSuite supplier.
  const epassNames = new Map(epassSuppliers.map((s) => [String(s.code || "").toUpperCase(), String(s.description || "")]));
  const learned = new Map(); // code → Map(vendor → n)
  const note = (code, model) => { const c = String(code || "").toUpperCase(); if (!c) return; const ns = byModel.get(normModel(model)); const v = ns?.vendor; if (!v) return; if (!learned.has(c)) learned.set(c, new Map()); const m = learned.get(c); m.set(v, (m.get(v) || 0) + 1); };
  for (const r of openModels) { note(r.supplier_code, r.model_code); if (r.supplier_name && !epassNames.get(String(r.supplier_code).toUpperCase())) epassNames.set(String(r.supplier_code).toUpperCase(), r.supplier_name); }
  for (const r of onHandModels) note(r.supplier_code, r.model_code);
  const manual = settings?.epassSupplierMap || {};
  const aliasCache = new Map();
  const aliasFor = (codeRaw) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    if (!code) return { name: "", code: "", source: "" };
    if (aliasCache.has(code)) return aliasCache.get(code);
    let out = null;
    if (manual[code]) out = { name: canonical(manual[code]) || manual[code], code, source: "settings" };
    if (!out && learned.has(code)) {
      const ranked = [...learned.get(code).entries()].sort((a, b) => b[1] - a[1]); const total = ranked.reduce((a, [, n]) => a + n, 0);
      if (ranked[0][1] >= 3 && ranked[0][1] / total >= 0.7) out = { name: ranked[0][0], code, source: "learned" };
    }
    if (!out && DEFAULT_EPASS_SUPPLIER_MAP[code]) out = { name: canonical(DEFAULT_EPASS_SUPPLIER_MAP[code]) || DEFAULT_EPASS_SUPPLIER_MAP[code], code, source: "default" };
    if (!out) { const g = canonical(code) || canonical(epassNames.get(code) || ""); if (g) out = { name: g, code, source: "name" }; }
    if (!out) out = { name: epassNames.get(code) || code, code, source: "epass" };
    aliasCache.set(code, out);
    return out;
  };

  return { byModel, epassRows, supplierList, brandSupplier, aliasFor, epassNames, builtAt: new Date().toISOString() };
}

export async function getCatalog() {
  if (memo.value && Date.now() - memo.at < 5 * 60 * 1000) return memo.value;
  if (!memo.promise) memo.promise = build().then((v) => { memo = { at: Date.now(), value: v, promise: null }; return v; }).catch((err) => { memo.promise = null; throw err; });
  return memo.promise;
}

function brandNameFromEpass(brandCode, brandName) {
  const code = String(brandCode || "").trim().toUpperCase();
  if (brandName && !/^[A-Z0-9]{1,6}$/.test(String(brandName).trim())) return String(brandName).trim();
  if (EPASS_BRAND_NAMES[code]) return EPASS_BRAND_NAMES[code];
  if (brandName) return String(brandName).trim();
  return code.length > 3 ? code.charAt(0) + code.slice(1).toLowerCase() : code;
}

// NetSuite first; ePASS facts (brandCode / brand / prod / description /
// supplierCode) fill whatever NetSuite doesn't have. `source` says which.
export function resolveModel(cat, model, epass = {}) {
  const k = normModel(model);
  const ns = cat.byModel.get(k) || null;
  const snap = cat.epassRows.get(k) || null;
  const supplierFromEpass = epass.supplierCode ? cat.aliasFor(epass.supplierCode) : null;
  const epassBrand = brandNameFromEpass(epass.brandCode, epass.brand || snap?.brand);
  if (ns) {
    const supplier = ns.vendor || supplierFromEpass?.name || cat.brandSupplier.get(keyWord(ns.brand) || ns.brand.toLowerCase()) || "";
    return {
      model: ns.model || String(model || "").trim(), source: "netsuite",
      brand: ns.brand || epassBrand, supplier, supplierSource: ns.vendor ? "netsuite" : supplierFromEpass?.source || (supplier ? "brand" : ""),
      merchCategory: ns.merchCategory, merchClass: ns.merchClass, merchSubclass: ns.merchSubclass,
      description: ns.description || epass.description || snap?.description || "",
      discontinued: ns.discontinued, bucket: shopBucketFor(ns, epass.prod || snap?.prod)
    };
  }
  const supplier = supplierFromEpass?.name || cat.brandSupplier.get(keyWord(epassBrand) || epassBrand.toLowerCase()) || "";
  return {
    model: String(model || "").trim(), source: "epass",
    brand: epassBrand, supplier, supplierSource: supplierFromEpass?.source || (supplier ? "brand" : ""),
    merchCategory: "", merchClass: "", merchSubclass: "",
    description: epass.description || snap?.description || "",
    discontinued: false, bucket: shopBucketFor(null, epass.prod || snap?.prod)
  };
}

// "0012 Whirlpool Corporation" with the ePASS code kept for cross-reference.
export function supplierLabel(cat, epassCode, epassDescription = "") {
  const a = cat.aliasFor(epassCode);
  if (!a.code) return { name: String(epassDescription || "").trim(), code: "", source: "" };
  if (a.source === "epass" && epassDescription) return { ...a, name: String(epassDescription).trim() };
  return a;
}
