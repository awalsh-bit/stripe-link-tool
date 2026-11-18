/*
 * Site walk — where Agility's routes are.
 *
 * Loaded first on the three site-walk pages. Everything the scripts need to
 * know about the host is in this one object; the standalone tool runs the
 * same scripts without this file and talks to its own little server.
 * To move a route, change it here and in lib/site-walk-routes.js.
 */
window.WILSON_SW_PORTAL = true;                       /* there is a server behind these pages */
window.WILSON_SW_API = {
  serverName: "Agility",
  session:   "/api/site-walk/session",
  walks:     "/api/site-walk/walks",                  /* the queue: every walk, summary only */
  pull:      "/api/site-walk/pull",                   /* walks a device may open (+ ?client=<id>) */
  sync:      "/api/site-walk/sync",                   /* one walk in, whole */
  photos:    "/api/site-walk/photos",                 /* upload one / list ids */
  photoBase: "/api/site-walk/photo/",                 /* + <walk id>/<photo id>.jpg */
  gate:      "/api/site-walk",                        /* + /walks/<id>/sign-off and /walks/<id>/sent */
  library:   "/api/site-walk/library",                /* the shared spec library: rows people changed or added */
  login:     "/login",                                /* where a signed-out browser is sent */
  live:      15000                                    /* ms between looks for newer work from the field */
};
window.WILSON_SW_WORKER = "site-walk-sw.js";
window.WILSON_SW_WORKER_SCOPE = "/site-walk";          /* the three pages and their assets, nothing else on the host */
