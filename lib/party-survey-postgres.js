import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Christmas party menu survey (Andrew 10/28): one-time dashboard survey —
// everyone picks their top 3 meats, top 3 sides and one dessert from the
// caterer's buffet menu; results roll up on Company Tools → Christmas Party
// Planning. One response per user, editable while the survey is open.
// Pushed to the dashboard as a notification with actionKey "party_survey"
// (the row gets a "Pick my menu" button); saving closes that person's copy.
// ---------------------------------------------------------------------------

export const PARTY_SURVEY_KEY = "christmas-2026";

export const PARTY_MENU = {
  title: "Christmas Party — Catered Buffet",
  caterer: "Choose Your Own Barbecue Feast",
  meats: ["Oak-Smoked Brisket", "Pork Spare Ribs", "Tex-Czech Sausage", "Smoked Turkey Breast", "Smoked Bone-In Chicken", "Smoked Tofu"],
  sides: ["Lemon-Poppy Slaw", "Herbed Potato Salad", "Mac & Cheese", "Jalapeño Cheese Grits", "Campfire Chili Beans", "Roasted Green Bean Salad", "Seasonal Green Salad"],
  desserts: ["Fresh Fruit Cobbler", "Banana Pudding"],
  tags: { "Lemon-Poppy Slaw": "v+ gf", "Herbed Potato Salad": "v gf", "Mac & Cheese": "v", "Jalapeño Cheese Grits": "v gf", "Campfire Chili Beans": "gf", "Roasted Green Bean Salad": "v gf", "Seasonal Green Salad": "v+ gf", "Smoked Tofu": "does not count toward protein" },
  picks: { meats: 3, sides: 3, desserts: 1 }
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS party_survey_responses (
  survey_key TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  meats JSONB NOT NULL DEFAULT '[]'::jsonb,
  sides JSONB NOT NULL DEFAULT '[]'::jsonb,
  dessert TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (survey_key, email)
);
CREATE TABLE IF NOT EXISTS party_survey_meta (
  survey_key TEXT PRIMARY KEY,
  sent_at TIMESTAMPTZ,
  sent_by TEXT NOT NULL DEFAULT '',
  sent_ref TEXT NOT NULL DEFAULT '',
  reminded_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
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

const normEmail = (e) => String(e || "").trim().toLowerCase();
const pickList = (arr, allowed, max) => {
  const seen = new Set(); const out = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = String(v || "").trim();
    if (!allowed.includes(s) || seen.has(s)) continue;
    seen.add(s); out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

export async function getPartySurveyMeta(key = PARTY_SURVEY_KEY) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM party_survey_meta WHERE survey_key = $1`, [key]);
  const m = r.rows[0] || {};
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return { key, sentAt: iso(m.sent_at), sentBy: m.sent_by || "", sentRef: m.sent_ref || "", remindedAt: iso(m.reminded_at), closedAt: iso(m.closed_at), open: Boolean(m.sent_at) && !m.closed_at };
}

export async function setPartySurveyMeta(fields, key = PARTY_SURVEY_KEY) {
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO party_survey_meta (survey_key) VALUES ($1) ON CONFLICT (survey_key) DO NOTHING`, [key]);
  const sets = []; const params = [key];
  for (const [col, val] of Object.entries(fields)) {
    if (!["sent_at", "sent_by", "sent_ref", "reminded_at", "closed_at"].includes(col)) continue;
    params.push(val); sets.push(`${col} = $${params.length}`);
  }
  if (sets.length) await pool.query(`UPDATE party_survey_meta SET ${sets.join(", ")}, updated_at = NOW() WHERE survey_key = $1`, params);
  return getPartySurveyMeta(key);
}

export async function getPartySurveyResponse(email, key = PARTY_SURVEY_KEY) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM party_survey_responses WHERE survey_key = $1 AND email = $2`, [key, normEmail(email)]);
  const x = r.rows[0];
  return x ? { email: x.email, name: x.name, meats: x.meats || [], sides: x.sides || [], dessert: x.dessert || "", note: x.note || "", updatedAt: new Date(x.updated_at).toISOString() } : null;
}

// Validates against the menu: exactly the configured number of meats and
// sides (fewer is allowed only if the menu has fewer), one dessert.
export async function savePartySurveyResponse({ email, name, meats, sides, dessert, note }, key = PARTY_SURVEY_KEY) {
  const e = normEmail(email);
  if (!e) throw new Error("No email on the signed-in account.");
  const m = pickList(meats, PARTY_MENU.meats, PARTY_MENU.picks.meats);
  const s = pickList(sides, PARTY_MENU.sides, PARTY_MENU.picks.sides);
  const d = PARTY_MENU.desserts.includes(String(dessert || "").trim()) ? String(dessert).trim() : "";
  if (m.length < PARTY_MENU.picks.meats) throw new Error(`Pick ${PARTY_MENU.picks.meats} meats.`);
  if (s.length < PARTY_MENU.picks.sides) throw new Error(`Pick ${PARTY_MENU.picks.sides} sides.`);
  if (!d) throw new Error("Pick a dessert.");
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO party_survey_responses (survey_key, email, name, meats, sides, dessert, note)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     ON CONFLICT (survey_key, email) DO UPDATE SET name = EXCLUDED.name, meats = EXCLUDED.meats, sides = EXCLUDED.sides, dessert = EXCLUDED.dessert, note = EXCLUDED.note, updated_at = NOW()`,
    [key, e, String(name || "").slice(0, 120), JSON.stringify(m), JSON.stringify(s), d, String(note || "").trim().slice(0, 400)]
  );
  return getPartySurveyResponse(e, key);
}

export async function listPartySurveyResponses(key = PARTY_SURVEY_KEY) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM party_survey_responses WHERE survey_key = $1 ORDER BY updated_at DESC`, [key]);
  return r.rows.map((x) => ({ email: x.email, name: x.name, meats: x.meats || [], sides: x.sides || [], dessert: x.dessert || "", note: x.note || "", updatedAt: new Date(x.updated_at).toISOString() }));
}

// Tallies: votes per item (each response counts once per item it picked),
// ranked, with the winners (top N by the menu's pick counts) marked.
export function tallyPartySurvey(responses) {
  const count = (list, field) => {
    const c = new Map(list.map((i) => [i, 0]));
    for (const r of responses) for (const v of field === "dessert" ? [r.dessert] : r[field] || []) if (c.has(v)) c.set(v, c.get(v) + 1);
    return [...c.entries()].map(([item, votes]) => ({ item, votes, tag: PARTY_MENU.tags[item] || "" })).sort((a, b) => b.votes - a.votes || a.item.localeCompare(b.item));
  };
  const n = responses.length;
  const withShare = (rows, winners) => rows.map((r, i) => ({ ...r, share: n ? Math.round((r.votes / n) * 100) : 0, winner: i < winners && r.votes > 0 }));
  return {
    responses: n,
    meats: withShare(count(PARTY_MENU.meats, "meats"), PARTY_MENU.picks.meats),
    sides: withShare(count(PARTY_MENU.sides, "sides"), PARTY_MENU.picks.sides),
    desserts: withShare(count(PARTY_MENU.desserts, "dessert"), PARTY_MENU.picks.desserts)
  };
}
