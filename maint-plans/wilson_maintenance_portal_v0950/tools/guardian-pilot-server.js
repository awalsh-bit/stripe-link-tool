#!/usr/bin/env node
/*
 * WILSON GUARDIAN — PILOT INGEST SERVER                           (v0.9.45)
 *
 * Cayden: "I'd like to deploy a few test sensors and force a few failures to
 * see how everything reacts and if our thresholds catch the fails."
 *
 * This is the smallest real backend that makes that test honest: it receives
 * ACTUAL UbiBot readings and judges them with the EXACT same code and config
 * the prototype uses -- it loads assets/plan-config.js (the researched
 * flagRules) and assets/temp-monitoring.js (evaluateFlags) into a sandbox, so
 * there is one implementation of the rules and the pilot exercises it.
 *
 * WHAT IT DOES
 *   - POST /ubibot           UbiBot Data Forwarding endpoint. Point each test
 *                            channel's forwarding at http://<this box>/ubibot.
 *                            Replies "SUCCESS" the way UbiBot expects.
 *   - optional REST poller   --poll with UBIBOT_ACCOUNT_KEY set pulls the
 *                            channel list instead, for a pilot too small to
 *                            bother with forwarding. Stays far inside
 *                            UbiBot's limits (one poll per 90s for the whole
 *                            account; their cap is 6 calls/account/minute).
 *   - every 30s              re-evaluates every sensor against the flag
 *                            rules; logs WARNING / DISPATCH / OFFLINE
 *                            transitions to the console and to
 *                            guardian-pilot-incidents.jsonl; optionally POSTs
 *                            each incident to ALERT_WEBHOOK_URL (Slack-style
 *                            {text} payload) so the office phone buzzes.
 *   - GET /                  a status page: every sensor, latest reading,
 *                            tier, over-for, and the incident log.
 *   - GET /status.json       the same as data, for QA and curl.
 *
 * DRILL LABELING (the training set for failure-mode trends)
 *   Cayden: "once we have the temp loggers installed in our showroom as a
 *   test, i can force different kinds of failures and get the data so we can
 *   start programming trends." The taxonomy and drill protocol live in
 *   docs/GUARDIAN_FAILURE_SIGNATURES.md. The server is the lab notebook:
 *
 *   - POST /drill            {"channelId":"1001","mode":"no_evap_fan","note":"..."}
 *                            starts a labeled drill on that sensor. Start the
 *                            label BEFORE inducing the failure.
 *   - POST /drill/end        {"channelId":"1001"} ends it — after FULL
 *                            recovery, so the recovery curve is labeled too.
 *   - GET  /drills           active + completed drills.
 *   - GET  /export.jsonl     every stored reading, one JSON line each, with
 *   - GET  /export.csv       its drill label ("healthy" outside any drill).
 *                            This export IS the labeled dataset the trend
 *                            programming starts from. It is a trade secret:
 *                            keep it in-house, never in marketing, never in
 *                            anything customer-visible.
 *
 *   Incidents that fire during a drill carry the drill mode, so the drill
 *   sheet can read detection latency straight off the incident log.
 *
 * SETUP
 *   1. Copy guardian-pilot-sensors.example.json to guardian-pilot-sensors.json
 *      and fill in your channel ids, which field carries the probe (UbiBot
 *      maps external probes to field7-field10; onboard temp is field1), and
 *      what each sensor watches (fresh_food / freezer / wine).
 *   2. node tools/guardian-pilot-server.js            (forwarding mode)
 *      node tools/guardian-pilot-server.js --poll     (poller mode; needs
 *      UBIBOT_ACCOUNT_KEY in the environment -- NEVER in a file in this repo)
 *
 * SECURITY: binds 127.0.0.1 by default (HOST=0.0.0.0 to expose on the shop
 * LAN). Do not put this on public wifi or tunnel it to the internet; the
 * account key lives only in the environment.
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8091);
const POLL = process.argv.indexOf("--poll") > -1;
/* Env overrides exist so the QA harness can run against fixture files
   without touching a real pilot's data. */
const SENSORS_FILE = process.env.GUARDIAN_SENSORS_FILE || path.join(ROOT, "guardian-pilot-sensors.json");
const DATA_FILE = process.env.GUARDIAN_DATA_FILE || path.join(ROOT, "guardian-pilot-data.json");
const INCIDENT_FILE = process.env.GUARDIAN_INCIDENT_FILE || path.join(ROOT, "guardian-pilot-incidents.jsonl");
const DRILL_FILE = process.env.GUARDIAN_DRILL_FILE || path.join(ROOT, "guardian-pilot-drills.json");
const KEEP_HOURS = 48;

/*
 * The failure modes a drill may be labeled with — the exact taxonomy of
 * docs/GUARDIAN_FAILURE_SIGNATURES.md. A strict list, not free text, because
 * a training set with "no evap fan", "evap_fan", and "fan dead" as three
 * different labels is a training set someone has to clean by hand later.
 */
const DRILL_MODES = [
  "door_open",          // door left open, one event
  "warm_air_cycling",   // door cycled on a cadence (heavy-use vs fault)
  "gasket_leak",        // taped pencil-gap in the seal
  "no_compressor",      // compressor/start components disabled
  "no_evap_fan",        // evaporator fan disconnected — the divergence drill
  "failed_defrost",     // defrost heater disabled, multi-day
  "condenser_blocked",  // condenser inlet blocked
  "damper_stuck",       // damper forced open or closed
  "power_loss",         // unit unplugged, sensor on battery
  "healthy_baseline"    // explicit healthy stretch between drills
];

/* ---- the one implementation of the rules, loaded, not copied ---------- */
const sandbox = { console: console };
sandbox.window = sandbox;
vm.createContext(sandbox);
["assets/plan-config.js", "assets/temp-monitoring.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox);
});
const SIM = sandbox.WILSON_TEMPWATCH_SIM;
const RULES = sandbox.WILSON_CONFIG.tempMonitoring.flagRules;

/* Sensor kind -> the asset shape bandFor() resolves. */
const KIND_ASSET = {
  fresh_food: { type: "refrigerator", typeLabel: "Refrigerator" },
  freezer: { type: "freezer", typeLabel: "Freezer" },
  wine: { type: "wine_beverage", typeLabel: "Wine Storage" }
};

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

const sensors = loadJson(SENSORS_FILE, null);
if (!sensors || !Array.isArray(sensors.sensors) || !sensors.sensors.length) {
  console.error("No " + path.basename(SENSORS_FILE) + " found (or it lists no sensors).");
  console.error("Copy tools/guardian-pilot-sensors.example.json there and fill in your channels.");
  process.exit(1);
}
sensors.sensors.forEach(function (s) {
  if (!KIND_ASSET[s.kind]) {
    console.error("Sensor " + s.channelId + " has kind '" + s.kind + "' — must be fresh_food, freezer or wine.");
    process.exit(1);
  }
});

/* readings: { channelId: [{t: epochMs, value: number}] } newest last */
const store = loadJson(DATA_FILE, {});
/* lastTier per sensor so only TRANSITIONS become incidents. */
const lastTier = {};

/*
 * Drill state. { active: {channelId: {mode, note, startedAt}}, history: [...] }
 * Persisted so a server restart mid-drill (a several-day failed_defrost
 * drill WILL survive a reboot or two) does not lose the label.
 */
const drills = loadJson(DRILL_FILE, { active: {}, history: [] });
drills.active = drills.active || {};
drills.history = drills.history || [];

function saveDrills() {
  fs.writeFileSync(DRILL_FILE, JSON.stringify(drills, null, 2));
}

function activeDrill(channelId) {
  return drills.active[String(channelId)] || null;
}

/*
 * Labeled readings are ALSO appended to a durable training file the moment
 * they arrive. The live store prunes at KEEP_HOURS to stay small; a labeled
 * reading from day one of a five-day defrost drill must not be pruned with
 * it. The training file is append-only and never trimmed — it is the
 * dataset. (Trade secret: stays local, stays out of the repo — .gitignore.)
 */
const TRAINING_FILE = process.env.GUARDIAN_TRAINING_FILE || path.join(ROOT, "guardian-pilot-training.jsonl");

function appendTraining(channelId, epochMs, value, mode) {
  const sensor = sensors.sensors.find(function (s) { return String(s.channelId) === String(channelId); });
  fs.appendFileSync(TRAINING_FILE, JSON.stringify({
    t: new Date(epochMs).toISOString(),
    channelId: String(channelId),
    label: sensor ? (sensor.label || sensor.channelId) : String(channelId),
    kind: sensor ? sensor.kind : "",
    f: value,
    mode: mode
  }) + "\n");
}

function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store));
}

function record(channelId, epochMs, value) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(value)) return;
  const rows = store[channelId] = store[channelId] || [];
  if (rows.length && epochMs <= rows[rows.length - 1].t) {
    /* Backfill or duplicate: insert in order, drop exact-time repeats. */
    if (rows.some(function (r) { return r.t === epochMs; })) return;
    rows.push({ t: epochMs, value: value });
    rows.sort(function (a, b) { return a.t - b.t; });
  } else {
    rows.push({ t: epochMs, value: value });
  }
  /* Accepted (not a duplicate): if a drill is running on this channel, the
     reading goes to the durable training file with the drill's label. */
  const drill = activeDrill(channelId);
  if (drill && epochMs >= drill.startedAt) {
    appendTraining(channelId, epochMs, value, drill.mode);
  }
  const cutoff = Date.now() - KEEP_HOURS * 3600000;
  while (rows.length && rows[0].t < cutoff) rows.shift();
}

/* ---- evaluation --------------------------------------------------------- */
function pointsFor(channelId, now) {
  return (store[channelId] || []).map(function (r) {
    return { minutesAgo: Math.max(0, Math.round((now - r.t) / 60000)), value: r.value };
  });
}

const startedAt = Date.now();

function evaluateSensor(sensor, now) {
  const rows = store[sensor.channelId] || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const silentMinutes = latest ? Math.round((now - latest.t) / 60000) : null;
  const offlineHold = Number((RULES.offline || {}).holdMinutes || 180);
  /* A sensor that has NEVER reported gets the same hold measured from server
     start -- so booting the server does not page the office about six
     sensors that simply have not been screwed to a fridge yet. Until then it
     reads WAITING, which is a state, not an incident. */
  const offline = latest
    ? silentMinutes >= offlineHold
    : (now - startedAt) / 60000 >= offlineHold;
  const waiting = !latest && !offline;
  const flag = SIM.evaluateFlags(KIND_ASSET[sensor.kind], pointsFor(sensor.channelId, now));
  const stats = SIM.summarize(pointsFor(sensor.channelId, now), flag.rule);
  return {
    channelId: sensor.channelId,
    label: sensor.label || sensor.channelId,
    kind: sensor.kind,
    latest: latest ? latest.value : null,
    latestAt: latest ? new Date(latest.t).toISOString() : null,
    silentMinutes: silentMinutes,
    offline: offline,
    tier: offline ? "offline" : waiting ? "waiting" : (flag.tier || "ok"),
    reason: offline
      ? (latest ? "no reading for " + silentMinutes + " min" : "never reported")
      : waiting ? "no readings yet"
      : (flag.reason || ""),
    overForMinutes: flag.overForMinutes || 0,
    readings: rows.length,
    stats: stats
  };
}

function incident(row) {
  const drill = activeDrill(row.channelId);
  const line = {
    at: new Date().toISOString(),
    channelId: row.channelId, label: row.label, kind: row.kind,
    tier: row.tier, reason: row.reason, latest: row.latest
  };
  /* An incident during a drill is the drill's detection event — stamp it so
     the drill sheet reads detection latency straight off the log. */
  if (drill) line.drill = drill.mode;
  fs.appendFileSync(INCIDENT_FILE, JSON.stringify(line) + "\n");
  const text = "[GUARDIAN " + row.tier.toUpperCase() + "] " + row.label + " (" + row.kind + "): " +
    row.reason + (row.latest !== null ? " — latest " + row.latest + "°F" : "") +
    (drill ? " [drill: " + drill.mode + "]" : "");
  console.log(new Date().toISOString() + "  " + text);
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    try {
      const url = new URL(hook);
      const body = JSON.stringify({ text: text });
      const req = (url.protocol === "https:" ? https : http).request(url, {
        method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      }, function () {});
      req.on("error", function (err) { console.error("alert webhook failed: " + err.message); });
      req.end(body);
    } catch (e) { console.error("bad ALERT_WEBHOOK_URL: " + e.message); }
  }
}

const ALERT_TIERS = { warn: true, dispatch: true, offline: true };

function evaluateAll() {
  const now = Date.now();
  sensors.sensors.forEach(function (sensor) {
    const row = evaluateSensor(sensor, now);
    const previous = lastTier[sensor.channelId] || "waiting";
    if (row.tier === previous) return;
    lastTier[sensor.channelId] = row.tier;
    /* Alert tiers log on entry; a return to OK logs as a recovery so the
       drill sheet can time how long a door event takes to clear. The
       waiting->ok first-data transition is nobody's incident. */
    if (ALERT_TIERS[row.tier]) {
      incident(row);
    } else if (row.tier === "ok" && ALERT_TIERS[previous]) {
      incident(Object.assign({}, row, { reason: "recovered — back in band (was " + previous + ")" }));
    }
  });
}

/* ---- UbiBot payload parsing --------------------------------------------- */
/*
 * Data-forwarding POST shape (per UbiBot platform docs): channel_id at the
 * top plus a feeds[] array of {created_at, field1: {...} | number, ...}.
 * Field values arrive either as bare numbers or as {value: n} objects, and
 * external probes ride field7-field10 (field1 is onboard temp) -- the sensor
 * file says which field to trust for each channel.
 */
function ingestForwarding(payload) {
  const channelId = String(payload.channel_id || payload.channelId || "");
  const sensor = sensors.sensors.find(function (s) { return String(s.channelId) === channelId; });
  if (!sensor) return { ok: false, message: "unknown channel " + channelId };
  const field = sensor.field || "field1";
  let taken = 0;
  (payload.feeds || []).forEach(function (feed) {
    const raw = feed[field];
    const value = raw && typeof raw === "object" ? Number(raw.value) : Number(raw);
    const t = Date.parse(feed.created_at || feed.createdAt || "");
    let f = value;
    /* UbiBot reports Celsius by default; the rules speak Fahrenheit. The
       sensor file says which unit the channel sends. */
    if ((sensor.unit || "C").toUpperCase() === "C") f = value * 9 / 5 + 32;
    if (Number.isFinite(t) && Number.isFinite(f)) { record(channelId, t, Math.round(f * 10) / 10); taken += 1; }
  });
  if (taken) saveStore();
  return { ok: true, taken: taken };
}

/* ---- optional REST poller (small pilots; respects account limits) ------- */
function pollOnce() {
  const key = process.env.UBIBOT_ACCOUNT_KEY;
  if (!key) { console.error("--poll needs UBIBOT_ACCOUNT_KEY in the environment."); process.exit(1); }
  https.get("https://webapi.ubibot.com/channels?account_key=" + encodeURIComponent(key), function (res) {
    let body = "";
    res.on("data", function (c) { body += c; });
    res.on("end", function () {
      try {
        const parsed = JSON.parse(body);
        (parsed.channels || []).forEach(function (channel) {
          const sensor = sensors.sensors.find(function (s) { return String(s.channelId) === String(channel.channel_id); });
          if (!sensor) return;
          const lastValues = JSON.parse(channel.last_values || "{}");
          const field = lastValues[sensor.field || "field1"];
          if (!field) return;
          const value = Number(field.value);
          const t = Date.parse(field.created_at || channel.last_entry_date || "");
          let f = value;
          if ((sensor.unit || "C").toUpperCase() === "C") f = value * 9 / 5 + 32;
          if (Number.isFinite(t) && Number.isFinite(f)) record(String(channel.channel_id), t, Math.round(f * 10) / 10);
        });
        saveStore();
      } catch (e) { console.error("poll parse failed: " + e.message); }
    });
  }).on("error", function (err) { console.error("poll failed: " + err.message); });
}

/* ---- status page --------------------------------------------------------- */
function statusRows() {
  const now = Date.now();
  return sensors.sensors.map(function (s) { return evaluateSensor(s, now); });
}

function lastIncidents(limit) {
  try {
    const lines = fs.readFileSync(INCIDENT_FILE, "utf8").trim().split("\n");
    return lines.slice(-limit).reverse().map(function (l) { return JSON.parse(l); });
  } catch (e) { return []; }
}

function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

function statusPage() {
  const rows = statusRows();
  const tierColor = { ok: "#2e7d43", warn: "#8b5d00", dispatch: "#a03030", offline: "#555", waiting: "#888" };
  return "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>Guardian Pilot</title>" +
    "<style>body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:24px;color:#222;background:#fafaf8}" +
    "table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border-bottom:1px solid #ddd;padding:8px 10px;text-align:left;font-size:13px}" +
    "th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666}.tier{font-weight:700}</style>" +
    "<h1>Wilson Guardian — pilot</h1>" +
    "<p>Live readings judged by the SAME flag rules the product ships (plan-config flagRules via temp-monitoring.js). " +
    "Rules: fresh food warn &gt;" + RULES.fresh_food.maxF + "°F/" + RULES.fresh_food.holdMinutes + "m, dispatch &gt;" + RULES.fresh_food.dispatchF + "°F/" + RULES.fresh_food.dispatchHoldMinutes + "m or no recovery in " + RULES.fresh_food.recoverWithinMinutes + "m; offline " + RULES.offline.holdMinutes + "m.</p>" +
    "<table><tr><th>Sensor</th><th>Kind</th><th>Latest</th><th>Seen</th><th>Tier</th><th>Why</th><th>Over for</th><th>48h avg / in-band</th><th>Readings</th><th>Drill</th></tr>" +
    rows.map(function (r) {
      const drill = activeDrill(r.channelId);
      return "<tr><td>" + esc(r.label) + "</td><td>" + esc(r.kind) + "</td><td>" + (r.latest === null ? "—" : r.latest + "°F") + "</td>" +
        "<td>" + (r.silentMinutes === null ? "never" : r.silentMinutes + "m ago") + "</td>" +
        "<td class='tier' style='color:" + tierColor[r.tier] + "'>" + esc(r.tier.toUpperCase()) + "</td>" +
        "<td>" + esc(r.reason) + "</td><td>" + (r.overForMinutes ? Math.round(r.overForMinutes / 6) / 10 + "h" : "—") + "</td>" +
        "<td>" + (r.stats ? r.stats.avg + "°F / " + (r.stats.inBandPct === null ? "—" : r.stats.inBandPct + "%") : "—") + "</td>" +
        "<td>" + r.readings + "</td>" +
        "<td>" + (drill ? "<strong style='color:#8b3fa8'>" + esc(drill.mode) + "</strong>" : "—") + "</td></tr>";
    }).join("") + "</table>" +
    "<p style='font-size:12px;color:#666'>Drill labeling: <code>POST /drill {\"channelId\",\"mode\"}</code> before inducing a failure, " +
    "<code>POST /drill/end</code> after full recovery. Labeled dataset at <code>/export.jsonl</code> and <code>/export.csv</code> — " +
    "in-house training data, never shared. Modes: " + DRILL_MODES.join(", ") + ".</p>" +
    "<h2>Incident log (newest first)</h2><table><tr><th>When</th><th>Sensor</th><th>Tier</th><th>Why</th></tr>" +
    lastIncidents(40).map(function (i) {
      return "<tr><td>" + esc(i.at) + "</td><td>" + esc(i.label) + "</td><td class='tier' style='color:" + (tierColor[i.tier] || "#333") + "'>" + esc(i.tier.toUpperCase()) + "</td><td>" + esc(i.reason) + "</td></tr>";
    }).join("") + "</table>" +
    "<p style='color:#888;font-size:12px'>Refreshes on load. Bound to " + esc(HOST) + " — keep it off public networks.</p>";
}

/* ---- drill labeling + training export ------------------------------------ */
function labelFor(channelId, epochMs) {
  const active = activeDrill(channelId);
  if (active && epochMs >= active.startedAt) return active.mode;
  for (let i = drills.history.length - 1; i >= 0; i--) {
    const d = drills.history[i];
    if (String(d.channelId) === String(channelId) && epochMs >= d.startedAt && epochMs <= d.endedAt) return d.mode;
  }
  return "healthy";
}

/*
 * The labeled dataset: everything in the durable training file, plus every
 * reading still in the live store that the training file does not already
 * have (labeled by drill window, "healthy" outside one). One row per
 * reading; sorted per channel by time.
 */
function trainingRows() {
  const rows = [];
  const seen = {};
  try {
    fs.readFileSync(TRAINING_FILE, "utf8").trim().split("\n").forEach(function (l) {
      if (!l) return;
      try {
        const r = JSON.parse(l);
        rows.push(r);
        seen[r.channelId + "|" + Date.parse(r.t)] = true;
      } catch (e) { /* a torn line from a crash mid-append; skip it */ }
    });
  } catch (e) { /* no training file yet */ }
  sensors.sensors.forEach(function (s) {
    const channelId = String(s.channelId);
    (store[channelId] || []).forEach(function (r) {
      if (seen[channelId + "|" + r.t]) return;
      rows.push({
        t: new Date(r.t).toISOString(),
        channelId: channelId,
        label: s.label || channelId,
        kind: s.kind,
        f: r.value,
        mode: labelFor(channelId, r.t)
      });
    });
  });
  rows.sort(function (a, b) {
    return a.channelId === b.channelId ? Date.parse(a.t) - Date.parse(b.t) : (a.channelId < b.channelId ? -1 : 1);
  });
  return rows;
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function startDrill(body) {
  const channelId = String(body.channelId || "");
  const sensor = sensors.sensors.find(function (s) { return String(s.channelId) === channelId; });
  if (!sensor) return { status: 400, error: "unknown channel " + channelId };
  const mode = String(body.mode || "");
  if (DRILL_MODES.indexOf(mode) === -1) {
    return { status: 400, error: "mode must be one of: " + DRILL_MODES.join(", ") };
  }
  if (drills.active[channelId]) {
    return { status: 409, error: "a '" + drills.active[channelId].mode + "' drill is already running on " + channelId + " — end it first" };
  }
  drills.active[channelId] = {
    channelId: channelId,
    mode: mode,
    note: body.note ? String(body.note) : "",
    startedAt: Date.now()
  };
  saveDrills();
  console.log(new Date().toISOString() + "  [DRILL START] " + (sensor.label || channelId) + " — " + mode);
  return { status: 200, drill: drills.active[channelId] };
}

function endDrill(body) {
  const channelId = String(body.channelId || "");
  const drill = drills.active[channelId];
  if (!drill) return { status: 404, error: "no active drill on " + channelId };
  delete drills.active[channelId];
  const done = Object.assign({}, drill, {
    endedAt: Date.now(),
    endNote: body.note ? String(body.note) : ""
  });
  drills.history.push(done);
  saveDrills();
  console.log(new Date().toISOString() + "  [DRILL END] " + channelId + " — " + done.mode +
    " (" + Math.round((done.endedAt - done.startedAt) / 60000) + " min)");
  return { status: 200, drill: done };
}

/* ---- http ---------------------------------------------------------------- */
const server = http.createServer(function (req, res) {
  if (req.method === "POST" && req.url === "/ubibot") {
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 2e6) req.destroy(); });
    req.on("end", function () {
      let outcome;
      try { outcome = ingestForwarding(JSON.parse(body)); }
      catch (e) { outcome = { ok: false, message: "unparseable payload" }; }
      evaluateAll();
      /* UbiBot judges the forwarding healthy by this exact body. */
      res.writeHead(outcome.ok ? 200 : 400, { "Content-Type": "text/plain" });
      res.end(outcome.ok ? "SUCCESS" : "ERROR");
    });
    return;
  }
  if (req.method === "POST" && (req.url === "/drill" || req.url === "/drill/end")) {
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", function () {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
      const outcome = !parsed
        ? { status: 400, error: "unparseable body" }
        : (req.url === "/drill" ? startDrill(parsed) : endDrill(parsed));
      res.writeHead(outcome.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(outcome.error ? { error: outcome.error } : { ok: true, drill: outcome.drill }));
    });
    return;
  }
  if (req.method === "GET" && req.url === "/drills") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ modes: DRILL_MODES, active: drills.active, history: drills.history }));
    return;
  }
  if (req.method === "GET" && req.url === "/export.jsonl") {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(trainingRows().map(function (r) { return JSON.stringify(r); }).join("\n") + "\n");
    return;
  }
  if (req.method === "GET" && req.url === "/export.csv") {
    const rows = trainingRows();
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    res.end("t,channel_id,label,kind,temp_f,mode\n" + rows.map(function (r) {
      return [r.t, r.channelId, r.label, r.kind, r.f, r.mode].map(csvCell).join(",");
    }).join("\n") + "\n");
    return;
  }
  if (req.method === "GET" && req.url === "/status.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sensors: statusRows(), incidents: lastIncidents(100), rules: RULES, drills: { active: drills.active, history: drills.history } }));
    return;
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(statusPage());
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, HOST, function () {
  console.log("Guardian pilot server on http://" + HOST + ":" + PORT +
    "  (" + sensors.sensors.length + " sensor" + (sensors.sensors.length === 1 ? "" : "s") +
    ", " + (POLL ? "polling UbiBot every 90s" : "waiting for data forwarding") + ")");
  if (POLL) { pollOnce(); setInterval(pollOnce, 90000); }
  setInterval(evaluateAll, 30000);
  evaluateAll();
});
