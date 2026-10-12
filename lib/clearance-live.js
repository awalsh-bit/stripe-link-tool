// ---------------------------------------------------------------------------
// Clearance Hit List built from the ePASS feed (Andrew 10/8: "What are the
// rules for when something ends up on the clearance hit list?" - there were
// none; the list was whatever rows the August workbook had). Now the list is
// a query over the feed's on-hand serials, so nothing on it can go stale and
// nobody gets to decide what's on it by hand:
//
//   1. SerialTypeCode OPEN                      - open box. A floor unit Andrew
//                                                 wants sold off is moved to
//                                                 OPEN in ePASS. DISPLAY never
//                                                 qualifies.
//   2. SerialTypeCode ALL received > 365 days ago - aged new stock.
//   3. SerialTypeCode ALL with a UniqueSellPrice  - ePASS has a unit-specific
//                                                 price on it.
//
// Price: the unit's UniqueSellPrice when ePASS has one; otherwise the price
// the old workbook had for that exact serial (so nothing already priced
// loses its number); otherwise "needs price" - the unit is on the list but
// not sellable (the shop skips it) until an executive sets a price override.
// Ids stay MODEL|SERIAL#1 so every existing hold / sold / override re-attaches.
// ---------------------------------------------------------------------------

import { EPASS_BRAND_NAMES, titleCaseBrand } from "./brand-names.js";

export const CLEARANCE_AGE_DAYS = 365;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

export function clearanceRuleFor(unit, { today = new Date(), ageDays = CLEARANCE_AGE_DAYS } = {}) {
  const type = String(unit?.serialType || "").trim().toUpperCase();
  if (type === "OPEN") return { rule: "open", label: "Open box" };
  if (type !== "ALL") return null;
  const unique = num(unit.uniquePrice);
  if (unique > 0) return { rule: "unique", label: "Unique price" };
  const received = unit.received ? new Date(unit.received + "T00:00:00Z") : null;
  if (received && !Number.isNaN(received.getTime())) {
    const days = Math.floor((today.getTime() - received.getTime()) / 86400000);
    if (days > ageDays) return { rule: "aged", label: `${days} days in stock`, days };
  }
  return null;
}

// snapshot.serialUnits (serialSnapshotFromFeed), workbook = data/clearance.json
// (categories, brandMap, and the per-serial prices it still contributes),
// brandMap = NetSuite model -> { brand }, categoryByProduct = ePASS product
// code -> clearance category key.
export function buildLiveClearanceList({ snapshot, workbook = {}, brandMap = {}, categoryByProduct = {}, today = new Date(), ageDays = CLEARANCE_AGE_DAYS } = {}) {
  const units = Array.isArray(snapshot?.serialUnits) ? snapshot.serialUnits : [];
  const wbItems = Array.isArray(workbook?.items) ? workbook.items : [];
  const wbPrice = new Map(); // MODEL|SERIAL -> workbook price
  const wbCategory = new Map(); // MODEL -> category (for product codes the map doesn't know)
  for (const i of wbItems) {
    const k = String(i.model || "").trim().toUpperCase() + "|" + String(i.serial || "").trim().toUpperCase();
    if (num(i.price) > 0 && !wbPrice.has(k)) wbPrice.set(k, num(i.price));
    if (i.category && !wbCategory.has(String(i.model || "").trim().toUpperCase())) wbCategory.set(String(i.model || "").trim().toUpperCase(), i.category);
  }
  const wbBrands = workbook?._meta?.brandMap || {};
  const brandName = (model, code) => {
    const ns = brandMap[String(model || "").trim()] || brandMap[String(model || "").trim().toUpperCase()];
    if (ns?.brand) return String(ns.brand).trim();
    const c = String(code || "").trim().toUpperCase();
    return wbBrands[c] || EPASS_BRAND_NAMES[c] || (c.length > 3 ? titleCaseBrand(c) : c);
  };
  const counts = { open: 0, aged: 0, unique: 0, needsPrice: 0, taken: 0 };
  const items = [];
  const seen = new Set();
  for (const u of units) {
    const hit = clearanceRuleFor(u, { today, ageDays });
    if (!hit) continue;
    const model = String(u.model || u.sku || "").trim();
    const serial = String(u.serial || "").trim().toUpperCase();
    if (!model || !serial) continue;
    const id = `${model}|${serial}#1`;
    if (seen.has(id)) continue;
    seen.add(id);
    const unique = num(u.uniquePrice);
    const fromWorkbook = wbPrice.get(model.toUpperCase() + "|" + serial) || 0;
    const price = unique > 0 ? r2(unique) : fromWorkbook > 0 ? r2(fromWorkbook) : null;
    const prod = String(u.prod || "").trim().toUpperCase();
    const category = categoryByProduct[prod] || wbCategory.get(model.toUpperCase()) || (prod ? "Other" : "Other");
    const writtenTo = String(u.writtenTo || "").trim();
    counts[hit.rule]++;
    if (price == null) counts.needsPrice++;
    if (writtenTo) counts.taken++;
    items.push({
      id, model, serial,
      brand: brandName(model, u.brand), brandCode: String(u.brand || "").trim().toUpperCase(),
      product: prod, category,
      description: String(u.description || "").trim(),
      location: String(u.location || "").trim(),
      bin: String(u.bin || "").trim(),
      price,
      priceSource: unique > 0 ? "epass" : fromWorkbook > 0 ? "workbook" : "",
      tagPrice: num(u.tagPrice) > 0 ? r2(num(u.tagPrice)) : null,
      list: num(u.list) > 0 ? r2(num(u.list)) : null,
      cost: num(u.cost) > 0 ? r2(num(u.cost)) : null,
      received: u.received || "",
      serialType: String(u.serialType || "").trim().toUpperCase(),
      rule: hit.rule, ruleLabel: hit.label, days: hit.days ?? null,
      epass: { onHand: true, writtenTo, serialType: String(u.serialType || "").trim().toUpperCase() }
    });
  }
  const catRank = new Map((workbook?._meta?.categories || []).map((c, i) => [c.key, i]));
  items.sort((a, b) => (catRank.get(a.category) ?? 99) - (catRank.get(b.category) ?? 99) || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model) || a.serial.localeCompare(b.serial));
  const categories = [...(workbook?._meta?.categories || [])];
  if (items.some((i) => i.category === "Other") && !categories.some((c) => c.key === "Other")) categories.push({ key: "Other", label: "Other" });
  return {
    _meta: {
      live: true,
      source: `ePASS feed${snapshot?.uploadedAt ? " " + snapshot.uploadedAt : ""}`,
      asOf: snapshot?.uploadedAt || "",
      rules: { open: "serial type OPEN", aged: `serial type ALL received more than ${ageDays} days ago`, unique: "serial type ALL with a UniqueSellPrice in ePASS" },
      counts,
      categories,
      brandMap: wbBrands,
      workbookListDate: workbook?._meta?.listDate || ""
    },
    items
  };
}
