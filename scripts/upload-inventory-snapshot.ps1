# ============================================================================
# Wilson Agility — nightly inventory snapshot uploader
# ----------------------------------------------------------------------------
# Runs on the store server PC (the always-on Crystal Reports machine).
# Finds the newest ExportModel .xlsx in $ExportFolder and POSTs it to the
# Agility server, which parses it and refreshes the online shop's
# availability snapshot (serials, condition flags, written-to exclusions).
#
# SETUP (one time):
#   1. In EPASS, schedule the inventory report/export so a fresh
#      ExportModel*.xlsx lands in $ExportFolder every night (e.g. 1:00 AM).
#   2. On Render, set the env var SHOP_SNAPSHOT_KEY to a long random value
#      (e.g. 40+ characters) and paste the same value into $SnapshotKey below.
#   3. Windows Task Scheduler → Create Task:
#        - Trigger: Daily, ~1:30 AM (after the export lands)
#        - Action:  Program  = powershell.exe
#                   Args     = -NoProfile -ExecutionPolicy Bypass -File "C:\wilson\upload-inventory-snapshot.ps1"
#        - "Run whether user is logged on or not", wake the computer if needed
#   4. Run it once by hand and check upload-snapshot.log next to this script.
#
# The server pauses the storefront automatically if no fresh snapshot arrives
# for 48 hours, so a silent failure here closes the shop rather than selling
# units EPASS no longer has — check the log if the shop shows the pause note.
# ============================================================================

# ---- Configuration ---------------------------------------------------------
$ExportFolder = "C:\epass\exports"                # where the nightly export lands
$FilePattern  = "ExportModel*.xlsx"               # export filename pattern
$Endpoint     = "https://YOUR-DASHBOARD-HOST/api/shop/inventory-snapshot/file"
$SnapshotKey  = "PASTE-THE-SHOP_SNAPSHOT_KEY-VALUE-HERE"
$MaxAgeHours  = 26                                # refuse to upload an old leftover file
# ----------------------------------------------------------------------------

$LogFile = Join-Path $PSScriptRoot "upload-snapshot.log"
function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

try {
    $file = Get-ChildItem -Path $ExportFolder -Filter $FilePattern -File -ErrorAction Stop |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $file) {
        Log "FAIL: no $FilePattern found in $ExportFolder"
        exit 1
    }

    $ageHours = ((Get-Date) - $file.LastWriteTime).TotalHours
    if ($ageHours -gt $MaxAgeHours) {
        Log ("FAIL: newest file {0} is {1:N1}h old (limit {2}h) - did the EPASS export run?" -f $file.Name, $ageHours, $MaxAgeHours)
        exit 1
    }

    Log ("Uploading {0} ({1:N1} MB, {2:N1}h old)..." -f $file.Name, ($file.Length / 1MB), $ageHours)

    $response = Invoke-RestMethod -Method Post -Uri $Endpoint `
        -InFile $file.FullName `
        -ContentType "application/octet-stream" `
        -Headers @{ "x-snapshot-key" = $SnapshotKey; "x-source-file" = $file.Name } `
        -TimeoutSec 300

    Log ("OK: {0} serial keys ({1} units) - {2} condition-flagged, {3} written-to" -f `
        $response.count, $response.unitCount, $response.typedCount, $response.writtenCount)
    exit 0
}
catch {
    Log ("FAIL: {0}" -f $_.Exception.Message)
    exit 1
}
