import { getPostgresPool } from "./data-postgres.js";
import { MERCH_CLASSES, MERCH_SUBCLASSES, MERCH_CATEGORIES, MERCH_CATEGORY_BY_CLASS, addonsBySubclass } from "./merch-classes.js";

// ---------------------------------------------------------------------------
// Services & accessories by merch class (Andrew 11/10): which installs and
// install accessories the shop (and the website) offer with a product is set
// on Online Shop Orders, not in a file. An item — a NetSuite service item or
// an ePASS misc charge — is assigned to a whole Merch Class (every subclass
// in it gets it) or to one Subclass; a subclass can also opt out of an item
// its class carries.
//
//   effective(subclass) = class items − this subclass's opt-outs + its own
//
// Until the first edit the map is whatever data/shop-addons.json says
// (`bySubclass`, with `byProduct` behind it). The first edit copies that
// starting point into the table — lifting an item to its class when every
// subclass in the class already had it — and from then on the table is the
// map. Brand/model exceptions (`variants`) and the panel / no-panel choice by
// NetSuite finish stay where they were and apply on top.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shop_service_map (
  scope TEXT NOT NULL,                 -- 'class' | 'subclass' | 'meta'
  code TEXT NOT NULL,                  -- merch class / subclass code ('seeded' for meta)
  item_id TEXT NOT NULL,               -- add-on id, or 'misc:<ePASS misc code>'
  mode TEXT NOT NULL DEFAULT 'add',    -- 'add' | 'exclude' (subclass opting out of a class item)
  kind TEXT NOT NULL DEFAULT '',       -- 'install' | 'connector' — how an ePASS misc item is offered
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seq BIGSERIAL,                       -- assignment order = the order the shop lists them in
  PRIMARY KEY (scope, code, item_id)
);
-- The second, independent layer (Andrew 11/10): by BRAND, down to the merch
-- subclass. Adds to whatever the class layer gives — the LG pedestal and
-- stacking kit with LG front-load washers, a maker's detergent with its
-- dishwashers. Items may be accessory PRODUCTS ('model:<MODELKEY>') as well
-- as service items and ePASS misc charges.
CREATE TABLE IF NOT EXISTS shop_brand_service_map (
  brand_key TEXT NOT NULL,             -- brand, upper-case letters and digits only
  brand_name TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL,                 -- 'class' | 'subclass'
  code TEXT NOT NULL,
  item_id TEXT NOT NULL,               -- add-on id | 'misc:<code>' | 'model:<MODELKEY>'
  kind TEXT NOT NULL DEFAULT '',       -- 'install' | 'connector' for a misc item
  label TEXT NOT NULL DEFAULT '',      -- a product's model number as written
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seq BIGSERIAL,
  PRIMARY KEY (brand_key, scope, code, item_id)
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

export const MISC_PREFIX = "misc:";
export const isMiscId = (id) => String(id || "").startsWith(MISC_PREFIX);
const subsOfClass = (cls) => Object.keys(MERCH_SUBCLASSES).filter((s) => MERCH_SUBCLASSES[s].cls === cls);
const cleanKind = (k) => (k === "install" ? "install" : "connector");

// ---- the file's map, as the starting point ----
export function fileBySubclass(addonsFile) {
  const base = addonsBySubclass(addonsFile?.byProduct);
  const out = {};
  for (const sub of Object.keys(MERCH_SUBCLASSES)) {
    const e = addonsFile?.bySubclass?.[sub] || base[sub];
    out[sub] = e ? [...(e.installs || []), ...(e.connectors || [])] : [];
  }
  return out;
}
// Rows that reproduce the file exactly: an item every subclass of a class
// carries becomes one class row; the rest stay on their subclasses.
export function seedRowsFromFile(addonsFile) {
  const bySub = fileBySubclass(addonsFile);
  const rows = [];
  for (const cls of Object.keys(MERCH_CLASSES)) {
    const subs = subsOfClass(cls);
    if (!subs.length) continue;
    const common = bySub[subs[0]].filter((id) => subs.every((s) => bySub[s].includes(id)));
    for (const id of common) rows.push({ scope: "class", code: cls, itemId: id, mode: "add", kind: "" });
    for (const s of subs) for (const id of bySub[s]) if (!common.includes(id)) rows.push({ scope: "subclass", code: s, itemId: id, mode: "add", kind: "" });
  }
  return rows;
}

// ---- reading ----
export async function listServiceMapRows() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT scope, code, item_id, mode, kind, updated_by, updated_at FROM shop_service_map ORDER BY seq`);
  return r.rows.map((x) => ({ scope: x.scope, code: x.code, itemId: x.item_id, mode: x.mode, kind: x.kind || "", by: x.updated_by || "", at: x.updated_at?.toISOString?.() || "" }));
}
export const isSeeded = (rows) => rows.some((r) => r.scope === "meta" && r.code === "seeded");

// rows -> { classItems, subOwn, subExcluded, kinds } (plain objects of arrays)
export function resolveRows(rows) {
  const classItems = {}, subOwn = {}, subExcluded = {}, kinds = {};
  for (const r of rows) {
    if (r.kind) kinds[r.itemId] = cleanKind(r.kind);
    if (r.scope === "class" && r.mode === "add" && MERCH_CLASSES[r.code]) (classItems[r.code] ||= []).push(r.itemId);
    else if (r.scope === "subclass" && MERCH_SUBCLASSES[r.code]) ((r.mode === "exclude" ? subExcluded : subOwn)[r.code] ||= []).push(r.itemId);
  }
  return { classItems, subOwn, subExcluded, kinds };
}
// Every subclass's effective item ids (class − opt-outs + own), de-duplicated.
export function effectiveIds(resolved) {
  const out = {};
  for (const [sub, def] of Object.entries(MERCH_SUBCLASSES)) {
    const ex = new Set(resolved.subExcluded[sub] || []);
    const ids = [...(resolved.classItems[def.cls] || []).filter((id) => !ex.has(id)), ...(resolved.subOwn[sub] || [])];
    out[sub] = [...new Set(ids)];
  }
  return out;
}

// An ePASS misc charge as a shop add-on. Offered only while ePASS still has
// it, active, with a list price.
export function miscAsAddon(m, kind) {
  if (!m || m.obsolete || !(Number(m.list) > 0)) return null;
  const type = cleanKind(kind);
  return { id: MISC_PREFIX + m.code, name: String(m.description || m.code).trim(), price: Math.round(Number(m.list) * 100) / 100, type, taxable: m.taxable !== false,
    ...(type === "install" && Number(m.minutes) > 0 ? { durationMin: Number(m.minutes) } : {}), epassCode: m.code, source: "epass-misc" };
}
// Best guess at how a misc charge should be offered, for the picker's default.
export const suggestMiscKind = (m) => (Number(m?.minutes) > 0 || /install|labor|service|haul|removal|hook.?up|conversion|reversal/i.test(`${m?.description || ""} ${m?.typeName || ""}`) ? "install" : "connector");

// The add-on data the shop runs on: the file, with the table's map laid over
// it once the table has been started. Mapped ePASS misc charges join the
// catalog so carts can price them.
export function overlayAddons(addonsFile, rows, miscCharges = []) {
  if (!addonsFile || !Array.isArray(rows) || !isSeeded(rows)) return addonsFile;
  const resolved = resolveRows(rows);
  const eff = effectiveIds(resolved);
  const installs = [...(addonsFile.installs || [])], connectors = [...(addonsFile.connectors || [])];
  const typeOf = new Map([...installs.map((a) => [a.id, "install"]), ...connectors.map((a) => [a.id, "connector"])]);
  const miscByCode = new Map((miscCharges || []).map((m) => [String(m.code), m]));
  const used = new Set(Object.values(eff).flat());
  for (const id of used) {
    if (!isMiscId(id) || typeOf.has(id)) continue;
    const addon = miscAsAddon(miscByCode.get(id.slice(MISC_PREFIX.length)), resolved.kinds[id] || "connector");
    if (!addon) continue; // gone from ePASS, obsolete or unpriced — not offered
    (addon.type === "install" ? installs : connectors).push(addon);
    typeOf.set(id, addon.type);
  }
  const bySubclass = {};
  for (const [sub, ids] of Object.entries(eff)) {
    const known = ids.filter((id) => typeOf.has(id)); // class items first, then the subclass's own, each in the order assigned
    bySubclass[sub] = { installs: known.filter((id) => typeOf.get(id) === "install"), connectors: known.filter((id) => typeOf.get(id) === "connector") };
  }
  return { ...addonsFile, installs, connectors, bySubclass, baseBySubclass: addonsFile.bySubclass || {}, serviceMap: true };
}

// ---- the editor's view ----
export function serviceMapView(addonsFile, rows, miscCharges = []) {
  const seeded = isSeeded(rows);
  const liveRows = seeded ? rows : seedRowsFromFile(addonsFile);
  const resolved = resolveRows(liveRows);
  const eff = effectiveIds(resolved);
  const items = {};
  for (const a of addonsFile?.installs || []) items[a.id] = { id: a.id, name: a.name, price: a.price, type: "install", source: "netsuite" };
  for (const a of addonsFile?.connectors || []) items[a.id] = { id: a.id, name: a.name, price: a.price, type: "connector", source: "accessory" };
  const miscByCode = new Map((miscCharges || []).map((m) => [String(m.code), m]));
  const usedMisc = new Set(liveRows.filter((r) => isMiscId(r.itemId) && r.mode === "add").map((r) => r.itemId));
  for (const id of usedMisc) {
    const m = miscByCode.get(id.slice(MISC_PREFIX.length));
    const addon = miscAsAddon(m, resolved.kinds[id] || "connector");
    items[id] = addon ? { id, name: addon.name, price: addon.price, type: addon.type, source: "epass-misc", code: m.code }
      : { id, name: m?.description || id.slice(MISC_PREFIX.length), price: null, type: cleanKind(resolved.kinds[id]), source: "epass-misc", code: id.slice(MISC_PREFIX.length), unavailable: m ? (m.obsolete ? "obsolete in ePASS" : "no list price in ePASS") : "not in the ePASS feed" };
  }
  const classes = Object.keys(MERCH_CLASSES).map((cls) => ({
    code: cls, name: MERCH_CLASSES[cls], category: MERCH_CATEGORY_BY_CLASS[cls] || "", items: resolved.classItems[cls] || [],
    subclasses: subsOfClass(cls).map((sub) => ({ code: sub, name: MERCH_SUBCLASSES[sub].name, own: resolved.subOwn[sub] || [], excluded: (resolved.subExcluded[sub] || []).filter((id) => (resolved.classItems[cls] || []).includes(id)), effective: eff[sub] }))
  }));
  const last = rows.filter((r) => r.scope !== "meta" && r.at).sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    seeded, categories: Object.entries(MERCH_CATEGORIES).map(([code, name]) => ({ code, name })), classes, items,
    misc: (miscCharges || []).filter((m) => !m.obsolete && Number(m.list) > 0 && !m.rebate && !m.lineDiscount && !m.pctOfLine)
      .map((m) => ({ code: m.code, description: m.description, list: Number(m.list), taxable: m.taxable !== false, typeName: m.typeName || "", minutes: Number(m.minutes) || 0, suggestedKind: suggestMiscKind(m) })),
    lastChange: last ? { by: last.by, at: last.at } : null
  };
}

// ---- writing ----
// action: 'add' | 'remove'; scope: 'class' | 'subclass'. Starts the table
// from the file on the first call.
export async function applyServiceMapOp({ scope, code, itemId, action, kind = "", by = "" }, addonsFile) {
  scope = scope === "class" ? "class" : "subclass";
  code = String(code || "").trim();
  itemId = String(itemId || "").trim().slice(0, 120);
  if (scope === "class" ? !MERCH_CLASSES[code] : !MERCH_SUBCLASSES[code]) throw new Error("Unknown merch class or subclass.");
  if (!itemId) throw new Error("Pick an item to assign.");
  if (!["add", "remove"].includes(action)) throw new Error("Unknown action.");
  const known = new Set([...(addonsFile?.installs || []), ...(addonsFile?.connectors || [])].map((a) => a.id));
  if (action === "add" && !known.has(itemId) && !isMiscId(itemId)) throw new Error("That item isn't in the service list or ePASS misc charges.");
  const who = String(by || "").slice(0, 120);
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seeded = (await client.query(`SELECT 1 FROM shop_service_map WHERE scope = 'meta' AND code = 'seeded'`)).rowCount > 0;
    if (!seeded) {
      for (const r of seedRowsFromFile(addonsFile)) await client.query(`INSERT INTO shop_service_map (scope, code, item_id, mode, kind, updated_by) VALUES ($1,$2,$3,$4,$5,'seed') ON CONFLICT DO NOTHING`, [r.scope, r.code, r.itemId, r.mode, r.kind]);
      await client.query(`INSERT INTO shop_service_map (scope, code, item_id, mode, updated_by) VALUES ('meta','seeded','-','add',$1) ON CONFLICT DO NOTHING`, [who]);
    }
    const upsert = (sc, cd, mode) => client.query(
      `INSERT INTO shop_service_map (scope, code, item_id, mode, kind, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (scope, code, item_id) DO UPDATE SET mode = EXCLUDED.mode, kind = CASE WHEN EXCLUDED.kind <> '' THEN EXCLUDED.kind ELSE shop_service_map.kind END, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [sc, cd, itemId, mode, isMiscId(itemId) && kind ? cleanKind(kind) : "", who]);
    const del = (sc, codes, mode) => client.query(`DELETE FROM shop_service_map WHERE scope = $1 AND code = ANY($2::text[]) AND item_id = $3${mode ? ` AND mode = '${mode}'` : ""}`, [sc, codes, itemId]);
    if (scope === "class") {
      const subs = subsOfClass(code);
      if (action === "add") { await upsert("class", code, "add"); await del("subclass", subs, "add"); } // the class row covers them now
      else { await del("class", [code]); await del("subclass", subs, "exclude"); }                      // opt-outs of a class item that is gone are moot
    } else {
      const cls = MERCH_SUBCLASSES[code].cls;
      const onClass = (await client.query(`SELECT 1 FROM shop_service_map WHERE scope = 'class' AND code = $1 AND item_id = $2 AND mode = 'add'`, [cls, itemId])).rowCount > 0;
      if (action === "add") { if (onClass) await del("subclass", [code]); else await upsert("subclass", code, "add"); }
      else { if (onClass) await upsert("subclass", code, "exclude"); else await del("subclass", [code]); }
    }
    // an ePASS misc item's kind is one setting for the item, wherever it is assigned
    if (isMiscId(itemId) && kind) await client.query(`UPDATE shop_service_map SET kind = $2 WHERE item_id = $1`, [itemId, cleanKind(kind)]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

// Back to the file's map (drops every row, including the 'seeded' marker).
export async function resetServiceMap() {
  const pool = await getReadyPool();
  const r = await pool.query(`DELETE FROM shop_service_map`);
  return r.rowCount;
}

// ===========================================================================
// Layer two — by brand, down to the subclass. Additive only: it never removes
// what the class layer offers.
//
//   offered(unit) = class layer(subclass)  +  brand layer(brand, class)  +  brand layer(brand, subclass)
//
// Products are data even when they can't be bought today: the shop's setup
// prompt hides one until a sealed unit is in stock, the website's services
// list always carries it (with inStock) so its cart can route an out-of-stock
// accessory to the quote path.
// ===========================================================================
export const MODEL_PREFIX = "model:";
export const isModelId = (id) => String(id || "").startsWith(MODEL_PREFIX);
export const brandKeyOf = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const modelKeyOf = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export const brandServicesKey = (brand, subclass) => (brandKeyOf(brand) && subclass ? `${brandKeyOf(brand)}|${String(subclass).split("-")[0]}` : "");

export async function listBrandMapRows() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT brand_key, brand_name, scope, code, item_id, kind, label, updated_by, updated_at FROM shop_brand_service_map ORDER BY seq`);
  return r.rows.map((x) => ({ brandKey: x.brand_key, brandName: x.brand_name || x.brand_key, scope: x.scope, code: x.code, itemId: x.item_id, kind: x.kind || "", label: x.label || "", by: x.updated_by || "", at: x.updated_at?.toISOString?.() || "" }));
}

// Every (brand, subclass) with something assigned -> ordered item ids
// (the brand's class rows first, then its subclass rows).
function brandEffective(rows) {
  const byClass = {}, bySub = {};
  for (const r of rows) {
    if (r.scope === "class" && MERCH_CLASSES[r.code]) ((byClass[r.brandKey] ||= {})[r.code] ||= []).push(r.itemId);
    else if (r.scope === "subclass" && MERCH_SUBCLASSES[r.code]) ((bySub[r.brandKey] ||= {})[r.code] ||= []).push(r.itemId);
  }
  const out = {};
  for (const bk of new Set([...Object.keys(byClass), ...Object.keys(bySub)])) {
    for (const [sub, def] of Object.entries(MERCH_SUBCLASSES)) {
      const ids = [...new Set([...(byClass[bk]?.[def.cls] || []), ...(bySub[bk]?.[sub] || [])])];
      if (ids.length) out[`${bk}|${sub}`] = ids;
    }
  }
  return out;
}

// Lay the brand layer over the add-on data: `byBrand["LG|2112"] = { installs,
// connectors, products: [{ key, model }] }`. Mapped ePASS misc charges join
// the catalog; `accessoryModels` lists every product key the layer names so
// the catalog build can carry their stock even though accessories aren't on
// the storefront grid.
export function overlayBrandLayer(addons, brandRows, miscCharges = []) {
  if (!addons || !Array.isArray(brandRows) || !brandRows.length) return addons;
  const installs = [...(addons.installs || [])], connectors = [...(addons.connectors || [])];
  const typeOf = new Map([...installs.map((a) => [a.id, "install"]), ...connectors.map((a) => [a.id, "connector"])]);
  const miscByCode = new Map((miscCharges || []).map((m) => [String(m.code), m]));
  const kinds = {}, labels = {}, brandNames = {};
  for (const r of brandRows) { if (r.kind) kinds[r.itemId] = cleanKind(r.kind); if (r.label) labels[r.itemId] = r.label; brandNames[r.brandKey] = r.brandName; }
  const eff = brandEffective(brandRows);
  for (const id of new Set(Object.values(eff).flat())) {
    if (!isMiscId(id) || typeOf.has(id)) continue;
    const addon = miscAsAddon(miscByCode.get(id.slice(MISC_PREFIX.length)), kinds[id] || "connector");
    if (!addon) continue;
    (addon.type === "install" ? installs : connectors).push(addon);
    typeOf.set(id, addon.type);
  }
  const byBrand = {}, accessoryModels = {};
  for (const [key, ids] of Object.entries(eff)) {
    const products = ids.filter(isModelId).map((id) => ({ key: id.slice(MODEL_PREFIX.length), model: labels[id] || id.slice(MODEL_PREFIX.length) }));
    for (const p of products) accessoryModels[p.key] = p.model;
    const entry = { installs: ids.filter((id) => typeOf.get(id) === "install"), connectors: ids.filter((id) => typeOf.get(id) === "connector"), products };
    if (entry.installs.length || entry.connectors.length || products.length) byBrand[key] = entry;
  }
  return { ...addons, installs, connectors, byBrand, brandNames, accessoryModels };
}

// ---- the brand editor's view ----
// `brands`: [{ key, name, subclasses: [codes the brand has models in] }] from
// the NetSuite model map; `productInfo(key)` -> { model, brand, description,
// available, price } for a product the layer names.
export function brandMapView(addons, brandRows, miscCharges = [], brands = [], productInfo = () => null) {
  const items = {};
  for (const a of addons?.installs || []) if (a.source !== "epass-misc") items[a.id] = { id: a.id, name: a.name, price: a.price, type: "install", source: "netsuite" };
  for (const a of addons?.connectors || []) if (a.source !== "epass-misc") items[a.id] = { id: a.id, name: a.name, price: a.price, type: "connector", source: "accessory" };
  const miscByCode = new Map((miscCharges || []).map((m) => [String(m.code), m]));
  const kinds = {}; for (const r of brandRows) if (r.kind) kinds[r.itemId] = cleanKind(r.kind);
  const assigned = {}, counts = {}, names = {};
  for (const r of brandRows) {
    names[r.brandKey] = r.brandName;
    counts[r.brandKey] = (counts[r.brandKey] || 0) + 1;
    (((assigned[r.brandKey] ||= { class: {}, subclass: {} })[r.scope === "class" ? "class" : "subclass"])[r.code] ||= []).push(r.itemId);
    if (items[r.itemId]) continue;
    if (isMiscId(r.itemId)) {
      const m = miscByCode.get(r.itemId.slice(MISC_PREFIX.length));
      const addon = miscAsAddon(m, kinds[r.itemId] || "connector");
      items[r.itemId] = addon ? { id: r.itemId, name: addon.name, price: addon.price, type: addon.type, source: "epass-misc", code: m.code }
        : { id: r.itemId, name: m?.description || r.itemId.slice(MISC_PREFIX.length), price: null, type: cleanKind(kinds[r.itemId]), source: "epass-misc", code: r.itemId.slice(MISC_PREFIX.length), unavailable: m ? (m.obsolete ? "obsolete in ePASS" : "no list price in ePASS") : "not in the ePASS feed" };
    } else if (isModelId(r.itemId)) {
      const info = productInfo(r.itemId.slice(MODEL_PREFIX.length)) || {};
      items[r.itemId] = { id: r.itemId, type: "product", source: "product", model: info.model || r.label || r.itemId.slice(MODEL_PREFIX.length), name: info.description || r.label || r.itemId.slice(MODEL_PREFIX.length), brand: info.brand || "", available: Number(info.available) || 0, price: info.price ?? null };
    } else items[r.itemId] = { id: r.itemId, name: r.itemId, price: null, type: "connector", missing: true };
  }
  const known = new Map(brands.map((b) => [b.key, b]));
  for (const bk of Object.keys(names)) if (!known.has(bk)) known.set(bk, { key: bk, name: names[bk], subclasses: [] });
  const last = brandRows.filter((r) => r.at).sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    brands: [...known.values()].map((b) => ({ key: b.key, name: b.name, subclasses: b.subclasses || [], assigned: counts[b.key] || 0 })).sort((a, b) => a.name.localeCompare(b.name)),
    categories: Object.entries(MERCH_CATEGORIES).map(([code, name]) => ({ code, name })),
    classes: Object.keys(MERCH_CLASSES).map((cls) => ({ code: cls, name: MERCH_CLASSES[cls], category: MERCH_CATEGORY_BY_CLASS[cls] || "", subclasses: subsOfClass(cls).map((sub) => ({ code: sub, name: MERCH_SUBCLASSES[sub].name })) })),
    assigned, items,
    misc: (miscCharges || []).filter((m) => !m.obsolete && Number(m.list) > 0 && !m.rebate && !m.lineDiscount && !m.pctOfLine)
      .map((m) => ({ code: m.code, description: m.description, list: Number(m.list), taxable: m.taxable !== false, typeName: m.typeName || "", suggestedKind: suggestMiscKind(m) })),
    lastChange: last ? { by: last.by, at: last.at } : null
  };
}

// action: 'add' | 'remove'. `label` = a product's model number as written.
export async function applyBrandMapOp({ brand, brandName = "", scope, code, itemId, action, kind = "", label = "", by = "" }, addons) {
  const bk = brandKeyOf(brand);
  if (!bk) throw new Error("Pick a brand first.");
  scope = scope === "class" ? "class" : "subclass";
  code = String(code || "").trim();
  itemId = String(itemId || "").trim().slice(0, 120);
  if (scope === "class" ? !MERCH_CLASSES[code] : !MERCH_SUBCLASSES[code]) throw new Error("Unknown merch class or subclass.");
  if (!["add", "remove"].includes(action)) throw new Error("Unknown action.");
  if (isModelId(itemId)) itemId = MODEL_PREFIX + modelKeyOf(itemId.slice(MODEL_PREFIX.length));
  if (!itemId || itemId === MODEL_PREFIX) throw new Error("Pick an item to assign.");
  const known = new Set([...(addons?.installs || []), ...(addons?.connectors || [])].map((a) => a.id));
  if (action === "add" && !known.has(itemId) && !isMiscId(itemId) && !isModelId(itemId)) throw new Error("That item isn't a product, a service item or an ePASS misc charge.");
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (scope === "class") {
      const subs = subsOfClass(code);
      if (action === "add") {
        await client.query(`INSERT INTO shop_brand_service_map (brand_key, brand_name, scope, code, item_id, kind, label, updated_by) VALUES ($1,$2,'class',$3,$4,$5,$6,$7)
          ON CONFLICT (brand_key, scope, code, item_id) DO UPDATE SET brand_name = EXCLUDED.brand_name, kind = CASE WHEN EXCLUDED.kind <> '' THEN EXCLUDED.kind ELSE shop_brand_service_map.kind END, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [bk, String(brandName || brand).slice(0, 80), code, itemId, isMiscId(itemId) && kind ? cleanKind(kind) : "", String(label || "").slice(0, 60), String(by || "").slice(0, 120)]);
        await client.query(`DELETE FROM shop_brand_service_map WHERE brand_key = $1 AND scope = 'subclass' AND code = ANY($2::text[]) AND item_id = $3`, [bk, subs, itemId]); // the class row covers them
      } else await client.query(`DELETE FROM shop_brand_service_map WHERE brand_key = $1 AND scope = 'class' AND code = $2 AND item_id = $3`, [bk, code, itemId]);
    } else {
      const cls = MERCH_SUBCLASSES[code].cls;
      const onClass = (await client.query(`SELECT 1 FROM shop_brand_service_map WHERE brand_key = $1 AND scope = 'class' AND code = $2 AND item_id = $3`, [bk, cls, itemId])).rowCount > 0;
      if (action === "add") {
        if (!onClass) await client.query(`INSERT INTO shop_brand_service_map (brand_key, brand_name, scope, code, item_id, kind, label, updated_by) VALUES ($1,$2,'subclass',$3,$4,$5,$6,$7)
          ON CONFLICT (brand_key, scope, code, item_id) DO UPDATE SET brand_name = EXCLUDED.brand_name, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [bk, String(brandName || brand).slice(0, 80), code, itemId, isMiscId(itemId) && kind ? cleanKind(kind) : "", String(label || "").slice(0, 60), String(by || "").slice(0, 120)]);
      } else {
        if (onClass) throw new Error("That item is assigned to the brand's whole class — remove it on the class row.");
        await client.query(`DELETE FROM shop_brand_service_map WHERE brand_key = $1 AND scope = 'subclass' AND code = $2 AND item_id = $3`, [bk, code, itemId]);
      }
    }
    if (isMiscId(itemId) && kind) await client.query(`UPDATE shop_brand_service_map SET kind = $2 WHERE item_id = $1`, [itemId, cleanKind(kind)]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}
