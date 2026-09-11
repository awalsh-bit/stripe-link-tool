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
    active INTEGER
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
    needs_review INTEGER
);

CREATE TABLE IF NOT EXISTS zip_zone (
    zip TEXT NOT NULL PRIMARY KEY,
    zone_code TEXT
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
    updated_at TEXT
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
    zone_code TEXT
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
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS unit (
    unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
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

