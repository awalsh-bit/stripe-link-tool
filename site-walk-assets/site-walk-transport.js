/* Wilson site walk — portal sync transport
   ========================================

   The seam the offline-first outbox plugs into when the tool is served by the
   portal rather than opened as a single file. Nothing in the field flow depends
   on this being present: without it the walk still saves on the phone and the
   banner says so, which is the whole point of the outbox.

   What it does is narrow on purpose. It posts each walk's syncPayload to
   /api/sitewalk/sync and resolves. It does not merge, it does not pull, and it
   does not decide anything: the phone is the authority on what it measured, and
   the server settles which arrival is newest by comparing the walk's own
   updatedAt (see sitewalk_sync.py).

   One walk per request, because a phone on one bar of signal at a jobsite will
   get a small request through and lose a large one, and a walk that syncs is
   worth more than a batch that does not. A failure on any walk rejects, which
   leaves the outbox pending and lets the core's own retry schedule handle it.
*/
(function () {
  "use strict";

  var SW = window.WILSON_SW;
  if (!SW || !SW.setTransport) return;

  var ENDPOINT = (SW.apiUrl && SW.apiUrl("sync", "/api/sitewalk/sync")) || "/api/sitewalk/sync";

  /* Only the walks that have moved since the last successful send. The core
     stamps a revision on the way out so a walk nobody touched is not posted
     again on every retry. */
  function pending(state) {
    return (state.walks || []).filter(function (w) {
      return !w.syncRev || w.syncRev !== w.updatedAt;
    });
  }

  /* Opened by double-clicking the file: there is no server behind a
     file:// page, so every send fails with the browser's "Failed to fetch"
     (Cayden's office, 22 Oct). Say what to do instead. */
  var FILE_PAGE = !/^https?:$/.test(location.protocol);
  function post(payload) {
    if (FILE_PAGE) {
      return Promise.reject(new Error("!This page was opened as a file, so it cannot reach the shop server. Open it from the address the server window shows — http://localhost:8080/site-walk-office.html — and the walks will send."));
    }
    return doPost(payload).catch(function (err) {
      /* "Failed to fetch" is the browser's phrase for "no answer at all":
         the server window is closed, this page came from a different
         server than the one still running, or the request was cut off.
         Say that, not the phrase (Cayden, 22 Oct). */
      if (err && /Failed to fetch|NetworkError|Load failed/i.test(err.message || "") && !err.code) {
        var e2 = new Error("!The shop server at " + location.host + " did not answer — is its window still open, and was this page opened from that same window's address?");
        throw e2;
      }
      throw err;
    });
  }
  function doPost(payload) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* The portal authenticates with its session cookie, the same as every
         other page; there is no separate key to leak into a field device. */
      credentials: "same-origin",
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (res.status === 401) {
        var authErr = new Error("sign in");
        authErr.code = "sign in on the portal";
        throw authErr;
      }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.ok === false) {
          var err = new Error((body.error || ("HTTP " + res.status)) + (res.status >= 500 ? " (HTTP " + res.status + " — see the server window)" : ""));
          /* A payload the server will never accept must not be retried
             forever — surface it so somebody looks at it. */
          err.code = res.status === 400 ? "rejected" : "failed";
          throw err;
        }
        return body;
      });
    });
  }

  SW.setTransport(function (state) {
    var walks = pending(state);
    if (!walks.length) return Promise.resolve(true);

    return walks.reduce(function (chain, walk) {
      return chain.then(function () {
        return post(SW.syncPayload(walk)).then(function (body) {
          /* Stamp what was sent, not "now": anything the tech changes while
             the request is in flight leaves the walk pending, which is what
             the outbox's own bookkeeping expects. */
          walk.syncRev = walk.updatedAt;
          walk.syncedAt = (body && body.receivedAt) || new Date().toISOString();
          SW.scheduleSave();
        });
      });
    }, Promise.resolve());
  }, "the shop dashboard");
}());
