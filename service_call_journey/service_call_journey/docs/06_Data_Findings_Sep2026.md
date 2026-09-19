# What the ePASS data says (Sep 10, 2026 pull)

Files analyzed (in `reference/data/`): `DispatchTrackDetail_20260910_220003.csv`, `ExportInvoice_20260910_222420.xlsx` (open tickets), `completed2026.xlsx` (finished COD service tickets, Jan 2–Sep 9 2026), `oe23_sv.pdf` (OE-23 Salesperson Activity, SV invoices, Jan 1–Sep 10 2026). Derived tables: `reference/tech_roster.csv`, `reference/zone_table.csv`, `reference/zip_zone_tech.csv`.

## 1. The DispatchTrack export, confirmed

- 2,164 rows = 236 unique SV orders (one row per line item) plus S0/R0/CB/MD sales rows. Statuses present: **SO1 (123), SO6 (67), SO5 (44), SO4PRE (2)** — so SO5 is in the feed too, not just SO1/SO4PRE/SO6.
- `Truck` for SV rows **is the tech SP code** (JHM, JRC, TDP, KJB, CEM, DLA, CIT, AJH, BLL, MAP, VJ). `Delivery Date` is the scheduled date. `Scheduled Window Start/End` is always 00:00 — ePASS holds no arrival window, so the dashboard owns windows.
- **`Map Zone` exists and is populated** on every SV row (AUS C, LOCAL, FBURG, DS, WIMB, AUS W, OAKHL, LOST, DRIFT …). This is the zone vocabulary the route builder should use; no need to invent one.
- `Latitude`/`Longitude` populated on all 236 orders. `Priorites` carries WTY / RCALL / 1ST flags (96 of 236 are WTY). `Location` = shop bin (SV02–SV10, HVAC1) for parts-in tickets. `Qualifications` = APPL / HVAC. `Directions` = gate codes and access notes. `Order Detail` = unit type, brand, model, serial, problem text and tech notes concatenated.
- `Service Time` is 30 min on 116 of 123 SO1s and 43 of 67 SO6s — it is a placeholder, not a duration. Durations must come from the field tool.
- Encoding cp1252 confirmed; one file per 15 min per the sales-side notes.

## 2. Open ticket picture (ExportInvoice, 657 open)

SO1 144 · WAR4 72 · SO4 69 · SO6 68 · SO2.2 48 · SO5 47 · SO8 (not yet posted) 35 · WARADMIN 27 · WAR3 18 · SO9 18 · WARPROBLEM 14 · SO2 10 · SI5 10 · SO4H 9 · SO3 8 · … 337 COD / 320 AR. Warranty statuses (WAR*) are ~23% of open tickets; WTY flag is 41% of the routed feed — **warranty is a large share of visits and is absent from both the COD completions file and the OE-23**, so every per-tech volume number below understates real stops by roughly 1.4–1.7×.

Open tickets by zone: DS 101, LOCAL 80, AUS C 73, AUS W 44, WIMB 35, AUS S 34, FBURG 31, DRIFT 29, OAKHL 29, AUS N 24, LOST 20, SHOP 19, BCAVE 16, BLANC 16, LAKE 15, SPICE 15, JC 11, BOERN 10.

## 3. Volume and revenue (OE-23, SV invoices finished Jan 1–Sep 10)

| Tech | Billed invoices | Revenue | Avg $ | Diag-fee-only invoices | Months active |
|---|---:|---:|---:|---:|---|
| Josh Chappell JRC | 386 | $124,023 | $321 | 122 (32%) | Jan–Sep |
| Trevor Pate TDP | 324 | $121,792 | $376 | 127 (39%) | Jan–Sep |
| Andrew Horst AJH | 279 | $111,587 | $400 | 65 (23%) | Jan–Sep |
| Kyle Bisson KJB | 280 | $90,550 | $323 | 99 (35%) | Jan–Sep |
| Diogo Assis DLA | 282 | $80,897 | $287 | 158 (56%) | Jan–Sep |
| Connor Montgomery CEM | 203 | $76,437 | $377 | 63 (31%) | Mar–Sep |
| Chris Turner CIT | 163 | $47,566 | $292 | 78 (48%) | Mar–Sep |
| Mitchell Irlbeck MJI | 145 | $48,456 | $334 | 24 | Jan–Jun (departed) |
| Brady Langley BLL | 67 | $19,719 | $294 | 1 | Jul–Sep (HVAC) |
| John Merz JHM | 51 | $20,871 | $409 | 5 | Jan–Sep |
| Mark Perks MAP | 42 | $18,613 | $443 | 6 | Jan–Sep |
| Vince Jones VWJ | 38 | $13,356 | $351 | 0 | mostly Jun |

Company: 2,303 billed SV invoices, **$781k**, median invoice **$206.54**, p25 = $169.95 (the diag fee), p75 = $430. Labor is 66% of billed value, parts 34%. **750 of 2,303 billed invoices (33%) are exactly $169.95** — a third of all COD calls end at the diagnostic fee with no repair sold. That is the single biggest lever the field-quote flow touches, and it varies a lot by tech (Andrew 23%, Diogo 56%).

Core techs bill 30–55 invoices a month, i.e. **2–2.5 completed COD jobs per working day**, so with warranty added a realistic loaded day is 3.5–4.5 stops. That matches the DT feed for 9/10 (TDP 13 stops that day is a billing artefact of finish-date batching; typical scheduled days are 4–9 rows per tech, roughly 3–6 orders).

Cycle time on completed COD tickets: created → finished **median 15 days, mean 22, p75 27, p90 46**. This is the number the tracker and the owed-install ledger are trying to shrink.

## 4. Where each tech actually works (share of 2026 COD completions)

JRC AUS C 70%, AUS W 14%, AUS N 11% · TDP BCAVE 23%, SPICE 19%, LAKE 15%, LOST 14%, DS 10%, HORSE 5% · AJH AUS W 25%, DS 18%, LOST 14%, LOCAL 13%, AUS S 11% · KJB WIMB 40%, DRIFT 27%, SANMA 9%, DS 7%, BUDA 6% · DLA DS 42%, LOCAL 30%, DRIFT 13% · CEM AUS W 25%, DS 19%, LOCAL 19%, AUS C 13% · CIT DS 28%, LOCAL 23%, DRIFT 8%, BCAVE 7%, LAKE 7% · BLL DS 47% (HVAC everywhere) · JHM FBURG 42%, JC 20%, BLANC 17% · MAP AUS W 33% (fires).

Zone ownership is clean enough that a primary/secondary table falls straight out of the data — see `zone_table.csv`. Notable: Trevor lives in Wimberley but owns the northwest lakes (Bee Cave, Spicewood, Lakeway, Lost Creek, Horseshoe Bay); Kyle owns Wimberley from Kyle. Distance from shop by zone centroid: DS 2 km, DRIFT 8, LOCAL 11, OAKHL 15, LOST/SPICE/WIMB 21–23, AUS W 24, AUS C 32, JC 35, BLANC 38, HORSE 47, BOERN 61, FBURG 79, KERR 111.

## 5. The west

West-group completions (FBURG, JC, BLANC, STONE, ROUND, HORSE, MFALL, LLANO, BOERN, KERR, OUT, SA) are **133 of 2,087 COD jobs (6.4%)**, about **4 per week** COD, so 6–8 stops a week with warranty. The feed shows **16 west stops on Wed 9/16 and 9 on Wed 9/23**, and historical west completions cluster Tue/Wed/Mon — but per Cayden that is Demitrius's habit and John's schedule, not a rule. The volume (roughly one trip's worth a week) is what matters: it supports a trip-bucket model that proposes a trip when enough work has accumulated or the oldest request is aging, rather than a fixed day.

## 6. Zone groups and booking modes (proposed, in `zone_table.csv`)

| Group | ePASS zones | Booking mode | Cadence |
|---|---|---|---|
| Core Hill Country | DS, SHOP, DRIFT, LOCAL, OAKHL, HENLY | open (customer self-schedules any day) | daily |
| Austin Metro | AUS C/W/S/N/E, LOST, BCAVE, LAKE, SPICE, R2222 | open | daily |
| South Corridor | WIMB, KYLE, BUDA, SANMA | open | daily (KJB from Kyle) |
| Northwest Lakes | HORSE, MFALL, LLANO, ROUND | designated days (trip bucket) | on volume/age; TDP |
| West | JC, BLANC, STONE, FBURG, BOERN | designated days (trip bucket) | on volume/age, ~weekly at today's volume; JHM |
| Far South | BRAUN, CANYO, FISCH | designated days (trip bucket) | on volume/age; CEM/KJB/BLL |
| Out of area / North | KERR, OUT, SA, CEDAR, GEORG, NOR E, OUTER | office only | office decides |

`booking_mode` is the zip-code qualification Cayden asked for: `open` = full self-scheduling, `designated_days` = the request enters a trip bucket and the customer is offered a date once a trip is proposed and confirmed, `office_only` = form says "we'll call you within one business day" and creates a Client Care task.


Zone-code note: DT `Map Zone` values LOC, SOUTH, WEST, NOR E, OUTER are sales/delivery zones (confirmed by Cayden) and are excluded from the service zone table. Rate-book family codes ID, OD, DI, VA, JB remain unidentified.
