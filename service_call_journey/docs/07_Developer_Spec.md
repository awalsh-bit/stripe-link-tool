# Wilson Service Journey — Developer Specification v1.2

September 11, 2026 (v1.1 folded in the Sep 10 replay, `08_Replay_Sep2026.md`; **v1.2 folds in the service team's feedback from the 9/11 demo — every item is placed in §13 and the rules it needs are written into the sections below, marked ⟨9/11⟩**). Phase 0 of this spec exists as working code in `phase0/` · For the dashboard developer · Companion to `01_Service_Journey_Blueprint.md` (v0.9), the three prototypes, and the reference tables in `reference/`.

This document is the build spec. The blueprint says *why*; this says *what to build*, with every field traced to where it comes from and every rule written so it can be coded without re-deriving it from conversation. Where a number is a tunable it is named in §11 and should live in a settings table, not in code.

Stack: not prescribed. The sales-side routing prototype already runs on **SQL Server Express (`localhost\SQLEXPRESS`, database `WilsonRouting`) + Python importer + Flask**, and the maintenance portal is plain HTML/JS with a Python endpoint, so the path of least resistance is SQL Server for data, a Python (FastAPI or Flask) API, and the existing dashboard front end for screens. Nothing below depends on that choice. Column types are written in SQL Server terms; translate as needed.

---

## 0. Ground rules for the build

1. **The dashboard is the source of truth.** ePASS is mirrored until NetSuite. Nothing in ePASS overwrites a dashboard-owned field (§3.4).
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

**unit** (appliance or HVAC unit on a job; 1..n)
`unit_id`, `job_id` FK, `category` (dishwasher, refrigerator, …), `install_type` ENUM('built_in','freestanding','hvac') — **drives labor tax**, `brand`, `model`, `serial`, `purchase_date`, `purchased_from_us` ENUM('yes','no','unsure'), `merged_with_unit_id` NULL, `serial_tag_photo_id` FK→photo NULL, `problem_text`.

**status_history**
`id`, `job_id`, `from_status`, `to_status`, `at`, `actor_type` ENUM('customer','tech','staff','system'), `actor_id`, `trigger` VARCHAR(60) (event name from §2), `reason_code` NULL (required when actor_type='staff' and trigger='manual'), `note`.

**appointment**
`appointment_id`, `job_id` FK, `kind` ENUM('diag','install','revisit','shop_touch'), `window_start`, `window_end`, `planned_arrival`, `tech_id`, `route_date`, `sequence`, `locked BIT`, `on_my_way_at`, `arrived_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `created_by`.

**findings**
`findings_id`, `job_id`, `unit_id`, `tech_id`, `outcome` ENUM('field_quote','office_quote','quick_fix','research','replace','declined','no_access'), `symptoms JSON`, ⟨9/11⟩ `error_code VARCHAR(20) NULL` (**required** when `symptoms` contains `error_code` — the tool prompts for the code as displayed), `cause`, `note` (auto-built from taps), ⟨9/11⟩ `custom_note` (the tech's own typed words, behind a *Custom note* button; never pasted into ePASS beyond 200 chars), `labor_block` ENUM('none','half_day','full_day') (quick pick, §5.1), `submitted_at`, `on_site_minutes INT` (completed_at − arrived_at), `photos JSON` (photo ids).

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

### 1.3 Indexes that matter
`job(sv_number)`, ⟨9/11⟩ full-text (or trigram) index for search over `customer.display_name`, `customer.phone_primary/alt` digits, `job.sv_number`, `unit.serial`, `unit.model`, `address.line1` (§7 `/search`), `unit(serial)`, `recall(state)`, `delivered(tech_id, visit_date)`, `job(status, route_date)`, `job(assigned_tech_id, route_date, route_sequence)`, `job(owner_tech_id, status)` (owed-install ledger), `appointment(tech_id, route_date)`, `sync_item(state, sv_number)`, `import_row_raw(import_batch_id, order_number)`, `quote_line(quote_id)`, `po_line(job_id)`.

---

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

Aging thresholds that raise a **Stuck Jobs** flag (no transition): SO2 > 24 h, SO2.2 > 5 d, SO3 > 2 business days, SO4 past `eta + 2 d`, SO5 > 2 d, SO1 with `research` > 3 d, `REQ` > 1 business day, bucket age > 5 business days, ⟨9/11⟩ `SO4H` past `eta + 3 d` with no part-received tap, `hold_at_risk` unanswered > 24 h.

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

### 4.2 Capacity ledger
Materialised table `ledger(tech_id, date, half_day, committed_min, owed_min, drive_est_min, available_min)` recomputed on every booking/route change and nightly for the next 14 days.
- `committed_min` = Σ duration of booked stops in that half-day **plus ⟨9/11⟩ `route_block` minutes falling in it**, **excluding stale stops** (a stop whose `route_date` ≤ today at import and which is not completed by the next morning's import is marked `stale`, excluded from the ledger, and listed on Stuck Jobs — the 9/10 feed showed 11–13 "stops" on single techs that were parked tickets, not visits).
- `owed_min` = Σ over jobs where `owner_tech_id=tech` and status ∈ {SO2, SO2.1, SO2.2, SO3, SO4*} of `install_duration × conversion_probability`, spread onto the half-day of the job's expected install date (ETA + 1 business day, or created + 7 if no ETA). `conversion_probability` = 1.0 for SO3/SO4, `approval_rate_90d` (company-wide, default 0.67) for SO2–SO2.2.
- `drive_est_min` = 15 × stops (until a route exists) or actual planned drive.
- `available_min` = 240 − buffer − committed − owed − drive_est ⟨9/11⟩ + `tech_day.capacity_adjust_min` (split AM/PM by where the dispatcher clicked; a **forced** stop is allowed to drive `available_min` negative and is shown as overage).

### 4.3 Slot offering (what the picker shows)
For a job and each date in the next `booking_horizon_days` (default 10 business days), each half-day is **offered** if ∃ eligible tech with `available_min ≥ duration + 25`, and the tech has no `tech_day.available=0`, and (for installs) `ETA ≤ date − 1`, and the shop-touch guard (§4.5) passes. Offer at most `max_offers` (7) half-days, preferring days where the eligible tech already has ≥1 stop in the same zone group (fills routes), then earliest. Booking picks the tech with the most slack among eligible techs preferring primary over secondary. Booking writes `promised_window`, `planned_slot`, `assigned_tech_id`, `route_date`, `route_sequence = end`, and a sync item.

### 4.4 Booking modes and trip buckets
`zone.booking_mode`:
- `open` → §4.3 as-is.
- `designated_days` → the job enters the group's bucket (`trip_id NULL`, `status REQ/SO5`, `zone_group` known). Picker shows only dates of `trip` rows in state `confirmed` for that group with `capacity_minutes ≥ duration`. If none: bucket message. **Proposal job** (every 30 min): for each group with bucket items, propose a trip when `Σ duration ≥ trip_min_minutes` (default 240) **or** oldest item age > 5 business days **or** any SO5 item age > 3 days. Choose date = the trip tech's earliest day in the next 10 with `available_min ≥ Σ duration + drive` (drive = 2 × drive(shop→group centroid) + 15 × stops), skipping days with confirmed trips for another group. Create `trip(state=proposed)` and notify Demitrius. Automatic proposals are capped at `trip.max_auto_per_week` (2) per group; beyond that a manager opens the trip. On **confirm**: attach bucket items (`trip_id`), create appointments with windows assigned by sequence, send `notify:trip_date_offered` with one-tap confirm; items that decline stay in bucket. Trip stops are `route_locked` as a block; the optimiser may sequence within the block and add local stops before/after in travel direction.
- `office_only` → no picker; Client Care task; staff can book manually with any tech (`staff.booked`).

### 4.5 Shop touch (parts on the truck)
For a tech-day: `needs_shop_touch = ∃ stop with status ∈ {SO6, SO4PRE} AND tech start ≠ shop AND NOT tech_day.parts_loaded_prev_evening`. When true, insert a virtual stop `appointment(kind=shop_touch, 10 min)` at the shop before the first install in sequence. Wave rule for home-start techs: the optimiser may place SO1 stops before the shop touch only if they lie within a corridor of ≤ 10 min detour from home→shop; installs never precede it. Picker guard: a half-day is not offered for an install if the resulting route cannot include the shop touch before the install within the window. Setting per tech `always_start_at_shop=1` overrides everything (start = shop).

### 4.6 Ownership and reschedules
- `owner_tech_id` set on first `findings_submitted`; every later appointment on the job is offered/routed to the owner only. Board drag to another tech → allowed with a warning; requires `reason_code` (e.g. `owner_out`), logged. If owner has `tech_day.available=0` for > 5 business days, Stuck Jobs flags the job for manual reassignment.
- Customer reschedule/cancel ≥ 48 h before window start: free among offered slots.
- < 48 h: offered slots filtered to `tech already has ≥1 stop in the same zone_group that day` (SO1: any eligible tech, so tech may change; SO6/SO4PRE: owner only). None → portal shows Message Client Care. Cancel < 48 h → Client Care task, not self-service.
- Same-week reschedule (any distance) keeps the AM/PM window unless the customer explicitly changes it in the ≥48 h flow (allowed).

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

## 5. Pricing, quotes and tax

### 5.1 Catalog (replaces the 13,646-row rate book — see `03_Rate_Book_Analysis.md`)
**catalog_task**: `task_id`, `family_code` (RE, DW, WA, DR, CE, CG, …), `name`, `customer_description`, `base_hours DECIMAL(4,2)`, `department` ENUM('appliance','hvac','in_shop'), `tags JSON`, `labor_taxable_default BIT`, `active BIT`, `epass_code_stem` (e.g. `CE400`). Seed from `reference/task_catalog_draft.csv` after de-dup review.
**catalog_modifier**: difficult access 0.50 h, stacked/built-in access 0.35 h, additional tech 0.50 h, additional component 0.50 h.
**rate**: `department`, `hourly_rate` (appliance 130.00, hvac 150.00), `effective_from`.
**brand_factor**: `brand`, `family_code`, `factor DECIMAL(4,2) DEFAULT 1.00` — empty at launch.
**part_catalog**: `part_number PK`, `description`, `family_code`, `last_price`, `last_verified_at`, `last_verified_by`, `supplier`, `typical_availability`. Grows from every verify.
⟨9/11⟩ Two generic **quick picks** sit at the top of every family's labor list: `LAB-HALF` *Half-day labor* 4.0 h and `LAB-FULL` *Full-day labor* 8.0 h (sealed-system work defaults to full day); picking one sets `findings.labor_block`, prices at the department rate, and blocks 240 / 480 min of the owner's capacity for the install.
Labor line price = `base_hours × rate × brand_factor`, rounded to cents. ePASS import sheet generator: for each active task × each brand in the ePASS brand list, emit `code-BRAND, description, price, …` exactly as the current file's columns — so ePASS keeps importing the same shape.

### 5.2 Tax
`TAX_RATE` setting (8.25%). Parts and S&H always taxable. Diagnostic and zone fees always taxable. **Labor taxable iff `unit.install_type = 'freestanding'`** (built-in appliances and HVAC are labor-exempt). Family default from `catalog_task.labor_taxable_default` is used only when `install_type` is unknown; the field tool requires install_type on the serial-tag step so it's rarely unknown. Quote stores `tax_parts` and `tax_labor` separately and the customer page shows both lines.

### 5.3 Quote object and rendering
A quote is built entirely from `quote_line`s. The existing Estimate Approvals customer page renders from it (no PDF). Fields shown: unit, lines (parts with number + description; labor as one "Repair parts & labor" line or itemised per Cayden's preference — setting), S&H, tax lines, total, "Diagnostic included", "what you'll be charged and when" sentence, approve / think / shopping buttons (existing), parts ETA sentence from verified availability + next install slots.

### 5.4 Field quote and signature
`POST /jobs/{id}/field-quote` with lines and `decision`. On `approve`: require `agree=true`, `signature` (PNG data URL → `photo(kind=signature)`), `signed_by_name`, and store `signature_text` = the exact authorization wording displayed:
> I approve the work above for $TOTAL and authorize Wilson AC & Appliance to charge the card I saved with my service request once the repair is complete. I understand the diagnostic fee applies if I cancel.
Quote `status=approved`, `decision_channel=field_signature`. Receipt later attaches the signature image.

### 5.5 Billing rules
- Nothing is charged at the diagnostic visit.
- `SO8` after approval → charge **approved total** (quote.total; diag included).
- `SO7` (declined, replace, walked) or `quick_fix` → charge `DIAG_FEE` (169.95, taxable).
- Cancel after a diag was run → `DIAG_FEE`.
- Charge = Stripe PaymentIntent off-session on the saved payment method; success → `payment.succeeded`, receipt (`notify:receipt`), `sync:post_payment`. Failure → retries 24 h and 72 h, `notify:payment_link` with a hosted pay page; 3 failures → `payment.review`.
- Any mismatch between tech-completed lines and approved quote (lines added/removed, discount) → `payment.review`; Noell approves the amount before the charge.

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

Internal: ⟨9/11⟩ `hold_eta_check` task to Parts/receiving (Kezia) at T−2 for every SO4PRE hold whose parts are not all in, with Part-is-here / New-ETA / Wait buttons; Recalls queue digest to Mark weekly; Stuck Jobs digest 07:00 to Cayden + Demitrius + Mark; Needs-review quotes and Payment-review to Noell (in-app + email); new SO2 count to parts manager; sync backlog to Michael; trip proposals to Demitrius (in-app + text).

---

## 7. API surface

REST, JSON, bearer auth from the existing dashboard session. `{id}` = job_id; `sv` accepted as alias.

**Intake / customer**
- `POST /public/requests` (form step 1; existing) → `{job_id, ref}`; `POST /public/requests/{ref}/card` (existing Stripe flow)
- `GET /public/requests/{ref}/slots` → booking_mode + offered half-days `[{date, window, tech_first}]` or bucket/office message
- `POST /public/requests/{ref}/book {date, window}` → #2
- `GET /public/track?sv=&phone=` → tracker payload (stages, current stage detail, actions allowed)
- `GET /t/{token}` → same via signed link
- `POST /public/jobs/{token}/reschedule {date, window}` · `/cancel` · `/approve` · `/decline` · `/shopping {answers}` · `/hold {date, window}` · `/confirm-trip {window}` · `/message {text}` · ⟨9/11⟩ `/part-received` (#24a, the tracker's *My part arrived* button)

**Field tool** (tech auth; offline-tolerant, all idempotent by client id)
- `GET /tech/route?date=` → stops with sequence, ETA, customer, unit, problem, photos, gate, balance, bin, pref, owner flag
- `POST /tech/appointments/{id}/on-my-way` · `/arrive` · `/complete` (timestamps)
- `POST /tech/jobs/{id}/findings` `{unit_id, outcome, symptoms[], cause, note, parts[], labor[], flags[], photos[], serial_photo_id, install_type, model, serial}`
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
- ⟨9/11⟩ `GET /search?q=` — one box for the office: matches customer name (any word order), phone digits, SV (with or without `SV000`), serial, model, address line; returns `{customers[], jobs[]}` ranked, open jobs first. `GET /customers/{id}/history` → every job at that customer with dates, unit, status, tech, what was done (quote lines / findings), amounts and links; `GET /units/{serial}/history` → same by unit (a customer can move; the appliance may change owners). History includes closed jobs back-filled from the completed-invoice exports (§10 Phase 0.5).

**Imports / admin**
- `POST /imports/exportinvoice` (upload) · `GET /imports` · `GET/PUT /settings` · `GET/PUT /catalog/*` · `GET /catalog/epass-export`

---

## 8. Field tool technical notes
Mobile web (PWA) on techs' own phones; identity from dashboard session (no second login); launch carries the tech id and date. Follow `02_Field_Tool_Conventions.md`: tap-only, 44/52 px targets, 450 ms autosave debounce to local storage then server, photos downscaled to 1600 px JPEG q0.82 and written to IndexedDB **before** the UI says saved, uploaded one at a time with the metadata headers, never deleted locally; offline banner from the service worker; readiness strip names what's missing. Arrive/complete taps are the duration source (§4.1). Serial-tag photo required only when `unit.serial_tag_photo_id` is null (SO1); install screens show the existing one. ⟨9/11⟩ Two deliberate typing exceptions to tap-only: the **error code** field (appears when the *Error code* symptom chip is tapped; short alphanumeric, autocapitalised, required) and the **Custom note** (a button under *What you found* that reveals a text box, with voice-to-text as the keyboard's mic; optional). The labor picker shows **Half day · 4h** and **Full day · 8h** chips above the family's task list. The route screen header carries the delivered-dollars strip (§5.6) and lists `route_block`s in sequence as grey cards (label only, no customer).

---

## 9. Security, roles, audit
Internal network / VPN or authenticated hosting only; production server (waitress/IIS), not Flask dev. Roles: **Dispatcher** (board, trips, unschedule, override with reason), **Parts** (verify/order/receive), **CX** (quotes review, payments review, sync queue), **Manager** (all + settings/catalog), **Tech** (own route and jobs only), **Customer** (signed link scope only). Every write is in `audit_log`. PII (names, addresses, phones) is displayed by role; the field tool shows only today's route. Signed tracker links expire 90 days after `closed_at`. Stripe PANs never touch the dashboard (SetupIntent/PaymentIntent only). Photos in private object storage; URLs signed.

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

## 12. Open items for the dev to confirm with Cayden
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
