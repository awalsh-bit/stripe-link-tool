CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT NOT NULL PRIMARY KEY,
    value TEXT,
    type TEXT,
    description TEXT,
    updated_by TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS status_def (
    status TEXT NOT NULL PRIMARY KEY,
    name TEXT,
    track TEXT,
    customer_stage TEXT,
    sort_order INTEGER,
    stuck_after_hours INTEGER
);

CREATE TABLE IF NOT EXISTS tech (
    tech_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sp_code TEXT UNIQUE,
    aliases TEXT,
    name TEXT,
    work_days TEXT,
    role TEXT,
    home_base TEXT,
    start_default TEXT,
    end_default TEXT,
    shift_start TEXT,
    shift_end TEXT,
    skills TEXT,
    auto_route INTEGER,
    auto_schedule INTEGER,
    max_stops INTEGER,
    speed_factor NUMERIC,
    active INTEGER,
    first_service TEXT,
    last_service TEXT,
    lifecycle TEXT,
    ended_on TEXT,
    home_lat NUMERIC,
    home_lng NUMERIC,
    retire_on TEXT
);

CREATE TABLE IF NOT EXISTS tech_day (
    tech_day_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tech_id INTEGER,
    work_date TEXT,
    available INTEGER,
    reason TEXT,
    capacity_adjust_min INTEGER,
    start_override TEXT,
    end_override TEXT,
    parts_loaded_prev_evening INTEGER,
    note TEXT,
    set_by TEXT,
    set_at TEXT
);

CREATE TABLE IF NOT EXISTS route_block (
    block_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tech_id INTEGER,
    work_date TEXT,
    start_time TEXT,
    end_time TEXT,
    label TEXT,
    address_id INTEGER,
    sequence INTEGER,
    created_by TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS recall (
    recall_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    original_job_id INTEGER,
    tech_id INTEGER,
    days_between INTEGER,
    basis TEXT,
    state TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    note TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS delivered (
    delivered_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    tech_id INTEGER,
    visit_date TEXT,
    labor_amount NUMERIC,
    parts_sell NUMERIC,
    parts_cost NUMERIC,
    parts_profit NUMERIC,
    delivered_dollars NUMERIC,
    cost_basis TEXT,
    source TEXT,
    recognised_at TEXT,
    reconciled_at TEXT,
    adjustment NUMERIC
);

CREATE TABLE IF NOT EXISTS zone (
    zone_code TEXT NOT NULL PRIMARY KEY,
    zone_group TEXT,
    booking_mode TEXT,
    primary_tech TEXT,
    secondary_techs TEXT,
    centroid_lat NUMERIC,
    centroid_lng NUMERIC,
    km_from_shop NUMERIC,
    trip_tech TEXT,
    notes TEXT,
    needs_review INTEGER,
    fee_band INTEGER
);

CREATE TABLE IF NOT EXISTS zip_zone (
    zip TEXT NOT NULL PRIMARY KEY,
    zone_code TEXT
);

CREATE TABLE IF NOT EXISTS damage_report (
    report_id INTEGER PRIMARY KEY AUTOINCREMENT,
    reported_by TEXT,
    reported_at TEXT,
    truck TEXT,
    invoice_code TEXT,
    customer_name TEXT,
    address TEXT,
    zip TEXT,
    brand TEXT,
    model TEXT,
    serial TEXT,
    issue TEXT,
    side TEXT,
    spot TEXT,
    note TEXT,
    photo_count INTEGER,
    state TEXT,
    job_id INTEGER,
    part_number TEXT,
    part_desc TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS findings (
    findings_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    unit_id INTEGER,
    tech_id INTEGER,
    visit_date TEXT,
    outcome TEXT,
    to_status TEXT,
    symptoms TEXT,
    error_code TEXT,
    cause TEXT,
    custom_note TEXT,
    note TEXT,
    parts_json TEXT,
    labor_json TEXT,
    flags TEXT,
    performed_text TEXT,
    on_site_minutes INTEGER,
    photo_count INTEGER,
    submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS customer (
    customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    phone_primary TEXT,
    phone_alt TEXT,
    email TEXT,
    contact_pref TEXT,
    stripe_customer_id TEXT,
    is_landlord INTEGER,
    is_property_manager INTEGER,
    epass_customer_code TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    do_not_service INTEGER,
    do_not_service_note TEXT,
    do_not_service_set_by TEXT,
    do_not_service_set_at TEXT,
    household_key TEXT,
    service_count INTEGER,
    first_service TEXT,
    last_service TEXT,
    lifetime_value NUMERIC
);

CREATE TABLE IF NOT EXISTS address (
    address_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    line1 TEXT,
    line2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    lat NUMERIC,
    lng NUMERIC,
    geocode_source TEXT,
    gate_code TEXT,
    access_notes TEXT,
    zone_code TEXT,
    address_key TEXT
);

CREATE TABLE IF NOT EXISTS job (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sv_number TEXT UNIQUE,
    customer_id INTEGER,
    address_id INTEGER,
    status TEXT,
    status_changed_at TEXT,
    flags TEXT,
    job_type TEXT,
    qualification TEXT,
    is_warranty INTEGER,
    warranty_flags TEXT,
    payment_type TEXT,
    source TEXT,
    owner_tech_id INTEGER,
    assigned_tech_id INTEGER,
    promised_window_start TEXT,
    promised_window_end TEXT,
    planned_slot_start TEXT,
    planned_slot_end TEXT,
    route_date TEXT,
    route_sequence INTEGER,
    route_locked INTEGER,
    trip_id INTEGER,
    booking_mode TEXT,
    zone_code TEXT,
    problem_text TEXT,
    balance NUMERIC,
    total NUMERIC,
    bin_location TEXT,
    units INTEGER,
    epass_status TEXT,
    epass_route_date TEXT,
    epass_tech_code TEXT,
    epass_seen_at TEXT,
    epass_source TEXT,
    epass_invoice_status TEXT,
    epass_finish_date TEXT,
    epass_created_at TEXT,
    in_feed INTEGER,
    stale INTEGER,
    needs_intake_review INTEGER,
    closed_at TEXT,
    cancel_reason TEXT,
    created_at TEXT,
    updated_at TEXT,
    parts_eta TEXT,
    est_minutes INTEGER,
    penciled_date TEXT,
    penciled_tech_id INTEGER,
    pencil_reason TEXT,
    pencil_set_at TEXT,
    source_ref TEXT,
    card_ref TEXT,
    tracker_token TEXT UNIQUE,
    tracker_token_at TEXT,
    tracker_token_by TEXT,
    shop_json TEXT
);

CREATE TABLE IF NOT EXISTS placement_log (
    placement_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    kind TEXT,
    suggested_at TEXT,
    suggested_tech_id INTEGER,
    suggested_date TEXT,
    suggested_window TEXT,
    cost_min INTEGER,
    why TEXT,
    candidates_json TEXT,
    actual_tech_id INTEGER,
    actual_date TEXT,
    actual_at TEXT,
    actual_source TEXT,
    agree_day INTEGER,
    agree_tech INTEGER,
    note TEXT
);

CREATE TABLE IF NOT EXISTS unit (
    unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    asset_id INTEGER,
    category TEXT,
    install_type TEXT,
    brand TEXT,
    model TEXT,
    serial TEXT,
    problem_text TEXT,
    raw_detail TEXT
);

CREATE TABLE IF NOT EXISTS status_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    from_status TEXT,
    to_status TEXT,
    changed_at TEXT,
    actor_type TEXT,
    actor_id TEXT,
    trigger_event TEXT,
    reason_code TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS import_batch (
    import_batch_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    file_name TEXT UNIQUE,
    file_path TEXT,
    file_modified_at TEXT,
    imported_at TEXT,
    row_count INTEGER,
    sv_count INTEGER,
    created_count INTEGER,
    updated_count INTEGER,
    status TEXT,
    message TEXT
);

CREATE TABLE IF NOT EXISTS import_row_raw (
    raw_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_batch_id INTEGER,
    order_number TEXT,
    line_no INTEGER,
    job_status TEXT,
    delivery_date TEXT,
    truck TEXT,
    map_zone TEXT,
    model TEXT,
    description TEXT,
    quantity NUMERIC,
    amount NUMERIC,
    row_json TEXT
);

CREATE TABLE IF NOT EXISTS sync_item (
    sync_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    sv_number TEXT,
    kind TEXT,
    payload TEXT,
    packet_text TEXT,
    state TEXT,
    created_at TEXT,
    keyed_at TEXT,
    keyed_by TEXT,
    confirmed_at TEXT,
    confirmed_by_import_id INTEGER,
    epass_values TEXT,
    mismatch_count INTEGER,
    resolved_at TEXT,
    resolved_by TEXT,
    resolution TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
    outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    effect TEXT,
    payload TEXT,
    created_at TEXT,
    handled_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    logged_at TEXT,
    user_id TEXT,
    action TEXT,
    entity TEXT,
    entity_id TEXT,
    before_json TEXT,
    after_json TEXT
);

CREATE TABLE IF NOT EXISTS payer (
    payer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    customer_id INTEGER,
    kind TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS asset (
    asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    serial TEXT,
    brand TEXT,
    model TEXT,
    category TEXT,
    install_type TEXT,
    first_seen TEXT,
    last_seen TEXT,
    service_count INTEGER,
    purchased_from_us INTEGER,
    purchase_date TEXT,
    purchase_price NUMERIC,
    purchase_invoice TEXT,
    retired_at TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS service_history (
    sv_number TEXT NOT NULL PRIMARY KEY,
    customer_id INTEGER,
    payer_id INTEGER,
    asset_id INTEGER,
    epass_status TEXT,
    epass_state TEXT,
    created_date TEXT,
    sched_date TEXT,
    finish_date TEXT,
    sp_code TEXT,
    route_code TEXT,
    map_zone TEXT,
    zip TEXT,
    total NUMERIC,
    balance NUMERIC,
    payment_type TEXT,
    units INTEGER,
    qualification TEXT,
    priorities TEXT,
    reference TEXT,
    spec_auth TEXT,
    po_number TEXT,
    name_raw TEXT,
    address_raw TEXT,
    identity_source TEXT,
    ticket_kind TEXT,
    imported_at TEXT
);

CREATE TABLE IF NOT EXISTS external_ref (
    external_ref_id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT,
    entity_id TEXT,
    system TEXT,
    external_id TEXT,
    is_primary INTEGER,
    payload TEXT,
    linked_at TEXT,
    synced_at TEXT
);

CREATE TABLE IF NOT EXISTS service_detail (
    sv_number TEXT NOT NULL PRIMARY KEY,
    complaint_desc TEXT,
    complaint_code TEXT,
    performed_desc TEXT,
    performed_code TEXT,
    repair_code TEXT,
    repair_category TEXT,
    repair_severity TEXT,
    product_code TEXT,
    product TEXT,
    brand_code TEXT,
    model TEXT,
    serial TEXT,
    date_purchased TEXT,
    in_warranty TEXT,
    warranty_kind TEXT,
    contract TEXT,
    agreement_no TEXT,
    call_sequence INTEGER,
    void INTEGER,
    request_id TEXT,
    item_total NUMERIC,
    labor_total NUMERIC,
    misc_total NUMERIC,
    trip_charge NUMERIC,
    wty_total NUMERIC
);

CREATE TABLE IF NOT EXISTS service_part (
    part_line_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sv_number TEXT,
    epass_line_id TEXT,
    trip_no INTEGER,
    item_code TEXT,
    item_desc TEXT,
    qty_ordered NUMERIC,
    qty_shipped NUMERIC,
    selling_price NUMERIC,
    line_total NUMERIC,
    unit_cost NUMERIC,
    warranty TEXT,
    installed INTEGER,
    part_status TEXT,
    supplier_code TEXT,
    bin_location TEXT,
    created_date TEXT
);

CREATE TABLE IF NOT EXISTS service_labor (
    labor_line_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sv_number TEXT,
    epass_line_id TEXT,
    trip_no INTEGER,
    service_date TEXT,
    tech_code TEXT,
    tech_name TEXT,
    labor_rate_code TEXT,
    labor_desc TEXT,
    time_charged NUMERIC,
    time_unit TEXT,
    rate NUMERIC,
    line_total NUMERIC,
    cost NUMERIC,
    warranty TEXT,
    trip_charge INTEGER,
    trip_charge_amt NUMERIC
);

CREATE TABLE IF NOT EXISTS sale (
    invoice_code TEXT NOT NULL PRIMARY KEY,
    inv_type TEXT,
    status TEXT,
    job_status TEXT,
    customer_id INTEGER,
    bill_to_code TEXT,
    sold_to_code TEXT,
    salesperson TEXT,
    created_date TEXT,
    finish_date TEXT,
    item_total NUMERIC,
    labor_total NUMERIC,
    serial_total NUMERIC,
    wty_total NUMERIC
);

CREATE TABLE IF NOT EXISTS sale_line (
    sale_line_id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_code TEXT,
    epass_line_id TEXT,
    model_code TEXT,
    model_desc TEXT,
    brand_code TEXT,
    product_code TEXT,
    sku TEXT,
    mfr_warranty TEXT,
    colour TEXT,
    new_used TEXT,
    qty NUMERIC,
    selling_price NUMERIC,
    line_total NUMERIC,
    line_status TEXT,
    po_code TEXT
);

CREATE TABLE IF NOT EXISTS sale_serial (
    sale_serial_id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_code TEXT,
    epass_line_id TEXT,
    model_code TEXT,
    serial TEXT,
    serial_status TEXT,
    returned INTEGER,
    taken INTEGER,
    taken_date TEXT,
    unit_cost NUMERIC,
    created_date TEXT
);

CREATE TABLE IF NOT EXISTS tech_pattern (
    tech_pattern_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tech_id INTEGER,
    weekday TEXT,
    shift_start TEXT,
    shift_end TEXT,
    reason TEXT,
    set_by TEXT,
    set_at TEXT,
    start_at TEXT,
    end_at TEXT
);

CREATE TABLE IF NOT EXISTS office_note (
    note_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    job_id INTEGER,
    body TEXT,
    due_on TEXT,
    assigned_to TEXT,
    done_by TEXT,
    done_at TEXT,
    created_by TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS model_family_rule (
    rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_pattern TEXT,
    product_pattern TEXT,
    model_regex TEXT,
    family_template TEXT,
    label TEXT,
    sort_order INTEGER,
    active INTEGER,
    created_by TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS model_flag (
    flag_id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_key TEXT,
    body TEXT,
    state TEXT,
    raised_by TEXT,
    raised_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    retired_at TEXT
);

CREATE TABLE IF NOT EXISTS app_user (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    name TEXT,
    role TEXT,
    active INTEGER
);

CREATE TABLE IF NOT EXISTS app_permission (
    permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT,
    permission TEXT
);

CREATE TABLE IF NOT EXISTS estimate_handoff (
    handoff_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    sv_number TEXT,
    external_ref TEXT,
    status TEXT,
    kind TEXT,
    lines TEXT,
    total NUMERIC,
    parts_eta TEXT,
    handed_by TEXT,
    handed_at TEXT,
    responded_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_techpattern ON tech_pattern(tech_id, weekday);

CREATE INDEX IF NOT EXISTS ix_note_cust ON office_note(customer_id);

CREATE INDEX IF NOT EXISTS ix_note_due ON office_note(due_on);

CREATE INDEX IF NOT EXISTS ix_flag_fam ON model_flag(family_key, state);

CREATE INDEX IF NOT EXISTS ix_job_status_route ON job(status, route_date);

CREATE INDEX IF NOT EXISTS ix_job_assigned ON job(assigned_tech_id, route_date, route_sequence);

CREATE INDEX IF NOT EXISTS ix_job_owner_status ON job(owner_tech_id, status);

CREATE INDEX IF NOT EXISTS ix_job_customer ON job(customer_id);

CREATE INDEX IF NOT EXISTS ix_sync_state ON sync_item(state, sv_number);

CREATE INDEX IF NOT EXISTS ix_sync_job ON sync_item(job_id, state);

CREATE INDEX IF NOT EXISTS ix_raw_batch_order ON import_row_raw(import_batch_id, order_number);

CREATE INDEX IF NOT EXISTS ix_hist_job ON status_history(job_id, changed_at);

CREATE INDEX IF NOT EXISTS ix_techday ON tech_day(tech_id, work_date);

CREATE INDEX IF NOT EXISTS ix_unit_job ON unit(job_id);

CREATE INDEX IF NOT EXISTS ix_address_customer ON address(customer_id);

CREATE INDEX IF NOT EXISTS ix_outbox_unhandled ON outbox(handled_at, created_at);

CREATE INDEX IF NOT EXISTS ix_block_tech_day ON route_block(tech_id, work_date);

CREATE INDEX IF NOT EXISTS ix_recall_state ON recall(state, tech_id);

CREATE INDEX IF NOT EXISTS ix_recall_job ON recall(job_id);

CREATE INDEX IF NOT EXISTS ix_delivered_tech_date ON delivered(tech_id, visit_date);

CREATE INDEX IF NOT EXISTS ix_unit_serial ON unit(serial);

CREATE INDEX IF NOT EXISTS ix_job_penciled ON job(penciled_tech_id, penciled_date);

CREATE INDEX IF NOT EXISTS ix_job_source_ref ON job(source_ref);

CREATE INDEX IF NOT EXISTS ix_job_tracker_token ON job(tracker_token);

CREATE INDEX IF NOT EXISTS ix_job_shop ON job(status, route_date);

CREATE INDEX IF NOT EXISTS ix_damage_state ON damage_report(state);

CREATE INDEX IF NOT EXISTS ix_damage_job ON damage_report(job_id);

CREATE INDEX IF NOT EXISTS ix_findings_job ON findings(job_id, submitted_at);

CREATE INDEX IF NOT EXISTS ix_placement_job ON placement_log(job_id, kind);

CREATE INDEX IF NOT EXISTS ix_asset_customer ON asset(customer_id);

CREATE INDEX IF NOT EXISTS ix_asset_serial ON asset(serial);

CREATE INDEX IF NOT EXISTS ix_hist_customer ON service_history(customer_id, created_date);

CREATE INDEX IF NOT EXISTS ix_hist_asset ON service_history(asset_id, created_date);

CREATE INDEX IF NOT EXISTS ix_hist_payer ON service_history(payer_id);

CREATE INDEX IF NOT EXISTS ix_cust_household ON customer(household_key);

CREATE INDEX IF NOT EXISTS ix_cust_epass ON customer(epass_customer_code);

CREATE INDEX IF NOT EXISTS ix_addr_key ON address(address_key);

CREATE INDEX IF NOT EXISTS ix_extref ON external_ref(entity, entity_id, system);

CREATE INDEX IF NOT EXISTS ix_extref_lookup ON external_ref(system, external_id);

CREATE INDEX IF NOT EXISTS ix_part_sv ON service_part(sv_number);

CREATE INDEX IF NOT EXISTS ix_part_item ON service_part(item_code);

CREATE INDEX IF NOT EXISTS ix_labor_sv ON service_labor(sv_number);

CREATE INDEX IF NOT EXISTS ix_labor_tech ON service_labor(tech_code, service_date);

CREATE INDEX IF NOT EXISTS ix_detail_model ON service_detail(brand_code, model);

CREATE INDEX IF NOT EXISTS ix_detail_product ON service_detail(product_code);

CREATE INDEX IF NOT EXISTS ix_detail_serial ON service_detail(serial);

CREATE INDEX IF NOT EXISTS ix_saleline_model ON sale_line(model_code);

CREATE INDEX IF NOT EXISTS ix_saleserial ON sale_serial(serial);

CREATE INDEX IF NOT EXISTS ix_sale_customer ON sale(customer_id);

CREATE INDEX IF NOT EXISTS ix_perm_role ON app_permission(role, permission);

CREATE INDEX IF NOT EXISTS ix_handoff_job ON estimate_handoff(job_id, status);

CREATE INDEX IF NOT EXISTS ix_handoff_ref ON estimate_handoff(external_ref);
