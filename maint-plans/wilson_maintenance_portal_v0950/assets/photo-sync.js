(function () {
  /*
   * GETTING PHOTOGRAPHS OFF THE PHONE.
   *
   * WHY THIS EXISTS
   * ---------------
   * Photographs are the strongest evidence in the whole tool -- a serial plate
   * proves a technician stood at the appliance, a coil before and after proves
   * it was actually cleaned -- and until now every one of them lived in exactly
   * one place: the IndexedDB of the phone that took it. A dropped phone, a
   * cleared browser, a tech who leaves, and the evidence for a customer's
   * maintenance history is gone with no trace that it ever existed.
   *
   * That is fine for a demo and not fine for a real stop, so this drains
   * WILSON_PHOTOS.pendingUpload() to the store's own machine.
   *
   * THE RULES IT FOLLOWS
   * --------------------
   * 1. A photograph is only marked as safe when the server has said, in a
   *    response, that it wrote it. Not when the request was sent, not when it
   *    seemed to work. The pending count is the truth and it has to stay true;
   *    a technician deciding whether it is safe to clear their browser is
   *    relying on it.
   * 2. The local copy is never deleted. Uploading is a second copy, not a move.
   *    Deleting after an upload would mean one bad server response could lose
   *    the only image, and the phone is where the report renders them from.
   * 3. Failures do not spin. A dead network stops the drain; a rejected file
   *    (too large, wrong type) is recorded on the record and retried a bounded
   *    number of times, so a single bad photo cannot block the queue behind it
   *    or hammer the machine forever.
   * 4. Nothing here says "synced" unless it is. The wording in the UI is
   *    "waiting to upload" until the server has them, which is the same rule
   *    the offline banner follows.
   */

  const ENDPOINT = "/api/photos";
  const MAX_ATTEMPTS = 3;

  /* One at a time. A job-site connection does better with a single stream than
     with six competing ones, and a serial drain makes the pending count move
     visibly rather than in one jump at the end. */
  let running = false;
  let listeners = [];
  let lastOutcome = null;

  function notify(state) {
    lastOutcome = state;
    listeners.forEach(function (fn) {
      try { fn(state); } catch (err) { /* a listener must not break the drain */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    };
  }

  function headersFor(record) {
    const h = {
      "Content-Type": record.contentType || "image/jpeg",
      "X-Photo-Id": record.id,
      "X-Visit-Id": record.visitId || "",
      "X-Asset-Id": record.assetId || "",
      "X-Check-Id": record.checkId || "",
      "X-Photo-Kind": record.kind || "",
      "X-Captured-At": record.capturedAt || "",
      "X-Technician": record.technician || ""
    };
    Object.keys(h).forEach(function (k) { if (!h[k]) delete h[k]; });
    return h;
  }

  function uploadOne(record) {
    if (!record.blob) {
      return Promise.resolve({ ok: false, fatal: true, error: "no image on this record" });
    }
    return fetch(ENDPOINT, {
      method: "POST",
      headers: headersFor(record),
      body: record.blob,
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (response.ok && body && body.ok) {
          return { ok: true, body: body };
        }
        /* 401 is not this photo's fault: the session expired. Stop the whole
           drain rather than burning attempts on every queued photo. */
        if (response.status === 401) {
          return { ok: false, signedOut: true, error: body.error || "signed out" };
        }
        /* The server refused this particular file and always will. */
        const fatal = response.status === 413 || response.status === 415 || response.status === 400;
        return { ok: false, fatal: fatal, status: response.status,
                 error: (body && body.error) || ("HTTP " + response.status) };
      });
    }, function (err) {
      /* No response at all: offline, server stopped, DNS gone. Not this
         photo's fault either. */
      return { ok: false, offline: true, error: (err && err.message) || "no connection" };
    });
  }

  /*
   * Drain the queue.
   *
   * Returns what actually happened, and never throws: this is called from a
   * page-load path and from a banner, and neither should break because a
   * photograph did not go up.
   */
  function drain(options) {
    const opts = options || {};
    if (running) return Promise.resolve({ skipped: "already running" });
    if (!window.WILSON_PHOTOS) return Promise.resolve({ skipped: "no photo store" });

    /* The worker knows whether the network is answering. Don't start a drain
       into a dead network just to fail once per photo. */
    if (!opts.force && window.WILSON_OFFLINE && window.WILSON_OFFLINE.reachable
        && window.WILSON_OFFLINE.reachable() === false) {
      return Promise.resolve({ skipped: "offline" });
    }

    running = true;
    const result = { uploaded: 0, failed: 0, skipped: 0, remaining: 0, stoppedBecause: null };

    return window.WILSON_PHOTOS.pendingUpload().then(function (rows) {
      const queue = rows.filter(function (r) {
        return opts.includeStuck || Number(r.uploadAttempts || 0) < MAX_ATTEMPTS;
      });
      result.skipped = rows.length - queue.length;

      function step() {
        if (!queue.length) return Promise.resolve();
        const record = queue.shift();
        notify({ phase: "uploading", id: record.id, left: queue.length + 1 });

        return uploadOne(record).then(function (outcome) {
          if (outcome.ok) {
            result.uploaded += 1;
            return window.WILSON_PHOTOS.markUploaded(record.id, outcome.body).then(step);
          }
          if (outcome.signedOut || outcome.offline) {
            /* Stop the drain, leave the queue alone, say why. */
            result.stoppedBecause = outcome.signedOut ? "signed-out" : "offline";
            return Promise.resolve();
          }
          result.failed += 1;
          return window.WILSON_PHOTOS.markUploadFailed(record.id, outcome.error).then(step);
        });
      }

      return step();
    }).then(function () {
      return window.WILSON_PHOTOS.pendingUpload();
    }).then(function (rows) {
      result.remaining = rows.length;
      running = false;
      notify({ phase: "done", result: result });
      return result;
    }).catch(function (err) {
      running = false;
      const failure = { phase: "error", error: (err && err.message) || String(err) };
      notify(failure);
      return { error: failure.error };
    });
  }

  function pendingCount() {
    if (!window.WILSON_PHOTOS) return Promise.resolve(0);
    return window.WILSON_PHOTOS.pendingUpload()
      .then(function (rows) { return rows.length; })
      .catch(function () { return 0; });
  }

  /*
   * When to try.
   *
   * On load, and when the tab comes back to the front -- which is the moment a
   * technician has walked out of a mechanical room and back into signal. Not on
   * a timer: a timer that fires in a basement is a battery drain and a
   * misleading UI, and the visibility event covers the case that matters.
   */
  function autoDrain() {
    drain().then(function (r) {
      if (r && r.uploaded) {
        console.info("[wilson] uploaded " + r.uploaded + " photo(s); " + r.remaining + " still waiting");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    /* A moment after load: the page should paint first, and the service worker
       needs a beat to form an opinion about the network. */
    window.setTimeout(autoDrain, 1200);
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) window.setTimeout(autoDrain, 400);
  });

  window.addEventListener("online", function () { window.setTimeout(autoDrain, 600); });

  /* -------------------------------------------------------------------
     WHAT THE TECHNICIAN SEES

     A count they can act on, in the page rather than in a console. It is
     deliberately not a fixed overlay: the field tool's Complete button is
     sticky at the bottom of the screen and covering it would be a worse bug
     than the one this fixes.

     The wording never gets ahead of the facts. Until the server has a
     photograph it is "on this phone", and the only sentence that says
     otherwise is written after a response that said so.
     ------------------------------------------------------------------ */
  const CHIP_ID = "wilson-photo-sync";

  function onFieldTool() {
    return /tech-maintenance\.html$/.test(window.location.pathname);
  }

  function chip() {
    let node = document.getElementById(CHIP_ID);
    if (!node) {
      const host = document.querySelector("main") || document.body;
      node = document.createElement("div");
      node.id = CHIP_ID;
      node.className = "photo-sync-chip no-print";
      node.setAttribute("role", "status");
      host.insertBefore(node, host.firstChild);
    }
    return node;
  }

  function hideChip() {
    const node = document.getElementById(CHIP_ID);
    if (node) node.remove();
  }

  function paintChip() {
    if (!onFieldTool() || !window.WILSON_PHOTOS) return;
    window.WILSON_PHOTOS.stats().then(function (s) {
      const waiting = s.pending || 0;
      const stuck = s.stuck || 0;
      if (!waiting && !justFinished) { hideChip(); return; }

      const node = chip();
      if (waiting) {
        const one = waiting === 1;
        node.className = "photo-sync-chip no-print" + (stuck ? " stuck" : "");
        node.innerHTML =
          "<strong>" + waiting + (one ? " photograph is" : " photographs are") +
          " on this phone and not uploaded yet.</strong> " +
          (stuck
            ? "The shop machine refused " + (stuck === 1 ? "one of them" : stuck + " of them") +
              ". It is still saved here. "
            : "They upload on their own once the shop machine is reachable. ") +
          '<button type="button" data-photo-retry>Try now</button>';
      } else {
        node.className = "photo-sync-chip done no-print";
        node.innerHTML = "<strong>All photographs are on the shop machine.</strong> " +
          "The copies on this phone stay here too.";
        window.setTimeout(function () {
          if (justFinished) { justFinished = false; paintChip(); }
        }, 6000);
      }
      const button = node.querySelector("[data-photo-retry]");
      if (button) {
        button.onclick = function () {
          button.disabled = true;
          button.textContent = "Trying...";
          drain({ force: true, includeStuck: true }).then(function () { paintChip(); });
        };
      }
    }).catch(function () { /* a status line must never break the tool */ });
  }

  let justFinished = false;

  onChange(function (state) {
    if (state && state.phase === "uploading") {
      if (!onFieldTool()) return;
      const node = chip();
      node.className = "photo-sync-chip no-print";
      node.innerHTML = "<strong>Uploading photographs...</strong> " + state.left + " to go.";
      return;
    }
    if (state && state.phase === "done") {
      justFinished = (state.result && state.result.uploaded > 0) || false;
      paintChip();
    }
  });

  document.addEventListener("DOMContentLoaded", function () { paintChip(); });

  window.WILSON_PHOTO_SYNC = {
    refresh: paintChip,
    drain: drain,
    pending: pendingCount,
    onChange: onChange,
    last: function () { return lastOutcome; },
    maxAttempts: MAX_ATTEMPTS,
    endpoint: ENDPOINT
  };
})();
