/*
 * WILSON MAINTENANCE - SERVICE WORKER
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything the field tool does already worked offline: the demo backend is
 * localStorage, photographs go to IndexedDB, scoring is arithmetic in the
 * browser. But none of it could START without a connection. A technician who
 * parked at an estate with no signal and tapped the bookmark got a blank page,
 * because the HTML, CSS and scripts had to come off the network first.
 *
 * That is the whole gap this closes. Mechanical rooms, basements, utility rooms
 * behind two feet of limestone, and estates at the end of a county road are
 * exactly where this tool is used, and exactly where LTE is not.
 *
 * CACHING STRATEGY: STALE-WHILE-REVALIDATE
 * ----------------------------------------
 * Serve from cache immediately, then refresh the cache from the network in the
 * background. Two reasons that is the right trade here rather than
 * network-first:
 *
 *   1. It always works. A slow or flapping connection -- the job-site norm, and
 *      worse than no connection for a network-first strategy that has to wait
 *      for a timeout -- never delays the technician.
 *   2. It cannot serve a mismatched pair. Network-first HTML with cache-first
 *      scripts can hand a new page old code. Everything here moves together.
 *
 * The cost is that a change can be one load behind. For a prototype that is
 * distributed as a zip and run locally, that is a fair price, and CACHE_VERSION
 * below is the escape hatch.
 *
 * VERSIONING, AND THE FOOTGUN IT AVOIDS
 * -------------------------------------
 * The prototype is unzipped fresh per release and served from the same origin
 * (127.0.0.1:8081), so a service worker installed by v0.9.12 would otherwise
 * keep serving v0.9.12 files to v0.9.13. CACHE_VERSION must therefore be bumped
 * every release; `activate` deletes every cache that does not match, and
 * skipWaiting + clients.claim mean the new worker takes over on the next load
 * rather than after every tab is closed. Browsers bypass the HTTP cache when
 * re-checking sw.js itself, so a bumped version is always noticed.
 *
 * WHAT IS DELIBERATELY NOT CACHED
 * -------------------------------
 * The invoice import endpoint (POST /api/invoice/import). It needs the Python
 * server and pypdf; there is nothing useful to serve from a cache, and a
 * cached success would be a lie. Offline, it fails and the UI says why.
 */

/* How long a page load waits on the server before falling back to the
   saved copy. Long enough for a shop PC or a phone on one bar; short enough
   that a dead connection is not a blank screen. */
const NAV_WAIT_MS = 4000;

const CACHE_VERSION = "wilson-site-walk-agility-0.9.85-bc99a0adc2";
/* Only caches whose name starts with this are this worker's to delete. */
const CACHE_PREFIX = "wilson-site-walk-agility-";

/*
 * The app shell. Every page, and every asset any page loads.
 *
 * This list is checked against the real files by _qa/verify-offline-shell.py --
 * a shell that silently misses a script is a page that works at the desk and
 * breaks in the field, which is the worst possible place to find out.
 */
const SHELL = [
  "site-walk.html",
  "site-walk-office.html",
  "site-walk-report.html",
  "site-walk.webmanifest",
  "site-walk-assets/site-walk-agility.js",
  "site-walk-assets/site-walk-core.js",
  "site-walk-assets/site-walk-field.js",
  "site-walk-assets/site-walk-library.js",
  "site-walk-assets/site-walk-office.js",
  "site-walk-assets/site-walk-report.js",
  "site-walk-assets/site-walk-seed.js",
  "site-walk-assets/site-walk-specpkg.js",
  "site-walk-assets/site-walk-ticket.js",
  "site-walk-assets/site-walk-transport.js",
  "site-walk-assets/site-walk.css",
  "site-walk-assets/wilson.css",
  "site-walk-assets/ui.js",
  "site-walk-assets/offline.js",
  "site-walk-assets/paginate.js",
  "site-walk-assets/photo-store.js",
  "site-walk-assets/photo-sync.js",
  "site-walk-assets/logo-black.png",
  "site-walk-assets/icon-192.png",
  "site-walk-assets/icon-512.png",
  "site-walk-assets/icon-maskable-192.png",
  "site-walk-assets/icon-maskable-512.png",
  "site-walk-assets/vendor/pdf.min.js",
  "site-walk-assets/vendor/pdf.worker.min.js",
  "site-walk-assets/vendor/qrcode.js"
];

/*
 * TELL THE PAGE WHETHER THE NETWORK IS ACTUALLY ANSWERING.
 *
 * `navigator.onLine` is the obvious signal and it is close to useless here: it
 * reports whether the device has any network interface at all, not whether the
 * server can be reached. A phone showing one bar in a basement, or on an estate
 * Wi-Fi network with no route out, reports onLine === true while every request
 * fails. The first version of the offline banner keyed off it and therefore
 * never appeared in exactly the situation it exists for.
 *
 * The worker already knows the truth, because it is revalidating in the
 * background on every request. So it says so. This costs no extra requests --
 * it piggybacks on fetches the page was making anyway.
 *
 * Only transitions are broadcast; a steady state generates no chatter.
 */
const OWNED = {};
SHELL.forEach(function (rel) { OWNED["/" + rel] = true; });

let lastReachable = null;

function announce(reachable) {
  if (reachable === lastReachable) return;
  lastReachable = reachable;
  self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ source: "wilson-sw", type: "reachability", reachable: reachable });
    });
  });
}

/*
 * A page can also ASK.
 *
 * Broadcasting on transition alone was not enough. On a cold load with no
 * server, the navigation's own revalidation fails within milliseconds -- long
 * before the page has parsed offline.js and attached a message listener -- so
 * the one announcement that mattered was posted into a void, and because
 * `announce` only fires on a CHANGE, every subsequent failed asset fetch stayed
 * silent. The banner never appeared.
 *
 * So the state is also readable on demand. The page asks once on load; the
 * broadcast still handles changes after that.
 */
self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type !== "reachability?") return;
  const reply = { source: "wilson-sw", type: "reachability", reachable: lastReachable };
  if (event.source && event.source.postMessage) {
    event.source.postMessage(reply);
  } else if (event.ports && event.ports[0]) {
    event.ports[0].postMessage(reply);
  }
});

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      /*
       * Added one at a time rather than with cache.addAll, which rejects the
       * whole install if any single request fails. A shell that is missing one
       * appliance icon should still install -- refusing to install at all would
       * leave the technician with no offline capability over a missing SVG.
       */
      return Promise.all(SHELL.map(function (url) {
        /* Never precache the login page under a shell URL: while signed out
           every shell file answers with a redirect to /login (27 Oct). Only
           a real 200 for the file itself goes in; the rest fills in on the
           first signed-in load. */
        return fetch(new Request(url, { cache: "reload" })).then(function (res) {
          if (!res.ok || res.redirected) throw new Error("not cached: " + res.status);
          return cache.put(url, res);
        }).catch(function () {
          /* Recorded by the QA check, not silently ignored in the product:
             a warning here is visible in DevTools when someone goes looking. */
          console.warn("[wilson-sw] could not precache", url);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (key) { return key !== CACHE_VERSION && key.indexOf(CACHE_PREFIX) === 0; })
        .map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;

  /* Only GETs are cacheable. The invoice import is a POST and needs the
     server, so it goes straight to the network and is allowed to fail. */
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  /* AGILITY: this worker shares a host with every other Agility page. It
     answers only for its own shell — the three pages, their assets and the
     manifest — and lets everything else go to the network untouched. */
  if (!OWNED[url.pathname]) return;
  /* The sign-in flow is the server's business. A cached login page is a
     page nobody can log in from, and a cached logout is not a logout. */
  if (url.pathname === "/login" || url.pathname === "/logout") return;

  /*
   * The revalidation is started HERE, synchronously, and handed to waitUntil in
   * the same turn.
   *
   * The first version created it inside a nested .then() after the cache lookup
   * resolved. By then the event had already been responded to, so the browser
   * was free to terminate the worker -- and did. Two things broke silently as a
   * result: the cache often never refreshed at all (so "stale-while-revalidate"
   * was really just "stale"), and the reachability message that raises the
   * offline banner was frequently never sent. The offline banner therefore
   * failed to appear in exactly the no-server case it exists for, which is how
   * this was found.
   *
   * waitUntil must be called during event dispatch to have any effect. That is
   * the whole reason for this ordering.
   */
  /*
   * `cache: "no-store"` is what makes this a real network probe.
   *
   * A plain `fetch(request)` inside a service worker can be answered by the
   * browser's own HTTP cache without a packet leaving the device. With the
   * server switched off entirely, the revalidation therefore SUCCEEDED from
   * that cache, reported the network as reachable, and the offline banner
   * stayed hidden -- the exact bug this was written to prevent, hidden one
   * layer further down.
   *
   * It also means "stale-while-revalidate" was often neither: the HTTP cache
   * answered, so the service-worker cache was refreshed from an already-stale
   * copy. The service-worker cache IS the cache here, so bypassing the HTTP one
   * is right on both counts.
   *
   * A navigation Request cannot be reconstructed with its mode intact, so this
   * refetches by URL. Every shell resource is a same-origin static GET, so
   * nothing is lost by doing that.
   */
  const network = fetch(new Request(request.url, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "follow"
  })).then(function (response) {
    /*
     * Never cache a response that arrived by redirect. Logged out, every
     * shell URL 302s to /login and comes back here as a 200 -- the LOGIN
     * PAGE, with response.ok true. Caching that stores the login form under
     * index.html (and under every asset URL that was not yet cached), and
     * cache-first then serves it for the life of this CACHE_VERSION, logged
     * in or not. The check is `redirected`, not the status, because follow
     * mode has already swallowed the 302 by the time we see it.
     */
    if (response && response.ok && response.type === "basic" && !response.redirected) {
      /* cloned now, before the page starts reading the body */
      const copy = response.clone();
      caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
    }
    announce(true);
    return response;
  }).catch(function () {
    announce(false);
    return null;
  });

  event.waitUntil(network);

  /*
   * PAGES ARE NETWORK-FIRST (v0.9.78).
   *
   * Stale-while-revalidate kept serving last release's office page to a
   * browser that was signed out of a freshly unzipped server: the page came
   * out of the cache, every request behind it bounced to /login, nothing
   * saved, and nobody was ever shown the sign-in (Cayden, 27 Oct, twice).
   * A page now comes from the server whenever the server answers within a
   * few seconds -- the sign-in page if signed out, the current release if
   * not -- and from the cache only when it does not. Scripts and styles
   * stay cache-first; the activate step clears every older release's cache,
   * so a page and its scripts still always come from one release.
   */
  if (request.mode === "navigate") {
    const timeout = new Promise(function (resolve) { setTimeout(function () { resolve("slow"); }, NAV_WAIT_MS); });
    event.respondWith(
      Promise.race([network, timeout]).then(function (response) {
        if (response && response !== "slow") {
          if (response.redirected) return Response.redirect(response.url, 303);
          if (response.ok) return response;
        }
        return caches.open(CACHE_VERSION)
          .then(function (cache) { return cache.match(request, { ignoreSearch: true }); })
          .then(function (cached) {
            if (cached) return cached;
            /* nothing cached: wait for the server after all */
            return network.then(function (late) {
              if (late && late.redirected) return Response.redirect(late.url, 303);
              if (late) return late;
              return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
            });
          });
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.match(request, { ignoreSearch: true }); })
      .then(function (cached) {
        if (cached) return cached;
        return network.then(function (response) {
          /*
           * A redirected response must not be handed to a NAVIGATION. Page
           * loads carry redirect mode "manual", and Chrome refuses a
           * response with redirected:true for them -- the tab shows
           * ERR_FAILED, "This site can't be reached", with the server log
           * showing a perfectly healthy 302. That is exactly what a person
           * sees the first time they open the tool after a restart (which
           * logs everyone out) on a version whose shell cache is still
           * empty. Hand the browser the redirect instead and let it follow.
           */
          if (response && response.redirected && request.mode === "navigate") {
            return Response.redirect(response.url, 303);
          }
          if (response) return response;
          /*
           * Nothing cached and nothing reachable. For a navigation this is a
           * page the technician has never opened on this device; saying so
           * plainly beats the browser's dinosaur, because it tells them what
           * to do about it.
           */
          if (request.mode === "navigate") {
            return new Response(OFFLINE_PAGE, {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" }
            });
          }
          return new Response("", { status: 504, statusText: "Offline" });
        });
      })
  );
});

/* Kept inline rather than as a cached file: a fallback page that itself has to
   be fetched is a fallback that can be missing. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline | Wilson AC &amp; Appliance</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#12331f; color:#f4f8f5; display:grid; place-items:center; min-height:100vh; padding:24px; }
  .box { max-width:26rem; text-align:center; }
  h1 { font-size:1.4rem; margin:0 0 .6rem; }
  p { line-height:1.55; color:#c8d8cd; margin:0 0 .8rem; }
  a { color:#fff; font-weight:700; }
</style></head><body><div class="box">
<h1>This page isn't saved on your phone yet</h1>
<p>You're offline, and this is a page you haven't opened on this device before, so there's no copy to fall back on.</p>
<p>Any field work you have already done is saved here and is not lost. Open it again once you have signal, and it will be waiting.</p>
<p><a href="site-walk.html">Back to the field tool</a></p>
</div></body></html>`;
