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
    active BIT,
    first_service DATE,
    last_service DATE,
    lifecycle NVARCHAR(12),
    ended_on DATE,
    home_lat DECIMAL(9,6),
    home_lng DECIMAL(9,6),
    retire_on DATE
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

IF COL_LENGTH('dbo.tech','first_service') IS NULL ALTER TABLE dbo.tech ADD first_service DATE;

IF COL_LENGTH('dbo.tech','last_service') IS NULL ALTER TABLE dbo.tech ADD last_service DATE;

IF COL_LENGTH('dbo.tech','lifecycle') IS NULL ALTER TABLE dbo.tech ADD lifecycle NVARCHAR(12);

IF COL_LENGTH('dbo.tech','ended_on') IS NULL ALTER TABLE dbo.tech ADD ended_on DATE;

IF COL_LENGTH('dbo.tech','home_lat') IS NULL ALTER TABLE dbo.tech ADD home_lat DECIMAL(9,6);

IF COL_LENGTH('dbo.tech','home_lng') IS NULL ALTER TABLE dbo.tech ADD home_lng DECIMAL(9,6);

IF COL_LENGTH('dbo.tech','retire_on') IS NULL ALTER TABLE dbo.tech ADD retire_on DATE;

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
    needs_review BIT,
    fee_band INT
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

IF COL_LENGTH('dbo.zone','fee_band') IS NULL ALTER TABLE dbo.zone ADD fee_band INT;

IF OBJECT_ID('dbo.zip_zone','U') IS NULL
CREATE TABLE dbo.zip_zone (
    zip NVARCHAR(5) NOT NULL PRIMARY KEY,
    zone_code NVARCHAR(8)
);

IF COL_LENGTH('dbo.zip_zone','zone_code') IS NULL ALTER TABLE dbo.zip_zone ADD zone_code NVARCHAR(8);

IF OBJECT_ID('dbo.damage_report','U') IS NULL
CREATE TABLE dbo.damage_report (
    report_id INT IDENTITY(1,1) PRIMARY KEY,
    reported_by NVARCHAR(60),
    reported_at DATETIME2,
    truck NVARCHAR(8),
    invoice_code NVARCHAR(20),
    customer_name NVARCHAR(140),
    address NVARCHAR(200),
    zip NVARCHAR(10),
    brand NVARCHAR(40),
    model NVARCHAR(60),
    serial NVARCHAR(60),
    issue NVARCHAR(60),
    side NVARCHAR(20),
    spot NVARCHAR(20),
    note NVARCHAR(500),
    photo_count INT,
    state NVARCHAR(10),
    job_id INT,
    part_number NVARCHAR(40),
    part_desc NVARCHAR(120),
    reviewed_by NVARCHAR(60),
    reviewed_at DATETIME2,
    created_at DATETIME2,
    updated_at DATETIME2
);

IF COL_LENGTH('dbo.damage_report','reported_by') IS NULL ALTER TABLE dbo.damage_report ADD reported_by NVARCHAR(60);

IF COL_LENGTH('dbo.damage_report','reported_at') IS NULL ALTER TABLE dbo.damage_report ADD reported_at DATETIME2;

IF COL_LENGTH('dbo.damage_report','truck') IS NULL ALTER TABLE dbo.damage_report ADD truck NVARCHAR(8);

IF COL_LENGTH('dbo.damage_report','invoice_code') IS NULL ALTER TABLE dbo.damage_report ADD invoice_code NVARCHAR(20);

IF COL_LENGTH('dbo.damage_report','customer_name') IS NULL ALTER TABLE dbo.damage_report ADD customer_name NVARCHAR(140);

IF COL_LENGTH('dbo.damage_report','address') IS NULL ALTER TABLE dbo.damage_report ADD address NVARCHAR(200);

IF COL_LENGTH('dbo.damage_report','zip') IS NULL ALTER TABLE dbo.damage_report ADD zip NVARCHAR(10);

IF COL_LENGTH('dbo.damage_report','brand') IS NULL ALTER TABLE dbo.damage_report ADD brand NVARCHAR(40);

IF COL_LENGTH('dbo.damage_report','model') IS NULL ALTER TABLE dbo.damage_report ADD model NVARCHAR(60);

IF COL_LENGTH('dbo.damage_report','serial') IS NULL ALTER TABLE dbo.damage_report ADD serial NVARCHAR(60);

IF COL_LENGTH('dbo.damage_report','issue') IS NULL ALTER TABLE dbo.damage_report ADD issue NVARCHAR(60);

IF COL_LENGTH('dbo.damage_report','side') IS NULL ALTER TABLE dbo.damage_report ADD side NVARCHAR(20);

IF COL_LENGTH('dbo.damage_report','spot') IS NULL ALTER TABLE dbo.damage_report ADD spot NVARCHAR(20);

IF COL_LENGTH('dbo.damage_report','note') IS NULL ALTER TABLE dbo.damage_report ADD note NVARCHAR(500);

IF COL_LENGTH('dbo.damage_report','photo_count') IS NULL ALTER TABLE dbo.damage_report ADD photo_count INT;

IF COL_LENGTH('dbo.damage_report','state') IS NULL ALTER TABLE dbo.damage_report ADD state NVARCHAR(10);

IF COL_LENGTH('dbo.damage_report','job_id') IS NULL ALTER TABLE dbo.damage_report ADD job_id INT;

IF COL_LENGTH('dbo.damage_report','part_number') IS NULL ALTER TABLE dbo.damage_report ADD part_number NVARCHAR(40);

IF COL_LENGTH('dbo.damage_report','part_desc') IS NULL ALTER TABLE dbo.damage_report ADD part_desc NVARCHAR(120);

IF COL_LENGTH('dbo.damage_report','reviewed_by') IS NULL ALTER TABLE dbo.damage_report ADD reviewed_by NVARCHAR(60);

IF COL_LENGTH('dbo.damage_report','reviewed_at') IS NULL ALTER TABLE dbo.damage_report ADD reviewed_at DATETIME2;

IF COL_LENGTH('dbo.damage_report','created_at') IS NULL ALTER TABLE dbo.damage_report ADD created_at DATETIME2;

IF COL_LENGTH('dbo.damage_report','updated_at') IS NULL ALTER TABLE dbo.damage_report ADD updated_at DATETIME2;

IF OBJECT_ID('dbo.findings','U') IS NULL
CREATE TABLE dbo.findings (
    findings_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    unit_id INT,
    tech_id INT,
    visit_date DATE,
    outcome NVARCHAR(20),
    to_status NVARCHAR(16),
    symptoms NVARCHAR(MAX),
    error_code NVARCHAR(20),
    cause NVARCHAR(120),
    custom_note NVARCHAR(MAX),
    note NVARCHAR(MAX),
    parts_json NVARCHAR(MAX),
    labor_json NVARCHAR(MAX),
    flags NVARCHAR(200),
    performed_text NVARCHAR(MAX),
    on_site_minutes INT,
    photo_count INT,
    submitted_at DATETIME2
);

IF COL_LENGTH('dbo.findings','job_id') IS NULL ALTER TABLE dbo.findings ADD job_id INT;

IF COL_LENGTH('dbo.findings','unit_id') IS NULL ALTER TABLE dbo.findings ADD unit_id INT;

IF COL_LENGTH('dbo.findings','tech_id') IS NULL ALTER TABLE dbo.findings ADD tech_id INT;

IF COL_LENGTH('dbo.findings','visit_date') IS NULL ALTER TABLE dbo.findings ADD visit_date DATE;

IF COL_LENGTH('dbo.findings','outcome') IS NULL ALTER TABLE dbo.findings ADD outcome NVARCHAR(20);

IF COL_LENGTH('dbo.findings','to_status') IS NULL ALTER TABLE dbo.findings ADD to_status NVARCHAR(16);

IF COL_LENGTH('dbo.findings','symptoms') IS NULL ALTER TABLE dbo.findings ADD symptoms NVARCHAR(MAX);

IF COL_LENGTH('dbo.findings','error_code') IS NULL ALTER TABLE dbo.findings ADD error_code NVARCHAR(20);

IF COL_LENGTH('dbo.findings','cause') IS NULL ALTER TABLE dbo.findings ADD cause NVARCHAR(120);

IF COL_LENGTH('dbo.findings','custom_note') IS NULL ALTER TABLE dbo.findings ADD custom_note NVARCHAR(MAX);

IF COL_LENGTH('dbo.findings','note') IS NULL ALTER TABLE dbo.findings ADD note NVARCHAR(MAX);

IF COL_LENGTH('dbo.findings','parts_json') IS NULL ALTER TABLE dbo.findings ADD parts_json NVARCHAR(MAX);

IF COL_LENGTH('dbo.findings','labor_json') IS NULL ALTER TABLE dbo.findings ADD labor_json NVARCHAR(MAX);

IF COL_LENGTH('dbo.findings','flags') IS NULL ALTER TABLE dbo.findings ADD flags NVARCHAR(200);

IF COL_LENGTH('dbo.findings','performed_text') IS NULL ALTER TABLE dbo.findings ADD performed_text NVARCHAR(MAX);

IF COL_LENGTH('dbo.findings','on_site_minutes') IS NULL ALTER TABLE dbo.findings ADD on_site_minutes INT;

IF COL_LENGTH('dbo.findings','photo_count') IS NULL ALTER TABLE dbo.findings ADD photo_count INT;

IF COL_LENGTH('dbo.findings','submitted_at') IS NULL ALTER TABLE dbo.findings ADD submitted_at DATETIME2;

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
    updated_at DATETIME2,
    do_not_service BIT,
    do_not_service_note NVARCHAR(200),
    do_not_service_set_by NVARCHAR(60),
    do_not_service_set_at DATETIME2,
    household_key NVARCHAR(80),
    service_count INT,
    first_service DATE,
    last_service DATE,
    lifetime_value DECIMAL(10,2)
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

IF COL_LENGTH('dbo.customer','do_not_service') IS NULL ALTER TABLE dbo.customer ADD do_not_service BIT;

IF COL_LENGTH('dbo.customer','do_not_service_note') IS NULL ALTER TABLE dbo.customer ADD do_not_service_note NVARCHAR(200);

IF COL_LENGTH('dbo.customer','do_not_service_set_by') IS NULL ALTER TABLE dbo.customer ADD do_not_service_set_by NVARCHAR(60);

IF COL_LENGTH('dbo.customer','do_not_service_set_at') IS NULL ALTER TABLE dbo.customer ADD do_not_service_set_at DATETIME2;

IF COL_LENGTH('dbo.customer','household_key') IS NULL ALTER TABLE dbo.customer ADD household_key NVARCHAR(80);

IF COL_LENGTH('dbo.customer','service_count') IS NULL ALTER TABLE dbo.customer ADD service_count INT;

IF COL_LENGTH('dbo.customer','first_service') IS NULL ALTER TABLE dbo.customer ADD first_service DATE;

IF COL_LENGTH('dbo.customer','last_service') IS NULL ALTER TABLE dbo.customer ADD last_service DATE;

IF COL_LENGTH('dbo.customer','lifetime_value') IS NULL ALTER TABLE dbo.customer ADD lifetime_value DECIMAL(10,2);

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
    zone_code NVARCHAR(8),
    address_key NVARCHAR(80)
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

IF COL_LENGTH('dbo.address','address_key') IS NULL ALTER TABLE dbo.address ADD address_key NVARCHAR(80);

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
    card_ref NVARCHAR(60),
    tracker_token NVARCHAR(16),
    tracker_token_at DATETIME2,
    tracker_token_by NVARCHAR(60),
    shop_json NVARCHAR(MAX)
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

IF COL_LENGTH('dbo.job','tracker_token') IS NULL ALTER TABLE dbo.job ADD tracker_token NVARCHAR(16);

IF COL_LENGTH('dbo.job','tracker_token_at') IS NULL ALTER TABLE dbo.job ADD tracker_token_at DATETIME2;

IF COL_LENGTH('dbo.job','tracker_token_by') IS NULL ALTER TABLE dbo.job ADD tracker_token_by NVARCHAR(60);

IF COL_LENGTH('dbo.job','shop_json') IS NULL ALTER TABLE dbo.job ADD shop_json NVARCHAR(MAX);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_job_sv_number')
CREATE UNIQUE INDEX ux_job_sv_number ON dbo.job(sv_number) WHERE sv_number IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_job_tracker_token')
CREATE UNIQUE INDEX ux_job_tracker_token ON dbo.job(tracker_token) WHERE tracker_token IS NOT NULL;

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
    asset_id INT,
    category NVARCHAR(40),
    install_type NVARCHAR(12),
    brand NVARCHAR(40),
    model NVARCHAR(60),
    serial NVARCHAR(60),
    problem_text NVARCHAR(MAX),
    raw_detail NVARCHAR(MAX)
);

IF COL_LENGTH('dbo.unit','job_id') IS NULL ALTER TABLE dbo.unit ADD job_id INT;

IF COL_LENGTH('dbo.unit','asset_id') IS NULL ALTER TABLE dbo.unit ADD asset_id INT;

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

IF OBJECT_ID('dbo.payer','U') IS NULL
CREATE TABLE dbo.payer (
    payer_id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(40),
    name NVARCHAR(120),
    customer_id INT,
    kind NVARCHAR(16),
    created_at DATETIME2
);

IF COL_LENGTH('dbo.payer','code') IS NULL ALTER TABLE dbo.payer ADD code NVARCHAR(40);

IF COL_LENGTH('dbo.payer','name') IS NULL ALTER TABLE dbo.payer ADD name NVARCHAR(120);

IF COL_LENGTH('dbo.payer','customer_id') IS NULL ALTER TABLE dbo.payer ADD customer_id INT;

IF COL_LENGTH('dbo.payer','kind') IS NULL ALTER TABLE dbo.payer ADD kind NVARCHAR(16);

IF COL_LENGTH('dbo.payer','created_at') IS NULL ALTER TABLE dbo.payer ADD created_at DATETIME2;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_payer_code')
CREATE UNIQUE INDEX ux_payer_code ON dbo.payer(code) WHERE code IS NOT NULL;

IF OBJECT_ID('dbo.asset','U') IS NULL
CREATE TABLE dbo.asset (
    asset_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT,
    serial NVARCHAR(60),
    brand NVARCHAR(40),
    model NVARCHAR(60),
    category NVARCHAR(40),
    install_type NVARCHAR(12),
    first_seen DATE,
    last_seen DATE,
    service_count INT,
    purchased_from_us BIT,
    purchase_date DATE,
    purchase_price DECIMAL(10,2),
    purchase_invoice NVARCHAR(20),
    retired_at DATE,
    note NVARCHAR(MAX)
);

IF COL_LENGTH('dbo.asset','customer_id') IS NULL ALTER TABLE dbo.asset ADD customer_id INT;

IF COL_LENGTH('dbo.asset','serial') IS NULL ALTER TABLE dbo.asset ADD serial NVARCHAR(60);

IF COL_LENGTH('dbo.asset','brand') IS NULL ALTER TABLE dbo.asset ADD brand NVARCHAR(40);

IF COL_LENGTH('dbo.asset','model') IS NULL ALTER TABLE dbo.asset ADD model NVARCHAR(60);

IF COL_LENGTH('dbo.asset','category') IS NULL ALTER TABLE dbo.asset ADD category NVARCHAR(40);

IF COL_LENGTH('dbo.asset','install_type') IS NULL ALTER TABLE dbo.asset ADD install_type NVARCHAR(12);

IF COL_LENGTH('dbo.asset','first_seen') IS NULL ALTER TABLE dbo.asset ADD first_seen DATE;

IF COL_LENGTH('dbo.asset','last_seen') IS NULL ALTER TABLE dbo.asset ADD last_seen DATE;

IF COL_LENGTH('dbo.asset','service_count') IS NULL ALTER TABLE dbo.asset ADD service_count INT;

IF COL_LENGTH('dbo.asset','purchased_from_us') IS NULL ALTER TABLE dbo.asset ADD purchased_from_us BIT;

IF COL_LENGTH('dbo.asset','purchase_date') IS NULL ALTER TABLE dbo.asset ADD purchase_date DATE;

IF COL_LENGTH('dbo.asset','purchase_price') IS NULL ALTER TABLE dbo.asset ADD purchase_price DECIMAL(10,2);

IF COL_LENGTH('dbo.asset','purchase_invoice') IS NULL ALTER TABLE dbo.asset ADD purchase_invoice NVARCHAR(20);

IF COL_LENGTH('dbo.asset','retired_at') IS NULL ALTER TABLE dbo.asset ADD retired_at DATE;

IF COL_LENGTH('dbo.asset','note') IS NULL ALTER TABLE dbo.asset ADD note NVARCHAR(MAX);

IF OBJECT_ID('dbo.service_history','U') IS NULL
CREATE TABLE dbo.service_history (
    sv_number NVARCHAR(20) NOT NULL PRIMARY KEY,
    customer_id INT,
    payer_id INT,
    asset_id INT,
    epass_status NVARCHAR(16),
    epass_state NVARCHAR(20),
    created_date DATE,
    sched_date DATE,
    finish_date DATE,
    sp_code NVARCHAR(8),
    route_code NVARCHAR(8),
    map_zone NVARCHAR(8),
    zip NVARCHAR(10),
    total DECIMAL(10,2),
    balance DECIMAL(10,2),
    payment_type NVARCHAR(8),
    units INT,
    qualification NVARCHAR(20),
    priorities NVARCHAR(60),
    reference NVARCHAR(60),
    spec_auth NVARCHAR(40),
    po_number NVARCHAR(40),
    name_raw NVARCHAR(140),
    address_raw NVARCHAR(120),
    identity_source NVARCHAR(16),
    ticket_kind NVARCHAR(10),
    imported_at DATETIME2
);

IF COL_LENGTH('dbo.service_history','customer_id') IS NULL ALTER TABLE dbo.service_history ADD customer_id INT;

IF COL_LENGTH('dbo.service_history','payer_id') IS NULL ALTER TABLE dbo.service_history ADD payer_id INT;

IF COL_LENGTH('dbo.service_history','asset_id') IS NULL ALTER TABLE dbo.service_history ADD asset_id INT;

IF COL_LENGTH('dbo.service_history','epass_status') IS NULL ALTER TABLE dbo.service_history ADD epass_status NVARCHAR(16);

IF COL_LENGTH('dbo.service_history','epass_state') IS NULL ALTER TABLE dbo.service_history ADD epass_state NVARCHAR(20);

IF COL_LENGTH('dbo.service_history','created_date') IS NULL ALTER TABLE dbo.service_history ADD created_date DATE;

IF COL_LENGTH('dbo.service_history','sched_date') IS NULL ALTER TABLE dbo.service_history ADD sched_date DATE;

IF COL_LENGTH('dbo.service_history','finish_date') IS NULL ALTER TABLE dbo.service_history ADD finish_date DATE;

IF COL_LENGTH('dbo.service_history','sp_code') IS NULL ALTER TABLE dbo.service_history ADD sp_code NVARCHAR(8);

IF COL_LENGTH('dbo.service_history','route_code') IS NULL ALTER TABLE dbo.service_history ADD route_code NVARCHAR(8);

IF COL_LENGTH('dbo.service_history','map_zone') IS NULL ALTER TABLE dbo.service_history ADD map_zone NVARCHAR(8);

IF COL_LENGTH('dbo.service_history','zip') IS NULL ALTER TABLE dbo.service_history ADD zip NVARCHAR(10);

IF COL_LENGTH('dbo.service_history','total') IS NULL ALTER TABLE dbo.service_history ADD total DECIMAL(10,2);

IF COL_LENGTH('dbo.service_history','balance') IS NULL ALTER TABLE dbo.service_history ADD balance DECIMAL(10,2);

IF COL_LENGTH('dbo.service_history','payment_type') IS NULL ALTER TABLE dbo.service_history ADD payment_type NVARCHAR(8);

IF COL_LENGTH('dbo.service_history','units') IS NULL ALTER TABLE dbo.service_history ADD units INT;

IF COL_LENGTH('dbo.service_history','qualification') IS NULL ALTER TABLE dbo.service_history ADD qualification NVARCHAR(20);

IF COL_LENGTH('dbo.service_history','priorities') IS NULL ALTER TABLE dbo.service_history ADD priorities NVARCHAR(60);

IF COL_LENGTH('dbo.service_history','reference') IS NULL ALTER TABLE dbo.service_history ADD reference NVARCHAR(60);

IF COL_LENGTH('dbo.service_history','spec_auth') IS NULL ALTER TABLE dbo.service_history ADD spec_auth NVARCHAR(40);

IF COL_LENGTH('dbo.service_history','po_number') IS NULL ALTER TABLE dbo.service_history ADD po_number NVARCHAR(40);

IF COL_LENGTH('dbo.service_history','name_raw') IS NULL ALTER TABLE dbo.service_history ADD name_raw NVARCHAR(140);

IF COL_LENGTH('dbo.service_history','address_raw') IS NULL ALTER TABLE dbo.service_history ADD address_raw NVARCHAR(120);

IF COL_LENGTH('dbo.service_history','identity_source') IS NULL ALTER TABLE dbo.service_history ADD identity_source NVARCHAR(16);

IF COL_LENGTH('dbo.service_history','ticket_kind') IS NULL ALTER TABLE dbo.service_history ADD ticket_kind NVARCHAR(10);

IF COL_LENGTH('dbo.service_history','imported_at') IS NULL ALTER TABLE dbo.service_history ADD imported_at DATETIME2;

IF OBJECT_ID('dbo.external_ref','U') IS NULL
CREATE TABLE dbo.external_ref (
    external_ref_id INT IDENTITY(1,1) PRIMARY KEY,
    entity NVARCHAR(20),
    entity_id NVARCHAR(40),
    system NVARCHAR(20),
    external_id NVARCHAR(64),
    is_primary BIT,
    payload NVARCHAR(MAX),
    linked_at DATETIME2,
    synced_at DATETIME2
);

IF COL_LENGTH('dbo.external_ref','entity') IS NULL ALTER TABLE dbo.external_ref ADD entity NVARCHAR(20);

IF COL_LENGTH('dbo.external_ref','entity_id') IS NULL ALTER TABLE dbo.external_ref ADD entity_id NVARCHAR(40);

IF COL_LENGTH('dbo.external_ref','system') IS NULL ALTER TABLE dbo.external_ref ADD system NVARCHAR(20);

IF COL_LENGTH('dbo.external_ref','external_id') IS NULL ALTER TABLE dbo.external_ref ADD external_id NVARCHAR(64);

IF COL_LENGTH('dbo.external_ref','is_primary') IS NULL ALTER TABLE dbo.external_ref ADD is_primary BIT;

IF COL_LENGTH('dbo.external_ref','payload') IS NULL ALTER TABLE dbo.external_ref ADD payload NVARCHAR(MAX);

IF COL_LENGTH('dbo.external_ref','linked_at') IS NULL ALTER TABLE dbo.external_ref ADD linked_at DATETIME2;

IF COL_LENGTH('dbo.external_ref','synced_at') IS NULL ALTER TABLE dbo.external_ref ADD synced_at DATETIME2;

IF OBJECT_ID('dbo.service_detail','U') IS NULL
CREATE TABLE dbo.service_detail (
    sv_number NVARCHAR(20) NOT NULL PRIMARY KEY,
    complaint_desc NVARCHAR(MAX),
    complaint_code NVARCHAR(20),
    performed_desc NVARCHAR(MAX),
    performed_code NVARCHAR(20),
    repair_code NVARCHAR(20),
    repair_category NVARCHAR(30),
    repair_severity NVARCHAR(10),
    product_code NVARCHAR(12),
    product NVARCHAR(40),
    brand_code NVARCHAR(20),
    model NVARCHAR(60),
    serial NVARCHAR(60),
    date_purchased DATE,
    in_warranty NVARCHAR(24),
    warranty_kind NVARCHAR(40),
    contract NVARCHAR(40),
    agreement_no NVARCHAR(40),
    call_sequence INT,
    void BIT,
    request_id NVARCHAR(40),
    item_total DECIMAL(10,2),
    labor_total DECIMAL(10,2),
    misc_total DECIMAL(10,2),
    trip_charge DECIMAL(10,2),
    wty_total DECIMAL(10,2)
);

IF COL_LENGTH('dbo.service_detail','complaint_desc') IS NULL ALTER TABLE dbo.service_detail ADD complaint_desc NVARCHAR(MAX);

IF COL_LENGTH('dbo.service_detail','complaint_code') IS NULL ALTER TABLE dbo.service_detail ADD complaint_code NVARCHAR(20);

IF COL_LENGTH('dbo.service_detail','performed_desc') IS NULL ALTER TABLE dbo.service_detail ADD performed_desc NVARCHAR(MAX);

IF COL_LENGTH('dbo.service_detail','performed_code') IS NULL ALTER TABLE dbo.service_detail ADD performed_code NVARCHAR(20);

IF COL_LENGTH('dbo.service_detail','repair_code') IS NULL ALTER TABLE dbo.service_detail ADD repair_code NVARCHAR(20);

IF COL_LENGTH('dbo.service_detail','repair_category') IS NULL ALTER TABLE dbo.service_detail ADD repair_category NVARCHAR(30);

IF COL_LENGTH('dbo.service_detail','repair_severity') IS NULL ALTER TABLE dbo.service_detail ADD repair_severity NVARCHAR(10);

IF COL_LENGTH('dbo.service_detail','product_code') IS NULL ALTER TABLE dbo.service_detail ADD product_code NVARCHAR(12);

IF COL_LENGTH('dbo.service_detail','product') IS NULL ALTER TABLE dbo.service_detail ADD product NVARCHAR(40);

IF COL_LENGTH('dbo.service_detail','brand_code') IS NULL ALTER TABLE dbo.service_detail ADD brand_code NVARCHAR(20);

IF COL_LENGTH('dbo.service_detail','model') IS NULL ALTER TABLE dbo.service_detail ADD model NVARCHAR(60);

IF COL_LENGTH('dbo.service_detail','serial') IS NULL ALTER TABLE dbo.service_detail ADD serial NVARCHAR(60);

IF COL_LENGTH('dbo.service_detail','date_purchased') IS NULL ALTER TABLE dbo.service_detail ADD date_purchased DATE;

IF COL_LENGTH('dbo.service_detail','in_warranty') IS NULL ALTER TABLE dbo.service_detail ADD in_warranty NVARCHAR(24);

IF COL_LENGTH('dbo.service_detail','warranty_kind') IS NULL ALTER TABLE dbo.service_detail ADD warranty_kind NVARCHAR(40);

IF COL_LENGTH('dbo.service_detail','contract') IS NULL ALTER TABLE dbo.service_detail ADD contract NVARCHAR(40);

IF COL_LENGTH('dbo.service_detail','agreement_no') IS NULL ALTER TABLE dbo.service_detail ADD agreement_no NVARCHAR(40);

IF COL_LENGTH('dbo.service_detail','call_sequence') IS NULL ALTER TABLE dbo.service_detail ADD call_sequence INT;

IF COL_LENGTH('dbo.service_detail','void') IS NULL ALTER TABLE dbo.service_detail ADD void BIT;

IF COL_LENGTH('dbo.service_detail','request_id') IS NULL ALTER TABLE dbo.service_detail ADD request_id NVARCHAR(40);

IF COL_LENGTH('dbo.service_detail','item_total') IS NULL ALTER TABLE dbo.service_detail ADD item_total DECIMAL(10,2);

IF COL_LENGTH('dbo.service_detail','labor_total') IS NULL ALTER TABLE dbo.service_detail ADD labor_total DECIMAL(10,2);

IF COL_LENGTH('dbo.service_detail','misc_total') IS NULL ALTER TABLE dbo.service_detail ADD misc_total DECIMAL(10,2);

IF COL_LENGTH('dbo.service_detail','trip_charge') IS NULL ALTER TABLE dbo.service_detail ADD trip_charge DECIMAL(10,2);

IF COL_LENGTH('dbo.service_detail','wty_total') IS NULL ALTER TABLE dbo.service_detail ADD wty_total DECIMAL(10,2);

IF OBJECT_ID('dbo.service_part','U') IS NULL
CREATE TABLE dbo.service_part (
    part_line_id INT IDENTITY(1,1) PRIMARY KEY,
    sv_number NVARCHAR(20),
    epass_line_id NVARCHAR(20),
    trip_no INT,
    item_code NVARCHAR(40),
    item_desc NVARCHAR(120),
    qty_ordered DECIMAL(9,2),
    qty_shipped DECIMAL(9,2),
    selling_price DECIMAL(10,2),
    line_total DECIMAL(10,2),
    unit_cost DECIMAL(10,2),
    warranty NVARCHAR(8),
    installed BIT,
    part_status NVARCHAR(20),
    supplier_code NVARCHAR(20),
    bin_location NVARCHAR(20),
    created_date DATE
);

IF COL_LENGTH('dbo.service_part','sv_number') IS NULL ALTER TABLE dbo.service_part ADD sv_number NVARCHAR(20);

IF COL_LENGTH('dbo.service_part','epass_line_id') IS NULL ALTER TABLE dbo.service_part ADD epass_line_id NVARCHAR(20);

IF COL_LENGTH('dbo.service_part','trip_no') IS NULL ALTER TABLE dbo.service_part ADD trip_no INT;

IF COL_LENGTH('dbo.service_part','item_code') IS NULL ALTER TABLE dbo.service_part ADD item_code NVARCHAR(40);

IF COL_LENGTH('dbo.service_part','item_desc') IS NULL ALTER TABLE dbo.service_part ADD item_desc NVARCHAR(120);

IF COL_LENGTH('dbo.service_part','qty_ordered') IS NULL ALTER TABLE dbo.service_part ADD qty_ordered DECIMAL(9,2);

IF COL_LENGTH('dbo.service_part','qty_shipped') IS NULL ALTER TABLE dbo.service_part ADD qty_shipped DECIMAL(9,2);

IF COL_LENGTH('dbo.service_part','selling_price') IS NULL ALTER TABLE dbo.service_part ADD selling_price DECIMAL(10,2);

IF COL_LENGTH('dbo.service_part','line_total') IS NULL ALTER TABLE dbo.service_part ADD line_total DECIMAL(10,2);

IF COL_LENGTH('dbo.service_part','unit_cost') IS NULL ALTER TABLE dbo.service_part ADD unit_cost DECIMAL(10,2);

IF COL_LENGTH('dbo.service_part','warranty') IS NULL ALTER TABLE dbo.service_part ADD warranty NVARCHAR(8);

IF COL_LENGTH('dbo.service_part','installed') IS NULL ALTER TABLE dbo.service_part ADD installed BIT;

IF COL_LENGTH('dbo.service_part','part_status') IS NULL ALTER TABLE dbo.service_part ADD part_status NVARCHAR(20);

IF COL_LENGTH('dbo.service_part','supplier_code') IS NULL ALTER TABLE dbo.service_part ADD supplier_code NVARCHAR(20);

IF COL_LENGTH('dbo.service_part','bin_location') IS NULL ALTER TABLE dbo.service_part ADD bin_location NVARCHAR(20);

IF COL_LENGTH('dbo.service_part','created_date') IS NULL ALTER TABLE dbo.service_part ADD created_date DATE;

IF OBJECT_ID('dbo.service_labor','U') IS NULL
CREATE TABLE dbo.service_labor (
    labor_line_id INT IDENTITY(1,1) PRIMARY KEY,
    sv_number NVARCHAR(20),
    epass_line_id NVARCHAR(20),
    trip_no INT,
    service_date DATE,
    tech_code NVARCHAR(8),
    tech_name NVARCHAR(80),
    labor_rate_code NVARCHAR(20),
    labor_desc NVARCHAR(120),
    time_charged DECIMAL(9,4),
    time_unit NVARCHAR(12),
    rate DECIMAL(10,2),
    line_total DECIMAL(10,2),
    cost DECIMAL(10,2),
    warranty NVARCHAR(8),
    trip_charge BIT,
    trip_charge_amt DECIMAL(10,2)
);

IF COL_LENGTH('dbo.service_labor','sv_number') IS NULL ALTER TABLE dbo.service_labor ADD sv_number NVARCHAR(20);

IF COL_LENGTH('dbo.service_labor','epass_line_id') IS NULL ALTER TABLE dbo.service_labor ADD epass_line_id NVARCHAR(20);

IF COL_LENGTH('dbo.service_labor','trip_no') IS NULL ALTER TABLE dbo.service_labor ADD trip_no INT;

IF COL_LENGTH('dbo.service_labor','service_date') IS NULL ALTER TABLE dbo.service_labor ADD service_date DATE;

IF COL_LENGTH('dbo.service_labor','tech_code') IS NULL ALTER TABLE dbo.service_labor ADD tech_code NVARCHAR(8);

IF COL_LENGTH('dbo.service_labor','tech_name') IS NULL ALTER TABLE dbo.service_labor ADD tech_name NVARCHAR(80);

IF COL_LENGTH('dbo.service_labor','labor_rate_code') IS NULL ALTER TABLE dbo.service_labor ADD labor_rate_code NVARCHAR(20);

IF COL_LENGTH('dbo.service_labor','labor_desc') IS NULL ALTER TABLE dbo.service_labor ADD labor_desc NVARCHAR(120);

IF COL_LENGTH('dbo.service_labor','time_charged') IS NULL ALTER TABLE dbo.service_labor ADD time_charged DECIMAL(9,4);

IF COL_LENGTH('dbo.service_labor','time_unit') IS NULL ALTER TABLE dbo.service_labor ADD time_unit NVARCHAR(12);

IF COL_LENGTH('dbo.service_labor','rate') IS NULL ALTER TABLE dbo.service_labor ADD rate DECIMAL(10,2);

IF COL_LENGTH('dbo.service_labor','line_total') IS NULL ALTER TABLE dbo.service_labor ADD line_total DECIMAL(10,2);

IF COL_LENGTH('dbo.service_labor','cost') IS NULL ALTER TABLE dbo.service_labor ADD cost DECIMAL(10,2);

IF COL_LENGTH('dbo.service_labor','warranty') IS NULL ALTER TABLE dbo.service_labor ADD warranty NVARCHAR(8);

IF COL_LENGTH('dbo.service_labor','trip_charge') IS NULL ALTER TABLE dbo.service_labor ADD trip_charge BIT;

IF COL_LENGTH('dbo.service_labor','trip_charge_amt') IS NULL ALTER TABLE dbo.service_labor ADD trip_charge_amt DECIMAL(10,2);

IF OBJECT_ID('dbo.sale','U') IS NULL
CREATE TABLE dbo.sale (
    invoice_code NVARCHAR(20) NOT NULL PRIMARY KEY,
    inv_type NVARCHAR(6),
    status NVARCHAR(20),
    job_status NVARCHAR(16),
    customer_id INT,
    bill_to_code NVARCHAR(40),
    sold_to_code NVARCHAR(40),
    salesperson NVARCHAR(12),
    created_date DATE,
    finish_date DATE,
    item_total DECIMAL(10,2),
    labor_total DECIMAL(10,2),
    serial_total DECIMAL(10,2),
    wty_total DECIMAL(10,2)
);

IF COL_LENGTH('dbo.sale','inv_type') IS NULL ALTER TABLE dbo.sale ADD inv_type NVARCHAR(6);

IF COL_LENGTH('dbo.sale','status') IS NULL ALTER TABLE dbo.sale ADD status NVARCHAR(20);

IF COL_LENGTH('dbo.sale','job_status') IS NULL ALTER TABLE dbo.sale ADD job_status NVARCHAR(16);

IF COL_LENGTH('dbo.sale','customer_id') IS NULL ALTER TABLE dbo.sale ADD customer_id INT;

IF COL_LENGTH('dbo.sale','bill_to_code') IS NULL ALTER TABLE dbo.sale ADD bill_to_code NVARCHAR(40);

IF COL_LENGTH('dbo.sale','sold_to_code') IS NULL ALTER TABLE dbo.sale ADD sold_to_code NVARCHAR(40);

IF COL_LENGTH('dbo.sale','salesperson') IS NULL ALTER TABLE dbo.sale ADD salesperson NVARCHAR(12);

IF COL_LENGTH('dbo.sale','created_date') IS NULL ALTER TABLE dbo.sale ADD created_date DATE;

IF COL_LENGTH('dbo.sale','finish_date') IS NULL ALTER TABLE dbo.sale ADD finish_date DATE;

IF COL_LENGTH('dbo.sale','item_total') IS NULL ALTER TABLE dbo.sale ADD item_total DECIMAL(10,2);

IF COL_LENGTH('dbo.sale','labor_total') IS NULL ALTER TABLE dbo.sale ADD labor_total DECIMAL(10,2);

IF COL_LENGTH('dbo.sale','serial_total') IS NULL ALTER TABLE dbo.sale ADD serial_total DECIMAL(10,2);

IF COL_LENGTH('dbo.sale','wty_total') IS NULL ALTER TABLE dbo.sale ADD wty_total DECIMAL(10,2);

IF OBJECT_ID('dbo.sale_line','U') IS NULL
CREATE TABLE dbo.sale_line (
    sale_line_id INT IDENTITY(1,1) PRIMARY KEY,
    invoice_code NVARCHAR(20),
    epass_line_id NVARCHAR(20),
    model_code NVARCHAR(60),
    model_desc NVARCHAR(200),
    brand_code NVARCHAR(20),
    product_code NVARCHAR(20),
    sku NVARCHAR(40),
    mfr_warranty NVARCHAR(40),
    colour NVARCHAR(30),
    new_used NVARCHAR(10),
    qty DECIMAL(9,2),
    selling_price DECIMAL(10,2),
    line_total DECIMAL(10,2),
    line_status NVARCHAR(20),
    po_code NVARCHAR(30)
);

IF COL_LENGTH('dbo.sale_line','invoice_code') IS NULL ALTER TABLE dbo.sale_line ADD invoice_code NVARCHAR(20);

IF COL_LENGTH('dbo.sale_line','epass_line_id') IS NULL ALTER TABLE dbo.sale_line ADD epass_line_id NVARCHAR(20);

IF COL_LENGTH('dbo.sale_line','model_code') IS NULL ALTER TABLE dbo.sale_line ADD model_code NVARCHAR(60);

IF COL_LENGTH('dbo.sale_line','model_desc') IS NULL ALTER TABLE dbo.sale_line ADD model_desc NVARCHAR(200);

IF COL_LENGTH('dbo.sale_line','brand_code') IS NULL ALTER TABLE dbo.sale_line ADD brand_code NVARCHAR(20);

IF COL_LENGTH('dbo.sale_line','product_code') IS NULL ALTER TABLE dbo.sale_line ADD product_code NVARCHAR(20);

IF COL_LENGTH('dbo.sale_line','sku') IS NULL ALTER TABLE dbo.sale_line ADD sku NVARCHAR(40);

IF COL_LENGTH('dbo.sale_line','mfr_warranty') IS NULL ALTER TABLE dbo.sale_line ADD mfr_warranty NVARCHAR(40);

IF COL_LENGTH('dbo.sale_line','colour') IS NULL ALTER TABLE dbo.sale_line ADD colour NVARCHAR(30);

IF COL_LENGTH('dbo.sale_line','new_used') IS NULL ALTER TABLE dbo.sale_line ADD new_used NVARCHAR(10);

IF COL_LENGTH('dbo.sale_line','qty') IS NULL ALTER TABLE dbo.sale_line ADD qty DECIMAL(9,2);

IF COL_LENGTH('dbo.sale_line','selling_price') IS NULL ALTER TABLE dbo.sale_line ADD selling_price DECIMAL(10,2);

IF COL_LENGTH('dbo.sale_line','line_total') IS NULL ALTER TABLE dbo.sale_line ADD line_total DECIMAL(10,2);

IF COL_LENGTH('dbo.sale_line','line_status') IS NULL ALTER TABLE dbo.sale_line ADD line_status NVARCHAR(20);

IF COL_LENGTH('dbo.sale_line','po_code') IS NULL ALTER TABLE dbo.sale_line ADD po_code NVARCHAR(30);

IF OBJECT_ID('dbo.sale_serial','U') IS NULL
CREATE TABLE dbo.sale_serial (
    sale_serial_id INT IDENTITY(1,1) PRIMARY KEY,
    invoice_code NVARCHAR(20),
    epass_line_id NVARCHAR(20),
    model_code NVARCHAR(60),
    serial NVARCHAR(60),
    serial_status NVARCHAR(20),
    returned BIT,
    taken BIT,
    taken_date DATE,
    unit_cost DECIMAL(10,2),
    created_date DATE
);

IF COL_LENGTH('dbo.sale_serial','invoice_code') IS NULL ALTER TABLE dbo.sale_serial ADD invoice_code NVARCHAR(20);

IF COL_LENGTH('dbo.sale_serial','epass_line_id') IS NULL ALTER TABLE dbo.sale_serial ADD epass_line_id NVARCHAR(20);

IF COL_LENGTH('dbo.sale_serial','model_code') IS NULL ALTER TABLE dbo.sale_serial ADD model_code NVARCHAR(60);

IF COL_LENGTH('dbo.sale_serial','serial') IS NULL ALTER TABLE dbo.sale_serial ADD serial NVARCHAR(60);

IF COL_LENGTH('dbo.sale_serial','serial_status') IS NULL ALTER TABLE dbo.sale_serial ADD serial_status NVARCHAR(20);

IF COL_LENGTH('dbo.sale_serial','returned') IS NULL ALTER TABLE dbo.sale_serial ADD returned BIT;

IF COL_LENGTH('dbo.sale_serial','taken') IS NULL ALTER TABLE dbo.sale_serial ADD taken BIT;

IF COL_LENGTH('dbo.sale_serial','taken_date') IS NULL ALTER TABLE dbo.sale_serial ADD taken_date DATE;

IF COL_LENGTH('dbo.sale_serial','unit_cost') IS NULL ALTER TABLE dbo.sale_serial ADD unit_cost DECIMAL(10,2);

IF COL_LENGTH('dbo.sale_serial','created_date') IS NULL ALTER TABLE dbo.sale_serial ADD created_date DATE;

IF OBJECT_ID('dbo.tech_pattern','U') IS NULL
CREATE TABLE dbo.tech_pattern (
    tech_pattern_id INT IDENTITY(1,1) PRIMARY KEY,
    tech_id INT,
    weekday NVARCHAR(3),
    shift_start NVARCHAR(5),
    shift_end NVARCHAR(5),
    reason NVARCHAR(80),
    set_by NVARCHAR(60),
    set_at DATETIME2,
    start_at NVARCHAR(8),
    end_at NVARCHAR(8)
);

IF COL_LENGTH('dbo.tech_pattern','tech_id') IS NULL ALTER TABLE dbo.tech_pattern ADD tech_id INT;

IF COL_LENGTH('dbo.tech_pattern','weekday') IS NULL ALTER TABLE dbo.tech_pattern ADD weekday NVARCHAR(3);

IF COL_LENGTH('dbo.tech_pattern','shift_start') IS NULL ALTER TABLE dbo.tech_pattern ADD shift_start NVARCHAR(5);

IF COL_LENGTH('dbo.tech_pattern','shift_end') IS NULL ALTER TABLE dbo.tech_pattern ADD shift_end NVARCHAR(5);

IF COL_LENGTH('dbo.tech_pattern','reason') IS NULL ALTER TABLE dbo.tech_pattern ADD reason NVARCHAR(80);

IF COL_LENGTH('dbo.tech_pattern','set_by') IS NULL ALTER TABLE dbo.tech_pattern ADD set_by NVARCHAR(60);

IF COL_LENGTH('dbo.tech_pattern','set_at') IS NULL ALTER TABLE dbo.tech_pattern ADD set_at DATETIME2;

IF COL_LENGTH('dbo.tech_pattern','start_at') IS NULL ALTER TABLE dbo.tech_pattern ADD start_at NVARCHAR(8);

IF COL_LENGTH('dbo.tech_pattern','end_at') IS NULL ALTER TABLE dbo.tech_pattern ADD end_at NVARCHAR(8);

IF OBJECT_ID('dbo.office_note','U') IS NULL
CREATE TABLE dbo.office_note (
    note_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT,
    job_id INT,
    body NVARCHAR(MAX),
    due_on DATE,
    assigned_to NVARCHAR(60),
    done_by NVARCHAR(60),
    done_at DATETIME2,
    created_by NVARCHAR(60),
    created_at DATETIME2
);

IF COL_LENGTH('dbo.office_note','customer_id') IS NULL ALTER TABLE dbo.office_note ADD customer_id INT;

IF COL_LENGTH('dbo.office_note','job_id') IS NULL ALTER TABLE dbo.office_note ADD job_id INT;

IF COL_LENGTH('dbo.office_note','body') IS NULL ALTER TABLE dbo.office_note ADD body NVARCHAR(MAX);

IF COL_LENGTH('dbo.office_note','due_on') IS NULL ALTER TABLE dbo.office_note ADD due_on DATE;

IF COL_LENGTH('dbo.office_note','assigned_to') IS NULL ALTER TABLE dbo.office_note ADD assigned_to NVARCHAR(60);

IF COL_LENGTH('dbo.office_note','done_by') IS NULL ALTER TABLE dbo.office_note ADD done_by NVARCHAR(60);

IF COL_LENGTH('dbo.office_note','done_at') IS NULL ALTER TABLE dbo.office_note ADD done_at DATETIME2;

IF COL_LENGTH('dbo.office_note','created_by') IS NULL ALTER TABLE dbo.office_note ADD created_by NVARCHAR(60);

IF COL_LENGTH('dbo.office_note','created_at') IS NULL ALTER TABLE dbo.office_note ADD created_at DATETIME2;

IF OBJECT_ID('dbo.model_family_rule','U') IS NULL
CREATE TABLE dbo.model_family_rule (
    rule_id INT IDENTITY(1,1) PRIMARY KEY,
    brand_pattern NVARCHAR(60),
    product_pattern NVARCHAR(40),
    model_regex NVARCHAR(120),
    family_template NVARCHAR(40),
    label NVARCHAR(120),
    sort_order INT,
    active BIT,
    created_by NVARCHAR(60),
    created_at DATETIME2
);

IF COL_LENGTH('dbo.model_family_rule','brand_pattern') IS NULL ALTER TABLE dbo.model_family_rule ADD brand_pattern NVARCHAR(60);

IF COL_LENGTH('dbo.model_family_rule','product_pattern') IS NULL ALTER TABLE dbo.model_family_rule ADD product_pattern NVARCHAR(40);

IF COL_LENGTH('dbo.model_family_rule','model_regex') IS NULL ALTER TABLE dbo.model_family_rule ADD model_regex NVARCHAR(120);

IF COL_LENGTH('dbo.model_family_rule','family_template') IS NULL ALTER TABLE dbo.model_family_rule ADD family_template NVARCHAR(40);

IF COL_LENGTH('dbo.model_family_rule','label') IS NULL ALTER TABLE dbo.model_family_rule ADD label NVARCHAR(120);

IF COL_LENGTH('dbo.model_family_rule','sort_order') IS NULL ALTER TABLE dbo.model_family_rule ADD sort_order INT;

IF COL_LENGTH('dbo.model_family_rule','active') IS NULL ALTER TABLE dbo.model_family_rule ADD active BIT;

IF COL_LENGTH('dbo.model_family_rule','created_by') IS NULL ALTER TABLE dbo.model_family_rule ADD created_by NVARCHAR(60);

IF COL_LENGTH('dbo.model_family_rule','created_at') IS NULL ALTER TABLE dbo.model_family_rule ADD created_at DATETIME2;

IF OBJECT_ID('dbo.model_flag','U') IS NULL
CREATE TABLE dbo.model_flag (
    flag_id INT IDENTITY(1,1) PRIMARY KEY,
    family_key NVARCHAR(80),
    body NVARCHAR(MAX),
    state NVARCHAR(12),
    raised_by NVARCHAR(60),
    raised_at DATETIME2,
    reviewed_by NVARCHAR(60),
    reviewed_at DATETIME2,
    retired_at DATETIME2
);

IF COL_LENGTH('dbo.model_flag','family_key') IS NULL ALTER TABLE dbo.model_flag ADD family_key NVARCHAR(80);

IF COL_LENGTH('dbo.model_flag','body') IS NULL ALTER TABLE dbo.model_flag ADD body NVARCHAR(MAX);

IF COL_LENGTH('dbo.model_flag','state') IS NULL ALTER TABLE dbo.model_flag ADD state NVARCHAR(12);

IF COL_LENGTH('dbo.model_flag','raised_by') IS NULL ALTER TABLE dbo.model_flag ADD raised_by NVARCHAR(60);

IF COL_LENGTH('dbo.model_flag','raised_at') IS NULL ALTER TABLE dbo.model_flag ADD raised_at DATETIME2;

IF COL_LENGTH('dbo.model_flag','reviewed_by') IS NULL ALTER TABLE dbo.model_flag ADD reviewed_by NVARCHAR(60);

IF COL_LENGTH('dbo.model_flag','reviewed_at') IS NULL ALTER TABLE dbo.model_flag ADD reviewed_at DATETIME2;

IF COL_LENGTH('dbo.model_flag','retired_at') IS NULL ALTER TABLE dbo.model_flag ADD retired_at DATETIME2;

IF OBJECT_ID('dbo.app_user','U') IS NULL
CREATE TABLE dbo.app_user (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(120),
    name NVARCHAR(80),
    role NVARCHAR(20),
    active BIT
);

IF COL_LENGTH('dbo.app_user','email') IS NULL ALTER TABLE dbo.app_user ADD email NVARCHAR(120);

IF COL_LENGTH('dbo.app_user','name') IS NULL ALTER TABLE dbo.app_user ADD name NVARCHAR(80);

IF COL_LENGTH('dbo.app_user','role') IS NULL ALTER TABLE dbo.app_user ADD role NVARCHAR(20);

IF COL_LENGTH('dbo.app_user','active') IS NULL ALTER TABLE dbo.app_user ADD active BIT;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_app_user_email')
CREATE UNIQUE INDEX ux_app_user_email ON dbo.app_user(email) WHERE email IS NOT NULL;

IF OBJECT_ID('dbo.app_permission','U') IS NULL
CREATE TABLE dbo.app_permission (
    permission_id INT IDENTITY(1,1) PRIMARY KEY,
    role NVARCHAR(20),
    permission NVARCHAR(60)
);

IF COL_LENGTH('dbo.app_permission','role') IS NULL ALTER TABLE dbo.app_permission ADD role NVARCHAR(20);

IF COL_LENGTH('dbo.app_permission','permission') IS NULL ALTER TABLE dbo.app_permission ADD permission NVARCHAR(60);

IF OBJECT_ID('dbo.estimate_handoff','U') IS NULL
CREATE TABLE dbo.estimate_handoff (
    handoff_id INT IDENTITY(1,1) PRIMARY KEY,
    job_id INT,
    sv_number NVARCHAR(20),
    external_ref NVARCHAR(60),
    status NVARCHAR(20),
    kind NVARCHAR(10),
    lines NVARCHAR(MAX),
    total DECIMAL(10,2),
    parts_eta DATE,
    handed_by NVARCHAR(60),
    handed_at DATETIME2,
    responded_at DATETIME2
);

IF COL_LENGTH('dbo.estimate_handoff','job_id') IS NULL ALTER TABLE dbo.estimate_handoff ADD job_id INT;

IF COL_LENGTH('dbo.estimate_handoff','sv_number') IS NULL ALTER TABLE dbo.estimate_handoff ADD sv_number NVARCHAR(20);

IF COL_LENGTH('dbo.estimate_handoff','external_ref') IS NULL ALTER TABLE dbo.estimate_handoff ADD external_ref NVARCHAR(60);

IF COL_LENGTH('dbo.estimate_handoff','status') IS NULL ALTER TABLE dbo.estimate_handoff ADD status NVARCHAR(20);

IF COL_LENGTH('dbo.estimate_handoff','kind') IS NULL ALTER TABLE dbo.estimate_handoff ADD kind NVARCHAR(10);

IF COL_LENGTH('dbo.estimate_handoff','lines') IS NULL ALTER TABLE dbo.estimate_handoff ADD lines NVARCHAR(MAX);

IF COL_LENGTH('dbo.estimate_handoff','total') IS NULL ALTER TABLE dbo.estimate_handoff ADD total DECIMAL(10,2);

IF COL_LENGTH('dbo.estimate_handoff','parts_eta') IS NULL ALTER TABLE dbo.estimate_handoff ADD parts_eta DATE;

IF COL_LENGTH('dbo.estimate_handoff','handed_by') IS NULL ALTER TABLE dbo.estimate_handoff ADD handed_by NVARCHAR(60);

IF COL_LENGTH('dbo.estimate_handoff','handed_at') IS NULL ALTER TABLE dbo.estimate_handoff ADD handed_at DATETIME2;

IF COL_LENGTH('dbo.estimate_handoff','responded_at') IS NULL ALTER TABLE dbo.estimate_handoff ADD responded_at DATETIME2;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_techpattern')
CREATE INDEX ix_techpattern ON dbo.tech_pattern(tech_id, weekday);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_note_cust')
CREATE INDEX ix_note_cust ON dbo.office_note(customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_note_due')
CREATE INDEX ix_note_due ON dbo.office_note(due_on);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_flag_fam')
CREATE INDEX ix_flag_fam ON dbo.model_flag(family_key, state);

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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_tracker_token')
CREATE INDEX ix_job_tracker_token ON dbo.job(tracker_token);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_job_shop')
CREATE INDEX ix_job_shop ON dbo.job(status, route_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_damage_state')
CREATE INDEX ix_damage_state ON dbo.damage_report(state);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_damage_job')
CREATE INDEX ix_damage_job ON dbo.damage_report(job_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_findings_job')
CREATE INDEX ix_findings_job ON dbo.findings(job_id, submitted_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_placement_job')
CREATE INDEX ix_placement_job ON dbo.placement_log(job_id, kind);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_asset_customer')
CREATE INDEX ix_asset_customer ON dbo.asset(customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_asset_serial')
CREATE INDEX ix_asset_serial ON dbo.asset(serial);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_hist_customer')
CREATE INDEX ix_hist_customer ON dbo.service_history(customer_id, created_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_hist_asset')
CREATE INDEX ix_hist_asset ON dbo.service_history(asset_id, created_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_hist_payer')
CREATE INDEX ix_hist_payer ON dbo.service_history(payer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_cust_household')
CREATE INDEX ix_cust_household ON dbo.customer(household_key);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_cust_epass')
CREATE INDEX ix_cust_epass ON dbo.customer(epass_customer_code);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_addr_key')
CREATE INDEX ix_addr_key ON dbo.address(address_key);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_extref')
CREATE INDEX ix_extref ON dbo.external_ref(entity, entity_id, system);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_extref_lookup')
CREATE INDEX ix_extref_lookup ON dbo.external_ref(system, external_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_part_sv')
CREATE INDEX ix_part_sv ON dbo.service_part(sv_number);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_part_item')
CREATE INDEX ix_part_item ON dbo.service_part(item_code);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_labor_sv')
CREATE INDEX ix_labor_sv ON dbo.service_labor(sv_number);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_labor_tech')
CREATE INDEX ix_labor_tech ON dbo.service_labor(tech_code, service_date);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_detail_model')
CREATE INDEX ix_detail_model ON dbo.service_detail(brand_code, model);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_detail_product')
CREATE INDEX ix_detail_product ON dbo.service_detail(product_code);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_detail_serial')
CREATE INDEX ix_detail_serial ON dbo.service_detail(serial);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_saleline_model')
CREATE INDEX ix_saleline_model ON dbo.sale_line(model_code);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_saleserial')
CREATE INDEX ix_saleserial ON dbo.sale_serial(serial);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_sale_customer')
CREATE INDEX ix_sale_customer ON dbo.sale(customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_perm_role')
CREATE INDEX ix_perm_role ON dbo.app_permission(role, permission);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_handoff_job')
CREATE INDEX ix_handoff_job ON dbo.estimate_handoff(job_id, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_handoff_ref')
CREATE INDEX ix_handoff_ref ON dbo.estimate_handoff(external_ref);
