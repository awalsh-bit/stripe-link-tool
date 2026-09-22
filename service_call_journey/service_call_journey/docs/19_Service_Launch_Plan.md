# 19 — Service journey on the ePASS feed: launch plan for self-scheduling, capacity and routing

*2026-09-21, evening. For Andrew and Cayden. Supersedes the order-of-work in doc 18 §3 now that Agility reads ePASS directly every 15 minutes (`scripts/epass-odbc-pull.ps1` → `epass_open_service` / `epass_open_orders`, live since 5:15 PM today). Companion: `docs/epass-odbc.md` §17 for the schema.*

## 1. What the feed changes

Everything in docs 04–13 assumed the service journey would be fed by the DispatchTrack export (a routing feed with status, date, truck and a geocode, refreshed every 15 minutes) plus a hand-uploaded ExportInvoice for the statuses DispatchTrack doesn't carry. The ODBC feed makes both redundant. Every open SV/WTY ticket now arrives with its full `Invoice` row (223 columns), every labor line, part, comment and note, fifteen minutes old at most, with no one exporting anything.

The `Invoice` row turns out to hold most of what the placement engine was told it would have to derive or seed. The important discoveries from the 9/21 schema dump:

| Engine needs | Docs said | ePASS actually has |
|---|---|---|
| Customer geocode | DispatchTrack `Latitude/Longitude`; new requests fall back to ZIP average | `Invoice.SoldToLatitude / SoldToLongitude` — populated on **612 of 612** open sales orders; `Customer.Latitude / Longitude` on the master. ePASS geocodes every customer itself. |
| Zone | DispatchTrack `Map Zone` | `Invoice.MapZoneCode` (599/612) and `Customer.MapZoneCode`; `MapZone` lookup carries per-weekday service flags and `DefaultCalls` capacity per day (DS 50, WIMB 22, ROUND 22, Sunday 6) |
| Zone shape | Census ZCTA outlines, source undecided (item 36) | `MapZoneVertices` / `MapZoneCoordinates` — ePASS's own zone polygons (not yet dumped; see §6) |
| Tech assignment | DispatchTrack `Truck` = SP code | `Invoice.DispatchRequestedRouteCode` before a trip exists; `InvoiceLabor.TechnicianCode` + `TripNo` once one does |
| Tech roster | `tech_roster.csv`, hand-kept | `Route` table: code, name, `StartTime` per tech, `DestinationCodeMon…Sun` (where the day starts/ends, by weekday), `LocationCode` (the van — SV02, SV07, HVAC1), email, cell. `RouteQualifications` (skills per route, not yet dumped), `RouteDepartment` (Service vs DELIVERY) |
| Skill / qualification | DispatchTrack `Qualifications` (APPL / HVAC) | `Invoice.Qualification` on the ticket, `Qualification` lookup, `RouteQualifications` for who can take it |
| Duration | Nothing — 30-minute placeholder; learn from `findings.on_site_minutes` after 28 days | `InvoiceLabor.TimeIn / TimeOut` and the header `SvcTimeStarted/OnJob/Completed` fields exist but are **not trustworthy** — they needed the MobileTech subscription or hand entry and were mostly left blank (Cayden, 9/21). The reliable input is `DispatchUnits`: on a service ticket **one unit = one hour** (Andrew). Planned time = units × 60; measured time from Samsara GPS dwells (§3 step 3). |
| Time window | None in ePASS (confirmed) | `DispatchTimeAM` / `DispatchTime` / `DispatchStartTime` exist but are `00:00` / `07:00` on every sales row; the service-side population is one of the probes in §6. Assume the engine still owns windows. |
| Stop sequence | Not in any export (item 32) | `DispRoute` table exists (ePASS's own routing table — not yet dumped) and `DispatchMeJob` (the DispatchMe feed) |
| Priority / recall / warranty | DispatchTrack `Priorites` | `Invoice.Priority` (WTY, RCALL, 1ST…), `SvcInWarranty`, `InvoiceLabor.Warranty` |
| Access notes, units, phones, email, preferred contact | DispatchTrack `Directions`; ExportInvoice has no phone/email | `SoldToDirections`, `DispatchUnits`, `SoldToPhone1/2`, `SoldToEmail`, `SoldToPreferredContact`, `SoldToPhone1TextEnabled` (texting consent flag) |
| Parts ETA | Kezia, by hand | `POModel.ETADate / ETADateMostUpdated / BackOrderInvoiceCode` — the PO line cut for the ticket, with the supplier's ETA (already in the sales bundle as `open-po-lines`; the same query with `SV`/`WTY` gives parts on order per ticket) |

Two of the "what I still need" items in docs 13–17 likely dissolve on contact with the schema: item 32 (stop order — `DispRoute`) and item 36 (ZCTA source — `MapZoneVertices`). A general caution from Cayden applies to every field in this table: ePASS has more features than Wilson ever used, so a column existing is not a column being filled. The §6 probe counts population per field on open tickets; nothing in the plan should assume a field until that count says so — which is why the table's first three rows (geocode, zone, tech) are the ones I checked against real rows and the rest are marked to verify. Item 53 (service address vs billing address at intake) does not: ePASS has one `SoldTo` address per invoice and it is the service address, so the leak is on our web form, not in the data.

## 2. Where the port stands

`lib/service-journey-postgres.js` still imports from DispatchTrack CSVs (`POST /api/epass-agent/upload?kind=dispatch`) and reads `Latitude/Longitude` from that file. `lib/service-scheduling-postgres.js` (shipped 9/19, switched off 9/21 with `booking.self_schedule_enabled = false`) places new requests by ZIP average → zone centroid → geo-neutral, and estimates drive time as 4 + 1.55 × km haversine from a fixed shop point. Nothing reads `epass_open_service` yet.

The delivery-run code in `server.js` already has a Google geocoder (`googleGeocodeAddress`) and a Routes API call (`computeDriveEtaMinutes`, `directions/v2:computeRoutes`, `TRAFFIC_AWARE`) behind one env var, `GOOGLE_MAPS_API_KEY`, with haversine fallback when the key is missing. Those stay as they are until the delivery rebuild; the service side gets its own provider wrapper (§4) that the rebuild can adopt.

## 3. Launch order

The gate in doc 11 §7 still applies (mirror clean three straight days, ~50 scored requests at ≥80 % same-day-or-better, day controls used on real events, then one zone or one tech with a dispatcher-approves-slot step). What changes is how fast each gate can be reached, because the data is now already there.

**Step 1 — Put the mirror on the feed (this week).** Replace the DispatchTrack importer with a reader over `epass_open_service` + `epass_open_service_labor`: `sv_number` = `code`, geocode from `SoldToLatitude/Longitude`, zone from `MapZoneCode`, route date from `SvcScheduleDate` (falling back to `ScheduleDate` — the §6 probe says which is filled), tech from the latest open `InvoiceLabor.TechnicianCode` else `DispatchRequestedRouteCode`, status upper-cased, `Priority = 'RCALL'` → confirmed recall, parking-day rule as in doc 13 §3.1. Runs after every `epass-open-service` upload (the server already has the hook; it is where the Ordering Report refresh lives for the sales bundle). Keep the DispatchTrack path as a fallback for one week, then delete it. This retires two manual uploads and gives the mirror the 15-minute freshness self-scheduling needs.

**Step 2 — Roster and zones from ePASS, capacity controls on the board (next week).** Seed `sj_techs` from `Route` (`StartTime` → `shift_start`; `DestinationCodeMon…Sun` → per-weekday start/end at home or shop, which is exactly the `tech_pattern` table doc 13 asked for; `RouteQualifications` → `skills`), and `sj_zones` from `MapZone` + `MapZoneVertices` (polygons, so a request is zoned by point-in-polygon instead of a ZIP list — fixes the multi-zone ZIPs and PO-box ZIPs in doc 06). Then the dispatcher day controls UI over the `sj_tech_days` route that already exists, with the commute exclusion from item 23 (allowance 45 min, CEM 60) implemented in `routeMinutes()` before anyone reads the numbers. Two things need Andrew's sign-off, not code: the per-tech values (shift, commute allowance, `max_stops_per_day`, `accepts_overflow`) and the zone ownership table from the backtest (item 28 — DS and LOCAL have no real primary; LOST should be AJH).

**Step 3 — Durations: units × one hour now, Samsara-measured within a month, no one typing (same week, small).** Andrew (9/21): on a service ticket one `DispatchUnits` unit is one hour, and the unit count is the field the office keeps accurately. So the planned on-site time is simply `DispatchUnits × 60` minutes (Phase 0's per-category defaults become the fallback for a ticket with no units), and that replaces the 30-minute placeholder on day one. (The sales side uses the same column on a different scale — values like 107 on delivery orders — so the multiplier applies to SV/WTY only.)

The measured number comes from Samsara, which the service vans already carry. Agility has the client (`lib/samsara.js`: vehicles, locations, geofences, the webhook that advances delivery runs). Rather than creating a geofence per service stop, a nightly job pulls each service van's GPS history for the day (`/fleet/vehicles/locations/history`) and matches dwells — stationary within ~150 m for five minutes or more — to that day's tickets by lat/lng (every ticket has one now). The van-to-tech mapping is `Route.LocationCode` (SV02, SV07, HVAC1…) against the Samsara vehicle name. Each match writes a `sj_stop_actuals` row: ticket, tech, arrived, departed, on-site minutes, plus the drive leg from the previous stop. After ~20 matched stops per product category the median replaces `units × 60` for that category (`duration.learned`, the doc 13 mechanism with a different source), and the same rows give three things the plan wanted elsewhere: real stop order per day (item 32, independent of whatever `DispRoute` turns out to hold), real drive legs for calibrating the haversine constants in §4 without spending a single Mapbox element, and the shadow scorecard's "what actually happened" side. Nothing here touches ePASS or the techs' phones.

**Step 4 — Shadow score for two weeks (no customer sees anything).** With steps 1–2 live and seeded durations, every new web request gets an engine suggestion on the queue card (`GET /api/service-journey/offer` already returns it); the office keeps booking in ePASS as today; the importer records what was actually booked (tech + date) against the suggestion. `scorecard()` in Phase 0 is the port target. This is the ≥80 % gate, and it is where the placement weights get tuned in `sj_settings`.

**Step 5 — Client self-scheduling, one zone, `open` mode.** Flip `booking.self_schedule_enabled = true` and restrict offers to the pilot zone (a new `booking.pilot_zones` setting; every other ZIP stays `office_only` with the "we'll call within one business day" page). Geocode the request address at submit time (one Mapbox permanent-geocoding call per request; see §4 — about $3.50 a month) so the picker is placed on the real address, not the ZIP average. Keep the dispatcher-approves-slot step: the client's pick creates a hold and a queue-card task; nothing is texted until the dispatcher presses Confirm (doc 16). The standing rule holds — no automated customer contact without an explicit click or a per-template switch that defaults off.

**Step 6 — Routing, in three small pieces (after step 5, not before).** (a) Calibrate the haversine constants against real drive times once (§4); this improves every placement for free. (b) The nightly optimizer and the Confirm-route preview use Mapbox (Optimization + Directions) for the ordered route and ETAs, because those are the numbers a customer's window is built on. (c) Placement keeps haversine for screening and checks only its top three candidate days against the Matrix API. Doc 18 §5's recommendation stands: routing stays a suggestion on the board; DispatchTrack/ePASS keep the schedule of record; nothing writes to ePASS.

## 4. Drive times and geocoding: Mapbox (decided 9/21 evening; Google kept as the reference)

Andrew's call after weighing the two: Mapbox, because its free tiers cover this whole plan and its setup is a token, not a Cloud project. Google's numbers are kept here for comparison; nothing in the engine cares which provider is behind the two functions.

**Why Mapbox fits.** Directions, Matrix and Optimization each come with **100,000 free requests/elements a month**, then $2.00 per 1,000 (Google: 10,000 free, then $5.00; traffic-aware $10.00 with 5,000 free). Geocoding is $0.75 per 1,000 "temporary" (result may not be stored) or $5.00 per 1,000 "permanent" (may be stored) — we store, so permanent, about $3.50 a month at ~700 requests. The Optimization API takes up to 12 stops and returns them in the best driving order in one call, which is the nightly per-tech route without writing a solver. Map tiles for the board come with 50,000 free web loads. Limits that shape the code: Matrix takes up to 25 coordinates per call on `mapbox/driving` (625 elements) and 10 on `mapbox/driving-traffic`, at 60 and 30 requests a minute respectively; Directions and Optimization allow 300 a minute. A tech-day of 8 stops plus start and end is 10 coordinates, so one Matrix call per tech-day on either profile.

**Setup.** One Mapbox account (billing card on file — nothing is charged below the free tiers, but the account needs one). Two access tokens from the account page: a *server* token with only the navigation and geocoding scopes, no URL restriction, stored in Render as `MAPBOX_TOKEN` and nowhere else; and a *browser* token restricted to `https://agility.wilsonappliance.com/*` with only the map-tile scopes, for the board map later. Turn on the account's usage alerts at, say, 80,000 elements a month so a runaway loop is noticed before it costs anything.

**Endpoints the service code will use** (all GET, token as `access_token`):

| Purpose | Endpoint | Notes |
|---|---|---|
| Geocode a web request address once at submit | `geocoding/v5/mapbox.places-permanent/{address}.json` | `country=us`, `proximity=` shop, `types=address`; store lat/lng on the request |
| Leg times for placement checks and the ledger | `directions-matrix/v1/mapbox/driving/{lon,lat;…}` with `sources=`/`destinations=` | ≤25 coordinates; `annotations=duration,distance` |
| Nightly route order per tech-day | `optimized-trips/v1/mapbox/driving/{lon,lat;…}` | ≤12 coordinates; `source=first&destination=last` pins start and end; `roundtrip=false` when they differ |
| Confirm-route preview / customer ETAs | `directions/v5/mapbox/driving/{lon,lat;…}` in the chosen order | `overview=false`, `annotations=duration`; up to 25 waypoints |
| Live "on the way" (later, with the delivery rebuild) | same as above on `mapbox/driving-traffic` | traffic only for a truck that is leaving now |

Coordinates are `longitude,latitude` on Mapbox — the opposite of Google and of `sj_jobs.lat/lng`; the wrapper does the swap so nothing else does.

**Volume at our size, before caching.** Geocoding ~700 a month; placement checks on the top three candidate days ~33,000 elements; nightly optimizer ~1,000 elements a night plus one Optimization call per tech-day (~220); Confirm-route previews ~700. Total about 60,000 a month, inside the 100,000 free tier with the calibration of `placement.drive_base_min` and `placement.drive_min_per_km` coming from Samsara's own drive legs (§3 step 3) rather than a purchased sample. The naïve design — a matrix call for every candidate tech-day of every request, ~530,000 elements a month — would cost about $860 on Mapbox versus $2,600 on Google; it is still wrong, and the engine still screens with haversine and checks only its top three.

**Caching.** The `sj_drive_legs` table (origin/destination rounded to four decimals, hour bucket, minutes, distance, source, fetched-at) stays in the plan; how long provider results may be kept is set by Mapbox's Product Terms, not by us. Read the current Product Terms (July 2026) before the first deploy and set the table's expiry to whatever it allows; if it turns out to be shorter than useful, the cache holds calibrated haversine values and only live numbers come from Mapbox. Permanent geocoding results are ours to keep.

**Provider independence.** Two functions — `geocodeAddress(address)` and `driveLegs(points, opts)` returning minutes and metres — sit in `lib/routing.js` behind `ROUTING_PROVIDER` (`mapbox` | `google` | `osrm` | `haversine`), each with the haversine fallback and the settings-driven constants. Swapping to self-hosted OSRM or Valhalla on Render (no key, no quotas, no caching terms, no live traffic, roughly $25–85 a month of instance) is then an env-var change. The delivery-run code in `server.js` keeps its Google calls untouched until the delivery/install capacity and routing rebuild Andrew has planned; that rebuild should adopt `lib/routing.js` rather than add a third path.

**What no provider solves.** Time windows (ours), durations (units × 60, then Samsara, §3 step 3), zone ownership (item 28), and the choice of *day* — placement is a capacity and ownership problem first and a drive-time problem second, which is why calibrated haversine is enough for screening and doc 18's "don't route yet" still stands.

## 5. What is still undecided and blocks what

| Item | Blocks | Who |
|---|---|---|
| 28 — measured zone ownership table (DS/LOCAL primaries, LOST → AJH) | Step 2 seeding; placement zone-rank penalty | Cayden + dispatch |
| Per-tech roster values (shift, commute allowance, max stops, overflow) | Step 2 capacity ledger | Andrew |
| 26 — who unlocks a promised day when a tech calls in | Step 2 day controls UI (needs a role) | Andrew |
| 19 — who runs the west trip | `designated_days` zones in step 5 | dispatch |
| 53 — service vs billing address on the web form | Step 5 (geocoding the wrong address places the wrong day) | one form field; then done |
| 3 — Podium A2P / template approval | Any customer text after Confirm; not the confirmation page | Andrew (Podium) |
| Pilot zone and pilot tech for step 5 | Step 5 | Andrew + Cayden |
| Samsara vehicle name ↔ `Route.LocationCode` mapping for the service vans | Step 3 stop matching | Andrew (five minutes, once) |
| Mapbox account, server token as `MAPBOX_TOKEN` in Render, read the Product Terms caching clause | Steps 5 (geocoding) and 6 | Andrew |

## 6. Immediate actions

For Andrew: run discovery once more — `…\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\\WILSON-FS02\SharedDrive\Agility\epass-odbc-pull.ps1" -Discover` (the updated script adds `DispRoute`, `DispatchMeJob`, `MapZoneVertices`, `MapZoneCoordinates`, `RouteQualifications`, `Scheduler` and a probe that counts which dispatch fields are filled on open service tickets — the "exists vs used" check — plus a 500-row sample of labor lines, kept for `TechnicianCode`/`TripNo` rather than the clock times) and copy `schema\` into `odbc\` again. Create the Mapbox account and the server token while that runs; put the token in Render only as `MAPBOX_TOKEN`. Answer the roster and pilot-zone questions in §5 when convenient — none of them is needed for step 1.

For me, in order: step 1 (importer on the feed), step 3 (`DispatchUnits × 60` now, the Samsara stop-matcher next), step 2 (roster/zones from `Route` + `MapZoneVertices`, day controls UI, commute exclusion), then the shadow scorecard. Self-scheduling is switched back on only at step 5, for one zone, with the dispatcher approving each slot.
