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
// Price (Andrew 10/15): the unit's UniqueSellPrice in ePASS, and only that.
// No workbook carry-over, no override in Agility - a unit with no unique
// sell price shows "needs price" (set it in ePASS) and is not sellable.
// Margin at that price = (price - cost) / price, for the list's hidden column.
// Ids stay MODEL|SERIAL#1 so every existing hold / sold / override re-attaches.
// ---------------------------------------------------------------------------

import { EPASS_BRAND_NAMES, titleCaseBrand, createBrandResolver } from "./brand-names.js";
import { shopBucketFor } from "./catalog-resolver.js";

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
  const wbCategory = new Map(); // MODEL -> category (for product codes the map doesn't know)
  for (const i of wbItems) {
    if (i.category && !wbCategory.has(String(i.model || "").trim().toUpperCase())) wbCategory.set(String(i.model || "").trim().toUpperCase(), i.category);
  }
  // Brand names standardized the way Brand Sales and Quote Follow-Up do it:
  // the NetSuite name most models of an ePASS code agree on (proper case
  // preferred), else the workbook's code table, else the known-code table,
  // else the code title-cased. "GOZ" -> "Gozney", "BOSCH" -> "Bosch".
  const wbBrands = workbook?._meta?.brandMap || {};
  const resolver = createBrandResolver({ brandMap, samples: units.map((u) => ({ model: u.model || u.sku, brandCode: u.brand, brand: wbBrands[String(u.brand || "").trim().toUpperCase()] || EPASS_BRAND_NAMES[String(u.brand || "").trim().toUpperCase()] || "" })) });
  const brandName = (model, code) => {
    const raw = resolver.brandOf({ model, brandCode: code }) || String(code || "").trim();
    const shown = resolver.displayOf(raw) || raw;
    return /[a-z]/.test(shown) ? shown : titleCaseBrand(shown);
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
    const price = unique > 0 ? r2(unique) : null;
    const cost = num(u.cost) > 0 ? r2(num(u.cost)) : null;
    const margin = price != null && cost != null ? Math.round(((price - cost) / price) * 1000) / 10 : null;
    const prod = String(u.prod || "").trim().toUpperCase();
    // NetSuite merch class decides the bucket when the model is classified there (10/26); ePASS product code is the fallback.
    const category = shopBucketFor(brandMap[model.toUpperCase()], prod) || categoryByProduct[prod] || wbCategory.get(model.toUpperCase()) || "Other";
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
      priceSource: unique > 0 ? "epass" : "",
      margin, marginDollars: price != null && cost != null ? r2(price - cost) : null,
      tagPrice: num(u.tagPrice) > 0 ? r2(num(u.tagPrice)) : null,
      list: num(u.list) > 0 ? r2(num(u.list)) : null,
      cost,
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
