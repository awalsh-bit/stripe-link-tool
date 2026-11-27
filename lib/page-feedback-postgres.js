// ---------------------------------------------------------------------------
// Page feedback (Andrew 11/26: "I need a page feedback form that goes to all
// executives. It should be in the shell and be able to have the team send a
// notification with 100 characters or less feedback about how an internal
// page functions").
//
// Anyone signed in opens "Page feedback" from the shell (the personal menu at
// the top right, or the footer), types up to 100 characters about the page
// they are on, and sends. Every executive gets it on My Notifications, with
// the page's name and who sent it. This table keeps what was sent, so the
// feedback outlives the notifications being closed.
// ---------------------------------------------------------------------------
import { getPostgresPool } from "./data-postgres.js";

export const PAGE_FEEDBACK_MAX = 100;         // characters, as Andrew set it
// One person: this many in ten minutes, and this many in a day. Enough for
// someone walking through several pages; not enough to bury My Notifications.
export const PAGE_FEEDBACK_PER_10_MIN = 5;
export const PAGE_FEEDBACK_PER_DAY = 25;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS page_feedback (
  id BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL DEFAULT '',
  page_label TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  by_email TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS page_feedback_created_idx ON page_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS page_feedback_by_idx ON page_feedback (by_email, created_at DESC);
`;

let schemaDone = null;
async function feedbackPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!schemaDone) schemaDone = pool.query(SCHEMA_SQL).catch((e) => { schemaDone = null; throw e; });
  await schemaDone;
  return pool;
}

// The feedback text: one line, no control characters, 1 to 100 characters
// (counted as a person would count them, so an emoji is one). Throws with a
// message fit to show the sender.
export function cleanPageFeedback(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Type your feedback first.");
  if ([...text].length > PAGE_FEEDBACK_MAX) throw new Error(`Keep it to ${PAGE_FEEDBACK_MAX} characters.`);
  return text;
}

// The page the feedback is about: its path only. Whatever follows a ? or #
// is dropped on purpose - an address can carry a client's name, an invoice
// number or a sign-in token, and none of that belongs in a notification.
export function cleanPagePath(value) {
  let path = String(value ?? "").trim().split(/[?#]/)[0];
  if (!path.startsWith("/")) path = "/" + path;
  path = path.replace(/\/{2,}/g, "/");
  if (!/^\/[A-Za-z0-9/_.\-]{0,119}$/.test(path) || path.includes("..")) return "";
  return path === "/" ? "/dashboard.html" : path;
}

const mapRow = (r) => ({
  id: Number(r.id), pagePath: r.page_path, pageLabel: r.page_label, message: r.message,
  byEmail: r.by_email, byName: r.by_name, notified: Number(r.notified || 0),
  createdAt: r.created_at?.toISOString?.() || null
});

// How many this person has sent lately, and whether the last one is this same
// thing again (a second tap on Send): { tenMin, day, repeat }.
export async function recentPageFeedback(byEmail, { pagePath = "", message = "" } = {}) {
  const pool = await feedbackPool();
  const email = String(byEmail || "").toLowerCase();
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes') AS ten_min,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS day,
       (SELECT id FROM page_feedback WHERE by_email = $1 AND page_path = $2 AND message = $3 AND created_at > NOW() - INTERVAL '2 minutes' ORDER BY id DESC LIMIT 1) AS repeat_id
     FROM page_feedback WHERE by_email = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [email, pagePath, message]
  );
  return { tenMin: Number(rows[0]?.ten_min || 0), day: Number(rows[0]?.day || 0), repeat: rows[0]?.repeat_id ? Number(rows[0].repeat_id) : 0 };
}

export async function savePageFeedback({ pagePath, pageLabel, message, byEmail, byName }) {
  const pool = await feedbackPool();
  const { rows } = await pool.query(
    `INSERT INTO page_feedback (page_path, page_label, message, by_email, by_name) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(pagePath || "").slice(0, 120), String(pageLabel || "").slice(0, 80), message, String(byEmail || "").toLowerCase().slice(0, 200), String(byName || "").slice(0, 120)]
  );
  return mapRow(rows[0]);
}

export async function setPageFeedbackNotified(id, count) {
  const pool = await feedbackPool();
  await pool.query(`UPDATE page_feedback SET notified = $2 WHERE id = $1`, [Number(id), Math.max(0, Math.round(Number(count) || 0))]);
}

// Everything sent, newest first (executives).
export async function listPageFeedback({ limit = 200 } = {}) {
  const pool = await feedbackPool();
  const { rows } = await pool.query(`SELECT * FROM page_feedback ORDER BY created_at DESC, id DESC LIMIT $1`, [Math.max(1, Math.min(1000, Number(limit) || 200))]);
  return rows.map(mapRow);
}
