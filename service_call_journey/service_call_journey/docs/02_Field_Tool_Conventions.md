# Field tool conventions to inherit (from wilson_maintenance_portal_v0965)

Source: tech-maintenance.html / assets/tech-maintenance.js / tech-answers.js / photo-store.js / photo-sync.js / offline.js / wilson.css / docs/V08_DECISIONS.md. Studied 9/11/2026 to model the **service field tool** on. Zip is in `reference/`.

## Visual tokens (verbatim, wilson.css)
```css
:root {
  --wilson-green:#155b26; --wilson-green-dark:#0f471d; --wilson-green-soft:#dcecdf; --wilson-green-pale:#eef6f0; --wilson-lime:#72c681;
  --ink:#0d1b2a; --muted:#64748b; --muted-2:#8793a4; --line:#d9e3df; --line-strong:#cbd8d1; --card:#ffffff;
  --danger:#b42318; --danger-bg:#fff0ef; --warning:#9a5b00; --warning-bg:#fff7e7; --info:#245ea8; --info-bg:#eef5ff; --success:#16713a; --success-bg:#eaf7ed;
  --shadow:0 15px 40px rgba(21,65,40,.09); --shadow-soft:0 8px 24px rgba(21,65,40,.07);
  --radius-xl:24px; --radius-lg:18px; --radius-md:13px; --radius-sm:10px; --content:1390px;
}
```
Font: Inter / system stack, 16px base, numerics in IBM Plex Mono with tabular-nums. Body background: radial green wash over a light gradient.
Buttons: `.button` min-height 44px (48px in the sticky bottom bar), radius 11px, green fill, white, weight 800, soft green shadow; `.secondary` green-on-pale; `.ghost` white. Answer keys `.tech-opt` are 52px tall. Chips `.tech-chip` 999px radius, min-height 44px.
Banner: green gradient (135deg dark→green), radius 22px, white text, decorative circle, progress pills + 8px bar. Not sticky. Bottom action bar is sticky and nothing may cover it.

## Interaction rules
- Tap-only. No sliders (an unanswered reading must look unanswered). No typing during a protocol: keypad for numbers, chips for reasons/work performed, one free-text note per unit.
- `rating: null` ≠ 0. One function decides outcome state.
- Every option carries an explicit score/result in config; `null` = honest non-answer. Every pick-list has an escape ("could not see") and a separate N/A button.
- Guided ordering: one Suggested Next Step, then attention items, then areas with per-area %. In-progress outranks untouched. Auto-advance to the next unfinished check unless the current one still owes a required reading/reason/photo.
- Autosave: 450ms debounce → silent save → "Saving…/Saved" chip. Surgical DOM updates to preserve scroll/focus.
- Photos: `<input type="file" accept="image/*" capture="environment">`; downscale to 1600px JPEG q0.82; write Blob to IndexedDB (`wilson-field-photos`, keyPath id, indexes byVisit/byAsset/byUpload) BEFORE the label says "✓ Photo saved". Required-photo state flips only after the write resolves. `uploaded` is a string "no"/"yes".
- Sync: POST /api/photos one at a time with metadata headers; mark uploaded only on response.ok && body.ok; stop on 401/network; 3 attempts for 4xx; never delete local copy. Trigger on load(+1.2s), visibilitychange, online — no timers.
- Offline banner wording: "saved on this phone… not been sent anywhere yet". Reachability from the service worker, not navigator.onLine.
- Readiness strip names exactly what's missing; the disabled Complete button repeats the blocker.
- No second login (identity from host session). No fallback record — launch must carry an exact id.
- Deliberately not built: sliders; a one-tap "everything else is normal" button.

## Data shape to mirror
Inspection keyed by (visitId, assetId) with id, technician, updatedAt, serialPhoto id, maintenanceDone[], generalNote, generalPhotos[], checks[{id, rating|null, performed, notApplicable, selection, readings{}, detail, noteReasons[], noteText, photo}].
Photo record {id, visitId, assetId, checkId, kind, contentType, bytes, width, height, capturedAt, technician, uploaded, uploadAttempts, blob}.

## Service field tool adaptations (decided 9/11)
- Serial-tag photo **required on SO1 new diagnostics only**; on return trips (SO6 install, revisit) the existing tag photo is shown and not re-required.
- Notes live in the dashboard Service Order, not ePASS (blueprint §5.2 and §9 for what still gets keyed).
- Arrive / complete taps recorded per stop to learn durations and tech speed.
- Contact preference passes through and only defaults the tech's button: Call (Podium) or Text.
- Field quote: flat-rate tasks + catalog parts, tax by unit install type, customer signature on the phone, card on file charged at completion.
