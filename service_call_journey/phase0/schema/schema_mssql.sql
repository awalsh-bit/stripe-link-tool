IF OBJECT_ID('dbo.settings','U') IS NULL
CREATE TABLE dbo.settings (
    setting_key NVARCHAR(80) NOT NULL PRIMARY KEY,
    value NVARCHAR(MAX),
    type NVARCHAR(12),
    description NVARCHAR(MAX),
    updated_by NVARCHAR(60),
    updated_at DATETIME2
);

IF COL_LENGTH('dbo.settings','value') IS NULL ALTER TABLE dbo.settings ADD value NVARCHAR(MAX);

IF COL_LENGTH('dbo.settings','type') IS NULL ALTER TABLE dbo.settings ADD type NVARCHAR(12);

IF COL_LENGTH('dbo.settings','description') IS NULL ALTER TABLE dbo.settings ADD description NVARCHAR(MAX);

IF COL_LENGTH('dbo.settings','updated_by') IS NULL ALTER TABLE dbo.settings ADD updated_by NVARCHAR(60);

IF COL_LENGTH('dbo.settings','updated_at') IS NULL ALTER TABLE dbo.settings ADD updated_at DATETIME2;

IF OBJECT_ID('dbo.status_def','U') IS NULL
CREATE TABLE dbo.status_def (
    status NVARCHAR(16) NOT NULL PRIMARY KEY,
    name NVARCHAR(80),
    track NVARCHAR(12),
    customer_stage NVARCHAR(40),
    sort_order INT,
    stuck_after_hours INT
);

IF COL_LENGTH('dbo.status_def','name') IS NULL ALTER TABLE dbo.status_def ADD name NVARCHAR(80);

IF COL_LENGTH('dbo.status_def','track') IS NULL ALTER TABLE dbo.status_def ADD track NVARCHAR(12);

IF COL_LENGTH('dbo.status_def','customer_stage') IS NULL ALTER TABLE dbo.status_def ADD customer_stage NVARCHAR(40);

IF COL_LENGTH('dbo.status_def','sort_order') IS NULL ALTER TABLE dbo.status_def ADD sort_order INT;

IF COL_LENGTH('dbo.status_def','stuck_after_hours') IS NULL ALTER TABLE dbo.status_def ADD stuck_after_hours INT;

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

IF COL_LENGTH('dbo.tech','sp_code') IS NULL ALTER TABLE dbo.tech ADD sp_code NVARCHAR(8);

IF COL_LENGTH('dbo.tech','aliases') IS NULL ALTER TABLE dbo.tech ADD aliases NVARCHAR(40);

IF COL_LENGTH('dbo.tech','name') IS NULL ALTER TABLE dbo.tech ADD name NVARCHAR(80);

IF COL_LENGTH('dbo.tech','work_days') IS NULL ALTER TABLE dbo.tech ADD work_days NVARCHAR(28);

IF COL_LENGTH('dbo.tech','role') IS NULL ALTER TABLE dbo.tech ADD role NVARCHAR(40);

IF COL_LENGTH('dbo.tech','home_base') IS NULL ALTER TABLE dbo.tech ADD home_base NVARCHAR(120);

IF COL_LENGTH('dbo.tech','start_default') IS NULL ALTER TABLE dbo.tech ADD start_default NVARCHAR(8);

IF COL_LENGTH('dbo.tech','end_default') IS NULL ALTER TABLE dbo.tech ADD end_default NVARCHAR(8);

IF COL_LENGTH('dbo.tech','shift_start') IS NULL ALTER TABLE dbo.tech ADD shift_start NVARCHAR(5);

IF COL_LENGTH('dbo.tech','shift_end') IS NULL ALTER TABLE dbo.tech ADD shift_end NVARCHAR(5);

IF COL_LENGTH('dbo.tech','skills') IS NULL ALTER TABLE dbo.tech ADD skills NVARCHAR(MAX);

IF COL_LENGTH('dbo.tech','auto_route') IS NULL ALTER TABLE dbo.tech ADD auto_route BIT;

IF COL_LENGTH('dbo.tech','auto_schedule') IS NULL ALTER TABLE dbo.tech ADD auto_schedule BIT;

IF COL_LENGTH('dbo.tech','max_stops') IS NULL ALTER TABLE dbo.tech ADD max_stops INT;

IF COL_LENGTH('dbo.tech','speed_factor') IS NULL ALTER TABLE dbo.tech ADD speed_factor DECIMAL(4,2);

IF COL_LENGTH('dbo.tech','active') IS NULL ALTER TABLE dbo.tech ADD active BIT;

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

IF COL_LENGTH('dbo.tech_day','tech_id') IS NULL ALTER TABLE dbo.tech_day ADD tech_id INT;

IF COL_LENGTH('dbo.tech_day','work_date') IS NULL ALTER TABLE dbo.tech_day ADD work_date DATE;

IF COL_LENGTH('dbo.tech_day','available') IS NULL ALTER TABLE dbo.tech_day ADD available BIT;

IF COL_LENGTH('dbo.tech_day','reason') IS NULL ALTER TABLE dbo.tech_day ADD reason NVARCHAR(12);

IF COL_LENGTH('dbo.tech_day','capacity_adjust_min') IS NULL ALTER TABLE dbo.tech_day ADD capacity_adjust_min INT;

IF COL_LENGTH('dbo.tech_day','start_override') IS NULL ALTER TABLE dbo.tech_day ADD start_override NVARCHAR(8);

IF COL_LENGTH('dbo.tech_day','end_override') IS NULL ALTER TABLE dbo.tech_day ADD end_override NVARCHAR(8);

IF COL_LENGTH('dbo.tech_day','parts_loaded_prev_evening') IS NULL ALTER TABLE dbo.tech_day ADD parts_loaded_prev_evening BIT;

IF COL_LENGTH('dbo.tech_day','note') IS NULL ALTER TABLE dbo.tech_day ADD note NVARCHAR(MAX);

IF COL_LENGTH('dbo.tech_day','set_by') IS NULL ALTER TABLE dbo.tech_day ADD set_by NVARCHAR(60);

IF COL_LENGTH('dbo.tech_day','set_at') IS NULL ALTER TABLE dbo.tech_day ADD set_at DATETIME2;

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

IF COL_LENGTH('dbo.route_block','tech_id') IS NULL ALTER TABLE dbo.route_block ADD tech_id INT;

IF COL_LENGTH('dbo.route_block','work_date') IS NULL ALTER TABLE dbo.route_block ADD work_date DATE;

IF COL_LENGTH('dbo.route_block','start_time') IS NULL ALTER TABLE dbo.route_block ADD start_time NVARCHAR(5);

IF COL_LENGTH('dbo.route_block','end_time') IS NULL ALTER TABLE dbo.route_block ADD end_time NVARCHAR(5);

IF COL_LENGTH('dbo.route_block','label') IS NULL ALTER TABLE dbo.route_block ADD label NVARCHAR(60);

IF COL_LENGTH('dbo.route_block','address_id') IS NULL ALTER TABLE dbo.route_block ADD address_id INT;

IF COL_LENGTH('dbo.route_block','sequence') IS NULL ALTER TABLE dbo.route_block ADD sequence INT;

IF COL_LENGTH('dbo.route_block','created_by') IS NULL ALTER TABLE dbo.route_block ADD created_by NVARCHAR(60);

IF COL_LENGTH('dbo.route_block','created_at') IS NULL ALTER TABLE dbo.route_block ADD created_at DATETIME2;

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

IF COL_LENGTH('dbo.recall','job_id') IS NULL ALTER TABLE dbo.recall ADD job_id INT;

IF COL_LENGTH('dbo.recall','original_job_id') IS NULL ALTER TABLE dbo.recall ADD original_job_id INT;

IF COL_LENGTH('dbo.recall','tech_id') IS NULL ALTER TABLE dbo.recall ADD tech_id INT;

IF COL_LENGTH('dbo.recall','days_between') IS NULL ALTER TABLE dbo.recall ADD days_between INT;

IF COL_LENGTH('dbo.recall','basis') IS NULL ALTER TABLE dbo.recall ADD basis NVARCHAR(16);

IF COL_LENGTH('dbo.recall','state') IS NULL ALTER TABLE dbo.recall ADD state NVARCHAR(12);

IF COL_LENGTH('dbo.recall','reviewed_by') IS NULL ALTER TABLE dbo.recall ADD reviewed_by NVARCHAR(60);

IF COL_LENGTH('dbo.recall','reviewed_at') IS NULL ALTER TABLE dbo.recall ADD reviewed_at DATETIME2;

IF COL_LENGTH('dbo.recall','note') IS NULL ALTER TABLE dbo.recall ADD note NVARCHAR(MAX);

IF COL_LENGTH('dbo.recall','created_at') IS NULL ALTER TABLE dbo.recall ADD created_at DATETIME2;

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

IF COL_LENGTH('dbo.delivered','job_id') IS NULL ALTER TABLE dbo.delivered ADD job_id INT;

IF COL_LENGTH('dbo.delivered','tech_id') IS NULL ALTER TABLE dbo.delivered ADD tech_id INT;

IF COL_LENGTH('dbo.delivered','visit_date') IS NULL ALTER TABLE dbo.delivered ADD visit_date DATE;

IF COL_LENGTH('dbo.delivered','labor_amount') IS NULL ALTER TABLE dbo.delivered ADD labor_amount DECIMAL(10,2);

IF COL_LENGTH('dbo.delivered','parts_sell') IS NULL ALTER TABLE dbo.delivered ADD parts_sell DECIMAL(10,2);

IF COL_LENGTH('dbo.delivered','parts_cost') IS NULL ALTER TABLE dbo.delivered ADD parts_cost DECIMAL(10,2);

IF COL_LENGTH('dbo.delivered','parts_profit') IS NULL ALTER TABLE dbo.delivered ADD parts_profit DECIMAL(10,2);

IF COL_LENGTH('dbo.delivered','delivered_dollars') IS NULL ALTER TABLE dbo.delivered ADD delivered_dollars DECIMAL(10,2);

IF COL_LENGTH('dbo.delivered','cost_basis') IS NULL ALTER TABLE dbo.delivered ADD cost_basis NVARCHAR(10);

IF COL_LENGTH('dbo.delivered','source') IS NULL ALTER TABLE dbo.delivered ADD source NVARCHAR(6);

IF COL_LENGTH('dbo.delivered','recognised_at') IS NULL ALTER TABLE dbo.delivered ADD recognised_at DATETIME2;

IF COL_LENGTH('dbo.delivered','reconciled_at') IS NULL ALTER TABLE dbo.delivered ADD reconciled_at DATETIME2;

IF COL_LENGTH('dbo.delivered','adjustment') IS NULL ALTER TABLE dbo.delivered ADD adjustment DECIMAL(10,2);

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

IF COL_LENGTH('dbo.zone','zone_group') IS NULL ALTER TABLE dbo.zone ADD zone_group NVARCHAR(40);

IF COL_LENGTH('dbo.zone','booking_mode') IS NULL ALTER TABLE dbo.zone ADD booking_mode NVARCHAR(16);

IF COL_LENGTH('dbo.zone','primary_tech') IS NULL ALTER TABLE dbo.zone ADD primary_tech NVARCHAR(8);

IF COL_LENGTH('dbo.zone','secondary_techs') IS NULL ALTER TABLE dbo.zone ADD secondary_techs NVARCHAR(120);

IF COL_LENGTH('dbo.zone','centroid_lat') IS NULL ALTER TABLE dbo.zone ADD centroid_lat DECIMAL(9,6);

IF COL_LENGTH('dbo.zone','centroid_lng') IS NULL ALTER TABLE dbo.zone ADD centroid_lng DECIMAL(9,6);

IF COL_LENGTH('dbo.zone','km_from_shop') IS NULL ALTER TABLE dbo.zone ADD km_from_shop DECIMAL(6,1);

IF COL_LENGTH('dbo.zone','trip_tech') IS NULL ALTER TABLE dbo.zone ADD trip_tech NVARCHAR(8);

IF COL_LENGTH('dbo.zone','notes') IS NULL ALTER TABLE dbo.zone ADD notes NVARCHAR(MAX);

IF COL_LENGTH('dbo.zone','needs_review') IS NULL ALTER TABLE dbo.zone ADD needs_review BIT;

IF OBJECT_ID('dbo.zip_zone','U') IS NULL
CREATE TABLE dbo.zip_zone (
    zip NVARCHAR(5) NOT NULL PRIMARY KEY,
    zone_code NVARCHAR(8)
);

IF COL_LENGTH('dbo.zip_zone','zone_code') IS NULL ALTER TABLE dbo.zip_zone ADD zone_code NVARCHAR(8);

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

IF COL_LENGTH('dbo.customer','first_name') IS NULL ALTER TABLE dbo.customer ADD first_name NVARCHAR(60);

IF COL_LENGTH('dbo.customer','last_name') IS NULL ALTER TABLE dbo.customer ADD last_name NVARCHAR(80);

IF COL_LENGTH('dbo.customer','display_name') IS NULL ALTER TABLE dbo.customer ADD display_name NVARCHAR(140);

IF COL_LENGTH('dbo.customer','phone_primary') IS NULL ALTER TABLE dbo.customer ADD phone_primary NVARCHAR(20);

IF COL_LENGTH('dbo.customer','phone_alt') IS NULL ALTER TABLE dbo.customer ADD phone_alt NVARCHAR(20);

IF COL_LENGTH('dbo.customer','email') IS NULL ALTER TABLE dbo.customer ADD email NVARCHAR(120);

IF COL_LENGTH('dbo.customer','contact_pref') IS NULL ALTER TABLE dbo.customer ADD contact_pref NVARCHAR(8);

IF COL_LENGTH('dbo.customer','stripe_customer_id') IS NULL ALTER TABLE dbo.customer ADD stripe_customer_id NVARCHAR(40);

IF COL_LENGTH('dbo.customer','is_landlord') IS NULL ALTER TABLE dbo.customer ADD is_landlord BIT;

IF COL_LENGTH('dbo.customer','is_property_manager') IS NULL ALTER TABLE dbo.customer ADD is_property_manager BIT;

IF COL_LENGTH('dbo.customer','epass_customer_code') IS NULL ALTER TABLE dbo.customer ADD epass_customer_code NVARCHAR(20);

IF COL_LENGTH('dbo.customer','notes') IS NULL ALTER TABLE dbo.customer ADD notes NVARCHAR(MAX);

IF COL_LENGTH('dbo.customer','created_at') IS NULL ALTER TABLE dbo.customer ADD created_at DATETIME2;

IF COL_LENGTH('dbo.customer','updated_at') IS NULL ALTER TABLE dbo.customer ADD updated_at DATETIME2;

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

IF COL_LENGTH('dbo.address','customer_id') IS NULL ALTER TABLE dbo.address ADD customer_id INT;

IF COL_LENGTH('dbo.address','line1') IS NULL ALTER TABLE dbo.address ADD line1 NVARCHAR(120);

IF COL_LENGTH('dbo.address','line2') IS NULL ALTER TABLE dbo.address ADD line2 NVARCHAR(60);

IF COL_LENGTH('dbo.address','city') IS NULL ALTER TABLE dbo.address ADD city NVARCHAR(60);

IF COL_LENGTH('dbo.address','state') IS NULL ALTER TABLE dbo.address ADD state NVARCHAR(2);

IF COL_LENGTH('dbo.address','zip') IS NULL ALTER TABLE dbo.address ADD zip NVARCHAR(10);

IF COL_LENGTH('dbo.address','lat') IS NULL ALTER TABLE dbo.address ADD lat DECIMAL(9,6);

IF COL_LENGTH('dbo.address','lng') IS NULL ALTER TABLE dbo.address ADD lng DECIMAL(9,6);

IF COL_LENGTH('dbo.address','geocode_source') IS NULL ALTER TABLE dbo.address ADD geocode_source NVARCHAR(8);

IF COL_LENGTH('dbo.address','gate_code') IS NULL ALTER TABLE dbo.address ADD gate_code NVARCHAR(20);

IF COL_LENGTH('dbo.address','access_notes') IS NULL ALTER TABLE dbo.address ADD access_notes NVARCHAR(MAX);

IF COL_LENGTH('dbo.address','zone_code') IS NULL ALTER TABLE dbo.address ADD zone_code NVARCHAR(8);

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
    updated_at DATETIME2,
    parts_eta DATE,
    est_minutes INT,
    penciled_date DATE,
    penciled_tech_id INT,
    pencil_reason NVARCHAR(200),
    pencil_set_at DATETIME2,
    source_ref NVARCHAR(60),
    card_ref NVARCHAR(60)
);

IF COL_LENGTH('dbo.job','sv_number') IS NULL ALTER TABLE dbo.job ADD sv_number NVARCHAR(20);

IF COL_LENGTH('dbo.job','customer_id') IS NULL ALTER TABLE dbo.job ADD customer_id INT;

IF COL_LENGTH('dbo.job','address_id') IS NULL ALTER TABLE dbo.job ADD address_id INT;

IF COL_LENGTH('dbo.job','status') IS NULL ALTER TABLE dbo.job ADD status NVARCHAR(16);

IF COL_LENGTH('dbo.job','status_changed_at') IS NULL ALTER TABLE dbo.job ADD status_changed_at DATETIME2;

IF COL_LENGTH('dbo.job','flags') IS NULL ALTER TABLE dbo.job ADD flags NVARCHAR(80);

IF COL_LENGTH('dbo.job','job_type') IS NULL ALTER TABLE dbo.job ADD job_type NVARCHAR(10);

IF COL_LENGTH('dbo.job','qualification') IS NULL ALTER TABLE dbo.job ADD qualification NVARCHAR(6);

IF COL_LENGTH('dbo.job','is_warranty') IS NULL ALTER TABLE dbo.job ADD is_warranty BIT;

IF COL_LENGTH('dbo.job','warranty_flags') IS NULL ALTER TABLE dbo.job ADD warranty_flags NVARCHAR(40);

IF COL_LENGTH('dbo.job','payment_type') IS NULL ALTER TABLE dbo.job ADD payment_type NVARCHAR(4);

IF COL_LENGTH('dbo.job','source') IS NULL ALTER TABLE dbo.job ADD source NVARCHAR(10);

IF COL_LENGTH('dbo.job','owner_tech_id') IS NULL ALTER TABLE dbo.job ADD owner_tech_id INT;

IF COL_LENGTH('dbo.job','assigned_tech_id') IS NULL ALTER TABLE dbo.job ADD assigned_tech_id INT;

IF COL_LENGTH('dbo.job','promised_window_start') IS NULL ALTER TABLE dbo.job ADD promised_window_start DATETIME2;

IF COL_LENGTH('dbo.job','promised_window_end') IS NULL ALTER TABLE dbo.job ADD promised_window_end DATETIME2;

IF COL_LENGTH('dbo.job','planned_slot_start') IS NULL ALTER TABLE dbo.job ADD planned_slot_start DATETIME2;

IF COL_LENGTH('dbo.job','planned_slot_end') IS NULL ALTER TABLE dbo.job ADD planned_slot_end DATETIME2;

IF COL_LENGTH('dbo.job','route_date') IS NULL ALTER TABLE dbo.job ADD route_date DATE;

IF COL_LENGTH('dbo.job','route_sequence') IS NULL ALTER TABLE dbo.job ADD route_sequence INT;

IF COL_LENGTH('dbo.job','route_locked') IS NULL ALTER TABLE dbo.job ADD route_locked BIT;

IF COL_LENGTH('dbo.job','trip_id') IS NULL ALTER TABLE dbo.job ADD trip_id INT;

IF COL_LENGTH('dbo.job','booking_mode') IS NULL ALTER TABLE dbo.job ADD booking_mode NVARCHAR(16);

IF COL_LENGTH('dbo.job','zone_code') IS NULL ALTER TABLE dbo.job ADD zone_code NVARCHAR(8);

IF COL_LENGTH('dbo.job','problem_text') IS NULL ALTER TABLE dbo.job ADD problem_text NVARCHAR(MAX);

IF COL_LENGTH('dbo.job','balance') IS NULL ALTER TABLE dbo.job ADD balance DECIMAL(10,2);

IF COL_LENGTH('dbo.job','total') IS NULL ALTER TABLE dbo.job ADD total DECIMAL(10,2);

IF COL_LENGTH('dbo.job','bin_location') IS NULL ALTER TABLE dbo.job ADD bin_location NVARCHAR(10);

IF COL_LENGTH('dbo.job','units') IS NULL ALTER TABLE dbo.job ADD units INT;

IF COL_LENGTH('dbo.job','epass_status') IS NULL ALTER TABLE dbo.job ADD epass_status NVARCHAR(16);

IF COL_LENGTH('dbo.job','epass_route_date') IS NULL ALTER TABLE dbo.job ADD epass_route_date DATE;

IF COL_LENGTH('dbo.job','epass_tech_code') IS NULL ALTER TABLE dbo.job ADD epass_tech_code NVARCHAR(8);

IF COL_LENGTH('dbo.job','epass_seen_at') IS NULL ALTER TABLE dbo.job ADD epass_seen_at DATETIME2;

IF COL_LENGTH('dbo.job','epass_source') IS NULL ALTER TABLE dbo.job ADD epass_source NVARCHAR(4);

IF COL_LENGTH('dbo.job','epass_invoice_status') IS NULL ALTER TABLE dbo.job ADD epass_invoice_status NVARCHAR(12);

IF COL_LENGTH('dbo.job','epass_finish_date') IS NULL ALTER TABLE dbo.job ADD epass_finish_date DATE;

IF COL_LENGTH('dbo.job','epass_created_at') IS NULL ALTER TABLE dbo.job ADD epass_created_at DATE;

IF COL_LENGTH('dbo.job','in_feed') IS NULL ALTER TABLE dbo.job ADD in_feed BIT;

IF COL_LENGTH('dbo.job','stale') IS NULL ALTER TABLE dbo.job ADD stale BIT;

IF COL_LENGTH('dbo.job','needs_intake_review') IS NULL ALTER TABLE dbo.job ADD needs_intake_review BIT;

IF COL_LENGTH('dbo.job','closed_at') IS NULL ALTER TABLE dbo.job ADD closed_at DATETIME2;

IF COL_LENGTH('dbo.job','cancel_reason') IS NULL ALTER TABLE dbo.job ADD cancel_reason NVARCHAR(60);

IF COL_LENGTH('dbo.job','created_at') IS NULL ALTER TABLE dbo.job ADD created_at DATETIME2;

IF COL_LENGTH('dbo.job','updated_at') IS NULL ALTER TABLE dbo.job ADD updated_at DATETIME2;

IF COL_LENGTH('dbo.job','parts_eta') IS NULL ALTER TABLE dbo.job ADD parts_eta DATE;

IF COL_LENGTH('dbo.job','est_minutes') IS NULL ALTER TABLE dbo.job ADD est_minutes INT;

IF COL_LENGTH('dbo.job','penciled_date') IS NULL ALTER TABLE dbo.job ADD penciled_date DATE;

IF COL_LENGTH('dbo.job','penciled_tech_id') IS NULL ALTER TABLE dbo.job ADD penciled_tech_id INT;

IF COL_LENGTH('dbo.job','pencil_reason') IS NULL ALTER TABLE dbo.job ADD pencil_reason NVARCHAR(200);

IF COL_LENGTH('dbo.job','pencil_set_at') IS NULL ALTER TABLE dbo.job ADD pencil_set_at DATETIME2;

IF COL_LENGTH('dbo.job','source_ref') IS NULL ALTER TABLE dbo.job ADD source_ref NVARCHAR(60);

IF COL_LENGTH('dbo.job','card_ref') IS NULL ALTER TABLE dbo.job ADD card_ref NVARCHAR(60);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_job_sv_number')
CREATE UNIQUE INDEX ux_job_sv_number ON dbo.job(sv_number) WHERE sv_number IS NOT NULL;

IF OBJECT_ID('dbo.placement_log','U') IS NULL
CREATE TABLE dbo.placement_log (
    placement_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    kind NVARCHAR(10),
    suggested_at DATETIME2,
    suggested_tech_id INT,
    suggested_date DATE,
    suggested_window NVARCHAR(2),
    cost_min INT,
    why NVARCHAR(240),
    candidates_json NVARCHAR(MAX),
    actual_tech_id INT,
    actual_date DATE,
    actual_at DATETIME2,
    actual_source NVARCHAR(10),
    agree_day BIT,
    agree_tech BIT,
    note NVARCHAR(200)
);

IF COL_LENGTH('dbo.placement_log','job_id') IS NULL ALTER TABLE dbo.placement_log ADD job_id INT;

IF COL_LENGTH('dbo.placement_log','kind') IS NULL ALTER TABLE dbo.placement_log ADD kind NVARCHAR(10);

IF COL_LENGTH('dbo.placement_log','suggested_at') IS NULL ALTER TABLE dbo.placement_log ADD suggested_at DATETIME2;

IF COL_LENGTH('dbo.placement_log','suggested_tech_id') IS NULL ALTER TABLE dbo.placement_log ADD suggested_tech_id INT;

IF COL_LENGTH('dbo.placement_log','suggested_date') IS NULL ALTER TABLE dbo.placement_log ADD suggested_date DATE;

IF COL_LENGTH('dbo.placement_log','suggested_window') IS NULL ALTER TABLE dbo.placement_log ADD suggested_window NVARCHAR(2);

IF COL_LENGTH('dbo.placement_log','cost_min') IS NULL ALTER TABLE dbo.placement_log ADD cost_min INT;

IF COL_LENGTH('dbo.placement_log','why') IS NULL ALTER TABLE dbo.placement_log ADD why NVARCHAR(240);

IF COL_LENGTH('dbo.placement_log','candidates_json') IS NULL ALTER TABLE dbo.placement_log ADD candidates_json NVARCHAR(MAX);

IF COL_LENGTH('dbo.placement_log','actual_tech_id') IS NULL ALTER TABLE dbo.placement_log ADD actual_tech_id INT;

IF COL_LENGTH('dbo.placement_log','actual_date') IS NULL ALTER TABLE dbo.placement_log ADD actual_date DATE;

IF COL_LENGTH('dbo.placement_log','actual_at') IS NULL ALTER TABLE dbo.placement_log ADD actual_at DATETIME2;

IF COL_LENGTH('dbo.placement_log','actual_source') IS NULL ALTER TABLE dbo.placement_log ADD actual_source NVARCHAR(10);

IF COL_LENGTH('dbo.placement_log','agree_day') IS NULL ALTER TABLE dbo.placement_log ADD agree_day BIT;

IF COL_LENGTH('dbo.placement_log','agree_tech') IS NULL ALTER TABLE dbo.placement_log ADD agree_tech BIT;

IF COL_LENGTH('dbo.placement_log','note') IS NULL ALTER TABLE dbo.placement_log ADD note NVARCHAR(200);

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

IF COL_LENGTH('dbo.unit','job_id') IS NULL ALTER TABLE dbo.unit ADD job_id INT;

IF COL_LENGTH('dbo.unit','category') IS NULL ALTER TABLE dbo.unit ADD category NVARCHAR(40);

IF COL_LENGTH('dbo.unit','install_type') IS NULL ALTER TABLE dbo.unit ADD install_type NVARCHAR(12);

IF COL_LENGTH('dbo.unit','brand') IS NULL ALTER TABLE dbo.unit ADD brand NVARCHAR(40);

IF COL_LENGTH('dbo.unit','model') IS NULL ALTER TABLE dbo.unit ADD model NVARCHAR(60);

IF COL_LENGTH('dbo.unit','serial') IS NULL ALTER TABLE dbo.unit ADD serial NVARCHAR(60);

IF COL_LENGTH('dbo.unit','problem_text') IS NULL ALTER TABLE dbo.unit ADD problem_text NVARCHAR(MAX);

IF COL_LENGTH('dbo.unit','raw_detail') IS NULL ALTER TABLE dbo.unit ADD raw_detail NVARCHAR(MAX);

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

IF COL_LENGTH('dbo.status_history','job_id') IS NULL ALTER TABLE dbo.status_history ADD job_id INT;

IF COL_LENGTH('dbo.status_history','from_status') IS NULL ALTER TABLE dbo.status_history ADD from_status NVARCHAR(16);

IF COL_LENGTH('dbo.status_history','to_status') IS NULL ALTER TABLE dbo.status_history ADD to_status NVARCHAR(16);

IF COL_LENGTH('dbo.status_history','changed_at') IS NULL ALTER TABLE dbo.status_history ADD changed_at DATETIME2;

IF COL_LENGTH('dbo.status_history','actor_type') IS NULL ALTER TABLE dbo.status_history ADD actor_type NVARCHAR(10);

IF COL_LENGTH('dbo.status_history','actor_id') IS NULL ALTER TABLE dbo.status_history ADD actor_id NVARCHAR(40);

IF COL_LENGTH('dbo.status_history','trigger_event') IS NULL ALTER TABLE dbo.status_history ADD trigger_event NVARCHAR(60);

IF COL_LENGTH('dbo.status_history','reason_code') IS NULL ALTER TABLE dbo.status_history ADD reason_code NVARCHAR(40);

IF COL_LENGTH('dbo.status_history','note') IS NULL ALTER TABLE dbo.status_history ADD note NVARCHAR(MAX);

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

IF COL_LENGTH('dbo.import_batch','source') IS NULL ALTER TABLE dbo.import_batch ADD source NVARCHAR(16);

IF COL_LENGTH('dbo.import_batch','file_name') IS NULL ALTER TABLE dbo.import_batch ADD file_name NVARCHAR(255);

IF COL_LENGTH('dbo.import_batch','file_path') IS NULL ALTER TABLE dbo.import_batch ADD file_path NVARCHAR(MAX);

IF COL_LENGTH('dbo.import_batch','file_modified_at') IS NULL ALTER TABLE dbo.import_batch ADD file_modified_at DATETIME2;

IF COL_LENGTH('dbo.import_batch','imported_at') IS NULL ALTER TABLE dbo.import_batch ADD imported_at DATETIME2;

IF COL_LENGTH('dbo.import_batch','row_count') IS NULL ALTER TABLE dbo.import_batch ADD row_count INT;

IF COL_LENGTH('dbo.import_batch','sv_count') IS NULL ALTER TABLE dbo.import_batch ADD sv_count INT;

IF COL_LENGTH('dbo.import_batch','created_count') IS NULL ALTER TABLE dbo.import_batch ADD created_count INT;

IF COL_LENGTH('dbo.import_batch','updated_count') IS NULL ALTER TABLE dbo.import_batch ADD updated_count INT;

IF COL_LENGTH('dbo.import_batch','status') IS NULL ALTER TABLE dbo.import_batch ADD status NVARCHAR(12);

IF COL_LENGTH('dbo.import_batch','message') IS NULL ALTER TABLE dbo.import_batch ADD message NVARCHAR(MAX);

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

IF COL_LENGTH('dbo.import_row_raw','import_batch_id') IS NULL ALTER TABLE dbo.import_row_raw ADD import_batch_id INT;

IF COL_LENGTH('dbo.import_row_raw','order_number') IS NULL ALTER TABLE dbo.import_row_raw ADD order_number NVARCHAR(20);

IF COL_LENGTH('dbo.import_row_raw','line_no') IS NULL ALTER TABLE dbo.import_row_raw ADD line_no INT;

IF COL_LENGTH('dbo.import_row_raw','job_status') IS NULL ALTER TABLE dbo.import_row_raw ADD job_status NVARCHAR(16);

IF COL_LENGTH('dbo.import_row_raw','delivery_date') IS NULL ALTER TABLE dbo.import_row_raw ADD delivery_date DATE;

IF COL_LENGTH('dbo.import_row_raw','truck') IS NULL ALTER TABLE dbo.import_row_raw ADD truck NVARCHAR(8);

IF COL_LENGTH('dbo.import_row_raw','map_zone') IS NULL ALTER TABLE dbo.import_row_raw ADD map_zone NVARCHAR(8);

IF COL_LENGTH('dbo.import_row_raw','model') IS NULL ALTER TABLE dbo.import_row_raw ADD model NVARCHAR(60);

IF COL_LENGTH('dbo.import_row_raw','description') IS NULL ALTER TABLE dbo.import_row_raw ADD description NVARCHAR(MAX);

IF COL_LENGTH('dbo.import_row_raw','quantity') IS NULL ALTER TABLE dbo.import_row_raw ADD quantity DECIMAL(9,2);

IF COL_LENGTH('dbo.import_row_raw','amount') IS NULL ALTER TABLE dbo.import_row_raw ADD amount DECIMAL(10,2);

IF COL_LENGTH('dbo.import_row_raw','row_json') IS NULL ALTER TABLE dbo.import_row_raw ADD row_json NVARCHAR(MAX);

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

IF COL_LENGTH('dbo.sync_item','job_id') IS NULL ALTER TABLE dbo.sync_item ADD job_id INT;

IF COL_LENGTH('dbo.sync_item','sv_number') IS NULL ALTER TABLE dbo.sync_item ADD sv_number NVARCHAR(20);

IF COL_LENGTH('dbo.sync_item','kind') IS NULL ALTER TABLE dbo.sync_item ADD kind NVARCHAR(16);

IF COL_LENGTH('dbo.sync_item','payload') IS NULL ALTER TABLE dbo.sync_item ADD payload NVARCHAR(MAX);

IF COL_LENGTH('dbo.sync_item','packet_text') IS NULL ALTER TABLE dbo.sync_item ADD packet_text NVARCHAR(MAX);

IF COL_LENGTH('dbo.sync_item','state') IS NULL ALTER TABLE dbo.sync_item ADD state NVARCHAR(12);

IF COL_LENGTH('dbo.sync_item','created_at') IS NULL ALTER TABLE dbo.sync_item ADD created_at DATETIME2;

IF COL_LENGTH('dbo.sync_item','keyed_at') IS NULL ALTER TABLE dbo.sync_item ADD keyed_at DATETIME2;

IF COL_LENGTH('dbo.sync_item','keyed_by') IS NULL ALTER TABLE dbo.sync_item ADD keyed_by NVARCHAR(60);

IF COL_LENGTH('dbo.sync_item','confirmed_at') IS NULL ALTER TABLE dbo.sync_item ADD confirmed_at DATETIME2;

IF COL_LENGTH('dbo.sync_item','confirmed_by_import_id') IS NULL ALTER TABLE dbo.sync_item ADD confirmed_by_import_id INT;

IF COL_LENGTH('dbo.sync_item','epass_values') IS NULL ALTER TABLE dbo.sync_item ADD epass_values NVARCHAR(MAX);

IF COL_LENGTH('dbo.sync_item','mismatch_count') IS NULL ALTER TABLE dbo.sync_item ADD mismatch_count INT;

IF COL_LENGTH('dbo.sync_item','resolved_at') IS NULL ALTER TABLE dbo.sync_item ADD resolved_at DATETIME2;

IF COL_LENGTH('dbo.sync_item','resolved_by') IS NULL ALTER TABLE dbo.sync_item ADD resolved_by NVARCHAR(60);

IF COL_LENGTH('dbo.sync_item','resolution') IS NULL ALTER TABLE dbo.sync_item ADD resolution NVARCHAR(16);

IF COL_LENGTH('dbo.sync_item','note') IS NULL ALTER TABLE dbo.sync_item ADD note NVARCHAR(MAX);

IF OBJECT_ID('dbo.outbox','U') IS NULL
CREATE TABLE dbo.outbox (
    outbox_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    effect NVARCHAR(40),
    payload NVARCHAR(MAX),
    created_at DATETIME2,
    handled_at DATETIME2
);

IF COL_LENGTH('dbo.outbox','job_id') IS NULL ALTER TABLE dbo.outbox ADD job_id INT;

IF COL_LENGTH('dbo.outbox','effect') IS NULL ALTER TABLE dbo.outbox ADD effect NVARCHAR(40);

IF COL_LENGTH('dbo.outbox','payload') IS NULL ALTER TABLE dbo.outbox ADD payload NVARCHAR(MAX);

IF COL_LENGTH('dbo.outbox','created_at') IS NULL ALTER TABLE dbo.outbox ADD created_at DATETIME2;

IF COL_LENGTH('dbo.outbox','handled_at') IS NULL ALTER TABLE dbo.outbox ADD handled_at DATETIME2;

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

IF COL_LENGTH('dbo.audit_log','logged_at') IS NULL ALTER TABLE dbo.audit_log ADD logged_at DATETIME2;

IF COL_LENGTH('dbo.audit_log','user_id') IS NULL ALTER TABLE dbo.audit_log ADD user_id NVARCHAR(60);

IF COL_LENGTH('dbo.audit_log','action') IS NULL ALTER TABLE dbo.audit_log ADD action NVARCHAR(60);

IF COL_LENGTH('dbo.audit_log','entity') IS NULL ALTER TABLE dbo.audit_log ADD entity NVARCHAR(30);

IF COL_LENGTH('dbo.audit_log','entity_id') IS NULL ALTER TABLE dbo.audit_log ADD entity_id NVARCHAR(40);

IF COL_LENGTH('dbo.audit_log','before_json') IS NULL ALTER TABLE dbo.audit_log ADD before_json NVARCHAR(MAX);

IF COL_LENGTH('dbo.audit_log','after_json') IS NULL ALTER TABLE dbo.audit_log ADD after_json NVARCHAR(MAX);

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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_penciled')
CREATE INDEX ix_job_penciled ON dbo.job(penciled_tech_id, penciled_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_source_ref')
CREATE INDEX ix_job_source_ref ON dbo.job(source_ref);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_placement_job')
CREATE INDEX ix_placement_job ON dbo.placement_log(job_id, kind);

