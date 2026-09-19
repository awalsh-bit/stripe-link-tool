# Wilson Service Journey — Developer Specification v1.17

September 19, 2026, night (**v1.17 is the audit round.** Cayden's seven asks and a full pass over the week's work. The tech's **findings become history** — a `findings` row per visit, read back beside twenty years of ePASS `performed_desc` as one list (§1.2, §8c); the field tool **never fills a part number** (§8a); the installer's damage form is **read off Agility's existing request queue, not rebuilt** (§5.1c); **anyone in the office can edit** a ticket's customer, unit or notes, logged was→is with a correction packet to ePASS (§6c); the board's Left/Right buttons give way to **dragging a day onto a board** (§4.8b); and the audit found five pieces of bad data of our own making — a prefix rule that called Kelli Kenney's fridge a speed oven, a warranty flag hand-set on her COD ticket, a Whirlpool bake-element number on a Vent-A-Hood, invented names on real SV numbers, and a sealed-system rate claimed on every built-in fridge — all gone, each with a test that would catch it again (§13f). Everything below this line is v1.16.)

September 19, 2026, late (**v1.16 is the round Cayden's answers unlocked. The **warranty rate card** is in — thirty brands, fourteen with a sealed-system rate, each matched to the ePASS labor code twenty years of history already uses, priced as one flat rate per claim rather than per hour (§5.1b, closing open item 47); **freight** becomes $20 under the ePASS code `FREIGHT`, taxed, office-only, and absent entirely from warranty tickets (§5.3a, closing open item 49); **damage reports default to warranty**, because concealed shipping damage is what they almost always are (§5.1c); the **parts ETA buckets** become in state / out of state / cross country, which is what they always meant (§5.3c); **in-shop (SI) tickets** get their own lane, counted bench days, a tattle to the service manager on the third, muted part texts, and the delivery the tool has to remember (§5.11); the **quote lifecycle** gets review-everything, three days of silence, and a closed quote that can be reopened with the diagnostic credited into the repair (§5.3d); and **confirming a route** texts every customer on it their date and window (§4.10). One tracker link per household, a two-week booking horizon, the twenty-six unmapped ZIPs, and Mark publishing zone changes are in §6b.3, §4.2 and §4.4b. Open items 52–54.**) · v1.15 is the other eight items from Cayden's list: the three tracker buttons that did nothing — a pre-addressed text to Client Care, a cancel that ends on a success page, and a gate-code/access-note box (§6b); closing a call out from the board, one path for the customer's own cancel and the dispatcher's (§2 rule 34, §6b); Kezia's shipping override on the quote (§5.3a); warranty on the office side — no zone fee, tax exempt, and labor only on the COD brands True/Scotsman/Zephyr/BlueStar, confirmed by Cayden 9/19 (§5.1b); a quote the office draws up itself in Estimates, with *send to the tech* when they cannot find the part (§5.3b); and the installer's cosmetic damage report, from the truck through the service request queue to the customer picking an install time (§5.1c). Open items 49–51.**) · v1.14 rebuilds the field tool around one estimate flow the tech builds and prices: the book's hours hidden behind his own time pick, manual labor lines, a labor total he can move, the outcome as a defaulted dropdown, model-aware typeahead on every free-text box, the part number keyed on the part row and copyable on Kezia's, warranty COD brands vs the flat rate, and a read-only look-ahead at his own week (§8a, §8b, §5.3, items 46–48; field quoting suspended behind `quoting.field_quote_enabled`). v1.13 (late) builds the confirmation page the customer lands on after picking a date, and makes the tracker link a one-tap `/t/{token}` worth saving — issued at intake, reissuable, expiring 90 days after close, with add-to-home-screen, email-me-the-link and bookmark on the page and the honest line about who can see it (§6b, §7, `tracker.py`, items 43–45). v1.12 (pm) answers the diagnostic-fee question: on a discontinued part the fee stands as standard, the office waives it in one logged click while moving the customer to the showroom, and a credit-against-a-replacement option is modelled pending Cayden's word (§5.3, §5.5, item 41) — with the 248 COD calls since Jan 2024 behind it. v1.11 (pm) adds the three afternoon thoughts: add and remove ZIPs in the zone editor, with randymajors.org as the ZIP-list source and the ODBC history as the list of ZIPs already served but never mapped (§4.4b, items 42, 67–68); Kezia's Discontinued toggle and the parts-unavailable notice that ends a call at SO7 through the estimate page — showroom lead or closed (§5.3, §5.8, item 41, 69). v1.10 folds in Cayden's 9/18 round: the interim operating model in which ePASS stays the source of truth for ticket data, ordering, receiving, accounting and billing, with our purchasing screens hidden behind a flag until NetSuite (§5.8); the zone map editor, paint-by-ZIP with a gated publish (§4.4b); per-day start and end points on the weekly pattern (§4.1f); a permission matrix with admin-only retire (§9); the two-line labor rule — a ZN zone fee by distance from the shop plus the component replacement, fitted to 3,807 real tickets (§5.1a); and part number optional, description required, with the office adding lines at verify (§5.3–5.4). Open items 34–40; §13d items 58–66.** v1.9 folds in the 9/17 testing round on the real catalogue — and, from the afternoon, the decision NOT to model ePASS's 'routed' divider (§4.1e), every scheduled week on the board, and the test bench (§14.6): the identity rule is now the ADDRESS — street, unit and ZIP, or surname at the same house number — after a Do-Not-Service flag crossed town on a shared surname (§1.4h); condo units become separate households (§1.4i); the office search reads every customer on file and groups by address (§1.4j); every past call opens to what was done (§1.6e); Model Insight works in three tiers over model FAMILIES (§1.7); the board carries ePASS Routing's stop order and its 'routed' divider (§4.1e); route settings live on the tech with a weekday pattern (§4.1f); a sick day walks the CSR through each customer with an explicit text per row (§4.6a); office notes and internal reminders (§6a); the map gets a roads mode and full screen (§4.8a). Open items 30–33.** v1.8 loads the full seven-file ODBC export — service detail, parts, labour, sales and the complete technician roster (§1.6). v1.7 loaded the ePASS back catalogue — 117,594 tickets and 45,239 customers — and separates household from payer, with a NetSuite-ready identity layer (§1.4, §1.5); it also folds in the service team's 9/15 testing round as §13b items 26–42.** v1.6 added the collector lane — a tech with no schedule and no capacity, measured by age (§4.1c), from Cayden's 9/15 pm note on John Merz — and closes open items 15 and 16.** v1.1 folded in the Sep 10 replay, `08_Replay_Sep2026.md`; v1.2 folded in the service team's feedback from the 9/11 demo — §13, marked ⟨9/11⟩; **v1.5 adds the service team's 9/15 test feedback — the visit group that keeps one household on one day and one charge (§4.9), per-job contacts (§1.2), per-tech capacity settings with commute out of the route day (§4.1a), and the office marker that pushes a call back to a tech (§2 rules 36–38) — all in §13 items 20–25. v1.4 added the two ePASS conventions the 9/15 export confirmed (§3.3a: the Saturday parking date and status case). v1.3 added Cayden's 9/14 items — manual part numbers, the SO4 auto-pencil, route-first slot offering (§4.3, §13.17–19) — and §14, the shadow test instance fed by the "Copy to service dashboard test module" button, which replaces the AJH pilot files** ⟨9/14⟩). Phase 0 of this spec exists as working code in `phase0/` · For the dashboard developer · Companion to `01_Service_Journey_Blueprint.md` (v0.9), the three prototypes, and the reference tables in `reference/`.

This document is the build spec. The blueprint says *why*; this says *what to build*, with every field traced to where it comes from and every rule written so it can be coded without re-deriving it from conversation. Where a number is a tunable it is named in §11 and should live in a settings table, not in code.

Stack: not prescribed. The sales-side routing prototype already runs on **SQL Server Express (`localhost\SQLEXPRESS`, database `WilsonRouting`) + Python importer + Flask**, and the maintenance portal is plain HTML/JS with a Python endpoint, so the path of least resistance is SQL Server for data, a Python (FastAPI or Flask) API, and the existing dashboard front end for screens. Nothing below depends on that choice. Column types are written in SQL Server terms; translate as needed.

---

## 0. Ground rules for the build

1. **The dashboard is the source of truth.** ePASS is mirrored until NetSuite. Nothing in ePASS overwrites a dashboard-owned field (§3.4). ⟨9/18⟩ Qualified for the interim by §5.8: until NetSuite, ePASS is the source of truth for ticket data, ordering, receiving, accounting and billing; the dashboard owns what it alone produces — requests, placement, findings, quotes, notifications — and reads SO4 and SO5 back rather than setting them.
2. **Statuses are earned.** Every status change is caused by an event (§2). A manual status change requires a `reason_code` and is logged.
3. **Everything is timestamped with an actor.** `status_history`, `appointment` actuals, `sync_item` states. Actor is a user id, a tech id, `customer`, or `system:<job>`.
4. **Money is `DECIMAL(10,2)`. Times are UTC in the database, rendered in America/Chicago.** Dates that are business dates (scheduled day, ETA) are `DATE`.
5. **Idempotent imports.** Re-running an import on the same file changes nothing.
6. **Feature flags per phase** so Phase 0 can ship with the import and sync queue while the field tool is still in review.

---

## 1. Data model

### 1.1 Source-to-field trace

| Source | Key | What it gives us |
|---|---|---|
| Web form (existing) | form submission id → `job` | customer, address, units, problem text, photos, contact_pref, gate_code, landlord/PM flags, warranty answers, Stripe `SetupIntent` id |
| Field tool | `job_id` | arrive/complete timestamps, findings, photos, parts lines, labor lines, field quote, signature, outcome |
| Customer portal | `job_id` | appointment picks, approvals, reschedules, cancellations |
| `DispatchTrackDetail_*.csv` (every 15 min) | `Order Number` = `job.sv_number` | ePASS `Job Status`, `Delivery Date`, `Truck` (=tech SP code), `Map Zone`, `Latitude`, `Longitude`, `Balance`, `Priorites`, `Location` (bin), `Directions`, `Qualifications`, `Order Detail`, `Model`/`Description` lines |
| `ExportInvoice` (Service Order Health upload; until DT export is widened) | `Invoice #` | `Job Status` for statuses not in the DT feed, `Payment Type Code`, `SP`, `Total`, `Balance`, `Date Created`, `Units`, `Qualification`, `Service Model/Serial/Brand` |
| Rate book / catalog (§5) | task id, part number | labor tasks, hours, parts prices |
| Podium API | message id | delivery/read receipts |
| Stripe | `setup_intent`, `payment_intent` | card on file, charges |

### 1.2 Tables

Primary keys are `INT IDENTITY` unless noted; every table has `created_at DATETIME2 DEFAULT SYSUTCDATETIME()`, `updated_at`. Foreign keys as named.

**customer**
`customer_id`, `first_name`, `last_name`, `phone_primary` (E.164), `phone_alt`, `email`, `contact_pref` ENUM('text','email','call'), `stripe_customer_id`, `is_landlord BIT`, `is_property_manager BIT`, `epass_customer_code` (DT `Customer Code`), `notes`.

**address**
`address_id`, `customer_id` FK, `line1`, `line2`, `city`, `state`, `zip CHAR(5)`, `lat DECIMAL(9,6)`, `lng DECIMAL(9,6)`, `geocode_source` ENUM('epass','google','manual'), `gate_code`, `access_notes` (DT `Directions`), `zone_code` FK→zone (derived from zip on insert; override allowed).

**job** (one per service order / SV)
`job_id`, `sv_number VARCHAR(20) UNIQUE NULL` (null until ePASS ticket exists; filled from sync or import), `customer_id` FK, `address_id` FK, `status VARCHAR(12)` FK→status_def, `status_changed_at`, `job_type` ENUM('appliance','hvac','in_shop'), `qualification` ENUM('APPL','HVAC'), `is_warranty BIT`, `warranty_flags` (DT `Priorites`), `payment_type` ENUM('COD','AR'), `source` ENUM('web_form','phone','walk_in','import'), `owner_tech_id` FK→tech NULL (set when findings are submitted; never changed by system), `promised_window_start/end DATETIME2 NULL` (customer-facing), `planned_slot_start/end DATETIME2 NULL` (internal), `assigned_tech_id` FK NULL, `route_date DATE NULL`, `route_sequence INT NULL`, `route_locked BIT`, `trip_id` FK NULL, `booking_mode` ENUM('open','designated_days','office_only') (copied from zone at creation), `problem_text`, `balance DECIMAL(10,2)`, `bin_location VARCHAR(10)`, `epass_status VARCHAR(12)`, `epass_route_date DATE`, `epass_tech_code VARCHAR(8)`, `epass_seen_at DATETIME2`, `closed_at`, `cancel_reason`.

⟨9/15⟩ Added to **job**: `visit_group_id` NULL, `needs_tech_input BIT` + `tech_input_asked_at` + `tech_input_asked_by` + `tech_input_prompt VARCHAR(200)` (the office marker, §2 rule 36), `nag_last_sent_at` (rules 36–38).

⟨9/15⟩ Added to **tech**: `shift_start`/`shift_end` are already there and become per-tech rather than a global 9-hour day; new `max_stops_per_day INT NULL`, `max_onsite_min INT NULL`, `max_inter_stop_drive_min INT NULL`, `commute_allowance_min INT NULL` (how much of the home→first and last→home legs the tech absorbs; see §4.1a), `accepts_overflow BIT` (may the engine place beyond a soft limit, or office-only).

⟨9/14⟩ Added to **job**: `parts_eta DATE NULL` (Kezia's ETA, written by `po.placed` / `po.eta_changed`), `est_minutes INT NULL` (planned visit minutes; defaults from `duration.defaults`), `penciled_tech_id`, `penciled_date`, `pencil_reason VARCHAR(200)`, `pencil_set_at` (the SO4 auto-pencil, §4.3a — a soft hold, never sent to ePASS), `source_ref VARCHAR(60)` (`queue:<request_id>` for requests copied from the live Service Request Queue, §14), `card_ref VARCHAR(60)` (card brand · last4 · SetupIntent).

**visit_group** ⟨9/15⟩ (one arrival at one address — the scheduling, capacity and billing unit; §4.9)
`visit_group_id`, `address_id` FK, `owner_tech_id` NULL (the tech the group belongs to once one member is owned), `skill` (`appliance` | `hvac` — members needing a different skill form their own group at the same address), `state ENUM('open','scheduled','done','split')`, `scheduled_date` NULL, `window` NULL, `parts_wait_until DATE NULL` (the latest member ETA — what the group's install date waits on), `created_at`, `created_by`, `note`. Membership is `job.visit_group_id`; a job belongs to at most one group.

**job_contact** ⟨9/15⟩ (who to reach *for this visit* — team item 20)
`contact_id`, `job_id` FK (or `visit_group_id` when it applies to the whole visit), `name`, `phone`, `role ENUM('account','on_site','tenant','property_manager','other')`, `notify BIT` (gets the on-my-way and arrival texts), `visit_only BIT` (true = do not write back to `customer`), `added_by`, `added_at`, `note`. The importers seed `account` rows from ePASS `Phone1/2/3`; office staff add `on_site` rows without touching the customer record. **Podium sends go to every `notify=1` contact**, not to `customer.phone_primary`.

**placement_log** ⟨9/14⟩ (what the engine suggested vs what actually happened — the shadow-test scorecard)
`placement_id`, `job_id`, `kind ENUM('intake','pencil','offer')`, `suggested_at`, `suggested_tech_id`, `suggested_date`, `suggested_window`, `cost_min`, `why VARCHAR(240)`, `candidates_json`, `actual_tech_id`, `actual_date`, `actual_at`, `actual_source ENUM('epass','dashboard')`, `agree_day BIT`, `agree_tech BIT`, `note`. Filled by the DispatchTrack import when the SV is attached or its route changes, and by rule 2/21/25 bookings.

**unit** (appliance or HVAC unit on a job; 1..n)
`unit_id`, `job_id` FK, `category` (dishwasher, refrigerator, …), `install_type` ENUM('built_in','freestanding','hvac') — **drives labor tax**, `brand`, `model`, `serial`, `purchase_date`, `purchased_from_us` ENUM('yes','no','unsure'), `merged_with_unit_id` NULL, `serial_tag_photo_id` FK→photo NULL, `problem_text`.

**status_history**
`id`, `job_id`, `from_status`, `to_status`, `at`, `actor_type` ENUM('customer','tech','staff','system'), `actor_id`, `trigger` VARCHAR(60) (event name from §2), `reason_code` NULL (required when actor_type='staff' and trigger='manual'), `note`.

**appointment**
`appointment_id`, `job_id` FK, `kind` ENUM('diag','install','revisit','shop_touch'), `window_start`, `window_end`, `planned_arrival`, `tech_id`, `route_date`, `sequence`, `locked BIT`, `on_my_way_at`, `arrived_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `created_by`.

**findings**
`findings_id`, `job_id`, `unit_id`, `tech_id`, `outcome` ENUM('field_quote','office_quote','quick_fix','research','replace','declined','no_access'), `symptoms JSON`, ⟨9/11⟩ `error_code VARCHAR(20) NULL` (**required** when `symptoms` contains `error_code` — the tool prompts for the code as displayed), `cause`, `note` (auto-built from taps), ⟨9/11⟩ `custom_note` (the tech's own typed words, behind a *Custom note* button; never pasted into ePASS beyond 200 chars), `labor_block` ENUM('none','half_day','full_day') (quick pick, §5.1), `submitted_at`, `on_site_minutes INT` (completed_at − arrived_at), `photos JSON` (photo ids). ⟨9/19 late⟩ **Built in Phase 0 this round** (`findings.py`; it had been specified and never written), with the columns the history reader needs: `visit_date`, `to_status` (what the visit produced), `parts_json`, `labor_json`, `flags`, `photo_count`, and **`performed_text`** — one sentence in the catalogue's register (*Found … Cause … Parts needed … Labor … Note for the office … Outcome …*), built from the taps so it exists even when the tech typed nothing, with his own words kept verbatim inside it. One row per visit event, written by the `record_visit` effect on every `tech.*` rule that carries it (diagnostic, install trip, more-parts, part-issue, not-fixed). It is the answer to *"where do their findings end up"*: §8c.

**quote**
`quote_id`, `job_id`, `version INT`, `kind` ENUM('field','office'), `status` ENUM('draft','sent','viewed','approved','declined','expired','superseded'), `labor_subtotal`, `parts_subtotal`, `shipping`, `tax_parts`, `tax_labor`, `total`, `diag_included BIT`, `sent_at`, `sent_channel`, `viewed_at`, `decided_at`, `decision_channel` ENUM('portal','field_signature','phone'), `signature_photo_id` NULL, `signature_text` (the authorization wording shown), `signed_by_name`, `field_parts_total` (snapshot for requote rule), `needs_review_reason` NULL, `reviewed_by` NULL.

**quote_line**
`line_id`, `quote_id`, `kind` ENUM('labor','part','shipping','modifier','diag'), `catalog_task_id` NULL, `part_number` NULL, `description`, `qty DECIMAL(6,2)`, `hours DECIMAL(5,2)` NULL, `unit_price`, `taxable BIT`, `price_source` ENUM('catalog','field','verified'), `verified_price` NULL, `verified_at`, `verified_by`, `availability` ENUM('stock','2-3d','5-7d','backorder') NULL, `supplier`.

**purchase_order** / **po_line**
`po_id`, `po_number VARCHAR(20) UNIQUE`, `supplier`, `ordered_at`, `ordered_by`, `expected_at DATE`, `ship_to` ENUM('shop','customer'), `tracking`, `exported_at`. Lines: `po_line_id`, `po_id`, `quote_line_id`, `job_id`, `part_number`, `qty`, `unit_cost`, `received_qty`, `received_at`, `bin_location`, `received_by`.

**tech**
`tech_id`, `sp_code VARCHAR(8) UNIQUE` (DLA, AJH, TDP, JRC, KJB, CIT, CEM, BLL, JHM, MAP, VWJ), `aliases` (KJB2→KJB, VJ→VWJ — the invoice export uses different codes than the routing feed), `name`, `role`, `home_address_id`, `start_default` ENUM('shop','home'), `end_default` ENUM('shop','home'), `shift_start TIME`, `shift_end TIME`, ⟨9/11⟩ `work_days VARCHAR(28) DEFAULT 'Mon,Tue,Wed,Thu,Fri'` (JRC = `Mon,Tue,Wed,Thu`), `skills JSON` (["appliance","sealed","hvac"]), `auto_route BIT`, `auto_schedule BIT`, `max_stops INT`, `speed_factor DECIMAL(4,2) DEFAULT 1.00` (learned), `active BIT`. Seed from `reference/tech_roster.csv`.

**tech_day** (per tech per date overrides — the dispatcher's capacity controls, §4.1)
`tech_id`, `work_date`, `available BIT` (0 = closed: PTO/sick/training; 1 on a non-`work_days` day = **opened**, e.g. Josh's Friday), ⟨9/11⟩ `reason` ENUM('pto','sick','training','open_day','forced','other'), `capacity_adjust_min INT DEFAULT 0` (dispatcher's +60 / −60 / "+1 stop"), `shift_start`, `shift_end`, `start_override`, `end_override`, `parts_loaded_prev_evening BIT` (defaults to 1 for techs whose `end_default='shop'`), `note`, `set_by`, `set_at`.

**route_block** ⟨9/11⟩ (time on a route that is not a call: haircut, van maintenance, training, lunch, DMV)
`block_id`, `tech_id`, `work_date`, `start_time`, `end_time`, `label VARCHAR(60)`, `address_id NULL` (so drive time is modelled when it has a place), `sequence INT NULL`, `created_by`. Counts against `committed_min` in the ledger (§4.2), shows as a grey card on the board and in the field tool route, is never synced to ePASS.

**delivered** ⟨9/11⟩ (the tech's pay number per job, §5.7)
`delivered_id`, `job_id`, `tech_id`, `visit_date`, `labor_amount` (labor lines + diagnostic + zone fees, pre-tax), `parts_sell`, `parts_cost`, `parts_profit` (0 on warranty jobs), `delivered_dollars` (= labor_amount + parts_profit), `cost_basis` ENUM('po','catalog','estimated'), `source` ENUM('field','epass'), `recognised_at`, `reconciled_at NULL`, `epass_labor NULL`, `epass_parts NULL`, `epass_parts_cost NULL`, `adjustment NULL`.

**recall** ⟨9/11⟩
`recall_id`, `job_id` (the new call), `original_job_id`, `tech_id` (owner of the original repair), `days_between`, `basis` ENUM('serial','model_address','epass_rcall'), `state` ENUM('candidate','confirmed','dismissed'), `reviewed_by`, `reviewed_at`, `note`.

**kpi_daily** ⟨9/11⟩ (materialised nightly and on every completion; definitions in §3.7)
`tech_id`, `work_date`, `visits_completed`, `diag_only`, `repairs_completed`, `quotes_sent`, `quotes_approved`, `recalls`, `delivered_dollars`, `labor_dollars`, `parts_profit`, `on_site_minutes`, `drive_minutes`, `stops_forced`.

**zone** — seed from `reference/zone_table.csv`
`zone_code VARCHAR(8) PK` (ePASS Map Zone), `zone_group`, `booking_mode`, `primary_tech_id`, `secondary_tech_ids JSON`, `centroid_lat`, `centroid_lng`, `km_from_shop`, `trip_tech_id` NULL, `trip_min_stops INT`, `notes`.

**zip_zone** — seed from `reference/zip_zone_tech.csv`: `zip CHAR(5) PK`, `zone_code` FK.

**trip** (for designated_days groups)
`trip_id`, `zone_group`, `tech_id`, `date DATE`, `state` ENUM('proposed','confirmed','done','cancelled'), `proposed_at`, `proposed_reason`, `confirmed_by`, `confirmed_at`, `capacity_minutes`.

**catalog_task**, **catalog_modifier**, **rate**, **brand_factor**, **part_catalog** — see §5.

**notification**
`id`, `job_id`, `trigger` (§6 key), `channel` ENUM('sms','email','call_task'), `to`, `template_key`, `rendered_body`, `sent_at`, `provider_id` (Podium message id), `delivered_at`, `failed_reason`.

**payment**
`payment_id`, `job_id`, `quote_id`, `kind` ENUM('repair','diag_fee','deposit','refund'), `amount`, `stripe_payment_intent`, `status` ENUM('pending','succeeded','failed','review'), `attempted_at`, `succeeded_at`, `failure_reason`, `posted_to_erp_at`, `review_reason`.

**sync_item** (§3.5)
`sync_id`, `job_id`, `sv_number`, `kind` ENUM('create_ticket','set_status','set_schedule','add_lines','post_payment','close'), `payload JSON` (fields to key), `packet_text`, `state` ENUM('pending','keyed','confirmed','discrepancy','cancelled'), `created_at`, `keyed_at`, `keyed_by`, `confirmed_at`, `confirmed_by_import_id`, `epass_values JSON` NULL, `mismatch_count INT DEFAULT 0`, `resolved_at`, `resolution` ENUM('reissued','accepted_epass') NULL.

**import_batch** / **import_row_raw** — mirror the sales side (`ImportBatches`, `RawEpassDispatchRows`) but keep **all** columns of the DT file as JSON plus the typed subset used for matching. `import_batch`: `id`, `source` ENUM('dispatchtrack','exportinvoice'), `file_name UNIQUE`, `file_modified_at`, `imported_at`, `row_count`, `sv_count`, `status`.

**photo**
`photo_id VARCHAR(40) PK` (client-generated, matches the field tool's IndexedDB id), `job_id`, `unit_id`, `kind` ENUM('serial','problem','completed','signature','customer_upload','damage'), `content_type`, `bytes`, `width`, `height`, `captured_at`, `uploaded_at`, `tech_id`, `storage_url`.

**settings** — `key`, `value`, `type`, `description`, `updated_by`, `updated_at`. All §11 tunables live here.

**audit_log** — `id`, `at`, `user_id`, `action`, `entity`, `entity_id`, `before JSON`, `after JSON`.

Added 9/17 (§1.7, §4.1f, §6a): `tech_pattern` (tech_id, weekday, shift_start, shift_end, reason),
`office_note` (customer_id | job_id, body, due_on, assigned_to, done_by, done_at), `model_family_rule`
(brand_pattern, product_pattern, model_regex, family_template, label, sort_order, active),
`model_flag` (family_key, body, state pending|published|retired, raised_by, reviewed_by). `job` gains
`stop_order_source` (epass | engine | dispatcher) and `is_test` (bit — §14.6; never synced, never counted).

⟨9/18⟩ Added to **tech**: `home_lat DECIMAL(9,6)`, `home_lng DECIMAL(9,6)` (the home endpoint the per-day
From/To rule reads, §4.1f) and `retire_on DATE NULL` (set by an owner/manager retire, §9; `active` turns
off from that date and history keeps resolving). Added to **tech_pattern**: `start_at` / `end_at`
ENUM('shop','home') NULL — null is "as usual", the tech's `start_default` / `end_default`. Added to
**zone**: `fee_band TINYINT NULL` (1–4) — the zone fee normally follows distance from the shop (§5.1a);
this is the override the zone map sets (§4.4b). The prototype keys its zone table by ZIP, so in this
schema the same column sits on the **zip_zone** row as well and the ZIP's value wins; 78701 is seeded
at 3. **sync_item** `kind` gains `lines` (the approved part and labor lines with their ePASS codes, and
"set SO3") and `new_ticket` (a self-booked request that needs an ePASS ticket) — both in §5.8.

**app_user** ⟨9/18⟩
`user_id`, `name`, `email`, `role ENUM('owner','manager','dispatcher','csr','parts','tech')`, `tech_id` FK NULL (when the user is a tech), `active BIT`. Seeded for the prototype's signed-in-as switcher: Demitrius · dispatcher, Mark Perks · manager, Cayden Mayfield · owner.

**app_permission** ⟨9/18⟩ (role → permission, the matrix in §9; seeded from Phase 0 `auth.ROLE_PERMISSIONS`)
`role`, `permission VARCHAR(40)` — `roster.retire`, `zones.publish`, `zones.draft`, `settings.edit`, `test_bench`, `routes.edit`, `tech.route_settings`, `jobs.book`, `parts.verify`. PK (`role`, `permission`). In Agility this is `app_users` + `user_page_permissions` / `permission_groups` (doc 12 §People) rather than two tables of our own.

⟨9/18 late⟩ Added to **job**: `tracker_token CHAR(14) UNIQUE`, `tracker_token_at`, `tracker_token_by` — the
customer's private link (§6b), issued by `statuses.create_request` so it exists before the confirmation page
renders, nulled by a revoke and re-minted by a reissue. Index `ix_job_tracker_token`. The `outbox` effects
`tracker.email` (a customer-initiated send) and `tracker.open` (one row per open — the measure in §6b) need
no new table.

**estimate_handoff** ⟨9/18⟩ (one row per quote handed to the existing Agility Service Estimate Approvals module, §5.8)
`handoff_id`, `job_id` FK, `sv_number`, `external_ref VARCHAR(60)` (the `service_estimates` token / id), `status ENUM('sent','viewed','approved','declined','comped','shopping','diagnostic','no_response')`, `lines JSON` (the verified part and labor lines exactly as handed over), `total DECIMAL(10,2)`, `parts_eta DATE` (Kezia's), `handed_by`, `handed_at`, `responded_at NULL`.

### 1.3 Indexes that matter
`job(sv_number)`, ⟨9/11⟩ full-text (or trigram) index for search over `customer.display_name`, `customer.phone_primary/alt` digits, `job.sv_number`, `unit.serial`, `unit.model`, `address.line1` (§7 `/search`), `unit(serial)`, `recall(state)`, `delivered(tech_id, visit_date)`, `job(status, route_date)`, `job(assigned_tech_id, route_date, route_sequence)`, `job(owner_tech_id, status)` (owed-install ledger), `appointment(tech_id, route_date)`, `sync_item(state, sv_number)`, `import_row_raw(import_batch_id, order_number)`, `quote_line(quote_id)`, `po_line(job_id)`.

---

### 1.4 The ePASS back catalogue: customer, payer, asset, history ⟨9/15 late⟩

Cayden dropped two exports: **SV_HISTORY** (117,594 service tickets, Sep 2006 → Sep 2026) and the
**MAIN Customer Contact Info** list being migrated to NetSuite (45,239 rows). Loaded by
`importers/history.py`; the whole load takes about 24 seconds and is idempotent on `sv_number`.

**The two files join cleanly.** `service.Bill To Customer` → `customer.Code` hits **98.9%**, and that
code is the customer's phone number, which settles the identifier question: **the ePASS customer code
is the natural key, and the phone is what the code is made of.** It is recorded as an `external_ref`
row rather than as the primary key of anything — see §1.5.

**The catalogue and the live board do not overlap.** Zero of the 460 currently-open SVs appear in
SV_HISTORY, so `service_history` and `job` are disjoint sets and no reconciliation is needed. About
1,062 rows in the catalogue still carry an open-ish status (782 SO1, 193 SO2, 65 SO6, 15 SO5, 7 SO4) —
those are abandoned tickets, and they are the first thing the Stuck Jobs report should be pointed at
once the load is live.

#### The thing that would have been wrong

**`Bill To Customer` is the payer, not the customer.** 25,148 tickets (21%) are billed to WHIRLPOOL
(7,194), SUBZERO (4,567), GE WARRANTY (3,920), BOSCH (2,739), TRANE (1,615), SPEEDQUEEN, MIELE,
SCOTSMAN and the rest — every warranty visit. Keying customer history on that column would collapse a
fifth of twenty years of work into a dozen fake households named after manufacturers, and a
homeowner's warranty history would not appear on their own account. That is precisely the question the
office is trying to answer on the phone, so `payer` and `customer` are separate tables:

| | |
|---|---|
| `customer` | the household. One row per ePASS customer code. |
| `payer` | who gets billed. `kind` ∈ household / manufacturer / dealer / cash. A COD household is its own payer and the row carries `customer_id` back; a manufacturer's does not. Real counts: 21,593 household, 54 dealer, 29 manufacturer, 1 cash. |
| `asset` | the physical appliance, identified by **serial within a household**. 55,910 of them. |
| `service_history` | one row per historical ticket, pointing at all three. |

Manufacturer-billed tickets are resolved back to a household by `address_key` (street + **unit** + zip,
normalised) and then by surname **at the same house number** + zip (rule 1.4h). Measured on the full
load, re-measured 9/17 after the rule tightened:

| how the ticket found its household | 9/15 | 9/17 | share |
|---|---|---|---|
| `epass_code` — a numeric bill-to that matches a customer | 91,545 | 91,545 | 77.9% |
| `address_zip` | 20,362 | 21,561 | 18.3% |
| `surname_zip` (now surname + house number) | 4,264 | 1,837 | 1.6% |
| `unmatched` — household created from the ticket itself | 1,419 | 2,647 | 2.3% |

The move from 4,264 to 1,837 is 2,222 tickets that had been attached to a namesake at a different
house number plus 309 with no house number at all; they now get their own household, where
`household_key` can cluster them later. Unmatched rising from 1.2% to 2.3% is the price of not being
wrong, and it is the right price.

`service_history.identity_source` keeps that value per row, so a later pass — NetSuite included — can
re-decide any ticket it disagrees with without re-importing anything.

#### Rules

- **1.4a** An asset is only created when the ticket carries a real serial. ePASS placeholders
  (`VERIFY`, `NEED`, `NA`, `NONE`, `TBD`, all-X, all-zero) are rejected by `_JUNK_SERIAL`; without that
  rule one household's unlabelled appliances merge into a single asset with 19 visits against it.
- **1.4b** `serial_core()` reduces a serial to its digit run so `P1562739` and `1562739` are recognised
  as probably one unit. It **flags**, it does not merge — the Bohuslav Sub-Zero 680/S is 26 visits under
  one spelling and 2 under the other, and which is right is a person's call, not an importer's.
- **1.4c** Duplicate accounts are preserved. 3,461 addresses carry more than one ePASS code, normally
  the same house re-entered after a phone change. They share a `household_key` so the office sees
  "2 other accounts at this address" with one click, and nothing is merged. ⟨Cayden 9/15: mirror ePASS
  until the NetSuite customer model is known.⟩
- **1.4d** `asset.first_seen` moves **backwards** as well as forwards: history arrives in file order,
  not date order.
- **1.4e** **Do Not Service.** 212 customers carry the flag. A flagged household is never auto-placed
  and never offered dates; the request lands in the office queue with the flag shown, and only a named
  person may override, with a reason, written to `audit_log`. ⟨Cayden 9/15⟩

- **1.4f Linking an open call to its history.** The catalogue and the live board are disjoint sets, so
  the join between them is the **household**, resolved by the same two keys the importer uses:
  normalised street + zip, then surname + zip. Measured against the 460 currently-open tickets,
  **357 (77.6%) are at an address Wilson has been to before** — 102 of them at a household with ten or
  more prior visits, and **156 have a prior visit on the same serial**. So this is not a rare lookup, it
  is most of the day's work. The board shows it on the card (customer name opens the record, with a
  `↩ this unit ×N` chip when the serial matches) and the field tool shows it on the job screen, collapsed,
  opening to the last visits and whether this exact unit has been in.
  **Three open calls are at a Do-Not-Service household** and are flagged in both places — that is rule
  1.4e catching something real on day one.

- **1.4g Not every ticket is a visit.** `service_history.ticket_kind` is derived from the status:
  `CPU*` → **counter** (8,667 rows, 7.4%) — a part sold over the front desk and written up as a service
  order, 84–86% of them with no scheduled date, median $45, booked as often by office staff codes
  (JKO, EHM, KKD) as by techs; `SO9` → **cancelled** (17,595); everything else → **field** (91,328).
  Counting a counter sale as a routed job corrupts every per-tech average and every backtest, so
  anything that measures routing filters on `ticket_kind='field'`.

- **1.4h The address rule ⟨9/17⟩.** On 9/16 the board showed a Do-Not-Service banner on Leah Baird,
  4946 FM 165, because Sammie Baird, 156 White Rock Ct — same ZIP, no connection — carries the flag, and
  the fallback was surname + ZIP. Cayden: *check the address as well as the last name.* So, everywhere
  an open ticket meets the catalogue (`buildlinks`, the office view, the importer's own fallback):
  the link is the **address** — `address_key` equal, or the same surname at the same house number
  (`same_house()`, which is what a spelling variant of one address looks like). A surname alone
  elsewhere in the ZIP is **offered, never linked**: the card says "namesake in ZIP?", the drawer lists
  who and where, and none of that account's flags travel. **A DNS flag needs the address AND the last
  name to match.** A DNS account at the same address under a different name (a previous owner) is
  mentioned in passing inside the drawer as `dns_other`; it is not a banner and it does not block booking.
  Test: `test_namesake_across_town_is_not_the_same_household`.
- **1.4i Condo units are households ⟨9/17⟩.** 210 Lavaca St has 245 ePASS accounts; without the unit
  they were one household (and 200 Congress, 210 Lee Barton, 98 San Jacinto likewise). The unit is in
  `Address 2` on the customer file ("UNIT 3703", "APT 2502") and inline on tickets ("#2409", "UNIT 1908",
  and "1700 PALOMINO RIDGE DR 6"); `unit_of()` finds all three and `address_key` carries it as `#1908`.
  `same_house()` requires the unit to agree when either side has one. Result: 245 accounts → 174 keys.
  Street lines with no number and under three words ("CLAIM SUBMISSION", "NOT PROVIDED", "DRIPPING
  SPRINGS", "NEW HOUSE") are placeholders and produce no key at all. Test:
  `test_condo_units_are_separate_households`.
- **1.4j Search everyone, group by address ⟨9/17⟩.** "Ort" and "Palomino" did not resolve in testing
  because the office prototype carried 60 households. The office search now reads an index of **every
  customer on file** (47,883 rows: id, name, street, zip, visits, last year, flags, last four of the
  phone) and groups hits **by address**, because appliances don't move: 1509 Palomino Ridge Dr is five
  ePASS accounts and one kitchen (Carol Call ×41, Lonsdale Enterprises ×18, Josh Hernandez ×5 …). A
  short token matches the start of a word ("ort" is Ort and Ortiz, not Short or Fort); name hits rank
  above street hits. Opening an address shows every account, every appliance (deduped by serial across
  accounts) and every call at the house; opening an account shows its own. Agility: the index is one
  query on `customer`; the address view is `WHERE household_key = ?` across `customer`, `asset`,
  `service_history`. Two suffix spellings of one street ("PALOMINO RIDGE" / "PALOMINO RIDGE DR") are
  still two keys — open item 31.

#### What it is worth

15,661 customers have more than one visit and 5,550 have more than five. **18,682 appliances have been
serviced more than once and 4,361 four times or more** — that is the repair-versus-replace conversation
with evidence behind it, and it is the same table the recall rule (§2 rule 30) needs to know what was
done to a serial before. A Sub-Zero 680/S at one address has been visited 26 times between 2009 and
2024.

### 1.5 Identity that survives NetSuite ⟨9/15 late⟩

Cayden: the dashboard runs on ePASS now, NetSuite is coming, "I'd assume NetSuite will be the source of
truth once we are fully ported over", and which system owns what is **not yet decided**. So nothing in
the core tables may assume an answer.

- Every entity keeps **our own surrogate id** (`customer_id`, `asset_id`, `payer_id`). No foreign key
  anywhere points at an ePASS code or a NetSuite id.
- `external_ref(entity, entity_id, system, external_id, is_primary, payload, linked_at, synced_at)`
  holds every other system's identifier — `epass`, `netsuite`, `stripe`, `podium`. The ePASS code goes
  in on load with `is_primary=1`; when NetSuite ids arrive they are inserted with `system='netsuite'`
  and `is_primary` moves. **That move is the entire migration for identity.**
- Because `identity_source` is recorded per ticket (§1.4), a NetSuite-authoritative pass can re-key the
  22% that were matched heuristically without touching the 78% that came in on a real code.
- The direction of truth is therefore a setting, not a schema. If NetSuite ends up owning service
  history too, `service_history` becomes a staging table and the export path is a single join through
  `external_ref`; if it does not, nothing changes at all.

*Open until Cayden confirms:* whether NetSuite will hold service history as well as customers, and
what its customer id looks like (open items 22–23).

### 1.6 The full ODBC export — service detail, sales, parts and labour ⟨9/17⟩

Seven files pulled straight out of ePASS over ODBC, so this is the complete record rather than a report.
Loaded by `importers/fullexport.py` in **32 seconds for ~667,000 rows**; idempotent, and it runs *after*
`history.py`, which keeps ownership of customer identity — this importer adds detail and links it on,
never re-decides whose ticket is whose.

| file | rows | loaded into |
|---|---|---|
| `01_Customers` | 47,006 | (identity already owned by §1.4) |
| `02_Invoice_Master` | 194,583 | `sale` — 76,312 sales invoices; SV and WTY rows are skipped, they are service |
| `03_Sales_Appliance_Lines` | 121,210 | `sale_line` |
| `04_Sales_Serials` | 124,922 | `sale_serial` |
| `05_Service_History` | 117,662 | `service_detail` |
| `06_Service_Parts` | 110,655 | `service_part` |
| `07_Service_Labor` | 116,829 | `service_labor`, and the **technician roster** |

#### What it makes possible

**Click a past call and see what was actually done** — the team's ask, and now a single read,
`fullexport.call_detail(sv)`. A real one:

> **SV00123338** · CARR 24ACC436A300 · s/n 2617E34406 · ACCON · 2026-09-08 · BLL · $280.89
> **Complaint** "The smaller AC unit beside the big trane stopped working over the weekend. Maybe 10 years old // not turning on at all"
> **Performed** "9/8, I UNCLOGGED THE UNIT DRAIN AND REPLACED THE FAILING CAPACITOR. SC 8 DELTA T IS 22 DEGREES. NO OTHER ISSUES FOUND."
> **Parts** CAP45/5 — 45/5 MFD @ 370V DUAL CAPACITOR, qty 1, $69, installed
> **Labour** Brady Langley — Diagnostic Zone 1 $92.33; Capacitor (Run) Replacement – Outdoor Unit $106.25

**Model Insight** (team ask, 9/17) — `fullexport.model_insight(brand, model)`. On the Scotsman
SCN60PA-1SS, 572 calls on record, the parts that actually went in are **pressure switch ×99**, nickel-safe
cleaner ×52, bearing ×46, ice sweep ×28. On the Sub-Zero UC-15IP, 452 calls: water filter ×67, inlet
valve ×43, water pump ×28. That is real tech knowledge, not inference, and it is why v1 shows history
rather than predictions ⟨Cayden 9/17⟩.

**The technician roster, complete.** All **51 codes carry a name** — `tech.name`, `first_service`,
`last_service`, `lifecycle` (`active` / `historical`), `ended_on`. A retired tech keeps resolving on
twenty-year-old tickets, which is what team item 40 needs. SAW is Scott Wilson, 17,952 labour lines,
last worked Aug 2025.

**Purchase provenance.** `link_assets_to_sales()` matches service serials to sale serials with case and
punctuation stripped: **27,428 of 55,910 assets (49%)** are units we sold, and they now carry
`purchased_from_us`, `purchase_date`, `purchase_price` and `purchase_invoice`. **Closes open item 27.**

#### Four properties of the data that constrain what can be built

- **1.6a The complaint taxonomy was abandoned.** `SvcComplaintCode` is filled on 1,394 of 117,662 rows
  (1.2%). The content lives in `SvcComplaintDesc` — 98.2% filled, free text, **92,786 distinct**
  ("NOT COOLING" 558 and "not cooling" 186 are separate strings). Anything that groups symptoms groups
  on `product_code` plus normalised text; **nothing may key on the complaint code.**
- **1.6b There is a clean category axis.** `SvcProductCode`, 96% filled, **117 values** — DW 13,781,
  IMUC 9,227, ACCON 6,590, DRELE 6,383, REFRE 6,233. This is the spine for every grouping.
  32,081 distinct brand+model pairs; **1,679 models with ≥10 calls, 397 with ≥25**.
- **1.6c `TimeCharged` is not a duration.** 21% filled, the unit column reads "Minutes" on every row,
  median 0.52, maximum 740 — a billing field with mixed units. Stored verbatim with `time_unit`, and
  **excluded from anything that estimates on-site time**, which still comes from the field tool (§4.1a).
  `FailureCode` is empty on all 110,655 part lines, so a part links to a symptom only through
  `item_desc` and the ticket's complaint text.
- **1.6d ePASS lost its apostrophes.** The export literally contains "Won?t stop running" and "I?d
  like". The files are valid UTF-8, so this is upstream, not a decode fault. The stored text is left
  exactly as exported; `tidy()` repairs it **for display only**, and only where a question mark sits
  between two letters, which a real one never does.
- **1.6e Every past call opens ⟨9/17⟩.** Testing asked for the SV in "last visits" to be clickable and to
  say which appliance it was. `call_detail(sv)` (§1.6) is now behind every SV on all three screens — the
  board's history drawer, the field tool's past panel, the office account and address views — showing
  complaint, work performed, labor lines, parts (installed vs quoted), tech, payer, unit (brand, model,
  serial). Units show **model and serial** everywhere they used to show only the serial; an appliance
  card is a filter on the calls beneath it; and "this exact unit has been in before" is a button to the
  last SV on that serial, not a sentence.

### 1.7 Model families — Model Insight in three tiers ⟨9/17⟩

Cayden: *SHV78 and SHP78 are the same dishwasher with different handle styles — look at something
broader, like model families.* Bosch's third letter is the handle (P pocket, V panel-ready, X bar, E
recessed, S scoop), the digits after it are the series, and `/25` at the end is a production index.
An exact lookup on `SHP78CM5N` sees 22 calls; the family sees **107** across SHP78 / SHV78 / SHX78 and
every `/NN`; Bosch dishwashers as a type are 2,713. So Model Insight shows **three tiers** — the exact
model, its family, the brand's product type — with the count for each, the parts we actually installed,
and the recent calls as typed, and the tech picks the breadth that fits the question.

**The family key is brand | product code | stem**, so a Whirlpool `WRF555` never meets a KitchenAid
one. The stem comes from a small **rule table**, first match wins, and a code default:

| rule | applies to | example |
|---|---|---|
| Bosch/Thermador/Gaggenau dishwashers: `SH` + handle letter + (M) + 2–3 series digits → `SH?{digits}` | brand ~ BOSCH·THERM·GAGG, product ~ DW | SHP78CM5N/25, SHV78B73UC, SHX78CM5N → `SH?78`; SHX878ZD5N → `SH?878` (Benchmark stays its own) |
| Bosch newer dishwashers: `SH` + letter + one digit + two-letter tier → `SH?{d}{tier}` | same | SHX7PT55UC → `SH?7PT` |
| **default**: leading letters + first digit run, production index (`/…`) dropped first; a model that starts with digits keeps the digits plus up to three letters | everything else | WRF555SDFZ00 → `WRF555` · GNE27JYMFS → `GNE27` · PRD48WDSGU → `PRD48` · DWHD870WPR → `DWHD870` · 648PRO → `648PRO` · KUIX535HPS01 → `KUIX535` |

Phase 0: `model_family()`, `family_members()`, `model_insight()` in `importers/fullexport.py`
(`MODEL_FAMILY_RULES` is the seed); test `test_model_family`. Agility: the rules live in
`model_family_rule` (§1.2) so the office can add one when a brand's naming is learned — the default
rule is code, not a row. Real numbers from the field tool's Thursday: KitchenAid `KUIX535HPS01` — 205
exact, 386 in `KUIX535`, 3,610 KitchenAid undercounter ice makers; family parts THERMISTOR ×54, CIRC PUMP
×47. GE `GTW465ASN9WW` — 1 exact, 35 in `GTW465`.

**Watch-out flags** (`model_flag`): a tech types *why* (required — a flag with no reason is noise),
it goes to the service manager as `pending`, he publishes or retires it, and published flags sit at
the top of Model Insight for every tech on that family. ⟨Cayden 9/17: push to Mark first, then he
broadcasts.⟩ Complaint text is shown as typed; no clustering or inference in v1.

## 2. Status engine

Status vocabulary = ePASS codes so the mirror is one-to-one. Dashboard-only pre-status `REQ` exists before an ePASS ticket. Transition table: **an event fires, the engine checks the guard, applies the transition, then runs side effects in order**. Anything not in this table is a manual change and requires `reason_code`.

| # | From | Event (trigger key) | Guard | To | Side effects |
|---|---|---|---|---|---|
| 1 | — | `form.submitted` | card SetupIntent succeeded OR landlord/PM with no card | `REQ` (or `SO1.AUTH` if no card) | create customer/address/job/unit; zone lookup; `notify:request_received`; if `booking_mode='office_only'` → create Client Care task; if `designated_days` → add to trip bucket |
| 2 | `REQ` | `customer.picked_window` / `staff.booked` | slot valid per §4 | `SO1` | create appointment(diag); `sync:create_ticket` (status SO1, date, tech); `notify:so1_booked` |
| 3 | `SO1.AUTH` | `auth.received` | card saved or PM approval recorded | `REQ` | — |
| 4 | `SO1` | `tech.findings_submitted` outcome=`field_quote` & decision=`approve` & parts>0 | signature stored, agree=true | `SO3` | set `owner_tech_id`; create quote(kind=field, status=approved); `sync:set_status SO3 + add_lines`; `notify:approved_ordering` |
| 5 | `SO1` | same, outcome=`field_quote`, decision=`approve`, parts=0 | | `SO1` (work continues) → on `tech.repair_complete` → `SO8` | create quote approved; on complete: payment(repair) |
| 6 | `SO1` | outcome=`field_quote`, decision=`later` | | `SO2` → immediately `SO2.1` if all lines pre-verified else stays `SO2` | create quote(kind=field, status=draft); parts verify queue |
| 7 | `SO1` | outcome=`field_quote`, decision=`decline` | | `SO7` | payment(diag_fee 169.95); `notify:declined_receipt`; sales lead |
| 8 | `SO1` | outcome=`office_quote` | ≥1 part or labor line | `SO2` | set owner; quote draft; parts verify queue |
| 9 | `SO1` | outcome=`quick_fix` | | `SO8` | set owner; payment(diag_fee); `notify:receipt` |
| 10 | `SO1` | outcome=`research` | note present | `SO1` (flag `research`) | task for service manager |
| 11 | `SO1` | outcome=`replace` | note | `SO7` | payment(diag_fee); sales lead (existing Shopping flow) |
| 12 | `SO1` | outcome=`declined` (diag fee walked) | note | `SO7` | payment(diag_fee) |
| 13 | `SO1` | outcome=`no_access` | note | `SO1` | appointment cancelled(reason=no_access); `notify:reschedule_needed`; job back to bucket/picker |
| 14 | `SO1` (warranty) | `tech.findings_submitted` with parts | `is_warranty` | `SO3` | owner set; no quote; warranty admin queue |
| 15 | `SO2` | `parts.verified` (all lines verified+availability) | | `SO2.1` | if `quote.kind='field'` and requote rule (§5.7) fails → build revised quote, `notify:quote_revised`, status `SO2.2`; if passes → `SO3` directly |
| 16 | `SO2.1` | `system.quote_built` (immediate) | | `SO2.2` | render quote from lines; `notify:quote_sent` via contact_pref (call pref → also call task); schedule reminders 48h/5d |
| 17 | `SO2.2` | `customer.approved` | | `SO3` | quote approved; `sync:set_status SO3 + add_lines`; `notify:approved_ordering` |
| 18 | `SO2.2` | `customer.declined` / `customer.shopping` | | `SO7` | payment(diag_fee); sales lead |
| 19 | `SO2.2` | `timer.no_response` 14 d | | `SO7` | call task at day 10 first; then payment(diag_fee) |
| 20 | `SO3`/`SO3PRE` | `po.placed` (all part lines on a PO) | | `SO4` / `SO4B` if `expected_at − today > backorder_days` / `SO4H` if ship_to=customer | set `eta`; `notify:parts_ordered`; owed-install ledger updated |
| 21 | `SO4`/`SO4B`/`SO4H` | `customer.held_date` | eta ≤ date−1 | `SO4PRE` | appointment(install, tentative); `sync:set_schedule` |
| 22 | `SO4*` | `po.eta_changed` | Δ > 2 days | same | `notify:parts_delay`; if `SO4PRE` and eta ≥ held date → `notify:reschedule_needed`, back to `SO4` |
| 22a ⟨9/11⟩ | `SO4PRE` | `timer.hold_check` (07:00, `hold.check_business_days_before` = 2 business days before the held date) | not all part lines received | `SO4PRE` (flag `hold_at_risk`) | task to Parts/receiving (Kezia): *check ETA for {sv} — held {day}*; task carries buttons **Part is here** (→ receive → #24), **New ETA** (records eta, → 22b now if eta ≥ held date) and **Wait** |
| 22b ⟨9/11⟩ | `SO4PRE` | `timer.hold_release` (`hold.release_business_days_before` = 1, 14:00) **or** `staff.hold_time_out` from the Kezia task | not all part lines received | `SO4` | appointment cancelled (reason `part_not_in`, the ePASS "time out"); flag cleared; `notify:hold_released_apology` (apology + picker link offering dates ≥ new ETA + 1); `sync:set_status SO4 + clear date`; owed-install ledger updated; 2-day auto-confirm never sends for a job in `hold_at_risk` |
| 23 | `SO4`/`SO4B`/`SO4H` | `receiving.all_parts_in` | | `SO5` | `bin_location`; `notify:part_arrived_pick_time` (owner tech's slots) |
| 24 | `SO4PRE` | `receiving.all_parts_in` | eta ≤ held−1 | `SO6` | appointment confirmed; `notify:held_confirmed`; `sync:set_status SO6` |
| 24a ⟨9/11⟩ | `SO4H` | `customer.part_received` (tracker button *My part arrived*) or `carrier.delivered` (tracking webhook, Phase 3+) | — | `SO5` | `bin_location='CUST'`; `notify:part_arrived_pick_time` (owner tech's slots); `sync:set_status SO5`; if neither fires by `eta + 1` → `notify:so4h_check_in` |
| 25 | `SO5` | `customer.picked_window` / `staff.booked` | owner tech only (§4.6) | `SO6` | appointment(install); `sync:set_schedule`; `notify:install_confirmed` |
| 26 | `SO5` | `timer.unpicked` 2 d | | `SO5` | Client Care callback task with picker |
| 27 | `SO6` | `tech.repair_complete` | all part lines marked installed | `SO8` | payment(repair, approved total); `notify:receipt`; on_site_minutes recorded |
| 28 | `SO6` | `tech.more_parts` | lines added | `SO2` | new quote version; verify queue |
| 29 | `SO6` | `tech.part_issue` (wrong/damaged/missing) | | `SO3` | reorder lines flagged; `notify:parts_delay` |
| 30 | `SO6` | `tech.not_fixed` | note | `SO1` (flag research) | manager task |
| 31 | `SO8` | `payment.succeeded` | amount = approved total | closed (`SO8` stays as ePASS status; `closed_at` set) | `sync:post_payment + close` |
| 32 | `SO8` | `payment.failed` | | `SO8` | retry schedule (24h, 72h); `notify:payment_link`; after 3 fails → payment.review |
| 33 | `SO8` | `payment.amount_mismatch` | tech changed lines / discount | `SO8` | payment.status=review → Noell queue |
| 34 | any open | `customer.cancelled` / `staff.cancelled` | reschedule rules §4.7 | `SO9` | cancel appointments; if a diag was run → payment(diag_fee) |
| 35 | any | `staff.manual_status` | `reason_code` present | target | audit; `sync:set_status` |
| 36 ⟨9/15⟩ | any open | `staff.needs_tech_input` | `prompt` present (≤200 ch) | unchanged | `needs_tech_input=1`, `tech_input_prompt`, `tech_input_asked_by/at`; **push a card to the owning tech's My Notifications** (`notify:tech_input_needed`); job pinned to the top of that tech's list until cleared |
| 37 ⟨9/15⟩ | any with `needs_tech_input=1` | `tech.notes_submitted` / `tech.findings_submitted` | — | unchanged (or the rule the findings themselves fire) | clear `needs_tech_input`, retire the notification card, notify the asker |
| 38 ⟨9/15⟩ | `SO1` + flag `research`, or `needs_tech_input=1` | `timer.nag` | still open after `nag.interval_hours` | unchanged | re-raise the tech's card (same ref, not a second card), `nag_last_sent_at`; after `nag.escalate_after` unanswered rounds also raise one for the service manager |

⟨9/15⟩ **Rules 36–38 are the same mechanism with two doors** (team items 22 and 25). The office marks a call *needs the tech* with a one-line prompt ("what did you find on the compressor?"); a research ticket the tech asked to keep marks itself. Either way the job sits at the top of that tech's **My Notifications** until the tech answers, and it keeps coming back every `nag.interval_hours` (default 24, and only during that tech's working hours) rather than once. The card is retired by the tech's own submission, not by anyone clicking "done". Escalation after `nag.escalate_after` (default 3) rounds goes to the service manager, because at that point it is a conversation, not a reminder.

Aging thresholds that raise a **Stuck Jobs** flag (no transition): SO2 > 24 h, SO2.2 > 5 d, SO3 > 2 business days, SO4 past `eta + 2 d`, SO5 > 2 d, SO1 with `research` > 3 d (⟨9/15⟩ and it nags the tech from day one — rule 38), `REQ` > 1 business day, bucket age > 5 business days, ⟨9/11⟩ `SO4H` past `eta + 3 d` with no part-received tap, `hold_at_risk` unanswered > 24 h.

**Recall detection** ⟨9/11⟩ (side effect of every job creation — rule 1, `staff.booked` on a phone-in, or `import.create`): look for a job on the same `unit.serial` (or same `model` at the same `address_id` when the serial is blank) that reached `SO8`/`SO8I` within the last `recall.window_days` (30). Found → `recall(state=candidate, basis=serial|model_address, tech_id=original.owner_tech_id)`. If `warranty_flags` contains `RCALL` (the office already marked it in ePASS) → `recall(basis=epass_rcall, state=confirmed)`. Candidates appear in a **Recalls** queue for the service manager to confirm or dismiss (with a note); a candidate not reviewed within 7 days counts as a recall in the KPI so it cannot be hidden by ignoring it. A confirmed recall is a new SV that keeps the original owner (ownership rule), is not billed a diagnostic fee, and is tagged on the board and field tool.

**Field tool input guards** ⟨9/11⟩ (validated by `POST /tech/jobs/{id}/findings`, not status rules): symptom `error_code` selected → `error_code` required (short alphanumeric field; the one typing exception besides the custom note); `labor_block` half/full day sets the labor line to 4.0 h / 8.0 h at the department rate and the install duration to 240 / 480 min; `custom_note` is optional, kept on the dashboard job, and only its first 200 chars can ever reach a packet.

---

## 3. Import and reconciliation

### 3.1 Files
- **DispatchTrack**: `\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport\DispatchTrackDetail_*.csv`, every 15 min, full snapshot, **cp1252**. Header row confirmed in `reference/data/DispatchTrackDetail_20260910_220003.csv` (60 columns; last is empty). One row per line item; group by `Order Number`. Service rows: `Order Number LIKE 'SV%'`. Today only statuses SO1/SO4PRE/SO5/SO6 appear (routing feed); Cayden is asking ePASS to widen it.
- **ExportInvoice**: xlsx, header on row 3 (`Status, Payment Type Code, Job Status, Balance, * Sched Date, Route, Invoice #, Name, Address, Finish Date, SP, Total, Map Zone, PO #, Reference, Bill To Customer, Bill To Customer Name, Service Model, Service Serial, Spec Auth #, Bill To Email, Service Brand, Zip Code, Date Created, Units, Qualification, Priorities`). `Invoice #` is left-padded with spaces — trim. Uploaded manually today; keep the upload endpoint, add a watched-folder option.

### 3.2 Watcher
Reuse the sales-side pattern (`C:\WilsonRouting\import_epass.py`): scheduled task every 5 min; find newest file; skip if `file_name` already in `import_batch`; parse; commit; log. Run as a separate task/process from the sales importer, same folder. On parse failure: mark batch `failed`, alert, do not partially apply.

### 3.3 Parsing rules (DT)
- `Order Number` → `sv_number`. `Job Status` → `epass_status`. `Delivery Date` (m/d/yyyy) → `epass_route_date`. `Truck` → `epass_tech_code` (map to `tech.sp_code`; `''` = unassigned; `VJ` → Vince). `Map Zone` → `zone_code` (upsert unknown codes into `zone` with `booking_mode='office_only'` and a review flag). `Latitude/Longitude` → `address.lat/lng` (source `epass`) when the address has none. `Balance` → `job.balance`. `Priorites` → `warranty_flags` (comma list; `WTY` → `is_warranty=1`). `Location` → `bin_location` if non-empty. `Directions` → `address.access_notes` if empty. `Qualifications` → `qualification`. `Order Detail` first row → unit category/brand/model/serial via regex `^(\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(SV|WTY)\s+(.*)$` best-effort; store raw too. `Service Time` **ignored** (placeholder 30). `Ship *` → address if job has none. `Phone2/Email` → customer if empty.
- Multiple rows per SV: first row for header fields; every row's `Model/Description/Quantity` → `import_line` (for SO4–SO6 these are parts).

### 3.3a Two ePASS conventions the importers normalise ⟨9/15⟩
Both confirmed on the second real invoice export (`ExportInvoice_20260915_current_sv.xlsx`, 460 open SVs):

- **The parking date.** ePASS writes the *coming Saturday* as the Sched/Delivery date for work that has no real date — Sat 9/12 on 121 tickets in the 9/10 export, Sat 9/19 on 155 in the 9/15 one (SO2.2 43 of 44, SO4 43 of 62, SO4H 8 of 8, SO3 12 of 19). Nobody routes Saturday, so the importers treat a date on a day **no active tech works** (`tech.work_days`, union over active techs) as unscheduled: `epass_route_date = NULL`, flag `parked`, counted as `parked` in the import summary, cleared automatically when a real day appears. Setting `import.parking_day_rule` (default on). Without this, 155 phantom stops land on a Saturday board and the stale rule fires on all of them a week later. The same rule catches 22 of the 236 orders in the DispatchTrack snapshot.
- **Status case.** The export carries `SO8` and `so8` in the same file. Both importers upper-case `Job Status` before `ensure_status`, so ePASS typos do not create parallel statuses. (`QUOTE 2` is a genuine junk status and still surfaces as an unknown for the office to fix in ePASS.)

### 3.4 Upsert rules (the "dashboard owns" list)
For an existing job, the import **updates**: `epass_status`, `epass_route_date`, `epass_tech_code`, `epass_seen_at`, `balance`, `bin_location`, `warranty_flags`, `lat/lng` (if missing), `access_notes` (if missing). The import **never writes**: `status`, `route_date`, `assigned_tech_id`, `route_sequence`, `promised_window_*`, `owner_tech_id`, `trip_id`, anything on quote/appointment. For an SV not yet in the dashboard (created directly in ePASS, e.g. phone-in before Phase 4), the import **creates** the job with `source='import'`, `status = epass_status`, `route_date = epass_route_date`, `assigned_tech_id` from `Truck`, and flags it `needs_intake_review` so Client Care can attach a card/contact pref.

### 3.5 Sync items
Created by side effects in §2 (`sync:*`). `packet_text` is rendered from `payload` in this fixed shape (this is what gets pasted):

```
SV00123290  Gary & Karen Jones
STATUS: SO3   DATE: 9/16/2026   WINDOW: 8–12   TECH: DLA
LINES:
  W10348269    Drain pump  x1  $148.00
  LAB          Drain Pump Replacement 1.5h  x1  $195.00
NOTE: FIELD-APPROVED $382.27 signed 9/14 8:52a. Standing water; drain pump seized. Labor tax-exempt (built-in). Full findings + 3 photos: dashboard SV00123290.
```
`NOTE` is auto-generated: `[FIELD-APPROVED $total signed <ts>. ]<outcome/symptoms/cause sentence>. [Labor tax-exempt (built-in). ]Full findings + N photos: dashboard <sv>.` Never the tech's free text verbatim beyond 200 chars.

Lifecycle: `pending` → (staff taps Keyed) `keyed` → (next import shows all payload fields matching) `confirmed`. If two consecutive imports after `keyed_at` show a mismatch on any payload field → `discrepancy` with `epass_values`. Resolution: **Re-issue** (state back to `pending`) or **Accept ePASS** (write ePASS values into the dashboard fields, `status_history` with trigger `epass_accept`, actor staff). For `create_ticket` items the confirmation is "an SV appears whose customer phone/last name + zip match the job" → set `job.sv_number`.

**Reverse discrepancy**: an import where `epass_status`/`epass_route_date`/`epass_tech_code` differ from the dashboard fields **and** there is no open sync item explaining it → create a `sync_item(kind=set_status, state=discrepancy)` with the ePASS values, so the office decides. Fields to compare: status (map SO4PRE↔SO6 leniently for 1 cycle), route date, tech.

⟨9/19 late⟩ **`kind='fields'`** — a correction made in the dashboard (§6c) that ePASS has to be told about: `fields` (the new
values), `was` (the old), `why`, `by`. Rendered as `FIELD CORRECTION — keyed by the office, confirmed by the next import`
with one `was […] → […]` line per field. Pending until keyed; confirmed when the import shows the new value; a discrepancy
if two imports disagree, like any other item.

### 3.6 Service Order Health
Keep it, feed it from the import tables instead of the upload, and replace "dates in the past" with the Stuck Jobs thresholds.

### 3.7 KPIs ⟨9/11⟩
The team asked for recalls, call turnaround and calls per day "and a few other metrics we will change later", so KPI definitions live in a `kpi.defs` settings JSON (name, SQL-ish formula, window, per-tech vs company, visible-to-tech flag) and the KPI page renders whatever is defined. Materialised into `kpi_daily` nightly and on every completion; shown per tech for the week, rolling 30 and rolling 90 days, with a trend arrow against the prior period. Starter set, all computable from the mirrored data on day one:

| KPI | Definition | Source today → later |
|---|---|---|
| **Recall rate** | confirmed recalls (+ unreviewed candidates > 7 d) attributed to the original tech ÷ repairs completed by that tech in the window | `recall` table (§2) from serial/model matching on imports; `warranty_flags` RCALL |
| **Call turnaround** | median (and p90) business days from ticket created → SO8/SO8I; shown separately for diag-only and repairs | `epass_created_at` → `epass_finish_date` (ExportInvoice) → dashboard `created_at`/`closed_at` |
| **Calls per day** | completed visits ÷ working days (`work_days` − closed `tech_day`s) | route dates of SO1/SO6/SO7/SO8 by tech from the DT feed → arrive/complete taps |
| Diag-only rate | SO7 + quick-fix diag-fee invoices ÷ completed invoices (baseline 33%) | ExportInvoice `Total` = 169.95 → `payment.kind` |
| Quote approval rate & time to decision | approved ÷ sent; median hours sent → approved | dashboard quotes (Phase 2) |
| Hours diag → quote sent | median | findings → quote sent (Phase 2; baseline 24–72 h) |
| Days part in → install | median SO5 → SO8 | status_history |
| Delivered $ per call, per day, per week | §5.7 | `delivered` |
| Drive minutes per completed call | planned/actual | optimiser (Phase 5) |
| Stale visits, open discrepancies, forced stops | counts | Phase 0 tables |

Visibility: techs see their own delivered dollars and calls per day in the field tool; recall rate and the rest are manager-only by default (`kpi.defs.visible_to_tech`).

---

## 4. Capacity, scheduling and routing

### 4.1 Definitions
- **Window**: AM 08:00–12:00, PM 12:00–17:00 (tunable). A booked job has a `promised_window` (never moved by the system) and a `planned_slot` (movable).
- **Capacity per half-day** per tech = 240 min − reserved buffer (tunable 25 min).
- **Duration**: from `settings.duration_defaults` by (job kind, unit category, install_type) — seed: diag appliance 60, diag HVAC 90, diag built-in refrigeration 75, install = Σ labor hours × 60 × tech `speed_factor`, multi-unit +30/unit, sealed-system ×1.25. Learned: nightly job recomputes per-category medians from `findings.on_site_minutes` once ≥ 20 samples; `speed_factor` per tech = median(actual/allowed) over last 90 days, clamped 0.7–1.4.
- **Drive time**: Google Routes API (or Mapbox) with departure-time traffic, cached per (origin zip centroid, destination zip centroid, hour bucket) for 30 days; fallback = 4 min + 1.55 min/km straight-line (the prototype's formula, within ~15% on the sample data).
- ⟨9/11⟩ **Working days and the dispatcher's capacity controls.** `tech.work_days` is the default week (JRC Mon–Thu). A day outside it is *closed*: hatched on the fill strip, zero capacity, never offered to customers. Everything capacity-related is a one- or two-click action on the fill strip, because the dispatcher does it several times a day: click a tech-day cell → popover with **Close day** (PTO / sick / training / other), **Open day** (turns a closed day, e.g. Josh's Friday, into a normal day "per management"), **+1 stop** / **+60 min** / **−60 min** (`tech_day.capacity_adjust_min`), **Add block…** (`route_block`: label, start, end, optional address). Drag across cells or pick a range for multi-day PTO. Dragging a job onto a full column shows a red *Over capacity* chip with a **Force it** button: one click, no reason code, logged as `capacity.forced` with the actor; the ledger shows the overage in red instead of refusing. Every control writes `tech_day` with `set_by/set_at` and a `route.capacity_changed` audit row; the ledger recomputes immediately.
- **Eligible techs for a job**: skill match (`qualification` HVAC → BLL only, zone ignored for HVAC; TDP as HVAC backup only when staff assigns; sealed → all techs), `auto_schedule=1`, and zone match: primary or secondary of the job's zone (Core Hill Country zones list every shop-start tech as secondary — everyone passes through). If `owner_tech_id` is set → only the owner.

### 4.1a Per-tech capacity settings, and commute out of the route day ⟨9/15⟩
Team item 23 ("Connor and Trevor are both set at well over 100% all week") is two problems, and only one of them is a settings screen.

**The measurement was wrong.** The fill bar counted the home→first-stop and last-stop→home legs against the 9-hour route day. For a tech who starts and ends at home that is commute, not route time, and it was doing most of the damage. Over the real week in the 9/15 export, **19 of 38 working tech-days read over 100%; excluding those legs entirely, 9 do; with a 45-minute-each-way allowance, 15 do.** Connor's Tuesday goes 156% → 99% unlimited, 140% with the allowance — correctly, because that day contains a four-hour round trip to Cherokee. Trevor's Tuesday goes 114% → 88%. So:

- `route_min` = on-site + **inter-stop** drive + `route_block` minutes. This is what `available_min` and the fill bar measure.
- `commute_min` = the first leg from `start_default` and the last leg to `end_default` **when they are `home`**. Shown beside the bar ("+1h 12m commute"), never inside it. A shop start/end is not commute — loading parts at the shop is work (§4.5).
- `commute_allowance_min` per tech caps what is absorbed; beyond it the excess counts as route time, so a genuinely absurd first leg still shows up. Zone `OUT`/`KERR`/`SA` work is the case that trips it. ⟨9/15 pm⟩ Default 45; **Connor is 60** (Cayden: "about an hour each way" from New Braunfels).

**What is left is real, and it is on-site minutes, not driving.** The days that stay over are JRC 9/14–9/16, TDP 9/14 and 9/16, and AJH 9/15 (558 min of work with only 65 min of inter-stop drive — seven stops in one tight zone). Those are scheduling decisions to have a conversation about, not a display bug. ⟨9/15 pm⟩ JHM's Wednesday west bucket (873 min in 14 stops) is off this list entirely: it was never a route, and JHM is now a **collector lane** with no capacity at all — §4.1c.

**The settings menu** (executive or dispatcher, audited) edits per tech: `work_days`, `shift_start`/`shift_end`, `max_stops_per_day`, `max_onsite_min`, `max_inter_stop_drive_min`, `commute_allowance_min`, `accepts_overflow`, `speed_factor`, plus the existing `auto_route` / `auto_schedule`. `max_stops_per_day` and `max_onsite_min` are **hard filters** in §4.3 (the engine will not offer past them); `max_inter_stop_drive_min` is a **soft penalty** in the score; `accepts_overflow=0` means only a human may exceed a limit, via **Force it**, which stays one click and stays audited.

**Durations stay assumptions until the field tool measures them.** Nothing in either ePASS export carries on-site time, so `duration.defaults` is still the seed. `record_visit` already writes `on_site_minutes`; after `duration.learn_after_days` (28) with `duration.min_samples_to_learn` (20) samples, the median per (category, install_type, job kind) replaces the seed. Until then, treat an over-100% day as "these durations say it doesn't fit", not as fact.

### 4.1c The collector lane — a tech who has no schedule ⟨9/15 pm, corrected 9/15 late⟩
Cayden, 9/15: John Merz "makes and handles his own schedule entirely… essentially his own contractor… more of a folksy customer service tool we have for the Fredericksburg area. It's extremely unprofitable to employ him but he's grandfathered in and does provide for good word of mouth referrals."

**What the lane is not.** My first draft of this section made the west zones route to John and stopped offering dates there. That is wrong, and Cayden corrected it: *"I still want to route fburg customers in the standard way. Ultimately we still need a west route that can be auto scheduled. Most of John's customers just text him directly at this point, and anyone hitting the service journey we are building should be scheduled through it. The John section of what we are building is to help the office track what's going on more or less."*

So the lane is a **tracking view over work that is already John's**, not a destination for new work. Two paths, kept apart:

| Path | Where it goes |
|---|---|
| A request that comes through the service journey — web form, Client Care, the copy button — for a west ZIP | **Normal placement.** Real dates, real slots, §4.3 exactly as everywhere else. A customer never lands on the lane by virtue of their ZIP. |
| A call that is already John's — he was texted directly, or the office hands it to him | The lane. No dates, tracked by age, §rules 39–43. |

A job reaches the lane **only by an explicit act**: the office assigning it to a collector tech, or an import arriving with `SP = JHM`. `tech.mode='collector'` changes nothing about how a ZIP is routed — it changes what happens to a job once it is that tech's.

**The west still needs a routable owner.** Today the zone table makes JHM the primary on FBURG, BLANC, JC, BOERN, STONE and the trip tech on all of them (`trip: ['Wed','JHM']`), which is what makes "route Fredericksburg normally" impossible right now: normal routing there resolves to a tech who has no schedule. The west becomes a designated-days trip bucket (§4.4) like Braunfels and Horseshoe Bay, run by a routed tech — DLA is already the listed secondary on BLANC, JC and STONE, CEM on BOERN. **Who runs the west trip is open item 19.** Until that is answered the zones keep filling a bucket and the office places them, which is today's behaviour minus the false 225%.

**A fill percentage on a collector column is a lie, and the board was telling it.** JHM read 225% on Wed 9/16 because the office had dated 15 of his tickets to that Wednesday and 18 more to 9/23. Those are not routes; they are a pile with a date on it. So `tech.mode` gains a third value:

| `tech.mode` | meaning | capacity | dates | appears in |
|---|---|---|---|---|
| `route` | the eight routed techs | yes | real | fill bar, placement, scorecard |
| `trip` | MAP, VWJ, designated-day zones (§4.4) | per trip day | trip day | fill bar on trip days |
| `collector` | JHM | **none** | **none** | the lane, Stuck Jobs, nothing else |

Rules for a lane (`mode='collector'`):

- **39.** A job **assigned to** a collector tech gets `route_date = NULL`, no `half_day`, no ledger row, and never a `penciled_date`; `placement.suggest` and `offer` return empty for it, so the customer of a lane job is not offered a picker. This is a property of the assignment, never of the ZIP — see the two paths above.
- **40.** The lane's measure is **age**, not fill. `lane_age_days = today − created`. The board row shows open count, median age, oldest, count over `lane.escalate_days` (**30** ⟨Cayden 9/15⟩), and dollars on the books, over a five-bucket age bar (0–7 / 8–14 / 15–30 / 31–60 / 60+). Clicking it opens the lane, grouped by **who it is waiting on** — tech, office, customer — derived from status, oldest first.
- **41.** A collector job crossing `lane.escalate_days` raises one Stuck Jobs item with three actions and no default: call the customer, move it to the next west trip (§4.4), or close it. It raises **once** and re-raises on `lane.escalate_repeat_days` (14), reusing the same `ref_id` so it does not stack.
- **42.** Collector techs are excluded from the productivity table, `week_target`, and every per-tech average. Including one tech with a 3-call week and an 85-day median in the same table as a routed tech makes both numbers meaningless.
- **43. The shop visit.** When he is at the shop, the office opens one screen: his SO5s (part in, never installed) with a **Took the part** tap that writes `part_issued(sv, part_line, to_tech, at)`, and his SO1s with no findings, each with the §2 rule 36 *needs tech input* marker.
- **44. The hand-off text** — §6a below. One button per lane job that sends John the call, which is the copy-and-paste the office does by hand today.

**What the lane costs us today, from the 9/15 export.** JHM has **42 open tickets; median age 85 days against 10–26 for the routed techs; 31 over 30 days; the oldest is 739 days**; $8,300 on the books. Twenty-one are SO1s — diagnostics run with nothing written up. **Nine are SO5: part received, never installed, worth $2,989** — Lassiter at 739 days ($1,009), Sidlo at 560 ($467), Fielding at 498 ($55). An SO5 that old means the part is sitting somewhere, most likely in his van, bought and never billed. The parts-issue tap in rule 43 is what makes that visible; it is a bigger number than his labour.

Tunables: `lane.escalate_days` **30**, `lane.escalate_repeat_days` 14, `lane.offers_dates` false, `lane.in_scorecard` false, `lane.handoff_enabled` true.

*Not a long-term design.* Cayden: "it's not in the business plan long term, we just need to work around it for the time being." `mode='collector'` is deliberately a lane with no scheduling machinery attached, so retiring it later is deleting a row, not unpicking a feature — and because new west requests never enter it, the lane shrinks on its own as the old book closes.

### 4.1d The hand-off text to a collector tech ⟨9/15 late⟩
Cayden: *"can we build a button on the calls in John's lane that will fire the Podium API to text John the relevant details? Name, address, phone, email, gate, cust complaint, any notes on our end etc? Basically pseudo automate the current process of copy pasting customer info and texting him manually."*

One button per lane job, **Text John the call**. It is a technician hand-off, not a customer message, so it sits outside the customer templates in §6 and has its own key and its own rules.

- **The key never reaches the browser.** Same relay shape as every other send: the page posts `POST /api/jobs/{id}/handoff {"to_tech":"JHM"}` and the server calls Podium with the token from the Render environment (doc 12 §5). Nothing in the client holds a credential.
- **Preview, then send.** The button opens the rendered message with every field filled in and an editable free-text box for "anything on our end". Nothing leaves until the office presses send — the explicit-click rule in doc 12 §5, which applies here even though the recipient is staff.
- **It is logged like any other send**: a `notification` row (`channel='sms'`, `template_key='tech_handoff'`, `to` = the tech's mobile, provider id, delivery status) plus an `audit_log` entry and a `status_history` note on the job, so "did anyone actually send this to John" is answerable. The lane card then shows **sent {n} d ago**, and a job handed off more than `lane.handoff_stale_days` (7) ago with no movement is what rule 41 escalates on first.
- **Re-sending is allowed and counted.** The second send says *(resend)* at the top so John can tell it apart from a new call.

Template `tech_handoff`, a `settings` row like the rest:

```
Wilson — {sv} {status}
{customer_name}
{address_line1}, {city} {zip}
{phone_list}          ← every job_contact with notify=1, role in brackets
{email}
Gate/access: {gate_code_or_dash}
Unit: {brand} {category} · model {model} · serial {serial}
Customer says: {problem}
Our notes: {office_note}
Created {created_date} · {age} days old
```

Fields come straight off the job — `job_contact` (§1.2) for the numbers, so an added on-site number goes with it; `gate` from the DispatchTrack *Directions* field; `problem` from intake; `office_note` is the free-text box. **Nothing is invented and no customer is contacted by this button.**

*Where the numbers come from, which is not obvious:* **ExportInvoice carries no phone and no email at all.** `Phone1/2/3` and `Email` exist only in the DispatchTrack feed (§3.3), so a ticket that has never appeared in a DT snapshot has nothing to put on the phone line — 33 of John's 42 have a number, 9 do not. The live dashboard reads its own `job_contact` rows and will not have this gap, but the shadow instance will, and the button must render `(no number on the ticket — office adds one)` rather than send John a blank line. This is also an argument for seeding `job_contact` from the DT import rather than from the invoice export.

**The recipient, from Cayden's Podium screenshot ⟨9/15 late⟩.** John is already a contact in the **Wilson Appliance Main** inbox: `John Merz · (512) 757-9260`, primary phone marked **Transactional only**, no email on file, tag `MSD`, pipeline stage *New - Phone*. So:

- `tech.mobile` and `tech.podium_contact_id` join the tech record; JHM's channel is **text only** — no email fallback exists for him, and the hand-off must not silently fail over to one.
- *Transactional only* is the right consent class for a work hand-off and the office already texts him from this inbox by hand, which is the same message on the same channel. That lowers the A2P question (item 20) without closing it: an API-originated send can be treated differently from an agent typing, so confirm before `lane.handoff_enabled` goes on in production.
- The hand-off lands in the **same inbox as customer conversations**. It should carry the `SV` on the first line so the office can tell a tech thread from a customer thread at a glance, and the send is tagged internal so it never counts in customer-response-time reporting.

**Inbound is the other half, and this button does not do it.** The screenshot shows the real loop: John texts in `"Worley's invoice is SV122119."`, Noell replies `"sent to Mark and Jack to help locate part numbers"`, then `"Worley- parts have been added"`. That is the parts-research path Cayden described, and **the text thread is where John's notes actually live**. SV00122119 is Worley, David — SO3, JHM, created 7/10, 67 days old, sitting in his lane today, and he has a second ticket (SV00122383, SO5) at the same house.

Note the format: he writes **SV122119** for **SV00122119**. Any future inbound matching normalises an `SV` token by stripping non-digits and zero-padding to the stored width before lookup — a rule worth writing down now even though nothing reads inbound yet.

Reading that thread back into the job is the obvious next step and deliberately **not** in this button, because a half-built inbound path that drops a message is worse than none. What the button does today is replace the copy-and-paste; what the office does with his reply stays manual until inbound is built properly.

### 4.1e What ePASS Routing actually holds — and what we deliberately leave behind ⟨9/17, decided 9/17 pm⟩

Cayden's screenshots of each tech's ePASS Routing screen for 9/17 and 9/18 show a field convention the
export cannot: every tech-day is a **sequence with a comment row in it** — usually literally `routed`,
once `routed?`, once `keep at 5`. Above the row is the route, in driving order. Below it are tickets dated
that day that nobody is driving to — an SO2.1 waiting on a quote, an SI5, a WARPART, an SO8 "Not Posted" —
which the tech has to go back into and update. A day off is a 24-unit comment (`BLL is off`). Three of the
"below" tickets had already moved to the following week between the 9:00 screenshot and the 11:01 export.

**Decision (Cayden, 9/17 pm): the divider and everything under it are not modelled.** *"Those calls are
just clutter, and a by-product of what ePASS lacks. Now that techs are updating tickets in the field in
real time, this will go away — especially since we already bounce notifications back to the techs for
what the office needs answered."* The board shows stops and only stops; a ticket that needs the tech's
attention reaches him through his notifications (§2 rules 36–38, §13b item 38), not through a parking
row on the route. Nothing about the comment rows is written to ePASS and nothing is read from them. An
earlier build of the 9/17 board had rendered them; it was removed the same day.

**Stop order is kept.** The invoice export has no sequence column, so `reference/route_order_0917.json`
holds the order transcribed from the screenshots for 9/17 and 9/18 (73 SVs, all found in the export; the
"below" lists in that file are now documentation only). Where the order exists it wins verbatim; anything
on that tech-day the screenshot did not have is appended nearest-neighbour and chipped "not in ePASS
order"; days with no screenshot are nearest-neighbour from the tech's start point and the column says
so. Re-optimising a day marks it. Agility should read the sequence from the DispatchTrack feed
(`stop_sequence`) or from ePASS's routing table once the ODBC export includes it — open item 32.

**Every scheduled week is on the board.** The 9/17 build had only emitted the export's own week, so the
week scroll (team item 41) showed an empty 9/21. Every dated, routed ticket is now a board row: 218
stops across Sep 16 – Jul 2027, with 24 / 25 / 22 / 9 on Mon–Thu of the week of 9/21.

ePASS's Dispatching Map prices every **unit** at a flat 30 minutes (CEM 9/18: 5 stops, 7 units, "3:30").
Our on-site time is per category and install type (§4.1a); the two numbers are shown side by side in
the board's route summary so the office can see where they disagree.

### 4.1f Route settings live on the tech, with a weekday pattern ⟨9/17⟩

Cayden: *click the tech's name on the dispatch board to configure overall route settings, separate from
the day controls — Diogo picks up his kids Thursday and Friday.* The name on the fill strip now opens
**route settings**: identity and routing mode (auto / office-only / collector), skills, start and end
point, commute allowance, limits, and a **weekly pattern** — per weekday, works or not, starts, ends,
why. `tech_pattern` (§1.2) holds one row per weekday that differs from the default shift; `tech_day`
keeps today-only exceptions (sick, PTO, +60, a block). The timeline reads `shiftFor(tech, day)` —
pattern first, then the default — so Diogo's Thursday capacity is 7 h, not 9, every week, and the
column says "Thursdays Diogo works 8:00–3:00 · picks up the kids". Zone ownership is shown read-only
here; it is edited on the zone table (§4.4a), because changing it is changing the map. The same drawer
carries **retire on a date** (history stays, off the board and the engine from that date, open calls
after it flagged) and **+ tech** on the strip adds one — team items 40 and 42 made concrete.

⟨9/18⟩ **Start and end can differ by day.** Cayden: *change tech start and end locations based on
day — the default should be a broad setting, daily config optional.* The pattern table gained **From**
and **To** columns per weekday; "as usual" means the tech's broad `start_default` / `end_default`, and
a value overrides it for that weekday only. Josh Chappell (JRC) is the case: shop→shop on Monday and
Wednesday, when he picks up parts, home→home on Tuesday and Thursday, which is his default. The engine
reads `startAt(tech, day)` / `endAt(tech, day)`, and `startPt` / `endPt` take the day, so the timeline,
the marginal-drive term in the placement score, the optimiser, the maps and the commute calculation all
use that day's endpoints rather than one pair for the week. Phase 0: `tech_pattern.start_at` /
`end_at` (nullable, `'shop'` | `'home'`), `tech.home_lat` / `home_lng`, and
`placement.route_endpoints(db, tech, date)`, used by `day_load` and `suggest`; tests cover the
weekday difference. `tech_day.start_override` / `end_override` (§1.2) remain the one-day exception
above the pattern. Two more things from the same drawer: the **Save** button existed but sat at the
bottom of a tall drawer, which is why Cayden "just couldn't save the changes" — it is now a sticky footer
(Save / Cancel / saved-state text) and the settings persist across a reload (Agility: `sj_techs` /
`sj_tech_pattern`); and **Retire** is now gated to owner/manager with a type-RETIRE-to-confirm step
(§9). The strip's **+ tech** button never fired — its click was swallowed by the load-left / load-right
wiring — and is fixed.

### 4.2 Capacity ledger
Materialised table `ledger(tech_id, date, half_day, committed_min, owed_min, drive_est_min, available_min)` recomputed on every booking/route change and nightly for the next 14 days.
- `committed_min` = Σ duration of booked stops in that half-day **plus ⟨9/11⟩ `route_block` minutes falling in it**, **excluding stale stops** (a stop whose `route_date` ≤ today at import and which is not completed by the next morning's import is marked `stale`, excluded from the ledger, and listed on Stuck Jobs — the 9/10 feed showed 11–13 "stops" on single techs that were parked tickets, not visits).
- `owed_min` = Σ over jobs where `owner_tech_id=tech` and status ∈ {SO2, SO2.1, SO2.2, SO3, SO4*} of `install_duration × conversion_probability`, spread onto the half-day of the job's expected install date (ETA + 1 business day, or created + 7 if no ETA). `conversion_probability` = 1.0 for SO3/SO4, `approval_rate_90d` (company-wide, default 0.67) for SO2–SO2.2.
- `drive_est_min` = 15 × stops (until a route exists) or actual planned drive.
- ⟨9/15⟩ `committed_min` counts a **visit group** once for drive and once per member for duration (§4.9), and **excludes commute** (§4.1a).
- `available_min` = 240 − buffer − committed − owed − drive_est ⟨9/11⟩ + `tech_day.capacity_adjust_min` (split AM/PM by where the dispatcher clicked; a **forced** stop is allowed to drive `available_min` negative and is shown as overage).

### 4.3 Slot offering (what the picker shows) — and placement in general ⟨9/14⟩
For a job and each date in the next `booking_horizon_days` (default 10 business days), each half-day is **offered** if ∃ eligible tech with `available_min ≥ duration + 25`, and the tech has no `tech_day.available=0`, and (for installs) `ETA ≤ date − 1`, and the shop-touch guard (§4.5) passes. Booking writes `promised_window`, `planned_slot`, `assigned_tech_id`, `route_date`, `route_sequence = end`, and a sync item.

**Placement score** (Phase 0 `placement.suggest`, the same function behind the dispatcher's suggestion, the SO4 pencil and the customer's order of dates). For each eligible (tech, day) — tech open, has the skill, `auto_schedule`, owner-only for installs, day keeps `placement.min_slack_min` after the job — the cost in minutes is

`cost = marginal_drive − same_zone_bonus × min(same_zone_stops, 3) + wait_cost + zone_penalty`

where `marginal_drive` is the cheapest nearest-insertion of the stop into that day's route as ePASS actually shows it (start → stops in `route_sequence` → end; an empty day costs the whole out-and-back) plus any pencils; `same_zone_stops` counts stops already in the job's `zone_code` that day; `wait_cost = defer_min_per_day × min(wait, defer_soft_days) + defer_min_per_day_late × max(wait − defer_soft_days, 0)` in business days after the earliest allowed day — so a day two days out with our truck already in Round Rock beats an empty day tomorrow, but nothing is pushed a week for consolidation; `zone_penalty` is 0 / `zone_secondary_penalty_min` / `zone_other_penalty_min` by the tech's standing in `zone.primary_tech / secondary_techs`. Location for a job with no geocode: average of DispatchTrack-geocoded addresses in its ZIP → zone centroid → zone address average → geo-neutral. Every candidate carries a one-line `why` for the UI (`DLA has 3 stops in LOCAL that day · +9 min drive · 2h 40m left · primary tech`).

**Order of dates for the customer — the offer window** (Cayden 9/14: *"offer the Round Rock date first"*;
**revised 9/17 pm on the test bench**: *"the customer shouldn't be given the option to go with the best fit
for Wilson — they will always select the first available date. The first available date the customer can
choose is the best date for Wilson, unless the best date is more than 3 business days past the first open
capacity date. Always presented as the best available date."*). The rule:

1. **E** = first open capacity: the earliest half-day in the horizon where an eligible tech has room.
2. **B** = our best slot: the lowest-cost candidate (score above) whose day is no more than
   `offer.hold_max_business_days` (3) business days after E. The wait ramp inside the score decides
   whether waiting is worth anything at all; the cap decides how long we are ever allowed to wait.
3. **The customer's calendar starts on B's day.** Windows before it are not offered. B is the top card,
   labelled *Earliest available — and our route is already in your area* when the day already has our
   stops in the zone (body: *Our technician is already in your area that day — picking it means less
   driving for us and a tighter arrival window for you*), or plain *Earliest available* with *{tech_first}
   covers your area that day*. The words "best fit" and "closest to our route" no longer appear anywhere the
   customer can see. Every later half-day in the horizon (`offer.horizon_business_days`, 10) shows as
   open or grey by real capacity, tech chosen primary-first within the day.
4. A pencil (§4.3a) is B by definition: *Earliest available — your installer is already nearby*.
5. Reschedules keep their own rules (§4.6: same window in-week, 48-hour route lock); the start rule
   applies to the new offer from the earliest allowed day.

This supersedes the 9/14 "never hide earlier dates" line. Measured on the test bench over 39 random calls
against the 9/17 board: the calendar started later than E for 13 of them, by 1–2 business days (mean 1.4),
and the 3-day cap never had to bite — the wait ramp keeps B close on its own. 27 of 39 earned the
"route is already in your area" line. `bestFit()` (dispatcher suggestions, the pencil) uses the same
`offerPlan()`, so the three surfaces cannot disagree. Test-bench column 3 prints the decision in words
("first open capacity Mon 21 PM · our best inside the hold Tue 22 PM, 1 business day later → calendar
starts Tue 22 · 1 window hidden") and has a live hold-limit control for trying 0–5 days.

#### 4.3a The SO4 auto-pencil ⟨9/14⟩
Cayden: *"when KKD sets the part ETA … and the call is floating as an SO4, the tool should automatically start sorting the call onto a day roughly 2 business days after we expect the part to land and blocking time on the schedule … so that when the customer gets the 'your part is here' text, the first available date is already the best day for us."*

- Trigger: `po.placed` / `po.eta_changed` write `job.parts_eta`; for status SO4 / SO4B / SO4H the engine runs `placement.pencil`: earliest = `parts_eta + pencil.business_days_after_eta` (2) business days; pick the cheapest (tech, day) by the score above (owner tech only); write `job.penciled_tech_id / penciled_date / pencil_reason / pencil_set_at`, flag `penciled`, audit `placement.penciled`. If nothing fits: flag `pencil_failed`, task `dispatcher_place`.
- A pencil **blocks time**: it is a stop in every later `day_load` (suggestions, offers, the fill strip) but is **dashboard-only** — nothing is sent to ePASS, the ticket stays SO4 there. It is not SO4PRE: SO4PRE is a date the *customer* holds (rule 21) and keeps its own T−2 / T−1 rules (22.1 / 22.2).
- It **moves with the ETA** (re-run on `po.eta_changed`) and is re-scored after every import (`watcher`) since routes change all day; hysteresis `pencil.move_threshold_min` (15) stops it flapping. The dispatcher can drag it like any card; a manual move holds until the part lands.
- On `receiving.all_parts_in` (→ SO5) the pencil is the first date offered (label above). Booking (rule 25) or cancel clears it. `timer.unpicked` (rule 26) is unchanged.
- Board: dashed teal card `SO4 · Parts on order · penciled · ETA m/d`, hover shows `pencil_reason`. Office → Receiving shows `✎ penciled Wed 9/16 · Diogo — first date the customer will see`. Tracker (SO4): *"We've already lined up a spot with Diogo for a couple of days after it lands — you'll see it first when we text you."*

### 4.9 The visit group — one household, one arrival, one charge ⟨9/15⟩
Team item 21. In the 9/15 export **107 of 443 customer tickets (24%) sit at an address that has another open ticket** — 47 addresses, 38 of them with two tickets, nine with three or four. Seven of those addresses are *already* booked on different days: Diana Preston has two diagnostics with John a week apart, David Worley an SO3 on 9/16 and an SO5 on 9/23, Blake Tartt two installs on 9/23 and a third a month later. Every one of those is a second trip we are paying for and a second appointment the customer has to be home for.

**The object.** A `visit_group` is one arrival at one address. Members are jobs. It is the unit for three things that are currently per-ticket: scheduling, capacity and billing.

**Forming one.** On import and on request creation, if two or more open jobs share an `address_id` and can be done by one tech, the office gets a **Group these** suggestion on the board and in the office queue — never an automatic merge. Grouping is constrained by skill: Whitney Langdon has an HVAC diagnostic and two appliance diagnostics at one house, so that address produces two groups, shown as siblings so the dispatcher can still put them on the same day with two trucks if the customer prefers. The shop's own address is excluded.

**Scheduling.** Booking any member books every **ready** member onto the same tech, date and window (`book_diag` / `book_install` apply to the group). A member that is not ready — a part still on order — does not block the others, but it may not be given a *different* date: it stays in the group and takes the group's next visit. This is the rule the team asked for, and it is enforced in the engine, not by the dispatcher remembering.

**Parts.** `visit_group.parts_wait_until` = the latest `parts_eta` across members. The pencil (§4.3a) for a group is the best-fit day after **that** date, not the earliest member's. When one part is far out, the office **splits** the member out with a reason (`split_reason`), which is the deliberate escape hatch; the split is audited and the customer is told the second visit is coming.

**Capacity.** A group is one drive and Σ member durations, plus `group.setup_min` (tunable, default 10) per extra member — one arrival, one setup, several units. This is a real capacity gain: it is why grouping is worth doing even when the customer does not care.

**Billing (the lump sum).** When the last member reaches SO8 on the visit date, the group raises **one** payment for the sum of the approved totals, one receipt listing each unit and what was done. ePASS still needs its per-ticket amounts, so the sync packet carries the allocation — `post_payment` for a group renders as one payment with a per-SV split, and the packet says which SV takes which share. Stripe sees one PaymentIntent; `payment.amount_mismatch` is evaluated against the **group** total. A member that is not finished on the day leaves the group's billing open and is charged with the next visit.

**Delivered dollars** are attributed per member as today (§5.6), so a grouped visit does not distort a tech's number; the group only changes when the customer is charged.

### 4.4 Booking modes and trip buckets
`zone.booking_mode`:

- `open` → §4.3 as-is.
- `designated_days` → the job enters the group's bucket (`trip_id NULL`, `status REQ/SO5`, `zone_group` known). Picker shows only dates of `trip` rows in state `confirmed` for that group with `capacity_minutes ≥ duration`. If none: bucket message. **Proposal job** (every 30 min): for each group with bucket items, propose a trip when `Σ duration ≥ trip_min_minutes` (default 240) **or** oldest item age > 5 business days **or** any SO5 item age > 3 days. Choose date = the trip tech's earliest day in the next 10 with `available_min ≥ Σ duration + drive` (drive = 2 × drive(shop→group centroid) + 15 × stops), skipping days with confirmed trips for another group. Create `trip(state=proposed)` and notify Demitrius. Automatic proposals are capped at `trip.max_auto_per_week` (2) per group; beyond that a manager opens the trip. On **confirm**: attach bucket items (`trip_id`), create appointments with windows assigned by sequence, send `notify:trip_date_offered` with one-tap confirm; items that decline stay in bucket. Trip stops are `route_locked` as a block; the optimiser may sequence within the block and add local stops before/after in travel direction.
- `office_only` → no picker; Client Care task; staff can book manually with any tech (`staff.booked`).

### 4.4a Backtesting the placement priors against 7,777 real bookings ⟨9/16⟩

The shadow test (§14) grades suggestions live, a few dozen a week. The catalogue lets the same thing run
backwards over two years of real dispatcher decisions before a customer sees a date. `reference/backtest.py`.

**What it grades, and what it cannot.** History carries a ZIP and a scheduled date, not a street-level
lat/lng and not the capacity state of the week a booking was made in. So this grades the *priors* — the
zone table, the primary/secondary lists, eligibility — which is the part that was hand-written and never
verified. It does **not** grade the day choice or the drive-time cost function; those need the full
capacity simulation and are left to the live shadow test rather than faked at zip-centroid resolution.

Population: 7,777 routed **field** visits (`ticket_kind='field'`, real `sched_date`) by the **current
eleven** techs over 24 months. Counter sales and cancellations are excluded — see §1.4g.

**1. Would the engine have offered the tech who actually went?**

| | visits | share |
|---|---|---|
| the zone's **primary** went | 3,709 | 47.8% |
| a listed **secondary** went | 3,047 | 39.3% |
| **someone not listed for that zone** | 998 | **12.9%** |

So 87% of the time the right tech was at least on the list — but **one booking in eight went to a tech
the engine would never have suggested**, because the zone table does not know they work there. The
biggest gaps are JRC in AUS S (96), MAP in AUS W (81) and VWJ in DS (78).

**2. Which zones actually have a primary.** Of the 22 zones with enough volume to measure, 13 have a
real owner (top tech ≥ 60% of visits) and **9 do not**. The table asserts a primary for all of them.

| zone | visits | reality | the table says |
|---|---|---|---|
| **DS** | 1,214 | busiest is KJB at **25.4%** | DLA |
| **LOCAL** | 813 | busiest is KJB at **25.1%** | DLA |
| AUS W | 684 | JRC 51.6% | AJH |
| BCAVE | 445 | AJH 50.1% | TDP |
| LOST | 353 | **AJH 63% — owned** | TDP ← wrong primary |
| AUS S | 298 | JRC 32.2% | AJH |

**The two busiest zones in the business have no primary at all**, and the table names DLA for both.
Where it is right it is very right — AUS C is 92.3% JRC, SPICE 91.3% TDP, WIMB 81.5% KJB.

**What changes.** `zone.primary_tech` stops being a single hand-set code and becomes measured:

- `zone.ownership` ∈ `owned` | `shared` | `thin`. **Owned** keeps a primary and the primary bonus in
  the §4.3 score. **Shared** carries no primary — the engine scores on drive, capacity and skill alone,
  which is what the dispatchers are already doing. **Thin** (under 40 visits in 24 months) keeps the
  hand-set value and is flagged `needs_review`.
- `zone.secondary_techs` becomes every tech with **≥ 8%** of the zone's visits, so the engine stops
  excluding people who demonstrably work there.
- Recomputed monthly from `service_history`, never silently: it writes a diff for the dispatcher to
  approve, because a zone changing owner is a management decision, not a statistic.

`reference/zone_table_measured.csv` carries the measured columns beside the hand-set ones for review.
**Open item 28:** the one outright correction (LOST → AJH) and the nine shared zones need Cayden's or
Demitrius's sign-off before they go into the engine.

**3. How wide is a day.** Of 1,414 tech-days with 3+ stops, 13.9% stay in one zone, 39.1% touch two,
35.4% three, and **11.6% span four or more**. The worst on record is JRC on 2024-11-05: 11 stops across
six Austin zones. That is the headroom the optimiser is aiming at, and it is a better target than the
fill percentage.

### 4.4b The zone map editor ⟨9/18⟩

Cayden: *capability to move tech zones around … a zip code map with clickable or drawable zones?*
Built on the board as **Zones**: a paint-by-ZIP map. The ZIP is the atom because a customer gives us a
ZIP and the engine reads `ZONE[zip]` → primary tech, secondary techs, booking mode (`open` /
`office_only` / `designated_days`), trip day and tech, and — new — the zone-fee band (§5.1a). Pick a
tech in the palette and click a ZIP to make him primary; the old primary is kept as a secondary so no
ZIP loses coverage. Shift-click toggles a secondary. A side panel edits mode, trip and fee band for the
selected ZIP. Two framings: the whole service area within 60 miles of the shop, and the Austin metro.

**Draft, publish, log.** Dispatchers draft (`zones.draft`), with Undo and Save draft; **Publish** needs
`zones.publish` (owner or manager, §9), because it changes where every new call goes. On publish every
tech's zone list is recomputed and every unscheduled call is re-suggested; every change is logged per
ZIP as from → to (`audit_log`, action `zones.publish`). The prototype keeps the published map and the
drafts in the browser (localStorage) so a reload keeps them; Agility writes `sj_zones` (doc 13 §4d).

**Cells.** The prototype has ZIP centroids, not outlines, so cells are nearest-centroid. Agility should
draw the same interaction on Google Maps with Census TIGER ZCTA5 outlines clipped to the ~150 ZIPs we
serve, as a Data layer with click-to-assign. One limitation found on the way: several Austin ZIPs share
an identical centroid in our table (78717, 78727, 78753, 78756, 78759, 78747 among them), so they have
no cell of their own and are picked from a list; the ZCTA outlines fix this.

**Alternatives weighed.** Free-drawn polygons must be converted back to a ZIP list anyway — more work
for the same result. Street-level splits inside a big ZIP such as 78620 are later, and need geocoded
addresses. Open items 36, 37 and 40 (§12) are the questions this raised.

**Adding and removing ZIPs ⟨9/18 pm⟩.** Cayden: *do we have the option to just add and remove zips?*
Yes, and it is the plainest form of the editor. An **Add ZIPs** box takes any pasted text and extracts
the five-digit Texas ZIPs in it (ZIP+4 is trimmed, out-of-state numbers ignored); each new ZIP becomes a
row with the selected tech as primary, booking `open`, dated `added`. A ZIP whose centroid we know is
drawn at once; one we do not know lands in an **unplaced** list until someone pastes a `lat, lng` into
its panel (the row then carries `ll`, and the published map re-seeds the centroid table on load).
Beside the box, **"served before, not on the map"** chips list the ZIPs the ODBC history shows Wilson has
worked since 2025 that the zone table never had — 78741 (29 tickets since 2025), 78652, 78726, 78209,
78611 … 26 in all — with counts, so the map can be completed from the company's own record rather than
from memory. PO Box ZIPs (78763, 78767, 78716, 78766) are explained, not drawn: they have no area, and
Agility places those calls by the street-address geocode. The selected ZIP's panel has **Remove from the
service area**; the diff records it as *removed (was DLA + AJH) — new calls here get "we'll call you"*
(an unmapped ZIP resolves to `office_only`, §4.4), open calls keep their tech, and Undo restores it.
The diff and the publish toast count added and removed ZIPs separately.

**randymajors.org as the ZIP-list source.** Cayden has used randymajors.org to build ZIP maps of the
service area. The useful part for this function is its selection tooling: draw a radius, a shape or drop
points on its ZIP-boundary layer and it highlights the ZIPs and lists them in a **"Results from Map"**
box — that list pastes straight into our Add box. Its "Custom Area Maps" (from a pasted ZIP list) are a
good visual check of a draft before publishing. What it is not: an API or an embeddable layer — its
licence forbids embedding (screenshots are fine), and the free tier caps how many ZIPs a selection may
hold. It draws Census ZCTA boundaries, the same source Agility uses, so what Cayden selects there is what
our outlines will show. The workflow is therefore: select there → copy the list → paste here → paint →
publish. Four zone-table ZIPs had no centroid at all (78133, 78628, 78642, 78645) and so priced as ZN1
whatever their distance; the prototype now carries approximate centroids for them, flagged ≈, until
Agility geocodes.

### 4.5 Shop touch (parts on the truck)
For a tech-day: `needs_shop_touch = ∃ stop with status ∈ {SO6, SO4PRE} AND tech start ≠ shop AND NOT tech_day.parts_loaded_prev_evening`. When true, insert a virtual stop `appointment(kind=shop_touch, 10 min)` at the shop before the first install in sequence. Wave rule for home-start techs: the optimiser may place SO1 stops before the shop touch only if they lie within a corridor of ≤ 10 min detour from home→shop; installs never precede it. Picker guard: a half-day is not offered for an install if the resulting route cannot include the shop touch before the install within the window. Setting per tech `always_start_at_shop=1` overrides everything (start = shop).

### 4.6 Ownership and reschedules
- `owner_tech_id` set on first `findings_submitted`; every later appointment on the job is offered/routed to the owner only. Board drag to another tech → allowed with a warning; requires `reason_code` (e.g. `owner_out`), logged. If owner has `tech_day.available=0` for > 5 business days, Stuck Jobs flags the job for manual reassignment.
- Customer reschedule/cancel ≥ 48 h before window start: free among offered slots.
- < 48 h: offered slots filtered to `tech already has ≥1 stop in the same zone_group that day` (SO1: any eligible tech, so tech may change; SO6/SO4PRE: owner only). None → portal shows Message Client Care. Cancel < 48 h → Client Care task, not self-service.
- Same-week reschedule (any distance) keeps the AM/PM window unless the customer explicitly changes it in the ≥48 h flow (allowed).

### 4.6a A tech calls in sick ⟨9/17⟩

Closing a day with stops on it opens **Reschedule**: one row per customer, the engine's suggested slot
for each (next open capacity, primary tech first, same rules as any placement, with the reason in
words), and two separate clicks — **Move there**, which puts the call on the board and queues one sync
packet; and **Text customer…**, enabled only after the move, which shows the exact message and sends
on a second click. Nothing goes out on its own (doc 12 §5). The message names the original day, the
new window and the new tech and asks for a YES, which lands in the Podium inbox like any reply. Every
move and every text is logged with who clicked. Undo restores the original slot. Closing for any reason
with stops on the day offers the same drawer from the toast; "sick" opens it at once.

### 4.7 Route optimiser
Nightly at 18:00 and on demand per tech-day. Inputs: stops with windows, durations, tech start/end points, shop touch, locks, trip blocks. Method: per tech-day, greedy nearest-neighbour within window order (AM stops, then PM) as in the prototype, then 2-opt improvement; respect locks (fixed sequence index) and trip blocks. Never changes `promised_window`; never moves stops between techs or days without a human drag (Phase 5 may add cross-day suggestions as *proposals*). Output: `route_sequence`, `planned_slot`, per-stop ETA, per-day totals. **Profitability guard** (basis corrected by the Sep 10 replay, `08_Replay_Sep2026.md`): flag a day if **inter-stop** drive per stop (excluding the first and last legs) > 35, or any single stop's marginal drive > 60; show the first/last legs separately as *commute*; confirmed trips are exempt from the flag but display the number. Surface on board and in the drop toast.

### 4.8 Board API needs
Two columns × (tech, date); week fill strip (all techs × 5 days from ledger); unscheduled bucket (status ∈ {REQ, SO5} with no route_date, plus SO4PRE holds); drag → `POST /route/move` (job, tech, date, index) returns validation chips (owner, skill, zone, ETA, trip, profitability, ⟨9/11⟩ over-capacity with `force` option) and new timeline; pin; re-optimise; "parts loaded last night" toggle → `tech_day`.

⟨9/11⟩ Added from the team's feedback:
- **Tech route overview**: the tech's name in any column header, fill-strip row or map legend is a link to `GET /board/tech-day?tech=&date=` — one page for one tech-day: every stop in sequence with ETA, window, status, balance and bin, the drive legs between them (commute legs separate), blocks, the map for that tech only, delivered dollars so far and projected, and the alerts (owner, stale, forced, profitability). Read-only view of the same data the field tool shows the tech.
- **Map**: legend chips per tech with a toggle (show/hide that tech's stops and route line); toggles persist per user (`settings` user scope). Hide-all-but-one is a double-click on a chip.
- **Date picking**: a month calendar (not a weekday dropdown) for each column and for the fill strip, cells tinted by fill % (`GET /board/fill?from=&to=` accepts up to 42 days); closed days hatched, trips marked, today outlined. Click a day → that column loads it.
- **Blocks**: `route_block` cards (grey, labelled, draggable within the day) via `POST /blocks`, `PUT/DELETE /blocks/{id}`; the field tool shows them in sequence with the label.
- **Money on the board**: each column footer shows *Delivered $X · projected $Y* for that tech-day (`GET /revenue/tech?tech=&date=`); a **Productivity** drawer behind one click at the bottom of the board shows the department for the day/week/month — per tech: calls, delivered $, labor $, parts profit, warranty share, calls per day (`GET /revenue/day?date=`, `GET /kpi?...`).
- **Capacity controls**: fill-strip cell popover → `POST /tech-days/{tech}/{date}` `{available, reason, capacity_adjust_min, note}` (range: `POST /tech-days/range`), `POST /route/move` with `{force:true}`.

---

### 4.8b Drag a day onto a board ⟨9/19 late⟩

Cayden: *"instead of the click left or right buttons, and then click the tech and date matrix … can we go to a click and
drag system? like i click on Josh's 9/18 capacity bar and just drag it into the expanded area i want to see it. i drag to
right or left depending on what i want."*

Every capacity cell on the strip is `draggable`; its payload is `cell:<tech>|<day>`. Either board column is a drop
target for that payload — head, stop list, anywhere on the column — and while a cell is in flight the column under the
pointer lights up with *Drop to open Josh Fri Sep 18 here*. Drop loads `{tech, day}` into that column and toasts which
board it opened on. A plain click on a cell still loads it on the **left** (the one-handed case); right-click and the
`⋯` corner still open the day controls. The *load into Left / Right* toggle is gone. Job-card drags share the same
document listeners, so the cell payload is checked first and the card handlers ignore it; a card dropped on a column
still books exactly as before (tested). Touch devices are out of scope for the board.

### 4.8a The map ⟨9/17⟩

The office likes ePASS's Dispatching Map — Google roads, one colour per route, pins labelled
"TDP #3/5", a Route / Miles / Drive / Job / Total table — and asked for the same in the board's
bottom-right, expandable to full screen. The panel now has **Schematic | Roads** and **⛶ full screen**,
and a route summary table for the day (stops, units, drive, on-site, total per tech, with ePASS's flat
30-min-per-unit noted beside our per-category time). Roads mode draws the same polylines and labelled
markers on the Google Maps JavaScript API when a key is present. **The key lives in Render's
environment (doc 12 §5), never in the page**; Agility hands the browser a short-lived, referrer-locked
map session. The published prototype allows no outside hosts, so Roads there shows the frame and says
so; the file on C:\Dev accepts a browser-restricted key locally to try it. Miles need the Directions
or Routes API; drive minutes stay ours until then.

## 5. Pricing, quotes and tax

### 5.1 Catalog (replaces the 13,646-row rate book — see `03_Rate_Book_Analysis.md`)
**catalog_task**: `task_id`, `family_code` (RE, DW, WA, DR, CE, CG, …), `name`, `customer_description`, `base_hours DECIMAL(4,2)`, `department` ENUM('appliance','hvac','in_shop'), `tags JSON`, `labor_taxable_default BIT`, `active BIT`, `epass_code_stem` (e.g. `CE400`). Seed from `reference/task_catalog_draft.csv` after de-dup review.
**catalog_modifier**: difficult access 0.50 h, stacked/built-in access 0.35 h, additional tech 0.50 h, additional component 0.50 h.
**rate**: `department`, `hourly_rate` (appliance 130.00, hvac 150.00), `effective_from`.
**brand_factor**: `brand`, `family_code`, `factor DECIMAL(4,2) DEFAULT 1.00` — empty at launch.
**part_catalog**: `part_number PK`, `description`, `family_code`, `last_price`, `last_verified_at`, `last_verified_by`, `supplier`, `typical_availability`. Grows from every verify.
⟨9/11⟩ Two generic **quick picks** sit at the top of every family's labor list: `LAB-HALF` *Half-day labor* 4.0 h and `LAB-FULL` *Full-day labor* 8.0 h (sealed-system work defaults to full day); picking one sets `findings.labor_block`, prices at the department rate, and blocks 240 / 480 min of the owner's capacity for the install.
Labor line price = `base_hours × rate × brand_factor`, rounded to cents. ePASS import sheet generator: for each active task × each brand in the ePASS brand list, emit `code-BRAND, description, price, …` exactly as the current file's columns — so ePASS keeps importing the same shape.

### 5.1a Two labor lines: the zone fee and the component replacement ⟨9/18⟩

Cayden: *when a tech selects a time amount in the field tool, price in a zone fee as a second labor
line. Each service job should generally have 2 labor lines: a zone fee and a component replacement.
The zone fee codes start with ZN in the labor table. Auto-assign the zone fee based on the call
distance from the shop.*

**What the labor table says.** The 116,829 ePASS labor lines (§1.6) carry the codes and their 2026
modal rates:

| code | ePASS description | 2026 rate | 2026 lines |
|---|---|---|---|
| `ZN1` | Service Zone 1 | $120 | 366 |
| `ZN2` | Service Zone 2 | $130 | 414 |
| `ZN3` | Service Zone 3 | $140 | 109 |
| `ZN4` | Service Zone 4 | $150 | 20 |
| `ZNADD` | Additional Appliance | $85 | 228 |
| `ZN-CONDO` | condo surcharge | $20–120 | — |
| `DZ1` / `DZ2` | Diagnostic Zone 1 / 2 | $157 | 799 (DZ1) |
| `DZ3` | Diagnostic Zone 3 | $179 | — |
| `DZ4` | Diagnostic Zone 4 | $209 | — |

Diagnostics are zoned the same way, and $157 × 1.0825 = $169.95 — the diagnostic price the customer
sees. The two numbers were never in conflict. Brand-suffixed variants (`ZN1-KA`, `ZN2-SZ`, `DZ1-WP` …)
exist for warranty and brand billing; Agility picks the brand variant when the labor table has one for
the job's brand, else the plain code.

**The band from distance.** Fitting straight-line miles from the shop (30.2054, −98.0605) to how 3,807
tickets were actually zoned in 2024–26 gives:

| band | straight-line miles from the shop | fit |
|---|---|---|
| `ZN1` | ≤ 7 | 81% agreement over the four bands |
| `ZN2` | 7–26 | |
| `ZN3` | 26–47 | |
| `ZN4` | 47+ | |

The clear exception is downtown **78701**, priced ZN3 at 19 miles (parking, traffic) — hence the
per-ZIP `fee_band` override on the zone table (§1.2), set on the zone map (§4.4b), with 78701 seeded.
In 2026, 1,173 of the 3,317 tickets with labor carry a ZN line and 1,052 have exactly two labor lines,
which is the shape Cayden described.

**Built.** The field tool adds the ZN line automatically the moment a labor task is picked (or a time
amount on the office-quote path), shown as *ZN1 · 6.6 mi from the shop · auto*; the tech cannot remove
it, the office can override the band. `ZNADD` is added per extra unit. The diagnostic shows *DZ1 $157 +
tax = $169.95*. Office Parts verify shows the same auto line with a ZN1–ZN4 override. Board projected
dollars now price installs as task labor + ZN fee and diagnostics as the DZ band. Phase 0: `labor.py`
(`zone_band`, `zone_fee_lines`, `diag_fee_line`, `quote_labor_lines` honouring `zone.fee_band`);
settings `labor.zone_bands_miles` [7, 26, 47], `labor.zone_fees`, `labor.diag_fees`,
`labor.hourly_rate` 130 (§11). Delivered dollars (§5.6) already counted zone fees as labor; nothing
changes there.

**Open for Cayden** (items 34 and 35): straight-line versus drive miles — Agility has geocodes and can
use drive distance, but the bands would need refitting — and whether the 7/26/47 bands or ePASS's own
zone assignment wins where they disagree, which is about one fitted ticket in five.

### 5.1b Warranty: no zone fee, no tax, and labor only where the brand pays for it ⟨9/19⟩

> Cayden: *"for warranty calls that go straight to so3 it's automatically adding a zone fee here. most warranty we do is
> paid with a flat rate back from the mfg … True / Scotsman / Zephyr / Bluestar all pay cod … warranty calls will all be
> tax exempt."* The COD list was confirmed as exactly those four on 9/19.

Three rules, applied wherever a quote is built — the field tool, Parts Verify, and the office quote builder alike, because
they all go through `labor.quote_labor_lines`:

1. **No zone fee.** A warranty ticket carries no `ZN` line at all. The zone fee prices a trip to a customer in a band of
   miles; the manufacturer is not that customer, and the trip is inside the flat rate it pays back. `zone_fee_lines` is
   simply not called when `warranty_kind(db, job)` is truthy.
2. **Tax exempt throughout** — parts, labor and S&H. `labor.taxable(db, job, kind)` returns False for every kind on a
   warranty job. This is not the built-in/freestanding rule of §5.2; it sits above it, because the claim is not a sale.
3. **Labor prices only on a COD brand.** `warranty.cod_brands` (seeded `["true","scotsman","zephyr","bluestar"]`) is
   matched against every unit's brand and model on the ticket, then against the payer string as a fallback for a ticket
   that has no unit row yet. A match returns `'cod'` and labor prices at `labor.hourly_rate` exactly as on any COD job.
   Anything else returns `'flat'`, and each task comes back as a `WTY` line at **0.00** carrying `needs_rate_card: true`.

The brand is read from the **unit**, not the payer: a Sub-Zero billed through a home-warranty company is still a Sub-Zero,
and it is the manufacturer's rate card that decides. `warranty_kind` scans every unit on the ticket rather than the first,
because a multi-unit job can carry the warranty brand second.

#### The rate card ⟨9/19 pm — open item 47 closed⟩

Cayden sent it. `reference/warranty_rates.csv` is the source of truth; `warranty.rates` in settings is what the code
reads, and `labor.WTY_RATES` is the seeded copy so a test can run without a database. **Thirty brands**, fourteen of
them with a higher sealed-system rate.

Three things about its shape matter more than the numbers:

1. **It is a flat rate per claim, not per hour.** However many tasks the tech records, the claim carries **one** priced
   line. `quote_labor_lines` therefore short-circuits for a flat-rate brand: the task names go into that line's
   description and nothing is multiplied by anything. Pricing per task would have inflated every multi-task claim.
2. **Each brand carries the ePASS labor code the warranty admin already keys** — `WTYSZ-SZ`, `WTYGE-GE`,
   `WTYSEALEDSYS-KA`, `WTY1-SPEED` and so on — taken from the codes the history actually uses, so the SO3 packet is
   keyable rather than a number somebody has to look up.
3. **The brand comes off the unit, not the payer.** A Sub-Zero billed through a home-warranty company is a Sub-Zero,
   and the manufacturer's card is what decides. `warranty_rate` scans every unit on the ticket.

Sealed work takes the sealed rate where the brand has one: Sub-Zero $174 → **$420**, Monogram $151.25 → **$350**,
Fisher & Paykel $165 → **$375**, the Whirlpool family $113.68 → **$237.74**, Viking/Marvel/U-Line $150 → **$300**,
GE/Café/Profile/Haier $125 → **$225**. A brand with no sealed rate returns the standard one flagged `no_sealed_rate`
so the screen can say so rather than quietly bill a compressor job at the door rate.

> **What the history says about the card.** Every rate was checked against what that ePASS code actually billed in
> 2025–26. Most agree closely — Sub-Zero $174 against $171.80 actual, KitchenAid $113.68 against $109.93, Liebherr and
> Amana exact, LG $110 against $112.23. **Two do not**, and they are open item 52: **La Cornue** (card $150, 18 tickets
> averaging **$702.50**) and **AGA** (card $150, 5 tickets averaging **$314**). Both are low-volume Middleby luxury
> lines, so the history may be carrying something the rate does not, but at those gaps the tool should not quietly bill
> $150. **No sealed rate was given for DCS, Hotpoint or Amana**; those are left blank and flagged rather than inferred
> from the family, since Cayden named four brands for the $237.74 sealed rate and Amana was not among them.

Speed Queen is a two-rate brand: **$150 is type A (minor)** and is the default; type B (major) is `WTY2-SPEED`, which
the history shows at $223, and the warranty admin claims it in ePASS. The tool quotes type A and says so.

### 5.1c The installer's cosmetic damage report ⟨9/19⟩

> Cayden, with the form's screenshots: *"see screenshots of field/install damage report that funnels directly into our
> existing service request queue … we will need to grab the info from the service request queue, move it into unassigned
> and have it send to Mark Perks for review/part number add … holds time at so4, when part arrives at so5, customer is
> prompted to schedule."*

This is the only workflow in the system that **starts somewhere other than the request form** and still has to end in the
same place. An installer on a delivery truck finds a dent on a unit he has just delivered. Two things follow from that,
and both are why it cannot reuse the ordinary path:

- **There is no diagnostic.** The damage is already photographed by someone standing in front of it. Sending a technician
  in a van to look at it is precisely the waste this project exists to remove, so the job is created at **SO2** — findings
  already in hand — and skips SO1 entirely.
- **The only missing thing is a part number**, and exactly one person supplies it. So the job is born **unassigned** and
  owned by the service manager (`MAP`, Mark Perks) until he has chosen the part.

**The form is not ours to build.** ⟨9/19 late⟩ Cayden: *"you built the damage report into this tool, which isn't needed. it
already exists, we just need to read the incoming data in the service request queue that already exists as well."* The
installers' four-step form lives in Agility and keeps writing into Agility's **Service Request Queue** exactly as it does
today. What we build is the **read**: the queue row — customer, address, ERP S# (the sales invoice), unit with model and
serial, `COSMETIC DAMAGE — field report by <installer>`, the `Issue: <what> — <side> — <spot>` line, the photos — arrives
in the dashboard as a `damage_report` row (`state='new'`, `job_id` null) through the same import path as every other
request, and the board's *Service request queue · incoming* panel shows it in the queue's own shape with the one thing
the queue never had: a button that turns it into a service order. The 9/19 prototype's own copy of the form has been
removed; nothing an installer touches changes.

| field on the queue row | lands in `damage_report` as |
|---|---|
| customer, address, ZIP | `customer_name`, `address`, `zip` (resolved to `customer`/`address` rows on *Create the service order*, never before) |
| ERP S# / R# | `invoice_code` — the join back to the sales export for every serialised unit on that delivery |
| unit model / serial | `model`, `serial` (+ `brand` from the sales line) |
| `COSMETIC DAMAGE — field report by X` | `reported_by`, `reported_at` |
| `Issue: Dent or ding — Right — Bottom Right` | parsed into `issue`, `side`, `spot`; the original line is kept as `note` when it does not parse |
| photos | `photo_count`; the files stay where the queue keeps them, referenced not copied |

**The path afterwards**, all of it existing machinery:

| step | who | what happens |
|---|---|---|
| report read off the queue | import | `damage_report` row, `state='new'`. It is not a ticket yet: whether it becomes a service order is the office's call. |
| *Create the service order* | office | `damage.to_job` — customer/address resolved or created, job at **SO2**, `source='damage_report'`, `source_ref='damage:{id}'`, `flags='damage'`, no tech, no date, `owner_tech_id = MAP`. A unit row carries the model and serial off the invoice. A tracker token is issued, because the customer has a repair coming that they never asked for. `task:manager_part_number` goes on the outbox. |
| *part number + what it is + ETA + who fits it* | Mark | `damage.order_part` refuses without both the number and the description — that is the whole of the review. It fires `parts.verified` with `quote_kind='damage'` (see below) and then `po.placed`, landing at **SO4**. |
| SO4 hold | engine | the existing SO4 pencil (§4.3a) holds a fitting slot on the owning tech's route two business days after the ETA. Dashboard-only, never sent to ePASS. |
| part checks in | Kezia, in ePASS | `receiving.all_parts_in` → **SO5**, and `notify:part_arrived_pick_time`. |
| picks a window | customer | the ordinary SO5 picker on their own tracker, constrained to the owning tech. → **SO6**. |

**`quote_kind='damage'`** is a new branch of `_verified_target` (§2 rule 15) returning **SO3** rather than SO2.1. A
cosmetic-damage repair has no estimate stage at all: Wilson damaged the unit, Wilson pays for it, and the person who
approves the part is the service manager, not the customer. Routing it through SO2.1 → SO2.2 would send a customer an
estimate for a repair they are not being charged for.

**Table `damage_report`** — see §1.2. It exists separately from `job` because it exists *before* the job does, and some
reports will never become one.

### 5.3c Parts ETA: where it ships from, not whether it is "in stock" ⟨9/19 pm⟩

> Cayden: *"bucket, change verbiage from in stock to in state. we get those in 1-2 days via standard ground ship, out of
> state, 2-3 days, cross country (new york for example 5-7 days)."*

`parts.eta_buckets` — `in_state` (2 business days), `out_of_state` (3), `cross_country` (7), `backorder` (14). The old
label was wrong in a way that mattered: nothing Kezia touches is ever "in stock" here, because we do not stock it — what
she knows is which warehouse it ships from, and that is what decides the date. The estimate shows the range; the SO4
pencil counts business days from the date.

`parts.backorder_days` is **10**: an ETA further out than that flips SO4 to SO4B and sends the delay notice.

### 5.11 In-shop (SI) tickets ⟨9/19 pm⟩

> Cayden: *"SI jobs live in their own section of unassigned and can be used to fill in days that are lighter. lets make
> that manual to start. these should ignore customer notification rules … si jobs historically get moved a lot if the
> tech falls behind … build a notification that taddles on the tech for not getting in shops done and puts it in marks
> notification if it has been scheduled more than twice and not diagnosed, or repaired … sometimes our techs bring
> appliances from a house while they are on the so1 call for further eval in shop … the tool needs to remember the
> appliance needs to be delivered on the so6 trip."*

Everything unusual about an in-shop ticket follows from one fact: **the unit is here and the customer is not waiting at
home for anybody.** No window, no drive time, no urgency any customer can feel — which is precisely why these float for
days, and why the only thing that will ever stop one floating is a person being told. So:

| rule | why |
|---|---|
| its own lane, not a filter on Unscheduled | otherwise it is permanently the small stuff at the bottom of a list sorted by urgency it does not have |
| bench days **counted**, not just the current one | the number that matters is how many times it has been promised a day and not been touched |
| the service manager told on the **third** (`shop.NAG_AFTER = 2`) | twice is bad luck; three is a pattern, and nobody else is going to notice |
| placement **manual** | "a light day" is a judgement nobody has written down yet, so the engine does not guess at it |
| `notify:part_arrived_pick_time`, `notify:parts_ordered` and `notify:parts_delay` **muted** (`shop.muted`) | telling somebody whose machine is on our bench that "your part is in" is noise. The tracker still shows everything — a page they choose to open is not an interruption |

`shop_json` on `job` carries what a routed ticket has no need of: when it came in, who brought it, whether we owe a
delivery, every bench day it has been given, and the tech's note.

**Two ways in, two ways out.** A tech taking it off a customer's floor during an SO1 (`shop.take_in`, the field tool's
*Taking it to the shop with me* outcome) sets `deliver=true`, and the return trip has to load it — the board card and
the tech's job screen both say so. A unit the customer drops at the counter is `deliver=false` and ends with them
collecting it. `shop.repaired` emits `notify:si_ready_pick_return` or `notify:si_ready_collect` accordingly, and the
tracker tells two different stories: one asks for a window, the other says come any time.

Statuses used: **SI1** on the bench, **SI5** repaired, **SI6** the return booked. `SI_STAGES` replaces the parts-shaped
stage list on the customer's page.

### 5.3d The quote after it closes ⟨9/19 pm⟩

Three answers, and the third is the interesting one.

**Every quote is reviewed** (`quote.review_all = 1`). There is no dollar threshold below which one sends itself; the
question in open item 2 is answered, and the "Needs review subset" from the original design is now the whole list.

**Three days of silence**, not fourteen (`quote.silence_days = 3`) — a quote unanswered for three days is a phone call,
not a waiting game.

**A closed quote keeps its lines** for `quote.keep_closed_days` (90) and can be reopened. Cayden: *"we need to save a
historical quote so that we can reopen it if the customer calls back after a week and wants to move forward. if a call
gets reopened, there needs to be a button the office admin hits to credit the diag to the repair."* So a quote closed as
declined, shopping, no-response or diagnostic-only is `reopenable`; reopening pushes the old closure onto `history`
rather than overwriting it, returns the ticket to SO2.1, and offers — ticked by default, but a choice — a `DIAGCR` line
at **−$169.95**. The customer who went quiet and came back does not get charged twice for the same visit, and Noell does
not rebuild the quote from scratch.

The same thinking settles the discontinued-part fee. Cayden: *"lets change this to its a default that we charge, but the
customer is notified if they replace the appliance with us we credit it in full to the sale."* The three-way
charge/waive/credit choice collapses to two: **charge** (the default) now *means* charged-and-credited-against-a-
replacement, and the customer's own notice says so every time. Waive stays, one click, logged.

### 5.2 Tax
`TAX_RATE` setting (8.25%). Parts and S&H always taxable. Diagnostic and zone fees always taxable. **Labor taxable iff `unit.install_type = 'freestanding'`** (built-in appliances and HVAC are labor-exempt). Family default from `catalog_task.labor_taxable_default` is used only when `install_type` is unknown; the field tool requires install_type on the serial-tag step so it's rarely unknown. Quote stores `tax_parts` and `tax_labor` separately and the customer page shows both lines.

### 5.3 Quote object and rendering
A quote is built entirely from `quote_line`s. The existing Estimate Approvals customer page renders from it (no PDF). Fields shown: unit, lines (parts with number + description; labor as one "Repair parts & labor" line or itemised per Cayden's preference — setting), S&H, tax lines, total, "Diagnostic included", "what you'll be charged and when" sentence, approve / think / shopping buttons (existing), parts ETA sentence from verified availability + next install slots.

⟨9/18⟩ **Part number optional, description required.** Cayden: *office admins need the ability to
manually add parts and labor to quotes. If a tech can't find a part number in the field, we should be
able to add it later, as long as the tech is required to select the failed component description or
input their own.* So `quote_line.description` is required on every part line — the component chip, or
the tech's own words for *Other component* — and `part_number` is nullable. The UNKNOWN convention from
item 17 is gone. **Office Parts verify** highlights a blank part number as *tech left this blank — add
the number*. ⟨9/19⟩ A number the tech *did* key arrives in an **editable, copyable field** on the same
row — she copies it into the supplier's site, or corrects it when he got it wrong or it has been
superseded, and the row keeps what he sent (*tech keyed W10779716 — you changed it*) so a pattern of bad
numbers is visible rather than silently fixed forever. Parts Verify also has **+ Add part** and **+ Add labor** rows (labor from the task list or free text,
hours × $130), a remove ×, the auto zone-fee line with its ZN1–ZN4 override (§5.1a), and the quote
total — parts + labor + $25 S&H when any part is on the quote + 8.25% tax, labor tax-exempt when the
unit is built-in (§5.2). For the interim the rendering is the existing Agility Service Estimate
Approvals page (§5.8), where labor shows as *Labor (2 entries)* — the zone fee and the component
replacement — which is one answer to open item 2.

⟨9/18 pm⟩ **A discontinued part stops the repair, not the verify.** Cayden: *Kezia needs a toggle to
confirm a part is available. We occasionally run into discontinued parts. If we do, we need to inform the
customer, and then likely terminate the call and move it into a sales workflow — it can go right back into
our estimates tool, which can move the customer into a sales queue.* So the availability row on Parts
verify has a fifth state, **Discontinued** (`quote_line.availability = 'nla'`, next to `stock` / `2-3d`
/ `5-7d` / `backorder`). An NLA line needs its description and nothing else — no price, no date — and the
card wears a red banner saying what happens next. If a substitute exists Kezia adds it as a new line and
removes the NLA one; the call is then an ordinary quote. Otherwise **Verify** hands the call to Noell's
Estimates as a **parts-unavailable notice** — `estimate_handoff.kind = 'notice'`, total 0, no ETA, status
*Ready* — rather than a quote. The row is marked *part discontinued · no quote*; the notice's customer
text (shown in the drawer, sent on a click like every other message) says the part has been discontinued
by the manufacturer, the repair cannot go ahead, and offers the showroom team's help choosing a
replacement through the same estimate link. Two exits, both **SO7** with a `set_status` packet whose note
names the part: **Customer: shop for a replacement** (estimate status `shopping`, `task:sales_lead`, the
showroom queue Cayden described) or **Informed · close the call** (status `parts_unavailable`, no lead).
A notice can never be approved. Warranty tickets go through the same path with a note that the
manufacturer decides on replacement or prorate. Every estimate close — shopping, went elsewhere,
diagnostic only, parts unavailable — now queues its SO7 packet, so ePASS hears every outcome, not only
approvals.

⟨9/18 pm, answered⟩ **The diagnostic on a discontinued part.** Cayden: *standard process, we still charge
diag if we can't get a part. This does become a point of contention, since they are usually upset. We
frequently waive it as we pass them over to sales to keep them happy and keep the sale in house, even
though we truly have no control over what the manufacturers do with replacement parts.* So the notice
carries a **diagnostic decision**, defaulting to `charge`:

- **Charge — standard.** `DIAG_FEE` 169.95 billed as on any SO7 (§5.5).
- **Waive.** One click, no permission gate (it is a customer-facing kindness the office makes several
  times a month, and gating it would only add friction), logged with who and when, and carried on the
  SO7 packet as *do not bill* so ePASS is billed correctly.
- **Credit toward a replacement.** Billed now, credited in full against a showroom purchase. Modelled and
  labelled **a proposal, not policy** — it is the option that keeps both the fee and the goodwill, and it
  needs Cayden's word before it is offered to a customer.

The setting is `billing.diag_on_nla` (default `charge`), the fee is `pricing.diag_fee`; Phase 0 is
`handoff.record_response(..., diag=)`, audited as `diag.waive` / `diag.credit`. The customer wording
changes with the decision (doc 09) and the Estimates header counts *N of M diag waived* so the rate is
visible where the outcomes are.

**What the record says.** 974 tickets since 2006 carry *discontinued* / *obsolete* / *no longer
available* in the complaint or performed text; **248 of them are COD calls since Jan 2024**, about eight
a month. Billing on those 248: **56% the diagnostic, 19% zero, 9% under, 14% over** (some labor was
done). So "we still charge it" is what the record shows, and the waive runs at about one in five.
**24% of those customers bought from us within 90 days — $187,004 of showroom sales, ~$754 a call**,
which is the argument for making the waive frictionless rather than gated. The waived calls converted at
**17%** against **27%** for the billed ones; that is not evidence that waiving costs sales — far more
likely the waive goes to the angriest customers, who were least likely to buy — but ePASS records no
reason for a zero, so it cannot be untangled from the history. Logging the decision from now on is what
makes the comparison real.

### 5.3a Shipping is a default, not a constant ⟨9/19⟩

> Cayden: *"kezia needs to be able to set shipping in case theres a special order or something we get charged more for
> than 25."*

`parts.shipping_default` (25.00) is what a quote with parts starts with. Kezia can set it per quote on the Parts Verify
card; the override is stored on the quote with **who** changed it and an optional **why** (freight, oversize, expedite),
both of which travel onto the ePASS packet as part of the `S&H` line's description so the person keying it can see the
figure is deliberate. Setting it back to 25.00 clears the override rather than recording a change to the same number.

S&H is its own line on `jobLines`/the SO3 packet, not folded into parts, because ePASS bills it as its own code.

**⟨9/19 pm — answered.⟩** Cayden: *"we use the code freight in epass for s&h. that should be coded as taxed, but either
way, shipping should just default to $20 unless kezia changes it in the parts verify process. dont have the tech mess
with it. no freight on warranty stuff."* So, in full:

- the line carries the ePASS code **`FREIGHT`**, which is what the office already keys;
- it is **taxed** — `parts.shipping_taxable = 1`, and the tax base is parts + freight + (labor unless exempt);
- the default is **$20**, not $25;
- **the tech never sees it.** The S&H toggle is gone from the field tool entirely — it was a decision he had no basis
  for making, and it moved a number on a customer's bill;
- **no freight line at all on a warranty ticket**, because the manufacturer ships the part. `labor.shipping_line`
  returns `None` for warranty, override or not.

### 5.3b A quote the office draws up itself ⟨9/19⟩

> Cayden: *"we still need a way to draw up a quote … i'm assuming it should live in office queues in estimates where the
> office team can just hit add new quote, add parts and labor themselves, or hit send to tech button if they cant find
> the part."*

**Add new quote** in Estimates opens a builder that produces the **same quote object** a tech submission produces — the
same `zoneLine`, the same `laborLines`, the same warranty and tax rules, the same `makeEst`. That is the point: an
office-built quote and a tech-built one are the same thing downstream, so nothing further along has to know which it was.
The row is marked `office-built` and credited to whoever drew it up, and it lands as **Ready**, never sent: the estimate
still leaves on an explicit click like every other one.

It needs a ticket — the SV is what the customer's link, the ePASS packet and the SO3 all hang off — so the builder's
first field is a service-order picker and Save stays disabled until one is chosen, along with at least one line and a
price on every part.

**Send to the tech** is the other half, and it is the one Cayden actually asked for by name. When the office cannot find
the part, the pricing goes back to the person who stood in front of the machine: it writes `job.needs_tech_input` with
the question (the same nag as §2 rules 36–38 — top of his notifications, re-asked every morning until he answers) and
creates the estimate row at a new status **`withtech`**, which counts as open. Noell watches her own list rather than a
queue she does not open. When he submits, the row becomes Ready, credited to him.

`EST_ST` gains `withtech: 'With the tech'`; `EST_OPEN` gains `withtech`.

### 5.4 Field quote and signature
`POST /jobs/{id}/field-quote` with lines and `decision`. On `approve`: require `agree=true`, `signature` (PNG data URL → `photo(kind=signature)`), `signed_by_name`, and store `signature_text` = the exact authorization wording displayed:
> I approve the work above for $TOTAL and authorize Wilson AC & Appliance to charge the card I saved with my service request once the repair is complete. I understand the diagnostic fee applies if I cancel.
Quote `status=approved`, `decision_channel=field_signature`. Receipt later attaches the signature image.

⟨9/18⟩ In the field tool every part line needs a description before the quote can be built; the
part-number field says *leave blank if you can't find it — the office adds it from your description*,
and the readiness bar counts *N part(s) without a number* rather than blocking submission. The ZN
zone-fee line is added the moment a labor task or time amount is picked and cannot be removed by the
tech (§5.1a). A field-approved quote whose verified total is within 10% of the field price skips the
estimate hand-off (§5.8) — it is already approved.

### 5.5 Billing rules
- Nothing is charged at the diagnostic visit.
- `SO8` after approval → charge **approved total** (quote.total; diag included).
- `SO7` (declined, replace, walked) or `quick_fix` → charge `DIAG_FEE` (169.95, taxable). ⟨9/18 pm⟩
  Exception on a parts-unavailable notice (§5.3): the SO7 packet carries the diagnostic decision —
  `charge` (default), `waive` (billing takes it to zero) or `credit` — so the charge follows what the
  office actually told the customer.
- Cancel after a diag was run → `DIAG_FEE`.
- Charge = Stripe PaymentIntent off-session on the saved payment method; success → `payment.succeeded`, receipt (`notify:receipt`), `sync:post_payment`. Failure → retries 24 h and 72 h, `notify:payment_link` with a hosted pay page; 3 failures → `payment.review`.
- Any mismatch between tech-completed lines and approved quote (lines added/removed, discount) → `payment.review`; Noell approves the amount before the charge.
- ⟨9/15⟩ **One charge per visit, not per ticket** (team item 21). When every ready member of a `visit_group` has reached SO8 on the visit date, one PaymentIntent is raised for Σ approved totals and one receipt is sent listing each unit and what was done. ePASS is still posted per ticket: the `post_payment` packet for a group shows the single payment and the per-SV allocation. `payment.amount_mismatch` compares the **group** total. An unfinished member keeps the group's billing open and rides to the next visit. Ungrouped jobs are unchanged.

### 5.6 Delivered dollars — the tech's number ⟨9/11⟩
Techs are paid on **parts profit plus labor**, and the number they know is the weekly one from the OE-23 *Salesperson Activity* report. Definition (per invoice, matching OE-23's L/C/P rows exactly):

`delivered_dollars = labor_list + (parts_list − parts_cost)`

- `labor_list` = every labor line **including the diagnostic fee and zone fees** (ePASS books the $169.95 diagnostic as $157.00 labor + tax) — pre-tax.
- `parts_list − parts_cost` = parts profit at list; **on warranty jobs (`is_warranty`) parts profit is 0** — warranty parts are a no-profit wash, so the ticket counts labor only.
- Excluded: sales tax, S&H (OE-23 *Misc*), products.
- Recognised **provisionally at the tech's completion tap** (`tech.repair_complete`, `quick_fix`, `decline`/`replace` → diag fee) from the approved quote lines; `parts_cost` comes from the PO line `unit_cost`, else `part_catalog.last_cost`, else `parts_list × (1 − pay.parts_margin_default)` marked `cost_basis='estimated'`. **Reconciled nightly** against the closed invoice (ExportInvoice `Total` today; an OE-23 or invoice-line export with cost when ePASS can provide one — open item §12) and the difference is written as `adjustment`, never by silently overwriting what the tech saw.
- **Field tool** (route screen header, always visible): *Today $X · This week $Y · pace $Z/wk* — pace = week-to-date ÷ working days elapsed × working days in the week; shown against `pay.weekly_target.<sp>` when set ("$1,840 of $2,500"), otherwise against the tech's own trailing 4-week average. Tapping the header lists today's stops with each one's dollars and the labor / parts-profit split, and marks estimated costs. Nothing about other techs is shown.
- **Office**: column footers and the Productivity drawer (§4.8), per tech per day/week/month with the labor vs parts-profit split and warranty share; export to xlsx.
- Calibration from OE-23 Jan 1–Sep 10 2026 (`reference/data/oe23_parsed.json`), parts profit + labor per working week: JRC ≈ $2,600, TDP ≈ $2,500, AJH ≈ $2,200, CEM ≈ $2,150, KJB ≈ $1,900, DLA ≈ $1,700, BLL ≈ $1,700 (10 wks), MJI ≈ $1,550, CIT ≈ $1,450; median invoice ≈ $177, mean ≈ $254. Use these as the sample numbers in the prototype and as sanity bounds (a day over $2,000 for one tech gets a review flag).

### 5.7 Requote rule (field-priced parts)
At `parts.verified` on a `kind=field` quote: let `F` = `field_parts_total`, `V` = Σ verified × qty. **Re-approval required** if `V > 1.10 × F` **or** any line has `verified > 1.10 × field_price AND verified − field_price > 10`. Then: build quote v+1 with verified prices, status `sent`, `notify:quote_revised` (text with new total + link), job → `SO2.2`; order waits. Otherwise: apply verified prices silently to the line (receipt shows actuals); if `V < F` send `notify:total_down`. Field tool flags any part with `last_verified_at` > 30 days.

### 5.8 Living with ePASS as the source of truth — the interim operating model ⟨9/18⟩

Cayden: *we still have to use ePASS for storing ticket data, ordering parts, receiving parts,
accounting and billing. It needs to remain the source of truth … minimal double work.* This qualifies
ground rule 1 for as long as ePASS is the system of record: the dashboard owns what it alone produces —
requests, placement, findings, quotes, notifications, the estimate hand-off — and ePASS owns the ticket,
the order, the receipt and the money. Everything below is built in the office tool and in Phase 0.

**The flow, SO2 to parts received, as Cayden laid it out.**

1. **A self-booked request has no ePASS ticket.** The customer picked a window on the web form (or the
   test bench did). A pushed notification to the office-admin audience — *New self-booked request —
   create the ePASS ticket on {date} · {window} · {tech}* — carries name, address, phone, unit, problem,
   date, window and tech. The admin creates the ticket in ePASS and types the SV into the notification
   to link it; the next DispatchTrack import matches the SV. Until then the card wears an **ePASS ticket
   needed** chip. In the office prototype this is a `new_ticket` packet in the sync queue; in Agility it
   is `createPushedNotification` / `retirePushedNotificationsByRef`, the same mechanism as
   needs-tech-input (rules 36–38).
2. **Tech submits findings and a quote → SO2 → Kezia's Parts verify.** Her only job in our tool: verify
   each part's price, put an expected date (ETA) on it, and fix the lines the tech left incomplete
   (§5.3). No ordering here. ⟨9/18 pm⟩ If a part is **discontinued**, she marks it so; step 3 then
   carries a parts-unavailable *notice* instead of a quote, and the call ends at SO7 — showroom lead or
   closed — through the same estimate page (§5.3).
3. **Verified → hand-off into the existing Agility Service Estimate Approvals workflow** that Noell
   runs. Today she scans the ePASS work-order PDF; with structured lines the estimate row is created
   directly, no PDF. That module's list (Created · SV # · Client · Due · Contact · Status · Sent by), its
   drawer (status; contact with TEXT PREF / CALL PREF; *Not emailed — copy the link or use the button*;
   Parts ETA *In stock · Tue, Sep 22 – Fri, Sep 25* with the sentence *Once approved, we will order the
   parts listed to complete the repair and schedule your technician {tech} to return between … and …*;
   the unit line; lines including *Labor (2 entries)*; S&H, subtotal, tax, total; Copy client link /
   Close estimate) and its closed-outcome summary (approved / comped / shopping / went elsewhere /
   diagnostic only / no response) are reused as-is. Statuses: sent → viewed → approved | declined |
   comped | shopping | diagnostic. Nothing emails on its own. Two paths skip the estimate: a
   field-approved quote within 10% of the field price (already approved) and a warranty job (the
   manufacturer pays).
4. **Approved → Noell adds the parts and labor lines to the ePASS ticket** so it matches the approved
   quote, and sets SO3. This is the one piece of re-keying the team accepts. The sync queue gives her a
   `lines` packet: every part with its part number, every labor line with its ePASS code (`ZN1` …, the
   task), the total, *set SO3*.
5. **Kezia orders in ePASS as normal and moves the ticket to SO4 there.** Our tool learns SO4 from the
   next DispatchTrack import (every 15 minutes); the install is then penciled onto the owning tech's
   route at ETA + 2 business days as a held block on the board — dashboard-only, §4.3a — from the ETA
   Kezia verified in step 2.
6. **She receives the part and sets SO5 in ePASS.** The next import shows SO5 and the customer's *your
   part is in — pick your install time* text becomes **ready**: it goes out on an explicit click, or
   automatically only if that template's toggle is on (`notify.part_arrived_pick_time.auto`, default
   off — the standing rule: no automated customer contact without an explicit click or an explicitly
   enabled toggle).
7. **Customer picks → SO6**, with a packet to key the date and tech into ePASS, as today.

**What we key into ePASS, and what we only read back.**

| we key into ePASS (a sync packet) | we only read back (the import) |
|---|---|
| a new ticket for a self-booked request (`new_ticket`) | SO4 — Kezia ordered |
| the approved part and labor lines + SO3 (`lines`) | SO5 — the part is received |
| dates and tech: the SO1 booking, the SO6 pick, moves (`set_schedule`) | everything Kezia does in ePASS |
| | anything changed in ePASS directly — reverse discrepancies (§3.5) stay |

**Purchasing is hidden for now.** The Parts order tab, the PO builder, the supplier order sheets, the
Receiving tab, bin scanning and the two-day-out hold check as a receiving task stay in the code and sit
behind `purchasing.enabled = false` — Cayden: *we will bring this back when we are on NetSuite and can
open an API.* Rules 20 and 23 in §2 therefore fire from the import read-back rather than from
`po.placed` / `receiving.all_parts_in` while the flag is off. The SO4PRE hold logic still applies to
dates; the receiving side of it is ePASS's. §3.4's "the import never writes `status`" has this one
exception: on a hand-off job, SO4 and SO5 seen in the import are adopted.

**Phase 0.** Table `estimate_handoff` (§1.2). `handoff.py`: `hand_off` creates the row from the
verified lines; `record_response` — approved → SO3 and a `lines` sync item; declined / shopping /
no_response / diagnostic → SO7; `watch_epass_status` hooks the import reconcile — SO4 on a hand-off job
pencils from the verified ETA, SO5 marks the part-arrived text ready. Sync kinds `lines` and
`new_ticket`; `request_ticket` / `link_ticket` for self-booked requests (self-booked = `job.source ≠
'import'` and no SV). 62 tests pass.

---

## 6. Notifications (Podium)

All customer messages go through the Podium API using the customer's `contact_pref` channel (text default; email if chosen; `call` pref → still send text/email **and** create a call task for Client Care). Every send is a `notification` row with provider id and delivery status. Templates are `settings` rows (editable in the dashboard). `{link}` is the tracker deep link (signed token, no login).

| Key | Trigger | Template (text) |
|---|---|---|
| `request_received` | #1 | Wilson AC & Appliance: we have your request for the {unit}. Your reference is {sv_or_ref}. Track it here: {link} |
| `request_bucketed` | #1 designated_days | We group visits in your area so we can get to you efficiently — we'll text you a date within a few days. {link} |
| `request_office_only` | #1 office_only | Thanks — Client Care will call you within one business day to schedule. {link} |
| `so1_booked` | #2 | Diagnostic booked {day} {window}. {tech_first} is your technician. Please clear access to the unit. Change it here: {link} |
| `reminder_day_before` | 17:00 day before any appointment | Reminder: {tech_first} will arrive {day} {window}. Reply here if anything's changed: {link} |
| `on_my_way` | tech tap | {tech_first} from Wilson is on the way, arriving about {eta}. |
| `quote_sent` | #16 | Your estimate for the {unit} is ready: {link}. Approve or ask a question there. |
| `quote_reminder_48h` / `quote_reminder_5d` | timers | Still thinking it over? Your estimate is here: {link} |
| `quote_revised` | §5.7 | A part price changed after we checked with the supplier — your new total is {total}. Please re-approve here: {link} |
| `total_down` | §5.7 | Good news — the part came in lower than quoted. Your total is now {total}. No action needed. |
| `approved_ordering` | #4, #17 | Thanks! We're ordering your parts now. We'll text you the expected date. {link} |
| `parts_ordered` | #20 | Parts ordered — expected {eta_date}. We'll text the moment they check in. {link} |
| `parts_delay` | #22 | Update: your part is now expected {eta_date}. Sorry for the wait — here's the latest: {link} |
| `part_arrived_pick_time` | #23 | Your part is in! Pick an install time with {tech_first}: {link} |
| `held_confirmed` | #24 | Your part arrived — your {day} {window} appointment is confirmed. |
| `install_confirmed` | #25 | Install confirmed {day} {window} with {tech_first}. |
| `trip_date_offered` | §4.4 | We can be in your area {day}. Tap to confirm a {window} window: {link} |
| `reschedule_needed` | #13, #22 | We need to move your appointment. Pick a new time here: {link} |
| `hold_released_apology` ⟨9/11⟩ | #22b | We're sorry — the part for your {unit} hasn't arrived in time for {day}, so we've released that appointment rather than send {tech_first} out without it. It's now expected {eta_date}. Pick a new install time here and we'll confirm the moment the part checks in: {link} |
| `so4h_check_in` ⟨9/11⟩ | #24a, eta + 1 d | Has the part for your {unit} arrived at your door? Tap here when it has and we'll schedule the install with {tech_first}: {link} |
| `receipt` | #27/#9 | Repair complete. Your receipt: {link}. Thanks for choosing Wilson — a review helps us a lot: {review_link} |
| `declined_receipt` | #7/#11/#12 | Your diagnostic receipt: {link}. If you'd like to look at replacement options, {showroom_link}. |
| `payment_link` | #32 | We couldn't process the card on file. Pay securely here: {pay_link} |
| `quiet_period` | 7 d no status change & no customer action pending | Still working on your {unit} — nothing needed from you. Latest here: {link} |

⟨9/15 late⟩ `tech_handoff` is **not** in this table: it goes to a technician, not a customer, and is specified in §4.1d. It shares the relay and the `notification` log, nothing else.

Internal: ⟨9/11⟩ `hold_eta_check` task to Parts/receiving (Kezia) at T−2 for every SO4PRE hold whose parts are not all in, with Part-is-here / New-ETA / Wait buttons; Recalls queue digest to Mark weekly; Stuck Jobs digest 07:00 to Cayden + Demitrius + Mark; Needs-review quotes and Payment-review to Noell (in-app + email); new SO2 count to parts manager; sync backlog to Michael; trip proposals to Demitrius (in-app + text).

---

### 6a Office notes and internal reminders ⟨9/17⟩

"Check back in with Miss Jones on xyz." `office_note` (§1.2): free text on a customer or a ticket,
never printed, never sent, shown on the account in the office tool and on the tech's job screen. Add a
`due_on` and it is a **reminder**: it appears on the office **Reminders** tab that morning (oldest
first, "due" chip when today or past), ticking it off writes `done_by`/`done_at`. **Internal only** —
Cayden 9/17 — a reminder never texts or emails a customer; if the outcome of a reminder is a customer
contact, that is a separate, explicit send under §6.

### 6b The confirmation page, and the link that is the portal ⟨9/18 late⟩

Cayden, 9/18 late: *a landing or success page after a customer selects a date and completes the
registration that makes clear the functionality of saving the customer portal link to monitor their
service.* Until now the intake flow dropped the customer straight onto the tracker with a toast, which is
the software equivalent of handing someone a key without mentioning it is a key. The page below is the
moment we tell them.

**The link is the portal.** Decided 9/18: `GET /t/{token}` opens the customer's repair with no order
number, no phone and no password — the FedEx model. That is the whole reason the confirmation page
matters: if the link is the only way in, saving it is not a nicety. The alternative (token plus the last
four digits of the phone) was considered and set aside — it buys little, because the token is already the
secret, and it costs the one thing this page is trying to buy, which is a customer who comes back.

- `job.tracker_token CHAR(14) UNIQUE` + `tracker_token_at` + `tracker_token_by` (§1.2). Fourteen characters
  from a 55-character alphabet is about 81 bits; `0`, `O`, `1`, `l` and `I` are left out because a customer
  reads this to Client Care over the phone when they have lost it.
- Issued by `statuses.create_request`, so the link exists before the confirmation page renders and the
  `request_received` text carries the same one. Issuing is **idempotent** — nothing may orphan a link a
  customer has already saved.
- `GET /t/{token}` answers identically for unknown, malformed, revoked and expired tokens: not found, no
  reason. Rate-limited per IP. Never enumerable.
- **Reissue** (`POST /jobs/{id}/reissue-link`, office, audited `tracker.reissue`) for "I lost it" and for a
  phone that changed hands. The old token stops working the moment the new one is handed over; that is the
  feature, not a side effect.
- **Expiry is housekeeping, not security.** A link keeps working `tracker.link_expiry_days` (90) past
  `closed_at` so the receipt stays reachable, then stops. This is the rule already stated in §9.
- **Scope.** A token sees one job: stage, appointment, tech first name, parts ETA, the estimate and its
  lines, the receipt, and the actions in §7 under `/public/jobs/{token}/…`. It never sees the card (there is
  nothing to see — SetupIntent only), other jobs at the same address, or anything about another customer.
  `tracker.CUSTOMER_FIELDS` is the allow-list, and the payload is built from it rather than from `SELECT *`.

**The page itself** — three variants off one template, chosen by booking mode, each with the same four
sections. Copy lives in `09_Customer_Copy.md` §2a and in `settings`, as every customer-facing string does.

| booking mode | headline | second line |
|---|---|---|
| `open` (a window was picked) | You're booked, {first} | Diagnostic {day_long} · {window_long}; {tech_first} is your technician |
| `designated_days` (trip bucket) | Request received, {first} | We'll text you a date within a few days |
| `office_only` | Request received, {first} | We'll call you within one business day |

1. **Save this link — it's how you follow your repair.** The URL in a copyable box, then what the link
   actually does, in the customer's terms: see where the repair stands, change the appointment, read and
   approve the estimate, track the part and pick the install time, message Client Care. Then one honest
   line: *anyone with this link can see your repair* — because that is true, and a customer who knows it
   is a customer who does not paste it into a Facebook group.
2. **Keep it somewhere you'll find it** — three collapsed rows: *Put it on your home screen* (per-OS steps,
   iPhone and Android), *Email me the link* (an address typed on the page, one send, nothing else), and
   *Bookmark this page*. Add-to-home-screen is first because it is the only one that survives a cleared
   message thread. It needs a web app manifest on the tracker route: `display: standalone`, `name`
   "Wilson Repair", `start_url` the token URL. iOS ignores `start_url` and pins the current URL, which is
   what we want anyway.
3. **What happens next** — three steps, written for the variant.
4. **What you'll be charged** — nothing today; $169.95 diagnostic; included in an approved repair rather
   than added to it. This is the sentence that stops the phone call.

Then one button, *Open my tracker*. The tracker itself repeats the offer once, quietly, in a dashed bar
under the actions: *this page is your private link — save it and you can come straight back.*

**Email me the link is exempt from the no-automated-contact rule, and only this.** The standing rule
(§6) is that nothing reaches a customer without an explicit click or an explicitly enabled toggle. Here the
explicit click is the customer's own, on their own screen, asking for their own link — so it needs no
template toggle. It is still rate-limited (`tracker.email_link_limit_per_hour`, 3 per job per hour),
validated, and it sends the link and nothing else. Typing an address into that box does **not** make it the
customer's email on file; that would be collecting data through a side door.

### 6b.1 The three buttons on the tracker that did nothing ⟨9/19⟩

> Cayden: *"the buttons other than reschedule dont currently work … if they click message client care, it should launch a
> text message to 512-894-0907 automatically that says something generic … cancel request gives them a success page …
> add gate code or note needs to launch a window to input something."*

All three are **customer-initiated writes through a token**, and a token is a bearer credential — anyone holding the link
is the customer as far as we can tell. So each one is deliberately narrow about what it may touch. None of them moves
money, changes an address, or reaches another job.

**Message Client Care** — `tracker.client_care_sms(db, token)` returns the number from `clientcare.sms_number`
(512-894-0907) and an `sms:+1…?&body=…` href the page hangs on an anchor, so on a phone it is one tap into the messaging
app. Nothing is sent from our side; the customer's own phone sends it when they press send. The body is *generic* in
Cayden's sense but not empty: `Hi Wilson AC & Appliance — this is {first}, about my repair {SV} ({unit}). ` and then it
stops, mid-thought, leaving them the cursor. What wastes Client Care's time is not the customer's question, it is working
out whose repair they are asking about, and this removes exactly that. It contains no question mark, because putting
words in their mouth is how you get an answer to a question nobody asked.

**Add gate code or note** — `tracker.set_access(db, token, gate_code, note)` writes **two fields** on the job's address,
`gate_code` (24 chars) and `access_notes` (240), and nothing else. The customer may tell us how to get in; they may not
tell us who they are or where they live, because an address change should be a phone call. Clearing both is allowed — a
code that has changed is worse than no code. Every write is audited as `user_id='customer'`. On the page the saved value
comes back as a line naming the tech who will see it, and the button changes to *Change gate code or note*.

**Cancel request** — `tracker.cancel(db, token, reason, note)` resolves the token, refuses from any status in
`NO_SELF_CANCEL` (SO3 onwards — once we have bought a part, cancelling is a conversation with a person, and the page says
so and offers Client Care instead), and otherwise fires `customer.cancelled`, which is **rule 34**: the same path a
dispatcher's cancel takes. SO9, `route_date` cleared so the half-day goes back to the route, `cancel_reason` recorded, a
`set_status` sync item for ePASS. The reason is validated against `CUSTOMER_CANCEL_REASONS` and anything else is stored
as `other` rather than trusted.

Then a **success page**, which is the part Cayden asked for by name. It leads with the thing the customer is actually
worried about — *You haven't been charged* — names the window that went back to the route, says the office can see it and
nobody needs to call them, and offers *Put it back now* plus Client Care. The ticket stays on file for 30 days, so
changing their mind does not mean starting over.

### 6b.2 Closing a call out, from the board ⟨9/19⟩

> Cayden: *"we need a way to cancel a customer submitted service request … we just need it as an option to close out a
> call for whatever reason."*

One function with two doors. `statuses.transition(..., 'staff.cancelled')` is the dispatcher's; `tracker.cancel` is the
customer's; both are rule 34 and land in the same place. The dispatcher's dialog adds the reasons a customer would never
pick (duplicate ticket, could not reach the customer, no card / no authorization, do not service, office error), a note,
and an explicit **Text the customer** checkbox that is **off** by default — the standing rule, no automated customer
contact without a click.

A cancelled call leaves the route and does not fall into Unscheduled; it sits in a **Cancelled** panel with who cancelled
it, why, which half-day it gave back, the ePASS packet to key, and **Undo**, because the commonest thing that happens
after a cancel is discovering it was the wrong ticket. A ticket with parts already on it says so on the row: the call can
be closed, but the part is still somebody's decision.

**How we find out whether any of this worked.** `tracker.opened()` writes one row per open. The measure is
not page views, it is: what share of jobs have a customer who came back on a *different day* from the one
they booked. If that number is low the page failed, whatever it looks like. Baseline now is zero, because
there is no link to come back to. Open item 45.

### 6c Editing a ticket from the office ⟨9/19 late⟩

Cayden: *"i guess we need to add the ability for anyone in the office to be able to edit customer, unit, tech notes any
info."* Kelli Kenney's built-in refrigerator read *speed oven* for a day and nobody who saw it could fix it where they saw it.

**One Edit on every ticket card** (parts verify, estimates drawer, purchasing when it returns), **every field, any office
role**: customer name, phone, email, contact preference, ZIP; appliance description, model, serial, built-in; the tech's
note; the problem as reported. Two rules make it safe rather than loose:

1. **Every change is a row in `audit_log`** — `Field Changed - Model from [PSB9] to [PSB42YSKSS] — tag photo shows PSB42`,
   with `user_id`, the time and a **required one-line reason**. The sheet refuses to save without the reason; a change with
   no reason is the thing nobody can untangle a year later. The ticket's activity panel shows these rows beside the
   status history and the tech's findings.
2. **A correction packet goes to the ePASS sync queue** (`sync_item.kind='fields'`, §3.5), because until NetSuite ePASS is
   the source of truth for ticket data (§5.8). The packet is paste-ready — field, was, is, why, by — the office keys it,
   and the next import confirms it. The dashboard never writes into ePASS.

The endpoint is `PATCH /jobs/{id}` with `{changes:{field:value}, reason}`; `reason` is required (400 without it); the
server diffs against the stored row, writes one `audit_log` row per changed field and one `sync_item`, and returns the
job. Customer fields write to `customer`/`address` (so every job at that address sees the correction), unit fields to
`unit`, notes to `job`. Nothing is edited silently; nothing is edited in ePASS by this system.

## 7. API surface

REST, JSON, bearer auth from the existing dashboard session. `{id}` = job_id; `sv` accepted as alias.

**Intake / customer**
- `POST /public/requests` (form step 1; existing) → `{job_id, ref}`; `POST /public/requests/{ref}/card` (existing Stripe flow)
- `GET /public/requests/{ref}/slots` → booking_mode + offered half-days `[{date, window, tech_first}]` or bucket/office message
- `POST /public/requests/{ref}/book {date, window}` → #2
- `GET /public/track?sv=&phone=` → tracker payload (stages, current stage detail, actions allowed)
- `GET /t/{token}` → tracker payload (§6b); identical not-found for unknown, revoked and expired. `POST /t/{token}/email {to}` (customer-initiated, rate-limited, §6b) · `GET /t/{token}/manifest.webmanifest` (add-to-home-screen)
- `GET /public/requests/{ref}/confirmation` → the confirmation page payload: variant (`booked` | `bucketed` | `office_only`), appointment, tech first name, the token URL, the four sections' values
- `POST /public/jobs/{token}/reschedule {date, window}` · `/cancel` · `/approve` · `/decline` · `/shopping {answers}` · `/hold {date, window}` · `/confirm-trip {window}` · `/message {text}` · ⟨9/11⟩ `/part-received` (#24a, the tracker's *My part arrived* button)

**Field tool** (tech auth; offline-tolerant, all idempotent by client id)
- `GET /tech/route?date=` → stops with sequence, ETA, customer, unit, problem, photos, gate, balance, bin, pref, owner flag
- `POST /tech/appointments/{id}/on-my-way` · `/arrive` · `/complete` (timestamps)
- `POST /tech/jobs/{id}/findings` `{unit_id, outcome, symptoms[], cause, note, parts[], labor[], flags[], photos[], serial_photo_id, install_type, model, serial}`
  ⟨9/19 late⟩ writes the `findings` row (§8c) through the status rule it fires; `error_code`, `custom_note`, `on_site_minutes` ride along. `GET /jobs/{id}/findings` returns every visit on the job, newest first.
- ⟨9/19 late⟩ `PATCH /jobs/{id}` `{changes:{field:value}, reason}` — the office edit (§6c). `reason` required; one `audit_log` row per changed field; one `sync_item kind='fields'`.
- `POST /tech/jobs/{id}/field-quote` (§5.4) · `POST /tech/jobs/{id}/install-result` `{part_status{}, outcome, note, photos[]}`
- `PUT /tech/photos/{photo_id}` (raw body, headers `X-Job-Id`, `X-Unit-Id`, `X-Photo-Kind`) → mirrors the maintenance portal's `/api/photos`
- `POST /tech/day/{date}/parts-loaded` (toggle)
- ⟨9/11⟩ `GET /tech/revenue?date=` → `{today, week, pace, target, stops[{job, labor, parts_profit, estimated}]}` (§5.6); `GET /tech/route` also returns `route_block`s in sequence and each completed stop's delivered dollars

**Board / dispatcher**
- `GET /board/fill?from=&to=` (ledger) · `GET /board/column?tech=&date=` (timeline) · `GET /board/unscheduled`
- `POST /route/move {job_id, tech_id, date, index}` → `{ok, chips[], timeline}` · `POST /route/lock` · `POST /route/optimise {tech_id, date}` · `POST /route/unschedule {job_id}`
- `GET /trips?state=` · `POST /trips/{id}/confirm {date?}` · `/move` · `/cancel`
- ⟨9/11⟩ `GET /board/tech-day?tech=&date=` (tech route overview) · `POST /route/move {…, force:true}` · `POST /tech-days/{tech}/{date} {available, reason, capacity_adjust_min, note}` · `POST /tech-days/range {tech, from, to, available, reason}` · `POST /blocks {tech, date, start, end, label, address_id?}` · `PUT/DELETE /blocks/{id}` · `GET /revenue/tech?tech=&date=` · `GET /revenue/day?date=` · `GET /kpi?from=&to=&tech=` · `GET /recalls?state=` · `POST /recalls/{id}/confirm` · `/dismiss {note}`

**Office queues**
- `GET /parts/verify` · `POST /quote-lines/{id}/verify {verified_price, availability, supplier}` · `POST /jobs/{id}/verified`
- `GET /parts/order` · `POST /po {supplier, lines[], expected_at, ship_to}` → PO + export · `POST /po/{id}/place`
- `POST /receiving/scan {code}` · `POST /po-lines/{id}/receive {bin}`
- `GET /sync?state=` · `POST /sync/{id}/keyed` · `/reissue` · `/accept-epass`
- `GET /review/quotes` · `GET /review/payments` · `POST /payments/{id}/approve {amount}`
- `GET /stuck`
- ⟨9/18 late⟩ `POST /jobs/{id}/reissue-link {reason}` → a fresh tracker token; the old one dies immediately (§6b), audited `tracker.reissue`
- ⟨9/11⟩ `GET /search?q=` — one box for the office: matches customer name (any word order), phone digits, SV (with or without `SV000`), serial, model, address line; returns `{customers[], jobs[]}` ranked, open jobs first. `GET /customers/{id}/history` → every job at that customer with dates, unit, status, tech, what was done (quote lines / findings), amounts and links; `GET /units/{serial}/history` → same by unit (a customer can move; the appliance may change owners). History includes closed jobs back-filled from the completed-invoice exports (§10 Phase 0.5).

**Imports / admin**
- `POST /imports/exportinvoice` (upload) · `GET /imports` · `GET/PUT /settings` · `GET/PUT /catalog/*` · `GET /catalog/epass-export`

---

## 8. Field tool technical notes
Mobile web (PWA) on techs' own phones; identity from dashboard session (no second login); launch carries the tech id and date. Follow `02_Field_Tool_Conventions.md`: tap-only, 44/52 px targets, 450 ms autosave debounce to local storage then server, photos downscaled to 1600 px JPEG q0.82 and written to IndexedDB **before** the UI says saved, uploaded one at a time with the metadata headers, never deleted locally; offline banner from the service worker; readiness strip names what's missing. Arrive/complete taps are the duration source (§4.1). Serial-tag photo required only when `unit.serial_tag_photo_id` is null (SO1); install screens show the existing one. ⟨9/11⟩ Two deliberate typing exceptions to tap-only: the **error code** field (appears when the *Error code* symptom chip is tapped; short alphanumeric, autocapitalised, required) and the **Custom note** (a button under *What you found* that reveals a text box, with voice-to-text as the keyboard's mic; optional). The labor picker shows **Half day · 4h** and **Full day · 8h** chips above the family's task list. The route screen header carries the delivered-dollars strip (§5.6) and lists `route_block`s in sequence as grey cards (label only, no customer).

### 8a The one estimate flow, and what the tech owns ⟨9/19⟩

Cayden, 9/19: *field quote generates a different workflow than office sends quote right now. lets make
this consistent. even if office is sending quote, we need the tech to be the one to really build and
price it … theyre the only ones that know exactly what theyre going to have to do during the repair
trip.* One screen now serves both, in the order the office path already used: **parts, then labor, then
a total.** What differs at the end is only who presses send.

- **Field quoting is suspended, not removed** — `FIELD_QUOTE = false` (§11). Cayden: it comes back when a
  part price can be verified at the door (item 46). The customer-signature path, the authorization
  wording and the decision branches all stay in the file behind that flag; the outcome list simply does
  not offer *Quote the repair now*.
- **Outcome is a `<select>`**, not a column of buttons, pre-set to the usual answer for the call:
  `parts` on a COD SO1 (→ SO2), `parts` on a warranty SO1 (→ **SO3**, no estimate to the customer),
  `complete` on an SO6. One line under it names the destination. `defaultOutcome(job)`.
- **Labor: the book's hours are hidden.** A task arrives with `hours = null` and its row stays
  highlighted until the tech picks from 30 min / 1 / 1.5 / 2 / 3 hr / half day / full day; the price is
  his hours × `labor.hourly_rate`. A line the book does not have is typed into the same box and added
  with `source = 'manual'`, priced identically. `quote_line` gains `hours_source ENUM('tech','book')` and
  `line_source ENUM('catalog','manual')`; a manual line carries no `catalog_task_id`.
- **The labor total is editable by the tech.** `quote.labor_override DECIMAL(10,2) NULL` plus
  `labor_override_by` / `labor_override_at`; the UI shows the book figure beside it and offers a reset.
  This is policy, not a loophole — Cayden: *there are just times when labor needs to be adjusted based on
  the customer or situation that cant be dictated by only time … ultimately its a commission role and
  they are in charge of what they make.* Report on it (override rate and average delta per tech) rather
  than gating it.
- **The part number is keyed where the component is named**, on the part row itself, and a known
  component brings its catalog number with it. The *no part # yet — the office adds it* caption and the
  *leave blank if you can't find it* placeholder are both gone: a missing number is still not a hard
  block, but nothing on the screen calls it optional. It reaches Parts Verify editable and copyable (§5.3).
- **Typeahead on every free-text box** — what you found, cause, the component, the labor line. The pool
  is, in order: what this model family has actually needed (the ODBC `service_part` history for the
  family stem, junk rows filtered), then the catalog, then the tap options. `modelParts(job)`,
  `partPool`, `taskPool`, `foundPool`, `causePool`. Cayden's own example — a GTW465 that won't drain —
  offers valve, main control board, agitator base and auger, which is what went into thirty-five of them.
- **What you found and Cause are visible text boxes**, not chips that reveal one. Both sit under their
  tap chips; the chips remain the fast path.
- **Photo prompts read "Any relevant photos?"** on both the diagnostic and the install, replacing
  *Problem photo* and *Completed work photo* — the old labels told a tech which photos counted.
- **Could not access unit drops the serial-tag requirement** (he could not reach the unit).
- **Warranty in the field.** `labor.wty_cod_brands` — True, Scotsman, Zephyr, BlueStar — pay our COD rate
  and the tech quotes labor normally. Every other warranty brand shows no labor picker: the flat rate is
  the warranty admin's to add at claim time. Warranty jobs carry **no zone fee** and are **tax exempt** on
  both parts and labor. The rates themselves are open item 47.

### 8b The read-only look-ahead ⟨9/19⟩

Cayden: *add a button the tech can hit to see the dispatch board and look ahead at their route for
upcoming days … should only show them their route and calls and filter out the rest. they should not be
able to change anything in this view.* `GET /tech/route?from=&to=` already returns the shape; the view
renders the tech's own stops grouped by day — window, address, unit, SV, balance — and contains no
input, no drag target and no write path. It is the board filtered to one truck, not a second board. The
banner names who owns it: *if a date needs to change, message the office and they move it.* Stop order
for a future day is labelled provisional, because it is.

---

### 8c Where the tech's findings go ⟨9/19 late⟩

Cayden: *"where are tech notes stored for current jobs? where do their findings recorded in field tool end up? we do need
this to record their notes into history."* Three honest answers, in order.

**ePASS today.** The tech tells the office, the office re-types it into the ticket's *Work Performed* box. That text is
`service_detail.performed_desc`, and it is the only reason twenty years of history reads as well as it does — every
*"Read the last visit"* in the field tool and every history row in the office is that box.

**The prototype, until this round.** In the phone's memory (`s.f`) and a toast. Not history. That was a gap, and it is
closed in all three places:

- **Field tool** — Submit composes the visit record in the catalogue's own shape (what the customer said, *Found … Cause …
  Parts needed … Labor … Note … Outcome*) and puts it at the **top of this unit's history at once**, in the same panel the
  next tech reads before he knocks, marked *This visit · you*. It opens like any past call. Reopen takes it back out until
  it is submitted again. A part keyed without a number says *no number yet* rather than inventing one.
- **Phase 0** — `findings.record` runs inside the `record_visit` effect on every visit event, and `findings.history(db,
  customer_id=…)` / `history(db, serial=…)` return **one list** — ePASS catalogue rows (`source='epass'`, `did =
  performed_desc`) and dashboard visits (`source='dashboard'`, `did = performed_text`) — newest first, in one shape:
  `{sv, date, status, tech, unit, serial, said, did, source}`. By customer or by serial, because a customer can move and an
  appliance can change hands. `GET /customers/{id}/history` and `GET /units/{serial}/history` (§7) return this.
- **Office** — the ticket card labels the tech's note as his, and its activity panel carries the *Tech findings submitted*
  row; the customer history table is the `history()` list above.

**Agility from here.** The `findings` row is the record. The ePASS packet keeps carrying the first 200 characters as the
ticket NOTE (§3.5 — *Full findings + N photos: dashboard SV…*), so ePASS's Work Performed is never the master copy again
and nothing is re-typed. At NetSuite cut-over the `findings` rows become the service order's work-performed history
directly; the ePASS catalogue is loaded once and read only.

**§8a, amended ⟨9/19 late⟩ — the part number is never filled in.** Cayden: *"the field tool is auto populating a part
number when a component that failed is selected … a whirlpool brand part number when i select drain pump [on a GE]. this
field should just remain blank for the tech to key the part number we need."* He is right, and rows 80/86 in §13e are
reversed: the sample catalog is brand-agnostic, so a number it offers is the right part for the wrong machine, which is
worse than no number. Component **names** are still offered (those are brand-agnostic); the number field starts empty on
every line, takes the focus when the line is added, and the tech keys it. Kezia's verify row flags a blank one (*tech
left this blank — add the number*) and remembers what he keyed if she changes it — and a sample placeholder is never
reported as something he keyed.

**The day loader (prototype only).** The field tool carries every one of Diogo's routed days from the export (Thu 9/17,
Fri 9/18, Mon 9/21, Tue 9/22), because the tool has to be shown on a real warranty call and Thursday has none; Friday has
Allison Schmidt's Speed Queen dryer, billed to Speed Queen Warranty. A banner control (and `?day=YYYY-MM-DD`) loads any
of those days as today; the look-ahead is derived from the same routes, so a stop cannot say one thing on Thursday's list
and another on Friday's. The built tool reads the clock. Nothing on a stop is hand-set any more: the warranty flag, the
payer and the category all come off the export.

**Sealed-system rate — two over-claims fixed ⟨9/19 late audit⟩.** `SEALED_RE` matched *condenser*, so a condenser **fan**
motor or *clean condenser coils* claimed the sealed rate; and the field tool read the ticket's duration class
(`type:'sealed'`, which only means built-in refrigeration) as sealed-system work, so every built-in fridge warranty call —
a dripping noise included — would have claimed $237.74 instead of $113.68. Sealed is now decided only by what the tech
tapped: a sealed-system labor line (`sealed system`, `compressor`, `refrigerant`, `filter drier`, `evaporator coil
replacement/repair/leak`) or the *Sealed-system work* flag. Same regex in the field tool, the office and `labor.py`; tests
on both sides.

## 9. Security, roles, audit
Internal network / VPN or authenticated hosting only; production server (waitress/IIS), not Flask dev. ⟨9/18⟩ Roles are a permission matrix rather than a sentence (Phase 0 `auth.ROLE_PERMISSIONS`; tables `app_user` / `app_permission` in §1.2; Agility `app_users` + `user_page_permissions` / `permission_groups`, doc 12 §People). A **signed-in-as** switcher in the prototype — Demitrius · dispatcher, Mark Perks · manager, Cayden Mayfield · owner — drives what each screen allows.

| role | permissions |
|---|---|
| owner, manager | `roster.retire`, `zones.publish`, `settings.edit`, `test_bench`, plus everything below |
| dispatcher | `routes.edit`, `tech.route_settings`, `zones.draft` |
| csr | `jobs.book` |
| parts | `parts.verify` |
| tech | none — own route and jobs only |
| customer | signed link scope only |

Two gates in particular. **Retire** (route settings drawer, §4.1f) needs `roster.retire` and a type-RETIRE-to-confirm step — Cayden: *too easy for a dispatcher to do by accident*; a dispatcher sees a locked chip saying who can. **Publish zones** (§4.4b) needs `zones.publish`, because it changes where every new call goes; dispatchers draft. Not yet in the seeded matrix: Noell's work — quote review, payment review, the sync queue, the estimate hand-off (the old **CX** role) — Cayden to say whether that is `manager` or a role of its own. Every write is in `audit_log`. PII (names, addresses, phones) is displayed by role; the field tool shows only today's route. Signed tracker links expire 90 days after `closed_at`. Stripe PANs never touch the dashboard (SetupIntent/PaymentIntent only). Photos in private object storage; URLs signed.

---

## 10. Build order and acceptance (Phase 0–1, then 2–3)

**Phase 0 — Foundation (start now)**
1. Schema (§1) + settings seeded (§11) + roster/zone/zip seeds from `reference/`.
2. DT + ExportInvoice importers with `import_batch` idempotency; jobs created/updated per §3.4. *Accept:* re-import same file = 0 changes; 236 SV orders from the sample file load with zone, lat/lng, status; ExportInvoice adds the 657 open tickets.
3. Status engine as a single transition function with the table in §2 as data; `status_history` written on every change. *Accept:* every row in §2 has a unit test; a manual change without `reason_code` is rejected.
4. Sync queue screen (prototype `office.html` tab 4): packets, Keyed, auto-confirm from import, discrepancy + reverse discrepancy. *Accept:* key a status in ePASS → item confirms on next import without human action.
5. Service Order Health rewired to import tables; Stuck Jobs panel.

**Phase 0.5 — Search, history and KPIs off the mirror** ⟨9/11⟩ (the office asked for these first and none of them needs a tech or a customer to change anything)
5a. Back-fill closed jobs: importer for the completed-invoice exports (`reference/data/completed2026_COD.xlsx` shape and an OE-23 pull) so history exists from day one; `job.closed_at`, `delivered(source='epass')`. *Accept:* the 2,303 billed 2026 SV invoices load with tech, dates, labor, parts and parts cost.
5b. `GET /search` + customer / unit history pages (§7). *Accept:* any office user finds a customer by last name, phone or serial in one box in under a second and sees every prior call and what was done.
5c. Recall detection on import + Recalls queue; `kpi_daily` and the KPI page (§3.7) with recalls, turnaround, calls per day, diag-only rate. *Accept:* recall candidates from the last 90 days of imports are listed with the original job and tech.
5d. Delivered dollars from ePASS actuals (§5.6 reconciliation half) and the Productivity drawer — office side only until the field tool exists.

**Phase 1 — Customer visibility**
6. Tracker (`/public/track`, signed links) with 9 stages mapped from status (blueprint §4 table). Notifications §6 wired to Podium with templates in settings. *Accept:* changing a status in the dashboard (or via import) sends the right template once, logged with provider id.

**Phase 2 — Quote automation**
7. Field tool (`field_tool.html` flows) → findings → SO2; parts verify queue; quote built from lines; auto-send; approve → SO3; requote rule; field quote + signature; billing rules §5.5 with Stripe off-session; catalog tables and ePASS export generator. ⟨9/11⟩ Error-code prompt, Half/Full-day labor chips, Custom note; live delivered-dollars strip (provisional side of §5.6).

**Phase 3 — Parts pipeline**
8. Parts order (PO builder, supplier export), receiving (scan → SO5/SO6 auto-confirm), ETA propagation, SO4B/SO4H. ⟨9/11⟩ Rules 22a/22b (T−2 Kezia check, T−1 release with apology text) and 24a (SO4H *My part arrived* → SO5).

**Phase 4–6** per blueprint §11: ledger + slot offering + intake step 2; board with drag/drop, shop touch, trips, profitability guard; install self-scheduling; auto-charge. ⟨9/11⟩ Board items land in Phase 4/5: `work_days` + open/close day + PTO ranges + capacity adjust + Force it (with the ledger, Phase 4), tech route overview, map toggles, calendar picker, route blocks, column money footers and Productivity drawer (Phase 5). **Phase 7** NetSuite: replace `sync_item` apply with API calls; keep discrepancy engine.

---

## 11. Tunables (settings table) — defaults

| key | default | used in |
|---|---|---|
| `window.am` / `window.pm` | 08:00–12:00 / 12:00–17:00 | §4.1 |
| `capacity.buffer_min` | 25 | §4.2 |
| `booking.horizon_business_days` | 10 | §4.3 |
| `booking.max_offers` | 7 | §4.3 |
| `booking.reschedule_cutoff_hours` | 48 | §4.6 |
| `duration.defaults` (json) | diag_appliance 60, diag_hvac 90, diag_builtin_refrig 75, multi_unit_add 30, sealed_factor 1.25 | §4.1 |
| `duration.min_samples_to_learn` | 20 | §4.1 |
| `speed_factor.clamp` | 0.7–1.4 | §4.1 |
| `owed.approval_rate_default` | 0.67 | §4.2 |
| `trip.min_minutes` | 240 | §4.4 |
| `trip.max_age_business_days` | 5 | §4.4 |
| `trip.so5_max_age_days` | 3 | §4.4 |
| `shop_touch.minutes` | 10 | §4.5 |
| `shop_touch.wave_detour_min` | 10 | §4.5 |
| `route.drive_per_stop_guard_min` | 35 (inter-stop legs only) | §4.7 |
| `trip.max_auto_per_week` | 2 | §4.4 |
| `duration.learn_after_days` | 28 | §4.1 — keep seeds for the first four weeks |
| `route.single_stop_marginal_drive_min` | 60 | §4.7 |
| `route.optimise_time` | 18:00 | §4.7 |
| `parts.backorder_days` | 10 | §2 #20 |
| `parts.eta_delay_notify_days` | 2 | §2 #22 |
| `parts.verified_fresh_days` | 7 | verify queue |
| `parts.stale_price_days` | 30 | field tool |
| `requote.pct` / `requote.min_dollars` | 0.10 / 10 | §5.7 |
| `quote.reminders` | 48h, 5d; call task 10d; SO7 at 14d | §2 |
| `fee.diagnostic` | 169.95 | §5.5 |
| `tax.rate` | 0.0825 | §5.2 |
| `rate.appliance` / `rate.hvac` | 130 / 150 | §5.1 |
| `payment.retry_hours` | 24, 72 | §5.5 |
| `stuck.*` | per §2 aging list | Stuck Jobs |
| `notify.quiet_period_days` | 7 | §6 |
| `link.expiry_days_after_close` | 90 | §9 |
| `tech.work_days_default` ⟨9/11⟩ | Mon–Fri (JRC Mon–Thu in roster) | §4.1 |
| `capacity.force_allowed_roles` ⟨9/11⟩ | dispatcher, manager | §4.1 |
| `recall.window_days` ⟨9/11⟩ | 30 | §2 recall detection |
| `recall.unreviewed_counts_after_days` ⟨9/11⟩ | 7 | §3.7 |
| `hold.check_business_days_before` / `hold.release_business_days_before` ⟨9/11⟩ | 2 / 1 (14:00) | §2 #22a/#22b |
| `pay.weekly_target.<sp>` ⟨9/11⟩ | unset (falls back to 4-week average) | §5.6 |
| `pay.parts_margin_default` ⟨9/11⟩ | 0.45 (used only when no PO or catalog cost) | §5.6 |
| `pay.day_review_threshold` ⟨9/11⟩ | 2000 | §5.6 |
| `kpi.defs` (json) ⟨9/11⟩ | starter set in §3.7 | KPI page |

---

**Visit groups, nags and tech limits ⟨9/15⟩** — `group.enabled` 1 · `group.setup_min` 10 (per extra member on one arrival) · `group.suggest_same_address` 1 · `group.require_same_skill` 1 · `nag.interval_hours` 24 · `nag.working_hours_only` 1 · `nag.escalate_after` 3 · `capacity.commute_excluded` 1 · `capacity.commute_allowance_default_min` 45.

**Import ⟨9/15⟩** — `import.parking_day_rule` 1 (a route date on a day no tech works means unscheduled).

**Placement, pencil, offers, intake ⟨9/14⟩** — `placement.shift_min` 540 · `placement.drive_base_min` 4 · `placement.drive_min_per_km` 1.55 · `placement.defer_min_per_day` 8 · `placement.defer_soft_days` 2 · `placement.defer_min_per_day_late` 20 · `placement.same_zone_bonus_min` 6 · `placement.zone_secondary_penalty_min` 10 · `placement.zone_other_penalty_min` 40 · `placement.horizon_business_days` 10 · `placement.min_slack_min` 25 · `pencil.enabled` 1 · `pencil.business_days_after_eta` 2 · `pencil.move_threshold_min` 15 · `offer.route_first` 1 · `offer.hold_max_business_days` 3 ⟨9/17 pm, replaces `offer.max_defer_days` 5⟩ · `offer.horizon_business_days` 10 · `intake.match_window_days` 14 · `serve.port` 8765 · `serve.token` '' · `serve.cors_origin` *

**Labor, purchasing and the interim model ⟨9/18⟩** — `labor.zone_bands_miles` [7, 26, 47] (straight-line miles from the shop; ≤ 7 ZN1, 7–26 ZN2, 26–47 ZN3, over 47 ZN4; §5.1a) · `labor.zone_fees` {ZN1 120, ZN2 130, ZN3 140, ZN4 150, ZNADD 85} · `labor.diag_fees` {DZ1 157, DZ2 157, DZ3 179, DZ4 209} · `labor.hourly_rate` 130 (the appliance rate; `rate.hvac` above stays 150) · `purchasing.enabled` 0 (Parts order, PO builder, supplier sheets, Receiving, bin scanning and the T−2 receiving task hidden; §5.8) · `notify.part_arrived_pick_time.auto` 0 (the part-arrived text is sent by a click unless this is on; §5.8) · ⟨9/18 pm⟩ `billing.diag_on_nla` `charge` (what happens to the diagnostic when the part turns out to be discontinued: `charge` | `waive` | `credit`; the office overrides it per call in one logged click, §5.3) · `pricing.diag_fee` 169.95 (what the customer sees; DZ1 $157 + 8.25% tax) · ⟨9/18 late⟩ `tracker.link_expiry_days` 90 (how long a tracker link keeps working after the job closes — housekeeping, not security; §6b) · `tracker.email_link_limit_per_hour` 3 (customer-initiated *email me the link* sends per job per hour) · ⟨9/19⟩ `quoting.field_quote_enabled` 0 (the at-the-door quote with signature — off until a distributor price feed exists, §8a, item 46) · `labor.time_options` [0.5, 1, 1.5, 2, 3, 4, 8] (what the tech picks from; the book's own hours are never shown) · `labor.wty_cod_brands` [True, Scotsman, Zephyr, BlueStar] (warranty brands paying the COD rate; every other brand is a flat rate the warranty admin adds) · `labor.allow_tech_override` 1 (the tech may move the labor total; logged and reported, never blocked).

## 12. Open items for the dev to confirm with Cayden

**52. La Cornue and AGA, and three missing sealed rates.** The 9/19 card prices both at $150; the ePASS history prices
La Cornue at $702.50 over 18 tickets in 2025–26 and AGA at $314 over 5. Both are low-volume Middleby lines, so the
history may include something the rate does not — but the gap is too large to quote through. Separately, no sealed-system
rate was given for **DCS, Hotpoint or Amana**; they are left blank rather than inferred (Amana sits with Whirlpool at
$113.68 standard, so $237.74 is the obvious guess, but Cayden named four brands for that rate and Amana was not one).
⟨9/19 pm⟩

**53. Six "ZIPs" that are not places.** Of the 47 unmapped ZIPs worked since 2025, six are billing addresses, not
service areas: 75006 is MILESTONE (a builder, 17 calls), 91403 is NEW ORLEANS TRUST (9), 98103 is DOWBUILT (2), 77429 is
LG warranty. The appliance was never in Dallas or Seattle — this is the payer's ZIP leaking into a routing question
(§1.4). They are marked `billing:1` and never zoned. Worth confirming that the intake form is capturing a *service*
address separately from the account address in every one of these cases, because if it is not, the same thing will keep
happening. ⟨9/19 pm⟩

**54. The landlord case on a household link.** One link per household (Cayden, 9/19 pm: *"we will cross the land lord
situation when we get there"*). Named here so it is not forgotten: a tenant holding a household link sees the landlord's
other calls at that address. The fix when it bites is a per-job link for jobs whose contact is a `visit_only` contact —
the data model already carries that flag (§1.2 `job_contact.visit_only`). ⟨9/19 pm⟩

~~**49. Is S&H taxed?**~~ **Answered 9/19 pm** — yes, code `FREIGHT`, default $20, office-only, none on warranty (§5.3a).

**49 (was). Is S&H taxed?** §5.2 says parts and S&H are always taxable; the build does not tax S&H, which nobody noticed at a
flat $25. Now that Kezia can set freight (§5.3a) it is real money. Wilson's accountant to confirm, because changing it
changes every historical comparison. ⟨9/19⟩

**55. Corrections and the interim.** ⟨9/19 late⟩ §6c lets any office role edit a ticket's customer, unit and notes, logged
and packeted to ePASS. Two things to confirm: (a) is *any office role* right, or should customer-record changes (name,
phone) be Client Care's and unit changes anyone's; (b) until NetSuite, who keys the correction packets into ePASS and how
quickly — the packet is on the sync queue with the others, but a name fix that sits unkeyed for a week means two systems
disagree about who the customer is. The safest default is "same day, same person who made the change".

**50. Who may close a call out, and does a cancelled ticket need a reason code in ePASS?** The board currently lets any
signed-in role do it and writes our own reason to `cancel_reason`. If ePASS SO9 wants one of its own codes, we should map
them rather than free-text. ⟨9/19⟩

**51. Damage reports: who converts them, and is there ever a charge?** The prototype lets the office create the service
order and Mark add the part. Two questions behind it: should the conversion be Mark's alone (he is the one who knows
whether it is ours), and does a damage repair ever bill anyone — the manufacturer, a freight claim — or is it always
Wilson's cost? The build assumes always ours, no estimate, no customer charge. ⟨9/19⟩

1. ePASS DT export widened to all SV statuses? (changes §3.1; removes ExportInvoice dependency)
2. Labor itemised or single line on the customer quote page (setting).
3. Podium: template approval / A2P registration status for automated sends.
4. Stripe: confirm off-session charging is enabled on the saved SetupIntents (`usage=off_session`).
5. Supplier order-sheet formats (Marcone, Reliable, Encompass, Sub-Zero, Miele) for the PO export.
6. Rate-book family codes ID, OD, DI, VA, JB.
7. Hosting: where the dashboard runs today and whether the DT share is reachable from it (else the importer runs on the WilsonRouting box and posts to the API).
8. ⟨9/11⟩ Weekly delivered-dollar target per tech (`pay.weekly_target.<sp>`), or confirm "show pace against own 4-week average" is enough.
9. ⟨9/11⟩ A cost feed for parts before the PO builder exists: can ePASS schedule the OE-23 (or an invoice-line export with *Serial Cost*) nightly like the DispatchTrack file? Without it the office reconciliation uses `Total` only and parts profit stays estimated until Phase 3.
10. ⟨9/11⟩ Confirm roles: Kezia = parts/receiving (owner of the T−2 ETA check); who "DAH" is for the open-day approvals (the control itself is dispatcher-level).
11. ⟨9/11⟩ Whether techs should see their recall rate in the field tool (default: managers only).
12. ⟨9/14⟩ The live queue's request id and photo URLs: confirm the field names the button will post (§14.2) and whether photos can be fetched by URL from the dashboard host.
14. ⟨9/15⟩ Visit groups: confirm the customer-facing promise — do we tell a customer with two units that both are done in one visit before both parts are in, or only once they are? (The rule as written waits, and splits on the office's say-so.)
15. ~~⟨9/15⟩ One charge per visit: confirm Noell is happy reconciling one Stripe payment against several ePASS tickets.~~ **Closed 9/15 pm** — Cayden: "Noell signs off on all charges in our current model… she's the one that punches in the payments." So one charge per visit is the same approval she already performs, once instead of three times. §5.5 stands; the allocation table is what she reconciles against, and the receipt itemises by unit.
16. ~~⟨9/15⟩ `commute_allowance_min` for Connor and John.~~ **Closed 9/15 pm** — Connor's commute is about an hour each way, so `commute_allowance_min.CEM = 60` (his Tuesday reads 134% rather than 140%; the rest of that day is the Cherokee round trip, which is real). John no longer has a route day to charge commute against — he is a collector lane, §4.1c.
17. ~~⟨9/15 pm⟩ The collector lane's escalation threshold.~~ **Closed 9/15 late** — Cayden: 30 days. That puts 31 of John's 42 over the line on day one, which is the point.
18. ⟨9/15 pm⟩ Parts issued to John: does anything today record which parts leave the shop with him? If a paper pick list exists, the *Took the part* tap should mirror it rather than replace it.
19. ⟨9/15 late⟩ **Who runs the west trip?** Routing Fredericksburg normally needs a routed tech owning FBURG / BLANC / JC / BOERN / STONE, because the zone table points all five at JHM today. DLA is already the listed secondary on three of them and CEM on Boerne. Options: name one tech as the west trip owner (like TDP on Horseshoe Bay), rotate it, or let the engine pick the best-fit routed tech each time a trip opens. This is the one thing blocking "a west route that can be auto scheduled".
20. ⟨9/15 late⟩ Podium A2P: John's number is already *Transactional only* in the Wilson Appliance Main inbox and the office texts him by hand today, so the hand-off is the same message on the same channel — but confirm an **API-originated** send to a staff contact needs no separate approval before `lane.handoff_enabled` goes on in production.
21. ⟨9/15 late⟩ Reading John's Podium replies back into the job (§4.1d). His text thread is where his notes actually live. Worth building — but as its own piece of work, not bolted onto the hand-off button.
22. ⟨9/15 late⟩ Will NetSuite hold **service history** as well as customers and billing, or does the dashboard stay the system of record for service? Cayden 9/15: not decided. §1.5 is built so either answer works, but the export path is only worth writing once we know.
23. ⟨9/15 late⟩ What does a NetSuite customer id look like, and will the migration carry the ePASS code across? If it does, `external_ref` needs nothing; if it does not, the address+surname resolution in §1.4 has to run again on the NetSuite side.
24. ⟨9/15 late⟩ The 1,062 catalogue tickets still in an open status (782 SO1, 193 SO2, 65 SO6, 15 SO5, 7 SO4), the oldest going back years. Close them in bulk, or work them? They are not in the live export, so nobody is looking at them today.
25. ⟨9/15 late⟩ Item 32's pricing against the built-in labour tax exemption — $157 + 8.25% = $169.95 matches the standing diag fee, but if labour is tax-exempt on built-in work the in-field figure differs for exactly those jobs.
26. ⟨9/15 late⟩ Items 37 and 38 are the same day from opposite ends: what happens to a locked, already-promised day when a tech calls in? Who may unlock, and what does the customer hear?
28. ⟨9/16⟩ The measured zone table (§4.4a): sign-off on moving LOST from TDP to AJH, and on the nine zones — including the two busiest, DS and LOCAL — becoming *shared* with no primary at all. `reference/zone_table_measured.csv` has the numbers beside the current values.
29. ⟨9/16⟩ Tech lifecycle ⟨answered in part 9/16⟩: manage the current eleven only; SAW, MWH and MJI have left; JKO and EHM are office staff whose tickets are counter sales. Still needed for the tech admin screen (item 40) — the full active list with SP codes, so the other 102 historical codes can be marked `historical` (they resolve on old tickets, never appear in a dropdown).
30. ⟨9/17⟩ **DNS on a previous occupant.** Rule 1.4h shows a do-not-service note on a *different* name at
    the same address only inside the drawer, in passing. Is that the right weight, or should it be
    invisible / a banner? One address on today's board is in this position.
31. ⟨9/17⟩ **Street suffix variants.** "1509 PALOMINO RIDGE" and "1509 PALOMINO RIDGE DR" are two
    `household_key`s (Damion Levy sits outside the four-account house). Fold the suffix out of the key
    (risk: OAK ST and OAK DR in one ZIP) or leave it and let the address view show "nearby: same number,
    same street name"? Prototype leaves it.
32. ⟨9/17⟩ **Stop sequence source.** The invoice export has no sequence; 9/17–18 order came from
    screenshots. Can the ODBC export include ePASS's routing table (sequence + the comment rows), or
    does Agility take order from DispatchTrack only?
33. ⟨9/17⟩ **Model family rules.** The Bosch handle rule is confirmed; are there others the techs already
    know (Sub-Zero 600/700 series suffixes, Whirlpool colour codes, Miele /xx)? Each becomes one row in
    `model_family_rule`.
27. ~~⟨9/15 late⟩ Sales history.~~ **Closed 9/17** — it arrived in the ODBC export; 49% of assets now carry purchase date, price and invoice (§1.6).
27b. ⟨9/15 late⟩ (original note) Sales history, when Cayden has it: it would link model/serial to the account at purchase and give `asset.purchased_from_us` and `purchase_date`, which the repair-vs-replace rule and the warranty check both want.
13. ~~⟨9/14⟩ Tech start/end points for the drive model (home vs shop per `tech_roster`): Phase 0 scores from the shop for everyone; the board prototype already uses home/shop.~~ **Closed 9/18** — `placement.route_endpoints(db, tech, date)` gives Phase 0 the day's endpoints from the pattern and the tech default (§4.1f).
34. ⟨9/18⟩ **Straight-line or drive miles for the zone band.** The 7/26/47 bands (§5.1a) were fitted on
    straight-line miles from the shop. Agility has geocodes and can use drive distance, which is closer
    to what the fee is for — but the bands would need refitting against the same 3,807 tickets before
    they are trusted.
35. ⟨9/18⟩ **Where the bands and ePASS disagree.** 81% agreement leaves about one ticket in five where
    ePASS's own zone assignment and the distance band differ. Which wins — the band, with per-ZIP
    overrides like 78701 where the office knows better, or ePASS's assignment as the rule and the band
    as the suggestion?
36. ⟨9/18⟩ **ZCTA outlines and the shared-centroid ZIPs.** Census TIGER ZCTA5 2020, clipped to the ~150
    ZIPs served, is the proposed source for the zone map's cells (§4.4b). Confirm the source, and note
    that 78717 / 78727 / 78753 / 78756 / 78759 / 78747 (and others) share one centroid in our table
    today, so until the outlines exist they are assigned from a list rather than the map.
37. ⟨9/18⟩ **Who publishes zones day to day.** `zones.publish` is owner/manager; dispatchers draft. Is
    that Mark, Cayden, or both — and should Demitrius have it, given he is the one who knows where the
    trucks actually go?
38. ⟨9/18⟩ **Kezia's ETA as a date or a bucket.** Verify asks for an expected date per part. The estimate
    module shows a range (*In stock · Tue, Sep 22 – Fri, Sep 25*) and the pencil (§4.3a) counts business
    days from a date. One date, or in stock / 2–3 d / 5–7 d / backorder as `quote_line.availability`
    already allows?
39. ⟨9/18⟩ **When Noell keys the lines relative to Kezia ordering.** §5.8 step 4 has Noell adding the
    approved lines and SO3 before Kezia orders in step 5. If Kezia orders from the approved estimate
    first, the ticket carries SO4 before its lines exist in ePASS. Confirm the order of operations
    between the two of them, or whether it matters.
40. ⟨9/18⟩ **Repainting a ZIP keeps the old primary as a secondary.** The editor does this so no ZIP
    loses coverage; it also means secondaries accumulate until someone Shift-clicks them off. Keep it,
    or ask on each repaint?
41. ~~⟨9/18 pm⟩ **The diagnostic fee when a part is discontinued.**~~ **Answered 9/18 pm** — it stands as
    standard, and the office may waive it in one click while moving the customer to the showroom; both are
    logged and both ride on the SO7 packet (§5.3). Still open, and smaller: **is the *credit toward a
    replacement* option policy?** It is built and labelled as a proposal — billed now, credited in full
    against a showroom purchase — and would keep the fee and the goodwill on the 24% of these customers
    who buy from us inside 90 days. Say the word and the label comes off.
42. ⟨9/18 pm⟩ **Which of the "served before, not on the map" ZIPs belong in the service area?** The
    history shows 26 ZIPs worked since 2025 that the zone table never had (§4.4b) — 78741 with 29
    tickets since 2025, 78652 with 12, 78726 with 11, San Antonio 78209 with 9 … Add them and give
    them primaries, or are some of them one-off trips that should stay "we'll call you"? Also: 78637 is
    on 23 tickets but is not a ZIP we can place — a keying habit to look at.
43. ⟨9/18 late⟩ **Should the tracker link also go on the invoice and the receipt?** It is on every text
    and email today. Putting it on the paper the tech leaves behind costs nothing and catches the
    customer who deletes texts — but it also means the link outlives the phone it was sent to.
44. ⟨9/18 late⟩ **One link per job, or one per household?** Per job is what is built, and it is the
    honest unit — a link scoped to a household would show a tenant the landlord's other calls, and show
    a new owner the previous owner's. But a repeat customer then collects links. A signed-in customer
    account is the real answer and is a long way past Phase 1; is per-job good enough until then?
45. ⟨9/18 late⟩ **The measure for the confirmation page.** Proposed: the share of jobs whose customer
    opens the link on a *different day* from the one they booked (§6b). Worth reporting monthly next to
    the KPI page, or is inbound "where's my repair?" call volume the number you actually care about?
46. ⟨9/19⟩ **Turning field quoting back on: the Marcone feed.** Cayden asked for suggestions. ePASS
    already ships a **Marcone integration** returning live part number, description, dealer/retail/list
    price, warehouse and quantity available, plus a status flag that includes **discontinued** — the same
    signal §5.3's parts-unavailable notice needs, arriving from the supplier instead of from Kezia
    noticing. It needs Marcone to enable B2B web services on the Wilson account; credentials then go in
    the Item Inventory variables under the integration tab, with per-user security flags. Two things to
    settle: (a) it is *ePASS's* integration, so reaching it from Agility means either ePASS exposing it or
    Wilson holding its own Marcone B2B credentials and calling the service directly — one call to Marcone
    establishes which; (b) it is one supplier, so Reliable and Encompass stay manual and Kezia's verify
    step shortens rather than disappears. Worth settling before anything is built.
47. ⟨9/19⟩ **The warranty flat rates are not in the rate book.** Every one of the 13,646 rows in the
    2025.6.21 book is `Warranty = N` / `Flat Rate = Y`; the only warranty entries are two Trane
    extended-warranty lines. The real rates exist only as history — `WTY1-SPEED` $153.78, `WTYSZ-SZ`
    $170.31, `WTYWOLF-WOLF` $171.83, `WTYGE-GE` $122.58, `WTYBSH-BOSCH` $116.51, `WTYWP-KA` $110.01 and
    about thirty more, averaged over 2024–26 tickets. A current rate card per manufacturer is needed
    before the tool can put a number on a warranty job; until then it shows nothing rather than a guess.
    Also confirm the COD-rate list is exactly True, Scotsman, Zephyr and BlueStar.
48. ⟨9/19⟩ **Manual labor lines are a signal.** A description typed in often enough is a line the book is
    missing. Worth a monthly list of the most-typed manual lines for Mark to fold into the catalog?

---

## 13. Service team feedback from the 9/11 demo — where each item landed ⟨9/11⟩

| # | They asked for | What it became | Where | Phase |
|---|---|---|---|---|
| 1 | Search customer names in the service dashboard | One search box: name, phone, SV, serial, model, address; results open the job or the customer history | §7 `/search`, §1.3 index | 0.5 |
| 2 | Click a tech's name → explicit overview of their route | Tech route overview page from any tech name (header, fill strip, map legend) | §4.8, §7 `/board/tech-day` | 5 (prototype now) |
| 3 | Auto-track recalls as a KPI; call turnaround; calls per day; more later | Recall detection on every new job (same unit ≤ 30 d) + Recalls queue; KPI page driven by `kpi.defs` so metrics can change without code | §2 recall detection, §3.7, `recall`, `kpi_daily` | 0.5 |
| 4 | Map: turn one technician on/off | Legend chips per tech, persisted per user | §4.8 | 5 (prototype now) |
| 5 | Open Josh's Friday when it's generally closed | `tech.work_days` (JRC Mon–Thu) + **Open day** on the fill strip; closed by default, one click to open | §1.2 tech/tech_day, §4.1 | 4 (prototype now) |
| 6 | Full calendar instead of a day-of-week dropdown | Month calendar tinted by fill %, closed days hatched, trips marked | §4.8 | 5 (prototype now) |
| 7 | Time blocks that aren't a call (haircut, van maintenance) | `route_block`: grey card on board and field tool, counts against capacity, never synced to ePASS | §1.2, §4.2, §4.8 | 5 (prototype now) |
| 8 | Live daily revenue on the tech's route sheet; parts profit + labor; pace for the week | Delivered dollars = labor (incl. diag/zone) + parts profit (0 on warranty), matching OE-23; provisional at completion, reconciled nightly; header strip with week pace vs target or own average | §5.6, §7 `/tech/revenue` | 2 (field), 0.5 (actuals) |
| 9 | Office sees revenue per route per day and department totals | Column footers + Productivity drawer | §4.8, §7 `/revenue/*` | 0.5 / 5 |
| 10 | Customer / serial search to find previous calls and repairs | Customer and unit history pages, back-filled from 2026 closed invoices | §7 history, §10 Phase 0.5 | 0.5 |
| 11 | Two-day-out auto-confirm: part not here → ping Kezia for ETA, "time out", apology text to re-pick | Rules 22a (T−2 task to Kezia with Part-here / New-ETA / Wait) and 22b (T−1 release → SO4, apology + picker) | §2 #22a/#22b, §6 `hold_released_apology` | 3 |
| 12 | SO4H (GE ships direct): customer button to schedule when the part arrives | Rule 24a `customer.part_received` → SO5 → picker; check-in text at ETA+1 | §2 #24a, §6 `so4h_check_in`, §7 `/part-received` | 3 (tracker copy now) |
| 13 | Error code selected → prompt for the code | Required `error_code` field when the symptom chip is tapped | §1.2 findings, §2 guards, §8 | 2 (prototype now) |
| 14 | Quick half-day / all-day labor (sealed system) | `LAB-HALF` 4 h / `LAB-FULL` 8 h chips; sets install duration 240/480 | §5.1, §1.2 findings.labor_block | 2 (prototype now) |
| 15 | "What you found" needs a box to type when the options don't fit | *Custom note* button reveals a text box; stays on the dashboard, ≤ 200 chars ever reach ePASS | §1.2 findings.custom_note, §8 | 2 (prototype now) |
| 16 | (Cayden) Capacity must be quick to change from the capacity dashboard: force an extra call, block PTO days | Fill-strip popover: Close day / Open day / ±60 min / +1 stop / Add block; range PTO; **Force it** on an over-capacity drop, no reason code, logged | §4.1, §4.2, §4.8 | 4 (prototype now) |
| 17 ⟨9/14⟩ | Field tool, parts needed: keep the component buttons, but the tech keys the part number — stop auto-populating any part number | Component chips (Drain pump, Evaporator fan…) add a line with an **empty part-number field** the tech must fill (UNKNOWN + note allowed); field quote lines take an optional price, else *TBD — office prices before ordering*. No catalog number or price is ever pre-filled | §5.4, §8, field tool prototype | 2 (prototype now) |
| 18 ⟨9/14⟩ | Once Kezia sets the ETA and the customer has approved (SO4), auto-sort the call onto a day ~2 business days after the part lands, geographically with the SO1/SO6s already there, block the time, and make that the first date the customer sees | The **SO4 auto-pencil** — dashboard-only soft hold on the best-fit day, moves with the ETA, re-scored per import, first offer on SO5 | §4.3a, `placement.pencil`, `job.penciled_*` | 0 (code now) / 4 (board) |
| 19 ⟨9/14⟩ | Offer customers the dates most advantageous to our routes (a Round Rock request gets the Round Rock day first) | Same placement score orders the picker: best fit within 5 days first, labelled; earliest always visible. Not too much for now — it is the same function as #18 with a different label | §4.3, `placement.offer`, `offer.route_first` | 0 (code now) / 1 (picker) |
| 20 ⟨9/15⟩ | "Modify contact info" on a call — add a number for whoever will actually be home | `job_contact` rows per job or visit (name, phone, role, `notify`, `visit_only`); the importers seed ePASS Phone1/2/3 as `account`, the office adds an `on_site` number without editing the customer record, and **every Podium send goes to the `notify=1` contacts** | §1.2 `job_contact`, §6 | 1 |
| 21 ⟨9/15⟩ | Combine calls at the same house; stop each SO4/SO5 being scheduled for a different day; charge the same-day SO8s as one lump sum | The **visit group**: one arrival at one address as the scheduling, capacity *and* billing unit. Booking a member books every ready member; an unready member cannot take a different date, it waits for the group's next visit; the group's pencil follows the **latest** part ETA; completion raises one payment with a per-SV allocation in the ePASS packet. 24% of open tickets qualify, and seven addresses are already split across days | §4.9, §5.5, §1.2 `visit_group` | 2 (grouping + scheduling) / 6 (one charge) |
| 22 ⟨9/15⟩ | Research tickets should bug the tech nonstop, if we give them that option | Rule 38: a research ticket raises a card on the tech's **My Notifications** and re-raises it every `nag.interval_hours` in that tech's working hours until they submit, escalating to the service manager after `nag.escalate_after` rounds | §2 #38, §8 | 2 |
| 23 ⟨9/15⟩ | A menu for tech preferences and limits — Connor and Trevor read well over 100% all week | Two things: the fill bar was counting a home-start tech's **commute** as route time (19 of 38 tech-days over 100% → 9 once the first and last legs come out), and a per-tech settings screen for work days, shift, max stops, max on-site minutes, max inter-stop drive, commute allowance and overflow. What stays over is on-site minutes, not driving | §4.1a, §4.2, §4.3 | 4 (settings) / 5 (bar) |
| 24 ⟨9/15⟩ | Show Units on each job on the dispatch board | `units` is already real in both exports (69 of 443 tickets carry more than one, up to eight) and already drives duration; surface it as a chip on the card and in the tech's stop list | §4.8, §8 | 5 (prototype now) |
| 25 ⟨9/15⟩ | When a tech hasn't updated notes and the call can't advance, the office needs a marker that puts it back on the tech's notifications | Rule 36: **Needs tech input** with a one-line prompt, pinned to the top of that tech's My Notifications, cleared only by the tech's own submission (rule 37), nagging on the same schedule as #22 | §2 #36–38, §8 | 2 |

### 13b. Service team feedback from the 9/15 testing round ⟨9/15 late⟩

Cayden's own context notes are folded in. **Effort** is the same 1–5 scale; **⚑** marks the ones he called cheap, which go in the fast pass.

| # | The team said | What it becomes | Where | Effort |
|---|---|---|---|---|
| 26 ⚑ | "This time frame for the part is for today only, parts availability is subject to change" on quotes | A **disclaimer block** on the quote, not a hard-coded string: `settings['quote.disclaimers']` is an ordered list of `{key, text, applies_to}`, rendered under the total and stored on the quote row at send time so a reprint shows what the customer actually saw. Ships with the parts-timeframe line and an empty custom slot (item 34) | §5, new `quote.disclaimer_json` | 1 |
| 27 ⚑ | Flag research SO1s that were "rescheduled" on the field tool for research | The field tool's *Needs research / call back* outcome already keeps the job at SO1. It now also sets `needs_tech_input` with `reason='research'` — so it lands in that tech's My Notifications and nags daily (rules 36–38), escalating to Mark after `nag.escalate_rounds`. Cayden: "these need to land in techs my notifications and be annoying" | §2 #36–38 | 1 |
| 28 | Customer called under warranty but it is not a warranty issue (filter change, customer education) — we need a billing sign-off in the field | New field-tool outcome **Not a warranty repair**. The tech picks the reason (education / maintenance / no fault found / out of warranty), the app shows the customer the price *before* anything is charged, and the customer signs. Only then does the job flip `is_warranty=0`, payer moves from the manufacturer to the household (§1.4), and the diag/labour is billed. Without the signature it does not flip — a warranty call silently becoming a COD charge is the one failure mode here | §2 new rule 39, §5, §1.4 payer | 3 |
| 29 | Customer wants a quote before any diagnostic | **SO2 from cold.** A new intake path creates the job directly at `SO2` with no visit: office builds the quote from the rate book, sends it, and the existing approval flow runs. On approval it goes to `SO3` and is scheduled as an install, never a diagnostic. Needs a `quote.kind='cold'` alongside `field`/`office` because the requote rule (§5.7) has to be stricter when nobody has seen the machine | §5, §2 | 3 |
| 30 ⚑ | Weekly or biweekly backorder update to the customer through Podium | `notify:backorder_still_waiting`, fired by a timer on any `SO4*` whose `parts_eta` is null or in the past, every `notify.backorder_every_days` (7). Stops on ETA change (that sends `parts_delay` instead), on receipt, and after `notify.backorder_max_rounds` (6) — at which point it becomes an office task, because the eleventh "still waiting" text is worse than a phone call | §6 | 1 |
| 31 | Two techs on one call | **Add to route.** One control that puts an existing call on a second tech's board as a *mirror* (same SV, both boards, one completion, capacity counted on both), or adds a non-call block (oil change, haircut, van maintenance) — the manual blocks live here too, which is where the team expected to find them. The mirror needs `job_assignment(job_id, tech_id, role primary/second)` because `assigned_tech_id` cannot hold two | §4, new `job_assignment` | 4 |
| 32 | Generate or split tickets in the field when the customer wants more appliances looked at | Tech taps **Add an appliance**, picks **in warranty / full diag / additional diag**, and that choice sets the price: **$157 + tax first billed appliance, $85 + tax each additional** (which is exactly the $169.95 diag fee already in §5 — 157 × 1.0825 = 169.95 — so the numbers already agree). Customer signs on the spot; no signature, no ticket. If the visit is a warranty call and the customer never agreed to a diag charge at intake, the new ticket is COD and needs the signature; if it is already COD, the extra is `ZNADD`. The new SV is created in the dashboard and goes to the ePASS sync queue like any other | §1.2, §5, §8 field tool | 4 |
| 33 | Install damage pings MAP/JKO to add parts; need to create a ticket straight to SO3 | The installer's damage form (photo + unit) raises a **notification to Jack and Mark**, not a ticket. They add the part; completing that notification creates the job **directly at SO3** with `is_warranty=1` and no approval step (it is warranty), and it lands on Kezia's SO3 order report. The only new machinery is a status entry point at SO3 and the two-step hand-off, both of which exist | §2, §8 | 3 |
| 34 ⚑ | Hidden, non-customer-facing notes like the ePASS Notepad, reachable from office **and** tech views | `audit_log` + `status_history` already record every field change with user and timestamp — the ePASS Notepad is exactly that plus free text. So: an **Activity** panel on every job showing system changes and typed notes interleaved, filterable, with an **Add note** box writing `audit_log(action='note')`. Cayden's screenshot shows the shape: date, time, note, user, type (note / sys). Visible to office and tech; never to the customer | §1.2 `audit_log`, §8 | 2 |
| 35 ⚑ | A disclaimer field on quotes | Same mechanism as #26 — one free-text slot per quote, saved with it | §5 | 1 |
| 36 | What is the unique customer identifier? | **The ePASS customer account number**, which is the phone number — confirmed against the real files at a 98.9% join. Held as an `external_ref` row, never as a foreign key, so NetSuite can take over (§1.4, §1.5) | §1.4–1.5 | — |
| 37 | Tech calls in — reroute the day and handle customer notification | One action on the fill strip: close the day (already there), then **re-place today's stops** — the placement engine runs against the remaining techs, the dispatcher accepts or edits, and every moved customer gets `reschedule_needed` in one batch. Interacts with #38: a day already confirmed is locked, so moving those stops needs an explicit unlock and tells the dispatcher how many customers were already promised a window | §4.1, §6 | 4 |
| 38 | Two days out, a **Confirm routes** button: send all notifications, lock the day, and give customers a tighter window | Confirming a day sequences it, writes `promised_window_start/end` per stop from the **routed arrival ± `confirm.window_pad_min`** (90 → a 3-hour window, which is the tightness Cayden wants), sends the confirmation to everyone except call-preference customers (who become call tasks), and sets `route_locked=1`. After that the day only changes through #37's unlock. This is the first place the dashboard makes a promise tighter than AM/PM, so it should go live on one tech first | §4, §6, `job.route_locked` | 4 |
| 39 | An SO7/SO8/WAR4 dashboard rather than notifications to Noell | A fourth office queue, **Closing**, with the three tabs: SO7 (declined — diag fee to collect, sales lead), SO8 (completed — payment to take or review), WAR4 (warranty claim to file). It is the same queue component as Parts verify / order / receiving, reading different statuses | §8 office | 2 |

| 40 | Retire techs when they leave, add new ones — "these functions need to be built in" | A **tech admin** screen: add, edit, **retire** (never delete). Retiring sets `tech.active=0` and an `ended_on` date; the tech disappears from the board, placement and the scorecard from that date, and **every historical row keeps resolving**. This matters more than it sounds: the back catalogue carries 20 years of tech codes — SAW (16,089 tickets), DTE, MWH, GMP, JJL, MV, MJI, DGH, JKO, JAD, JAC, CDK, EHM — people who have long since left, and their work has to stay readable. Adding a tech needs sp_code, aliases (KJB → KJB2 is already a live case), skills, work days, start/end, and the §4.1a capacity defaults | §1.2 `tech`, §4.1a, §8 | 2 |
| 41 | Scroll between weeks on the route/capacity board | The board's five days come from a Monday anchor rather than a fixed list, with ‹ › either side of the week label; the loaded columns follow the same weekday across the jump. Built in the prototype | §8 board | 1 |
| 42 | Set a tech's **default** capacity, not only per day | Already the shape of the §4.1a settings menu — "Connor's limits, every day, not just this one". Made explicit: `tech` carries the defaults (`shift_start`/`shift_end`, `max_stops_per_day`, `max_onsite_min`, `max_inter_stop_drive_min`, `commute_allowance_min`, `accepts_overflow`), `tech_day` carries only the exceptions, and the day controls show which of the two a value is coming from so a dispatcher can tell a default from an override | §4.1a, §1.2 | 1 |

**What the fast pass covers now:** 26, 27, 30, 34, 35, 41, 42. The rest are specified above and sized, not built.

**Two that need a decision before anyone builds them:** #32's pricing needs confirming against the tax
treatment for built-in labour (§5 notes labour is tax-exempt on some built-in work, which would make the
$157 → $169.95 arithmetic wrong for exactly those jobs), and #38's lock has to be reconciled with #37's
reroute — they are the same day from opposite ends.


---

### 13c. Cayden's 9/17 testing round — where each item landed ⟨9/17⟩

| # | Cayden said | What it becomes | Where | Done in prototype |
|---|---|---|---|---|
| 43 | New 9/17 export instead of 9/15; per-tech route screenshots — "everything below the comment 'routed' is something the tech needs to go back to and update" | Board and field tool rebuilt on the 615-ticket export; stop order from the screenshots where we have it. The divider and the tickets under it were modelled for a few hours and then **removed at Cayden's direction** (9/17 pm): clutter ePASS creates, gone once techs update in the field; tech notifications already cover "what the office needs answered" | §4.1e | ✔ (removed) |
| 55 | ⟨9/17 pm⟩ "None of the calls next week starting 9/21 appear in the route board" | Every dated week is emitted, not just the export's own; 218 stops on the board | §4.1e | ✔ |
| 57 | ⟨9/17 pm⟩ From the bench: "the customer shouldn't be given the option to go with the best fit for Wilson — they will always select the first available date. The first available date the customer can choose IS the best date for Wilson, unless it is more than 3 business days past first open capacity. Always presented as the best available date." | The offer window: calendar starts at our best slot within a 3-business-day hold, labelled "earliest available"; the words "best fit" are gone from the customer's view; hold limit is a tunable with a live control on the bench | §4.3 | ✔ |
| 56 | ⟨9/17 pm⟩ "A test-only module under the route board that creates a random call and customer, shows the schedule options the customer would see, lets us click the date as the customer, and we watch it land on the board in real time" | The **test bench** — §14.6 | §14.6 | ✔ |
| 44 | "this exact unit has been in before" has no link to the last visit | `unit.lastSv` → button opens the call | §1.6e | ✔ |
| 45 | Ort, Palomino not pulling up in history | Search reads every customer on file; groups by address; word-prefix matching | §1.4j | ✔ |
| 46 | Click the SV in "last visits" to see what we worked on; show which appliances were serviced | `call_detail` behind every SV on all three screens; unit column shows brand · model · serial | §1.6e | ✔ |
| 47 | Search history by address as much as by name — appliances don't move | Address is a first-class result and a view of its own: every account, appliance and call at the house | §1.4j | ✔ |
| 48 | Office account: can't click appliances; "unit" shows only serial | Appliance cards filter the calls; model + serial + family everywhere | §1.6e | ✔ |
| 49 | Click a tech's name for overall route settings, separate from daily controls (Diogo Thu/Fri) | Route settings drawer with weekday pattern; `tech_pattern` | §4.1f | ✔ |
| 50 | Google Maps with real roads bottom-right; expandable to full screen | Schematic / Roads / ⛶, route summary table; key server-side | §4.8a | ✔ (roads needs the key) |
| 51 | Tech marked sick → suggested days + a CSR-clicked reschedule text | Reschedule drawer: move per call, text per call, preview first | §4.6a | ✔ |
| 52 | DNS over-enthusiastic — Sammie Baird flagged on Leah Baird; check address AND last name | The address rule; DNS needs both; namesake offered, never linked; importer fallback tightened (4,264 → 1,837) | §1.4h | ✔ |
| 53 | Model insight: SHV78 / SHP78 are one dishwasher — model families | Brand · product · stem family key with a rule table; three tiers; watch-out flags to Mark | §1.7 | ✔ |
| 54 | Office notes on tickets; "check back with Miss Jones on xyz" reminders — internal only | `office_note` with `due_on`; Reminders tab | §6a | ✔ |
| — | (found while doing 52) 210 Lavaca St was one household of 245 accounts | Units in the address key; placeholders produce no key | §1.4i | ✔ |

### 13d. Cayden's 9/18 round — where each item landed ⟨9/18⟩

| # | Cayden said | What it becomes | Where | Done in prototype |
|---|---|---|---|---|
| 58 | "capability to move tech zones around … a zip code map with clickable or drawable zones?" | **Zones** on the board: paint-by-ZIP with a tech palette — click = primary (old primary kept as secondary), Shift-click = secondary, side panel for mode / trip / fee band; draft, Undo, Save draft; Publish gated to owner/manager; every change logged per ZIP | §4.4b, §9 | ✔ (nearest-centroid cells; ZCTA outlines in Agility) |
| 59 | "add a button to save route settings — I just can't save the changes" | The Save button existed but sat at the bottom of a tall drawer; now a sticky footer (Save / Cancel / saved-state text) and the settings persist across a reload (Agility `sj_techs` / `sj_tech_pattern`) | §4.1f | ✔ |
| 60 | "retire button should be locked behind some credential / admin only — too easy for a dispatcher to do by accident" | Signed-in-as switcher drives permissions; Retire needs `roster.retire` (owner/manager) and type-RETIRE-to-confirm; dispatchers see a locked chip saying who can | §9, §1.2 `app_user` / `app_permission` | ✔ |
| 61 | "change tech start and end locations based on day … default should be a broad setting; daily config optional" | From / To columns on the weekly pattern, "as usual" = the broad default; Josh shop→shop Mon/Wed, home→home Tue/Thu; every drive calculation takes the day's endpoints | §4.1f, `tech_pattern.start_at` / `end_at` | ✔ |
| 62 | "price in a zone fee as a second labor line … the zone fee codes start with ZN … auto assign based on the call distance from the shop" | The two-line labor rule: ZN1–ZN4 by straight-line miles (≤ 7 / 26 / 47) fitted to 3,807 tickets at 81%, per-ZIP override (78701 → ZN3), ZNADD per extra unit, DZ1 $157 + tax = $169.95; auto line in the field tool the tech cannot remove, office override at verify, board dollars use it | §5.1a, `labor.py`, §11 | ✔ |
| 63 | "office admins need the ability to manually add parts and labor to quotes … as long as the tech is required to select the failed component description or input their own" | Description required, part number optional in the field tool ("N part(s) without a number"); UNKNOWN gone; office verify highlights blanks and has + Add part / + Add labor, remove, quote total with S&H and tax | §5.3, §5.4 | ✔ |
| 64 | "we still have to use ePASS for storing ticket data, ordering parts, receiving parts, accounting and billing. It needs to remain the source of truth … minimal double work" | The interim operating model: `new_ticket` notification for self-booked requests; Kezia verifies price + ETA only; hand-off to the existing Agility estimate module; Noell keys approved lines + SO3 (`lines` packet); SO4 and SO5 read back from the import; part-arrived text ready on SO5, sent by click or toggle | §5.8, `handoff.py`, `estimate_handoff` | ✔ (62 tests) |
| 65 | "we will bring this back when we are on NetSuite and can open an API" (purchasing) | Parts order, PO builder, supplier sheets, Receiving, bin scanning and the T−2 receiving task hidden behind `purchasing.enabled = false`; code stays | §5.8, §11 | ✔ |
| 66 | — (found on the board) the strip's **+ tech** button never fired | Its click was swallowed by the load-left / load-right wiring; fixed. Board projected dollars now use the two-line labor rule | §4.1f, §5.1a | ✔ |
| 67 | ⟨pm⟩ "do we have the option to just add and remove zips?" | **Add ZIPs** paste box (any text → the Texas ZIPs in it, new ones painted with the selected tech), "served before, not on the map" chips from the ODBC history (26 ZIPs since 2025), unplaced ZIPs take a pasted `lat, lng`, **Remove from the service area** on the panel; diff and publish count added / removed | §4.4b, item 42 | ✔ (19 checks) |
| 68 | ⟨pm⟩ "check out randymajors.org … can you gain anything useful from it?" | Its radius / shape selection → **Results from Map** list pastes straight into the Add box; Custom Area Maps as the visual check; not embeddable by licence, no API; ZCTA-based like Agility's outlines. Four zone-table ZIPs with no centroid (78133, 78628, 78642, 78645) got approximate ones so they stop pricing as ZN1 | §4.4b | ✔ |
| 69 | ⟨pm⟩ "Kezia needs a toggle to confirm a part is available … discontinued parts … inform the customer, terminate the call and move it into a sales workflow … right back into our estimates tool" | **Discontinued** on the availability row (`nla`): no price or date needed, red banner; Verify hands a **parts-unavailable notice** to Estimates (`kind = notice`, total 0) with the customer text and two exits — shop for a replacement (showroom lead) or informed · close — both SO7 with a packet naming the part; every estimate close now queues SO7 | §5.3, §5.8, `handoff.py` | ✔ (18 checks, 64 tests) |
| 70 | ⟨pm⟩ "standard process we still charge diag if we can't get a part … we frequently waive it as we pass them over to sales … we truly have no control over what the manufacturers do with replacement parts" | Diagnostic decision on the notice — **Charge (default) · Waive (one click, logged, no permission gate) · Credit toward a replacement (proposed)**; the customer wording, the SO7 packet's billing line and the sales lead all follow it; the Estimates header counts the waive rate. Measured: 248 COD discontinued-part calls since Jan 2024, billed 56% / waived 19%, $187k of showroom sales inside 90 days | §5.3, §5.5, §11, item 41 | ✔ (15 checks, 64 tests) |
| 71 | ⟨late⟩ "a landing or success page after a customer selects a date and completes the registration that makes clear the functionality of saving the customer portal link to monitor their service" | A confirmation page in three variants (booked · trip bucket · office-only), built around **Save this link — it's how you follow your repair**: the URL with a Copy button, what the link actually does in the customer's terms, the honest line that anyone holding it can see the repair, then add-to-home-screen (per OS), email-me-the-link and bookmark. Then what happens next, what you'll be charged, and *Open my tracker*. The link becomes a one-tap `/t/{token}` — no order number, no phone — issued at intake, reissuable, expiring 90 days after close | §6b, §7, `tracker.py` | ✔ (30 checks, 66 tests) |

### 13e. Cayden's 9/19 round — the field tool ⟨9/19⟩

| # | What he said | Where it landed | Ref | ✔ |
|---|---|---|---|---|
| 72 | "add a button the tech can hit to see the dispatch board and look ahead at their route … should only show them their route … not be able to change anything in this view" | **My route ahead** — his stops, his next working days, real 9/17 export data; no input, no drag target, no save, one Back button; the banner names the office as the owner | §8b | ✔ |
| 73 | "lets hide field quote for now, until we find a way to automatically verify parts price by tying in with a distributor" | `FIELD_QUOTE = false`; the path stays behind the flag. Suggestion returned: ePASS's own Marcone B2B integration already returns live price, availability and a discontinued flag | §8a, item 46 | ✔ |
| 74 | "flip the my notifications section and the up next cards" | Notifications render first on the route screen | field tool | ✔ |
| 75 | "make the outcome a dropdown … default for a cod so1 is office quotes, default for wty so1 is straight to so3/parts verify, default for part install trips is repair complete" | One `<select>`, pre-set per call type, destination named underneath | §8a | ✔ |
| 76 | "instead of completed work photo, lets have that say — any relevant photos? — make this same change to problem photo" | Both read *Any relevant photos?* | §8a | ✔ |
| 77 | "if tech selects cant access unit, serial tag photo is no longer mandatory" | Dropped from `missing()` on that outcome, and the card says why | §8a | ✔ |
| 78 | "make the custom note options just a text box they can start typing in … more visibile" + a box under cause | Both are visible boxes under their chips; the reveal button is gone | §8a | ✔ |
| 79 | "can we have the text box pull related one click options as they type … auto populate results as they start typing pressure sensor" | Typeahead on what-you-found, cause, component and labor, fed first by what that **model family** has actually needed (ODBC parts history), then the catalog | §8a | ✔ |
| 80 | "remove … no part # yet — the office adds it from your description … remove the leave blank if you cant find it text" | Both gone. ~~A known component brings its catalog number with it~~ — **reversed 9/19 late**: the number is always blank for the tech to key (item 89) | §8a | ✔ |
| 81 | "have the other component option already be a text box … if they click drain pump … the other component text bubble disappears. lets add a button for add another part" | The picker is open until a part is chosen, then collapses to **＋ Add another part** | §8a | ✔ |
| 82 | "tech needs to see the labor associated when selecting a time … ability to tweak the labor amount before sending to office" | The full totals view, and an editable labor total with the book figure beside it and a reset | §8a | ✔ |
| 83 | "field quote generates a different workflow than office sends quote … lets make this consistent" | One flow: parts → labor → total, whichever way the quote travels afterwards | §8a | ✔ |
| 84 | "remove the default times associated with the labor … the tech still manually clicks the job time" | Book hours hidden; the row waits for his time; price = his hours × rate | §8a | ✔ |
| 85 | "if a tech is typing in the labor field, and we dont have a labor line for what they are typing, they should be able to add it as a manual line" | Typed lines add as `manual`, priced off the time picked, marked *not in the book* | §8a, item 48 | ✔ |
| 86 | "part number should be added at the time it populates … right after making the failed component description selection" | The number field is on the part row itself — **blank** since 9/19 late (item 89); it takes the focus when the line is added | §8a | ✔ |
| 87 | "part number needs to pass through to office queues into part verify so kkd can easily copy paste and check price. or change if the tech gets it wrong, or it is superseded" | Editable field + copy button on the verify row; the row remembers what the tech sent | §5.3 | ✔ (6 checks) |
| — | ⟨from the office list, the half that is the tech's⟩ True, Scotsman, Zephyr and BlueStar pay COD rates | Those four get the normal labor screen; every other warranty brand shows none and says the admin adds the flat rate. No zone fee, tax exempt throughout | §8a, item 47 | ✔ |

### 13f. Cayden's 9/19 late round — seven asks and the audit ⟨9/19 late⟩

| # | What he said | Where it landed | Ref | ✔ |
|---|---|---|---|---|
| 88 | "kelli kenney ticket - says ge profile speed oven, its a ge profile built in refrigerator. can you investigate and figure out where the bad data came from?" | It came from us. `realdata.py` had a model-prefix rule `("PSB","speed oven")`; Profile's PSB9 is a speed oven and PSB4 is a built-in fridge, and the rule did not look past three letters. Fixed two ways: the prefix rules now say PSB9 / PSB4 (and CSB9 / CSB4 for Café), and ahead of every prefix rule the classifier now asks **what ePASS's own product code says this model has been before** (`service_detail.product_code`, ≥ 2 tickets, ≥ 75 % agreement). 337 of 615 open tickets now classify from history, 175 categories changed, hers reads *built-in refrigerator*. And a second error surfaced underneath: her ticket is **COD** in ePASS, and the warranty flag the field tool showed on it was hand-set on 9/19 morning for a demo — gone, with a test that fails if it comes back | §8c, `realdata.classify` | ✔ |
| 89 | "the field tool is auto populating a part number when a component that failed is selected … this field should just remain blank for the tech to key the part number we need" | Always blank; the tech keys it; component names still offered. §13e rows 80/86 reversed | §8a | ✔ |
| 90 | "where are tech notes stored for current jobs? where do their findings recorded in field tool end up? we do need this to record their notes into history" | Answered in §8c. Field tool writes the visit into the unit's history on Submit; Phase 0 gets the `findings` table it never had, and one `history()` reader across ePASS and the dashboard; 3 new tests | §1.2, §8c, §7 | ✔ |
| 91 | "add the ability for anyone in the office to be able to edit customer, unit, tech notes any info" | Edit on every ticket card, every field, any office role; reason required; was→is in the activity log; correction packet to the ePASS sync queue | §6c, §3.5 | ✔ |
| 92 | "you built the damage report into this tool, which isn't needed. it already exists, we just need to read the incoming data in the service request queue that already exists as well" | The four-step form and its tab are removed from the board. The panel is now *Service request queue · incoming*: the queue row in the queue's own shape (customer, ERP S#, model/serial, *COSMETIC DAMAGE — field report by*, the Issue line, photos), built on a real delivery from the sales export, plus the one button the queue lacked. Everything after it — Unassigned, Mark, SO4, SO5, customer picks — unchanged. The bench can drop another incoming row (TEST ONLY) | §5.1c | ✔ |
| 93 | "route board - instead of the click left or right buttons, and then click the tech and date matrix … can we go to a click and drag system?" | Drag any capacity cell onto either board; the column lights up and says what a drop does; click still = left | §4.8b | ✔ |
| 94 | "do a full pass through, especially on what got done today … check for issues, find broken links and logic" | Below | — | ✔ |

**What the pass found and fixed** (each with a regression check):

| Found | Where | Fix |
|---|---|---|
| `("PSB","speed oven")` prefix rule (item 88) | `realdata.py` | history-first classifier; PSB9/PSB4 |
| `wty:1` hand-set on Kelli Kenney's COD ticket for a demo | field tool data | regenerated from the export; the warranty demo moved to Diogo's real Friday warranty call |
| A Whirlpool bake-element number (`W10779716`) hand-edited onto Pauline Stephenson's **Vent-A-Hood** ticket; and the sample-part table gave every hood a *bake element* | office data, `buildproto.SAMPLE` | hoods get a blower-motor sample; no line arrives with a number nobody keyed; verify suite keys it instead |
| Invented customers on real SV numbers in the office sync seeds ("Maria Ortega" on William Blocker's SV00123365, "Kim Cline" on Suzanne Colonna's SV00123400, "Brandon Cox" on Lindsay Chang's SV00123388, "Jeff McCollum" for Karen McCollum) and in the field tool's notifications ("Ed Taylor", "Mary Dietz" on other people's tickets) | office, field tool | every seed row is now the real customer, unit, tech and status on that SV; invented *questions* and *blocks* are labelled *sample* on screen |
| `SEALED_RE` matched *condenser* (a condenser **fan** motor claimed the sealed rate); field tool read `type:'sealed'` (built-in refrigeration) as sealed work | field, office, `labor.py` | regex tightened; sealed only from the tech's taps or flag; tests both sides |
| A sample placeholder (`sample-BM`) reported as *tech keyed sample-BM — you changed it* after Kezia keyed a number | office | `pnTech` records blank for a placeholder |
| Tracker dates hard-coded `Sep 18` / `Sep 22` on a board whose today is 9/17 | board | derived from `TODAY` / the ETA |
| README on C: pointed at four stale artifact URLs and a v0.12 / 40-test status; said prototypes run on "invented sample data" | repo README | five current links, current status, real export |
| The bench-return card on Landrum's SO6 and the *Van maintenance* block are demo overlays on real tickets | field tool | both labelled *sample* on screen |
| `verify_field.js` had no assertions and a dead path (fixed 9/19 late-pm, noted here) | harness | retired |
| Blueprint §14 still listed 1–23 as open after §14a answered them | blueprint | struck through with pointers; only the genuinely open items remain |

Not found: broken links. Every internal anchor in the five pages resolves; the only external links are Google Fonts and
the artifact URLs, which were checked against the live list.

## 14. The shadow test instance ⟨9/14⟩

> **Where it runs ⟨9/15⟩.** Andrew's `12_Agility_Platform_Notes.md` places all of this inside Agility (Node + Postgres on Render), where Phase 0 is already ported as `lib/service-journey-postgres.js`. Render cannot reach the ePASS box, so the `serve.py` shim in §14.3 is retired and its endpoints become routes under `/api/service-journey/`; the DispatchTrack feed already arrives by agent push rather than a watched folder; and the queue request is fetched server-side by `{serviceCardId}` instead of posted as a payload. The contracts below still hold — `13_Agility_Alignment.md` maps each one to its Agility form and lists what the port is still missing.

Replaces the AJH pilot files (`ajh_routing_tool.html`, `ajh_field_tool.html`, `ajh_office_parts_tool.html`, `AJH_pilot_developer_handoff.md`, the `WILSON_AJH_PILOT_V2` localStorage store and the three *AJH Pilot* menu entries). Their idea is kept — a copy button on the live queue, a board that mirrors the real ePASS route, and a suggested day for everything unscheduled — and applied to **every tech**, on the Phase 0 database, so nothing depends on three tabs of one browser.

### 14.1 What the instance is
- One Phase 0 database (`WilsonService_Test` or `sqlite:shadow.db`) fed by the **existing** DispatchTrack export (`\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport`, every 15 min, read-only) through `watch`, plus the ExportInvoice xlsx dropped in once or twice a day. Nothing in it writes to ePASS: packets accumulate as `pending` and are never keyed; `outbox` is not drained (no texts, no charges).
- The three *Service Journey* pages in the dashboard menu (Board, Field Tool, Office Queues) read it through `serve` (§14.3) or the dev's port of the same calls.
- The live Service Request Queue gets one button per row: **Copy to service dashboard test module** (rename of "Copy to AJH test module").

### 14.2 The button
`POST /api/requests` with the row as shown on screen — nothing about the live row changes (it is a copy, not a move):

```json
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

Response: `{job_id, created, status:"REQ", zone, booking_mode, suggestions:[{rank, sp_code, date, window, cost, why}]}`. Idempotent on `request_id` (`job.source_ref = 'queue:sr_4821'`) — pressing twice returns the same job. The request becomes a REQ through rule 1 (`source='dashboard'`, `card_ref`, photos queued as `photos.attach`), and the first suggestion is written to `placement_log(kind='intake')`.

**Attaching the ePASS ticket.** The dispatcher keeps booking in ePASS exactly as today. When the SV shows up in the next DispatchTrack snapshot, the import attaches it to the request — phone match, or a name token + ZIP, for requests newer than `intake.match_window_days` — adopts the ePASS booking (`status_history.trigger_event='epass_attach_booked'`) and fills `placement_log.actual_*`. No duplicate job. If the dispatcher types the SV into the queue row's **ERP order number** field, the dashboard posts `POST /api/requests/<job_id>/sv {"sv_number"}` (or re-posts the row with `erp_order_number` set) and `intake.attach_sv` attaches it directly — merging an import-created job for that SV into the request if the snapshot got there first.

### 14.3 Endpoints the pages use (`python -m wilson_service serve`)
`GET /api/board?date=` (stops + pencils per tech, with `why`), `GET /api/jobs/<id>/suggest`, `GET /api/jobs/<id>/offer`, `POST /api/jobs/<id>/pencil`, `GET /api/shadow?since=`, `GET /health`. Header `X-Token` when `serve.token` is set. These are a shim for the test instance; the Phase 1 API (§7) supersedes them with the same shapes.

### 14.4 What we watch, and when it is done
Morning, ten minutes, `python -m wilson_service shadow-report`:
1. Mirror health — last import, in-feed counts by status equal the CSV, `discrepancies = 0` (every one is either an ePASS quirk to normalise or a bug), stale tickets actually stale, aliases right.
2. Requests copied from the queue, and which still have no SV (a request without an SV after a day means the match rule missed or the call was never booked).
3. **Suggested vs actual** — `placement_log`: same day %, same tech %, both %, with every miss listed (`suggested DLA 09-16 · actual KJB 09-17 · why`). The dispatcher judges each miss: who was right? A rule we add, or a difference we accept. Target before anything customer-facing: ≥ 80 % same-day-or-better over ~50 requests, every miss explained.
4. Penciled installs — do they land where a dispatcher would have put them, and do they move sensibly when Kezia changes an ETA?
5. Dispatcher controls used on real events (PTO, van appointment, Josh's Friday, a forced call) and reflected within one refresh.

Random "break it" testing (closed days, full days, past dates, SO4 with no part, double-booking) runs on a **separate** copy seeded from the latest snapshot, never on the shadow instance: test customers there would sit in Michael's queue forever and skew the scorecard.

Exit → first customer-facing step: one zone or one tech, `offer.route_first` on, and a dispatcher-approves-slot gate in front of the confirmation text for two weeks.

### 14.6 The test bench on the board ⟨9/17 pm⟩

Cayden: *"build a test-only module under the route board that creates a random call and customer info,
and shows us a mock-up of what the customer would be seeing in terms of schedule date options. It lets us
click the date pretending to be the customer, and then we see it update onto the board in real time —
the best way to test the logic and give you feedback."*

The bench is a panel under the dispatch board with three columns:

1. **The call** — a generated customer (name, street, ZIP weighted by where today's real tickets are,
   appliance, brand, problem, units, warranty, contact preference), every field editable; 30% of the time
   it reuses a **real address from the export**, so the history link, the same-unit chip and the DNS rule
   fire exactly as they would on a real intake. Under the fields: the zone, its booking mode, primary and
   secondary techs, who is eligible and why, the planned duration.
2. **What the customer sees** — a phone frame with the *same* `pickerHTML` the tracker's intake step uses,
   over a ten-business-day horizon from tomorrow: "best fit" first with its reason in the customer's words,
   every half-day window as a button, full or closed or part-blocked windows grey with the reason on hover.
   Tapping one **books it**: the request becomes an SO1 on that tech-day, sequenced into the route, and
   the board above scrolls to that week, loads that tech-day into the left column and pulses the new card
   for a few seconds. The phone then shows the confirmation the customer would get, with "pick a different
   day" to run the reschedule path.
3. **What the engine did** — the top six candidates with their cost breakdown (added drive, same-zone
   credit, wait ramp, tech rank) and the reason sentence, the chosen row highlighted after booking, and
   the effect on that day (stops, fill %, driving before → after, over-capacity or a limit hit). Undo,
   "show it on the board", "generate another", "re-offer with these details" after editing a field, and
   "clear all test calls".

Test calls carry `is_test=1`: a TEST chip and a dashed border on the card, excluded from the sync queue
and from anything that counts as ePASS work, removable in one click. The bench uses the live rules —
`eligible()`, `suggestFor()`, `bestFit()`, `placeSuggested()`, `isOpen()`, `halfDayLoad()` — so a wrong
offer here is a wrong rule, not a wrong mock. Known limit while the board runs on the export alone: drive
minutes use lat/lng where the DispatchTrack feed had it and the ZIP centroid otherwise, so two stops in
one ZIP look like zero drive apart; the shadow instance (§14.1) has real coordinates.

Agility: the same three columns as a route under `/test-bench`, gated to `role in (owner, manager)`,
writing `sj_jobs` rows with `is_test=true` that the sync worker and the KPI queries filter out; a nightly
job deletes test rows older than seven days.

### 14.5 What carries over from the AJH files, and what does not
Keep: the copy button (renamed, posts to §14.2 instead of URL parameters), *suggested day + why* on every unscheduled card (now `placement.suggest`), the activity log idea (`audit_log` + `status_history` already are it), the Podium relay shape (browser → small server endpoint holding the key; §6), the two clearly-labelled TEST stops for reviewing on-my-way wording (recreate them on the "break it" copy, never on the shadow instance). Drop: the `localStorage` store and `storage`-event sync, the per-file seed data (`ExportInvoice_2026-09-14` AJH tickets — the shadow instance has every ticket from the import), the category → part-number catalog in the parts tool (item 17: no part number is ever pre-filled), the `bucket` field (Phase 0 statuses + `route_date`/`penciled_date` say what shows where), and anything scoped to one technician.
