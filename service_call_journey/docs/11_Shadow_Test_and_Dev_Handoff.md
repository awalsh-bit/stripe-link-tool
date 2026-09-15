# Shadow test instance — plan and developer handoff (replaces the AJH pilot)

September 14, 2026 · For Cayden Mayfield and the dashboard developer · Companion to `07_Developer_Spec.md` v1.3 §14 and `phase0/README.md` ("Added 9/14")

## 1. What we are doing, in one paragraph

The demo instance built on 9/14 from the *original* HTML prototypes (the `ajh_*` files) is retired. Its two good ideas survive: a **copy button on the live Service Request Queue** that drops a real incoming request into a test board, and a **suggested day with the reason** on everything unscheduled. Both now run for **every technician** on the Phase 0 database, fed by the DispatchTrack export ePASS already writes every 15 minutes, so the test board mirrors the real ePASS route without anyone re-keying tickets and without a browser trick. Dispatchers keep booking in ePASS exactly as today; the instance attaches each new SV to the copied request by itself and grades its own suggestion against what the dispatcher did. Nothing in the instance writes to ePASS, texts a customer, or charges a card.

## 2. Retire the AJH files

Remove from the dashboard menu: **AJH Pilot — Routing**, **AJH Pilot — Field Tool**, **AJH Pilot — Parts Pipeline**. Delete `ajh_routing_tool.html`, `ajh_field_tool.html`, `ajh_office_parts_tool.html`, `AJH_pilot_developer_handoff.md`; the `WILSON_AJH_PILOT_V2` key in `localStorage` can be left to expire. Keep the four **Service Journey** entries (ePASS mirror, Board, Field Tool, Office Queues) — those are the ones we take to final.

What carries over: the copy button (renamed, posting JSON to the intake endpoint instead of URL parameters), suggested-day-plus-why on unscheduled cards (now `placement.suggest`), the activity log idea (`audit_log` and `status_history` already are it), the Podium relay shape (browser → a small server endpoint that holds the key — spec §6), and the two clearly labelled TEST stops for reviewing on-my-way wording (recreate them on the "break it" copy, §6, never on the shadow instance). What does not: the `localStorage` store and `storage`-event sync, the per-file AJH seed data, the category → part-number catalog in the parts tool (Cayden 9/14: no part number is ever pre-filled — the tech keys it), the `bucket` field (Phase 0 status + `route_date` + `penciled_date` say what shows where), and anything scoped to one technician.

## 3. Stand the instance up

1. Pull `phase0/` (v0.3.0). On the existing test database run `python -m wilson_service init-db` again — it adds the new columns (`job.parts_eta, est_minutes, penciled_*, source_ref, card_ref`, table `placement_log`) without touching data. SQL Server: `schema/schema_mssql.sql` is self-migrating (`IF COL_LENGTH(...) IS NULL ALTER TABLE ... ADD`).
2. Point `watch` at `\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport` (read-only; the same folder the sales importer reads). Task Scheduler every 5 minutes, `WILSON_SERVICE_DB` set to the test database. Set `import.ei_folder` and drop the ExportInvoice xlsx there once or twice a day — DispatchTrack only carries SO1/SO4PRE/SO5/SO6.
3. Start the shim: `python -m wilson_service serve` (port 8765; set `serve.token` if the dashboard host is not the same box, and `serve.cors_origin` to the dashboard's origin). Or port the same seven calls into the dashboard's own API — the shapes are in §4.
4. Confirm with `python -m wilson_service shadow-report`: last import within 15 minutes, in-feed counts by status match the CSV, 0 discrepancies.

## 4. The button — "Copy to service dashboard test module"

One button per row on the live Service Request Queue, office-only, behind the queue's existing auth. Clicking it **copies**; nothing on the live row changes (status, card, position). It posts the row as shown on screen:

```
POST http://<host>:8765/api/requests        (header X-Token when serve.token is set)
{"request_id":"sr_4821","submitted_at":"2026-09-14T16:32:00",
 "customer":{"name":"Thomas Meyer","email":"tm101352@gmail.com","phone":"5125579882"},
 "address":{"line1":"1714 Cielo Ranch rd.","city":"San Marcos","state":"TX","zip":"78666","gate_code":""},
 "contact_method":"Text","purchase_date":"2011","purchased_within_12_months":false,
 "units":[{"type":"Sub-Zero Refrigerator (Built-in)","model":"BI42SD/O","serial":"F4139786","purchased_from_us":true,
           "problem":"I notice a small puddle of water at base of refrigerator door"}],
 "photos":["https://…/1.jpg","https://…/2.jpg"],
 "card":{"saved":true,"brand":"VISA","last4":"8241","setup_intent":"seti_1UFhRX8Mxpn8XucSe8t2KIe3"},
 "erp_order_number":""}
```

Response `201` (or `200` if this `request_id` was already copied — pressing twice never makes two requests):

```
{"job_id":664,"created":true,"status":"REQ","zone":"SANMA","booking_mode":"open","zip":"78666",
 "suggestions":[{"rank":1,"sp_code":"KJB","date":"2026-09-17","window":"PM","cost":60,
                 "why":"KJB has 3 stops that day · +44 min drive · 1h 42m left · primary tech"}, …]}
```

Show the top suggestion back on the live row if you like (`{sp_code} {date} · {why}`); it is also on the test board's Unscheduled panel with a *Place there* button.

**When the dispatcher keys the SV** into the row's *ERP order number* field, post `POST /api/requests/<job_id>/sv {"sv_number":"SV00124001","user":"<login>"}` (or re-post the whole row with `erp_order_number` filled). If the DispatchTrack snapshot got there first, the instance has usually already attached the SV by phone or name + ZIP; the call is then a no-op. If the import created a separate job for that SV before the request was copied, the call merges it into the request — one job, no duplicate.

Other reads the pages use: `GET /api/board?date=YYYY-MM-DD` (stops and pencils per tech with reasons and remaining minutes), `GET /api/jobs/<id>/suggest`, `GET /api/jobs/<id>/offer` (the customer's date order, best fit first), `POST /api/jobs/<id>/pencil`, `GET /api/shadow?since=YYYY-MM-DD`, `GET /health`.

## 5. What the office does during the test

Nothing new on the phone. Book in ePASS as today. Press the copy button on each incoming request when it comes in (web requests are the natural ones — nobody is waiting on the line). When the ticket is made, type the SV into the ERP field as you already do. Kezia keys part ETAs on the test instance's Parts Order queue for approved jobs so the pencils have something to work from (`set-eta` also works from the command line). Use the day controls on the test board for real events — PTO, van appointments, Josh's Friday, a forced extra call — and see that the board reflects them.

## 6. The morning check (ten minutes)

`python -m wilson_service shadow-report`, or `GET /api/shadow`:

1. **Mirror** — last good import, in-feed counts by status equal the CSV, `discrepancies 0`. Anything else is an ePASS quirk to normalise (like `WTYRCALL`) or a bug; log it, fix it, move on.
2. **Copied requests** — how many, and which still have no SV. A request without an SV after a day means the call was never booked or the match missed (log it).
3. **Suggested vs actual** — same day %, same tech %, both %, and every miss: `suggested DLA 09-16 · actual KJB 09-17 · why`. The dispatcher judges each miss: who was right? Every miss becomes either a rule we add or a difference we accept.
4. **Pencils** — where each SO4 landed (ETA + 2 business days on the owning tech's best-fit day) and whether it moved sensibly when an ETA changed.
5. **Day controls** — did yesterday's PTO / block / forced call show up within one refresh?

"Break it" testing — closed days, full days, past dates, an SO4 with no part, double bookings, random date picks — runs on a **separate copy** seeded from the latest snapshot (`sqlite:break.db`, re-import to reset), never on the shadow instance: test customers there would sit in Michael's queue forever and skew the scorecard.

## 7. Done when

The mirror has been clean three straight days; roughly fifty requests are scored with ≥ 80 % same-day-or-better and every miss explained; the pencils have been through at least one ETA change and one part check-in end to end; the dispatchers have used the day controls on real events. Then customers start picking dates for **one zone or one tech**, with `offer.route_first` on and a dispatcher-approves-slot gate in front of the confirmation text for two weeks.

## 8. Field mapping (for the developer)

| Live queue field | Payload | Lands in |
|---|---|---|
| Row id | `request_id` | `job.source_ref = 'queue:<id>'` (dedupe key) |
| Submitted | `submitted_at` | `audit_log` (intake.queue_copy) |
| Customer name / email / phone | `customer.*` | `customer` (matched by phone digits first) |
| Address, gate code | `address.*` | `address` (+ `zone_code` from `zip_zone`) |
| Contact method | `contact_method` | `customer.contact_pref` (text / call / email) |
| Unit type, model, serial, problem | `units[]` | `unit` (category + built-in/freestanding/hvac parsed from the type string; brand from the type when not given) |
| Purchased from us / date | `units[].purchased_from_us`, `purchase_date` | `audit_log` for now (columns arrive with Phase 0.5 history) |
| Photos | `photos[]` | `outbox` (`photos.attach`) — fetched by the Phase 1 worker |
| Card saved, brand, last4, SetupIntent | `card.*` | `job.card_ref`; `card.saved` decides REQ vs SO1.AUTH |
| ERP order number | `erp_order_number` | `job.sv_number` (attach / merge) |
