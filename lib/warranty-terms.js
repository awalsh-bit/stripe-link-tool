import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Warranty terms reference (warranty-terms.html) — Andrew, 2026-09-22: Jack's
// warranty-terms snapshot re-shaped into Agility. The data is a checked-in
// file, data/warranty-terms.json (brands → coverage tiers, model/family
// overrides, pre-auth and installer-bonus rules); docs/warranty-terms.md is
// the same data as tables for people and other tools (NetSuite side).
//
// lookupWarranty() is the piece the WTY-ticket checks want: brand + model +
// purchase date → every tier that applies, with its end date and whether it
// is still in force as of a given day. Family overrides match the model
// against the pattern (* = any run of characters), single-model overrides
// match exactly; an override REPLACES the brand's standard tiers, the brand's
// pre-auth / installer-bonus rules still apply.
// ---------------------------------------------------------------------------

const DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "warranty-terms.json");
let cache = null;

export function loadWarrantyTerms({ fresh = false } = {}) {
  if (cache && !fresh) {
    try { if (fs.statSync(DATA_PATH).mtimeMs === cache.mtimeMs) return cache.data; } catch {}
  }
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(raw.replace(/^﻿/, ""));
  data.brands = (data.brands || []).map((b) => ({ ...b, tiers: b.tiers || [], categories: b.categories || [] }));
  data.models = (data.models || []).map((m) => ({ ...m, tiers: m.tiers || [] }));
  let mtimeMs = 0; try { mtimeMs = fs.statSync(DATA_PATH).mtimeMs; } catch {}
  cache = { data, mtimeMs };
  return data;
}

const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");

// Brand names as ePASS / NetSuite spell them vs the reference ("SUBZERO",
// "SUB ZERO", "Fisher and Paykel"…). Exact (normalised) match first, then a
// contains match either way.
export function findBrand(data, brandText) {
  const want = norm(brandText);
  if (!want) return null;
  const brands = data.brands;
  let hit = brands.find((b) => norm(b.brand) === want || norm(b.id) === want);
  if (hit) return hit;
  hit = brands.find((b) => norm(b.brand).replace(/AND/g, "") === want.replace(/AND/g, ""));
  if (hit) return hit;
  const cands = brands.filter((b) => { const n = norm(b.brand); return n.length >= 3 && (want.includes(n) || n.includes(want)); });
  return cands.length === 1 ? cands[0] : null;
}

function patternToRegex(pattern) {
  const p = String(pattern || "").trim().toUpperCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${p}$`);
}

export function findModelOverride(data, brand, modelText) {
  const model = String(modelText || "").trim().toUpperCase();
  if (!brand || !model) return null;
  const mine = data.models.filter((m) => norm(m.brand) === norm(brand.brand));
  return mine.find((m) => m.kind === "single" && String(m.model || "").trim().toUpperCase() === model)
    || mine.find((m) => m.kind === "family" && m.pattern && patternToRegex(m.pattern).test(model))
    || null;
}

export function addMonths(isoDate, months) {
  const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + Number(months || 0), Number(m[3])));
  // clamp to the last day when the target month is shorter (Jan 31 + 1 → Feb 28/29)
  if (d.getUTCDate() !== Number(m[3])) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// brand + model + purchase date (+ product type, + as-of day) → what applies.
export function lookupWarranty({ brand, model = "", purchaseDate = "", product = "", asOf = "" } = {}) {
  const data = loadWarrantyTerms();
  const today = asOf || new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const b = findBrand(data, brand);
  if (!b) return { found: false, brand: String(brand || ""), asOf: today, tiers: [], note: "Brand not in the warranty reference." };
  const override = findModelOverride(data, b, model);
  const source = override ? override.tiers : b.tiers;
  const purchased = String(purchaseDate || "").slice(0, 10);
  const prodNorm = norm(product);
  const tiers = source.map((t) => {
    const ends = purchased ? addMonths(purchased, t.months) : "";
    const limited = Array.isArray(t.appliesTo) && t.appliesTo.length ? t.appliesTo : null;
    const productMatch = !limited || !prodNorm ? null : limited.some((p) => { const n = norm(p); return n.includes(prodNorm) || prodNorm.includes(n); });
    return {
      label: t.label, months: t.months, partsOnly: !!t.partsOnly, appliesTo: limited, productMatch,
      requiresRegistration: !!t.requiresRegistration, registrationWindowDays: t.registrationWindowDays ?? null,
      endsOn: ends, inForce: ends ? ends >= today : null, daysLeft: ends ? Math.round((new Date(ends) - new Date(today)) / 864e5) : null
    };
  });
  const bonus = b.installerBonus && (!b.installerBonus.beforeDate || !purchased || purchased < b.installerBonus.beforeDate) ? b.installerBonus : null;
  const longest = tiers.filter((t) => t.productMatch !== false).reduce((a, t) => (!a || t.months > a.months ? t : a), null);
  return {
    found: true, asOf: today, brand: b.brand, brandId: b.id, categories: b.categories, confidence: override ? (override.confidence || "verified") : b.confidence,
    model: String(model || "").trim().toUpperCase(), purchaseDate: purchased, product: String(product || ""),
    override: override ? { kind: override.kind, label: override.label || override.model || override.pattern, model: override.model, pattern: override.pattern, verifiedAt: override.verifiedAt, verifiedBy: override.verifiedBy, notes: override.notes } : null,
    tiers, longest: longest ? { label: longest.label, months: longest.months, endsOn: longest.endsOn, inForce: longest.inForce } : null,
    anyInForce: purchased ? tiers.some((t) => t.inForce && t.productMatch !== false) : null,
    preAuth: b.preAuth || null, installerBonus: bonus, externalLookupUrl: b.externalLookupUrl || null, sourceUrl: b.sourceUrl || "", notes: b.notes || ""
  };
}

export function warrantyTermsSummary() {
  const d = loadWarrantyTerms();
  return {
    snapshotDate: d.meta?.snapshotDate || "", brands: d.brands.length, verified: d.brands.filter((b) => b.confidence === "verified").length,
    estimates: d.brands.filter((b) => b.confidence !== "verified").length, models: d.models.length, preAuth: d.brands.filter((b) => b.preAuth).length
  };
}
