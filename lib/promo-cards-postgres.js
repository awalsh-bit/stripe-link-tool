// ---------------------------------------------------------------------------
// Promo Item Builder (Andrew 10/14): cards for the Online Shop and the
// Secret Menu built by drag-and-drop from inventory. A card holds ePASS
// items (a MODEL - any unit of it - or one exact SERIAL) and ePASS Misc
// charges (delivery / install / recycle / promo codes). Everything about an
// item or a charge is read live from ePASS data when the card is served;
// the only numbers the builder stores are the card's own prices. Photos are
// per model: an upload here, else the RetailDeck thumbnail.
//
//   promo_cards        title, subtitle, channels (shop / secret), status,
//                      sale window, sort
//   promo_card_items   kind model|serial, model, serial, qty, price
//   promo_card_misc    misc code, qty, price (null = ePASS list)
//   promo_item_photos  model -> image bytes (overrides the thumbnail)
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS promo_cards (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  channel_shop BOOLEAN NOT NULL DEFAULT FALSE,
  channel_secret BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'draft',
  starts_on DATE,
  ends_on DATE,
  sort INTEGER NOT NULL DEFAULT 100,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS promo_card_items (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES promo_cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'model',
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12,2),
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_promo_card_items_card ON promo_card_items (card_id);
CREATE TABLE IF NOT EXISTS promo_card_misc (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES promo_cards(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12,2),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_promo_card_misc_card ON promo_card_misc (card_id);
CREATE TABLE IF NOT EXISTS promo_item_photos (
  model TEXT PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes BYTEA NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

export const normModelKey = (m) => String(m || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const money = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? r2(v) : null));
const CHANNELS = ["shop", "secret"];
const STATUSES = ["draft", "published", "archived"];

// pg hands DATE columns back as a JS Date at local midnight; keep the
// calendar day as typed, never shifted by the server's timezone.
const ymd = (v) => { if (!v) return ""; if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`; const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ""; };
function rowToCard(r) {
  return {
    id: r.id, title: r.title || "", subtitle: r.subtitle || "", note: r.note || "",
    channels: { shop: !!r.channel_shop, secret: !!r.channel_secret },
    status: r.status || "draft",
    startsOn: ymd(r.starts_on), endsOn: ymd(r.ends_on),
    sort: Number(r.sort) || 100,
    createdBy: r.created_by || "", updatedBy: r.updated_by || "",
    createdAt: r.created_at?.toISOString?.() || null, updatedAt: r.updated_at?.toISOString?.() || null,
    items: [], misc: []
  };
}
const dateStr = (v) => { const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); };

export async function listPromoCards({ status = "", channel = "", includeArchived = false } = {}) {
  const pool = await getReadyPool();
  const where = []; const params = [];
  if (status && STATUSES.includes(status)) { params.push(status); where.push(`status = $${params.length}`); }
  else if (!includeArchived) where.push(`status <> 'archived'`);
  if (channel === "shop") where.push(`channel_shop`);
  if (channel === "secret") where.push(`channel_secret`);
  const cards = (await pool.query(`SELECT * FROM promo_cards ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY sort, id`)).rows.map(rowToCard);
  if (!cards.length) return [];
  const ids = cards.map((c) => c.id);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const items = (await pool.query(`SELECT * FROM promo_card_items WHERE card_id = ANY($1) ORDER BY card_id, sort, id`, [ids])).rows;
  for (const r of items) byId.get(r.card_id)?.items.push({ id: r.id, kind: r.kind === "serial" ? "serial" : "model", model: r.model, serial: r.serial || "", qty: Number(r.qty) || 1, price: money(r.price), sort: Number(r.sort) || 0 });
  const misc = (await pool.query(`SELECT * FROM promo_card_misc WHERE card_id = ANY($1) ORDER BY card_id, sort, id`, [ids])).rows;
  for (const r of misc) byId.get(r.card_id)?.misc.push({ id: r.id, code: r.code, qty: Number(r.qty) || 1, price: money(r.price), required: r.required !== false, sort: Number(r.sort) || 0 });
  return cards;
}

export async function getPromoCard(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const cards = await listPromoCards({ includeArchived: true });
  return cards.find((c) => c.id === n) || null;
}

// Whole-card save (the builder sends the complete card every time; items and
// misc are replaced in one transaction so the order on screen is the order
// on the card).
export async function savePromoCard(input, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const id = Number(input?.id) || 0;
  const title = String(input?.title || "").trim().slice(0, 120);
  if (!title) throw new Error("Give the card a title.");
  const subtitle = String(input?.subtitle || "").trim().slice(0, 200);
  const note = String(input?.note || "").trim().slice(0, 600);
  const channels = { shop: !!input?.channels?.shop, secret: input?.channels?.secret !== false };
  const status = STATUSES.includes(String(input?.status || "")) ? String(input.status) : "draft";
  const startsOn = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.startsOn || "")) ? String(input.startsOn) : null;
  const endsOn = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.endsOn || "")) ? String(input.endsOn) : null;
  if (startsOn && endsOn && endsOn < startsOn) throw new Error("The end date is before the start date.");
  const sort = Number.isFinite(Number(input?.sort)) ? Math.round(Number(input.sort)) : 100;
  const items = (Array.isArray(input?.items) ? input.items : []).map((it, i) => {
    const kind = it?.kind === "serial" ? "serial" : "model";
    const model = String(it?.model || "").trim().slice(0, 80);
    const serial = kind === "serial" ? String(it?.serial || "").trim().toUpperCase().slice(0, 60) : "";
    if (!model) throw new Error("An item is missing its model.");
    if (kind === "serial" && !serial) throw new Error(`${model}: serial item without a serial.`);
    const price = money(it?.price);
    if (price != null && (price < 0 || price > 1000000)) throw new Error(`${model}: enter a valid price.`);
    const qty = kind === "serial" ? 1 : Math.max(1, Math.min(20, Math.round(Number(it?.qty) || 1)));
    return { kind, model, serial, qty, price, sort: i };
  });
  const misc = (Array.isArray(input?.misc) ? input.misc : []).map((m, i) => {
    const code = String(m?.code || "").trim().slice(0, 40);
    if (!code) throw new Error("A misc charge is missing its code.");
    const price = money(m?.price);
    if (price != null && (price < 0 || price > 100000)) throw new Error(`${code}: enter a valid price.`);
    return { code, qty: Math.max(1, Math.min(20, Math.round(Number(m?.qty) || 1))), price, required: m?.required !== false, sort: i };
  });
  if (status === "published" && !items.length) throw new Error("A published card needs at least one item.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let cardId = id;
    if (id) {
      const r = await client.query(
        `UPDATE promo_cards SET title=$2, subtitle=$3, note=$4, channel_shop=$5, channel_secret=$6, status=$7, starts_on=$8, ends_on=$9, sort=$10, updated_by=$11, updated_at=NOW() WHERE id=$1 RETURNING id`,
        [id, title, subtitle, note, channels.shop, channels.secret, status, startsOn, endsOn, sort, String(byEmail || "").slice(0, 120)]);
      if (!r.rows.length) throw new Error("That card no longer exists.");
      await client.query(`DELETE FROM promo_card_items WHERE card_id = $1`, [id]);
      await client.query(`DELETE FROM promo_card_misc WHERE card_id = $1`, [id]);
    } else {
      const r = await client.query(
        `INSERT INTO promo_cards (title, subtitle, note, channel_shop, channel_secret, status, starts_on, ends_on, sort, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
        [title, subtitle, note, channels.shop, channels.secret, status, startsOn, endsOn, sort, String(byEmail || "").slice(0, 120)]);
      cardId = r.rows[0].id;
    }
    for (const it of items) await client.query(`INSERT INTO promo_card_items (card_id, kind, model, serial, qty, price, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [cardId, it.kind, it.model, it.serial, it.qty, it.price, it.sort]);
    for (const m of misc) await client.query(`INSERT INTO promo_card_misc (card_id, code, qty, price, required, sort) VALUES ($1,$2,$3,$4,$5,$6)`, [cardId, m.code, m.qty, m.price, m.required, m.sort]);
    await client.query("COMMIT");
    return getPromoCard(cardId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePromoCard(id) {
  const pool = await getReadyPool();
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return false;
  const r = await pool.query(`DELETE FROM promo_cards WHERE id = $1`, [n]);
  return r.rowCount > 0;
}

export async function setPromoCardStatus(id, status, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  if (!STATUSES.includes(status)) throw new Error("Unknown status.");
  const r = await pool.query(`UPDATE promo_cards SET status=$2, updated_by=$3, updated_at=NOW() WHERE id=$1 RETURNING id`, [Number(id), status, String(byEmail || "").slice(0, 120)]);
  if (!r.rows.length) throw new Error("That card no longer exists.");
  return getPromoCard(id);
}

// ---- photos (per model) ----
export async function savePromoPhoto({ model, contentType, bytes, byEmail = "" }) {
  const pool = await getReadyPool();
  const key = normModelKey(model);
  if (!key) throw new Error("A model is required.");
  if (!bytes || !bytes.length) throw new Error("No image received.");
  if (bytes.length > 6 * 1024 * 1024) throw new Error("Image is larger than 6 MB.");
  const ct = /^image\/(jpeg|png|webp|gif)$/.test(String(contentType || "")) ? String(contentType) : "image/jpeg";
  await pool.query(`INSERT INTO promo_item_photos (model, content_type, bytes, updated_by, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (model) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, ct, bytes, String(byEmail || "").slice(0, 120)]);
  return { model: key, contentType: ct, bytes: bytes.length };
}
export async function getPromoPhoto(model) {
  const pool = await getReadyPool();
  const key = normModelKey(model);
  if (!key) return null;
  const r = await pool.query(`SELECT content_type, bytes, updated_at FROM promo_item_photos WHERE model = $1`, [key]);
  return r.rows[0] ? { contentType: r.rows[0].content_type, bytes: r.rows[0].bytes, updatedAt: r.rows[0].updated_at } : null;
}
export async function deletePromoPhoto(model) {
  const pool = await getReadyPool();
  const r = await pool.query(`DELETE FROM promo_item_photos WHERE model = $1`, [normModelKey(model)]);
  return r.rowCount > 0;
}
export async function listPromoPhotoModels() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT model, updated_at FROM promo_item_photos`).catch(() => ({ rows: [] }));
  return new Map(r.rows.map((x) => [x.model, x.updated_at?.toISOString?.() || ""]));
}

// ---- resolution against ePASS (pure; the server passes the snapshot etc.) ----
// Turns stored cards into what a page shows: every item with its live ePASS
// facts (brand, description, list/MAP, type, availability), every misc
// charge with its ePASS list and tax flag, and the totals. `taxRate` is the
// shop's rate; a card is `available` only when every item can be had today.
export function resolvePromoCards(cards, { units = [], brandMap = {}, brandNames = {}, miscCharges = [], categoryByProduct = {}, images = {}, photoModels = new Map(), taxRate = 0.0825, today = dateStr(new Date()), statusById = new Map() } = {}) {
  const byModel = new Map(); // key -> units
  for (const u of units) { const k = normModelKey(u.model || u.sku); if (!k) continue; if (!byModel.has(k)) byModel.set(k, []); byModel.get(k).push(u); }
  const miscByCode = new Map(miscCharges.map((m) => [String(m.code).toUpperCase(), m]));
  // Free to put on a card: not written to a sales order, not reserved for a
  // customer (DateReserved). ePASS's Reserve Exclusive flag alone doesn't
  // block - it only keeps display / open-box units out of auto-allocation.
  const free = (u) => !String(u.writtenTo || "").trim() && (!String(u.reserved || "").trim() || String(u.reserved).trim() === "exclusive");
  const out = [];
  for (const card of cards) {
    const items = card.items.map((it) => {
      const key = normModelKey(it.model);
      const all = byModel.get(key) || [];
      const sample = all[0] || null;
      const unit = it.kind === "serial" ? all.find((u) => String(u.serial || "").toUpperCase() === it.serial) || null : null;
      const freeUnits = it.kind === "serial" ? (unit && free(unit) && !statusById.has(`${it.model}|${it.serial}#1`) && !statusById.has(`${it.model}|${it.serial}#S`) ? 1 : 0) : all.filter((u) => free(u) && String(u.serialType || "").toUpperCase() === "ALL").length;
      const ns = brandMap[it.model] || brandMap[String(it.model).toUpperCase()] || {};
      const src = unit || sample;
      const brandCode = String(src?.brand || "").trim().toUpperCase();
      const brand = ns.brand || brandNames[brandCode] || (brandCode.length > 3 ? brandCode.charAt(0) + brandCode.slice(1).toLowerCase() : brandCode);
      const prod = String(src?.prod || ns.prod || "").toUpperCase();
      const uniquePrice = Number(unit?.uniquePrice) || 0;
      const list = Number(src?.list) || 0;
      const priceSource = it.price != null ? "card" : uniquePrice > 0 ? "epass-unique" : list > 0 ? "epass-list" : "";
      const price = it.price != null ? it.price : uniquePrice > 0 ? uniquePrice : list > 0 ? list : null;
      return {
        id: it.id, kind: it.kind, model: it.model, serial: it.serial, qty: it.qty,
        brand, brandCode, description: String(src?.description || ns.description || "").trim(), product: prod, category: categoryByProduct[prod] || "",
        serialType: String(unit?.serialType || (it.kind === "model" ? "ALL" : "")).toUpperCase(),
        condition: it.kind === "serial" ? (String(unit?.serialType || "").toUpperCase() === "ALL" ? "new" : "open") : "new",
        list: list || null, listCode: src?.listCode || "", map: Number(src?.map) || null, mapCode: src?.mapCode || "", cost: Number(src?.cost) || null,
        uniquePrice: uniquePrice || null, received: unit?.received || "", location: unit?.location || "",
        price, priceSource, lineTotal: price != null ? r2(price * it.qty) : null,
        inStock: it.kind === "serial" ? (unit ? 1 : 0) : all.length, available: freeUnits,
        ok: it.kind === "serial" ? freeUnits > 0 : freeUnits >= it.qty,
        image: photoModels.has(key) ? `/api/promo/photo/${encodeURIComponent(key)}` : (images[key] || ""), imageSource: photoModels.has(key) ? "upload" : images[key] ? "retaildeck" : ""
      };
    });
    const misc = card.misc.map((m) => {
      const def = miscByCode.get(String(m.code).toUpperCase()) || null;
      const price = m.price != null && def?.allowPriceChange !== false ? m.price : (def?.list ?? m.price ?? 0);
      return { id: m.id, code: m.code, qty: m.qty, required: m.required, description: def?.description || m.code, type: def?.type || "", typeName: def?.typeName || "",
        list: def?.list ?? null, price: r2(price || 0), priceSource: m.price != null && def?.allowPriceChange !== false ? "card" : "epass-list", allowPriceChange: def ? def.allowPriceChange : true,
        taxable: def ? def.taxable : true, minutes: def?.minutes || 0, lineTotal: r2((price || 0) * m.qty), known: !!def, obsolete: !!def?.obsolete,
        saleStart: def?.saleStart || "", saleEnd: def?.saleEnd || "" };
    });
    const itemsTotal = r2(items.reduce((s, i) => s + (i.lineTotal || 0), 0));
    const miscTotal = r2(misc.reduce((s, m) => s + m.lineTotal, 0));
    const taxableBase = r2(itemsTotal + misc.filter((m) => m.taxable).reduce((s, m) => s + m.lineTotal, 0));
    const tax = r2(taxableBase * taxRate);
    const subtotal = r2(itemsTotal + miscTotal);
    const inWindow = (!card.startsOn || card.startsOn <= today) && (!card.endsOn || card.endsOn >= today);
    const priced = items.every((i) => i.price != null);
    out.push({
      ...card, items, misc,
      totals: { items: itemsTotal, misc: miscTotal, subtotal, taxableBase, tax, taxRate, total: r2(subtotal + tax) },
      available: items.length > 0 && items.every((i) => i.ok) && priced,
      priced, inWindow,
      live: card.status === "published" && inWindow && items.length > 0 && items.every((i) => i.ok) && priced,
      problems: [
        ...items.filter((i) => !i.ok).map((i) => `${i.model}${i.serial ? " " + i.serial : ""}: ${i.kind === "serial" ? (i.inStock ? "unit is spoken for" : "unit no longer on hand") : `only ${i.available} free unit${i.available === 1 ? "" : "s"} (card needs ${i.qty})`}`),
        ...items.filter((i) => i.price == null).map((i) => `${i.model}: no price`),
        ...misc.filter((m) => !m.known).map((m) => `${m.code}: not in the ePASS misc master`),
        ...misc.filter((m) => m.obsolete).map((m) => `${m.code}: obsolete in ePASS`),
        ...(card.endsOn && card.endsOn < today ? ["card has expired"] : []),
        ...(card.startsOn && card.startsOn > today ? [`card starts ${card.startsOn}`] : [])
      ]
    });
  }
  return out;
}
