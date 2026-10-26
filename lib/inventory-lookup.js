// ---------------------------------------------------------------------------
// Inventory Lookup (Andrew 10/26) — the team's "Serial Inventory" screen,
// built on the current ePASS feeds and NetSuite's words.
//
//   Filters: NetSuite Merch Category → Class → Subclass (cascading), three
//   text searches (model / brand / description, each contains | starts with |
//   ends with), On hand only, Active or In-Stock only (default on; off shows
//   discontinued and long-gone models for archive lookups).
//
//   Every on-hand unit gets a plain-language status:
//     available        free to sell — not written, not reserved
//     likely           written to an order whose delivery / pickup is more
//                      than 60 days out → "likely available to sell"
//     spoken           written to an order inside 60 days (or undated)
//     reserved         ePASS DateReserved (held for someone)
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

export const LIKELY_AVAILABLE_DAYS = 60;
export const UNIT_STATUS = {
  available: "Available to sell",
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
  const [snapshot, cat, orders, master] = await Promise.all([
    getShopInventorySnapshot().catch(() => null),
    getCatalog(),
    pool ? safeRows(pool, `SELECT code, sold_to_name, salesperson, job_status, raw->>'ScheduleDate' AS schedule_date, raw->>'PickUpDate' AS pickup_date, raw->>'JobStatusCode' AS job_status_code FROM epass_open_orders`) : [],
    pool ? safeRows(pool, `SELECT model, brand_code, brand, product_code, description FROM epass_model_master`) : []
  ]);
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
        description: r.description, source: r.source, discontinued: !!r.discontinued, epassDiscontinued: false, prod: String(epass.prod || "").toUpperCase(), brandCode: String(epass.brandCode || "").toUpperCase(),
        units: [], onHand: 0, available: 0, likely: 0, spoken: 0, reserved: 0, exclusive: 0 };
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
    else if (reservedRaw) status = "reserved";
    else status = "available";
    m.units.push({
      serial, serialType: String(u.serialType || "").toUpperCase(), received: u.received || "",
      ageDays: /^\d{4}-\d{2}-\d{2}$/.test(u.received || "") ? Math.max(0, Math.round((todayMs - Date.parse(u.received + "T00:00:00Z")) / 86400000)) : null,
      location: u.location || "", bin: u.bin || "",
      status, statusLabel: UNIT_STATUS[status], note,
      writtenTo, customer: order?.customer || "", salesperson: order?.salesperson || "", scheduleDate: order?.scheduleDate || "", pickupDate: order?.pickupDate || "", jobStatus: order?.jobStatus || "",
      reservedOn: reservedRaw && reservedRaw !== "exclusive" && reservedRaw !== "yes" ? reservedRaw : ""
    });
    m.onHand += 1; m[status] += 1;
  }
  for (const m of models.values()) {
    m.units.sort((a, b) => ["available", "likely", "exclusive", "reserved", "spoken"].indexOf(a.status) - ["available", "likely", "exclusive", "reserved", "spoken"].indexOf(b.status) || (a.received || "9").localeCompare(b.received || "9") || a.serial.localeCompare(b.serial));
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
  const limit = Math.min(1000, Math.max(1, Number(q.limit) || 300));
  const out = [];
  let total = 0;
  for (const m of index.models.values()) {
    if (onHand && !m.onHand) continue;
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
  out.sort((a, b) => (b.onHand - a.onHand) || (b.available - a.available) || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  const rows = out.slice(0, limit).map((m) => ({
    model: m.model, brand: m.brand, description: m.description, supplier: m.supplier, category: m.category, cls: m.cls, subclass: m.subclass,
    prod: m.prod, source: m.source, discontinued: m.discontinued || m.epassDiscontinued, active: m.active,
    onHand: m.onHand, available: m.available, likely: m.likely, spoken: m.spoken, reserved: m.reserved, exclusive: m.exclusive
  }));
  return { rows, total, shown: rows.length };
}

export async function inventoryModelDetail(index, model) {
  const m = index.models.get(normModel(model));
  if (!m) return null;
  let months = [];
  try {
    const pool = await getPostgresPool();
    if (pool) {
      const r = await pool.query(`SELECT source_month AS month, SUM(qty) AS units FROM sales_order_lines WHERE upper(regexp_replace(product, '[^0-9A-Za-z]', '', 'g')) = $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 3`, [m.key]);
      months = r.rows.map((x) => ({ month: x.month, units: Number(x.units) || 0 })).reverse();
    }
  } catch {}
  return {
    model: m.model, brand: m.brand, supplier: m.supplier, category: m.category, cls: m.cls, subclass: m.subclass, description: m.description,
    source: m.source, discontinued: m.discontinued || m.epassDiscontinued, prod: m.prod,
    counts: { onHand: m.onHand, available: m.available, likely: m.likely, spoken: m.spoken, reserved: m.reserved, exclusive: m.exclusive },
    units: m.units, months,
    likelyDays: LIKELY_AVAILABLE_DAYS, snapshotAt: index.snapshotAt, snapshotSource: index.snapshotSource, today: index.today
  };
}
