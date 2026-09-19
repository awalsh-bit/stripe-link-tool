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
#   open-service         Invoice header, InvTypeCode SV/WTY, Status not FINISHED, not void
#   open-service-labor   InvoiceLabor (+ LaborRate description) for those tickets
#   open-service-items   InvoiceItem (parts) for those tickets
#   open-service-comments / open-service-notes
#
# Sensitive columns never leave ePASS: anything whose name matches the
# deny-list below is dropped from every dataset (see Data minimization in
# docs/epass-odbc.md). Add names there, never remove them.
#
# SCHEDULE (Task Scheduler, e.g. every 30 minutes, 6am–8pm):
#   Program:  C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
#   Args:     -NoProfile -ExecutionPolicy Bypass -File "W:\Agility\epass-odbc-pull.ps1"
# One-off discovery (column lists for the tables we care about):
#   ... -File "W:\Agility\epass-odbc-pull.ps1" -Discover
# =============================================================================
param(
  [switch]$Discover,
  [string]$Dsn  = "COMPANY1",
  [string]$Root = "W:\Agility"
)

$ErrorActionPreference = "Stop"
if ([IntPtr]::Size -ne 4) { Write-Host "WARNING: this is 64-bit PowerShell; the COMPANY1 DSN is 32-bit. Use C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" }

$LatestDir = Join-Path $Root "epass"
$SchemaDir = Join-Path $LatestDir "schema"
$Outbox    = Join-Path $Root "outbox\epass-open-orders"
$SvcOutbox = Join-Path $Root "outbox\epass-open-service"
$LogFile   = Join-Path $Root "agent.log"
foreach ($d in @($LatestDir, $SchemaDir, $Outbox, $SvcOutbox)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

function Log([string]$msg) {
  $line = "{0}  [odbc] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
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
  Log ("{0}: {1} rows -> {2}" -f $Name, $rows.Count, $CsvPath)
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
    foreach ($t in @("Invoice", "InvoiceModel", "InvoiceSerial", "InvoiceMisc", "InvoiceItem", "InvoiceLabor", "InvoiceComment", "InvoiceNote", "Model", "Customer", "LaborRate", "PurchaseOrder", "PurchaseOrderModel", "Supplier", "Location", "Salesperson", "Technician")) {
      Step "schema $t" {
        $rows = @($script:columns | Where-Object { $_.TABLE_NAME -eq $t } | Sort-Object { [int]$_.ORDINAL_POSITION } |
          Select-Object COLUMN_NAME, TYPE_NAME, COLUMN_SIZE, ORDINAL_POSITION, @{ n = "Denied"; e = { Is-Denied $_.COLUMN_NAME } })
        if ($rows.Count -eq 0) { throw "no such table (or no columns visible)" }
        $rows | Export-Csv (Join-Path $SchemaDir "$t.csv") -NoTypeInformation
      }
    }
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

  $json = $svc | ConvertTo-Json -Depth 6 -Compress
  $path = Join-Path $SvcOutbox "epass-open-service-$stamp.json"
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
  Log ("bundle -> {0} ({1:n0} KB); epass-agent.ps1 will push it" -f $path, ($json.Length / 1024))
}
finally {
  $conn.Close()
}
