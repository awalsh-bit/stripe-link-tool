import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Important Dates (Andrew 11/6): a small company calendar — holidays, early
// closings, all-store meetings, potlucks — that every dashboard shows in a
// compact "Upcoming" card above My Notifications for the next 60 days.
// HR builds the list on Company Tools → Important Dates. A date can carry a
// sign-up sheet ("what are you bringing?") that everyone can add to and see.
// ---------------------------------------------------------------------------

export const IMPORTANT_DATE_KINDS = [
  { key: "event", label: "Company event", color: "#166534" },
  { key: "holiday", label: "Paid holiday", color: "#1d4ed8" },
  { key: "closing", label: "Closing / early close", color: "#b45309" },
  { key: "meeting", label: "All-store meeting", color: "#6d28d9" },
  { key: "deadline", label: "Deadline", color: "#b91c1c" },
  { key: "other", label: "Other", color: "#374151" }
];
const KIND_KEYS = new Set(IMPORTANT_DATE_KINDS.map((k) => k.key));

export const UPCOMING_WINDOW_DAYS = 60;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS important_dates (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'event',
  on_date DATE NOT NULL,
  end_date DATE,
  time_text TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  signup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  signup_prompt TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS important_dates_on_date_idx ON important_dates (on_date);
CREATE TABLE IF NOT EXISTS important_date_signups (
  id SERIAL PRIMARY KEY,
  date_id INTEGER NOT NULL REFERENCES important_dates(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS important_date_signups_date_idx ON important_date_signups (date_id);
-- RSVP mode (Andrew 11/10): the sheet can be "what are you bringing?" (free
-- lines, as many as you like) or an RSVP — one answer per person, coming or
-- not, how many guests, an optional note.
ALTER TABLE important_dates ADD COLUMN IF NOT EXISTS signup_mode TEXT NOT NULL DEFAULT 'bring';
ALTER TABLE important_date_signups ADD COLUMN IF NOT EXISTS response TEXT NOT NULL DEFAULT '';
ALTER TABLE important_date_signups ADD COLUMN IF NOT EXISTS guests INTEGER NOT NULL DEFAULT 0;
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isoDate = (v) => {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) ? s : "";
};
// Postgres DATE comes back as a JS Date at local midnight; keep it as YYYY-MM-DD.
const dateOut = (d) => {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function rowOut(r) {
  return {
    id: r.id,
    title: r.title,
    kind: KIND_KEYS.has(r.kind) ? r.kind : "other",
    date: dateOut(r.on_date),
    endDate: dateOut(r.end_date),
    time: r.time_text || "",
    details: r.details || "",
    signupEnabled: !!r.signup_enabled,
    signupMode: r.signup_mode === "rsvp" ? "rsvp" : "bring",
    signupPrompt: r.signup_prompt || "",
    signupCount: Number(r.signup_count || 0),
    rsvp: { yes: Number(r.rsvp_yes || 0), no: Number(r.rsvp_no || 0), people: Number(r.rsvp_people || 0) }, // people = those coming plus their guests
    archived: !!r.archived_at,
    createdBy: r.created_by || "",
    createdAt: r.created_at?.toISOString?.() || null,
    updatedBy: r.updated_by || "",
    updatedAt: r.updated_at?.toISOString?.() || null
  };
}

export function validateImportantDate(input) {
  const title = String(input?.title || "").trim().slice(0, 140);
  if (!title) throw new Error("Give the date a title.");
  const date = isoDate(input?.date);
  if (!date) throw new Error("Pick a date.");
  const endDate = isoDate(input?.endDate);
  if (endDate && endDate < date) throw new Error("The end date is before the start date.");
  const kind = KIND_KEYS.has(String(input?.kind || "")) ? String(input.kind) : "event";
  return {
    title, date, endDate: endDate || null, kind,
    time: String(input?.time || "").trim().slice(0, 60),
    details: String(input?.details || "").trim().slice(0, 600),
    signupEnabled: !!input?.signupEnabled,
    signupMode: input?.signupMode === "rsvp" ? "rsvp" : "bring",
    signupPrompt: String(input?.signupPrompt || "").trim().slice(0, 140)
  };
}

const SELECT = `SELECT d.*,
  (SELECT COUNT(*) FROM important_date_signups s WHERE s.date_id = d.id) AS signup_count,
  (SELECT COUNT(*) FROM important_date_signups s WHERE s.date_id = d.id AND s.response = 'yes') AS rsvp_yes,
  (SELECT COUNT(*) FROM important_date_signups s WHERE s.date_id = d.id AND s.response = 'no') AS rsvp_no,
  (SELECT COALESCE(SUM(1 + s.guests), 0) FROM important_date_signups s WHERE s.date_id = d.id AND s.response = 'yes') AS rsvp_people
  FROM important_dates d`;

// Everyone's dashboard card: today through +N days, soonest first. A multi-day
// entry (end_date) stays listed until its last day has passed.
export async function listUpcomingImportantDates({ days = UPCOMING_WINDOW_DAYS, today } = {}) {
  const pool = await getReadyPool();
  const base = isoDate(today) || new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { rows } = await pool.query(
    `${SELECT} WHERE d.archived_at IS NULL
       AND COALESCE(d.end_date, d.on_date) >= $1::date
       AND d.on_date <= ($1::date + ($2::int || ' days')::interval)
     ORDER BY d.on_date ASC, d.title ASC`,
    [base, days]
  );
  return rows.map(rowOut);
}

export async function listImportantDates({ includeArchived = false, includePast = true } = {}) {
  const pool = await getReadyPool();
  const where = [];
  if (!includeArchived) where.push("d.archived_at IS NULL");
  if (!includePast) where.push("COALESCE(d.end_date, d.on_date) >= CURRENT_DATE");
  const { rows } = await pool.query(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY d.on_date ASC, d.title ASC`);
  return rows.map(rowOut);
}

export async function getImportantDate(id) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(`${SELECT} WHERE d.id = $1`, [Number(id)]);
  return rows[0] ? rowOut(rows[0]) : null;
}

export async function createImportantDate(input, by = "") {
  const v = validateImportantDate(input);
  const pool = await getReadyPool();
  const { rows } = await pool.query(
    `INSERT INTO important_dates (title, kind, on_date, end_date, time_text, details, signup_enabled, signup_prompt, created_by, updated_by, signup_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`,
    [v.title, v.kind, v.date, v.endDate, v.time, v.details, v.signupEnabled, v.signupPrompt, String(by || "").slice(0, 120), v.signupMode]
  );
  return getImportantDate(rows[0].id);
}

export async function updateImportantDate(id, input, by = "") {
  const v = validateImportantDate(input);
  const pool = await getReadyPool();
  const { rowCount } = await pool.query(
    `UPDATE important_dates SET title=$2, kind=$3, on_date=$4, end_date=$5, time_text=$6, details=$7, signup_enabled=$8, signup_prompt=$9, updated_by=$10, signup_mode=$11, updated_at=NOW() WHERE id=$1`,
    [Number(id), v.title, v.kind, v.date, v.endDate, v.time, v.details, v.signupEnabled, v.signupPrompt, String(by || "").slice(0, 120), v.signupMode]
  );
  if (!rowCount) throw new Error("That date no longer exists.");
  return getImportantDate(id);
}

export async function archiveImportantDate(id, archived, by = "") {
  const pool = await getReadyPool();
  const { rowCount } = await pool.query(
    `UPDATE important_dates SET archived_at = CASE WHEN $2 THEN NOW() ELSE NULL END, updated_by=$3, updated_at=NOW() WHERE id=$1`,
    [Number(id), !!archived, String(by || "").slice(0, 120)]
  );
  if (!rowCount) throw new Error("That date no longer exists.");
  return getImportantDate(id);
}

// ---- Sign-up sheet ("what are you bringing?") ----
export async function listImportantDateSignups(dateId) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(
    `SELECT id, email, name, item, response, guests, created_at, updated_at FROM important_date_signups WHERE date_id = $1 ORDER BY created_at ASC`,
    [Number(dateId)]
  );
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, item: r.item, response: r.response || "", guests: Number(r.guests || 0), createdAt: r.created_at?.toISOString?.() || null }));
}

export async function addImportantDateSignup(dateId, { email, name, item, response, guests }) {
  const e = normEmail(email);
  if (!e) throw new Error("Sign in to add something.");
  const text = String(item || "").trim().slice(0, 140);
  const d = await getImportantDate(dateId);
  if (!d || d.archived) throw new Error("That date no longer exists.");
  if (!d.signupEnabled) throw new Error("This date doesn't have a sign-up sheet.");
  const pool = await getReadyPool();
  if (d.signupMode === "rsvp") {
    // One answer per person: answering again replaces the earlier one. The
    // note is optional; guests only count when you're coming.
    const resp = response === "yes" ? "yes" : response === "no" ? "no" : "";
    if (!resp) throw new Error("Choose whether you're coming.");
    const extra = resp === "yes" ? Math.max(0, Math.min(10, Math.round(Number(guests) || 0))) : 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM important_date_signups WHERE date_id = $1 AND email = $2`, [Number(dateId), e]);
      const { rows } = await client.query(
        `INSERT INTO important_date_signups (date_id, email, name, item, response, guests) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [Number(dateId), e, String(name || "").trim().slice(0, 120), text, resp, extra]);
      await client.query("COMMIT");
      return rows[0].id;
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  }
  if (!text) throw new Error("Type what you're bringing.");
  const { rows } = await pool.query(
    `INSERT INTO important_date_signups (date_id, email, name, item) VALUES ($1,$2,$3,$4) RETURNING id`,
    [Number(dateId), e, String(name || "").trim().slice(0, 120), text]
  );
  return rows[0].id;
}

// A person removes their own line; the builder page can remove anyone's.
export async function removeImportantDateSignup(signupId, { email, any = false }) {
  const pool = await getReadyPool();
  const { rowCount } = await pool.query(
    any ? `DELETE FROM important_date_signups WHERE id = $1` : `DELETE FROM important_date_signups WHERE id = $1 AND email = $2`,
    any ? [Number(signupId)] : [Number(signupId), normEmail(email)]
  );
  return rowCount > 0;
}
