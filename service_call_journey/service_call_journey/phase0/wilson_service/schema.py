"""Table definitions for Phase 0 and a DDL generator for SQLite and SQL Server.

Column types are written in a tiny neutral vocabulary and mapped per dialect:
  id        -> INTEGER PRIMARY KEY AUTOINCREMENT | INT IDENTITY(1,1) PRIMARY KEY
  str(n)    -> TEXT | NVARCHAR(n)
  text      -> TEXT | NVARCHAR(MAX)
  int, bit, money, num(p,s), date, ts (ISO-8601 string in SQLite, DATETIME2 in SQL Server)

Column names avoid T-SQL reserved words (KEY, DATE, AT, TRIGGER ...) so the same
application SQL runs unquoted on both engines.
"""
from __future__ import annotations

TABLES: dict[str, list[tuple]] = {
    "settings": [("setting_key", "str(80)", "PK"), ("value", "text"), ("type", "str(12)"), ("description", "text"), ("updated_by", "str(60)"), ("updated_at", "ts")],
    "status_def": [("status", "str(16)", "PK"), ("name", "str(80)"), ("track", "str(12)"), ("customer_stage", "str(40)"), ("sort_order", "int"), ("stuck_after_hours", "int")],
    "tech": [("tech_id", "id"), ("sp_code", "str(8)", "UNIQUE"), ("aliases", "str(40)"), ("name", "str(80)"), ("work_days", "str(28)"), ("role", "str(40)"), ("home_base", "str(120)"), ("start_default", "str(8)"), ("end_default", "str(8)"), ("shift_start", "str(5)"), ("shift_end", "str(5)"), ("skills", "text"), ("auto_route", "bit"), ("auto_schedule", "bit"), ("max_stops", "int"), ("speed_factor", "num(4,2)"), ("active", "bit"),
             ("first_service", "date"), ("last_service", "date"), ("lifecycle", "str(12)"), ("ended_on", "date"),
             # 9/18: where 'home' is when a route starts or ends there (NULL = unknown -> the shop); the office's retirement
             # date (ended_on is import-owned — the labor history rewrites it on every load)
             ("home_lat", "num(9,6)"), ("home_lng", "num(9,6)"), ("retire_on", "date")],
    "tech_day": [("tech_day_id", "id"), ("tech_id", "int"), ("work_date", "date"), ("available", "bit"), ("reason", "str(12)"), ("capacity_adjust_min", "int"), ("start_override", "str(8)"), ("end_override", "str(8)"), ("parts_loaded_prev_evening", "bit"), ("note", "text"), ("set_by", "str(60)"), ("set_at", "ts")],
    "route_block": [("block_id", "id"), ("tech_id", "int"), ("work_date", "date"), ("start_time", "str(5)"), ("end_time", "str(5)"), ("label", "str(60)"), ("address_id", "int"), ("sequence", "int"), ("created_by", "str(60)"), ("created_at", "ts")],
    "recall": [("recall_id", "id"), ("job_id", "int"), ("original_job_id", "int"), ("tech_id", "int"), ("days_between", "int"), ("basis", "str(16)"), ("state", "str(12)"), ("reviewed_by", "str(60)"), ("reviewed_at", "ts"), ("note", "text"), ("created_at", "ts")],
    "delivered": [("delivered_id", "id"), ("job_id", "int"), ("tech_id", "int"), ("visit_date", "date"), ("labor_amount", "money"), ("parts_sell", "money"), ("parts_cost", "money"), ("parts_profit", "money"), ("delivered_dollars", "money"), ("cost_basis", "str(10)"), ("source", "str(6)"), ("recognised_at", "ts"), ("reconciled_at", "ts"), ("adjustment", "money")],
    "zone": [("zone_code", "str(8)", "PK"), ("zone_group", "str(40)"), ("booking_mode", "str(16)"), ("primary_tech", "str(8)"), ("secondary_techs", "str(120)"), ("centroid_lat", "num(9,6)"), ("centroid_lng", "num(9,6)"), ("km_from_shop", "num(6,1)"), ("trip_tech", "str(8)"), ("notes", "text"), ("needs_review", "bit"),
             ("fee_band", "int")],   # 9/18: labor zone override (1-4); downtown 78701 is priced ZN3 at 18.8 mi in the history. NULL = by distance
    "zip_zone": [("zip", "str(5)", "PK"), ("zone_code", "str(8)")],
    # ⟨9/19⟩ the installer's cosmetic damage report (§5.1c). It exists before the job does — an installer submits it
    # from a delivery truck and whether it becomes a service order is the office's call — so it is its own row, with
    # `job_id` filled in only once someone converts it.
    "damage_report": [("report_id", "id"), ("reported_by", "str(60)"), ("reported_at", "ts"), ("truck", "str(8)"),
                      ("invoice_code", "str(20)"), ("customer_name", "str(140)"), ("address", "str(200)"), ("zip", "str(10)"),
                      ("brand", "str(40)"), ("model", "str(60)"), ("serial", "str(60)"),
                      ("issue", "str(60)"), ("side", "str(20)"), ("spot", "str(20)"), ("note", "str(500)"),
                      ("photo_count", "int"), ("state", "str(10)"), ("job_id", "int"),
                      ("part_number", "str(40)"), ("part_desc", "str(120)"), ("reviewed_by", "str(60)"), ("reviewed_at", "ts"),
                      ("created_at", "ts"), ("updated_at", "ts")],
    # ⟨9/19 late⟩ Cayden: "where do their findings recorded in field tool end up? we do need this to record their notes
    # into history."  Until now `record_visit` only wrote an outbox event. This is the row: one per visit, written the
    # moment the tech submits, and read back by the history views alongside the twenty-year ePASS catalogue
    # (`service_detail.performed_desc`). `performed_text` is the sentence the office and the next tech read; the
    # structured columns are what a report can count. Nothing here is ever re-typed into ePASS: the sync NOTE
    # carries the first 200 characters and points at the dashboard for the rest.
    "findings": [("findings_id", "id"), ("job_id", "int"), ("unit_id", "int"), ("tech_id", "int"), ("visit_date", "date"),
                 ("outcome", "str(20)"), ("to_status", "str(16)"), ("symptoms", "text"), ("error_code", "str(20)"), ("cause", "str(120)"),
                 ("custom_note", "text"), ("note", "text"), ("parts_json", "text"), ("labor_json", "text"), ("flags", "str(200)"),
                 ("performed_text", "text"), ("on_site_minutes", "int"), ("photo_count", "int"), ("submitted_at", "ts")],
    "customer": [("customer_id", "id"), ("first_name", "str(60)"), ("last_name", "str(80)"), ("display_name", "str(140)"), ("phone_primary", "str(20)"), ("phone_alt", "str(20)"), ("email", "str(120)"), ("contact_pref", "str(8)"), ("stripe_customer_id", "str(40)"), ("is_landlord", "bit"), ("is_property_manager", "bit"), ("epass_customer_code", "str(20)"), ("notes", "text"), ("created_at", "ts"), ("updated_at", "ts"),
                 ("do_not_service", "bit"), ("do_not_service_note", "str(200)"), ("do_not_service_set_by", "str(60)"), ("do_not_service_set_at", "ts"),
                 ("household_key", "str(80)"), ("service_count", "int"), ("first_service", "date"), ("last_service", "date"), ("lifetime_value", "money")],
    "address": [("address_id", "id"), ("customer_id", "int"), ("line1", "str(120)"), ("line2", "str(60)"), ("city", "str(60)"), ("state", "str(2)"), ("zip", "str(10)"), ("lat", "num(9,6)"), ("lng", "num(9,6)"), ("geocode_source", "str(8)"), ("gate_code", "str(20)"), ("access_notes", "text"), ("zone_code", "str(8)"), ("address_key", "str(80)")],
    "job": [
        ("job_id", "id"), ("sv_number", "str(20)", "UNIQUE"), ("customer_id", "int"), ("address_id", "int"),
        # dashboard-owned
        ("status", "str(16)"), ("status_changed_at", "ts"), ("flags", "str(80)"), ("job_type", "str(10)"), ("qualification", "str(6)"),
        ("is_warranty", "bit"), ("warranty_flags", "str(40)"), ("payment_type", "str(4)"), ("source", "str(10)"),
        ("owner_tech_id", "int"), ("assigned_tech_id", "int"),
        ("promised_window_start", "ts"), ("promised_window_end", "ts"), ("planned_slot_start", "ts"), ("planned_slot_end", "ts"),
        ("route_date", "date"), ("route_sequence", "int"), ("route_locked", "bit"), ("trip_id", "int"), ("booking_mode", "str(16)"),
        ("zone_code", "str(8)"), ("problem_text", "text"), ("balance", "money"), ("total", "money"), ("bin_location", "str(10)"), ("units", "int"),
        # mirror of ePASS (import-owned)
        ("epass_status", "str(16)"), ("epass_route_date", "date"), ("epass_tech_code", "str(8)"), ("epass_seen_at", "ts"), ("epass_source", "str(4)"),
        ("epass_invoice_status", "str(12)"), ("epass_finish_date", "date"), ("epass_created_at", "date"), ("in_feed", "bit"),
        ("stale", "bit"), ("needs_intake_review", "bit"), ("closed_at", "ts"), ("cancel_reason", "str(60)"), ("created_at", "ts"), ("updated_at", "ts"),
        # 9/14: parts ETA (Kezia), planned minutes, the auto-pencil (soft hold, dashboard-only), and where a copied request came from
        ("parts_eta", "date"), ("est_minutes", "int"), ("penciled_date", "date"), ("penciled_tech_id", "int"), ("pencil_reason", "str(200)"), ("pencil_set_at", "ts"),
        ("source_ref", "str(60)"), ("card_ref", "str(60)"),
        # ⟨9/18 late⟩ the customer's private tracker link (§6b) — one per job, revocable, reissued on request
        ("tracker_token", "str(16)", "UNIQUE"), ("tracker_token_at", "ts"), ("tracker_token_by", "str(60)"),
        # ⟨9/19 pm⟩ everything an in-shop ticket needs that a routed one does not: when it came in, who brought it,
        # whether we owe the customer a delivery back, every bench day it has been given, and the tech's note.
        ("shop_json", "text"),
    ],
    # 9/14: what the engine suggested vs what actually happened — the shadow-test scorecard
    "placement_log": [("placement_id", "id"), ("job_id", "int"), ("kind", "str(10)"), ("suggested_at", "ts"), ("suggested_tech_id", "int"), ("suggested_date", "date"),
                      ("suggested_window", "str(2)"), ("cost_min", "int"), ("why", "str(240)"), ("candidates_json", "text"), ("actual_tech_id", "int"), ("actual_date", "date"),
                      ("actual_at", "ts"), ("actual_source", "str(10)"), ("agree_day", "bit"), ("agree_tech", "bit"), ("note", "str(200)")],
    "unit": [("unit_id", "id"), ("job_id", "int"), ("asset_id", "int"), ("category", "str(40)"), ("install_type", "str(12)"), ("brand", "str(40)"), ("model", "str(60)"), ("serial", "str(60)"), ("problem_text", "text"), ("raw_detail", "text")],
    "status_history": [("history_id", "id"), ("job_id", "int"), ("from_status", "str(16)"), ("to_status", "str(16)"), ("changed_at", "ts"), ("actor_type", "str(10)"), ("actor_id", "str(40)"), ("trigger_event", "str(60)"), ("reason_code", "str(40)"), ("note", "text")],
    "import_batch": [("import_batch_id", "id"), ("source", "str(16)"), ("file_name", "str(255)", "UNIQUE"), ("file_path", "text"), ("file_modified_at", "ts"), ("imported_at", "ts"), ("row_count", "int"), ("sv_count", "int"), ("created_count", "int"), ("updated_count", "int"), ("status", "str(12)"), ("message", "text")],
    "import_row_raw": [("raw_row_id", "id"), ("import_batch_id", "int"), ("order_number", "str(20)"), ("line_no", "int"), ("job_status", "str(16)"), ("delivery_date", "date"), ("truck", "str(8)"), ("map_zone", "str(8)"), ("model", "str(60)"), ("description", "text"), ("quantity", "num(9,2)"), ("amount", "money"), ("row_json", "text")],
    "sync_item": [("sync_id", "id"), ("job_id", "int"), ("sv_number", "str(20)"), ("kind", "str(16)"), ("payload", "text"), ("packet_text", "text"), ("state", "str(12)"), ("created_at", "ts"), ("keyed_at", "ts"), ("keyed_by", "str(60)"), ("confirmed_at", "ts"), ("confirmed_by_import_id", "int"), ("epass_values", "text"), ("mismatch_count", "int"), ("resolved_at", "ts"), ("resolved_by", "str(60)"), ("resolution", "str(16)"), ("note", "text")],
    "outbox": [("outbox_id", "id"), ("job_id", "int"), ("effect", "str(40)"), ("payload", "text"), ("created_at", "ts"), ("handled_at", "ts")],
    "audit_log": [("audit_id", "id"), ("logged_at", "ts"), ("user_id", "str(60)"), ("action", "str(60)"), ("entity", "str(30)"), ("entity_id", "str(40)"), ("before_json", "text"), ("after_json", "text")],

    # ---------------------------------------------------------------- ⟨9/15 late⟩ the ePASS history load
    # `payer` is who gets billed and is NOT the customer: 25,148 of the 117,594 historical tickets are
    # billed to WHIRLPOOL / SUBZERO / GE WARRANTY / BOSCH / TRANE. Keying history on the ePASS
    # 'Bill To Customer' would collapse every warranty visit into a dozen fake households.
    "payer": [("payer_id", "id"), ("code", "str(40)", "UNIQUE"), ("name", "str(120)"), ("customer_id", "int"),
              ("kind", "str(16)"),                     # household | manufacturer | dealer | cash | other
              ("created_at", "ts")],

    # An asset is the physical appliance, identified by serial, that lives at a household.
    # `unit` stays job-scoped (what was worked on that visit) and points at its asset.
    "asset": [("asset_id", "id"), ("customer_id", "int"), ("serial", "str(60)"), ("brand", "str(40)"),
              ("model", "str(60)"), ("category", "str(40)"), ("install_type", "str(12)"),
              ("first_seen", "date"), ("last_seen", "date"), ("service_count", "int"),
              ("purchased_from_us", "bit"), ("purchase_date", "date"), ("purchase_price", "money"),
              ("purchase_invoice", "str(20)"), ("retired_at", "date"), ("note", "text")],

    # One row per historical ePASS service ticket. Deliberately separate from `job`: these are closed
    # records we did not create and must not re-drive through the state machine. A ticket that is still
    # open moves into `job` as well, keyed on the same sv_number.
    "service_history": [
        ("sv_number", "str(20)", "PK"), ("customer_id", "int"), ("payer_id", "int"), ("asset_id", "int"),
        ("epass_status", "str(16)"), ("epass_state", "str(20)"),        # 'Job Status' and 'Status' as exported
        ("created_date", "date"), ("sched_date", "date"), ("finish_date", "date"),
        ("sp_code", "str(8)"), ("route_code", "str(8)"), ("map_zone", "str(8)"), ("zip", "str(10)"),
        ("total", "money"), ("balance", "money"), ("payment_type", "str(8)"),
        ("units", "int"), ("qualification", "str(20)"), ("priorities", "str(60)"),
        ("reference", "str(60)"), ("spec_auth", "str(40)"), ("po_number", "str(40)"),
        ("name_raw", "str(140)"), ("address_raw", "str(120)"),
        ("identity_source", "str(16)"),   # epass_code | address_zip | surname_zip | unmatched  (§1.4)
        ("ticket_kind", "str(10)"),       # field | counter | cancelled  (§1.4g — a CPU* ticket is a parts sale, never a visit)
        ("imported_at", "ts")],

    # The NetSuite door. Every entity we own can carry ids from other systems; nothing in the core
    # tables assumes which system is authoritative, so the answer can change without a migration.
    "external_ref": [("external_ref_id", "id"), ("entity", "str(20)"), ("entity_id", "str(40)"),
                     ("system", "str(20)"),                 # epass | netsuite | stripe | podium
                     ("external_id", "str(64)"), ("is_primary", "bit"),
                     ("payload", "text"), ("linked_at", "ts"), ("synced_at", "ts")],
    # ---------------------------------------------------------------- ⟨9/17⟩ the full ODBC export
    # Seven files pulled straight from ePASS. These tables are the *detail* the invoice export never
    # carried: what the customer complained of, what the tech did, which parts went in, who worked it,
    # and what we originally sold them. See §1.6.
    "service_detail": [
        ("sv_number", "str(20)", "PK"),
        ("complaint_desc", "text"), ("complaint_code", "str(20)"),
        ("performed_desc", "text"), ("performed_code", "str(20)"),
        ("repair_code", "str(20)"), ("repair_category", "str(30)"), ("repair_severity", "str(10)"),
        ("product_code", "str(12)"), ("product", "str(40)"), ("brand_code", "str(20)"),
        ("model", "str(60)"), ("serial", "str(60)"), ("date_purchased", "date"),
        ("in_warranty", "str(24)"), ("warranty_kind", "str(40)"), ("contract", "str(40)"), ("agreement_no", "str(40)"),
        ("call_sequence", "int"), ("void", "bit"), ("request_id", "str(40)"),
        ("item_total", "money"), ("labor_total", "money"), ("misc_total", "money"),
        ("trip_charge", "money"), ("wty_total", "money"),
    ],
    # one row per part line. FailureCode is empty in the whole export, so a part links to a symptom
    # only through item_desc plus the ticket's complaint text.
    "service_part": [("part_line_id", "id"), ("sv_number", "str(20)"), ("epass_line_id", "str(20)"), ("trip_no", "int"),
                     ("item_code", "str(40)"), ("item_desc", "str(120)"), ("qty_ordered", "num(9,2)"), ("qty_shipped", "num(9,2)"),
                     ("selling_price", "money"), ("line_total", "money"), ("unit_cost", "money"),
                     ("warranty", "str(8)"), ("installed", "bit"), ("part_status", "str(20)"),
                     ("supplier_code", "str(20)"), ("bin_location", "str(20)"), ("created_date", "date")],
    "service_labor": [("labor_line_id", "id"), ("sv_number", "str(20)"), ("epass_line_id", "str(20)"), ("trip_no", "int"),
                      ("service_date", "date"), ("tech_code", "str(8)"), ("tech_name", "str(80)"),
                      ("labor_rate_code", "str(20)"), ("labor_desc", "str(120)"),
                      ("time_charged", "num(9,4)"), ("time_unit", "str(12)"), ("rate", "money"),
                      ("line_total", "money"), ("cost", "money"), ("warranty", "str(8)"),
                      ("trip_charge", "bit"), ("trip_charge_amt", "money")],
    # what we sold: one row per appliance line, and one per serial issued against it
    "sale": [("invoice_code", "str(20)", "PK"), ("inv_type", "str(6)"), ("status", "str(20)"), ("job_status", "str(16)"),
             ("customer_id", "int"), ("bill_to_code", "str(40)"), ("sold_to_code", "str(40)"),
             ("salesperson", "str(12)"), ("created_date", "date"), ("finish_date", "date"),
             ("item_total", "money"), ("labor_total", "money"), ("serial_total", "money"), ("wty_total", "money")],
    "sale_line": [("sale_line_id", "id"), ("invoice_code", "str(20)"), ("epass_line_id", "str(20)"),
                  ("model_code", "str(60)"), ("model_desc", "str(200)"), ("brand_code", "str(20)"),
                  ("product_code", "str(20)"), ("sku", "str(40)"), ("mfr_warranty", "str(40)"), ("colour", "str(30)"),
                  ("new_used", "str(10)"), ("qty", "num(9,2)"), ("selling_price", "money"), ("line_total", "money"),
                  ("line_status", "str(20)"), ("po_code", "str(30)")],
    "sale_serial": [("sale_serial_id", "id"), ("invoice_code", "str(20)"), ("epass_line_id", "str(20)"),
                    ("model_code", "str(60)"), ("serial", "str(60)"), ("serial_status", "str(20)"),
                    ("returned", "bit"), ("taken", "bit"), ("taken_date", "date"),
                    ("unit_cost", "money"), ("created_date", "date")],
    # ---- 9/17: things the office asked for after testing on the real catalogue
    # A tech's recurring weekday pattern (Diogo leaves at 3 on Thu/Fri). Route settings, not day overrides —
    # tech_day keeps today-only changes. One row per tech per weekday that differs from the default shift.
    "tech_pattern": [("tech_pattern_id", "id"), ("tech_id", "int"), ("weekday", "str(3)"), ("shift_start", "str(5)"),
                     ("shift_end", "str(5)"), ("reason", "str(80)"), ("set_by", "str(60)"), ("set_at", "ts"),
                     # 9/18: where the day starts/ends — 'shop' | 'home' | NULL (the tech's default). Josh: shop Mon/Wed for parts, home Tue/Thu
                     ("start_at", "str(8)"), ("end_at", "str(8)")],
    # Office-only text on a customer or a ticket. Never printed, never sent. `due_on` turns a note into a
    # reminder that lands on the office list that morning; `done_*` closes it. Internal only (Cayden 9/17).
    "office_note": [("note_id", "id"), ("customer_id", "int"), ("job_id", "int"), ("body", "text"), ("due_on", "date"),
                    ("assigned_to", "str(60)"), ("done_by", "str(60)"), ("done_at", "ts"), ("created_by", "str(60)"), ("created_at", "ts")],
    # Model families for Model Insight (§1.7). First match wins, ordered by `sort_order`; the default rule
    # (letters + first digit run) is code, not a row. Seeded with the Bosch dishwasher handle rule.
    "model_family_rule": [("rule_id", "id"), ("brand_pattern", "str(60)"), ("product_pattern", "str(40)"), ("model_regex", "str(120)"),
                          ("family_template", "str(40)"), ("label", "str(120)"), ("sort_order", "int"), ("active", "bit"),
                          ("created_by", "str(60)"), ("created_at", "ts")],
    # A tech's "watch out" for a model family: typed reason required, reviewed by the service manager before
    # it is shown to everyone. state: pending | published | retired.
    "model_flag": [("flag_id", "id"), ("family_key", "str(80)"), ("body", "text"), ("state", "str(12)"), ("raised_by", "str(60)"),
                   ("raised_at", "ts"), ("reviewed_by", "str(60)"), ("reviewed_at", "ts"), ("retired_at", "ts")],
    # ---- 9/18: who may do what. In Agility this maps onto app_users + user_page_permissions, so permissions stay plain
    # dotted names ('roster.retire', 'zones.publish') and a role is just a label; auth.can() answers for an email or a role.
    "app_user": [("user_id", "id"), ("email", "str(120)", "UNIQUE"), ("name", "str(80)"), ("role", "str(20)"), ("active", "bit")],
    "app_permission": [("permission_id", "id"), ("role", "str(20)"), ("permission", "str(60)")],
    # The interim estimate path: parts verifies price + ETA -> the quote is handed to Agility's service_estimates page
    # (external_ref = its token) -> the customer answers there -> approved comes back as SO3 + a 'lines' packet the office
    # keys; ordering/receiving stay in ePASS and SO4/SO5 are read back from the import. status mirrors service_estimates:
    # ready | sent | viewed | approved | declined | shopping | comped | diagnostic | no_response | parts_unavailable.
    # kind: quote (the normal estimate) | notice (9/18 pm: a line is 'nla' — discontinued — so the customer is told the repair
    # cannot proceed and offered the showroom; total 0, never approved).
    "estimate_handoff": [("handoff_id", "id"), ("job_id", "int"), ("sv_number", "str(20)"), ("external_ref", "str(60)"), ("status", "str(20)"), ("kind", "str(10)"),
                         ("lines", "text"), ("total", "money"), ("parts_eta", "date"), ("handed_by", "str(60)"), ("handed_at", "ts"), ("responded_at", "ts")],
}


INDEXES = [
    ("ix_techpattern", "tech_pattern", "tech_id, weekday"),
    ("ix_note_cust", "office_note", "customer_id"),
    ("ix_note_due", "office_note", "due_on"),
    ("ix_flag_fam", "model_flag", "family_key, state"),
    ("ix_job_status_route", "job", "status, route_date"),
    ("ix_job_assigned", "job", "assigned_tech_id, route_date, route_sequence"),
    ("ix_job_owner_status", "job", "owner_tech_id, status"),
    ("ix_job_customer", "job", "customer_id"),
    ("ix_sync_state", "sync_item", "state, sv_number"),
    ("ix_sync_job", "sync_item", "job_id, state"),
    ("ix_raw_batch_order", "import_row_raw", "import_batch_id, order_number"),
    ("ix_hist_job", "status_history", "job_id, changed_at"),
    ("ix_techday", "tech_day", "tech_id, work_date"),
    ("ix_unit_job", "unit", "job_id"),
    ("ix_address_customer", "address", "customer_id"),
    ("ix_outbox_unhandled", "outbox", "handled_at, created_at"),
    ("ix_block_tech_day", "route_block", "tech_id, work_date"),
    ("ix_recall_state", "recall", "state, tech_id"),
    ("ix_recall_job", "recall", "job_id"),
    ("ix_delivered_tech_date", "delivered", "tech_id, visit_date"),
    ("ix_unit_serial", "unit", "serial"),
    ("ix_job_penciled", "job", "penciled_tech_id, penciled_date"),
    ("ix_job_source_ref", "job", "source_ref"),
    ("ix_job_tracker_token", "job", "tracker_token"),
    ("ix_job_shop", "job", "status, route_date"),
    ("ix_damage_state", "damage_report", "state"),
    ("ix_damage_job", "damage_report", "job_id"),
    ("ix_findings_job", "findings", "job_id, submitted_at"),
    ("ix_placement_job", "placement_log", "job_id, kind"),
    # ⟨9/15 late⟩ history
    ("ix_asset_customer", "asset", "customer_id"),
    ("ix_asset_serial", "asset", "serial"),
    ("ix_hist_customer", "service_history", "customer_id, created_date"),
    ("ix_hist_asset", "service_history", "asset_id, created_date"),
    ("ix_hist_payer", "service_history", "payer_id"),
    ("ix_cust_household", "customer", "household_key"),
    ("ix_cust_epass", "customer", "epass_customer_code"),
    ("ix_addr_key", "address", "address_key"),
    ("ix_extref", "external_ref", "entity, entity_id, system"),
    ("ix_extref_lookup", "external_ref", "system, external_id"),
    # ⟨9/17⟩ full export
    ("ix_part_sv", "service_part", "sv_number"),
    ("ix_part_item", "service_part", "item_code"),
    ("ix_labor_sv", "service_labor", "sv_number"),
    ("ix_labor_tech", "service_labor", "tech_code, service_date"),
    ("ix_detail_model", "service_detail", "brand_code, model"),
    ("ix_detail_product", "service_detail", "product_code"),
    ("ix_detail_serial", "service_detail", "serial"),
    ("ix_saleline_model", "sale_line", "model_code"),
    ("ix_saleserial", "sale_serial", "serial"),
    ("ix_sale_customer", "sale", "customer_id"),
    # ⟨9/18⟩ permissions and the estimate hand-off
    ("ix_perm_role", "app_permission", "role, permission"),
    ("ix_handoff_job", "estimate_handoff", "job_id, status"),
    ("ix_handoff_ref", "estimate_handoff", "external_ref"),
]

_SQLITE = {"id": "INTEGER PRIMARY KEY AUTOINCREMENT", "text": "TEXT", "int": "INTEGER", "bit": "INTEGER", "money": "NUMERIC", "date": "TEXT", "ts": "TEXT"}
_MSSQL = {"id": "INT IDENTITY(1,1) PRIMARY KEY", "text": "NVARCHAR(MAX)", "int": "INT", "bit": "BIT", "money": "DECIMAL(10,2)", "date": "DATE", "ts": "DATETIME2"}


def _coltype(t: str, dialect: str) -> str:
    m = _SQLITE if dialect == "sqlite" else _MSSQL
    if t.startswith("str("):
        return "TEXT" if dialect == "sqlite" else f"NVARCHAR({t[4:-1]})"
    if t.startswith("num("):
        return "NUMERIC" if dialect == "sqlite" else f"DECIMAL({t[4:-1]})"
    return m[t]


def columns(table: str) -> list[str]:
    return [c[0] for c in TABLES[table]]


def ddl(dialect: str = "sqlite") -> str:
    """Return the full schema as idempotent DDL (safe to run more than once)."""
    tables, indexes = ddl_parts(dialect)
    return "\n\n".join(tables + indexes) + "\n"


def ddl_parts(dialect: str = "sqlite") -> tuple[list[str], list[str]]:
    """(table statements, index statements) — db.init_schema runs the column migration between the two."""
    out, idx = [], []
    for name, cols in TABLES.items():
        parts = []
        for c in cols:
            cname, ctype = c[0], c[1]
            extra = c[2] if len(c) > 2 else ""
            line = f"    {cname} {_coltype(ctype, dialect)}"
            if extra == "PK":
                line += " NOT NULL PRIMARY KEY"
            elif extra == "UNIQUE" and dialect == "sqlite":
                line += " UNIQUE"
            parts.append(line)
        if dialect == "sqlite":
            out.append(f"CREATE TABLE IF NOT EXISTS {name} (\n" + ",\n".join(parts) + "\n);")
        else:
            out.append(f"IF OBJECT_ID('dbo.{name}','U') IS NULL\nCREATE TABLE dbo.{name} (\n" + ",\n".join(parts) + "\n);")
            # columns added after a database was created: the script migrates itself (sqlite does this in db.migrate_columns)
            for c in cols:
                if c[1] != "id" and not (len(c) > 2 and c[2] == "PK"):
                    out.append(f"IF COL_LENGTH('dbo.{name}','{c[0]}') IS NULL ALTER TABLE dbo.{name} ADD {c[0]} {_coltype(c[1], dialect)};")
            for c in cols:
                if len(c) > 2 and c[2] == "UNIQUE":  # nullable unique -> filtered unique index
                    out.append(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_{name}_{c[0]}')\nCREATE UNIQUE INDEX ux_{name}_{c[0]} ON dbo.{name}({c[0]}) WHERE {c[0]} IS NOT NULL;")
    for ix, tbl, cols in INDEXES:
        if dialect == "sqlite":
            idx.append(f"CREATE INDEX IF NOT EXISTS {ix} ON {tbl}({cols});")
        else:
            idx.append(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='{ix}')\nCREATE INDEX {ix} ON dbo.{tbl}({cols});")
    return out, idx


if __name__ == "__main__":
    import sys
    print(ddl(sys.argv[1] if len(sys.argv) > 1 else "sqlite"))
