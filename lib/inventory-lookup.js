// ---------------------------------------------------------------------------
// Inventory Lookup (Andrew 10/26) — the team's "Serial Inventory" screen,
// built on the current ePASS feeds and NetSuite's words.
//
//   Filters: NetSuite Merch Category → Class → Subclass (cascading), three
//   text searches (model / brand / description, each contains | starts with |
//   ends with), On hand only, Active or In-Stock only (default on; off shows
//   discontinued and long-gone models for archive lookups).
//
//   ATS (Andrew 10/26): units of serial type ALL that are not reserved to an
//   order and not on hold — the number a salesperson can promise today.
//   Prices: ePASS price levels L1 / L2 / RETAIL and NetSuite's Base Price.
//   Closeout: a unit qualifies by the Clearance Hit List's own rule
//   (clearanceRuleFor — OPEN serial type, ALL aged > 365 days, or ALL with a
//   UniqueSellPrice); "Closeout units only" keeps models with at least one.
//
//   Every on-hand unit gets a plain-language status:
//     available        free to sell — not written, not reserved
//     likely           written to an order whose delivery / pickup is more
//                      than 60 days out → "likely available to sell"
//     spoken           written to an order inside 60 days (or undated)
//     reserved         (legacy) — since 10/27 a DateReserved without an order
//                      is not a hold anywhere in Agility; only an invoice
//                      (written / ordered-for) takes a unit out of ATS
//     exclusive        ePASS Reserve Exclusive (display / open-box unit)
//
// Sources: shop inventory snapshot (every on-hand serial from the ePASS feed,
// refreshed each pull), epass_open_orders (customer, schedule / pickup date,
// job status for the written-to invoice), the NetSuite catalog through the
// catalog resolver, epass_model_master for models ePASS knows but has none of.
// Read-only; memoized five minutes.
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";
import { getShopInventorySnapshot } from "./shop-postgres.js";
import { getCatalog, resolveModel } from "./catalog-resolver.js";
import { clearanceRuleFor } from "./clearance-live.js";

export const LIKELY_AVAILABLE_DAYS = 60;
// The maker's own floor code on a model (SZ-UMRP, WOLF-UMRP, BESTMAP …) —
// anything MAP-ish that isn't the retail deck itself.
const pickRaw = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k != null && row[k] != null && String(row[k]).trim() !== "") return row[k]; } return null; };

export function brandUmrp(prices = {}) {
  const codes = Object.keys(prices).filter((c) => c !== "RETAIL" && /UMRP$|MAP$|PMAP$/.test(c) && prices[c] > 0).sort();
  return codes.length ? { code: codes[0], price: prices[codes[0]] } : { code: "", price: null };
}

export const UNIT_STATUS = {
  available: "Available to sell",
  display: "Display — ask the GM to sell",
  likely: "Likely available to sell",
  spoken: "Spoken for",
  reserved: "Reserved",
  exclusive: "Exclusive reserve"
};

const normModel = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const isoDay = (v) => { const s = String(v || "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
const baseInvoice = (v) => String(v || "").trim().toUpperCase().replace(/-\d+$/, "");

let memo = { at: 0, value: null, promise: null };
export function invalidateInventoryIndex() { memo = { at: 0, value: null, promise: null }; }

async function safeRows(pool, sql, params = []) { try { return (await pool.query(sql, params)).rows; } catch { return []; } }

async function build() {
  const pool = await getPostgresPool();
  const today = new Date().toISOString().slice(0, 10);
  const cutoffMs = Date.now() + LIKELY_AVAILABLE_DAYS * 86400000;
  const [snapshot, cat, orders, master, priceRows, nsItems] = await Promise.all([
    getShopInventorySnapshot().catch(() => null),
    getCatalog(),
    pool ? safeRows(pool, `SELECT code, sold_to_name, salesperson, job_status, raw->>'ScheduleDate' AS schedule_date, raw->>'PickUpDate' AS pickup_date, raw->>'JobStatusCode' AS job_status_code FROM epass_open_orders`) : [],
    pool ? safeRows(pool, `SELECT model, brand_code, brand, product_code, description FROM epass_model_master`) : [],
    pool ? safeRows(pool, `SELECT model_code, price_code, price FROM epass_model_list_prices WHERE price > 0 ORDER BY seq NULLS FIRST`) : [],
    pool ? safeRows(pool, `SELECT model_key, base_price, short_description FROM netsuite_items`) : []
  ]);
  // key → { L1, L2, RETAIL, "SZ-UMRP", "WOLF-UMRP", … } (latest seq wins).
  // Brands that price by UMRP/MAP instead of L1/RETAIL (Sub-Zero, Wolf,
  // Best, Scotsman …) carry their own code — surfaced as `umrp` (Andrew 10/27).
  const pricesByModel = new Map();
  for (const r of priceRows) { const k = normModel(r.model_code); const code = String(r.price_code || "").trim().toUpperCase(); if (!k || !code) continue; if (!pricesByModel.has(k)) pricesByModel.set(k, {}); pricesByModel.get(k)[code] = Number(r.price); }
  const nsByKey = new Map(nsItems.map((r) => [normModel(r.model_key), { basePrice: r.base_price == null ? null : Number(r.base_price), shortDescription: r.short_description || "" }]));
  const orderByCode = new Map();
  for (const o of orders) {
    const code = String(o.code || "").toUpperCase();
    const rec = { code, customer: o.sold_to_name || "", salesperson: o.salesperson || "", jobStatus: o.job_status_code || o.job_status || "", scheduleDate: isoDay(o.schedule_date), pickupDate: isoDay(o.pickup_date) };
    orderByCode.set(code, rec);
    if (!orderByCode.has(baseInvoice(code))) orderByCode.set(baseInvoice(code), rec);
  }

  const models = new Map();
  const touch = (model, epass = {}) => {
    const k = normModel(model); if (!k) return null;
    let m = models.get(k);
    if (!m) {
      const r = resolveModel(cat, model, epass);
      m = { key: k, model: r.model || String(model).trim(), brand: r.brand, supplier: r.supplier, category: r.merchCategory, cls: r.merchClass, subclass: r.merchSubclass,
        description: nsByKey.get(k)?.shortDescription || r.description, source: r.source, discontinued: !!r.discontinued, epassDiscontinued: false, prod: String(epass.prod || "").toUpperCase(), brandCode: String(epass.brandCode || "").toUpperCase(),
        basePrice: nsByKey.get(k)?.basePrice ?? null, prices: pricesByModel.get(k) || {},
        units: [], onHand: 0, available: 0, display: 0, likely: 0, spoken: 0, reserved: 0, exclusive: 0, ats: 0, closeout: 0 };
      models.set(k, m);
    } else {
      if (!m.description && epass.description) m.description = epass.description;
      if (!m.prod && epass.prod) m.prod = String(epass.prod).toUpperCase();
      if (!m.brandCode && epass.brandCode) m.brandCode = String(epass.brandCode).toUpperCase();
    }
    return m;
  };

  // Every NetSuite item first (so a model with no stock is still findable),
  // then ePASS's model master, then the units on hand.
  for (const ns of cat.byModel.values()) touch(ns.model);
  for (const r of master) touch(r.model, { brandCode: r.brand_code, brand: r.brand, prod: r.product_code, description: r.description });
  const todayMs = Date.parse(today + "T00:00:00Z");
  for (const u of snapshot?.serialUnits || []) {
    const model = String(u.model || u.sku || "").trim();
    const serial = String(u.serial || "").trim().toUpperCase();
    if (!model || !serial) continue;
    const m = touch(model, { brandCode: u.brand, prod: u.prod, description: u.description, supplierCode: "" });
    if (!m) continue;
    if (u.discontinued) m.epassDiscontinued = true;
    const writtenTo = String(u.writtenTo || "").trim();
    const reservedRaw = String(u.reserved || "").trim();
    const order = writtenTo ? orderByCode.get(writtenTo.toUpperCase()) || orderByCode.get(baseInvoice(writtenTo)) || null : null;
    const when = order ? (order.scheduleDate || order.pickupDate) : "";
    let status, note = "";
    if (writtenTo) {
      if (when && Date.parse(when + "T00:00:00Z") > cutoffMs) {
        status = "likely";
        const days = Math.round((Date.parse(when + "T00:00:00Z") - todayMs) / 86400000);
        note = `${order.pickupDate && !order.scheduleDate ? "Pickup" : "Delivery"} is ${days} days out — likely available to sell; check with ${order.salesperson ? order.salesperson : "the salesperson"} before promising it.`;
      } else {
        status = "spoken";
        note = when ? "" : "No delivery date on the order yet.";
      }
    } else if (reservedRaw === "exclusive") status = "exclusive";
    else if (String(u.serialType || "").toUpperCase() === "DISPLAY" && !reservedRaw) {
      // A free display unit isn't the salesperson's to promise — the GM
      // decides whether it leaves the floor (Andrew 10/27). The drawer offers
      // an "Ask the GM" button for it.
      status = "display";
    }
    else if (reservedRaw) status = "reserved"; // no longer produced by the feed (10/27: a DateReserved without an order is not a hold) — kept for old snapshots
    else status = "available";
    const hit = clearanceRuleFor(u, { today: new Date(todayMs) });
    m.units.push({
      closeout: hit ? hit.label : "", closeoutRule: hit ? hit.rule : "", uniquePrice: Number(u.uniquePrice) > 0 ? Number(u.uniquePrice) : null,
      serial, serialType: String(u.serialType || "").toUpperCase(), received: u.received || "",
      ageDays: /^\d{4}-\d{2}-\d{2}$/.test(u.received || "") ? Math.max(0, Math.round((todayMs - Date.parse(u.received + "T00:00:00Z")) / 86400000)) : null,
      location: u.location || "", bin: u.bin || "",
      status, statusLabel: UNIT_STATUS[status], note,
      writtenTo, customer: order?.customer || "", salesperson: order?.salesperson || "", scheduleDate: order?.scheduleDate || "", pickupDate: order?.pickupDate || "", jobStatus: order?.jobStatus || "",
      reservedOn: status === "reserved" && reservedRaw !== "yes" ? reservedRaw : ""
    });
    m.onHand += 1; m[status] += 1;
    if (status === "available" && String(u.serialType || "").toUpperCase() === "ALL") m.ats += 1;
    if (hit) m.closeout += 1;
  }
  for (const m of models.values()) {
    m.units.sort((a, b) => ["available", "likely", "display", "exclusive", "reserved", "spoken"].indexOf(a.status) - ["available", "likely", "display", "exclusive", "reserved", "spoken"].indexOf(b.status) || (a.received || "9").localeCompare(b.received || "9") || a.serial.localeCompare(b.serial));
    m.active = m.onHand > 0 || (m.source === "netsuite" && !m.discontinued && !m.epassDiscontinued);
  }

  // Merch tree from NetSuite: category → class → subclass, with model counts.
  const tree = new Map();
  for (const m of models.values()) {
    if (!m.category && !m.cls) continue;
    const c = m.category || "(no category)";
    if (!tree.has(c)) tree.set(c, { label: c, models: 0, classes: new Map() });
    const cat1 = tree.get(c); cat1.models += 1;
    const cl = m.cls || "(no class)";
    if (!cat1.classes.has(cl)) cat1.classes.set(cl, { label: cl, models: 0, subclasses: new Map() });
    const cl1 = cat1.classes.get(cl); cl1.models += 1;
    const sc = m.subclass || "(no subclass)";
    cl1.subclasses.set(sc, (cl1.subclasses.get(sc) || 0) + 1);
  }
  const sortLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });
  const treeOut = [...tree.values()].sort(sortLabel).map((c) => ({ label: c.label, models: c.models, classes: [...c.classes.values()].sort(sortLabel).map((cl) => ({ label: cl.label, models: cl.models, subclasses: [...cl.subclasses.entries()].map(([label, n]) => ({ label, models: n })).sort(sortLabel) })) }));

  return {
    builtAt: new Date().toISOString(), today,
    snapshotAt: snapshot?.uploadedAt || null, snapshotSource: snapshot?.sourceFile || "",
    hierarchyLoaded: treeOut.length > 0, netsuiteModels: cat.byModel.size,
    models, tree: treeOut,
    totals: { models: models.size, stocked: [...models.values()].filter((m) => m.onHand > 0).length, units: [...models.values()].reduce((a, m) => a + m.onHand, 0) }
  };
}

export async function getInventoryIndex(force = false) {
  if (!force && memo.value && Date.now() - memo.at < 5 * 60 * 1000) return memo.value;
  if (!memo.promise) memo.promise = build().then((v) => { memo = { at: Date.now(), value: v, promise: null }; return v; }).catch((err) => { memo.promise = null; throw err; });
  return memo.promise;
}

const MODES = new Set(["contains", "starts", "ends"]);
function textMatch(value, needle, mode) {
  if (!needle) return true;
  const v = String(value || "").toLowerCase(); const n = needle.toLowerCase();
  if (mode === "starts") return v.startsWith(n);
  if (mode === "ends") return v.endsWith(n);
  return v.includes(n);
}
// Model searches ignore punctuation on both sides (CL4850UFD/O ↔ CL4850UFDO).
function modelMatch(model, needle, mode) {
  if (!needle) return true;
  return textMatch(normModel(model), normModel(needle), mode);
}

export function searchInventory(index, q = {}) {
  const mode = (m) => (MODES.has(m) ? m : "contains");
  const category = String(q.category || ""), cls = String(q.cls || ""), subclass = String(q.subclass || "");
  const model = String(q.model || "").trim(), brand = String(q.brand || "").trim(), description = String(q.description || "").trim();
  const onHand = /^(1|true|yes)$/i.test(String(q.onHand || "")), active = !/^(0|false|no)$/i.test(String(q.active ?? "1"));
  const closeoutOnly = /^(1|true|yes)$/i.test(String(q.closeout || ""));
  const limit = Math.min(1000, Math.max(1, Number(q.limit) || 300));
  const out = [];
  let total = 0;
  for (const m of index.models.values()) {
    if (onHand && !m.onHand) continue;
    if (closeoutOnly && !m.closeout) continue;
    if (active && !m.active) continue;
    if (category && m.category !== category) continue;
    if (cls && m.cls !== cls) continue;
    if (subclass && m.subclass !== subclass) continue;
    if (!modelMatch(m.model, model, mode(q.modelMode))) continue;
    if (!textMatch(m.brand, brand, mode(q.brandMode)) && !textMatch(m.brandCode, brand, mode(q.brandMode))) continue;
    if (!textMatch(m.description, description, mode(q.descMode))) continue;
    total += 1;
    out.push(m);
  }
  out.sort((a, b) => (b.ats - a.ats) || (b.onHand - a.onHand) || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  const rows = out.slice(0, limit).map((m) => ({
    model: m.model, brand: m.brand, description: m.description, supplier: m.supplier, category: m.category, cls: m.cls, subclass: m.subclass,
    prod: m.prod, source: m.source, discontinued: m.discontinued || m.epassDiscontinued, active: m.active,
    onHand: m.onHand, available: m.available, display: m.display, likely: m.likely, spoken: m.spoken, reserved: m.reserved, exclusive: m.exclusive, ats: m.ats, closeout: m.closeout,
    basePrice: m.basePrice, l1: m.prices.L1 || null, l2: m.prices.L2 || null, retail: m.prices.RETAIL || null, umrp: brandUmrp(m.prices).price, umrpCode: brandUmrp(m.prices).code
  }));
  return { rows, total, shown: rows.length };
}

export async function inventoryModelDetail(index, model) {
  const m = index.models.get(normModel(model));
  if (!m) return null;
  // Trailing-12-month sold units from the live ePASS feed (epass_sold_serials
  // — the same one-row-per-unit table Brand Sales and the commission reports
  // read, fifteen minutes fresh): every serial on an invoice finished in the
  // last 365 days, returns excluded. Andrew 10/27: one simple gauge — this
  // screen may be read over a salesperson's shoulder, so units only, never
  // cost or margin. Falls back to the OE-23 warehouse only if the feed table
  // is empty (a fresh database).
  let sold12 = null, written12 = null, soldWindow = null, soldSource = "";
  try {
    const pool = await getPostgresPool();
    if (pool) {
      const to = index.today;
      const d = new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 365);
      const from = d.toISOString().slice(0, 10);
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE NOT returned)::int AS units, COUNT(*)::int AS rows
           FROM epass_sold_serials
          WHERE finish_date >= $1 AND finish_date <= $2
            AND upper(regexp_replace(model, '[^0-9A-Za-z]', '', 'g')) = $3`, [from, to, m.key]);
      const any = (await pool.query(`SELECT 1 FROM epass_sold_serials LIMIT 1`)).rows.length > 0;
      if (any) {
        sold12 = Number(r.rows[0]?.units) || 0; soldWindow = { from, to }; soldSource = "epass";
        // Written in the window — Brand Sales' definition: finished units by
        // the invoice's START date, plus the model's lines on the open book
        // (started in the window, not delivered yet — no serials, so
        // QtyOrdered counts). Returns excluded.
        const w = await pool.query(
          `SELECT COUNT(*) FILTER (WHERE NOT returned)::int AS units FROM epass_sold_serials
            WHERE start_date >= $1 AND start_date <= $2 AND upper(regexp_replace(model, '[^0-9A-Za-z]', '', 'g')) = $3`, [from, to, m.key]);
        const openRows = await pool.query(
          `SELECT l.raw AS line, o.raw AS header FROM epass_open_order_lines l JOIN epass_open_orders o ON o.code = l.invoice_code
            WHERE upper(regexp_replace(l.model_code, '[^0-9A-Za-z]', '', 'g')) = $1`, [m.key]).then((x) => x.rows).catch(() => []);
        let openUnits = 0;
        for (const o of openRows) {
          const start = isoDay(pickRaw(o.header, "InvStartDate")) || isoDay(pickRaw(o.header, "DateCreated"));
          if (!start || start < from || start > to) continue;
          openUnits += Number(pickRaw(o.line, "QtyOrdered")) || 1;
        }
        written12 = (Number(w.rows[0]?.units) || 0) + openUnits;
      }
      else {
        const w = await pool.query(`SELECT COALESCE(SUM(qty), 0) AS units FROM sales_order_lines WHERE source_month >= $1 AND upper(regexp_replace(product, '[^0-9A-Za-z]', '', 'g')) = $2`, [from.slice(0, 7), m.key]);
        sold12 = Math.round(Number(w.rows[0]?.units) || 0); soldWindow = { from, to }; soldSource = "oe23";
      }
    }
  } catch {}
  return {
    model: m.model, brand: m.brand, supplier: m.supplier, category: m.category, cls: m.cls, subclass: m.subclass, description: m.description,
    source: m.source, discontinued: m.discontinued || m.epassDiscontinued, prod: m.prod,
    counts: { onHand: m.onHand, available: m.available, display: m.display, likely: m.likely, spoken: m.spoken, reserved: m.reserved, exclusive: m.exclusive, ats: m.ats, closeout: m.closeout },
    prices: { base: m.basePrice, l1: m.prices.L1 || null, l2: m.prices.L2 || null, retail: m.prices.RETAIL || null, umrp: brandUmrp(m.prices).price, umrpCode: brandUmrp(m.prices).code, all: m.prices },
    units: m.units, sold12, written12, soldWindow, soldSource,
    likelyDays: LIKELY_AVAILABLE_DAYS, snapshotAt: index.snapshotAt, snapshotSource: index.snapshotSource, today: index.today
  };
}
