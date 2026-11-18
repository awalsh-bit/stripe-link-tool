// ---------------------------------------------------------------------------
// The shop's TOTAL delivery area, with a delivery fee per ZIP (Andrew 11/19).
//
// "Can you give us the ability to edit the delivery fee in the online shop
// tool in agility by ZIP? There's an artifact with all ZIPs within 150 miles,
// but we can't deliver for a flat fee that far out."
//
// Two lists now describe where the shop delivers:
//   shop_allowed_zips   the EXPRESS area: order online, pick a delivery date
//                       (Shop Orders -> Delivery ZIP codes; unchanged)
//   shop_delivery_zips  everywhere Wilson can deliver at all, each ZIP with
//                       its city, county, miles from the store and a fee
//
// A ZIP on this list WITH a fee is in the total area. A ZIP on the list with
// no fee yet is only a row waiting for one: the shop does not offer delivery
// there. That keeps the 150-mile list harmless until fees are set.
//
// The list is pasted in from a spreadsheet (parseDeliveryZipPaste) and fees
// are set in bulk on Shop Orders. Pasting never wipes a fee already set.
// ---------------------------------------------------------------------------
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shop_delivery_zips (
  zip TEXT PRIMARY KEY,
  city TEXT NOT NULL DEFAULT '',
  county TEXT NOT NULL DEFAULT '',
  miles NUMERIC,
  fee NUMERIC,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
let schemaDone = null;
async function zipPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("The database is not available.");
  if (!schemaDone) schemaDone = pool.query(SCHEMA_SQL).catch((e) => { schemaDone = null; throw e; });
  await schemaDone;
  return pool;
}

export const cleanZip = (z) => { const m = String(z ?? "").trim().match(/^(\d{5})(?:-\d{4})?$/); return m ? m[1] : ""; };
// "$149", "149.00", "1,250" -> a number of dollars; "" / junk -> null. Never negative, never absurd.
export function cleanFee(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n >= 0 && n <= 5000 ? n : null;
}
const cleanMiles = (v) => { const s = String(v ?? "").replace(/[,\s]|mi(les?)?\.?$/gi, ""); if (!/^\d+(\.\d+)?$/.test(s)) return null; const n = Math.round(Number(s) * 10) / 10; return n >= 0 && n <= 2000 ? n : null; };
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// One pasted line -> its cells. Tabs when the paste has them (a spreadsheet
// copy), otherwise commas with simple "quoted, cells".
function cellsOf(line, tabbed) {
  if (tabbed) return line.split("\t").map((c) => c.trim());
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// A paste from a spreadsheet -> rows. With a header row the columns are found
// by name (ZIP, City, County, Miles / Distance, Fee); without one the first
// 5-digit cell is the ZIP and nothing else is guessed, except a cell written
// with a dollar sign, which is the fee. Returns the rows (one per ZIP, the
// last line for a ZIP wins), how many lines had no ZIP, and the columns used.
export function parseDeliveryZipPaste(input) {
  const lines = String(input ?? "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const tabbed = lines.some((l) => l.includes("\t"));
  const grid = lines.map((l) => cellsOf(l, tabbed));
  let cols = null;
  if (grid.length && !grid[0].some((c) => cleanZip(c)) && grid[0].some((c) => /zip|postal/i.test(c))) {
    const head = grid.shift();
    const find = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
    cols = { zip: find(/zip|postal/i), city: find(/city|town|place|post office/i), county: find(/county/i), miles: find(/mile|dist/i), fee: find(/fee|charge|price|cost|rate/i) };
  }
  const byZip = new Map(); let skipped = 0;
  const raw = cols ? lines.slice(1) : lines;
  for (const [k, cells] of grid.entries()) {
    let row;
    if (cols) {
      const at = (k) => (cols[k] >= 0 ? cells[cols[k]] : undefined);
      row = { zip: cleanZip(at("zip")), city: text(at("city"), 60), county: text(at("county"), 60).replace(/\s+county$/i, ""), miles: cleanMiles(at("miles")), fee: cleanFee(at("fee")) };
    } else {
      // no header: the first 5-digit number on the line is the ZIP ("78620 Dripping Springs" works too)
      const money = cells.find((c) => /^\$\s*\d/.test(c)), zip = (raw[k].match(/(?:^|[^\d$.])(\d{5})(?:-\d{4})?(?![\d.])/) || [])[1] || "";
      row = { zip, city: "", county: "", miles: null, fee: money ? cleanFee(money) : null };
    }
    if (!row.zip) { skipped++; continue; }
    byZip.set(row.zip, row);
  }
  return { rows: [...byZip.values()], skipped, columns: cols ? Object.fromEntries(Object.entries(cols).filter(([, i]) => i >= 0).map(([k]) => [k, true])) : { zip: true } };
}

// Where a ZIP stands. express: on the express list (order online with a date).
// extended: not express, on the total list with a fee (order online, Wilson
// schedules by hand). none: call or text. `fee` is the ZIP's own fee when it
// has one, in either area; null otherwise.
export function deliveryAreaFor(zip, { expressSet = new Set(), deliveryMap = new Map() } = {}) {
  const z = cleanZip(String(zip ?? "").trim().slice(0, 5));
  const row = z ? deliveryMap.get(z) : null;
  const fee = row && row.fee != null ? Number(row.fee) : null;
  const area = z && expressSet.has(z) ? "express" : fee != null ? "extended" : "none";
  return { zip: z, area, fee, miles: row && row.miles != null ? Number(row.miles) : null, city: row?.city || "" };
}

const shape = (r) => ({ zip: r.zip, city: r.city || "", county: r.county || "", miles: r.miles == null ? null : Number(r.miles), fee: r.fee == null ? null : Number(r.fee), updatedBy: r.updated_by || "", updatedAt: r.updated_at?.toISOString?.() || null });
export async function listShopDeliveryZips() {
  const pool = await zipPool();
  return (await pool.query(`SELECT zip, city, county, miles, fee, updated_by, updated_at FROM shop_delivery_zips ORDER BY miles NULLS LAST, zip`)).rows.map(shape);
}
// Rows from a paste. A blank cell never overwrites what is stored: pasting the
// 150-mile list again, without fees, leaves every fee as it was.
export async function importShopDeliveryZips({ rows, by = "" }) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ zip: cleanZip(r?.zip), city: text(r?.city, 60), county: text(r?.county, 60), miles: r?.miles == null ? null : cleanMiles(r.miles), fee: r?.fee == null ? null : cleanFee(r.fee) })).filter((r) => r.zip);
  if (!list.length) throw new Error("No 5-digit ZIP codes found in what was pasted.");
  if (list.length > 5000) throw new Error("That is more than 5,000 ZIPs. Paste a smaller area.");
  const pool = await zipPool();
  const r = await pool.query(
    `INSERT INTO shop_delivery_zips AS t (zip, city, county, miles, fee, updated_by)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::text[])
     ON CONFLICT (zip) DO UPDATE SET city = COALESCE(NULLIF(EXCLUDED.city, ''), t.city), county = COALESCE(NULLIF(EXCLUDED.county, ''), t.county),
       miles = COALESCE(EXCLUDED.miles, t.miles), fee = COALESCE(EXCLUDED.fee, t.fee), updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [list.map((x) => x.zip), list.map((x) => x.city), list.map((x) => x.county), list.map((x) => x.miles), list.map((x) => x.fee), list.map(() => String(by || "").slice(0, 120))]);
  const added = r.rows.filter((x) => x.inserted).length;
  return { added, updated: r.rows.length - added };
}
// One fee for many ZIPs. fee null takes the fee off: the ZIP stays on the list
// and the shop stops offering delivery there.
export async function setShopDeliveryZipFees({ zips, fee, by = "" }) {
  const list = [...new Set((Array.isArray(zips) ? zips : []).map(cleanZip).filter(Boolean))];
  if (!list.length) throw new Error("Pick at least one ZIP.");
  const value = fee === null || fee === "" || fee === undefined ? null : cleanFee(fee);
  if (value === null && !(fee === null || fee === "" || fee === undefined)) throw new Error("The fee has to be a dollar amount, like 149 or 149.50.");
  const pool = await zipPool();
  const r = await pool.query(`UPDATE shop_delivery_zips SET fee = $2, updated_by = $3, updated_at = NOW() WHERE zip = ANY($1::text[]) AND fee IS DISTINCT FROM $2::numeric`, [list, value, String(by || "").slice(0, 120)]);
  return { changed: r.rowCount, fee: value };
}
export async function removeShopDeliveryZips({ zips }) {
  const list = [...new Set((Array.isArray(zips) ? zips : []).map(cleanZip).filter(Boolean))];
  if (!list.length) throw new Error("Pick at least one ZIP.");
  const pool = await zipPool();
  return { removed: (await pool.query(`DELETE FROM shop_delivery_zips WHERE zip = ANY($1::text[])`, [list])).rowCount };
}
