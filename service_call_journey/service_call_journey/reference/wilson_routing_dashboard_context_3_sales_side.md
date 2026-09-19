# Wilson Routing & Capacity Dashboard — Project Context and Rebuild Notes

_Last updated: 2026-08-06_

This document summarizes the full working context from the build conversation so another AI/developer can recreate, maintain, or extend the Wilson Routing & Capacity Dashboard.

---

## 1. Business Goal

Wilson Appliance currently uses **EPASS** for routing. The only EPASS feature the user strongly likes is the **Route Board**, which allows dispatchers to:

- View two route/date/truck windows simultaneously.
- Drag jobs from one truck/date to another.
- See route capacity.
- Open the related sales order details from the route board.

Wilson is moving to NetSuite, but there is concern that NetSuite's native RAP/routing solution may not meet operational needs. The objective is to build an internal Wilson dashboard that can first run from EPASS CSV exports and later integrate with NetSuite API.

The dashboard should eventually become the **source of truth for routing**, while EPASS is manually updated during the transition period.

---

## 2. Operating Model

### Current flow

```text
EPASS exports DispatchTrackDetail CSV every 15 minutes
        ↓
CSV lands in Wilson network folder
        ↓
Python importer reads newest CSV
        ↓
SQL Server Express stores raw rows, route jobs, truck capacity, point rules, sales holds
        ↓
Flask web dashboard reads SQL Server
```

### Source of truth decision

The user chose **Option B**:

> The dashboard becomes the source of truth for routing. EPASS CSV imports update job/order detail, but dashboard route/date/sequence changes are preserved. Staff manually update EPASS to match dashboard until writeback/API automation exists.

### EPASS writeback

Current version: **No writeback to EPASS**.

```text
Dashboard changes live only in the dashboard/database.
Dispatcher manually updates EPASS for moved tickets.
```

---

## 3. EPASS CSV Feed

### Network folder path

```text
\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport
```

### CSV file pattern

```text
DispatchTrackDetail_*.csv
```

Example uploaded file during conversation:

```text
DispatchTrackDetail_20260513_161502.csv
```

### Export type

The CSV is a **full snapshot**, not a changes-only feed.

### Encoding

EPASS export is not UTF-8. It required this encoding in Python:

```python
encoding="cp1252"
```

The initial `utf-8-sig` read failed with:

```text
UnicodeDecodeError: 'utf-8' codec can't decode byte 0xa0
```

### Important CSV columns identified

- `Order Number`
- `Delivery Date`
- `Truck`
- `Ship Name`
- `Ship Address1`
- `Ship City`
- `Ship State`
- `Ship Zip`
- `Phone1`
- `Model`
- `Description`
- `Quantity`
- `Deliver Quantity`
- `Balance`
- `Latitude`
- `Longitude`
- `Job Status`
- `Directions`
- `Qualifications`
- `Salesperson`
- `ProductCode`
- `Points`

### Capacity source

Initially thought `Service Time` was the capacity source. Later discovered that for Wilson's sales tickets the correct unit source is:

```text
Points
```

The dashboard uses:

```text
Route units = Points
ServiceTimeMinutes = Points * 30
1 unit = 30 minutes
```

### Ticket types

Only import/consider these for routing capacity right now:

```text
S000... sales tickets
R000... route/sales-related tickets
```

Ignore service orders for now:

```text
SV00... service orders
```

---

## 4. Fleet and Capacity Rules

### Truck mappings

| EPASS code | Dashboard truck name | Truck type | Capacity |
|---|---|---|---:|
| D01 | Truck 1 | F450 open bed + lift gate | 16 units |
| D02 | Truck 2 | F450 open bed + lift gate | 16 units |
| D03 | Truck 3 | F450 open bed + lift gate | 16 units |
| D04 | Truck 4 | F450 open bed + lift gate | 16 units |
| D05 | Truck 5 | F450 open bed + lift gate | 16 units |
| D06 | Truck 6 | F450 open bed + lift gate | 16 units |
| DHTST | hot shot | F250 + lift gate | 12 units |
| WALK | big brown | F250 + lift gate | 12 units |
| ROXXI | roxxiboxxi | 32 ft box truck / warehouse transfer | 24 units |

### roxxiboxxi rule

`roxxiboxxi` is normally a warehouse transfer truck and should be blocked by default from normal routing. It can be manually overridden for monster jobs.

---

## 5. SQL Server Setup

### SQL Server instance

Installed SQL Server Express on Windows.

```text
Instance: SQLEXPRESS
Server: localhost\SQLEXPRESS
Database: WilsonRouting
Authentication used initially: Windows Authentication
```

SSMS needed **Trust Server Certificate** checked due to default encryption/cert warning.

### Database

```text
WilsonRouting
```

### Created tables

- `dbo.ImportBatches`
- `dbo.RawEpassDispatchRows`
- `dbo.Trucks`
- `dbo.RouteJobs`
- `dbo.RouteJobLines`
- `dbo.SalesHolds`
- `dbo.PointRules`

---

## 6. Final SQL Schema / Setup Script

This is the consolidated setup direction. The live database was built incrementally, so a future rebuild should use a consolidated script.

```sql
USE WilsonRouting;
GO

IF OBJECT_ID('dbo.SalesHolds', 'U') IS NOT NULL DROP TABLE dbo.SalesHolds;
IF OBJECT_ID('dbo.RouteJobLines', 'U') IS NOT NULL DROP TABLE dbo.RouteJobLines;
IF OBJECT_ID('dbo.RouteJobs', 'U') IS NOT NULL DROP TABLE dbo.RouteJobs;
IF OBJECT_ID('dbo.RawEpassDispatchRows', 'U') IS NOT NULL DROP TABLE dbo.RawEpassDispatchRows;
IF OBJECT_ID('dbo.Trucks', 'U') IS NOT NULL DROP TABLE dbo.Trucks;
IF OBJECT_ID('dbo.ImportBatches', 'U') IS NOT NULL DROP TABLE dbo.ImportBatches;
IF OBJECT_ID('dbo.PointRules', 'U') IS NOT NULL DROP TABLE dbo.PointRules;
GO

CREATE TABLE dbo.ImportBatches (
    ImportBatchId INT IDENTITY(1,1) PRIMARY KEY,
    FileName NVARCHAR(255) NOT NULL,
    FilePath NVARCHAR(1000) NOT NULL,
    FileModifiedAt DATETIME2 NULL,
    ImportedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ImportedRowCount INT NOT NULL DEFAULT 0,
    ImportStatus NVARCHAR(50) NOT NULL DEFAULT 'Imported'
);
GO

CREATE TABLE dbo.RawEpassDispatchRows (
    RawRowId INT IDENTITY(1,1) PRIMARY KEY,
    ImportBatchId INT NOT NULL,
    OrderNumber NVARCHAR(100) NULL,
    DeliveryDate DATE NULL,
    EpassTruckCode NVARCHAR(50) NULL,
    ShipName NVARCHAR(255) NULL,
    ShipAddress1 NVARCHAR(255) NULL,
    ShipCity NVARCHAR(100) NULL,
    ShipState NVARCHAR(50) NULL,
    ShipZip NVARCHAR(50) NULL,
    Phone1 NVARCHAR(50) NULL,
    Model NVARCHAR(100) NULL,
    Description NVARCHAR(500) NULL,
    Quantity DECIMAL(18,2) NULL,
    DeliverQuantity DECIMAL(18,2) NULL,
    ServiceTimeMinutes INT NULL,
    Points DECIMAL(10,2) NULL,
    Balance DECIMAL(18,2) NULL,
    Latitude DECIMAL(18,8) NULL,
    Longitude DECIMAL(18,8) NULL,
    JobStatus NVARCHAR(100) NULL,
    Directions NVARCHAR(MAX) NULL,
    Qualifications NVARCHAR(MAX) NULL,
    ProductCode NVARCHAR(100) NULL,
    Salesperson NVARCHAR(100) NULL,
    RawJson NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_RawEpassDispatchRows_ImportBatches
        FOREIGN KEY (ImportBatchId) REFERENCES dbo.ImportBatches(ImportBatchId)
);
GO

CREATE TABLE dbo.Trucks (
    TruckId INT IDENTITY(1,1) PRIMARY KEY,
    TruckName NVARCHAR(100) NOT NULL UNIQUE,
    EpassTruckCode NVARCHAR(50) NULL UNIQUE,
    TruckType NVARCHAR(255) NULL,
    MaxUnits INT NOT NULL,
    IsTransferTruck BIT NOT NULL DEFAULT 0,
    IsActive BIT NOT NULL DEFAULT 1
);
GO

CREATE TABLE dbo.RouteJobs (
    RouteJobId INT IDENTITY(1,1) PRIMARY KEY,
    OrderNumber NVARCHAR(100) NOT NULL UNIQUE,
    CustomerName NVARCHAR(255) NULL,
    ShipAddress1 NVARCHAR(255) NULL,
    ShipCity NVARCHAR(100) NULL,
    ShipState NVARCHAR(50) NULL,
    ShipZip NVARCHAR(50) NULL,
    Phone1 NVARCHAR(50) NULL,
    LatestEpassTruckCode NVARCHAR(50) NULL,
    LatestEpassDeliveryDate DATE NULL,
    DashboardTruckId INT NULL,
    DashboardRouteDate DATE NULL,
    DashboardSequence INT NULL,
    ServiceTimeMinutes INT NOT NULL DEFAULT 0,
    Units AS CAST(ServiceTimeMinutes / 30.0 AS DECIMAL(10,2)) PERSISTED,
    Points DECIMAL(10,2) NOT NULL DEFAULT 0,
    Balance DECIMAL(18,2) NULL,
    JobStatus NVARCHAR(100) NULL,
    Directions NVARCHAR(MAX) NULL,
    Qualifications NVARCHAR(MAX) NULL,
    Salesperson NVARCHAR(100) NULL,
    NeedsEpassUpdate BIT NOT NULL DEFAULT 0,
    RoutingSource NVARCHAR(50) NOT NULL DEFAULT 'epass',
    LastDashboardMoveAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_RouteJobs_Trucks
        FOREIGN KEY (DashboardTruckId) REFERENCES dbo.Trucks(TruckId)
);
GO

CREATE TABLE dbo.RouteJobLines (
    RouteJobLineId INT IDENTITY(1,1) PRIMARY KEY,
    RouteJobId INT NOT NULL,
    ImportBatchId INT NULL,
    Model NVARCHAR(100) NULL,
    Description NVARCHAR(500) NULL,
    ProductCode NVARCHAR(100) NULL,
    Quantity DECIMAL(18,2) NULL,
    DeliverQuantity DECIMAL(18,2) NULL,
    ServiceTimeMinutes INT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_RouteJobLines_RouteJobs
        FOREIGN KEY (RouteJobId) REFERENCES dbo.RouteJobs(RouteJobId),
    CONSTRAINT FK_RouteJobLines_ImportBatches
        FOREIGN KEY (ImportBatchId) REFERENCES dbo.ImportBatches(ImportBatchId)
);
GO

CREATE TABLE dbo.SalesHolds (
    SalesHoldId INT IDENTITY(1,1) PRIMARY KEY,
    CustomerName NVARCHAR(255) NULL,
    ApplianceType NVARCHAR(1000) NOT NULL,
    DeliveryRequested BIT NOT NULL DEFAULT 1,
    InstallRequested BIT NOT NULL DEFAULT 1,
    HoldUnits DECIMAL(10,2) NOT NULL,
    HoldDate DATE NOT NULL,
    HoldStatus NVARCHAR(50) NOT NULL DEFAULT 'Active',
    Notes NVARCHAR(MAX) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresAt DATETIME2 NULL
);
GO

CREATE TABLE dbo.PointRules (
    PointRuleId INT IDENTITY(1,1) PRIMARY KEY,
    SalesCategory NVARCHAR(100) NULL,
    SalesDisplayName NVARCHAR(255) NOT NULL,
    SourceDescription NVARCHAR(500) NOT NULL,
    SourceProductCode NVARCHAR(100) NULL,
    Points DECIMAL(10,2) NOT NULL,
    RuleType NVARCHAR(50) NOT NULL DEFAULT 'Install',
    IsActive BIT NOT NULL DEFAULT 1,
    NeedsReview BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

INSERT INTO dbo.Trucks
    (TruckName, EpassTruckCode, TruckType, MaxUnits, IsTransferTruck)
VALUES
    ('Truck 1', 'D01', 'F450 open bed + lift gate', 16, 0),
    ('Truck 2', 'D02', 'F450 open bed + lift gate', 16, 0),
    ('Truck 3', 'D03', 'F450 open bed + lift gate', 16, 0),
    ('Truck 4', 'D04', 'F450 open bed + lift gate', 16, 0),
    ('Truck 5', 'D05', 'F450 open bed + lift gate', 16, 0),
    ('Truck 6', 'D06', 'F450 open bed + lift gate', 16, 0),
    ('hot shot', 'DHTST', 'F250 + lift gate', 12, 0),
    ('big brown', 'WALK', 'F250 + lift gate', 12, 0),
    ('roxxiboxxi', 'ROXXI', '32 ft box truck / warehouse transfer', 24, 1);
GO
```

### Seed PointRules from imported rows

After importing at least one EPASS snapshot:

```sql
INSERT INTO dbo.PointRules
    (SalesDisplayName, SourceDescription, SourceProductCode, Points, RuleType, NeedsReview)
SELECT
    Description,
    Description,
    ProductCode,
    Points,
    CASE
        WHEN Description LIKE '%delivery%' THEN 'Delivery'
        ELSE 'Install'
    END,
    1
FROM (
    SELECT
        Description,
        ProductCode,
        Points
    FROM dbo.RawEpassDispatchRows
    WHERE Points > 0
      AND (
            OrderNumber LIKE 'S000%'
            OR OrderNumber LIKE 'R000%'
          )
    GROUP BY Description, ProductCode, Points
) src;
GO
```

---

## 7. Python Environment

### Python version

Python was available through Windows Python launcher.

The user confirmed:

```text
py -3 --version
```

showed Python 3.14.5.

### Python packages installed

```text
pyodbc==5.3.0
flask
```

Installed with:

```text
py -3 -m pip install pyodbc
py -3 -m pip install flask
```

### Working folder

```text
C:\WilsonRouting
```

### Subfolder

```text
C:\WilsonRouting\logs
```

### Important files

```text
C:\WilsonRouting\test_sql_connection.py
C:\WilsonRouting\import_epass.py
C:\WilsonRouting\dashboard.py
C:\WilsonRouting\logs\import_epass.log
```

---

## 8. SQL Connection String

Used by both importer and Flask dashboard:

```python
CONNECTION_STRING = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost\\SQLEXPRESS;"
    "DATABASE=WilsonRouting;"
    "Trusted_Connection=yes;"
    "TrustServerCertificate=yes;"
)
```

The user successfully tested this with `test_sql_connection.py` and printed all trucks.

---

## 9. Importer Behavior

### File

```text
C:\WilsonRouting\import_epass.py
```

### Responsibilities

- Find newest `DispatchTrackDetail_*.csv` in EPASS export folder.
- Skip file if exact filename/path already imported.
- Insert import batch record.
- Read CSV using `cp1252`.
- Insert raw rows into `dbo.RawEpassDispatchRows`.
- Group rows by `Order Number`.
- Only include order numbers starting with `S000` or `R000`.
- Ignore `SV00` service orders.
- Use `Points` as route units.
- Convert `Points * 30` to `ServiceTimeMinutes`.
- Upsert `dbo.RouteJobs` while preserving dashboard-owned fields.
- Replace route job detail lines in `dbo.RouteJobLines`.
- Log to `C:\WilsonRouting\logs\import_epass.log`.

### Key importer details

#### Points logic

```python
points = to_decimal(get_any(row, "Points", "Point", "Job Points", "Units")) or Decimal("0")
service_time = int(points * Decimal("30"))
```

#### Ticket filter

```python
if not order_number:
    continue

if not (order_number.upper().startswith("S000") or order_number.upper().startswith("R000")):
    continue
```

#### Preserve dashboard routing

For existing orders, the importer updates detail fields but does **not** overwrite:

- `DashboardTruckId`
- `DashboardRouteDate`
- `DashboardSequence`
- `RoutingSource`
- `NeedsEpassUpdate`

For new orders, the importer maps EPASS truck code to `DashboardTruckId` and sets `DashboardRouteDate` to EPASS delivery date.

---

## 10. Task Scheduler

### Task name

```text
Wilson Routing EPASS Import
```

### Schedule

Runs every 5 minutes indefinitely.

### Program/script

Initially `py` failed in Task Scheduler with:

```text
The system cannot find the file specified. (0x80070002)
```

The fix was to use the exact Python executable from:

```text
py -3 -c "import sys; print(sys.executable)"
```

### Arguments

When using full `python.exe` path, arguments should be only:

```text
C:\WilsonRouting\import_epass.py
```

Do **not** include `-3` when calling the actual `python.exe` directly.

### Start in

```text
C:\WilsonRouting
```

### Good result

Task Scheduler shows:

```text
0x0
```

or while running briefly:

```text
0x41301
```

### Expected log behavior

If no new CSV exists:

```text
This exact file has already been imported. Nothing to do.
```

---

## 11. Flask Dashboard

### File

```text
C:\WilsonRouting\dashboard.py
```

### Run command

```text
cd C:\WilsonRouting
py -3 dashboard.py
```

### URL

```text
http://localhost:5000
http://localhost:5000/sales
```

The dev server also printed a LAN IP such as:

```text
http://192.168.1.124:5000
```

### Important note

Flask warns:

```text
WARNING: This is a development server. Do not use it in a production deployment.
```

This is acceptable for proof-of-concept but **not production**.

---

## 12. Current Dashboard Pages and Features

### Route Board page `/`

Current version is read-only.

Shows:

- Last imported CSV.
- Route job count.
- Needs EPASS update count.
- Truck capacity cards.
- Jobs under each truck.
- Recent imported jobs.

### Sales Availability page `/sales`

Working features:

- Delivery rule dropdown from `dbo.PointRules` where `RuleType = 'Delivery'`.
- Install rule dropdown from `dbo.PointRules` where `RuleType <> 'Delivery'`.
- Manual `Quick units override` input box.
- Requested units calculation.
- Requested minutes calculation.
- Available Dates table.
- Hold date dropdown showing only dates that can fit the requested units.
- Place tentative hold with customer name and notes.
- Active Sales Holds table.
- Manual clear/release hold button.
- Holds reduce available capacity.
- Holds expire after 4 hours.
- Expired holds no longer reduce capacity because queries filter:

```sql
WHERE HoldStatus = 'Active'
  AND (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME())
```

### Sales hold expiration

Current hold expiration is **4 hours**:

```sql
DATEADD(hour, 4, SYSUTCDATETIME())
```

This was intentionally kept at 4 hours.

---

## 13. Sales Hold Workflow

Desired/current workflow:

```text
Sales picks delivery/install line(s) or enters quick units
→ Dashboard calculates units
→ Sales sees available dates
→ Sales chooses any open date, not only next available
→ Sales places a hold with customer and notes
→ Hold deducts from that date's open capacity
→ Sales secures payment and creates EPASS ticket
→ Next CSV import brings real ticket into dashboard
→ Sales or dispatcher clears hold manually
```

Planned future improvement:

```text
Auto-clear or match hold to EPASS ticket once imported
```

But user paused this and prioritized choosing any available date and quick unit input.

---

## 14. Current Sales Availability Logic

### Daily capacity

The function sums all active non-transfer trucks:

```sql
SELECT SUM(MaxUnits)
FROM dbo.Trucks
WHERE IsActive = 1
  AND IsTransferTruck = 0
```

This means `roxxiboxxi` does not contribute to normal sales capacity.

### Available date calculation

For the next 28 days:

```text
open_units = total_capacity - scheduled_units - active_nonexpired_hold_units
can_fit = requested_units > 0 AND open_units >= requested_units
```

### Hold date dropdown

The dropdown only displays dates with:

```text
day.can_fit == True
```

So if requested units are 3, only dates with at least 3 open units appear.

---

## 15. Manual Quick Units Override

Added because packages can include delivery plus multiple installs:

Example:

```text
Delivery + fridge install + dishwasher install + range install + hood install
```

Instead of forcing sales to select all lines, sales can type a known unit value such as:

```text
3
8
12
```

Manual override is final authority when filled.

### Python logic

```python
quick_units = request.args.get("quick_units", "").strip()

# Sum dropdown rule points first...

if quick_units:
    try:
        requested_units = Decimal(quick_units)
    except Exception:
        requested_units = Decimal("0")
```

### Template variable

`quick_units` must be passed to `render_template_string`.

---

## 16. Multi-Line Install Plan

User requested additional install lines hidden unless clicking **Add install line**.

Recommended design:

- Install rule 1 visible by default.
- Install rule 2 hidden.
- Install rule 3 hidden.
- Install rule 4 hidden.
- Button: `Add install line` shows the next hidden select.
- Manual quick units override still wins.

This feature was proposed but not confirmed completed in the conversation.

### Proposed JS

```html
<script>
let nextInstallLine = 2;

function showNextInstallLine() {
    const row = document.getElementById("install-line-" + nextInstallLine);
    if (row) {
        row.style.display = "block";
        nextInstallLine += 1;
    }
}
</script>
```

### Python route additions needed

```python
selected_install_id = request.args.get("install_rule_id", "")
selected_install_id_2 = request.args.get("install_rule_id_2", "")
selected_install_id_3 = request.args.get("install_rule_id_3", "")
selected_install_id_4 = request.args.get("install_rule_id_4", "")
```

Then add selected IDs:

```python
for install_id in [selected_install_id, selected_install_id_2, selected_install_id_3, selected_install_id_4]:
    if install_id:
        selected_rule_ids.append(install_id)
```

Also preserve extra IDs in hold form and use them when building `ApplianceType` for `SalesHolds`.

---

## 17. Active Sales Holds Display

Current desired table columns:

```text
Date Held | Customer | Units | Selected Rules | Notes | Created By | Created | Expires | Action
```

The user initially saw duplicate active holds tables. The old duplicate table was removed by deleting the older table block that contained:

```text
Appliance / Notes
```

The good table includes a manual clear button.

---

## 18. Security Concern and Recommendation

A concern was raised about customer data risk/breach if the dashboard goes live.

The concern is valid.

### Sensitive data present

- Customer name
- Address
- Phone
- Order number
- Delivery/install details
- Balance/status fields depending on display

### Current prototype security status

The current Flask app is a working proof-of-concept, **not production hardened**.

It should **not** be exposed to the public internet.

### Minimum before broad internal use

- Internal network only or VPN only.
- No public port forwarding.
- Authentication required.
- Role-based permissions:
  - Dispatcher: route board, holds, move jobs, clear holds.
  - Sales: sales availability and holds only.
  - Admin: rules/settings/import status.
- Production web server, not Flask dev server.
- SQL least-privilege app account, not admin user.
- Audit logs for holds and route moves.
- Hide unnecessary customer data from sales.
- Backups.
- HTTPS if accessed beyond localhost.
- Server/Windows/SQL/Python patching.

### Recommended safe phase 1

```text
Internal-only pilot
No public internet access
Only approved users on Wilson network
```

---

## 19. Known Issues / Cleanup Needed

### Code fragility

The current `dashboard.py` was edited manually in Notepad and had several indentation/syntax issues during the conversation. A future rebuild should use a proper editor like VS Code and source control.

### No authentication yet

Biggest production blocker.

### Flask dev server only

Should move to IIS/waitress/gunicorn-equivalent for Windows production.

For a Windows-friendly Python deployment, consider:

```text
waitress-serve
```

or packaging behind IIS/reverse proxy.

### Sales page not yet role-restricted

Sales can currently see what the page shows. Restrict and simplify before broad access.

### PointRules need cleanup

`PointRules` are seeded from raw EPASS detail lines and are all marked `NeedsReview = 1` initially. Need UI/admin cleanup:

- Rename `SalesDisplayName` to friendly names.
- Categorize by appliance.
- Hide weird/internal point lines from sales.
- Mark approved rules active.

### Auto-match holds to EPASS orders not implemented

Proposed but paused.

### Route board edit mode not implemented in Flask app

The React prototype had drag/drop conceptually. The live Flask dashboard is currently read-only for route board.

Need future dispatcher edit mode:

- Drag/drop or move form.
- Update `DashboardTruckId`, `DashboardRouteDate`, `DashboardSequence`.
- Set `RoutingSource='dashboard'`.
- Set `NeedsEpassUpdate=1`.
- Clear flag after EPASS manually updated.

---

## 20. Useful SQL Queries

### Verify trucks

```sql
SELECT * FROM dbo.Trucks;
```

### Verify imports

```sql
SELECT TOP 20 *
FROM dbo.ImportBatches
ORDER BY ImportBatchId DESC;
```

### Count route jobs

```sql
SELECT COUNT(*) AS RouteJobCount
FROM dbo.RouteJobs;
```

### Inspect route jobs

```sql
SELECT TOP 30
    OrderNumber,
    CustomerName,
    LatestEpassTruckCode,
    DashboardRouteDate,
    ServiceTimeMinutes,
    Units,
    Points,
    NeedsEpassUpdate
FROM dbo.RouteJobs
ORDER BY UpdatedAt DESC;
```

### Inspect point-bearing lines

```sql
SELECT
    Description,
    ProductCode,
    Points,
    COUNT(*) AS LineCount
FROM dbo.RawEpassDispatchRows
WHERE Points > 0
  AND (
        OrderNumber LIKE 'S000%'
        OR OrderNumber LIKE 'R000%'
      )
GROUP BY Description, ProductCode, Points
ORDER BY LineCount DESC, Description, ProductCode, Points;
```

### Inspect sales holds

```sql
SELECT TOP 20
    SalesHoldId,
    CustomerName,
    ApplianceType,
    HoldUnits,
    HoldDate,
    HoldStatus,
    Notes,
    CreatedBy,
    CreatedAt,
    ExpiresAt
FROM dbo.SalesHolds
ORDER BY SalesHoldId DESC;
```

### Clear old data and reimport

```sql
USE WilsonRouting;
GO

DELETE FROM dbo.RouteJobLines;
DELETE FROM dbo.RouteJobs;
DELETE FROM dbo.RawEpassDispatchRows;
DELETE FROM dbo.ImportBatches;
GO
```

Then run:

```text
cd C:\WilsonRouting
py -3 import_epass.py
```

---

## 21. File Backup Recommendation

Back up:

```text
C:\WilsonRouting
```

Also back up SQL database via SSMS:

```text
Right-click WilsonRouting → Tasks → Back Up...
```

Important notes to save:

```text
SQL Server: localhost\SQLEXPRESS
Database: WilsonRouting
EPASS folder: \\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport
Importer: C:\WilsonRouting\import_epass.py
Dashboard: C:\WilsonRouting\dashboard.py
Task Scheduler: Wilson Routing EPASS Import
```

---

## 22. Next Recommended Development Steps

1. **Stop feature additions and secure the prototype**
   - Add login.
   - Add roles.
   - Hide route/customer details from sales.

2. **Clean up codebase**
   - Move from a single giant `dashboard.py` string-template file to structured templates.
   - Use VS Code.
   - Initialize Git.

3. **Complete sales package builder**
   - Hidden extra install lines with Add Install Line button.
   - Manual units override remains final authority.

4. **PointRules admin page**
   - Friendly names.
   - Active/inactive.
   - Needs review.
   - Categories.

5. **Dispatcher edit mode**
   - Move jobs.
   - Sequence jobs.
   - Needs EPASS update workflow.

6. **Hold matching**
   - Match sales hold to imported EPASS ticket by customer/date/units.
   - Mark hold as matched.
   - Store matched order number.

7. **Production hosting**
   - Internal-only, authenticated, production server.

---

## 23. Current Conceptual Code Structure

### `import_epass.py`

Major functions:

- `log(message)`
- `clean(value)`
- `get_any(row, *names)`
- `to_decimal(value)`
- `to_int(value)`
- `to_date(value)`
- `newest_csv_file()`
- `ensure_not_already_imported(cursor, file_path)`
- `insert_import_batch(cursor, file_path)`
- `update_import_batch(cursor, import_batch_id, row_count, status)`
- `find_truck_id(cursor, epass_truck_code)`
- `insert_raw_row(cursor, import_batch_id, row)`
- `upsert_route_job(cursor, order)`
- `replace_route_job_lines(cursor, route_job_id, import_batch_id, lines)`
- `group_orders(rows)`
- `main()`

### `dashboard.py`

Major routes/functions:

- `/` → route board dashboard
- `/sales` → sales availability / holds
- `/sales/hold` → create hold
- `/sales/hold/release` → manual clear hold

Potential future:

- `/rules` → point rule admin
- `/dispatch/move` → move job
- `/sales/hold/match` → match EPASS ticket
- `/login`, `/logout`

---

## 24. Key Business Rules to Preserve

- 1 unit = 30 minutes.
- Use EPASS `Points`, not `Service Time`, for capacity.
- Include only `S000` and `R000` tickets for now.
- Ignore `SV00` service orders for now.
- Dashboard routing is source of truth once dispatcher changes a job.
- EPASS CSV updates order details but should not overwrite dashboard moves.
- roxxiboxxi is blocked from normal routing unless manually overridden.
- Sales holds expire after 4 hours.
- Sales holds reduce capacity only while active and non-expired.
- Sales should be view/hold only; dispatch owns routes.

---

## 25. Important User Preferences

- User is a novice and needs step-by-step hand-holding.
- They are comfortable using SSMS and Command Prompt with guidance.
- They prefer practical, incremental setup.
- They want to protect customer data and address breach concerns responsibly.
- They want the tool to eventually support two dispatchers and sales staff.
- They want sales to view availability and place holds, not edit routes.

