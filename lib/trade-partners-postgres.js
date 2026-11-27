// ---------------------------------------------------------------------------
// Trade Partner registrations (Andrew 11/27: the rebate flyer "would be in the
// Agility user side as a builder sales tool with a public registration
// process and approval process on our side").
//
// A builder is sent the registration link, fills in the form at
// /trade-partner, and lands here as "new". Someone at Wilson reviews it on
// the Trade Partners page and an executive approves or declines it. Nothing
// is sent to the builder by this code at any step: the team contacts them.
//
// What is kept: the company, who to reach and how, where they are, a few
// optional sizing answers, the terms they agreed to, and what Wilson decided.
// What is never asked for: a tax ID, a Social Security number, a driver's
// licence, bank details or a card.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
import { TRADE_BUSINESS_TYPES, TRADE_PROJECT_RANGES, tradeEstimateRanges } from "./trade-program.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trade_partner_registrations (
  id BIGSERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  program_year INTEGER NOT NULL,
  company TEXT NOT NULL,
  company_key TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  contact_pref TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  years_in_business TEXT NOT NULL DEFAULT '',
  projects_per_year TEXT NOT NULL DEFAULT '',
  annual_estimate TEXT NOT NULL DEFAULT '',
  buys_now TEXT NOT NULL DEFAULT '',
  consultant TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  agreed_terms TEXT NOT NULL DEFAULT '',
  rep_email TEXT NOT NULL DEFAULT '',
  rep_name TEXT NOT NULL DEFAULT '',
  duplicate_of BIGINT,
  status TEXT NOT NULL DEFAULT 'new',
  decided_at TIMESTAMPTZ,
  decided_by_email TEXT NOT NULL DEFAULT '',
  decided_by_name TEXT NOT NULL DEFAULT '',
  decline_reason TEXT NOT NULL DEFAULT '',
  epass_code TEXT NOT NULL DEFAULT '',
  epass_name TEXT NOT NULL DEFAULT '',
  log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trade_partner_reg_status_idx ON trade_partner_registrations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS trade_partner_reg_email_idx ON trade_partner_registrations (email);
CREATE INDEX IF NOT EXISTS trade_partner_reg_company_idx ON trade_partner_registrations (company_key);
`;

let schemaDone = null;
async function tradePool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!schemaDone) schemaDone = pool.query(SCHEMA_SQL).catch((e) => { schemaDone = null; throw e; });
  await schemaDone;
  return pool;
}

export const TRADE_STATUSES = ["new", "approved", "declined"];
export const TRADE_CONTACT_PREFS = ["call", "text", "email"];
export const TRADE_BUYS_NOW = [["account", "Yes, on a Wilson account"], ["no_account", "Yes, without an account"], ["not_yet", "Not yet"]];
export const TRADE_NOTE_MAX = 500;
const LOG_MAX = 80;

const one = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
// Names and short answers: one line, and no angle brackets (they end up in notification titles).
const plain = (v, n) => one(String(v ?? "").replace(/[<>]/g, " "), n);
// Free text: line breaks kept, other control characters dropped.
const multi = (v, n) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);

// "Hill Country Homes, LLC" and "hill country homes" are the same company.
export function tradeCompanyKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|l l c|inc|incorporated|ltd|lp|llp|co|corp|corporation|company)\b/g, " ").replace(/\s+/g, "");
}

function fieldError(field, message) { return Object.assign(new Error(message), { field, userFacing: true }); }

// The form as the builder sent it -> what is stored. Throws an error with
// .field (which box) and a message fit to show under it.
export function cleanTradeRegistration(body, program) {
  const b = body && typeof body === "object" ? body : {};
  const company = plain(b.company, 120);
  if (company.length < 2) throw fieldError("company", "Please enter your company's name.");
  const businessType = TRADE_BUSINESS_TYPES.some(([k]) => k === b.businessType) ? b.businessType : "";
  if (!businessType) throw fieldError("businessType", "Please choose the kind of business.");
  const firstName = plain(b.firstName, 60), lastName = plain(b.lastName, 60);
  if (!firstName) throw fieldError("firstName", "Please enter your first name.");
  if (!lastName) throw fieldError("lastName", "Please enter your last name.");
  const email = one(b.email, 160).toLowerCase();
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]{2,}$/.test(email)) throw fieldError("email", "Please enter a valid email address.");
  let digits = String(b.phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) throw fieldError("phone", "Please enter a 10-digit phone number.");
  const city = plain(b.city, 80);
  if (!city) throw fieldError("city", "Please enter your city.");
  const state = String(b.state ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw fieldError("state", "Please enter your state as two letters (TX).");
  const zip = String(b.zip ?? "").trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) throw fieldError("zip", "Please enter your 5-digit ZIP code.");
  const yearsRaw = String(b.yearsInBusiness ?? "").trim();
  let years = "";
  if (yearsRaw) {
    const n = Number(yearsRaw);
    if (!Number.isInteger(n) || n < 0 || n > 200) throw fieldError("yearsInBusiness", "Years in business should be a whole number.");
    years = String(n);
  }
  if (b.agree !== true && b.agree !== "true" && b.agree !== "on") throw fieldError("agree", "Please confirm you agree to the program terms.");
  return {
    programYear: program.year,
    company, companyKey: tradeCompanyKey(company), businessType,
    firstName, lastName, title: plain(b.title, 80),
    email, phone: digits,
    contactPref: TRADE_CONTACT_PREFS.includes(b.contactPref) ? b.contactPref : "",
    street: plain(b.street, 160), city, state, zip,
    website: plain(b.website, 120).replace(/\s+/g, ""),
    yearsInBusiness: years,
    projectsPerYear: TRADE_PROJECT_RANGES.includes(b.projectsPerYear) ? b.projectsPerYear : "",
    annualEstimate: tradeEstimateRanges(program).includes(b.annualEstimate) ? b.annualEstimate : "",
    buysNow: TRADE_BUYS_NOW.some(([k]) => k === b.buysNow) ? b.buysNow : "",
    consultant: plain(b.consultant, 80),
    notes: multi(b.notes, 600),
    agreedTerms: `${program.name} ${program.year}\n\n${program.terms.join("\n\n")}`
  };
}

const typeLabel = (key) => (TRADE_BUSINESS_TYPES.find(([k]) => k === key) || [])[1] || "";
const buysLabel = (key) => (TRADE_BUYS_NOW.find(([k]) => k === key) || [])[1] || "";
const iso = (d) => d?.toISOString?.() || null;

const mapRow = (r) => ({
  id: Number(r.id), ref: r.ref, programYear: Number(r.program_year),
  company: r.company, businessType: r.business_type, businessTypeLabel: typeLabel(r.business_type),
  firstName: r.first_name, lastName: r.last_name, title: r.title,
  email: r.email, phone: r.phone, contactPref: r.contact_pref,
  street: r.street, city: r.city, state: r.state, zip: r.zip, website: r.website,
  yearsInBusiness: r.years_in_business, projectsPerYear: r.projects_per_year, annualEstimate: r.annual_estimate,
  buysNow: r.buys_now, buysNowLabel: buysLabel(r.buys_now), consultant: r.consultant, notes: r.notes,
  repEmail: r.rep_email, repName: r.rep_name,
  duplicateOf: r.duplicate_of == null ? null : Number(r.duplicate_of),
  status: r.status, decidedAt: iso(r.decided_at), decidedByEmail: r.decided_by_email, decidedByName: r.decided_by_name,
  declineReason: r.decline_reason, epassCode: r.epass_code, epassName: r.epass_name,
  log: Array.isArray(r.log) ? r.log : [],
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at)
});

// A reference the builder sees on the thank-you screen and can read over the
// phone: TP- and six characters, none of which look like another (no 0/O, 1/I/L).
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newRef() {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `TP-${out}`;
}

// File a registration. A second tap on Send (same person, same company,
// within ten minutes) gets the first one back as { repeat: true } and nothing
// new is stored. An earlier registration from the same company or the same
// email this program year is noted as a possible duplicate; both are kept.
export async function createTradeRegistration(data, { rep = null } = {}) {
  const pool = await tradePool();
  const again = await pool.query(
    `SELECT * FROM trade_partner_registrations
      WHERE email = $1 AND company_key = $2 AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC LIMIT 1`, [data.email, data.companyKey]);
  if (again.rows[0]) return { registration: mapRow(again.rows[0]), repeat: true };
  const dup = await pool.query(
    `SELECT id FROM trade_partner_registrations
      WHERE program_year = $1 AND status <> 'declined' AND (email = $2 OR (company_key <> '' AND company_key = $3))
      ORDER BY id ASC LIMIT 1`, [data.programYear, data.email, data.companyKey]);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO trade_partner_registrations
           (ref, program_year, company, company_key, business_type, first_name, last_name, title, email, phone, contact_pref,
            street, city, state, zip, website, years_in_business, projects_per_year, annual_estimate, buys_now, consultant, notes,
            agreed_terms, rep_email, rep_name, duplicate_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING *`,
        [newRef(), data.programYear, data.company, data.companyKey, data.businessType, data.firstName, data.lastName, data.title, data.email, data.phone, data.contactPref,
          data.street, data.city, data.state, data.zip, data.website, data.yearsInBusiness, data.projectsPerYear, data.annualEstimate, data.buysNow, data.consultant, data.notes,
          data.agreedTerms, String(rep?.email || "").toLowerCase().slice(0, 200), String(rep?.name || "").slice(0, 120), dup.rows[0]?.id ?? null]
      );
      return { registration: mapRow(rows[0]), repeat: false };
    } catch (err) {
      if (err?.code === "23505" && /ref/.test(err.constraint || "")) continue; // the one-in-a-billion same reference: draw again
      throw err;
    }
  }
  throw new Error("Unable to file the registration.");
}

export async function getTradeRegistration(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const pool = await tradePool();
  const { rows } = await pool.query(`SELECT * FROM trade_partner_registrations WHERE id = $1`, [n]);
  return rows[0] ? mapRow(rows[0]) : null;
}

// Everything, waiting ones first (oldest waiting at the top), then decided, newest first.
export async function listTradeRegistrations({ limit = 500 } = {}) {
  const pool = await tradePool();
  const { rows } = await pool.query(
    `SELECT * FROM trade_partner_registrations
      ORDER BY (status = 'new') DESC, CASE WHEN status = 'new' THEN created_at END ASC, COALESCE(decided_at, created_at) DESC, id DESC
      LIMIT $1`, [Math.max(1, Math.min(2000, Number(limit) || 500))]);
  return rows.map(mapRow);
}

const who = (by) => ({ byEmail: String(by?.email || "").toLowerCase().slice(0, 200), byName: String(by?.name || "").slice(0, 120) });
const logEntry = (kind, by, text = "") => JSON.stringify([{ at: new Date().toISOString(), kind, ...who(by), text: String(text || "").slice(0, TRADE_NOTE_MAX) }]);
// Append to the log, keeping the most recent LOG_MAX entries.
const LOG_APPEND = `(SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) FROM (SELECT e, ord FROM jsonb_array_elements(log || $2::jsonb) WITH ORDINALITY AS t(e, ord) ORDER BY ord DESC LIMIT ${LOG_MAX}) x)`;

export async function addTradeRegistrationNote(id, text, by) {
  const note = multi(text, TRADE_NOTE_MAX);
  if (!note) throw Object.assign(new Error("Type the note first."), { userFacing: true });
  const pool = await tradePool();
  const { rows } = await pool.query(
    `UPDATE trade_partner_registrations SET log = ${LOG_APPEND}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [Number(id), logEntry("note", by, note)]);
  return rows[0] ? mapRow(rows[0]) : null;
}

// The ePASS account the rebate will be worked out on (the bill-to account).
function cleanAccount({ epassCode, epassName } = {}) {
  const code = String(epassCode ?? "").trim().toUpperCase().slice(0, 30);
  if (code && !/^[A-Z0-9][A-Z0-9 ._\-]*$/.test(code)) throw Object.assign(new Error("That doesn't look like an ePASS account number."), { userFacing: true });
  return { code, name: code ? plain(epassName, 160) : "" };
}

// approve | decline | reopen. Only a change of status is recorded: approving
// an approved registration again is refused, so two people deciding at once
// can't both be logged. Returns the registration, or null when it was
// already in that state or doesn't exist.
export async function decideTradeRegistration(id, { decision, reason = "", epassCode = "", epassName = "" }, by) {
  const pool = await tradePool();
  const w = who(by);
  if (decision === "approve") {
    const acct = cleanAccount({ epassCode, epassName });
    const { rows } = await pool.query(
      `UPDATE trade_partner_registrations
          SET status = 'approved', decided_at = NOW(), decided_by_email = $3, decided_by_name = $4, decline_reason = '',
              epass_code = CASE WHEN $5 <> '' THEN $5 ELSE epass_code END, epass_name = CASE WHEN $5 <> '' THEN $6 ELSE epass_name END,
              log = ${LOG_APPEND}, updated_at = NOW()
        WHERE id = $1 AND status <> 'approved' RETURNING *`,
      [Number(id), logEntry("approved", by, acct.code ? `ePASS account ${acct.code}${acct.name ? " " + acct.name : ""}` : ""), w.byEmail, w.byName, acct.code, acct.name]);
    return rows[0] ? mapRow(rows[0]) : null;
  }
  if (decision === "decline") {
    const why = multi(reason, 300);
    const { rows } = await pool.query(
      `UPDATE trade_partner_registrations
          SET status = 'declined', decided_at = NOW(), decided_by_email = $3, decided_by_name = $4, decline_reason = $5,
              log = ${LOG_APPEND}, updated_at = NOW()
        WHERE id = $1 AND status <> 'declined' RETURNING *`,
      [Number(id), logEntry("declined", by, why), w.byEmail, w.byName, why]);
    return rows[0] ? mapRow(rows[0]) : null;
  }
  if (decision === "reopen") {
    const { rows } = await pool.query(
      `UPDATE trade_partner_registrations
          SET status = 'new', decided_at = NULL, decided_by_email = '', decided_by_name = '', decline_reason = '',
              log = ${LOG_APPEND}, updated_at = NOW()
        WHERE id = $1 AND status <> 'new' RETURNING *`,
      [Number(id), logEntry("reopened", by)]);
    return rows[0] ? mapRow(rows[0]) : null;
  }
  throw Object.assign(new Error("Unknown decision."), { userFacing: true });
}

// Set or clear the ePASS account on a registration (any status).
export async function setTradeRegistrationAccount(id, { epassCode = "", epassName = "" }, by) {
  const acct = cleanAccount({ epassCode, epassName });
  const pool = await tradePool();
  const { rows } = await pool.query(
    `UPDATE trade_partner_registrations SET epass_code = $3, epass_name = $4, log = ${LOG_APPEND}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [Number(id), logEntry("account", by, acct.code ? `ePASS account ${acct.code}${acct.name ? " " + acct.name : ""}` : "ePASS account cleared"), acct.code, acct.name]);
  return rows[0] ? mapRow(rows[0]) : null;
}
