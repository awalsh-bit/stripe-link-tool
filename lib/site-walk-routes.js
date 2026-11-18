/*
 * Site walk — routes.
 *
 * In server.js, next to the other feature blocks:
 *
 *     import { registerSiteWalkRoutes } from "./lib/site-walk-routes.js";
 *     registerSiteWalkRoutes(app, { requirePagePermission, recordAudit });
 *
 * (If you would rather have the routes inline in server.js like the others,
 * the body of registerSiteWalkRoutes pastes in as it stands.)
 *
 * One grant covers all of it: the office page. The phone page and the packet
 * page ride that grant through PAGE_IMPLIED_BY (see AGILITY_REGISTRATION.md).
 *
 * BODY SIZE. A walk arrives whole: 0.3–1.2 MB is typical, more with many
 * openings. These routes carry their own parsers with their own limits, but a
 * global `app.use(express.json())` that runs first will already have refused
 * anything over ITS limit (Express's default is 100 kb). Mount this block
 * before a global JSON parser, or make sure the global limit is at least 33 mb
 * for /api/site-walk/sync.
 */
import express from "express";
import {
  receiveWalk, listWalks, pullWalks, getWalk, signOffWalk, reopenWalk, markWalkSent, archiveWalk, restoreWalk, listEvents,
  savePhoto, listPhotoIds, readPhoto, listLibrary, saveLibraryRow, PayloadError
} from "./site-walk-postgres.js";
import { MAX_PAYLOAD_BYTES, MAX_PHOTO_BYTES, PHOTO_TYPES, SAFE_ID } from "./site-walk-rules.js";

export const SITE_WALK_GRANT = "/site-walk-office.html";

export function registerSiteWalkRoutes(app, { requirePagePermission, recordAudit }) {
  const guard = requirePagePermission(SITE_WALK_GRANT);
  const json = express.json({ limit: MAX_PAYLOAD_BYTES + 1024 * 1024 });
  const rawPhoto = express.raw({ type: Object.keys(PHOTO_TYPES), limit: MAX_PHOTO_BYTES + 1024 });

  const who = (req) => ({
    byEmail: (req.authUser && req.authUser.email) || "",
    byName: (req.authUser && (req.authUser.displayName || req.authUser.email)) || ""
  });
  const audit = (req, action, detail) => {
    try {
      const p = recordAudit({
        ip: req.ip, actorUserId: req.authUser && req.authUser.id, action: "site_walk." + action,
        targetUserId: null, detail
      });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) { /* an audit failure must not fail the walk */ }
  };
  /* async handlers: any throw becomes a 500 with a plain sentence */
  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error("[site-walk]", req.method, req.path, err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: "The site walk server hit an error: " + String(err && err.message || err).slice(0, 160) });
    });
  };

  /* Who is signed in — the pages use it to name the walker and the signer. */
  app.get("/api/site-walk/session", guard, (req, res) => {
    res.json({ ok: true, authenticated: true, user: { email: who(req).byEmail, displayName: who(req).byName } });
  });

  /* The office queue: every walk on the server, summary only.
     ?archived=1 lists the archived ones instead. */
  app.get("/api/site-walk/walks", guard, wrap(async (req, res) => {
    res.json({ ok: true, walks: await listWalks({ archived: String(req.query.archived || "") === "1" }) });
  }));

  /* One walk: summary, history, and the document. */
  app.get("/api/site-walk/walks/:id", guard, wrap(async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    const walk = await getWalk(req.params.id);
    if (!walk) return res.status(404).json({ ok: false, error: "That walk is not on the server." });
    res.json({ ok: true, ...walk });
  }));

  /* What a device may open: summaries, no documents. ?client=<walk id> returns
     that one walk with its document. */
  app.get("/api/site-walk/pull", guard, wrap(async (req, res) => {
    const walkId = String(req.query.client || "");
    if (walkId && !SAFE_ID.test(walkId)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    res.json({ ok: true, ...(await pullWalks({ walkId })) });
  }));

  /* One walk from a browser. 400 = never retry; anything else = the phone keeps it and retries. */
  app.post("/api/site-walk/sync", guard, json, wrap(async (req, res) => {
    if (!req.body || typeof req.body !== "object" || !Object.keys(req.body).length) {
      return res.status(400).json({ ok: false, error: "No walk was received." });
    }
    try {
      const result = await receiveWalk(req.body, who(req));
      if (result.outcome !== "IGNORED_STALE") audit(req, "sync", { walkId: result.walkId, outcome: result.outcome });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof PayloadError) return res.status(400).json({ ok: false, error: err.message });
      throw err;
    }
  }));

  /* The walker's sign-off: the one gate before the packet can go out. */
  app.post("/api/site-walk/walks/:id/sign-off", guard, json, wrap(async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    const r = await signOffWalk(req.params.id, { ...who(req), note: (req.body && req.body.note) || "" });
    if (!r.ok) return res.status(409).json({ ok: false, error: r.why });
    audit(req, "sign_off", { walkId: req.params.id });
    res.json(r);
  }));

  app.post("/api/site-walk/walks/:id/reopen", guard, json, wrap(async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    const r = await reopenWalk(req.params.id, { ...who(req), note: (req.body && req.body.note) || "" });
    if (!r.ok) return res.status(409).json({ ok: false, error: r.why });
    audit(req, "reopen", { walkId: req.params.id });
    res.json(r);
  }));

  /* Out of everybody's list, and back. Nothing is deleted. */
  app.post("/api/site-walk/walks/:id/archive", guard, json, wrap(async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    const r = await archiveWalk(req.params.id, who(req));
    if (!r.ok) return res.status(404).json({ ok: false, error: r.why });
    if (!r.already) audit(req, "archive", { walkId: req.params.id });
    res.json(r);
  }));
  app.post("/api/site-walk/walks/:id/restore", guard, json, wrap(async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    const r = await restoreWalk(req.params.id, who(req));
    if (!r.ok) return res.status(404).json({ ok: false, error: r.why });
    if (!r.already) audit(req, "restore", { walkId: req.params.id });
    res.json(r);
  }));

  /* Record that the packet went to the builder. Sends nothing itself: the
     person clicked Email in the page (house rule: no automated contact). */
  app.post("/api/site-walk/walks/:id/sent", guard, json, wrap(async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ ok: false, error: "That walk id is not one of ours." });
    const r = await markWalkSent(req.params.id, { to: (req.body && req.body.to) || "", byEmail: who(req).byEmail });
    if (!r.ok) return res.status(409).json({ ok: false, error: r.why });
    audit(req, "sent", { walkId: req.params.id, to: (req.body && req.body.to) || "" });
    res.json(r);
  }));

  /* What the walks have to say to people (ready to sign off, packet sent, a
     spec decision for the salesperson). Derived on every call; sends nothing.
     Feed createPushedNotification from it, or poll it — see QUESTIONS_FOR_ANDREW.md. */
  app.get("/api/site-walk/notifications", guard, wrap(async (req, res) => {
    res.json({ ok: true, events: await listEvents({ since: String(req.query.since || ""), email: String(req.query.email || "") }) });
  }));

  /* The shared spec library: every row people changed or added, and one
     write at a time. The pages merge these over the built-in entries. */
  app.get("/api/site-walk/library", guard, wrap(async (req, res) => {
    res.json({ ok: true, rows: await listLibrary() });
  }));
  app.post("/api/site-walk/library", guard, json, wrap(async (req, res) => {
    let r;
    try { r = await saveLibraryRow(req.body, who(req)); }
    catch (err) {
      if (err instanceof PayloadError) return res.status(400).json({ ok: false, error: err.message });
      throw err;
    }
    audit(req, r.row.deleted ? "library_removed" : "library_saved", { kind: r.row.kind, key: r.row.key });
    res.json(r);
  }));

  /* One photograph, raw body, identity in the headers (the browser has a Blob
     in hand; base64 would add a third to every jobsite upload). */
  app.post("/api/site-walk/photos", guard, rawPhoto, wrap(async (req, res) => {
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const h = (name, max) => String(req.headers[name] || "").trim().slice(0, max);
    const r = await savePhoto({
      walkId: h("x-visit-id", 64), photoId: h("x-photo-id", 64), contentType,
      buffer: Buffer.isBuffer(req.body) ? req.body : null,
      meta: { assetId: h("x-asset-id", 64), checkId: h("x-check-id", 64), kind: h("x-photo-kind", 32),
              capturedAt: h("x-captured-at", 40), technician: h("x-technician", 80) },
      byEmail: who(req).byEmail
    });
    if (!r.ok) return res.status(r.status || 400).json({ ok: false, error: r.error });
    res.json(r);
  }));

  app.get("/api/site-walk/photos", guard, wrap(async (req, res) => {
    const visit = String(req.query.visit || "").trim();
    if (visit && !SAFE_ID.test(visit)) return res.status(400).json({ ok: false, error: "That visit id is not one of ours." });
    const ids = await listPhotoIds(visit);
    res.json({ ok: true, visit, ids, count: ids.length });
  }));

  /* The bytes. Behind the login like everything else here; builder-facing
     pages never get these URLs. */
  app.get("/api/site-walk/photo/:walkId/:file", guard, wrap(async (req, res) => {
    const photoId = String(req.params.file || "").replace(/\.(jpg|jpeg|png|webp)$/i, "");
    const photo = await readPhoto(req.params.walkId, photoId);
    if (!photo) return res.status(404).json({ ok: false, error: "That photograph is not on the server." });
    res.set("Content-Type", photo.contentType);
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.send(photo.buffer);
  }));
}
