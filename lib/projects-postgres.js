import crypto from "node:crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// PROJECTS — the Project Manager's book (Andrew 10/29).
//
// A "project" is a JOB SITE — every open sales ticket shipping to the same
// address (Andrew 10/29: "address based, not sales order based") — that
// clears the Project Parameters: dollar total and/or number of major
// appliances across those tickets, with an always-list and a never-list of
// customer names. Ship-to address when the ticket has one, else sold-to; a
// ticket with no address at all is keyed by its customer number instead. The
// book is rebuilt after every ePASS feed pull: qualifying open sales orders
// become project cards (status "new"); tracked projects pick up the latest
// needed-by date (ePASS ScheduleDate — the salesperson's date, never edited
// here), total, models and address; an order that leaves the open book is
// marked delivered. Each project carries a public token for the job-site
// readiness page on service.wilsonappliance.com (project.html?t=…).
//
//   project_settings   one jsonb row: the parameters + route start
//   projects           one row per base invoice
//   project_notes      PM notes / calls / visits / site-manager submissions
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ["new", "contacted", "visit_scheduled", "visited", "ready", "delivered", "closed"];
export const PROJECT_STATUS_LABELS = {
  new: "New", contacted: "Contacted", visit_scheduled: "Site visit scheduled", visited: "Site visited", ready: "Site ready", delivered: "Delivered", closed: "Closed"
};
export const READINESS_ITEMS = [
  { key: "access", label: "Delivery truck can reach the site (road, gate, driveway)" },
  { key: "cabinets", label: "Cabinets / openings are installed and to spec" },
  { key: "electrical", label: "Electrical is complete at every appliance location" },
  { key: "gas", label: "Gas line is run and stubbed (if any gas appliance)" },
  { key: "water", label: "Water supply and drain are in (fridge / dishwasher / ice maker)" },
  { key: "countertops", label: "Countertops are installed (cooktops, drop-ins)" },
  { key: "receiving", label: "Someone will be on site to receive and sign" }
];

const DEFAULT_SETTINGS = {
  minTotal: 15000,
  minAppliances: 4,
  mode: "any",            // "any" = dollars OR appliances; "all" = both
  alwaysCustomers: [],    // name fragments, case-insensitive — always a project
  neverCustomers: [],     // name fragments — never a project
  pmPhone: "512-894-0907",   // the number the job-site page shows for the PM
  routeStart: "4205 E Hwy 290, Dripping Springs, TX 78620",
  routeStartLat: null,
  routeStartLng: null
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY,
  base_invoice TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new',
  pm_email TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  sold_to_code TEXT NOT NULL DEFAULT '',
  bill_to_code TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  salesperson TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  address_override TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geocoded_from TEXT NOT NULL DEFAULT '',
  needed_by TEXT NOT NULL DEFAULT '',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  appliance_count INTEGER NOT NULL DEFAULT 0,
  models JSONB NOT NULL DEFAULT '[]'::jsonb,
  invoices JSONB NOT NULL DEFAULT '[]'::jsonb,
  qualified_by TEXT NOT NULL DEFAULT '',
  site_contact_name TEXT NOT NULL DEFAULT '',
  site_contact_phone TEXT NOT NULL DEFAULT '',
  site_contact_email TEXT NOT NULL DEFAULT '',
  visit_at TEXT NOT NULL DEFAULT '',
  readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  site_updated_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_feed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_key TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS orders JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_base_invoice_key;
CREATE UNIQUE INDEX IF NOT EXISTS projects_site_key ON projects (site_key) WHERE site_key <> '';
CREATE INDEX IF NOT EXISTS projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS projects_needed_by ON projects (needed_by);
CREATE TABLE IF NOT EXISTS project_notes (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS project_notes_project ON project_notes (project_id, created_at DESC);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

const up = (v, n = 80) => String(v || "").trim().toUpperCase().slice(0, n);
const text = (v, n = 200) => String(v == null ? "" : v).trim().slice(0, n);
const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const baseInvoice = (code) => up(code, 40).replace(/-\d+$/, "");
// Normalize a street address into a site key: upper-case, punctuation out,
// common suffixes and directions standardized, ZIP5 appended — so "123 Oak
// Street, Ste 4" and "123 OAK ST STE 4" are one site.
const SUFFIX = { STREET: "ST", ROAD: "RD", DRIVE: "DR", LANE: "LN", COURT: "CT", AVENUE: "AVE", AV: "AVE", BOULEVARD: "BLVD", HIGHWAY: "HWY", CIRCLE: "CIR", PLACE: "PL", TRAIL: "TRL", TERRACE: "TER", PARKWAY: "PKWY", COVE: "CV", LOOP: "LOOP", PASS: "PASS", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", SUITE: "STE", APARTMENT: "APT", UNIT: "UNIT", BUILDING: "BLDG", LOT: "LOT" };
export function siteKeyFor({ address1 = "", address2 = "", zip = "", city = "" } = {}) {
  const words = `${address1} ${address2}`.toUpperCase().replace(/[.,#]/g, " ").replace(/[^A-Z0-9 /-]/g, " ").split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] || w);
  const street = words.join(" ");
  if (!street) return "";
  const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
  return `${street}|${z || String(city || "").toUpperCase().replace(/[^A-Z]/g, "")}`;
}
const isoDay = (v) => { const s = String(v || "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
const pick = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k != null && row[k] != null && String(row[k]).trim() !== "") return row[k]; } return null; };
const listOfNames = (v) => (Array.isArray(v) ? v : String(v || "").split(/\r?\n|,/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 200);
const nameMatches = (name, fragments) => { const n = String(name || "").toLowerCase(); return fragments.some((f) => f && n.includes(String(f).toLowerCase())); };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function getProjectSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT value, updated_at, updated_by FROM project_settings WHERE id = 1`);
  const v = r.rows[0]?.value || {};
  return { ...DEFAULT_SETTINGS, ...v, updatedAt: r.rows[0]?.updated_at ? new Date(r.rows[0].updated_at).toISOString() : null, updatedBy: r.rows[0]?.updated_by || "" };
}

export async function saveProjectSettings(partial, { byEmail = "" } = {}) {
  const cur = await getProjectSettings();
  const next = { ...cur };
  if (partial.minTotal != null) next.minTotal = Math.max(0, num(partial.minTotal));
  if (partial.minAppliances != null) next.minAppliances = Math.max(0, Math.round(num(partial.minAppliances)));
  if (partial.mode != null) next.mode = partial.mode === "all" ? "all" : "any";
  if (partial.alwaysCustomers != null) next.alwaysCustomers = listOfNames(partial.alwaysCustomers);
  if (partial.neverCustomers != null) next.neverCustomers = listOfNames(partial.neverCustomers);
  if (partial.pmPhone != null) next.pmPhone = text(partial.pmPhone, 40);
  if (partial.routeStart != null) {
    const rs = text(partial.routeStart, 200);
    if (rs !== cur.routeStart) { next.routeStartLat = null; next.routeStartLng = null; }
    next.routeStart = rs;
  }
  if (partial.routeStartLat != null && partial.routeStartLng != null) { next.routeStartLat = Number(partial.routeStartLat); next.routeStartLng = Number(partial.routeStartLng); }
  const { updatedAt, updatedBy, ...value } = next;
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO project_settings (id, value, updated_by) VALUES (1, $1::jsonb, $2) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [JSON.stringify(value), String(byEmail || "").slice(0, 200)]);
  return getProjectSettings();
}

// ---------------------------------------------------------------------------
// Build the candidate list from the open book, then sync.
//   describeModel(model) → { description, bucket }  (catalog resolver)
// ---------------------------------------------------------------------------
export async function candidateOrdersFromFeed({ describeModel }) {
  const pool = await getReadyPool();
  const [orders, lines] = await Promise.all([
    pool.query(`SELECT code, inv_type, status, job_status, sold_to_code, sold_to_name, bill_to_code, salesperson, raw FROM epass_open_orders WHERE upper(inv_type) = 'S'`).then((r) => r.rows).catch(() => []),
    pool.query(`SELECT invoice_code, model_code, raw FROM epass_open_order_lines`).then((r) => r.rows).catch(() => [])
  ]);
  const linesByInvoice = new Map();
  for (const l of lines) { const k = up(l.invoice_code, 40); if (!linesByInvoice.has(k)) linesByInvoice.set(k, []); linesByInvoice.get(k).push(l); }
  const groups = new Map();
  for (const o of orders) {
    if (String(o.status || "").toUpperCase() && String(o.status || "").toUpperCase() !== "OPEN") continue;
    const h = o.raw || {};
    const base = baseInvoice(o.code);
    // Ship-to wins; sold-to is the fallback; no address → the customer number.
    const addr = (() => {
      for (const pre of ["ShipTo", "SoldTo"]) {
        const a1 = text(pick(h, `${pre}Address1`, `${pre}Address`), 120);
        if (!a1) continue;
        return { address1: a1, address2: text(pick(h, `${pre}Address2`), 80), city: text(pick(h, `${pre}City`), 60), state: text(pick(h, `${pre}State`, `${pre}Province`), 20), zip: text(pick(h, `${pre}ZipCode`, `${pre}PostalCode`, `${pre}Zip`), 12), source: pre === "ShipTo" ? "ship-to" : "sold-to" };
      }
      return null;
    })();
    const siteKey = addr ? siteKeyFor(addr) : `CUST|${text(o.sold_to_code || pick(h, "SoldToCode"), 40).toUpperCase() || base}`;
    let g = groups.get(siteKey);
    if (!g) {
      g = { siteKey, baseInvoice: base, invoices: [], orders: new Map(), customerName: "", soldToCode: "", billToCode: "", phone: "", salesperson: "", address: "", addressSource: addr?.source || "", neededBy: "", total: 0, models: new Map(), applianceCount: 0 };
      groups.set(siteKey, g);
    }
    g.invoices.push(up(o.code, 40));
    // One summary row per sales order at the site (the drawer lists them).
    const ord = g.orders.get(base) || { baseInvoice: base, invoices: [], customerName: "", salesperson: "", total: 0, scheduleDate: "" };
    ord.invoices.push(up(o.code, 40)); ord.total += num(pick(h, "Total"));
    ord.customerName = ord.customerName || text(o.sold_to_name || pick(h, "SoldToName"), 160); ord.salesperson = ord.salesperson || up(o.salesperson || pick(h, "Salesperson1Code"), 20);
    g.orders.set(base, ord);
    g.customerName = g.customerName || text(o.sold_to_name || pick(h, "SoldToName") || [pick(h, "SoldToLastName"), pick(h, "SoldToFirstName")].filter(Boolean).join(", "), 160);
    g.soldToCode = g.soldToCode || text(o.sold_to_code || pick(h, "SoldToCode"), 40);
    g.billToCode = g.billToCode || text(o.bill_to_code || pick(h, "BillToCode"), 40);
    g.phone = g.phone || text(pick(h, "SoldToPhone1", "SoldToPhone", "Phone1"), 30);
    g.salesperson = g.salesperson || up(o.salesperson || pick(h, "Salesperson1Code"), 20);
    if (!g.address && addr) g.address = [addr.address1, addr.address2, [addr.city, addr.state].filter(Boolean).join(", "), addr.zip].filter(Boolean).join(", ").replace(/, ,/g, ",");
    // Needed-by = the earliest parent-ticket ScheduleDate at the site (the
    // salesperson's date); a split (-1, -2 …) only fills in when no parent
    // at the site has one.
    const sched = isoDay(pick(h, "ScheduleDate"));
    const isParent = up(o.code, 40) === base;
    if (sched && isParent) { if (!ord.scheduleDate || sched < ord.scheduleDate) ord.scheduleDate = sched; if (!g.parentDated || sched < g.neededBy) { g.neededBy = sched; g.parentDated = true; } }
    else if (sched && !g.parentDated && (!g.neededBy || sched < g.neededBy)) g.neededBy = sched;
    g.total += num(pick(h, "Total"));
    for (const l of linesByInvoice.get(up(o.code, 40)) || []) {
      const model = text(l.model_code || pick(l.raw, "ModelCode"), 60);
      if (!model) continue;
      const qty = Math.max(1, Math.round(num(pick(l.raw, "QtyOrdered")) || 1));
      const d = describeModel ? describeModel(model) : { description: text(pick(l.raw, "ModelDesc", "Description"), 160), bucket: "" };
      const prev = g.models.get(model) || { model, qty: 0, description: d.description || text(pick(l.raw, "ModelDesc", "Description"), 160), bucket: d.bucket || "" };
      prev.qty += qty;
      g.models.set(model, prev);
      if (prev.bucket) g.applianceCount += qty;
    }
  }
  return [...groups.values()].map((g) => {
    const orders = [...g.orders.values()].map((o) => ({ ...o, total: Math.round(o.total * 100) / 100 })).sort((a, b) => a.baseInvoice.localeCompare(b.baseInvoice));
    return { ...g, orders, baseInvoice: orders[0]?.baseInvoice || g.baseInvoice, models: [...g.models.values()], total: Math.round(g.total * 100) / 100 };
  });
}

export function qualifies(order, settings) {
  if (nameMatches(order.customerName, settings.neverCustomers)) return "";
  if (nameMatches(order.customerName, settings.alwaysCustomers)) return "always";
  const byTotal = settings.minTotal > 0 && order.total >= settings.minTotal;
  const byCount = settings.minAppliances > 0 && order.applianceCount >= settings.minAppliances;
  if (settings.mode === "all") return byTotal && byCount ? "total+appliances" : "";
  if (byTotal && byCount) return "total+appliances";
  if (byTotal) return "total";
  if (byCount) return "appliances";
  return "";
}

// Rebuild the book from the feed. Returns counts. `geocode(address)` is
// optional and gentle (at most `geocodeLimit` lookups per sync).
export async function syncProjectsFromFeed({ describeModel, geocode = null, geocodeLimit = 25 } = {}) {
  const pool = await getReadyPool();
  const settings = await getProjectSettings();
  const orders = await candidateOrdersFromFeed({ describeModel });
  // Rows from before the site-key change (keyed by sales order) get a key
  // from their stored address so they merge into the right site.
  await pool.query(`UPDATE projects SET site_key = $1 || base_invoice WHERE site_key = ''`, ["LEGACY|"]).catch(() => {});
  const openKeys = new Set(orders.map((o) => o.siteKey));
  const existing = new Map((await pool.query(`SELECT id, site_key, base_invoice, status, address, address_override, lat, lng, geocoded_from FROM projects`)).rows.map((r) => [r.site_key, r]));
  // A legacy (order-keyed) row whose order now lives at a site key: adopt it.
  for (const o of orders) { for (const [k, r] of existing) { if (k.startsWith("LEGACY|") && o.invoices.some((i) => baseInvoice(i) === r.base_invoice)) { await pool.query(`UPDATE projects SET site_key = $2 WHERE id = $1`, [r.id, o.siteKey]); existing.delete(k); existing.set(o.siteKey, { ...r, site_key: o.siteKey }); break; } } }
  let created = 0, refreshed = 0, delivered = 0, geocoded = 0;
  for (const o of orders) {
    const why = qualifies(o, settings);
    const ex = existing.get(o.siteKey);
    if (!ex && !why) continue;
    const models = JSON.stringify(o.models);
    const invoices = JSON.stringify(o.invoices);
    const ordersJson = JSON.stringify(o.orders);
    if (!ex) {
      const token = crypto.randomBytes(18).toString("base64url");
      await pool.query(
        `INSERT INTO projects (site_key, base_invoice, token, status, customer_name, sold_to_code, bill_to_code, customer_phone, salesperson, address, needed_by, total, appliance_count, models, invoices, orders, qualified_by)
         VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16) ON CONFLICT DO NOTHING`,
        [o.siteKey, o.baseInvoice, token, o.customerName, o.soldToCode, o.billToCode, o.phone, o.salesperson, o.address, o.neededBy, o.total, o.applianceCount, models, invoices, ordersJson, why]
      );
      created++;
    } else {
      // Facts follow the feed; a delivered/closed project that reappears on
      // the open book (reopened ticket) comes back to its last working state.
      await pool.query(
        `UPDATE projects SET customer_name = CASE WHEN $2 <> '' THEN $2 ELSE customer_name END, sold_to_code = $3, bill_to_code = $4,
           customer_phone = CASE WHEN $5 <> '' THEN $5 ELSE customer_phone END, salesperson = $6, address = $7, needed_by = $8, total = $9, appliance_count = $10,
           models = $11::jsonb, invoices = $12::jsonb, orders = $14::jsonb, base_invoice = $15, qualified_by = CASE WHEN $13 <> '' THEN $13 ELSE qualified_by END,
           status = CASE WHEN status = 'delivered' THEN 'new' ELSE status END, delivered_at = CASE WHEN status = 'delivered' THEN NULL ELSE delivered_at END,
           last_feed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [ex.id, o.customerName, o.soldToCode, o.billToCode, o.phone, o.salesperson, o.address, o.neededBy, o.total, o.applianceCount, models, invoices, why, ordersJson, o.baseInvoice]
      );
      refreshed++;
    }
  }
  // Left the open book → delivered (unless already closed / delivered).
  for (const [key, ex] of existing) {
    if (openKeys.has(key)) continue;
    if (["delivered", "closed"].includes(ex.status)) continue;
    await pool.query(`UPDATE projects SET status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1`, [ex.id]);
    delivered++;
  }
  // Geocode what's new or whose address changed (override wins).
  if (geocode) {
    const rows = (await pool.query(`SELECT id, address, address_override, geocoded_from FROM projects WHERE status NOT IN ('closed') AND COALESCE(NULLIF(address_override, ''), address) <> '' AND COALESCE(NULLIF(address_override, ''), address) <> geocoded_from LIMIT $1`, [geocodeLimit])).rows;
    for (const r of rows) {
      const addr = r.address_override || r.address;
      try {
        const g = await geocode(addr);
        if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) { await pool.query(`UPDATE projects SET lat = $2, lng = $3, geocoded_from = $4 WHERE id = $1`, [r.id, g.lat, g.lng, addr]); geocoded++; }
        else await pool.query(`UPDATE projects SET geocoded_from = $2 WHERE id = $1`, [r.id, addr]); // don't retry a dead address every pull
      } catch { /* next pull */ }
    }
  }
  return { candidates: orders.length, created, refreshed, delivered, geocoded, tracked: existing.size + created };
}

// ---------------------------------------------------------------------------
// Reads / writes for the PM pages
// ---------------------------------------------------------------------------
const mapProject = (r) => ({
  id: Number(r.id), siteKey: r.site_key, baseInvoice: r.base_invoice, orders: r.orders || [], token: r.token, status: r.status, statusLabel: PROJECT_STATUS_LABELS[r.status] || r.status, pmEmail: r.pm_email,
  customerName: r.customer_name, soldToCode: r.sold_to_code, billToCode: r.bill_to_code, customerPhone: r.customer_phone, salesperson: r.salesperson,
  address: r.address, addressOverride: r.address_override, siteAddress: r.address_override || r.address, lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
  neededBy: r.needed_by, total: Number(r.total) || 0, applianceCount: Number(r.appliance_count) || 0, models: r.models || [], invoices: r.invoices || [], qualifiedBy: r.qualified_by,
  siteContactName: r.site_contact_name, siteContactPhone: r.site_contact_phone, siteContactEmail: r.site_contact_email, visitAt: r.visit_at,
  readiness: r.readiness || {}, siteUpdatedAt: r.site_updated_at ? new Date(r.site_updated_at).toISOString() : null,
  firstSeenAt: new Date(r.first_seen_at).toISOString(), lastFeedAt: new Date(r.last_feed_at).toISOString(), deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null, closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null, updatedAt: new Date(r.updated_at).toISOString(),
  lastNote: r.last_note || null
});

export async function listProjects({ status = "", pmEmail = "", includeClosed = false } = {}) {
  const pool = await getReadyPool();
  const where = []; const params = [];
  if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
  else if (!includeClosed) where.push(`p.status <> 'closed'`);
  if (pmEmail) { params.push(pmEmail.toLowerCase()); where.push(`p.pm_email = $${params.length}`); }
  const r = await pool.query(
    `SELECT p.*, (SELECT json_build_object('kind', n.kind, 'body', n.body, 'byName', n.by_name, 'at', n.created_at) FROM project_notes n WHERE n.project_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS last_note
       FROM projects p ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY CASE WHEN p.needed_by = '' THEN 1 ELSE 0 END, p.needed_by ASC, p.total DESC`, params);
  return r.rows.map(mapProject);
}

export async function getProject(id) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM projects WHERE id = $1`, [Number(id)]);
  if (!r.rows[0]) return null;
  const p = mapProject(r.rows[0]);
  p.notes = await listProjectNotes(p.id);
  return p;
}

export async function getProjectByToken(token) {
  const t = String(token || "").trim();
  if (!t || t.length < 10 || t.length > 60) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM projects WHERE token = $1`, [t]);
  return r.rows[0] ? mapProject(r.rows[0]) : null;
}

export async function updateProject(id, fields, { byEmail = "", byName = "" } = {}) {
  const pool = await getReadyPool();
  const sets = []; const params = [Number(id)];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (fields.status != null) {
    if (!PROJECT_STATUSES.includes(fields.status)) throw new Error("Unknown status.");
    set("status", fields.status);
    if (fields.status === "closed") set("closed_at", new Date().toISOString());
    else set("closed_at", null);
    if (fields.status === "delivered") set("delivered_at", new Date().toISOString());
  }
  if (fields.pmEmail != null) set("pm_email", String(fields.pmEmail || "").trim().toLowerCase().slice(0, 200));
  if (fields.siteContactName != null) set("site_contact_name", text(fields.siteContactName, 120));
  if (fields.siteContactPhone != null) set("site_contact_phone", text(fields.siteContactPhone, 40));
  if (fields.siteContactEmail != null) set("site_contact_email", text(fields.siteContactEmail, 200).toLowerCase());
  if (fields.addressOverride != null) set("address_override", text(fields.addressOverride, 240));
  if (fields.visitAt != null) set("visit_at", /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(fields.visitAt)) ? String(fields.visitAt) : "");
  if (!sets.length) return getProject(id);
  sets.push("updated_at = NOW()");
  await pool.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $1`, params);
  if (fields.status != null) await addProjectNote(id, { kind: "status", body: `Status → ${PROJECT_STATUS_LABELS[fields.status] || fields.status}`, byEmail, byName });
  return getProject(id);
}

export async function addProjectNote(projectId, { kind = "note", body = "", byEmail = "", byName = "" }) {
  const pool = await getReadyPool();
  const k = ["note", "call", "visit", "schedule", "status", "site", "text"].includes(kind) ? kind : "note";
  const r = await pool.query(`INSERT INTO project_notes (project_id, kind, body, by_email, by_name) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [Number(projectId), k, text(body, 2000), String(byEmail || "").toLowerCase().slice(0, 200), text(byName, 120)]);
  const n = r.rows[0];
  return { id: Number(n.id), kind: n.kind, body: n.body, byEmail: n.by_email, byName: n.by_name, at: new Date(n.created_at).toISOString() };
}

export async function listProjectNotes(projectId) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM project_notes WHERE project_id = $1 ORDER BY created_at DESC LIMIT 200`, [Number(projectId)]);
  return r.rows.map((n) => ({ id: Number(n.id), kind: n.kind, body: n.body, byEmail: n.by_email, byName: n.by_name, at: new Date(n.created_at).toISOString() }));
}

// The job-site manager's submission from the public page.
export async function saveProjectReadiness(token, { checklist = {}, notes = "", requestedDate = "", contactName = "", contactPhone = "" } = {}) {
  const p = await getProjectByToken(token);
  if (!p) return null;
  const clean = {};
  for (const it of READINESS_ITEMS) clean[it.key] = Boolean(checklist && checklist[it.key]);
  const reqDate = isoDay(requestedDate);
  const readiness = { ...clean, notes: text(notes, 1000), requestedDate: reqDate, submittedAt: new Date().toISOString() };
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE projects SET readiness = $2::jsonb, site_updated_at = NOW(),
       site_contact_name = CASE WHEN $3 <> '' THEN $3 ELSE site_contact_name END,
       site_contact_phone = CASE WHEN $4 <> '' THEN $4 ELSE site_contact_phone END,
       updated_at = NOW() WHERE id = $1`,
    [p.id, JSON.stringify(readiness), text(contactName, 120), text(contactPhone, 40)]
  );
  const done = READINESS_ITEMS.filter((it) => clean[it.key]).length;
  await addProjectNote(p.id, { kind: "site", body: `Site manager${contactName ? ` ${text(contactName, 120)}` : ""} checked ${done} of ${READINESS_ITEMS.length} readiness items${reqDate ? `, asked for ${reqDate}` : ""}${notes ? ` — "${text(notes, 300)}"` : ""}.`, byEmail: "", byName: "Job site" });
  return getProjectByToken(token);
}

export async function setProjectGeo(id, { lat, lng, from = "" }) {
  const pool = await getReadyPool();
  await pool.query(`UPDATE projects SET lat = $2, lng = $3, geocoded_from = $4 WHERE id = $1`, [Number(id), lat, lng, text(from, 240)]);
}
