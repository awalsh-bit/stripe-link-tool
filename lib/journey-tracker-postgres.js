import crypto from "crypto";
import { boardInternals } from "./service-journey-postgres.js";

// ---------------------------------------------------------------------------
// CUSTOMER JOURNEY TRACKER (journey.html, public) — Andrew, 2026-09-22 night:
// Cayden's client-facing page where the customer follows the service call
// through each step (blueprint §4 customer stages, 09_Customer_Copy §2).
//
// The token is minted when a request lands on the Service Request Queue
// (and lazily, for anything older, when someone clicks "Copy journey link"
// on the queue card or the board). It points at the request card; once the
// office books the ticket in ePASS (erpOrderNumber = SV…) the same token
// follows the ticket through the mirror (sj_jobs) — nothing to re-send.
// A ticket that never had a request card (walked in, keyed in ePASS) can be
// given a token from the board.
//
// The page reads only what a customer should see: stage, day/window, the
// tech's first name, parts expected date, and their own estimate link when
// one exists. Never the balance owed, notes, or anything about other calls.
// ---------------------------------------------------------------------------

const { getReadyPool, getJobRow } = boardInternals;
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sj_journey_tokens (
  token TEXT PRIMARY KEY,
  card_id TEXT NOT NULL DEFAULT '',
  sv_number TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  views INTEGER NOT NULL DEFAULT 0,
  last_view_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sj_journey_tokens_card ON sj_journey_tokens (card_id);
CREATE INDEX IF NOT EXISTS sj_journey_tokens_sv ON sj_journey_tokens (sv_number);
`;
let ensured = null;
async function pool() { const p = await getReadyPool(); if (!ensured) ensured = p.query(SCHEMA_SQL).catch((e) => { ensured = null; throw e; }); await ensured; return p; }
const dateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");

// One token per request card (or per SV when there is no card). Idempotent.
export async function ensureJourneyToken({ cardId = "", sv = "", by = "" } = {}) {
  const p = await pool();
  const card = String(cardId || "").trim(), svn = String(sv || "").trim().toUpperCase();
  if (!card && !svn) throw new Error("A request card or an SV number is required.");
  let row = card ? (await p.query(`SELECT * FROM sj_journey_tokens WHERE card_id = $1 ORDER BY created_at LIMIT 1`, [card])).rows[0] : null;
  if (!row && svn) row = (await p.query(`SELECT * FROM sj_journey_tokens WHERE sv_number = $1 ORDER BY created_at LIMIT 1`, [svn])).rows[0];
  if (row) {
    // learn the SV (or the card) when it becomes known
    if (svn && row.sv_number !== svn) await p.query(`UPDATE sj_journey_tokens SET sv_number = $2 WHERE token = $1`, [row.token, svn]);
    if (card && !row.card_id) await p.query(`UPDATE sj_journey_tokens SET card_id = $2 WHERE token = $1`, [row.token, card]);
    return { token: row.token, created: false };
  }
  const token = crypto.randomBytes(18).toString("base64url");
  await p.query(`INSERT INTO sj_journey_tokens (token, card_id, sv_number, created_by) VALUES ($1,$2,$3,$4)`, [token, card, svn, String(by || "").slice(0, 120)]);
  return { token, created: true };
}

// blueprint §4 customer stage per status; 09_Customer_Copy §2 stage list
export const STAGES = ["Request received", "Diagnostic scheduled", "Diagnosed", "Estimate ready", "Approved", "Parts ordered", "Part arrived", "Install scheduled", "Repair complete"];
function stageFor(status) {
  const s = String(status || "").toUpperCase();
  if (!s || s === "REQ") return { i: 0, key: "request" };
  if (s === "SO1" || s === "SO1.AUTH") return { i: 1, key: "diag" };
  if (s === "SO2" || s === "SO2.1") return { i: 2, key: "diagnosed" };
  if (s === "SO2.2") return { i: 3, key: "estimate" };
  if (s === "SO3" || s === "SO3PRE") return { i: 4, key: "approved" };
  if (s === "SO4" || s === "SO4B" || s === "SO4H") return { i: 5, key: "parts", variant: s };
  if (s === "SO5") return { i: 6, key: "arrived" };
  if (s === "SO4PRE" || s === "SO6") return { i: 7, key: "install", variant: s };
  if (s === "SO8" || s === "SO8I") return { i: 8, key: "complete" };
  if (s === "SO7") return { i: 8, key: "declined" };
  if (s === "SO9") return { i: 8, key: "cancelled" };
  if (/^SI/.test(s)) return { i: 2, key: "shop" };
  if (/^WAR/.test(s)) return { i: 4, key: "warranty_admin" };
  return { i: 1, key: "diag" };
}

// What the public page gets. `card` is the request-queue row (or null),
// `estimateForSv` resolves the customer's open estimate token if any.
export async function resolveJourney(token, { cardById = null, estimateForSv = null, techName = null } = {}) {
  const p = await pool();
  const t = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
  const row = (await p.query(`SELECT * FROM sj_journey_tokens WHERE token = $1`, [t])).rows[0];
  if (!row) return null;
  await p.query(`UPDATE sj_journey_tokens SET views = views + 1, last_view_at = NOW() WHERE token = $1`, [t]).catch(() => {});
  const card = row.card_id && cardById ? await cardById(row.card_id).catch(() => null) : null;
  let sv = row.sv_number || String(card?.erpOrderNumber || "").trim().toUpperCase();
  if (!/^SV/.test(sv)) sv = "";
  if (sv && sv !== row.sv_number) await p.query(`UPDATE sj_journey_tokens SET sv_number = $2 WHERE token = $1`, [t, sv]).catch(() => {});
  const job = sv ? await getJobRow(p, sv) : null;

  const first = String(card?.customerName || job?.customer_name || "").trim().split(/\s+/)[0] || "";
  const unitFromCard = Array.isArray(card?.units) && card.units[0] ? [card.units[0].brand, card.units[0].applianceType || card.units[0].type || card.units[0].systemType].filter(Boolean).join(" ") : "";
  const unit = (job ? [job.unit_brand, job.unit_category].filter(Boolean).join(" ") : "") || unitFromCard || "your appliance";
  const problem = String(job?.problem_text || card?.problemDescription || "").slice(0, 120);
  const status = job?.status || "";
  const stage = job ? stageFor(status) : stageFor("REQ");
  const tech = job?.owner_tech || job?.assigned_tech || "";
  const techFirst = tech && techName ? String((await techName(tech).catch(() => "")) || "").split(/\s+/)[0] : "";
  const day = job ? dateStr(job.route_date) : (card?.selfSchedule?.kind === "picked" && card.selfSchedule.date ? String(card.selfSchedule.date).slice(0, 10) : "");
  const win = job ? (job.time_window || "") : (card?.selfSchedule?.kind === "picked" ? (card.selfSchedule.window || "") : "");
  const eta = job ? dateStr(job.parts_eta) : "";
  const estimate = sv && estimateForSv ? await estimateForSv(sv).catch(() => null) : null;
  const cancelled = job ? job.status === "SO9" : String(card?.queueStatus || "") === "Call Cancelled";
  const booked = !!job || String(card?.queueStatus || "") === "Call Scheduled";
  return {
    ref: sv || (row.card_id ? `R-${String(row.card_id).slice(-6).toUpperCase()}` : ""), sv, first, unit, problem,
    stageIndex: cancelled ? -1 : stage.i, stageKey: cancelled ? "cancelled" : stage.key, variant: stage.variant || "", stages: STAGES, status,
    booked, day, window: win === "AM" ? "8 am – 12 pm" : win === "PM" ? "12 – 5 pm" : "", techFirst,
    partsEta: eta, warranty: !!job?.is_warranty,
    estimate: estimate ? { url: estimate.url, status: estimate.status || "" } : null,
    completedOn: job && ["SO8", "SO8I", "SO7"].includes(job.status) ? dateStr(job.status_changed_at) : "",
    contact: { phone: "512-894-0907", sms: "512-894-0907" },
    // the "pick a time" button only while the visit is still unbooked (no ticket yet, or SO1 with no day)
    selfSchedule: card?.selfSchedule && !card.selfSchedule.released && card.selfSchedule.kind !== "picked" && card.selfSchedule.token && (!job || (job.status === "SO1" && !day)) ? { token: card.selfSchedule.token } : null
  };
}

export async function journeyTokenFor({ cardId = "", sv = "" }) {
  const p = await pool();
  const card = String(cardId || "").trim(), svn = String(sv || "").trim().toUpperCase();
  const row = card ? (await p.query(`SELECT token FROM sj_journey_tokens WHERE card_id = $1 ORDER BY created_at LIMIT 1`, [card])).rows[0]
    : svn ? (await p.query(`SELECT token FROM sj_journey_tokens WHERE sv_number = $1 ORDER BY created_at LIMIT 1`, [svn])).rows[0] : null;
  return row?.token || "";
}
