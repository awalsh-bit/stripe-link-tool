(function () {
  /*
   * OFFLINE STATUS, SAID HONESTLY.
   *
   * The service worker makes the app load without a connection. This tells the
   * technician what that actually means for their work, and the wording matters
   * more than it looks.
   *
   * There is NO SYNC. Nothing in this prototype uploads anything: the demo
   * backend is localStorage and IndexedDB, both on the device. So the banner
   * must not say "will sync when you reconnect" -- that is a promise the
   * product cannot keep, and a technician who believes it will assume their
   * photographs are safe on a server when they are on one phone. It says what
   * is true: saved on this device, nothing has been sent yet.
   *
   * When the real upload path exists, this is the one place that wording
   * changes, and `pendingCount()` is already counting the right things.
   */

  const BANNER_ID = "wilson-offline-banner";

  function pageIsFieldTool() {
    return /tech-maintenance\.html$/.test(window.location.pathname);
  }

  /*
   * What is on this device and has not left it.
   *
   * Photographs come from IndexedDB, field inspections from the demo store.
   * Both are counted rather than asserted, because a banner that says "3 items
   * saved" when there are none is the same class of untruth as the photo count
   * this product just removed.
   */
  function pendingCount() {
    const photos = window.WILSON_PHOTOS
      ? window.WILSON_PHOTOS.pendingUpload().then(function (rows) { return rows.length; }).catch(function () { return 0; })
      : Promise.resolve(0);

    let inspections = 0;
    try {
      const state = window.WilsonStore ? window.WilsonStore.load() : null;
      inspections = state ? (state.techInspections || []).filter(function (i) { return i.complete; }).length : 0;
    } catch (err) {
      inspections = 0;
    }

    return photos.then(function (photoCount) {
      return { photos: photoCount, inspections: inspections };
    });
  }

  function ensureBanner() {
    let node = document.getElementById(BANNER_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = BANNER_ID;
      node.className = "offline-banner no-print";
      node.setAttribute("role", "status");
      /* Polite, not assertive: losing signal mid-protocol should not interrupt
         a screen reader in the middle of a checkpoint. */
      node.setAttribute("aria-live", "polite");
      document.body.appendChild(node);
    }
    return node;
  }

  /*
   * Is the server actually reachable?
   *
   * `navigator.onLine` alone is not the answer -- it reports whether a network
   * interface exists, not whether anything is at the other end. A phone with
   * one bar in a mechanical room reports online while every request fails, and
   * that is precisely the case this banner exists for.
   *
   * So the authoritative signal comes from the service worker, which is
   * revalidating in the background anyway and knows whether those fetches are
   * succeeding. `navigator.onLine === false` is still trusted as an immediate
   * negative -- airplane mode needs no confirmation -- but a reported `true`
   * waits to be contradicted by the worker.
   */
  let workerSaysReachable = null;

  function isOffline() {
    if (!navigator.onLine) return true;
    return workerSaysReachable === false;
  }

  function render() {
    const offline = isOffline();
    const node = document.getElementById(BANNER_ID);

    if (!offline) {
      if (node) node.remove();
      document.body.classList.remove("is-offline");
      return;
    }

    document.body.classList.add("is-offline");
    const banner = ensureBanner();

    pendingCount().then(function (counts) {
      const held = [];
      if (counts.inspections) held.push(counts.inspections + " completed inspection" + (counts.inspections === 1 ? "" : "s"));
      if (counts.photos) held.push(counts.photos + " photograph" + (counts.photos === 1 ? "" : "s"));

      banner.innerHTML =
        '<strong>Working offline.</strong> ' +
        (pageIsFieldTool()
          ? 'Everything you enter is saved on this phone as you go. '
          : 'This page is running from a copy saved on this device. ') +
        (held.length
          ? held.join(" and ") + ' are held here and have not been sent anywhere yet.'
          : 'Nothing is waiting to be sent.');
    });
  }

  function register() {
    if (!("serviceWorker" in navigator)) return;
    /*
     * Service workers require a secure context. Over http:// this is only
     * granted on localhost, so the phone-over-hotspot case (http://192.168.x.x)
     * gets no offline capability -- there is nothing to be done about that from
     * here, and pretending otherwise would be worse than the limitation.
     */
    if (!window.isSecureContext) return;

    navigator.serviceWorker.register("sw.js").then(function (registration) {
      /* A waiting worker means a newer version of the files is installed and
         will take over on the next load. Worth surfacing only where it would
         otherwise confuse someone -- a technician mid-visit should not be
         nagged about it. */
      registration.addEventListener("updatefound", function () {
        console.info("[wilson] a newer copy of the app has been downloaded and will load next time.");
      });
    }).catch(function (err) {
      console.warn("[wilson] offline support unavailable:", err && err.message);
    });
  }

  window.addEventListener("online", function () {
    /* The interface came back. Whether the server is answering is a separate
       question, so this clears the worker's verdict rather than asserting a
       new one, and the next revalidation settles it. */
    workerSaysReachable = null;
    render();
  });
  window.addEventListener("offline", render);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", function (event) {
      const data = event.data || {};
      if (data.source !== "wilson-sw" || data.type !== "reachability") return;
      /* null means the worker has not yet formed an opinion -- keep waiting
         rather than treating "don't know" as "online". */
      workerSaysReachable = data.reachable === null ? null : Boolean(data.reachable);
      render();
    });
  }

  /*
   * Ask the worker what it already knows.
   *
   * Listening alone loses the first answer: on a cold load with no server the
   * navigation fails before this file has even been parsed, and the worker only
   * broadcasts on a change, so nothing is ever said again. Asking closes that
   * gap. Retried briefly because the controller is not attached on the very
   * first load of a session, when the worker is still installing.
   */
  function askWorker(attempt) {
    if (!("serviceWorker" in navigator)) return;
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage({ type: "reachability?" });
      return;
    }
    if ((attempt || 0) < 4) {
      setTimeout(function () { askWorker((attempt || 0) + 1); }, 400);
    }
  }
  document.addEventListener("DOMContentLoaded", function () {
    register();
    render();
    askWorker(0);
  });

  /* Coming back to the app after it has been in a pocket is the other moment
     the answer may have changed without any event firing. */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) askWorker(0);
  });

  /*
   * What the worker has actually observed. `null` means it has not formed an
   * opinion yet, and callers must treat that as "don't know" rather than as
   * either answer -- photo-sync uses it to avoid starting an upload run into a
   * network that is known to be dead, and starting one when the answer is
   * unknown is right: the attempt IS the probe.
   */
  function reachable() {
    if (!navigator.onLine) return false;
    return workerSaysReachable;
  }

  window.WILSON_OFFLINE = { pending: pendingCount, refresh: render, reachable: reachable };
})();
