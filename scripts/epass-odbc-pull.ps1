# =============================================================================
# Agility ePASS ODBC pull — runs ON the showroom server (or any machine with
# the 32-bit COMPANY1 DSN), on a schedule, in 32-BIT Windows PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
#
# It reads ePASS (Caché) through the existing DSN — SELECT only — and writes:
#   W:\Agility\epass\<dataset>.csv                  latest copy, for Excel / anyone
#   W:\Agility\epass\schema\*.csv                   (-Discover) table & column lists
#   W:\Agility\outbox\epass-open-orders\*.json      one bundle per run (sales), which
#   W:\Agility\outbox\epass-open-service\*.json     epass-agent.ps1 pushes to Agility (service)
#   W:\Agility\outbox\epass-finished-orders\*.json  finished orders (OE-23 replacement), hourly
#
# Agility never reaches into the building: the bundle leaves through the same
# outbound-only agent as every other export. The DSN's stored credentials stay
# in Windows; this script never sees or stores a password.
#
# Datasets (first release: everything OPEN on the sales side):
#   open-orders          Invoice header, InvTypeCode in R/S/AC/CAB/MOD, Status not FINISHED, not void
#   open-order-lines     InvoiceModel for those invoices (+ Model brand/product/SKU)
#   open-order-serials   InvoiceSerial for those invoices
#   open-order-misc      InvoiceMisc for those invoices
#   open-order-models    Model master (+ Supplier name) for every model on those lines
#   on-hand-serials      Serial master, every unit in stock (Status blank) with the invoice it is promised to
#   open-po-lines        POModel lines not yet received (+ PO supplier/dates/ETA) for models on open lines
#   open-quotes          Invoice header, InvTypeCode Q, Status Open (Quote Follow-Up board)
#   finished-orders      (third bundle, epass-finished-orders, first run of each hour or -FinishedSince)
#                        Invoice header, every type, Status FINISHED / NOT POSTED, finished since the
#                        1st of last month — the OE-23 Salesperson Activity Report
#   finished-serials / finished-items / finished-labor / finished-misc / finished-warranty
#                        the cost columns of those invoices' lines (OE-23's C: row)
#   salespeople          Salesperson master (code -> name) so the feed prints the same names OE-23 did
#   open-service        Invoice header, InvTypeCode SV/WTY, Status not FINISHED, not void
#   open-service-labor   InvoiceLabor (+ LaborRate description) for those tickets
#   open-service-items   InvoiceItem (parts) for those tickets
#   open-service-comments / open-service-notes
#   open-service-po-items POItem + PO for parts back-ordered against those tickets (PO, supplier, ETA)
#   open-service-po-items-by-stamp  the same via InvoiceItem.PODateStamp/POLineTimeStamp (second link path)
#   service-history     finished SV/WTY invoices, last 3 years, for customers with an open ticket
#
# Sensitive columns never leave ePASS: anything whose name matches the
# deny-list below is dropped from every dataset (see Data minimization in
# docs/epass-odbc.md). Add names there, never remove them.
#
# WHERE IT RUNS (2026-09-22): on the ePASS server itself, from C:\Agility
# (this script + epass-agent.ps1 with the real key, copied from the share),
# as a Task Scheduler task "Agility ePASS pull": daily 6:00 AM, repeat every
# 15 minutes for 14 hours, "run whether user is logged on or not", "do not
# start a new instance". A full pull takes about five minutes there (it took
# twenty on a laptop over the VPN). The laptop task is disabled, kept as a
# fallback. Elevated prompt needed to create it:
#   schtasks /Create /TN "Agility ePASS pull" /SC DAILY /ST 06:00 /RU "DOMAIN\user" /RP * /RL HIGHEST /F `
#     /TR "C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"C:\Agility\epass-odbc-pull.ps1\" -Root \"C:\Agility\""
#   (then set the 15-minute repeat and the run-as options in the Task Scheduler UI)
# The script calls epass-agent.ps1 itself when it finishes, so the upload
# doesn't wait for the agent's own 10-minute task.
# One-off discovery (column lists for the tables we care about):
#   ... -File "W:\Agility\epass-odbc-pull.ps1" -Discover
# =============================================================================
param(
  [switch]$Discover,
  [string]$Dsn  = "COMPANY1",
  [string]$Root = "W:\Agility",
  # Finished orders normally cover the current + previous month. Pass a date
  # (yyyy-MM-dd) once to backfill history, e.g. -FinishedSince 2025-01-01.
  [string]$FinishedSince = ""
)

$ErrorActionPreference = "Stop"
if ([IntPtr]::Size -ne 4) { Write-Host "WARNING: this is 64-bit PowerShell; the COMPANY1 DSN is 32-bit. Use C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" }

$LatestDir = Join-Path $Root "epass"
$SchemaDir = Join-Path $LatestDir "schema"
$Outbox    = Join-Path $Root "outbox\epass-open-orders"
$SvcOutbox = Join-Path $Root "outbox\epass-open-service"
$FinOutbox = Join-Path $Root "outbox\epass-finished-orders"
# Own log file: the agent's 10-minute task writes agent.log and Add-Content
# fails when both hold it (seen 2026-09-21: "being used by another process").
$LogFile   = Join-Path $Root "odbc.log"
foreach ($d in @($LatestDir, $SchemaDir, $Outbox, $SvcOutbox, $FinOutbox)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

function Log([string]$msg) {
  $line = "{0}  [odbc] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  # Never let logging kill the pull: retry a few times, then carry on without it.
  for ($try = 0; $try -lt 5; $try++) {
    try { Add-Content -Path $LogFile -Value $line -ErrorAction Stop; return } catch { Start-Sleep -Milliseconds (150 * ($try + 1)) }
  }
}

# Columns that must never leave ePASS, matched case-insensitively against
# the column NAME (so WebPassword2, CreditCardNo, DriversLicense all match).
# (Patterns are substrings: "EIN" would have caught InvoiceLabor.TimeIn, so
# tax ids are matched as TaxId/FedId instead.)
$DenyPatterns = @("SSN", "SocialSec", "BirthDate", "DOB", "Password", "CreditCard", "CardNumber", "CardNo", "CVV", "Routing", "BankAcc", "BankAccount", "DriversLic", "DLNumber", "TaxId", "FedId", "FederalId", "TINNumber", "EmpSalary", "EmpAltIncome")
function Is-Denied([string]$name) { foreach ($p in $DenyPatterns) { if ($name -imatch $p) { return $true } }; return $false }

function Convert-ToCsvField($Value) {
  if ($null -eq $Value -or $Value -is [System.DBNull]) { return '""' }
  if ($Value -is [DateTime]) { return '"' + $Value.ToString("yyyy-MM-dd HH:mm:ss") + '"' }
  $s = [string]$Value
  if ($Value -is [string]) { $s = $s.Trim() }
  return '"' + $s.Replace('"', '""') + '"'
}

# Stream a query to CSV (denied columns skipped) and return the rows as an
# array of ordered hashtables for the JSON bundle. Open orders are a few
# thousand rows at most, so keeping them in memory is fine even in 32-bit.
function Export-Query {
  param([System.Data.Odbc.OdbcConnection]$Connection, [string]$Sql, [string]$CsvPath, [string]$Name)
  $cmd = $Connection.CreateCommand(); $cmd.CommandText = $Sql; $cmd.CommandTimeout = 0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $reader = $cmd.ExecuteReader()
  $writer = [System.IO.StreamWriter]::new($CsvPath, $false, (New-Object System.Text.UTF8Encoding($true)))
  $rows = New-Object System.Collections.ArrayList
  $script:badCols = New-Object System.Collections.ArrayList
  $keep = @(); $names = @()
  try {
    for ($i = 0; $i -lt $reader.FieldCount; $i++) { $n = $reader.GetName($i); if (-not (Is-Denied $n)) { $keep += $i; $names += $n } }
    $writer.WriteLine((($names | ForEach-Object { Convert-ToCsvField $_ }) -join ","))
    while ($reader.Read()) {
      $cells = New-Object System.Collections.ArrayList; $obj = [ordered]@{}
      for ($k = 0; $k -lt $keep.Count; $k++) {
        $i = $keep[$k]; $n = $names[$k]
        if ($reader.IsDBNull($i)) { [void]$cells.Add('""'); $obj[$n] = $null }
        else {
          try { $v = $reader.GetValue($i) } catch { $v = "" ; if (-not $script:badCols.Contains($n)) { [void]$script:badCols.Add($n) } }
          [void]$cells.Add((Convert-ToCsvField $v))
          if ($v -is [DateTime]) { $v = $v.ToString("yyyy-MM-dd HH:mm:ss") } elseif ($v -is [string]) { $v = $v.Trim() } elseif ($v -is [decimal] -or $v -is [double] -or $v -is [single]) { $v = [double]$v }
          $obj[$n] = $v
        }
      }
      $writer.WriteLine(($cells -join ","))
      [void]$rows.Add($obj)
    }
  } finally { $writer.Close(); $reader.Close(); $cmd.Dispose() }
  Log ("{0}: {1} rows in {2:n0}s -> {3}" -f $Name, $rows.Count, $sw.Elapsed.TotalSeconds, $CsvPath)
  if ($script:badCols.Count) { Log ("{0}: could not read column(s) {1} (left blank)" -f $Name, ($script:badCols -join ", ")) }
  return ,$rows
}

$conn = New-Object System.Data.Odbc.OdbcConnection("DSN=$Dsn;")
$conn.Open()
Log ("connected to {0} (PowerShell {1}, {2}-bit, discover={3})" -f $Dsn, $PSVersionTable.PSVersion, ([IntPtr]::Size * 8), [bool]$Discover)

try {
  if ($Discover) {
    # Each step is independent: one failing table must not stop the rest, so
    # every step logs its own error and moves on. The status mix comes first —
    # it is the file that decides what "open" means.
    function Step([string]$name, [scriptblock]$body) {
      try { & $body; Log "discover ok: $name" } catch { Log ("discover FAILED: {0} -> {1}" -f $name, $_.Exception.Message) }
      # A failed statement can leave the Caché ODBC connection unusable; reopen it so the next step still runs.
      if ($conn.State -ne [System.Data.ConnectionState]::Open) {
        try { $conn.Close() } catch {}
        try { $conn.Open(); Log "reconnected to $Dsn" } catch { Log ("reconnect FAILED: {0}" -f $_.Exception.Message) }
      }
    }
    Step "status mix" { [void](Export-Query $conn @"
SELECT InvTypeCode, Status, JobStatusCode, Void, COUNT(*) AS Invoices, MIN(DateCreated) AS Earliest, MAX(DateCreated) AS Latest
FROM Invoice
GROUP BY InvTypeCode, Status, JobStatusCode, Void
ORDER BY InvTypeCode, Status, JobStatusCode, Void
"@ (Join-Path $SchemaDir "invoice-status-mix.csv") "status mix") }
    Step "line status mix" { [void](Export-Query $conn @"
SELECT i.InvTypeCode, im.Status AS LineStatus, im.TakenStatus, COUNT(*) AS Lines
FROM InvoiceModel im INNER JOIN Invoice i ON im.InvoiceCode = i.Code
WHERE i.InvTypeCode IN ('R','S','AC','CAB','MOD') AND UPPER(i.Status) <> 'FINISHED'
GROUP BY i.InvTypeCode, im.Status, im.TakenStatus
ORDER BY i.InvTypeCode, im.Status, im.TakenStatus
"@ (Join-Path $SchemaDir "open-line-status-mix.csv") "line status mix") }
    Step "sample open invoices" { [void](Export-Query $conn @"
SELECT TOP 200 * FROM Invoice WHERE InvTypeCode IN ('R','S','AC','CAB','MOD') AND UPPER(Status) <> 'FINISHED' ORDER BY DateCreated DESC
"@ (Join-Path $SchemaDir "sample-open-invoices.csv") "sample open invoices") }
    Step "sample open lines" { [void](Export-Query $conn @"
SELECT TOP 300 im.* FROM InvoiceModel im INNER JOIN Invoice i ON im.InvoiceCode = i.Code
WHERE i.InvTypeCode IN ('R','S','AC','CAB','MOD') AND UPPER(i.Status) <> 'FINISHED' ORDER BY im.DateCreated DESC
"@ (Join-Path $SchemaDir "sample-open-lines.csv") "sample open lines") }
    Step "tables" {
      $tables = $conn.GetSchema("Tables")
      $tables | Select-Object TABLE_SCHEM, TABLE_NAME, TABLE_TYPE | Export-Csv (Join-Path $SchemaDir "tables.csv") -NoTypeInformation
    }
    $columns = $null
    Step "columns" { $script:columns = $conn.GetSchema("Columns") }
    # Names from Crystal's Database Expert (Andrew, 2026-09-21): the Serial
    # master (reserved-but-not-taken units), PO tables, the status/type
    # lookups, zones, routes, techs, returns.
    foreach ($t in @("Invoice", "InvoiceModel", "InvoiceSerial", "InvoiceMisc", "InvoiceItem", "InvoiceLabor", "InvoiceComment", "InvoiceNote", "InvoiceReturns", "InvoiceWarranty",
                     "Model", "ModelMinMax", "ModelSupplierQOH", "ModelListPrice", "Customer", "LaborRate", "Supplier", "Location", "Salesperson", "Technician",
                     "Serial", "SerialType", "SerialSales", "PO", "POModel", "POSerial", "POItem", "POComment", "POCancelledOrders",
                     "JobStatus", "JobStatusDepartment", "InvType", "Priority", "MapZone", "MapZoneDelivery", "Route", "RouteDepartment", "Brand", "Product", "ProductMajor", "ProductMinor",
                     "Repair", "Symptom", "ServiceRequest", "ServicePerformed", "ReturnReason", "ReturnOutcome", "ReturnInitiatedBy", "Item", "ItemLocation", "Branch", "Qualification",
                     # Dispatch side (seen in tables.csv 2026-09-21, never described): ePASS's own
                     # routing table, zone polygons, tech qualifications, the scheduler.
                     "DispRoute", "DispatchMeJob", "DispatchMeError", "MapZoneCoordinates", "MapZoneVertices", "MapZoneDepartment", "RouteQualifications", "Scheduler", "ScheduleTaskHist")) {
      Step "schema $t" {
        $rows = @($script:columns | Where-Object { $_.TABLE_NAME -eq $t } | Sort-Object { [int]$_.ORDINAL_POSITION } |
          Select-Object COLUMN_NAME, TYPE_NAME, COLUMN_SIZE, ORDINAL_POSITION, @{ n = "Denied"; e = { Is-Denied $_.COLUMN_NAME } })
        if ($rows.Count -eq 0) { throw "no such table (or no columns visible)" }
        $rows | Export-Csv (Join-Path $SchemaDir "$t.csv") -NoTypeInformation
      }
    }
    # Small lookup tables in full (no customer data in any of them) — the
    # meanings behind the codes the invoices carry.
    foreach ($t in @("JobStatus", "JobStatusDepartment", "InvType", "Priority", "MapZone", "MapZoneDelivery", "Route", "RouteDepartment", "Brand", "Product", "ProductMajor", "ProductMinor", "Location", "Salesperson", "Technician", "SerialType", "ReturnReason", "ReturnOutcome", "ReturnInitiatedBy", "Symptom", "Repair", "ServicePerformed", "Qualification", "Branch", "LaborRate",
                     "RouteQualifications", "MapZoneCoordinates", "MapZoneVertices", "MapZoneDepartment")) {
      Step "lookup $t" { [void](Export-Query $conn "SELECT TOP 2000 * FROM $t" (Join-Path $SchemaDir "lookup-$t.csv") "lookup $t") }
    }
    # Where do reserved-but-not-taken units live? Probe the Serial master for
    # anything pointing at an open invoice, and the PO side for open lines.
    Step "serial reservations" { [void](Export-Query $conn @"
SELECT TOP 500 s.* FROM Serial s INNER JOIN Invoice i ON s.InvoiceCode = i.Code
WHERE i.InvTypeCode IN ('R','S','AC','CAB','MOD') AND UPPER(i.Status) <> 'FINISHED'
"@ (Join-Path $SchemaDir "probe-serial-reserved.csv") "serial reservations") }
    Step "serial status mix" { [void](Export-Query $conn @"
SELECT Status, COUNT(*) AS Serials, SUM(CASE WHEN InvoiceCode IS NULL OR InvoiceCode = '' THEN 0 ELSE 1 END) AS WithInvoice
FROM Serial GROUP BY Status ORDER BY Status
"@ (Join-Path $SchemaDir "probe-serial-status-mix.csv") "serial status mix") }
    # POModel has no DateCreated (the 2026-09-21 run failed on it): DateStamp is the line date.
    Step "open PO lines" { [void](Export-Query $conn @"
SELECT TOP 300 pm.* FROM POModel pm ORDER BY pm.DateStamp DESC
"@ (Join-Path $SchemaDir "probe-po-model.csv") "open PO lines") }
    # Units in stock that are already promised: on hand (Status blank) and
    # pointing at an invoice through OrderedForInvoiceCode — the 9/18 OE-04's
    # "Quantity Spoken For" rows all matched lines with a PO that had arrived.
    Step "serials on hand for open invoices" { [void](Export-Query $conn @"
SELECT TOP 500 s.Code, s.ModelCode, s.Status, s.InvoiceCode, s.OrderedForInvoiceCode, s.OrderedForInvoiceDateStamp, s.DateReserved, s.ReserveExclusive, s.Available,
       s.POCode, s.PODateStamp, s.LocationCode, s.BinLocationCode, s.DateReceived, s.SerialTypeCode, s.Cost
FROM Serial s INNER JOIN Invoice i ON s.OrderedForInvoiceCode = i.Code
WHERE (s.Status IS NULL OR s.Status = '') AND i.InvTypeCode IN ('R','S','AC','CAB','MOD') AND UPPER(i.Status) <> 'FINISHED'
"@ (Join-Path $SchemaDir "probe-serial-onhand-for-invoice.csv") "serials on hand for open invoices") }
    Step "PO headers" { [void](Export-Query $conn @"
SELECT TOP 200 * FROM PO ORDER BY DateCreated DESC
"@ (Join-Path $SchemaDir "probe-po.csv") "PO headers") }
    # ---- service / dispatch probes (2026-09-21, for the service journey) ----
    # Which of the fields the placement engine wants does ePASS actually fill
    # on open service tickets? (Invoice already carries SoldToLatitude /
    # SoldToLongitude on 612 of 612 open sales orders — ePASS geocodes.)
    Step "service field population" { [void](Export-Query $conn @"
SELECT InvTypeCode, JobStatusCode, COUNT(*) AS Tickets,
       SUM(CASE WHEN SvcScheduleDate IS NULL THEN 0 ELSE 1 END) AS WithSvcScheduleDate,
       SUM(CASE WHEN ScheduleDate IS NULL THEN 0 ELSE 1 END) AS WithScheduleDate,
       SUM(CASE WHEN SoldToLatitude IS NULL OR SoldToLatitude = 0 THEN 0 ELSE 1 END) AS WithLatLng,
       SUM(CASE WHEN MapZoneCode IS NULL OR MapZoneCode = '' THEN 0 ELSE 1 END) AS WithZone,
       SUM(CASE WHEN DispatchRequestedRouteCode IS NULL OR DispatchRequestedRouteCode = '' THEN 0 ELSE 1 END) AS WithRoute,
       SUM(CASE WHEN Qualification IS NULL OR Qualification = '' THEN 0 ELSE 1 END) AS WithQualification,
       SUM(CASE WHEN DispatchTimeAM IS NULL OR DispatchTimeAM = '' THEN 0 ELSE 1 END) AS WithTimeAM,
       SUM(CASE WHEN DispatchUnits IS NULL THEN 0 ELSE 1 END) AS WithUnits,
       SUM(CASE WHEN Priority IS NULL OR Priority = '' THEN 0 ELSE 1 END) AS WithPriority
FROM Invoice
WHERE InvTypeCode IN ('SV','WTY') AND UPPER(Status) <> 'FINISHED'
GROUP BY InvTypeCode, JobStatusCode ORDER BY InvTypeCode, JobStatusCode
"@ (Join-Path $SchemaDir "probe-service-fields.csv") "service field population") }
    # Labor lines carry the tech, the trip number and the clock times — the
    # learned on-site durations the engine wants (duration.learn_after_days).
    Step "labor trips" { [void](Export-Query $conn @"
SELECT TOP 500 l.InvoiceCode, l.TripNo, l.TechnicianCode, l.ServiceDate, l.TimeIn, l.TimeInAM, l.TimeOut, l.TimeOutAM, l.HdthsMin, l.TimeCharged, l.LaborRateCode, l.JobStatus, l.Warranty, l.TripCharge
FROM InvoiceLabor l ORDER BY l.ServiceDate DESC
"@ (Join-Path $SchemaDir "probe-labor-trips.csv") "labor trips") }
    # ePASS's own routing tables: stop order per route/day (open item 32) and
    # the DispatchMe job feed.
    Step "DispRoute sample" { [void](Export-Query $conn "SELECT TOP 500 * FROM DispRoute" (Join-Path $SchemaDir "probe-disproute.csv") "DispRoute sample") }
    Step "DispRoute count" { [void](Export-Query $conn "SELECT COUNT(*) AS Rows FROM DispRoute" (Join-Path $SchemaDir "probe-disproute-count.csv") "DispRoute count") }
    Step "DispatchMeJob sample" { [void](Export-Query $conn "SELECT TOP 300 * FROM DispatchMeJob" (Join-Path $SchemaDir "probe-dispatchmejob.csv") "DispatchMeJob sample") }
    Step "Scheduler sample" { [void](Export-Query $conn "SELECT TOP 200 * FROM Scheduler" (Join-Path $SchemaDir "probe-scheduler.csv") "Scheduler sample") }
    Log "discovery complete -> $SchemaDir"
    return
  }

  # ---- OPEN ORDERS --------------------------------------------------------
  # Header first (SELECT * so a column we don't know about yet still arrives;
  # the deny-list is applied on the way out). Lines/serials/misc join back
  # through the same open-invoice condition so the four files agree.
  # Status values are upper-case in the data: OPEN, COMMITTED, NOT POSTED, FINISHED
  # (discovery 2026-09-19). MOD is a sales-side type the guide didn't list (18 open).
  $openWhere = "i.InvTypeCode IN ('R','S','AC','CAB','MOD') AND UPPER(i.Status) <> 'FINISHED' AND (i.Void IS NULL OR i.Void = 0)"
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $bundle = [ordered]@{
    pulledAt  = (Get-Date).ToString("s")
    source    = $Dsn
    machine   = $env:COMPUTERNAME
    datasets  = [ordered]@{}
  }
  $bundle.datasets["open-orders"] = Export-Query $conn @"
SELECT i.* FROM Invoice i WHERE $openWhere ORDER BY i.DateCreated
"@ (Join-Path $LatestDir "open-orders.csv") "open-orders"

  $bundle.datasets["open-order-lines"] = Export-Query $conn @"
SELECT im.*, m.BrandCode AS Model_BrandCode, m.ProductCode AS Model_ProductCode, m.Description AS Model_Description, m.SKU AS Model_SKU
FROM InvoiceModel im
INNER JOIN Invoice i ON im.InvoiceCode = i.Code
LEFT JOIN Model m ON im.ModelCode = m.Code
WHERE $openWhere
ORDER BY im.InvoiceCode, im.LineTimeStamp
"@ (Join-Path $LatestDir "open-order-lines.csv") "open-order-lines"

  $bundle.datasets["open-order-serials"] = Export-Query $conn @"
SELECT s.* FROM InvoiceSerial s
INNER JOIN Invoice i ON s.InvoiceCode = i.Code
WHERE $openWhere
ORDER BY s.InvoiceCode, s.ModelCode
"@ (Join-Path $LatestDir "open-order-serials.csv") "open-order-serials"

  $bundle.datasets["open-order-misc"] = Export-Query $conn @"
SELECT x.* FROM InvoiceMisc x
INNER JOIN Invoice i ON x.InvoiceCode = i.Code
WHERE $openWhere
ORDER BY x.InvoiceCode
"@ (Join-Path $LatestDir "open-order-misc.csv") "open-order-misc"

  # Model master for every model on an open line: stock position (QOH / QOO /
  # min / max), cost, and ePASS's own supplier — what the Ordering Report used
  # to read off the OE-04 totals rows and the NetSuite items CSV.
  $bundle.datasets["open-order-models"] = Export-Query $conn @"
SELECT m.Code, m.Description, m.BrandCode, m.ProductCode, m.SKU, m.SupplierCode, s.Description AS Supplier_Description,
       m.InventoryTypeCode, m.ABCRating, m.Stock, m.Obsolete, m.BeingDiscontinued, m.AllowSpecialOrder, m.Active,
       m.MainStockQOH, m.LocQOH, m.TotalQOO, m.TotalReserved, m.TotalBooked, m.TotalNotAvailable, m.TotalMin, m.TotalMax, m.EOQ, m.MasterPackQty,
       m.StandardCost, m.LastCost, m.AverageCost, m.LandedCost, m.ListPrice, m.LastDateReceived, m.LastDateOrdered, m.LastDateSold
FROM Model m
LEFT JOIN Supplier s ON m.SupplierCode = s.Code
WHERE m.Code IN (SELECT im.ModelCode FROM InvoiceModel im INNER JOIN Invoice i ON im.InvoiceCode = i.Code WHERE $openWhere)
ORDER BY m.Code
"@ (Join-Path $LatestDir "open-order-models.csv") "open-order-models"

  # Two more views the Ordering Report needs (2026-09-21), each guarded so a
  # column ePASS doesn't have can't take the bundle down with it:
  #  on-hand-serials  every unit in stock (Serial.Status blank) — with the invoice
  #                   it was ordered for / reserved to, receive date, bin, cost.
  #                   This is the "Serial # for Model" screen and the OE-04's
  #                   "Quantity Spoken For" in one (4,391 units on 9/21).
  #  open-po-lines    POModel lines not yet received for any model on an open
  #                   line, with the PO's supplier, dates and ETA, and the invoice
  #                   the line was special-ordered for (BackOrderInvoiceCode).
  $openModels = "SELECT im.ModelCode FROM InvoiceModel im INNER JOIN Invoice i ON im.InvoiceCode = i.Code WHERE $openWhere"
  try {
    $bundle.datasets["on-hand-serials"] = Export-Query $conn @"
SELECT s.Code, s.ModelCode, s.Status, s.InvoiceCode, s.OrderedForInvoiceCode, s.OrderedForInvoiceDateStamp, s.DateReserved, s.ReserveExclusive, s.Available,
       s.POCode, s.PODateStamp, s.LocationCode, s.BinLocationCode, s.DateReceived, s.SerialTypeCode, s.SupplierCode, s.Cost, s.StandardCost, s.FloorPlan, s.FloorPlanDueDate
FROM Serial s
WHERE (s.Status IS NULL OR s.Status = '')
ORDER BY s.ModelCode, s.DateReceived, s.Code
"@ (Join-Path $LatestDir "on-hand-serials.csv") "on-hand-serials"
  } catch { Log ("on-hand-serials FAILED (bundle continues without it): {0}" -f $_.Exception.Message); if ($conn.State -ne [System.Data.ConnectionState]::Open) { $conn.Open() } }

  try {
    $bundle.datasets["open-po-lines"] = Export-Query $conn @"
SELECT pm.POCode, pm.ModelCode, pm.QtyOrdered, pm.QtyReceived, pm.QtyPrevReceived, pm.ETADate, pm.ETADateMostUpdated, pm.RequestedDeliveryDate, pm.RSDConfirmed, pm.RSDMostUpdated,
       pm.DateReceived, pm.Received, pm.Ordered, pm.Unreleased, pm.BackOrderInvoiceCode, pm.BackOrderInvoiceDateStamp, pm.UnitCost, pm.StandardCost, pm.DateStamp, pm.LineTimeStamp,
       pm.LocationCode, pm.SerialTypeCode, pm.Reference,
       p.SupplierCode, p.SupplierDescription, p.DateCreated AS PO_DateCreated, p.DateOrdered AS PO_DateOrdered, p.DateConfirmed AS PO_DateConfirmed, p.Confirmed AS PO_Confirmed,
       p.Buyer AS PO_Buyer, p.RequestedDeliveryDate AS PO_RequestedDeliveryDate, p.DateReceived AS PO_DateReceived, p.Unreleased AS PO_Unreleased
FROM POModel pm
INNER JOIN PO p ON pm.POCode = p.Code
WHERE (pm.Received IS NULL OR pm.Received = 0)
  AND pm.ModelCode IN ($openModels)
ORDER BY pm.ModelCode, pm.POCode
"@ (Join-Path $LatestDir "open-po-lines.csv") "open-po-lines"
  } catch { Log ("open-po-lines FAILED (bundle continues without it): {0}" -f $_.Exception.Message); if ($conn.State -ne [System.Data.ConnectionState]::Open) { $conn.Open() } }

  # Open quotes (2026-09-22): what the Quote Follow-Up board used to get from
  # the Invoice Maintenance quote export. Header columns only; guarded.
  try {
    $bundle.datasets["open-quotes"] = Export-Query $conn @"
SELECT i.Code, i.InvTypeCode, i.Status, i.JobStatusCode, i.DateCreated, i.DateModified, i.Salesperson1Code, i.SoldToCode, i.BillToCode,
       i.SoldToLastName, i.SoldToFirstName, i.SoldToAddress1, i.SoldToCity, i.SoldToZipCode, i.PaymentTypeCode, i.Reference, i.PONumber,
       i.SerialTotal, i.ItemTotal, i.LaborTotal, i.MiscTotal, i.WtyTotal, i.Tax1Total, i.Tax2Total, i.Tax3Total, i.CommittedPaymentTotal, i.OpenPaymentTotal
FROM Invoice i
WHERE i.InvTypeCode IN ('Q','QUOTE') AND UPPER(i.Status) = 'OPEN' AND (i.Void IS NULL OR i.Void = 0)
ORDER BY i.DateCreated DESC
"@ (Join-Path $LatestDir "open-quotes.csv") "open-quotes"
  } catch { Log ("open-quotes FAILED (bundle continues without it): {0}" -f $_.Exception.Message); if ($conn.State -ne [System.Data.ConnectionState]::Open) { $conn.Open() } }

  $json = $bundle | ConvertTo-Json -Depth 6 -Compress
  $path = Join-Path $Outbox "epass-open-orders-$stamp.json"
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
  Log ("bundle -> {0} ({1:n0} KB); epass-agent.ps1 will push it" -f $path, ($json.Length / 1024))

  # ---- OPEN SERVICE TICKETS -----------------------------------------------
  # SV (customer-pay) and WTY (warranty) tickets that aren't finished, with
  # their labor (readable description from LaborRate), parts, comments and
  # notes. Same shape, second bundle, kind "epass-open-service".
  $svcWhere = "i.InvTypeCode IN ('SV','WTY') AND UPPER(i.Status) <> 'FINISHED' AND (i.Void IS NULL OR i.Void = 0)"
  $svc = [ordered]@{
    pulledAt  = (Get-Date).ToString("s")
    source    = $Dsn
    machine   = $env:COMPUTERNAME
    datasets  = [ordered]@{}
  }
  $svc.datasets["open-service"] = Export-Query $conn @"
SELECT i.* FROM Invoice i WHERE $svcWhere ORDER BY i.DateCreated
"@ (Join-Path $LatestDir "open-service.csv") "open-service"

  $svc.datasets["open-service-labor"] = Export-Query $conn @"
SELECT l.*, lr.Description AS Labor_Description, lr.BrandCode AS Labor_BrandCode
FROM InvoiceLabor l
INNER JOIN Invoice i ON l.InvoiceCode = i.Code
LEFT JOIN LaborRate lr ON l.LaborRateCode = lr.Code
WHERE $svcWhere
ORDER BY l.InvoiceCode, l.TripNo, l.LineTimeStamp
"@ (Join-Path $LatestDir "open-service-labor.csv") "open-service-labor"

  $svc.datasets["open-service-items"] = Export-Query $conn @"
SELECT p.* FROM InvoiceItem p
INNER JOIN Invoice i ON p.InvoiceCode = i.Code
WHERE $svcWhere
ORDER BY p.InvoiceCode, p.TripNo, p.LineTimeStamp
"@ (Join-Path $LatestDir "open-service-items.csv") "open-service-items"

  $svc.datasets["open-service-comments"] = Export-Query $conn @"
SELECT c.* FROM InvoiceComment c
INNER JOIN Invoice i ON c.InvoiceCode = i.Code
WHERE $svcWhere
ORDER BY c.InvoiceCode, c.TripNo, c.LineTimeStamp
"@ (Join-Path $LatestDir "open-service-comments.csv") "open-service-comments"

  # InvoiceNote keys on Code (the invoice number) rather than InvoiceCode.
  $svc.datasets["open-service-notes"] = Export-Query $conn @"
SELECT n.* FROM InvoiceNote n
INNER JOIN Invoice i ON n.Code = i.Code
WHERE $svcWhere
ORDER BY n.Code, n.CreateDate, n.CreateTime
"@ (Join-Path $LatestDir "open-service-notes.csv") "open-service-notes"

  # Parts on order for open tickets (2026-09-22 late): the PO line each part
  # was back-ordered against, with the supplier and ePASS's ETA if the buyer
  # keyed one — Service Office Queues shows PO + supplier so Kezia only types
  # the ETA. Guarded.
  try {
    $svc.datasets["open-service-po-items"] = Export-Query $conn @"
SELECT pi.POCode, pi.ItemCode, pi.QtyOrdered, pi.QtyReceived, pi.QtyPrevReceived, pi.Ordered, pi.Received, pi.ETADate, pi.DateReceived, pi.BackOrderInvoiceCode, pi.SupplierInvoice, pi.Reference,
       p.SupplierCode, p.SupplierDescription, p.DateCreated AS PO_DateCreated, p.DateOrdered AS PO_DateOrdered, p.DateConfirmed AS PO_DateConfirmed, p.Confirmed AS PO_Confirmed, p.Received AS PO_Received, p.RequestedDeliveryDate AS PO_RequestedDeliveryDate, p.ShipToType, p.Buyer
FROM POItem pi
INNER JOIN PO p ON pi.POCode = p.Code
WHERE pi.BackOrderInvoiceCode IN (SELECT i.Code FROM Invoice i WHERE $svcWhere)
ORDER BY pi.BackOrderInvoiceCode, pi.POCode
"@ (Join-Path $LatestDir "open-service-po-items.csv") "open-service-po-items"
    # Second link path: a service part's InvoiceItem row carries the PO line's
    # stamps (PODateStamp / POLineTimeStamp) even when the PO line has no
    # BackOrderInvoiceCode. Same columns, the ticket as BackOrderInvoiceCode.
    $svc.datasets["open-service-po-items-by-stamp"] = Export-Query $conn @"
SELECT pi.POCode, pi.ItemCode, pi.QtyOrdered, pi.QtyReceived, pi.QtyPrevReceived, pi.Ordered, pi.Received, pi.ETADate, pi.DateReceived, ii.InvoiceCode AS BackOrderInvoiceCode, pi.SupplierInvoice, pi.Reference,
       p.SupplierCode, p.SupplierDescription, p.DateCreated AS PO_DateCreated, p.DateOrdered AS PO_DateOrdered, p.DateConfirmed AS PO_DateConfirmed, p.Confirmed AS PO_Confirmed, p.Received AS PO_Received, p.RequestedDeliveryDate AS PO_RequestedDeliveryDate, p.ShipToType, p.Buyer
FROM InvoiceItem ii
INNER JOIN Invoice i ON ii.InvoiceCode = i.Code
INNER JOIN POItem pi ON pi.DateStamp = ii.PODateStamp AND pi.LineTimeStamp = ii.POLineTimeStamp
INNER JOIN PO p ON pi.POCode = p.Code
WHERE $svcWhere AND ii.PODateStamp IS NOT NULL
ORDER BY ii.InvoiceCode, pi.POCode
"@ (Join-Path $LatestDir "open-service-po-items-by-stamp.csv") "open-service-po-items-by-stamp"
  } catch { Log ("open-service-po-items FAILED (bundle continues without it): {0}" -f $_.Exception.Message); if ($conn.State -ne [System.Data.ConnectionState]::Open) { $conn.Open() } }

  # Service history (2026-09-22): the finished SV/WTY invoices of the last
  # three years for every customer who has an open ticket — what the board's
  # "Service history" drawer shows. Header columns only (no line detail);
  # guarded so the bundle survives without it.
  $histSince = (Get-Date).AddYears(-3).ToString("yyyy-MM-dd")
  try {
    $svc.datasets["service-history"] = Export-Query $conn @"
SELECT h.Code, h.InvTypeCode, h.Status, h.JobStatusCode, h.DateCreated, h.DateFinished, h.SvcScheduleDate, h.Salesperson1Code, h.SoldToCode,
       h.SoldToLastName, h.SoldToFirstName, h.SoldToAddress1, h.SoldToZipCode, h.SoldToPhone1,
       h.SvcBrandCode, h.SvcModel, h.SvcSerial, h.SvcProductCode, h.SvcComplaintDesc, h.SvcPerformedDesc, h.SvcRepairCode, h.PaymentTypeCode,
       h.SerialTotal, h.ItemTotal, h.LaborTotal, h.MiscTotal, h.WtyTotal, h.Tax1Total, h.Tax2Total, h.Tax3Total, h.DispatchUnits
FROM Invoice h
WHERE h.InvTypeCode IN ('SV','WTY') AND (h.Void IS NULL OR h.Void = 0)
  AND h.DateCreated >= '$histSince'
  AND UPPER(h.Status) = 'FINISHED'
  AND h.SoldToCode IN (SELECT i.SoldToCode FROM Invoice i WHERE $svcWhere)
ORDER BY h.SoldToCode, h.DateCreated DESC
"@ (Join-Path $LatestDir "service-history.csv") "service-history"
  } catch { Log ("service-history FAILED (bundle continues without it): {0}" -f $_.Exception.Message); if ($conn.State -ne [System.Data.ConnectionState]::Open) { $conn.Open() } }

  $json = $svc | ConvertTo-Json -Depth 6 -Compress
  $path = Join-Path $SvcOutbox "epass-open-service-$stamp.json"
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
  Log ("bundle -> {0} ({1:n0} KB)" -f $path, ($json.Length / 1024))

  # ---- FINISHED ORDERS (third bundle) ------------------------------------
  # What the OE-23 Salesperson Activity Report gave the Sales Order Detail
  # warehouse, Performance vs Target and the commission reports: header + the
  # cost columns of every line, for invoices of any type finished since the
  # 1st of the previous month (a month that just closed keeps refreshing until
  # its books settle). Its own bundle and outbox so the 15-minute sales bundle
  # stays small; finished orders barely move, so this runs on the first pull
  # of each hour only (or whenever -FinishedSince is given, e.g. a one-time
  # backfill with -FinishedSince 2025-01-01).
  $finSince = if ($FinishedSince -match '^\d{4}-\d{2}-\d{2}$') { $FinishedSince } else { (Get-Date -Day 1).AddMonths(-1).ToString("yyyy-MM-dd") }
  $doFinished = ($FinishedSince -ne "") -or ((Get-Date).Minute -lt 15)
  if ($doFinished) {
  $finWhere = "UPPER(i.Status) IN ('FINISHED','NOT POSTED') AND (i.Void IS NULL OR i.Void = 0) AND (i.InvFinishDate >= '$finSince' OR i.DateFinished >= '$finSince')"
  $fin = [ordered]@{
    pulledAt      = (Get-Date).ToString("s")
    source        = $Dsn
    machine       = $env:COMPUTERNAME
    finishedSince = $finSince
    datasets      = [ordered]@{}
  }
  try {
    $fin.datasets["finished-orders"] = Export-Query $conn @"
SELECT i.Code, i.InvTypeCode, i.Status, i.JobStatusCode, i.Department, i.BranchCode, i.DateCreated, i.InvStartDate, i.InvFinishDate, i.DateFinished, i.DatePosted,
       i.Salesperson1Code, i.Salesperson2Code, i.Salesperson2Percentage, i.SoldToCode, i.BillToCode,
       i.SoldToLastName, i.SoldToFirstName, i.BillToLastName, i.BillToFirstName, i.PaymentTypeCode, i.Reference, i.PONumber,
       i.SerialTotal, i.ItemTotal, i.LaborTotal, i.MiscTotal, i.WtyTotal, i.Tax1Total, i.Tax2Total, i.Tax3Total, i.Tax1Exempt, i.Tax2Exempt, i.Tax3Exempt,
       i.CommittedPaymentTotal, i.OpenPaymentTotal, i.COGSPosted, i.UserCreated, i.UserFinished
FROM Invoice i
WHERE $finWhere
ORDER BY i.InvFinishDate, i.Code
"@ (Join-Path $LatestDir "finished-orders.csv") "finished-orders"

    $fin.datasets["finished-serials"] = Export-Query $conn @"
SELECT s.InvoiceCode, s.ModelCode, s.SerialCode, s.UnitCost, s.Returned, s.Status
FROM InvoiceSerial s
INNER JOIN Invoice i ON s.InvoiceCode = i.Code
WHERE $finWhere
ORDER BY s.InvoiceCode
"@ (Join-Path $LatestDir "finished-serials.csv") "finished-serials"

    $fin.datasets["finished-items"] = Export-Query $conn @"
SELECT p.InvoiceCode, p.ItemCode, p.QtyOrdered, p.QtyShipped, p.SellingPrice, p.UnitCost, p.Total, p.Warranty, p.Status
FROM InvoiceItem p
INNER JOIN Invoice i ON p.InvoiceCode = i.Code
WHERE $finWhere
ORDER BY p.InvoiceCode
"@ (Join-Path $LatestDir "finished-items.csv") "finished-items"

    $fin.datasets["finished-labor"] = Export-Query $conn @"
SELECT l.InvoiceCode, l.LaborRateCode, l.TechnicianCode, l.Total, l.Cost, l.ActualCost, l.StandardCost, l.Warranty, l.TripCharge, l.TripChargeAmt
FROM InvoiceLabor l
INNER JOIN Invoice i ON l.InvoiceCode = i.Code
WHERE $finWhere
ORDER BY l.InvoiceCode
"@ (Join-Path $LatestDir "finished-labor.csv") "finished-labor"

    $fin.datasets["finished-misc"] = Export-Query $conn @"
SELECT x.InvoiceCode, x.MiscCode, x.Qty, x.SellingPrice, x.UnitCost, x.Total, x.Warranty
FROM InvoiceMisc x
INNER JOIN Invoice i ON x.InvoiceCode = i.Code
WHERE $finWhere
ORDER BY x.InvoiceCode
"@ (Join-Path $LatestDir "finished-misc.csv") "finished-misc"

    $fin.datasets["finished-warranty"] = Export-Query $conn @"
SELECT w.InvoiceCode, w.ExtWarrantyCode, w.Model, w.SellingPrice, w.UnitCost
FROM InvoiceWarranty w
INNER JOIN Invoice i ON w.InvoiceCode = i.Code
WHERE $finWhere
ORDER BY w.InvoiceCode
"@ (Join-Path $LatestDir "finished-warranty.csv") "finished-warranty"

    $fin.datasets["salespeople"] = Export-Query $conn @"
SELECT sp.Code, sp.Description, sp.Obsolete, sp.SalesGroup, sp.BranchCode, sp.CurrentSales
FROM Salesperson sp
ORDER BY sp.Code
"@ (Join-Path $LatestDir "salespeople.csv") "salespeople"
    $json = $fin | ConvertTo-Json -Depth 6 -Compress
    $path = Join-Path $FinOutbox "epass-finished-orders-$stamp.json"
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    Log ("bundle -> {0} ({1:n0} KB; finished since {2})" -f $path, ($json.Length / 1024), $finSince)
  } catch { Log ("finished-orders FAILED (the other bundles are unaffected): {0}" -f $_.Exception.Message); if ($conn.State -ne [System.Data.ConnectionState]::Open) { $conn.Open() } }
  } else { Log "finished-orders: skipped this run (first run of each hour only)" }
}
finally {
  $conn.Close()
}

# Hand the bundles to the agent right away instead of waiting for its own
# 10-minute task (self-scheduling reads this data, so freshness matters:
# pull every 15 minutes + push at once ≈ 2 minutes old, not 25). The agent
# skips files younger than 30 s, so give the last write a moment to settle.
$agent = Join-Path $Root "epass-agent.ps1"
if (-not $Discover -and (Test-Path $agent)) {
  Start-Sleep -Seconds 31
  try { & $agent; Log "epass-agent.ps1 ran" } catch { Log ("epass-agent.ps1 FAILED (its own task will retry): {0}" -f $_.Exception.Message) }
}
