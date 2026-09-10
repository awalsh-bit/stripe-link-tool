import crypto from "crypto";
import { read as readWorkbook, utils as xlsxUtils } from "xlsx";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Builder Prospect List (builder-prospects.html / builder-prospect-manager.html)
//
// Replaces the WACA_PROSPECT_MASTER workbook's Accounts / Contacts /
// Activities Log tabs. Agility is the master after the one-time import
// (Andrew, 2026-09-10); the workbook stays as the backup.
//
//   builder_accounts    one row per company (the Accounts tab)
//   builder_contacts    people at the company (the Contacts tab)
//   builder_activities  the Activities Log — every call/visit/email a rep
//                       logs, with the status/next-action it set
//
// ePASS tie-in: an account carries the ePASS customer number(s) it does
// business under (epass_customers JSONB: [{customerNumber, customerName}]).
// With those, the finished-ticket warehouse (sales_order_detail), open
// orders and open quotes light up per account — lifetime / 12-month
// revenue, last purchase, in-progress work — straight from the nightly
// agent feed. suggestEpassMatches() proposes links by company name; a
// person confirms them.
//
// Editing rules live in server.js: reps edit their own accounts and claim
// from the Lead Pool; the manager grant (builder-prospect-manager.html)
// reassigns and edits anything.
// ---------------------------------------------------------------------------

export const ACCOUNT_STATUSES = ["Open Lead", "Chasing", "Active Relationship", "Active Pricing", "Current Job", "Dormant", "Lost", "Not a Fit", "Duplicate / Review"];
export const TRADE_TYPES = ["Builder", "Designer", "Architect", "Remodeler", "Developer", "Other Trade Partner"];
export const STRENGTHS = ["New", "Warm", "Strong", "Key Account", "At Risk"];
export const PRIORITIES = ["High", "Medium", "Low"];
export const SOURCES = ["Marrissa Sheet", "Shelly Book", "Marrissa/Shelly Relationship Sheet", "Master Prospect Import", "Manual Staff Add", "Referral", "Website", "Showroom", "Builder Event", "Inside Sales", "Other"];
export const ACTIVITY_TYPES = ["Call", "Email", "Visit", "Showroom Invite", "Showroom Visit", "Follow-Up", "Pricing Update", "Note", "Meeting", "Other"];
export const OUTCOMES = ["Connected", "Left Message", "Sent Email", "No Response", "Meeting Scheduled", "Needs Quote", "Not Interested", "Follow-Up Needed", "Converted to Active Relationship", "Converted to Active Pricing"];
// The workbook's associate picklist. Distinct names already on accounts are
// merged in at read time, so a new rep just needs an account assigned.
export const ASSOCIATES = ["Shelly Doublet", "Marrissa Perks", "Ray Wilder", "Matt Mocniak", "Elliott Mullen", "Logan Carter", "Terra Bourguignon", "Christian Houde", "Shaun Ray", "Showroom"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS builder_accounts (
  id UUID PRIMARY KEY,
  company_name TEXT NOT NULL,
  company_key TEXT NOT NULL,
  trade_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open Lead',
  strength TEXT NOT NULL DEFAULT 'New',
  sales_associate TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Medium',
  primary_contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'TX',
  zip TEXT NOT NULL DEFAULT '',
  last_contacted_on DATE,
  next_action TEXT NOT NULL DEFAULT '',
  next_action_on DATE,
  notes TEXT NOT NULL DEFAULT '',
  manager_notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  epass_customers JSONB NOT NULL DEFAULT '[]'::jsonb,
  epass_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT NOT NULL DEFAULT '',
  baseline_associate TEXT NOT NULL DEFAULT '',
  baseline_status TEXT NOT NULL DEFAULT '',
  status_changed_at TIMESTAMPTZ,
  source_row TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_builder_accounts_key ON builder_accounts (company_key);
CREATE INDEX IF NOT EXISTS idx_builder_accounts_assoc ON builder_accounts (sales_associate, status);
CREATE INDEX IF NOT EXISTS idx_builder_accounts_status ON builder_accounts (status);

CREATE TABLE IF NOT EXISTS builder_contacts (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES builder_accounts(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_builder_contacts_account ON builder_contacts (account_id);

CREATE TABLE IF NOT EXISTS builder_activities (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES builder_accounts(id) ON DELETE CASCADE,
  activity_on DATE NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  new_status TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_on DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_builder_activities_account ON builder_activities (account_id, activity_on DESC);
CREATE INDEX IF NOT EXISTS idx_builder_activities_owner ON builder_activities (owner_email, activity_on DESC);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------
const NOISE_WORDS = new Set(["LLC", "INC", "CO", "CORP", "LTD", "LP", "LLP", "PLLC", "THE", "AND", "OF", "DBA", "GROUP", "COMPANY", "COMPANIES"]);

// "10 Design-Build, LLC" → "10 DESIGN BUILD" — the key that dedupes the
// import and the basis for ePASS name matching.
export function companyKey(name) {
  return String(name || "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokensOf(name) {
  return companyKey(name).split(" ").filter((t) => t && !NOISE_WORDS.has(t));
}
export function properName(s) {
  const str = String(s || "").trim();
  if (!str) return "";
  // leave mixed-case input alone; title-case shouting imports
  if (/[a-z]/.test(str)) return str;
  return str.toLowerCase().replace(/(^|[\s\-\/&(])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\bLlc\b/g, "LLC").replace(/\bInc\b/g, "Inc").replace(/\bTx\b/g, "TX");
}
function normPhone(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return String(v || "").trim().slice(0, 40);
}
function isoDate(v) {
  if (v == null || v === "" || v === 0 || v === "0") return null;
  if (v instanceof Date && !isNaN(v)) {
    if (v.getFullYear() < 2000) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return Number(m[1]) < 2000 ? null : `${m[1]}-${m[2]}-${m[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}
const TRADE_ALIASES = { "building": "Builder", "build/design": "Builder", "design": "Designer", "design build": "Builder", "mep": "Other Trade Partner", "contractor": "Builder", "interior designer": "Designer" };
function pick(list, value, fallback) {
  const v = String(value || "").trim();
  const hit = list.find((x) => x.toLowerCase() === v.toLowerCase());
  if (hit) return hit;
  if (list === TRADE_TYPES && TRADE_ALIASES[v.toLowerCase()]) return TRADE_ALIASES[v.toLowerCase()];
  return v ? v : fallback;
}
const dateOut = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));

function mapAccount(row) {
  return {
    id: row.id,
    companyName: row.company_name,
    tradeType: row.trade_type,
    status: row.status,
    strength: row.strength,
    salesAssociate: row.sales_associate,
    source: row.source,
    priority: row.priority,
    primaryContact: row.primary_contact,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address1: row.address1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    lastContactedOn: dateOut(row.last_contacted_on),
    nextAction: row.next_action,
    nextActionOn: dateOut(row.next_action_on),
    notes: row.notes,
    managerNotes: row.manager_notes,
    active: row.active,
    epassCustomers: Array.isArray(row.epass_customers) ? row.epass_customers : [],
    epassSuggestions: Array.isArray(row.epass_suggestions) ? row.epass_suggestions : [],
    assignedAt: row.assigned_at?.toISOString?.() || null,
    assignedBy: row.assigned_by,
    baselineAssociate: row.baseline_associate,
    baselineStatus: row.baseline_status,
    statusChangedAt: row.status_changed_at?.toISOString?.() || null,
    updatedAt: row.updated_at?.toISOString?.() || null,
    updatedBy: row.updated_by,
    contactCount: row.contact_count != null ? Number(row.contact_count) : undefined,
    activityCount: row.activity_count != null ? Number(row.activity_count) : undefined,
    lastActivityOn: row.last_activity_on ? dateOut(row.last_activity_on) : undefined
  };
}
function mapContact(row) {
  return { id: row.id, accountId: row.account_id, fullName: row.full_name, role: row.role, phone: row.phone, email: row.email, isPrimary: row.is_primary, notes: row.notes, active: row.active };
}
function mapActivity(row) {
  return {
    id: row.id, accountId: row.account_id, activityOn: dateOut(row.activity_on), contactName: row.contact_name, activityType: row.activity_type,
    outcome: row.outcome, ownerEmail: row.owner_email, ownerName: row.owner_name, newStatus: row.new_status, nextAction: row.next_action,
    nextActionOn: dateOut(row.next_action_on), notes: row.notes, createdAt: row.created_at?.toISOString?.() || null,
    companyName: row.company_name || undefined
  };
}

// ---------------------------------------------------------------------------
// Workbook import (Accounts + Contacts tabs of WACA_PROSPECT_MASTER)
// ---------------------------------------------------------------------------
function sheetRows(workbook, name) {
  const ws = workbook.Sheets[name];
  if (!ws) return null;
  const grid = xlsxUtils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const header = (grid[0] || []).map((h) => String(h || "").trim());
  return grid.slice(1).filter((r) => r.some((c) => c != null && c !== "")).map((r) => {
    const o = {};
    header.forEach((h, i) => { if (h) o[h] = r[i]; });
    return o;
  });
}
const cell = (v) => (v == null ? "" : String(v).trim());

export function parseProspectWorkbook(buffer) {
  const workbook = readWorkbook(buffer, { type: "buffer", cellDates: true });
  const accountsRows = sheetRows(workbook, "Accounts");
  if (!accountsRows) throw new Error("No 'Accounts' tab in that workbook — is it the Prospect Master?");
  const contactRows = sheetRows(workbook, "Contacts") || [];
  const accounts = [];
  const seen = new Map();
  for (const r of accountsRows) {
    const name = cell(r["Company Name"]);
    if (!name) continue;
    if (cell(r["Active"]).toLowerCase() === "no") continue;
    const key = companyKey(name);
    if (!key) continue;
    const notesBits = [cell(r["Notes"])].filter(Boolean);
    const acct = {
      companyName: properName(name.replace(/^\*+\s*/, "")),
      companyKey: key,
      tradeType: pick(TRADE_TYPES, r["Trade Type"], "Other Trade Partner"),
      status: pick(ACCOUNT_STATUSES, r["Status"], "Open Lead"),
      strength: pick(STRENGTHS, r["Relationship Strength"], "New"),
      salesAssociate: cell(r["Sales Associate"]),
      source: pick(SOURCES, r["Source"], "Master Prospect Import"),
      priority: pick(PRIORITIES, r["Priority"], "Medium"),
      primaryContact: cell(r["Primary Contact Name"]),
      phone: normPhone(r["Main Phone"]),
      email: cell(r["Main Email"]).toLowerCase() === "0" ? "" : cell(r["Main Email"]).toLowerCase(),
      website: cell(r["Website"]) === "0" ? "" : cell(r["Website"]),
      address1: cell(r["Address Line 1"]) === "0" ? "" : cell(r["Address Line 1"]),
      city: properName(cell(r["City"])),
      state: cell(r["State"]) || "TX",
      zip: cell(r["ZIP"]),
      lastContactedOn: isoDate(r["Last Contacted Date"]),
      nextAction: cell(r["Next Action"]),
      nextActionOn: isoDate(r["Next Action Date"]),
      notes: notesBits.join("\n"),
      managerNotes: cell(r["Manager Notes"]),
      assignedAt: r["Assignment Date"] instanceof Date ? r["Assignment Date"].toISOString() : (isoDate(r["Assignment Date"]) ? `${isoDate(r["Assignment Date"])}T12:00:00Z` : null),
      assignedBy: cell(r["Assigned By"]),
      baselineAssociate: cell(r["Baseline Sales Associate"]),
      baselineStatus: cell(r["Baseline Status"]),
      sourceRow: cell(r["Source Row"])
    };
    if (seen.has(key)) {
      // duplicate company on the tab: keep the richer row, remember the other's notes
      const prev = seen.get(key);
      const richer = (a) => [a.salesAssociate, a.phone, a.email, a.primaryContact, a.website].filter(Boolean).length;
      const keep = richer(acct) > richer(prev) ? acct : prev;
      const drop = keep === acct ? prev : acct;
      keep.notes = [keep.notes, drop.notes ? `Duplicate row: ${drop.notes}` : "", `Duplicate on import (${drop.sourceRow || "row"})`].filter(Boolean).join("\n");
      if (keep.status === "Open Lead" && drop.status !== "Open Lead") { keep.status = drop.status; keep.salesAssociate = keep.salesAssociate || drop.salesAssociate; }
      seen.set(key, keep);
      continue;
    }
    seen.set(key, acct);
    accounts.push(acct);
  }
  const contacts = [];
  for (const r of contactRows) {
    const name = cell(r["Full Name"]);
    const company = cell(r["Account Company Name"]);
    if (!name || !company) continue;
    if (cell(r["Active"]).toLowerCase() === "no") continue;
    contacts.push({
      companyKey: companyKey(company),
      fullName: name,
      role: cell(r["Contact Role / Title"]),
      phone: normPhone(r["Phone"]),
      email: cell(r["Email"]).toLowerCase(),
      isPrimary: cell(r["Primary Contact"]).toLowerCase() === "yes",
      notes: cell(r["Notes"])
    });
  }
  return { accounts: [...seen.values()], contacts, sheetCount: workbook.SheetNames.length };
}

// Upsert by company key. Existing accounts keep what the team has done in
// Agility (status, associate, notes, links); only blank fields fill in.
export async function importProspectWorkbook(buffer, { byEmail = "", byName = "" } = {}) {
  const parsed = parseProspectWorkbook(buffer);
  const pool = await getReadyPool();
  const client = await pool.connect();
  let inserted = 0, updated = 0, contactsAdded = 0, contactsNoCompany = 0;
  try {
    await client.query("BEGIN");
    const existing = new Map((await client.query(`SELECT id, company_key FROM builder_accounts`)).rows.map((r) => [r.company_key, r.id]));
    for (const a of parsed.accounts) {
      const id = existing.get(a.companyKey);
      if (id) {
        await client.query(
          `UPDATE builder_accounts SET
             trade_type = CASE WHEN trade_type = '' THEN $2 ELSE trade_type END,
             primary_contact = CASE WHEN primary_contact = '' THEN $3 ELSE primary_contact END,
             phone = CASE WHEN phone = '' THEN $4 ELSE phone END,
             email = CASE WHEN email = '' THEN $5 ELSE email END,
             website = CASE WHEN website = '' THEN $6 ELSE website END,
             address1 = CASE WHEN address1 = '' THEN $7 ELSE address1 END,
             city = CASE WHEN city = '' THEN $8 ELSE city END,
             zip = CASE WHEN zip = '' THEN $9 ELSE zip END,
             updated_at = NOW()
           WHERE id = $1`,
          [id, a.tradeType, a.primaryContact, a.phone, a.email, a.website, a.address1, a.city, a.zip]
        );
        updated++;
        continue;
      }
      const newId = crypto.randomUUID();
      await client.query(
        `INSERT INTO builder_accounts (id, company_name, company_key, trade_type, status, strength, sales_associate, source, priority,
           primary_contact, phone, email, website, address1, city, state, zip, last_contacted_on, next_action, next_action_on, notes, manager_notes,
           assigned_at, assigned_by, baseline_associate, baseline_status, source_row, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
        [newId, a.companyName, a.companyKey, a.tradeType, a.status, a.strength, a.salesAssociate, a.source, a.priority,
          a.primaryContact, a.phone, a.email, a.website, a.address1, a.city, a.state, a.zip, a.lastContactedOn, a.nextAction, a.nextActionOn, a.notes, a.managerNotes,
          a.assignedAt, a.assignedBy, a.baselineAssociate, a.baselineStatus, a.sourceRow, byEmail || "import"]
      );
      existing.set(a.companyKey, newId);
      inserted++;
    }
    // contacts: add when the account exists and no contact with that name is on it yet
    const have = new Set((await client.query(`SELECT account_id, LOWER(full_name) AS n FROM builder_contacts`)).rows.map((r) => `${r.account_id}|${r.n}`));
    for (const c of parsed.contacts) {
      const accountId = existing.get(c.companyKey);
      if (!accountId) { contactsNoCompany++; continue; }
      const k = `${accountId}|${c.fullName.toLowerCase()}`;
      if (have.has(k)) continue;
      have.add(k);
      await client.query(
        `INSERT INTO builder_contacts (id, account_id, full_name, role, phone, email, is_primary, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [crypto.randomUUID(), accountId, c.fullName, c.role, c.phone, c.email, c.isPrimary, c.notes]
      );
      contactsAdded++;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { parsedAccounts: parsed.accounts.length, parsedContacts: parsed.contacts.length, inserted, updated, contactsAdded, unmatchedContacts: contactsNoCompany };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
const ACCOUNT_SELECT = `
  SELECT a.*,
         (SELECT COUNT(*) FROM builder_contacts c WHERE c.account_id = a.id AND c.active) AS contact_count,
         (SELECT COUNT(*) FROM builder_activities x WHERE x.account_id = a.id) AS activity_count,
         (SELECT MAX(activity_on) FROM builder_activities x WHERE x.account_id = a.id) AS last_activity_on
    FROM builder_accounts a`;

export async function listBuilderAccounts({ associate = "", status = "", unassigned = false, search = "", includeInactive = false } = {}) {
  const pool = await getReadyPool();
  const where = [], params = [];
  if (!includeInactive) where.push("a.active");
  if (associate) { params.push(associate); where.push(`a.sales_associate = $${params.length}`); }
  if (unassigned) where.push(`a.sales_associate = ''`);
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); }
  if (search) { params.push(`%${companyKey(search)}%`); where.push(`(a.company_key LIKE $${params.length} OR UPPER(a.primary_contact) LIKE $${params.length} OR UPPER(a.city) LIKE $${params.length})`); }
  const result = await pool.query(`${ACCOUNT_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.company_name LIMIT 3000`, params);
  return result.rows.map(mapAccount);
}

export async function getBuilderAccount(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE a.id = $1`, [id]);
  return result.rows[0] ? mapAccount(result.rows[0]) : null;
}

export async function listAssociates() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT DISTINCT sales_associate FROM builder_accounts WHERE sales_associate <> '' ORDER BY 1`);
  const names = new Set([...ASSOCIATES, ...r.rows.map((x) => x.sales_associate)]);
  return [...names];
}

const EDITABLE = {
  companyName: "company_name", tradeType: "trade_type", status: "status", strength: "strength", source: "source", priority: "priority",
  primaryContact: "primary_contact", phone: "phone", email: "email", website: "website", address1: "address1", city: "city", state: "state", zip: "zip",
  lastContactedOn: "last_contacted_on", nextAction: "next_action", nextActionOn: "next_action_on", notes: "notes", managerNotes: "manager_notes", active: "active"
};
const DATE_FIELDS = new Set(["lastContactedOn", "nextActionOn"]);

export async function updateBuilderAccount(id, patch, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const current = await getBuilderAccount(id);
  if (!current) return null;
  const sets = [], params = [id];
  for (const [k, col] of Object.entries(EDITABLE)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === "active") v = !!v;
    else if (DATE_FIELDS.has(k)) v = isoDate(v);
    else if (k === "status") v = pick(ACCOUNT_STATUSES, v, "Open Lead");
    else if (k === "strength") v = pick(STRENGTHS, v, "New");
    else if (k === "priority") v = pick(PRIORITIES, v, "Medium");
    else if (k === "tradeType") v = pick(TRADE_TYPES, v, "Other Trade Partner");
    else if (k === "phone") v = normPhone(v);
    else v = String(v ?? "").trim().slice(0, k === "notes" || k === "managerNotes" ? 8000 : 300);
    if (k === "companyName" && !v) continue;
    params.push(v); sets.push(`${col} = $${params.length}`);
    if (k === "companyName") { params.push(companyKey(v)); sets.push(`company_key = $${params.length}`); }
    if (k === "status" && v !== current.status) sets.push(`status_changed_at = NOW()`);
  }
  if (!sets.length) return current;
  params.push(byEmail.slice(0, 200)); sets.push(`updated_by = $${params.length}`);
  sets.push(`updated_at = NOW()`);
  await pool.query(`UPDATE builder_accounts SET ${sets.join(", ")} WHERE id = $1`, params);
  return getBuilderAccount(id);
}

export async function assignBuilderAccount(id, associate, { byEmail = "", byName = "" } = {}) {
  const pool = await getReadyPool();
  const name = String(associate || "").trim().slice(0, 120);
  const r = await pool.query(
    `UPDATE builder_accounts
        SET sales_associate = $2,
            assigned_at = CASE WHEN $2 = '' THEN NULL ELSE NOW() END,
            assigned_by = $3,
            baseline_status = CASE WHEN $2 = '' THEN baseline_status ELSE status END,
            baseline_associate = CASE WHEN $2 = '' THEN baseline_associate ELSE $2 END,
            updated_at = NOW(), updated_by = $4
      WHERE id = $1 RETURNING id`,
    [id, name, (byName || byEmail).slice(0, 120), byEmail.slice(0, 200)]
  );
  return r.rows[0] ? getBuilderAccount(id) : null;
}

export async function createBuilderAccount(fields, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const name = String(fields.companyName || "").trim().slice(0, 200);
  if (!name) throw new Error("Company name is required.");
  const key = companyKey(name);
  const dup = await pool.query(`SELECT id, company_name FROM builder_accounts WHERE company_key = $1`, [key]);
  if (dup.rows[0]) { const e = new Error(`${dup.rows[0].company_name} is already on the list.`); e.code = "DUPLICATE"; e.accountId = dup.rows[0].id; throw e; }
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO builder_accounts (id, company_name, company_key, trade_type, status, strength, sales_associate, source, priority, primary_contact, phone, email, website, address1, city, state, zip, next_action, next_action_on, notes, assigned_at, assigned_by, baseline_status, baseline_associate, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, CASE WHEN $7 = '' THEN NULL ELSE NOW() END, $21, $5, $7, $22)`,
    [id, name, key, pick(TRADE_TYPES, fields.tradeType, "Other Trade Partner"), pick(ACCOUNT_STATUSES, fields.status, "Open Lead"), pick(STRENGTHS, fields.strength, "New"),
      String(fields.salesAssociate || "").trim().slice(0, 120), pick(SOURCES, fields.source, "Manual Staff Add"), pick(PRIORITIES, fields.priority, "Medium"),
      String(fields.primaryContact || "").trim().slice(0, 200), normPhone(fields.phone), String(fields.email || "").trim().toLowerCase().slice(0, 200), String(fields.website || "").trim().slice(0, 300),
      String(fields.address1 || "").trim().slice(0, 300), String(fields.city || "").trim().slice(0, 100), String(fields.state || "TX").trim().slice(0, 10), String(fields.zip || "").trim().slice(0, 12),
      String(fields.nextAction || "First outreach").trim().slice(0, 300), isoDate(fields.nextActionOn), String(fields.notes || "").trim().slice(0, 8000), byEmail.slice(0, 200), byEmail.slice(0, 200)]
  );
  return getBuilderAccount(id);
}

// ---------------------------------------------------------------------------
// Contacts + activities
// ---------------------------------------------------------------------------
export async function listContacts(accountId) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM builder_contacts WHERE account_id = $1 AND active ORDER BY is_primary DESC, full_name`, [accountId]);
  return r.rows.map(mapContact);
}
export async function addContact(accountId, c) {
  const pool = await getReadyPool();
  const name = String(c.fullName || "").trim().slice(0, 160);
  if (!name) throw new Error("Contact name is required.");
  const id = crypto.randomUUID();
  if (c.isPrimary) await pool.query(`UPDATE builder_contacts SET is_primary = FALSE WHERE account_id = $1`, [accountId]);
  await pool.query(
    `INSERT INTO builder_contacts (id, account_id, full_name, role, phone, email, is_primary, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, accountId, name, String(c.role || "").trim().slice(0, 120), normPhone(c.phone), String(c.email || "").trim().toLowerCase().slice(0, 200), !!c.isPrimary, String(c.notes || "").trim().slice(0, 2000)]
  );
  if (c.isPrimary) await pool.query(`UPDATE builder_accounts SET primary_contact = $2, phone = CASE WHEN phone = '' THEN $3 ELSE phone END, email = CASE WHEN email = '' THEN $4 ELSE email END WHERE id = $1`, [accountId, name, normPhone(c.phone), String(c.email || "").trim().toLowerCase()]);
  return (await pool.query(`SELECT * FROM builder_contacts WHERE id = $1`, [id])).rows.map(mapContact)[0];
}
export async function removeContact(accountId, contactId) {
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE builder_contacts SET active = FALSE WHERE id = $1 AND account_id = $2 RETURNING id`, [contactId, accountId]);
  return !!r.rows[0];
}

export async function listActivities(accountId, limit = 100) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM builder_activities WHERE account_id = $1 ORDER BY activity_on DESC, created_at DESC LIMIT $2`, [accountId, limit]);
  return r.rows.map(mapActivity);
}

// Logging an activity also moves the account: last contacted, next action
// and (optionally) status — the same thing the workbook asked reps to do by
// hand in two places.
export async function logActivity(accountId, a, { byEmail = "", byName = "" } = {}) {
  const pool = await getReadyPool();
  const activityOn = isoDate(a.activityOn) || new Date().toISOString().slice(0, 10);
  const type = pick(ACTIVITY_TYPES, a.activityType, "Note");
  const outcome = pick(OUTCOMES, a.outcome, "");
  const newStatus = a.newStatus ? pick(ACCOUNT_STATUSES, a.newStatus, "") : "";
  const nextAction = String(a.nextAction || "").trim().slice(0, 300);
  const nextActionOn = isoDate(a.nextActionOn);
  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO builder_activities (id, account_id, activity_on, contact_name, activity_type, outcome, owner_email, owner_name, new_status, next_action, next_action_on, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, accountId, activityOn, String(a.contactName || "").trim().slice(0, 160), type, outcome, byEmail.slice(0, 200), byName.slice(0, 120), newStatus, nextAction, nextActionOn, String(a.notes || "").trim().slice(0, 4000)]
    );
    const touchesContact = type !== "Note";
    await client.query(
      `UPDATE builder_accounts SET
         last_contacted_on = CASE WHEN $2 THEN GREATEST(COALESCE(last_contacted_on, $3::date), $3::date) ELSE last_contacted_on END,
         next_action = CASE WHEN $4 <> '' THEN $4 ELSE next_action END,
         next_action_on = CASE WHEN $4 <> '' THEN $5::date ELSE next_action_on END,
         status_changed_at = CASE WHEN $6 <> '' AND $6 <> status THEN NOW() ELSE status_changed_at END,
         status = CASE WHEN $6 <> '' THEN $6 ELSE status END,
         updated_at = NOW(), updated_by = $7
       WHERE id = $1`,
      [accountId, touchesContact, activityOn, nextAction, nextActionOn, newStatus, byEmail.slice(0, 200)]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { client.release(); }
  return (await pool.query(`SELECT * FROM builder_activities WHERE id = $1`, [id])).rows.map(mapActivity)[0];
}

// Manager view: what's been logged lately, across everyone.
export async function listRecentActivities({ since = null, ownerEmail = "", limit = 300 } = {}) {
  const pool = await getReadyPool();
  const where = [], params = [];
  if (since) { params.push(since); where.push(`x.activity_on >= $${params.length}`); }
  if (ownerEmail) { params.push(ownerEmail); where.push(`x.owner_email = $${params.length}`); }
  params.push(limit);
  const r = await pool.query(
    `SELECT x.*, a.company_name FROM builder_activities x JOIN builder_accounts a ON a.id = x.account_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY x.activity_on DESC, x.created_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows.map(mapActivity);
}

// ---------------------------------------------------------------------------
// ePASS tie-in
// ---------------------------------------------------------------------------
// Every ePASS customer Agility has seen — finished tickets, open orders,
// open quotes — with how much business is behind each. One query per
// source; the result is small (distinct customers), so the matcher and the
// search both work off it.
export async function listEpassCustomers() {
  const pool = await getReadyPool();
  const r = await pool.query(`
    SELECT customer_number, MAX(customer_name) AS customer_name, COUNT(*)::int AS tickets, SUM(revenue)::numeric(14,2) AS revenue, MAX(finish_date) AS last_finish
      FROM sales_order_detail WHERE customer_number <> '' GROUP BY customer_number
    UNION ALL
    SELECT customer_number, MAX(customer_name), 0, 0, '' FROM open_sales_orders WHERE customer_number <> '' GROUP BY customer_number
    UNION ALL
    SELECT customer_number, MAX(customer_name), 0, 0, '' FROM quote_followup_quotes WHERE customer_number <> '' GROUP BY customer_number`);
  const byNum = new Map();
  for (const row of r.rows) {
    const cur = byNum.get(row.customer_number) || { customerNumber: row.customer_number, customerName: "", tickets: 0, revenue: 0, lastFinish: "" };
    if (row.customer_name && (!cur.customerName || row.tickets > 0)) cur.customerName = row.customer_name;
    cur.tickets += row.tickets || 0;
    cur.revenue = Math.round((cur.revenue + (Number(row.revenue) || 0)) * 100) / 100;
    if (row.last_finish && row.last_finish > cur.lastFinish) cur.lastFinish = row.last_finish;
    byNum.set(row.customer_number, cur);
  }
  return [...byNum.values()];
}

// Name similarity: exact key match = 1; otherwise token containment of the
// shorter name in the longer (noise words dropped). "KIRBY WALLS CUSTOM
// HOMES" vs "KIRBY WALLS HOMES LLC" → 3/3 → 1.0. Needs ≥ 2 shared tokens
// (or one distinctive token ≥ 5 chars) to count.
export function nameSimilarity(a, b) {
  const ka = companyKey(a), kb = companyKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ta = tokensOf(a), tb = tokensOf(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  const shared = short.filter((t) => longSet.has(t));
  if (!shared.length) return 0;
  if (shared.length === 1 && (shared[0].length < 5 || /^\d+$/.test(shared[0]))) return 0;
  return shared.length / short.length;
}

// Propose ePASS links for every unlinked account. Stores up to 3 candidates
// (score ≥ 0.67) on the account; nothing is linked until a person confirms.
export async function suggestEpassMatches() {
  const pool = await getReadyPool();
  const customers = await listEpassCustomers();
  const accounts = (await pool.query(`SELECT id, company_name FROM builder_accounts WHERE active AND jsonb_array_length(epass_customers) = 0`)).rows;
  let withSuggestions = 0, exact = 0;
  for (const a of accounts) {
    const scored = [];
    for (const c of customers) {
      const s = nameSimilarity(a.company_name, c.customerName);
      if (s >= 0.67) scored.push({ ...c, score: Math.round(s * 100) / 100 });
    }
    scored.sort((x, y) => y.score - x.score || y.tickets - x.tickets);
    const top = scored.slice(0, 3);
    if (top.length) { withSuggestions++; if (top[0].score === 1) exact++; }
    await pool.query(`UPDATE builder_accounts SET epass_suggestions = $2::jsonb WHERE id = $1`, [a.id, JSON.stringify(top)]);
  }
  return { accountsChecked: accounts.length, withSuggestions, exact, epassCustomers: customers.length };
}

export async function searchEpassCustomers(q) {
  const key = companyKey(q);
  if (!key) return [];
  const all = await listEpassCustomers();
  const digits = String(q).replace(/\D/g, "");
  return all
    .filter((c) => companyKey(c.customerName).includes(key) || (digits.length >= 4 && c.customerNumber.includes(digits)))
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 25);
}

export async function linkEpassCustomer(accountId, { customerNumber, customerName }, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const num = String(customerNumber || "").trim();
  if (!num) throw new Error("Customer number is required.");
  const acct = await getBuilderAccount(accountId);
  if (!acct) return null;
  const list = acct.epassCustomers.filter((c) => c.customerNumber !== num);
  list.push({ customerNumber: num, customerName: String(customerName || "").slice(0, 200), linkedBy: byEmail, linkedAt: new Date().toISOString() });
  await pool.query(`UPDATE builder_accounts SET epass_customers = $2::jsonb, epass_suggestions = '[]'::jsonb, updated_at = NOW(), updated_by = $3 WHERE id = $1`, [accountId, JSON.stringify(list), byEmail.slice(0, 200)]);
  return getBuilderAccount(accountId);
}
export async function unlinkEpassCustomer(accountId, customerNumber, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const acct = await getBuilderAccount(accountId);
  if (!acct) return null;
  const list = acct.epassCustomers.filter((c) => c.customerNumber !== String(customerNumber));
  await pool.query(`UPDATE builder_accounts SET epass_customers = $2::jsonb, updated_at = NOW(), updated_by = $3 WHERE id = $1`, [accountId, JSON.stringify(list), byEmail.slice(0, 200)]);
  return getBuilderAccount(accountId);
}
export async function dismissEpassSuggestions(accountId) {
  const pool = await getReadyPool();
  await pool.query(`UPDATE builder_accounts SET epass_suggestions = '[]'::jsonb WHERE id = $1`, [accountId]);
}

// Per-account ticket stats for the list: one grouped query over every
// linked customer number, then folded onto accounts.
export async function epassStatsForAccounts(accounts, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const numbers = [...new Set(accounts.flatMap((a) => (a.epassCustomers || []).map((c) => c.customerNumber)).filter(Boolean))];
  if (!numbers.length) return {};
  const pool = await getReadyPool();
  const twelve = new Date(`${today}T12:00:00Z`); twelve.setUTCFullYear(twelve.getUTCFullYear() - 1);
  const since = twelve.toISOString().slice(0, 10);
  const [fin, open, quotes] = await Promise.all([
    pool.query(
      `SELECT customer_number, COUNT(*)::int AS tickets, SUM(revenue)::numeric(14,2) AS revenue,
              SUM(CASE WHEN finish_date >= $2 THEN revenue ELSE 0 END)::numeric(14,2) AS revenue_12m,
              COUNT(*) FILTER (WHERE finish_date >= $2)::int AS tickets_12m,
              MAX(finish_date) AS last_finish
         FROM sales_order_detail WHERE customer_number = ANY($1) GROUP BY customer_number`,
      [numbers, since]
    ),
    pool.query(`SELECT customer_number, COUNT(*)::int AS n, SUM(invoice_total)::numeric(14,2) AS total FROM open_sales_orders WHERE customer_number = ANY($1) GROUP BY customer_number`, [numbers]),
    pool.query(`SELECT customer_number, COUNT(*)::int AS n, SUM(total)::numeric(14,2) AS total FROM quote_followup_quotes WHERE is_open AND customer_number = ANY($1) GROUP BY customer_number`, [numbers])
  ]);
  const byNum = {};
  for (const r of fin.rows) byNum[r.customer_number] = { tickets: r.tickets, revenue: Number(r.revenue) || 0, revenue12m: Number(r.revenue_12m) || 0, tickets12m: r.tickets_12m, lastFinish: r.last_finish || "" };
  for (const r of open.rows) { const s = byNum[r.customer_number] || (byNum[r.customer_number] = { tickets: 0, revenue: 0, revenue12m: 0, tickets12m: 0, lastFinish: "" }); s.openOrders = r.n; s.openTotal = Number(r.total) || 0; }
  for (const r of quotes.rows) { const s = byNum[r.customer_number] || (byNum[r.customer_number] = { tickets: 0, revenue: 0, revenue12m: 0, tickets12m: 0, lastFinish: "" }); s.openQuotes = r.n; s.quoteTotal = Number(r.total) || 0; }
  const out = {};
  for (const a of accounts) {
    const nums = (a.epassCustomers || []).map((c) => c.customerNumber);
    if (!nums.length) continue;
    const s = { tickets: 0, revenue: 0, revenue12m: 0, tickets12m: 0, lastFinish: "", openOrders: 0, openTotal: 0, openQuotes: 0, quoteTotal: 0 };
    for (const n of nums) {
      const x = byNum[n]; if (!x) continue;
      s.tickets += x.tickets; s.revenue += x.revenue; s.revenue12m += x.revenue12m; s.tickets12m += x.tickets12m;
      if (x.lastFinish > s.lastFinish) s.lastFinish = x.lastFinish;
      s.openOrders += x.openOrders || 0; s.openTotal += x.openTotal || 0; s.openQuotes += x.openQuotes || 0; s.quoteTotal += x.quoteTotal || 0;
    }
    for (const k of ["revenue", "revenue12m", "openTotal", "quoteTotal"]) s[k] = Math.round(s[k] * 100) / 100;
    out[a.id] = s;
  }
  return out;
}

// The account page's ePASS panel: finished tickets (newest first), open
// orders, open quotes for its linked customer numbers.
export async function epassHistoryForAccount(account, { limit = 60 } = {}) {
  const numbers = (account?.epassCustomers || []).map((c) => c.customerNumber).filter(Boolean);
  if (!numbers.length) return { tickets: [], openOrders: [], openQuotes: [] };
  const pool = await getReadyPool();
  const [t, o, q] = await Promise.all([
    pool.query(`SELECT invoice, department, salesperson, finish_date, customer_number, customer_name, reference, revenue, invoice_total FROM sales_order_detail WHERE customer_number = ANY($1) ORDER BY finish_date DESC LIMIT $2`, [numbers, limit]),
    pool.query(`SELECT invoice, salesperson, customer_name, customer_number, start_date, invoice_total, department FROM open_sales_orders WHERE customer_number = ANY($1) ORDER BY start_date DESC LIMIT 40`, [numbers]),
    pool.query(`SELECT quote_number, sp_code, date_created, total, balance, customer_name, customer_number, job_status, reference FROM quote_followup_quotes WHERE is_open AND customer_number = ANY($1) ORDER BY date_created DESC LIMIT 40`, [numbers])
  ]);
  return {
    tickets: t.rows.map((r) => ({ invoice: r.invoice, department: r.department, salesperson: r.salesperson, finishDate: r.finish_date, customerNumber: r.customer_number, customerName: r.customer_name, reference: r.reference, revenue: Number(r.revenue) || 0, invoiceTotal: Number(r.invoice_total) || 0 })),
    openOrders: o.rows.map((r) => ({ invoice: r.invoice, salesperson: r.salesperson, customerName: r.customer_name, customerNumber: r.customer_number, startDate: r.start_date, total: Number(r.invoice_total) || 0, department: r.department })),
    openQuotes: q.rows.map((r) => ({ quoteNumber: r.quote_number, spCode: r.sp_code, dateCreated: r.date_created, total: Number(r.total) || 0, balance: Number(r.balance) || 0, customerName: r.customer_name, customerNumber: r.customer_number, jobStatus: r.job_status, reference: r.reference }))
  };
}

// ---------------------------------------------------------------------------
// Manager dashboard: the workbook's Dashboard + Manager Activity Review.
// ---------------------------------------------------------------------------
export async function builderDashboard({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const pool = await getReadyPool();
  const [byStatus, byAssoc, flags, recent] = await Promise.all([
    pool.query(`SELECT status, COUNT(*)::int AS n FROM builder_accounts WHERE active GROUP BY status`),
    pool.query(`SELECT sales_associate, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ('Active Relationship','Active Pricing','Current Job'))::int AS active_n,
                       COUNT(*) FILTER (WHERE next_action_on IS NOT NULL AND next_action_on < $1)::int AS overdue,
                       COUNT(*) FILTER (WHERE COALESCE(last_contacted_on, created_at::date) < ($1::date - 30))::int AS stale
                  FROM builder_accounts WHERE active AND sales_associate <> '' GROUP BY sales_associate ORDER BY sales_associate`, [today]),
    pool.query(`SELECT id, company_name, sales_associate, status, baseline_status, assigned_at, status_changed_at, last_contacted_on, next_action, next_action_on, created_at
                  FROM builder_accounts WHERE active AND sales_associate <> '' AND (
                    (next_action_on IS NOT NULL AND next_action_on < $1)
                    OR (assigned_at IS NOT NULL AND assigned_at < NOW() - INTERVAL '7 days' AND status = baseline_status AND (status_changed_at IS NULL OR status_changed_at < assigned_at) AND (last_contacted_on IS NULL OR last_contacted_on < assigned_at::date))
                    OR (status IN ('Active Relationship','Active Pricing','Current Job') AND COALESCE(last_contacted_on, created_at::date) < ($1::date - 45))
                  ) ORDER BY sales_associate, next_action_on NULLS LAST, company_name LIMIT 500`, [today]),
    pool.query(`SELECT owner_name, owner_email, COUNT(*)::int AS n, MAX(activity_on) AS last_on FROM builder_activities WHERE activity_on >= ($1::date - 30) GROUP BY owner_name, owner_email ORDER BY n DESC`, [today])
  ]);
  const statusCounts = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n]));
  return {
    totals: {
      accounts: byStatus.rows.reduce((s, r) => s + r.n, 0),
      openLeads: statusCounts["Open Lead"] || 0,
      chasing: statusCounts["Chasing"] || 0,
      activeRelationships: statusCounts["Active Relationship"] || 0,
      activePricing: statusCounts["Active Pricing"] || 0,
      currentJobs: statusCounts["Current Job"] || 0,
      dormant: statusCounts["Dormant"] || 0,
      unassigned: (await pool.query(`SELECT COUNT(*)::int AS n FROM builder_accounts WHERE active AND sales_associate = ''`)).rows[0].n
    },
    statusCounts,
    byAssociate: byAssoc.rows.map((r) => ({ associate: r.sales_associate, accounts: r.n, active: r.active_n, overdue: r.overdue, stale: r.stale })),
    flags: flags.rows.map((r) => {
      const reasons = [];
      const na = dateOut(r.next_action_on);
      if (na && na < today) reasons.push(`Next action overdue (${na})`);
      const assignedAt = r.assigned_at ? r.assigned_at.toISOString() : null;
      const lc = dateOut(r.last_contacted_on);
      if (assignedAt && new Date(assignedAt) < new Date(Date.now() - 7 * 86400000) && r.status === r.baseline_status && (!r.status_changed_at || r.status_changed_at < r.assigned_at) && (!lc || lc < assignedAt.slice(0, 10))) reasons.push("No activity since assignment (7+ days)");
      const cutoff45 = new Date(new Date(`${today}T12:00:00Z`).getTime() - 45 * 86400000).toISOString().slice(0, 10);
      const lastTouch = lc || (r.created_at ? r.created_at.toISOString().slice(0, 10) : "");
      if (["Active Relationship", "Active Pricing", "Current Job"].includes(r.status) && lastTouch && lastTouch < cutoff45) reasons.push(lc ? "Active account, no contact in 45+ days" : "Active account, no contact logged since import (45+ days)");
      return { id: r.id, companyName: r.company_name, salesAssociate: r.sales_associate, status: r.status, baselineStatus: r.baseline_status, assignedAt, lastContactedOn: lc, nextAction: r.next_action, nextActionOn: na, reasons };
    }),
    activity30d: recent.rows.map((r) => ({ ownerName: r.owner_name, ownerEmail: r.owner_email, count: r.n, lastOn: dateOut(r.last_on) }))
  };
}

export async function countBuilderAccounts() {
  const pool = await getReadyPool();
  return (await pool.query(`SELECT COUNT(*)::int AS n FROM builder_accounts`)).rows[0].n;
}
