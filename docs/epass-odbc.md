# ePASS ODBC via 32-bit PowerShell

> Agility note (2026-09-19): this guide is the basis for `scripts/epass-odbc-pull.ps1`, which runs these
> queries on a schedule, writes CSVs to `W:\Agility\epass\`, and drops a JSON bundle for
> `scripts/epass-agent.ps1` to push to Agility (`kind = epass-open-orders`). Agility never reaches into the
> building; the DSN's stored credentials never leave Windows. Everything below is Andrew's original write-up.

## Purpose

This guide documents the working method we found for querying Wilson's ePASS / InterSystems Caché database directly through the existing Windows ODBC DSN using PowerShell.

The goal is to make it easy to pull ePASS data for analysis or exports without relying on Crystal Reports or the ePASS reporting UI.

> **Important:** Treat this as a read-only connection. Use `SELECT` queries only unless you have explicit database-admin approval. The existing DSN may connect with a highly privileged database account.

---

## 1. Use 32-bit PowerShell

The existing working ePASS ODBC DSN is 32-bit, so use the 32-bit Windows PowerShell executable.

Press **Win + R**, paste this, and press Enter:

```text
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
```

Do **not** assume normal 64-bit PowerShell or 64-bit Excel Power Query will work with this DSN.

The corresponding 32-bit ODBC Administrator is:

```text
C:\Windows\SysWOW64\odbcad32.exe
```

The working DSN is:

```text
COMPANY1
```

The DSN already has its database credentials saved, so the PowerShell connection can be opened without manually entering the database password.

---

## 2. Test the ePASS connection

Paste this into the 32-bit PowerShell window:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()
Write-Host "CONNECTED TO EPASS"
$conn.Close()
```

Expected output:

```text
CONNECTED TO EPASS
```

If the connection opens successfully, PowerShell can query ePASS.

---

## 3. Basic query pattern

This is the standard pattern for running a query and displaying the results:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$sql = @"
SELECT TOP 25
    Code,
    InvTypeCode,
    Status,
    JobStatusCode,
    DateCreated
FROM Invoice
ORDER BY DateCreated DESC
"@

$cmd = $conn.CreateCommand()
$cmd.CommandText = $sql

$adapter = New-Object System.Data.Odbc.OdbcDataAdapter($cmd)
$table = New-Object System.Data.DataTable
[void]$adapter.Fill($table)

$table | Format-Table -AutoSize

$conn.Close()
```

---

## 4. Export query results to CSV

For smaller pulls, the easiest method is to load the query into a DataTable and export it:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$sql = @"
SELECT TOP 1000
    Code,
    InvTypeCode,
    Status,
    JobStatusCode,
    DateCreated
FROM Invoice
ORDER BY DateCreated DESC
"@

$cmd = $conn.CreateCommand()
$cmd.CommandText = $sql

$adapter = New-Object System.Data.Odbc.OdbcDataAdapter($cmd)
$table = New-Object System.Data.DataTable
[void]$adapter.Fill($table)

$table | Export-Csv "$env:USERPROFILE\Desktop\epass_test.csv" -NoTypeInformation

$conn.Close()
```

The file will appear on the user's Desktop.

---

## 5. Reusable query helper

For repeated queries, define this function once after opening the connection:

```powershell
function Run-Query {
    param([string]$Sql)

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 120

    $adapter = New-Object System.Data.Odbc.OdbcDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)

    return $table
}
```

Example:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

function Run-Query {
    param([string]$Sql)

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 120

    $adapter = New-Object System.Data.Odbc.OdbcDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)

    return $table
}

$sql = @"
SELECT TOP 50
    Code,
    InvTypeCode,
    Status
FROM Invoice
ORDER BY DateCreated DESC
"@

$data = Run-Query $sql
$data | Format-Table -AutoSize

$conn.Close()
```

---

## 6. Inspect available tables

The database has a large number of tables. This command is useful for finding likely tables by name:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$tables = $conn.GetSchema("Tables")

$tables |
    Where-Object {
        $_.TABLE_NAME -match "Invoice|Customer|Model|Serial|Labor|Misc"
    } |
    Sort-Object TABLE_NAME |
    Select-Object TABLE_NAME |
    Format-Table -AutoSize

$conn.Close()
```

Useful ePASS tables we confirmed include:

```text
Customer
Invoice
InvoiceArchive
InvoiceItem
InvoiceLabor
InvoiceMisc
InvoiceModel
InvoiceSerial
InvoiceComment
InvoiceNote
LaborRate
Model
```

There are matching `InvoiceArchive...` tables for many historical detail types, although the archive table currently appears to be used mainly for `Q` invoice types rather than R/S/SV/WTY history.

---

## 7. Inspect columns in a table

Before writing a query against an unfamiliar ePASS table, inspect its columns first.

Example for `InvoiceMisc`:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$columns = $conn.GetSchema("Columns")

$columns |
    Where-Object { $_.TABLE_NAME -eq "InvoiceMisc" } |
    Sort-Object { [int]$_.ORDINAL_POSITION } |
    Select-Object COLUMN_NAME, TYPE_NAME, ORDINAL_POSITION |
    Format-Table -AutoSize

$conn.Close()
```

This is safer than guessing column names.

---

## 8. Important invoice type codes

Current Wilson ePASS invoice types we identified:

| InvTypeCode | Meaning |
|---|---|
| `R` | Retail appliance sale |
| `S` | Package / project appliance sale |
| `AC` | HVAC / AC sale |
| `CAB` | Cabinet sale |
| `SV` | Customer-pay service |
| `WTY` | Warranty service |
| `Q` | Quote |

Typical invoice number prefixes correspond roughly to:

```text
R000...   Retail sales
S000...   Package/project sales
AC000...  HVAC sales
CB000...  Cabinet sales
SV00...   Service tickets
```

For service, the **invoice number remains SV00...**, while `InvTypeCode` distinguishes customer-pay service (`SV`) from warranty (`WTY`).

---

## 8b. Finished orders (OE-23 replacement) and open quotes (2026-09-22)

The sales bundle also carries `open-quotes` (Quote Follow-Up). A third
bundle, `epass-finished-orders` (own outbox, first pull of each hour), carries
`finished-orders` + `finished-serials/items/labor/misc/warranty` +
`salespeople`: every invoice finished since the 1st of the previous month
(`UPPER(Status) IN ('FINISHED','NOT POSTED')`, not void,
`InvFinishDate >= since OR DateFinished >= since`), with the cost columns of
its lines. `-FinishedSince yyyy-MM-dd` widens the window for a one-time
backfill. The server rebuilds the OE-23 tickets from these
(`lib/epass-feed-finished.js`); doc 20 §7b has the column mapping and the
compare tool for checking it against a real OE-23.

## 8b2. PO link paths for open service tickets (2026-09-23)

The first pull with `open-service-po-items` carried 21 lines against ~90
open office items, so the service bundle now tries four link paths from a
ticket's part to a PO line — `POItem.BackOrderInvoiceCode`, the
`InvoiceItem.PODateStamp/POLineTimeStamp` = `POItem.DateStamp/LineTimeStamp`
stamps, `POItem.Reference` = ticket, and `PO.ShipToCode` = ticket — all
shaped alike (the ticket as `BackOrderInvoiceCode`), deduplicated on
ticket|PO|item, each row tagged with the path that found it. And a probe,
`open-service-parts-pending`: every part line on an open ticket with
`QtyOrdered > QtyShipped`, with its link columns (`SupplierCode`,
`OrderFromSupplierCode`, `AutoBackorder`, `Reference`, `PODateStamp`,
`DateCommitted`). Service Office Queues' top line reads both: "parts still
on order: N on M tickets, K linked to a PO line" — if K stays far below N
after this pull, the pending lines' raw columns (`epass_open_service_parts_pending.raw`)
show what ePASS actually stores for an ordered part. Column lists came from
`odbc/PO.csv`, `odbc/POItem.csv`, `odbc/InvoiceItem.csv` (the `-Discover`
output); `LaborRate`'s price column is `List`.

### 8b3a. Which units the shop may sell (2026-09-25)

An ALL-type unit is offered online only when nothing in ePASS has a claim on
it: `Serial.InvoiceCode` empty (not written on an invoice); **`OrderedForInvoiceCode`
empty or pointing at an invoice that is no longer open** (the "Ordered for
Inv" box — the same "spoken for" rule the ordering report uses; the open set is
`epass_open_orders` + `epass_open_service`, so a unit ordered for a sale that
finished, cancelled or was re-sourced and then unreserved rotates back into
stock and the shop); **`DateReserved` empty and `ReserveExclusive` off** (a live
reservation holds the unit whatever the ordered-for says). Held units stay in
the snapshot with `writtenTo` (the invoice) or `reserved` (the date /
`exclusive`) set — the cosmetic-damage form and the written-to history still
see them; a released unit keeps its old invoice in `orderedFor`. The Shop
Orders stock table shows "+N held" per model. `shop.lastRebuild` on
`/api/epass/open-orders/status` reports `spokenFor`, `reservedOnly`,
`orderedForClosed` (released units), `openInvoices` (size of the open set)
and `availBit` — how often `Serial.Available` (ePASS's own free flag)
disagrees with this rule (`falseButFree` / `trueButHeld`). If those two stay
at zero across a few bundles, `Available` alone could carry the rule. A
change in ePASS reaches the shop on the next sales bundle (15 min).

### 8b3c. Cart add-ons belong to their appliance; program days (2026-09-26)

Every install / hookup part in the online cart is tied to the appliance it
was picked for (`addonLines: [{ id, itemId, qty }]` on the page; the order
payload sends `itemId` and the stored order line carries `forItemId` /
`forModel`). Removing the appliance removes its add-ons; removing a part an
install can't happen without (`requires` groups in `data/shop-addons.json`)
warns that the install goes too, then removes both. A delivered appliance
with no installation gets a **$0 "Uncrate, set in place"** line (added
server-side in `priceShopCart`, shown in the cart and on Shop Orders) so the
order says what happens at the door; pickup orders get none.

The same-day install program has **program days** (`shop_express_settings.days`,
0 = Sunday … 6 = Saturday; default Mon–Sat) on Online Shop Orders: same-day is
offered only on an enabled day before the cutoff, and the fast next-day slots
land only on enabled days; with no days enabled the program is off and the
standard 3-working-day schedule applies.

### 8b3b. Shop prices from ePASS price levels (2026-09-24)

`model-list-prices` (sales bundle) carries `ModelListPrice` for every model
in stock — one row per model per `ListPriceCode`. Codes seen on open lines:
L1, L2, L3, LOWES, **RETAIL** (the retail deck — MAP / PMAP) and brand
floors SZ-UMRP, WOLF-UMRP, BESTMAP, SCOTMAP. Stored in
`epass_model_list_prices`. The Express Assortment sells an in-stock model at
its Shop Orders override, else **RETAIL**, else a brand UMRP/MAP code, else
L1 (then `Model.ListPrice`). The advertise floor is RETAIL or the brand code:
at or above it the price shows on the card; below it (an override) it shows
in the cart only. No price level at all → "Call for price".

**Brands never sold online** (they don't allow e-commerce): Sub-Zero (SZ),
Wolf (WOLF), Wolf Gourmet (WG), Cove (COVE), Gaggenau (GAGGE) — kept off
the shop entirely, clearance and in-stock; the catalog shows them as "brand
doesn't allow online sale". Since 9/25 the list lives in `shop_blocked_brands`
and is edited on **Online Shop Orders → Brands not sold online** (entries are
brand names or ePASS brand codes; 4+ letter entries also match longer names
that start with them). It is seeded once from the code default (or
`blockedBrands` in `data/shop-map-policy.json`, if present) and read from
memory, refreshed on every change and every 5 minutes.

**Express Assortment Catalog** (`shop-catalog.html`, Sales menu; anyone who
can open Online Shop Orders can open it) is the in-stock models table, moved
off Shop Orders. Filters: free text, **Brand** and **Merch Class** — both from
the NetSuite item catalog import on ePASS Uploads (`model_brand_map` now
keeps `merch_category` / `merch_class` / `merch_subclass` from the export's
"Merch Category" / "Merch Class" / "Merch Subclass" columns, e.g. "120
Dishwasher"). Models not in the import fall back to the ePASS brand and sit
under "no merch class" until the next import.

### 8b4. Keeping the feed alive (2026-09-24)

At 09:21 on 9/24 the Agility server fell over while it post-processed a
47 MB sales bundle and a 15 MB service bundle arrived — and the pull's
in-process agent call left the 09:15 run "running", so Task Scheduler
skipped every later trigger and the feed stopped. Since then:

- The pull starts `epass-agent.ps1` as its **own process with a 12-minute
  cap**; a stuck agent is stopped, the pull finishes, the next quarter-hour
  runs, and unsent files wait in the outbox.
- The agent holds a **single-run lock** (`Global\AgilityEpassAgent`); the
  pull-launched run and the agent's own task never push at the same time.
- Upload timeout is **5 minutes** (was 15): Agility acknowledges a bundle
  as soon as it is stored and processes afterwards.
- Agility keeps only what the post-processing queue needs from a sales
  bundle (Ordering Report rows, open quotes) and drops the rest before the
  queue runs; the shop snapshot is built first, from the stored tables, and
  again at boot when it is older than the feed.
- Belt and braces on the ePASS server: Task Scheduler → the pull task →
  Settings → **"Stop the task if it runs longer than 30 minutes"**.

### 8b3. Serial inventory from the feed (2026-09-24)

The `on-hand-serials` view (every `Serial` with a blank Status, joined to
`Model` for brand / description / product / SKU / list) now **replaces the
ExportModel (Model Maintenance) upload**: each 15-minute sales bundle
rebuilds the shop inventory snapshot (`saveShopInventorySnapshot`, the same
keys and unit shape the workbook parser produced — unit = model|serial,
"written to" = `Serial.InvoiceCode`, type = `SerialTypeCode`). The shop's
availability, the cosmetic-damage form's "units on this ticket" lookup and
the written-to history all read it unchanged. `postProcessing.inventory` on
`/api/epass/open-orders/status` shows rows / units / withModel / saved. Off
switch: service-journey setting `feed.inventory_enabled = false` makes the
ExportModel upload the source again (the `inventory` agent kind still works
either way — newest snapshot wins).


## 8c. The service catalogue (2026-09-23)

A fourth bundle, `epass-service-catalogue` (own outbox), carries every
finished SV/WTY ticket in a date slice — `catalogue-history` (header +
`SvcComplaintDesc` + `SvcPerformedDesc` + unit + payer + totals),
`catalogue-parts` (`InvoiceItem` with `SellingPrice` / `UnitCost`),
`catalogue-labor` (`InvoiceLabor` + `LaborRate.Description`) — and, on the
last slice, `labor-rates` (`SELECT lr.* FROM LaborRate`, the flat-rate book
as ePASS holds it). The slice filter is `InvTypeCode IN ('SV','WTY')`,
`UPPER(Status) = 'FINISHED'`, not void, `DateFinished` or `InvFinishDate`
inside the slice.

When it runs: by itself on the 6:00 pull (the last 21 days), or by hand —
`-CatalogueBackfill` writes one bundle per year since 2005 (run it once,
off-hours, from `C:\Agility`), `-CatalogueSince yyyy-MM-dd [-CatalogueUntil
yyyy-MM-dd]` one slice. Agility upserts by invoice number
(`lib/epass-catalogue-postgres.js`), so a slice can be pulled again at any
time. This is what the tech field tool's customer history, Model Insight and
component labor picker read, and the board's history drawer (doc 22).

## 8d. The sales tax bundle (2026-09-23)

The Crystal TAX REPORT (DatePosted · Sales Invoice · SoldToCity · SoldToState
· Tax2Code · Tax2Total · GrossTotal, one row per invoice posted in the
month) rebuilt as Agility's **Sales Tax Report** (Accounting, executives
only). A sixth bundle, `epass-tax` (own outbox): `tax-invoices` — every
invoice of any type with `DatePosted` inside the slice, not void, with
sold-to / bill-to city-state-zip, `Tax2Code`, `Tax2Percentage`,
`Tax3Percentage`, the three `TaxNExempt` flags, `TTRJurisdictionCode`, the
five pre-tax totals and `Tax1/2/3Total` — plus `tax-models`, `tax-items`,
`tax-misc`, `tax-labor` (those invoices' lines, each with its `Tax1/2/3`
flags, `LineCode` / `LineDesc` / `Qty` / `SellingPrice` / `Total`).

When it runs: by itself on the 6:00 pull (the last three posted months), or
`-TaxBackfill` (one bundle per **quarter** from `-TaxBackfillFrom`, default
2022 — the audit window; quarter-sized so each bundle stays well under the
60 MB upload limit and each query is short enough to run during the day). The agent pushes slice bundles **all, oldest first** — only the
open-orders / open-service / finished-orders feeds are snapshots where a
pile-up keeps just the newest (`$SnapshotKinds` in `epass-agent.ps1`;
before 9/23 every `epass-*` kind superseded, which shelved 18 of 19 quarter
bundles as `processed\epass-tax\superseded-…`) or `-TaxSince yyyy-MM-dd [-TaxUntil yyyy-MM-dd]`. Agility
(`lib/tax-report-postgres.js`) upserts by invoice code, derives
`gross` = Serial + Item + Labor + Misc + Wty totals (Crystal's GrossTotal —
a $157 diagnostic carries $12.95, 8.25%), and the **taxable / exempt base**
per invoice from the lines' `Tax2` flag. `/api/tax-report?from&to` and the
Excel export (`/api/tax-report/export.xlsx`: sheet 1 is Crystal's seven
columns in Crystal's order — with the auditor's later ask, **ship-to and
bill-to first and last name** (ePASS `SoldToFirstName/LastName`,
`BillToFirstName/LastName`, already in the bundle), slotted after the
invoice number as four separate columns — then Detail, By city, Totals). Every run and
export is audited (`tax_report_run`, `tax_report_exported`).

## 9. Service history logic

Do not filter finished service history based only on `JobStatusCode`.

Job status codes have changed over the years, and multiple finished outcomes matter. For example, `SO7` can represent a customer declining a repair and purchasing new equipment.

The safer service-history rule is:

```sql
WHERE (InvTypeCode = 'SV' OR InvTypeCode = 'WTY')
  AND Status = 'Finished'
```

Keep `JobStatusCode` as a field for analysis rather than using it as the primary inclusion filter.

### In the feed (2026-09-22): `service-history`

`scripts/epass-odbc-pull.ps1` now adds a `service-history` dataset to the
service bundle: the finished SV/WTY invoices of the last three years for
every customer who currently has an open ticket (`SoldToCode IN (open
tickets)`), header columns only — dates, tech (`Salesperson1Code`), brand /
model / serial, complaint and performed descriptions, totals. It lands in
`epass_service_history` (keyed by invoice, indexed by customer code, phone,
address+zip and serial) and is what the dispatch board's **Service history**
drawer shows under "Other visits", alongside the tickets Agility itself has
tracked. It is scoped to open-ticket customers on purpose: a full history
pull is tens of thousands of rows every 15 minutes for no benefit; when a
customer calls, their ticket is open and their history is already there.

Example:

```powershell
$sql = @"
SELECT TOP 100
    Code AS ServiceInvoice,
    InvTypeCode,
    Status,
    JobStatusCode,
    DateCreated,
    SvcBrandCode,
    SvcModel,
    SvcSerial,
    SvcComplaintDesc,
    SvcPerformedDesc,
    SvcInWarranty,
    Warranty
FROM Invoice
WHERE (InvTypeCode = 'SV' OR InvTypeCode = 'WTY')
  AND Status = 'Finished'
ORDER BY DateCreated DESC
"@
```

Useful service header fields include:

```text
SvcBrandCode
SvcProduct
SvcProductCode
SvcModel
SvcSerial
SvcDatePurchased
SvcComplaintCode
SvcComplaintDesc
SvcPerformedCode
SvcPerformedDesc
SvcRepairCode
SvcRepairCategory
SvcInWarranty
Warranty
JobStatusCode
```

---

## 10. Service parts

Service part / item detail is stored in `InvoiceItem` and joins to the service ticket through `InvoiceCode`.

Example:

```powershell
$sql = @"
SELECT
    p.InvoiceCode,
    p.ID,
    p.TripNo,
    p.ItemCode,
    p.ItemDesc,
    p.QtyOrdered,
    p.QtyShipped,
    p.SellingPrice,
    p.Total,
    p.UnitCost,
    p.Warranty,
    p.Installed,
    p.FailureCode
FROM InvoiceItem p
INNER JOIN Invoice i
    ON p.InvoiceCode = i.Code
WHERE (i.InvTypeCode = 'SV' OR i.InvTypeCode = 'WTY')
  AND i.Status = 'Finished'
"@
```

Keep individual part lines rather than flattening them into the service header.

---

## 11. Service labor with readable descriptions

`InvoiceLabor` contains the labor code, technician, trip, rate, total, etc.

The human-readable labor description comes from `LaborRate`.

Join:

```sql
LEFT JOIN LaborRate lr
    ON l.LaborRateCode = lr.Code
```

Example:

```powershell
$sql = @"
SELECT
    l.InvoiceCode,
    l.ID,
    l.TripNo,
    l.ServiceDate,
    l.TechnicianCode,
    l.TechnicianDesc,
    l.LaborRateCode,
    lr.Description AS LaborDescription,
    lr.BrandCode AS LaborBrandCode,
    l.Rate,
    l.Total,
    l.Warranty
FROM InvoiceLabor l
INNER JOIN Invoice i
    ON l.InvoiceCode = i.Code
LEFT JOIN LaborRate lr
    ON l.LaborRateCode = lr.Code
WHERE (i.InvTypeCode = 'SV' OR i.InvTypeCode = 'WTY')
  AND i.Status = 'Finished'
"@
```

This lets a code such as:

```text
ZN2-WOLF
```

be exported together with its readable description, such as:

```text
Service Zone 2
```

Always keep both `LaborRateCode` and `LaborDescription`.

---

## 12. Sales appliance model lines

Appliance / model lines live in `InvoiceModel`.

Typical join:

```sql
INNER JOIN InvoiceModel im
    ON i.Code = im.InvoiceCode

LEFT JOIN Model m
    ON im.ModelCode = m.Code
```

Useful fields include:

```text
InvoiceCode
LineTimeStamp
ModelCode
ModelDesc
QtyOrdered
QtyShipped
SellingPrice
Total
Status
LocationCode
POCode
Reference
InPackage
```

The `Model` master table can enrich the invoice line with:

```text
BrandCode
ProductCode
Description
SKU
ManufacturersWarranty
```

Example filter for sales families:

```sql
WHERE i.InvTypeCode IN ('R','S','AC','CAB')
```

---

## 13. Sales serial numbers

Serial numbers are stored separately in `InvoiceSerial`.

Important fields include:

```text
InvoiceCode
ModelCode
ModelLineTimeStamp
SerialCode
Status
Returned
Taken
TakenDate
LocationCode
```

The safest relationship back to the specific model line is:

```text
InvoiceCode
+ ModelCode
+ ModelLineTimeStamp
```

Do not join serials to sales model lines using only `InvoiceCode`, because one invoice can contain multiple appliance lines.

---

## 14. Miscellaneous sales lines

Install-related labor, materials, and other sales detail lines are stored in:

```text
InvoiceMisc
```

This is separate from:

```text
InvoiceModel
InvoiceItem
InvoiceLabor
```

For a complete sales-detail pull, include the `InvoiceMisc` rows along with model lines.

The safest workflow is to inspect the current `InvoiceMisc` schema first:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$columns = $conn.GetSchema("Columns")

$columns |
    Where-Object { $_.TABLE_NAME -eq "InvoiceMisc" } |
    Sort-Object { [int]$_.ORDINAL_POSITION } |
    Select-Object COLUMN_NAME, TYPE_NAME, ORDINAL_POSITION |
    Format-Table -AutoSize

$conn.Close()
```

Then join the misc lines to invoices through `InvoiceCode`.

Conceptually:

```sql
FROM Invoice i
INNER JOIN InvoiceMisc m
    ON i.Code = m.InvoiceCode
WHERE i.InvTypeCode IN ('R','S','AC','CAB')
```

---

## 15. Customer master

The customer master is stored in:

```text
Customer
```

Useful fields include:

```text
Code
AccountType
FirstName
LastName
Contact
ParentCompanyCode
BillToAccount
ProjectCode
Address1
Address2
Suite
City
State
ZipCode
Phone1
Phone2
BusinessPhone
Email
BillingEmail
PreferredContact
SalespersonCode
BranchCode
DateCreated
DateModified
LastActivityDate
```

### Data minimization

The Customer table also contains sensitive fields that generally should **not** be exported for sales/service analysis, including things such as:

```text
SSN
BirthDate
WebPassword
WebPassword2
```

Only select fields actually needed for the task.

---

## 16. Large exports: stream rows instead of loading everything into memory

For large historical exports, avoid loading 100,000+ rows into a PowerShell DataTable if possible, especially because this is 32-bit PowerShell.

Use an ODBC DataReader and stream rows directly to CSV.

Reusable example:

```powershell
function Convert-ToCsvField {
    param($Value)

    if ($null -eq $Value -or $Value -is [System.DBNull]) {
        return '""'
    }

    $s = [string]$Value

    if ($Value -is [string]) {
        $s = $s.Trim()
    }

    $s = $s.Replace('"', '""')

    return '"' + $s + '"'
}

function Export-OdbcQuery {
    param(
        [System.Data.Odbc.OdbcConnection]$Connection,
        [string]$Sql,
        [string]$Path,
        [string]$Name
    )

    Write-Host ""
    Write-Host "Starting: $Name"

    $cmd = $Connection.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 0

    $reader = $cmd.ExecuteReader()

    $utf8 = New-Object System.Text.UTF8Encoding($true)
    $writer = [System.IO.StreamWriter]::new($Path, $false, $utf8)

    $count = 0

    try {
        $headers = @()

        for ($i = 0; $i -lt $reader.FieldCount; $i++) {
            $headers += Convert-ToCsvField $reader.GetName($i)
        }

        $writer.WriteLine(($headers -join ","))

        while ($reader.Read()) {
            $row = @()

            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                if ($reader.IsDBNull($i)) {
                    $row += '""'
                }
                else {
                    $row += Convert-ToCsvField $reader.GetValue($i)
                }
            }

            $writer.WriteLine(($row -join ","))

            $count++

            if (($count % 10000) -eq 0) {
                Write-Host "${Name}: $count rows..."
            }
        }
    }
    finally {
        $writer.Close()
        $reader.Close()
        $cmd.Dispose()
    }

    Write-Host "${Name} COMPLETE: $count rows"
    return $count
}
```

Example use:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$sql = @"
SELECT
    Code,
    InvTypeCode,
    Status,
    DateCreated
FROM Invoice
"@

Export-OdbcQuery `
    $conn `
    $sql `
    "$env:USERPROFILE\Desktop\epass_invoice_export.csv" `
    "Invoice Export"

$conn.Close()
```

---

## 17. Useful table relationships

The most important relationships we confirmed are:

```text
Customer.Code
    -> Invoice.BillToCode / Invoice.SoldToCode

Invoice.Code
    -> InvoiceModel.InvoiceCode
    -> InvoiceSerial.InvoiceCode
    -> InvoiceItem.InvoiceCode
    -> InvoiceLabor.InvoiceCode
    -> InvoiceMisc.InvoiceCode
    -> InvoiceComment.InvoiceCode

InvoiceModel.InvoiceCode
+ InvoiceModel.ModelCode
+ InvoiceModel.LineTimeStamp
    -> InvoiceSerial.InvoiceCode
    -> InvoiceSerial.ModelCode
    -> InvoiceSerial.ModelLineTimeStamp

InvoiceLabor.LaborRateCode
    -> LaborRate.Code

InvoiceModel.ModelCode
    -> Model.Code
```

Added from the 2026-09-21 discovery run (`-Discover`, files in `odbc/`):

```text
Serial (the serial master — one row per physical unit, ~122k)
    Status                 '' = on hand (4,391), SOLD, TAKEN, RETURNED
    ModelCode              -> Model.Code
    OrderedForInvoiceCode  -> Invoice.Code   the invoice the unit was special-ordered / reserved for
    InvoiceCode            -> Invoice.Code   set once the unit is taken/sold on that invoice
    POCode, PODateStamp    -> PO.Code        how it arrived
    DateReceived, DateReserved, ReserveExclusive, LocationCode, BinLocationCode, Cost

InvoiceSerial only holds TAKEN units (97 rows on 622 open tickets) — it is not
where "reserved" lives. A unit promised to an open order is a Serial row with
Status blank and OrderedForInvoiceCode = that invoice. Every one of the 244
"Quantity Spoken For" rows on the 9/18 OE-04 matched an InvoiceModel line whose
POCode was set and whose unit had arrived.

PO.Code
    -> POModel.POCode      (line: ModelCode, QtyOrdered, QtyReceived, QtyPrevReceived,
                            ETADate, ETADateMostUpdated, RequestedDeliveryDate, RSDConfirmed,
                            Received (BIT), DateStamp — there is NO DateCreated on POModel)
POModel.BackOrderInvoiceCode
    -> Invoice.Code        the invoice a PO line was cut for (special order)
PO.SupplierCode / SupplierDescription, DateOrdered, DateConfirmed, Confirmed (a confirmation
number, not a flag), Buyer, RequestedDeliveryDate

InvoiceModel.POCode        set = already on a purchase order (the Ordering Report drops it)
Invoice.JobStatusCode      D1 "Waiting to Order", D2 "Procurement", D2R "Routed Before Prod Arrival",
                           D3 "Serials Reserved; Unassigned", D4 "Models Reserved Date Confirmed",
                           D5/D6 delivery, D7 complete, D8 cancelled — full list in odbc/lookup-JobStatus.csv
```

---

## 18. Important ePASS behavior / lessons learned

### Use exact database fields instead of assuming report behavior

ePASS screens and Crystal reports can hide how the data is actually stored. Inspecting the schema directly is often faster than guessing.

### Do not rely on `DateFinished` alone

Some service-history records did not behave as expected when filtering on `DateFinished`. For service history, the reliable working filter was:

```sql
Status = 'Finished'
```

### Preserve job status instead of filtering on specific status codes

Historical service status coding has changed. Keep `JobStatusCode` in the export instead of assuming only one completion code matters.

### Preserve negative lines

Service labor can contain positive and negative offsetting lines when labor is removed/rebooked. Do not collapse or delete negative rows before understanding them.

### Preserve `TripNo`

Both service parts and labor can be tied to individual trips. `TripNo` is useful for reconstructing multi-visit repairs.

### Preserve raw invoice numbers

Some service invoices can have suffixes such as:

```text
SV00121288-1
```

Do not strip these suffixes unless the business relationship has been explicitly verified.

### Trim text when exporting

Some ePASS/Caché text fields are space-padded. The streaming CSV helper above trims string values during export.

---

## 19. Known historical depth from the current Invoice table

At the time this guide was created, the current `Invoice` table contained data back to approximately:

| Type | Earliest DateCreated |
|---|---|
| `SV` | September 2006 |
| `WTY` | November 2006 |
| `S` | October 2006 |
| `AC` | August 2019 |
| `CAB` | August 2019 |
| `R` | August 2023 |

The relatively recent start of `R` may reflect a change in how retail sales were coded historically. Older retail appliance sales may exist under `S`, so do not assume `R` alone represents all historical retail activity.

---

## 20. Troubleshooting

### `DSN=COMPANY1` not found

Make sure you are using **32-bit PowerShell**:

```text
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
```

Check the DSN in the **32-bit ODBC Administrator**:

```text
C:\Windows\SysWOW64\odbcad32.exe
```

### Access denied / Native 417

The normal ePASS application username/password is not necessarily a database login.

Use the existing `COMPANY1` DSN with its stored database credentials:

```powershell
$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()
```

Do not try to recover or expose the stored database password.

### Query creates an empty CSV unexpectedly

Make the script stop on SQL errors rather than silently continuing:

```powershell
$ErrorActionPreference = "Stop"
```

Wrap `ExecuteReader()` in a try/catch if needed:

```powershell
try {
    $reader = $cmd.ExecuteReader()
}
catch {
    Write-Host $_.Exception.Message
    throw
}
```

### Query is slow

For historical pulls, use:

```powershell
$cmd.CommandTimeout = 0
```

and stream results to CSV rather than loading everything into RAM.

---

## 21. Safety / operating rules

Use this connection as **read-only** unless specifically authorized otherwise.

Safe examples:

```sql
SELECT ...
```

Avoid commands such as:

```text
UPDATE
INSERT
DELETE
DROP
ALTER
TRUNCATE
```

Also avoid extracting sensitive customer data unless it is actually needed for the business task.

---

## Quick-start template

For a colleague who just needs the shortest working example:

```powershell
# Run this in 32-bit Windows PowerShell:
# C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe

$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=COMPANY1;")
$conn.Open()

$sql = @"
SELECT TOP 100
    Code,
    InvTypeCode,
    Status,
    JobStatusCode,
    DateCreated,
    SoldToCode,
    SoldToFirstName,
    SoldToLastName
FROM Invoice
ORDER BY DateCreated DESC
"@

$cmd = $conn.CreateCommand()
$cmd.CommandText = $sql

$adapter = New-Object System.Data.Odbc.OdbcDataAdapter($cmd)
$table = New-Object System.Data.DataTable
[void]$adapter.Fill($table)

$table | Export-Csv "$env:USERPROFILE\Desktop\epass_test.csv" -NoTypeInformation

$conn.Close()

Write-Host "DONE"
```

If `epass_test.csv` appears on the Desktop with data, the colleague is successfully querying ePASS through ODBC.
