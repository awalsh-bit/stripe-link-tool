IF OBJECT_ID('dbo.settings','U') IS NULL
CREATE TABLE dbo.settings (
    setting_key NVARCHAR(80) NOT NULL PRIMARY KEY,
    value NVARCHAR(MAX),
    type NVARCHAR(12),
    description NVARCHAR(MAX),
    updated_by NVARCHAR(60),
    updated_at DATETIME2
);

IF OBJECT_ID('dbo.status_def','U') IS NULL
CREATE TABLE dbo.status_def (
    status NVARCHAR(16) NOT NULL PRIMARY KEY,
    name NVARCHAR(80),
    track NVARCHAR(12),
    customer_stage NVARCHAR(40),
    sort_order INT,
    stuck_after_hours INT
);

IF OBJECT_ID('dbo.tech','U') IS NULL
CREATE TABLE dbo.tech (
    tech_id INT IDENTITY(1,1) PRIMARY KEY,
    sp_code NVARCHAR(8),
    aliases NVARCHAR(40),
    name NVARCHAR(80),
    work_days NVARCHAR(28),
    role NVARCHAR(40),
    home_base NVARCHAR(120),
    start_default NVARCHAR(8),
    end_default NVARCHAR(8),
    shift_start NVARCHAR(5),
    shift_end NVARCHAR(5),
    skills NVARCHAR(MAX),
    auto_route BIT,
    auto_schedule BIT,
    max_stops INT,
    speed_factor DECIMAL(4,2),
    active BIT
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_tech_sp_code')
CREATE UNIQUE INDEX ux_tech_sp_code ON dbo.tech(sp_code) WHERE sp_code IS NOT NULL;

IF OBJECT_ID('dbo.tech_day','U') IS NULL
CREATE TABLE dbo.tech_day (
    tech_day_id INT IDENTITY(1,1) PRIMARY KEY,
    tech_id INT,
    work_date DATE,
    available BIT,
    reason NVARCHAR(12),
    capacity_adjust_min INT,
    start_override NVARCHAR(8),
    end_override NVARCHAR(8),
    parts_loaded_prev_evening BIT,
    note NVARCHAR(MAX),
    set_by NVARCHAR(60),
    set_at DATETIME2
);

IF OBJECT_ID('dbo.route_block','U') IS NULL
CREATE TABLE dbo.route_block (
    block_id INT IDENTITY(1,1) PRIMARY KEY,
    tech_id INT,
    work_date DATE,
    start_time NVARCHAR(5),
    end_time NVARCHAR(5),
    label NVARCHAR(60),
    address_id INT,
    sequence INT,
    created_by NVARCHAR(60),
    created_at DATETIME2
);

IF OBJECT_ID('dbo.recall','U') IS NULL
CREATE TABLE dbo.recall (
    recall_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    original_job_id INT,
    tech_id INT,
    days_between INT,
    basis NVARCHAR(16),
    state NVARCHAR(12),
    reviewed_by NVARCHAR(60),
    reviewed_at DATETIME2,
    note NVARCHAR(MAX),
    created_at DATETIME2
);

IF OBJECT_ID('dbo.delivered','U') IS NULL
CREATE TABLE dbo.delivered (
    delivered_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    tech_id INT,
    visit_date DATE,
    labor_amount DECIMAL(10,2),
    parts_sell DECIMAL(10,2),
    parts_cost DECIMAL(10,2),
    parts_profit DECIMAL(10,2),
    delivered_dollars DECIMAL(10,2),
    cost_basis NVARCHAR(10),
    source NVARCHAR(6),
    recognised_at DATETIME2,
    reconciled_at DATETIME2,
    adjustment DECIMAL(10,2)
);

IF OBJECT_ID('dbo.zone','U') IS NULL
CREATE TABLE dbo.zone (
    zone_code NVARCHAR(8) NOT NULL PRIMARY KEY,
    zone_group NVARCHAR(40),
    booking_mode NVARCHAR(16),
    primary_tech NVARCHAR(8),
    secondary_techs NVARCHAR(120),
    centroid_lat DECIMAL(9,6),
    centroid_lng DECIMAL(9,6),
    km_from_shop DECIMAL(6,1),
    trip_tech NVARCHAR(8),
    notes NVARCHAR(MAX),
    needs_review BIT
);

IF OBJECT_ID('dbo.zip_zone','U') IS NULL
CREATE TABLE dbo.zip_zone (
    zip NVARCHAR(5) NOT NULL PRIMARY KEY,
    zone_code NVARCHAR(8)
);

IF OBJECT_ID('dbo.customer','U') IS NULL
CREATE TABLE dbo.customer (
    customer_id INT IDENTITY(1,1) PRIMARY KEY,
    first_name NVARCHAR(60),
    last_name NVARCHAR(80),
    display_name NVARCHAR(140),
    phone_primary NVARCHAR(20),
    phone_alt NVARCHAR(20),
    email NVARCHAR(120),
    contact_pref NVARCHAR(8),
    stripe_customer_id NVARCHAR(40),
    is_landlord BIT,
    is_property_manager BIT,
    epass_customer_code NVARCHAR(20),
    notes NVARCHAR(MAX),
    created_at DATETIME2,
    updated_at DATETIME2
);

IF OBJECT_ID('dbo.address','U') IS NULL
CREATE TABLE dbo.address (
    address_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT,
    line1 NVARCHAR(120),
    line2 NVARCHAR(60),
    city NVARCHAR(60),
    state NVARCHAR(2),
    zip NVARCHAR(10),
    lat DECIMAL(9,6),
    lng DECIMAL(9,6),
    geocode_source NVARCHAR(8),
    gate_code NVARCHAR(20),
    access_notes NVARCHAR(MAX),
    zone_code NVARCHAR(8)
);

IF OBJECT_ID('dbo.job','U') IS NULL
CREATE TABLE dbo.job (
    job_id INT IDENTITY(1,1) PRIMARY KEY,
    sv_number NVARCHAR(20),
    customer_id INT,
    address_id INT,
    status NVARCHAR(16),
    status_changed_at DATETIME2,
    flags NVARCHAR(80),
    job_type NVARCHAR(10),
    qualification NVARCHAR(6),
    is_warranty BIT,
    warranty_flags NVARCHAR(40),
    payment_type NVARCHAR(4),
    source NVARCHAR(10),
    owner_tech_id INT,
    assigned_tech_id INT,
    promised_window_start DATETIME2,
    promised_window_end DATETIME2,
    planned_slot_start DATETIME2,
    planned_slot_end DATETIME2,
    route_date DATE,
    route_sequence INT,
    route_locked BIT,
    trip_id INT,
    booking_mode NVARCHAR(16),
    zone_code NVARCHAR(8),
    problem_text NVARCHAR(MAX),
    balance DECIMAL(10,2),
    total DECIMAL(10,2),
    bin_location NVARCHAR(10),
    units INT,
    epass_status NVARCHAR(16),
    epass_route_date DATE,
    epass_tech_code NVARCHAR(8),
    epass_seen_at DATETIME2,
    epass_source NVARCHAR(4),
    epass_invoice_status NVARCHAR(12),
    epass_finish_date DATE,
    epass_created_at DATE,
    in_feed BIT,
    stale BIT,
    needs_intake_review BIT,
    closed_at DATETIME2,
    cancel_reason NVARCHAR(60),
    created_at DATETIME2,
    updated_at DATETIME2
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_job_sv_number')
CREATE UNIQUE INDEX ux_job_sv_number ON dbo.job(sv_number) WHERE sv_number IS NOT NULL;

IF OBJECT_ID('dbo.unit','U') IS NULL
CREATE TABLE dbo.unit (
    unit_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    category NVARCHAR(40),
    install_type NVARCHAR(12),
    brand NVARCHAR(40),
    model NVARCHAR(60),
    serial NVARCHAR(60),
    problem_text NVARCHAR(MAX),
    raw_detail NVARCHAR(MAX)
);

IF OBJECT_ID('dbo.status_history','U') IS NULL
CREATE TABLE dbo.status_history (
    history_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    from_status NVARCHAR(16),
    to_status NVARCHAR(16),
    changed_at DATETIME2,
    actor_type NVARCHAR(10),
    actor_id NVARCHAR(40),
    trigger_event NVARCHAR(60),
    reason_code NVARCHAR(40),
    note NVARCHAR(MAX)
);

IF OBJECT_ID('dbo.import_batch','U') IS NULL
CREATE TABLE dbo.import_batch (
    import_batch_id INT IDENTITY(1,1) PRIMARY KEY,
    source NVARCHAR(16),
    file_name NVARCHAR(255),
    file_path NVARCHAR(MAX),
    file_modified_at DATETIME2,
    imported_at DATETIME2,
    row_count INT,
    sv_count INT,
    created_count INT,
    updated_count INT,
    status NVARCHAR(12),
    message NVARCHAR(MAX)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_import_batch_file_name')
CREATE UNIQUE INDEX ux_import_batch_file_name ON dbo.import_batch(file_name) WHERE file_name IS NOT NULL;

IF OBJECT_ID('dbo.import_row_raw','U') IS NULL
CREATE TABLE dbo.import_row_raw (
    raw_row_id INT IDENTITY(1,1) PRIMARY KEY,
    import_batch_id INT,
    order_number NVARCHAR(20),
    line_no INT,
    job_status NVARCHAR(16),
    delivery_date DATE,
    truck NVARCHAR(8),
    map_zone NVARCHAR(8),
    model NVARCHAR(60),
    description NVARCHAR(MAX),
    quantity DECIMAL(9,2),
    amount DECIMAL(10,2),
    row_json NVARCHAR(MAX)
);

IF OBJECT_ID('dbo.sync_item','U') IS NULL
CREATE TABLE dbo.sync_item (
    sync_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    sv_number NVARCHAR(20),
    kind NVARCHAR(16),
    payload NVARCHAR(MAX),
    packet_text NVARCHAR(MAX),
    state NVARCHAR(12),
    created_at DATETIME2,
    keyed_at DATETIME2,
    keyed_by NVARCHAR(60),
    confirmed_at DATETIME2,
    confirmed_by_import_id INT,
    epass_values NVARCHAR(MAX),
    mismatch_count INT,
    resolved_at DATETIME2,
    resolved_by NVARCHAR(60),
    resolution NVARCHAR(16),
    note NVARCHAR(MAX)
);

IF OBJECT_ID('dbo.outbox','U') IS NULL
CREATE TABLE dbo.outbox (
    outbox_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    effect NVARCHAR(40),
    payload NVARCHAR(MAX),
    created_at DATETIME2,
    handled_at DATETIME2
);

IF OBJECT_ID('dbo.audit_log','U') IS NULL
CREATE TABLE dbo.audit_log (
    audit_id INT IDENTITY(1,1) PRIMARY KEY,
    logged_at DATETIME2,
    user_id NVARCHAR(60),
    action NVARCHAR(60),
    entity NVARCHAR(30),
    entity_id NVARCHAR(40),
    before_json NVARCHAR(MAX),
    after_json NVARCHAR(MAX)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_status_route')
CREATE INDEX ix_job_status_route ON dbo.job(status, route_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_assigned')
CREATE INDEX ix_job_assigned ON dbo.job(assigned_tech_id, route_date, route_sequence);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_owner_status')
CREATE INDEX ix_job_owner_status ON dbo.job(owner_tech_id, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_customer')
CREATE INDEX ix_job_customer ON dbo.job(customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_sync_state')
CREATE INDEX ix_sync_state ON dbo.sync_item(state, sv_number);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_sync_job')
CREATE INDEX ix_sync_job ON dbo.sync_item(job_id, state);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_raw_batch_order')
CREATE INDEX ix_raw_batch_order ON dbo.import_row_raw(import_batch_id, order_number);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_hist_job')
CREATE INDEX ix_hist_job ON dbo.status_history(job_id, changed_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_techday')
CREATE INDEX ix_techday ON dbo.tech_day(tech_id, work_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_unit_job')
CREATE INDEX ix_unit_job ON dbo.unit(job_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_address_customer')
CREATE INDEX ix_address_customer ON dbo.address(customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_outbox_unhandled')
CREATE INDEX ix_outbox_unhandled ON dbo.outbox(handled_at, created_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_block_tech_day')
CREATE INDEX ix_block_tech_day ON dbo.route_block(tech_id, work_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_recall_state')
CREATE INDEX ix_recall_state ON dbo.recall(state, tech_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_recall_job')
CREATE INDEX ix_recall_job ON dbo.recall(job_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_delivered_tech_date')
CREATE INDEX ix_delivered_tech_date ON dbo.delivered(tech_id, visit_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_unit_serial')
CREATE INDEX ix_unit_serial ON dbo.unit(serial);

