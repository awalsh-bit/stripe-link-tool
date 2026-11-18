(function () {
  /*
   * FIELD PHOTOGRAPHS, KEPT.
   *
   * Until v0.9.12 the field tool recorded that a photo had been taken -- a
   * boolean and a filename -- and threw the image away. The report then printed
   * "3 photos associated with this report in the production workflow", so a
   * customer was shown a count with nothing behind it. That is the pencil-
   * whipped service report this product exists to replace, wearing a badge.
   *
   * Photo evidence is the strongest thing in the whole tool. A serial-tag
   * photograph proves a technician stood at the appliance. A condenser coil
   * before and after proves the coil was actually cleaned. No amount of
   * checkbox discipline substitutes for it, and no competitor does it well for
   * appliances.
   *
   * WHY INDEXEDDB
   * -------------
   * localStorage is the demo backend for everything else, but it holds strings
   * and is capped around 5MB. Three photos per appliance across a sixteen-
   * appliance estate is hundreds of images. IndexedDB stores Blobs natively,
   * has no practical size ceiling at this scale, and -- the part that matters
   * for a technician in a mechanical room with no signal -- works entirely
   * offline.
   *
   * WHY IMAGES ARE DOWNSCALED
   * -------------------------
   * A modern phone camera produces 3-6MB per frame. Storing that is pointless:
   * the report renders these a few hundred pixels wide, and a real upload path
   * has to move them over a job-site connection. Each image is re-encoded to
   * fit within MAX_EDGE at JPEG quality 0.82 before it is stored, which lands
   * around 150-400KB while staying sharp enough to read a serial plate.
   *
   * WHERE THEY GO NEXT
   * ------------------
   * This store is the capture point, not the archive. photo-sync.js drains
   * `pendingUpload()` to the store's own machine, and `markUploaded` is only
   * called when the server has confirmed the write -- so the pending count
   * stays honest and a technician can trust it before clearing a browser.
   *
   * The local copy is never deleted on upload. A report renders its images
   * from here, so a report opened on another device still will not find them
   * and still says so rather than pretending.
   */

  const DB_NAME = "wilson-field-photos";
  const DB_VERSION = 1;
  const STORE = "photos";

  /* Long edge in pixels. 1600 keeps a serial plate readable when a viewer zooms
     in, which is the whole point of taking that particular photograph. */
  const MAX_EDGE = 1600;
  const QUALITY = 0.82;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("This browser has no IndexedDB, so field photos cannot be stored."));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          /* Everything a visit captured, in one query -- that is how the report
             and the future upload path both read this. */
          store.createIndex("byVisit", "visitId", { unique: false });
          store.createIndex("byAsset", "assetId", { unique: false });
          store.createIndex("byUpload", "uploaded", { unique: false });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("IndexedDB could not be opened.")); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return openDb().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function newId() {
    /* Time-ordered so a listing reads in capture order without a sort. */
    return "photo_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /*
   * Re-encode to something worth storing and worth uploading.
   *
   * Falls back to the original file if anything in the canvas path fails --
   * a photograph at full size is far better than no photograph, and a decode
   * failure on one odd HEIC should not lose a technician's evidence.
   */
  function downscale(file) {
    return new Promise(function (resolve) {
      if (!window.createImageBitmap || !document.createElement("canvas").getContext) {
        resolve({ blob: file, width: null, height: null, resized: false });
        return;
      }
      window.createImageBitmap(file).then(function (bitmap) {
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, w, h);
        if (bitmap.close) bitmap.close();
        canvas.toBlob(function (blob) {
          /* Re-encoding is only worth it if it actually saves bytes. A small
             flat PNG comes out LARGER as JPEG, and storing the bigger copy of
             the same picture is pure loss. */
          if (blob && blob.size < file.size) {
            resolve({ blob: blob, width: w, height: h, resized: scale < 1 });
          } else if (blob && scale < 1) {
            /* Genuinely smaller pixel dimensions still win, even at equal bytes:
               it is what keeps a job-site upload finite. */
            resolve({ blob: blob, width: w, height: h, resized: true });
          } else {
            resolve({ blob: file, width: bitmap.width, height: bitmap.height, resized: false });
          }
        }, "image/jpeg", QUALITY);
      }).catch(function () {
        resolve({ blob: file, width: null, height: null, resized: false });
      });
    });
  }

  /*
   * Store one photograph.
   *
   * `meta` says what it is evidence OF -- the visit, the appliance, the
   * checkpoint, and the kind (serial tag, condition, before/after). A photo
   * without that is a picture; with it, it is a record.
   */
  function put(file, meta) {
    if (!file) return Promise.reject(new Error("No file was provided."));
    const info = meta || {};
    return downscale(file).then(function (processed) {
      const record = {
        id: info.id || newId(),
        visitId: info.visitId || "",
        assetId: info.assetId || "",
        householdId: info.householdId || "",
        checkId: info.checkId || "",
        checkName: info.checkName || "",
        kind: info.kind || "condition",
        caption: info.caption || "",
        originalName: file.name || "",
        contentType: processed.blob.type || file.type || "image/jpeg",
        bytes: processed.blob.size || 0,
        originalBytes: file.size || 0,
        width: processed.width,
        height: processed.height,
        capturedAt: info.capturedAt || new Date().toISOString(),
        technician: info.technician || "",
        /* Set to "yes" by photo-sync.js only when the server has confirmed it
           wrote the file. Kept as a string because IndexedDB indexes cannot
           key on booleans. */
        uploaded: "no",
        uploadAttempts: 0,
        uploadError: "",
        blob: processed.blob
      };
      return tx("readwrite").then(function (store) {
        return wrap(store.put(record)).then(function () {
          const stored = Object.assign({}, record);
          delete stored.blob;
          return stored;
        });
      });
    });
  }

  function get(id) {
    if (!id) return Promise.resolve(null);
    return tx("readonly").then(function (store) { return wrap(store.get(id)); });
  }

  /* An object URL for rendering. The caller owns it and should revoke it when
     the node goes away; on these pages the node lives as long as the page. */
  function url(id) {
    return get(id).then(function (record) {
      return record && record.blob ? window.URL.createObjectURL(record.blob) : null;
    });
  }

  function byIndex(indexName, value) {
    return tx("readonly").then(function (store) {
      return wrap(store.index(indexName).getAll(value));
    });
  }

  function forVisit(visitId) { return byIndex("byVisit", visitId); }
  function forAsset(assetId) { return byIndex("byAsset", assetId); }

  function remove(id) {
    return tx("readwrite").then(function (store) { return wrap(store.delete(id)); });
  }

  /*
   * The upload path's two hands on a record.
   *
   * `uploaded` stays the single source of truth for "has this left the phone",
   * and only a server response moves it. `uploadAttempts` is what stops one
   * rejected photograph from blocking the queue behind it forever, and
   * `uploadError` is kept so the reason is visible instead of guessed at.
   */
  function markUploaded(id, info) {
    return tx("readwrite").then(function (store) {
      return wrap(store.get(id)).then(function (record) {
        if (!record) return null;
        record.uploaded = "yes";
        record.uploadedAt = new Date().toISOString();
        record.uploadError = "";
        if (info && info.bytes) record.uploadedBytes = Number(info.bytes) || 0;
        return wrap(store.put(record)).then(function () { return record.id; });
      });
    });
  }

  function markUploadFailed(id, reason) {
    return tx("readwrite").then(function (store) {
      return wrap(store.get(id)).then(function (record) {
        if (!record) return null;
        record.uploadAttempts = Number(record.uploadAttempts || 0) + 1;
        record.uploadError = String(reason || "upload failed").slice(0, 200);
        /* Deliberately still "no": a failed upload has not left the phone, and
           the pending count has to keep saying so. */
        record.uploaded = "no";
        return wrap(store.put(record)).then(function () { return record.id; });
      });
    });
  }

  /* What the upload path drains, oldest first. */
  function pendingUpload() {
    return byIndex("byUpload", "no").then(function (rows) {
      return rows.sort(function (a, b) { return String(a.capturedAt).localeCompare(String(b.capturedAt)); });
    });
  }

  function stats() {
    return tx("readonly").then(function (store) { return wrap(store.getAll()); }).then(function (rows) {
      return {
        count: rows.length,
        bytes: rows.reduce(function (sum, r) { return sum + Number(r.bytes || 0); }, 0),
        originalBytes: rows.reduce(function (sum, r) { return sum + Number(r.originalBytes || 0); }, 0),
        pending: rows.filter(function (r) { return r.uploaded === "no"; }).length,
        uploaded: rows.filter(function (r) { return r.uploaded === "yes"; }).length,
        stuck: rows.filter(function (r) {
          return r.uploaded === "no" && Number(r.uploadAttempts || 0) >= 3;
        }).length
      };
    });
  }

  window.WILSON_PHOTOS = {
    put: put,
    get: get,
    url: url,
    forVisit: forVisit,
    forAsset: forAsset,
    remove: remove,
    pendingUpload: pendingUpload,
    markUploaded: markUploaded,
    markUploadFailed: markUploadFailed,
    stats: stats,
    maxEdge: MAX_EDGE
  };
})();
