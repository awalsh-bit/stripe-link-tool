# 18 — Agility integration review: what's built, what's safe, what's next

*2026-09-19. For Andrew and Cayden. Written after reading docs 13–17, the Phase 0 code (`phase0/wilson_service/`), and the Agility port (`lib/service-journey-postgres.js`). Companion to the client self-scheduling build that shipped the same day.*

## 1. How the project is actually built (the untangling)

There are three layers in this folder, and they are at very different stages of maturity. Keeping them separate is most of the untangling.

**Layer A — the Agility port (running in production since 9/12).** `lib/service-journey-postgres.js` plus `/api/service-journey/*` and `service-journey.html`. It mirrors ePASS into the `sj_*` tables: techs, zones, ZIP→zone, jobs, job lines, status history, sync packets, recalls, import batches, settings. It is fed by the on-prem ePASS agent pushing DispatchTrack exports (`POST /api/epass-agent/upload?kind=dispatch`) and by manual ExportInvoice uploads. This is real, live, and read-mostly: it never writes to ePASS, and its "sync" is paste-ready packets that a person keys in.

**Layer B — Phase 0 in Python (`phase0/`).** Cayden's "spec as runnable code": placement, capacity controls, intake, status engine, labor pricing, handoff, tracker, sync. Doc 13 §1 is explicit that this is a reference implementation, not what ships — Render cannot reach the shim on port 8765, and the target is Node + Postgres. Roughly a third of Phase 0 was already ported into Layer A (schema, importers, status engine, sync queue, stale/recall rules). The rest — placement, capacity, offers, intake-from-card, scorecard, tracker, labor pricing, handoff — existed only in Python until today.

**Layer C — the docs 14–17 feedback rounds (9/19).** Field tool wording, labor rate cards, warranty rate cards, damage reports, quotes the office can start, drag-a-day-onto-the-board. These are product decisions and copy for the field tool and office board; very little of it is code yet, and most of it depends on Layer B being ported first. Nothing in Layer C should be built before its Layer B foundation exists in Agility.

The confusion risk is that the Python *looks* finished (3,600 lines, tests, a CLI) while the only thing that touches production is Layer A. Anything Andrew wants live has to be ported into `lib/` — the Python cannot be executed by Render at all.

## 2. What shipped today: client self-scheduling (step 2 of the request form)

This is the first piece of Layer B in Agility, ported as `lib/service-scheduling-postgres.js` (350 lines, pure engine over the `sj_*` tables that Layer A already fills).

**What the client sees.** After `applianceservice.html` or `hvacservice.html` submits, the browser continues to `schedule.html?r=<token>`. The ZIP's booking mode (from `sj_zip_zones` / `sj_zones`) decides the page: *open* → "Almost done — when should we come?" with up to seven days, the top one labelled "Earliest available" per Cayden's 9/17 wording; *designated_days* → the grouped-trip copy and "Finish request — text me a date"; *office_only* → "we'll call within one business day". The day is the engine's; the client only adds a morning/afternoon/any preference. Confirmation is the page itself. **Nothing is texted or emailed** — the standing rule holds; Client Care sends anything that gets sent, and the queue card has a "Copy scheduling link" button for exactly that.

**What the office sees.** The Service Request Queue card carries a block under the status badge: "Client picked Mon 09/21/2026 · Morning — suggested tech DLA (DS). Book it in ePASS, then set Call Scheduled", or "Client: none of the offered days fit — text other dates", or "Client expects a call". Setting the card to Call Scheduled or Call Cancelled releases the hold; "Clear pick" does it by hand.

**How the engine works** (`placement.suggest` / `placement.offer`, ported faithfully). For each business day in the horizon and each active, `auto_schedule` tech with the skill, it takes the stops DispatchTrack shows for that tech that day (`sj_jobs` open rows on that `route_date`) plus any picked holds, estimates work minutes (60 appliance / 90 HVAC / +30 per extra unit) and drive minutes (4 + 1.55 per km, haversine, shop-to-shop), and keeps the day if shift minus load minus the new stop leaves at least 25 minutes of slack. Cost = added drive − 6 × same-zone stops (max 3) + wait cost (8/day for two days, 20/day after) + zone-rank penalty (0 primary, 10 secondary, 40 other). The customer's calendar starts on the cheapest day within three business days of the first open day. Every weight is an `sj_settings` key with the Phase 0 default (`placement.*`, `offer.*`, `booking.*`, `duration.defaults`), so tuning is a settings row, not a deploy. `booking.self_schedule_enabled = false` turns the picker off for everyone in one write.

**Why it cannot break anything.** It reads Layer A and writes only two new tables (`sj_self_holds`, `sj_tech_days`) and one JSON field on the queue card (`selfSchedule`). It never touches `sj_jobs`, never writes to ePASS, and the request itself succeeds even if the database is down (the form then shows the classic confirmation panel). The parking-Saturday problem in doc 13 §3.1 does not reach it: only days a tech works are ever offered, so a parked Saturday `route_date` is neither offered nor counted.

**Known gaps, on purpose.** HVAC requests get the office-only copy today because every HVAC tech is `auto_schedule = false` in the roster (the office decides HVAC). Flip a tech's `auto_schedule` in `sj_techs` and HVAC self-scheduling starts working with no code change. The tech named on the queue card is a *suggestion* — the dispatcher still books in ePASS, and the engine's suggestion is kept in `pick_meta` so we can score it against what the dispatcher actually did (the shadow test in doc 11, without the shim).

## 3. What can safely be executed into Agility, in order

Safe means: reads Layer A, adds tables or settings, never rewrites `sj_jobs` keys, never contacts a customer on its own, and can be turned off with a setting.

1. **Parking-day rule and status upper-casing in the importers** (doc 13 §3.1–3.2). Not yet in the port. It is a pure helper (`isParkingDay`) and two call sites, plus a one-off pass over existing rows. It fixes a live data bug (182 of 460 open tickets carrying a phantom Saturday) and makes every date-grouped view honest. Half a day. Do this first.
2. **RCALL → confirmed recall.** Already in the port (`detectRecall` treats the ePASS `RCALL` flag as confirmed). Nothing to do.
3. **Dispatcher day controls** (`capacity.py`). The `sj_tech_days` table and `POST /api/service-journey/techs/:code/day` shipped today; what's missing is a small UI on `service-journey.html` — a tech × next-30-days grid to close a day, open a Saturday, or add/subtract minutes. Pure UI over an existing route. A morning's work.
4. **Placement suggestions for the office** ("what would the engine offer this ZIP?"). `GET /api/service-journey/offer?zip=&skill=&units=` shipped today and returns the full internal view (tech, cost, "why"). Surfacing it on the queue card — "Engine suggests: Mon DLA (route already in DS), Tue TDP…" — costs nothing and lets Cayden sanity-check the weights against real days before anything depends on them.
5. **Notification toggles, all off.** Every doc 09 template becomes an `sj_settings` switch, off on arrival, sent only by explicit click. This is a prerequisite for anything customer-facing beyond the confirmation page, and it is the standing rule written into the data.
6. **Intake from the queue card, done right** (doc 13 §4). `POST /api/service-journey/jobs/from-request {serviceCardId}` creating a `source='dashboard'` row with a provisional `REQ-` key, **and** the importer-side match so the next DispatchTrack push re-keys that row instead of inserting a duplicate. This is the one piece with a real design decision inside it (§4 below). It should replace the AJH pilot's "Copy to AJH test module" button, which today writes to the retiring `pilot_*` tables.

## 4. What is risky, and why

**The `sv_number` primary key re-key (doc 13 §4).** Six child tables key on `sv_number`. If the importer doesn't match the REQ row before inserting, every attach becomes a merge across five tables. The cheap fix (match by phone, or last name + ZIP, within `intake.match_window_days`, inside the importer) is right, but it is the kind of change that can silently create or swallow rows in production. It needs fixture tests off the real exports before it runs live. Not a weekend job; not something to do at the same time as anything else on this list.

**Anything that writes toward ePASS.** The sync queue is paste-packets keyed by a person, and that is the safe shape. Nothing in Phase 0 should be promoted to "Agility changes ePASS" — the outbound-only rule and the fact that ePASS is the system of record both say no.

**Automated customer contact.** `tracker.py` and the doc 09 template matrix assume texts on status change. The standing rule is explicit: click or toggle, never on its own. Item 5 above is how that stays true as more templates arrive.

**Purchasing behind a flag, labor rate cards, warranty rate cards (docs 14–16).** These are pricing decisions with money attached, and the docs themselves say the team hasn't settled them ("what I still need" in 16 and 17). Build nothing here until the office signs the rate card; the estimate flow already lives in `service_estimates` and should stay the one approval path (doc 13 §2).

## 5. The capacity-throttling / routing decision

Andrew said the team is undecided about the "new capacity throttling and routing integration tool". My recommendation is to split the question, because the two halves have very different risk.

**Capacity throttling — use it, gently, and only for self-scheduling.** It is already live as of today in the only place it is safe: deciding which days a *client* may pick. It can't over-book because the office still books in ePASS; the worst case is that a client is offered a day the dispatcher would rather not use, and the dispatcher moves it with a phone call — which is what happens today with every request anyway. Run it for two or three weeks, compare `sj_self_holds.tech_code` / `picked_date` with what the dispatcher actually booked (`sj_jobs.assigned_tech` / `route_date` once the importer match exists), and tune the weights in `sj_settings`. If the picks are mostly right, widen `auto_schedule` to more techs; if they're mostly wrong, `booking.self_schedule_enabled = false` and nothing else changes.

**Routing integration — don't, not yet.** DispatchTrack already routes, and ePASS already owns the schedule. A second router that only *suggests* adds nothing the dispatcher doesn't already see, and one that *decides* would need the ePASS write path we have ruled out. The valuable part of Phase 0's routing work is the "why" — same-zone stops, added drive, primary tech — and that is now exposed on `GET /api/service-journey/offer` for the office to look at. Revisit routing only if the shadow scorecard shows the engine's day choice beating the dispatcher's consistently, and even then as a suggestion on the board (doc 17 "drag a day onto the board"), never as a write.

## 6. Housekeeping that protects the build

- `reference/data/` holds customer PII exports. It has a `.gitignore`; keep it that way and never copy those files into the Agility repo.
- The Python stays as the reference and the place to prove rules against exports. Don't delete it, but don't extend it either — new rules go in `lib/` as pure functions with `node --test` fixtures.
- Placement weights, offer windows and durations are `sj_settings` rows. Change numbers there, not in code, so the Sep-10 replay (doc 08) stays reproducible.
- Every customer-facing sentence on `schedule.html` came from doc 09 §2a/§4 with two deliberate departures: no "we've texted you a confirmation" (nothing is texted) and no "you'll get a text the day before" (same reason). If those texts become click-to-send tools in the office, the copy can say so again.
