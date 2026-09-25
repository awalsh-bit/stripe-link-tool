# =============================================================================
# Agility ePASS Agent - runs ON the showroom server (the machine that can see
# the W: drive). Watches W:\Agility\outbox\<kind>\ and pushes new ePASS
# exports to Agility over HTTPS. Outbound-only: nothing in the cloud ever
# touches the drive or the VPN.
#
# Folder layout (created automatically on first run):
#   W:\Agility\outbox\inventory     <- ExportModel .xlsx (serial inventory)
#   W:\Agility\outbox\quotes        <- Invoice Maintenance quote export .xlsx
#   W:\Agility\outbox\open-orders   <- OE-23 open-orders export .xls/.xlsx
#   W:\Agility\outbox\dispatch      <- DispatchTrack-format export .csv (sales + service)
#   W:\Agility\outbox\invoices      <- Invoice Maintenance open-invoice pull .xlsx (sales + service):
#                                       feeds Sales Order Health, Service Order Health and the
#                                       Service Journey mirror in one step
#   W:\Agility\outbox\epass-open-orders <- .json bundles written by epass-odbc-pull.ps1
#                                       (open sales invoices + lines + serials + misc straight
#                                       from ePASS via ODBC - no report export needed)
#   W:\Agility\outbox\epass-open-service <- same, for open SV/WTY tickets (+ labor, parts, comments, notes)
#   W:\Agility\outbox\epass-finished-orders <- same, finished orders (OE-23 replacement), hourly
#   W:\Agility\outbox\epass-service-catalogue <- same, finished service tickets + labor rates (history / Model Insight), daily + one-time backfill
#   W:\Agility\outbox\epass-tax <- same, posted invoices + lines with tax flags (Tax Report), daily + one-time backfill
#   W:\Agility\processed\<kind>\    <- files Agility accepted (kept 60 days)
#   W:\Agility\failed\<kind>\       <- files Agility rejected (bad export?)
#   W:\Agility\agent.log            <- what happened, when
#
# Save an ePASS export into the matching outbox folder and the next agent
# run uploads it. Accepted files move to processed\, rejected ones to
# failed\ (with the reason in agent.log). Network hiccups leave the file in
# place to retry on the next run.
#
# SCHEDULE (Windows Task Scheduler, run every 10 minutes):
#   Program:  powershell.exe
#   Args:     -NoProfile -ExecutionPolicy Bypass -File "\\WILSON-FS02\SharedDrive\Agility\epass-agent.ps1"
#   Run whether user is logged on or not. Use the UNC path, not W:\ - a
#   background task has no mapped drives, so a W:\ path silently never runs.
# =============================================================================

# ---- CONFIG ----------------------------------------------------------------
$BaseUrl  = "https://agility.wilsonappliance.com"
$AgentKey = "PASTE-EPASS_AGENT_KEY-HERE"   # must match Render env EPASS_AGENT_KEY
# Or keep the key OUT of this file: put it alone in epass-agent.key next to
# this script (one line, no quotes) and this script can be replaced by a
# straight copy from the repo from then on (2026-09-22).
# Root is the folder this script lives in. A scheduled task running "whether
# user is logged on or not" has no mapped drives, so a hard-coded W:\Agility
# made the agent do nothing for months; launched as
# \\WILSON-FS02\SharedDrive\Agility\epass-agent.ps1 it now finds its outbox
# either way (2026-09-21).
$Root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyFile  = Join-Path $Root "epass-agent.key"
if (Test-Path $keyFile) { $k = (Get-Content -Path $keyFile -Raw).Trim(); if ($k) { $AgentKey = $k } }
$KeepProcessedDays = 60
# The ODBC bundles arrive every 15 minutes (96 a day, the service one is big);
# keeping two days of those is plenty - Agility holds the latest anyway.
$KeepBundleDays = 2
# ----------------------------------------------------------------------------

$Kinds = @("inventory", "quotes", "open-orders", "dispatch", "invoices", "epass-open-orders", "epass-open-service", "epass-finished-orders", "epass-service-catalogue", "epass-tax")
# Feeds that are a full SNAPSHOT of the moment - when several pile up, only
# the newest matters. The catalogue and tax bundles are NOT snapshots: each
# one is a distinct date slice (a backfill writes one per year / quarter in a
# single run), so every one of them must go up, oldest first.
$SnapshotKinds = @("epass-open-orders", "epass-open-service", "epass-finished-orders")
$LogFile = Join-Path $Root "agent.log"

function Log([string]$msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line
}

# One agent at a time (9/24): the pull script launches this after every pull
# and it also has its own scheduled task - two runs pushing the same outbox
# at once doubled the load on Agility. The second one simply steps aside.
$agentMutex = New-Object System.Threading.Mutex($false, "Global\AgilityEpassAgent")
$haveLock = $false
try { $haveLock = $agentMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $haveLock = $true }
if (-not $haveLock) { Log "SKIP  another agent run is still active - this one exits"; exit 0 }

# Folder skeleton
foreach ($kind in $Kinds) {
  foreach ($sub in @("outbox", "processed", "failed")) {
    $dir = Join-Path $Root (Join-Path $sub $kind)
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  }
}

foreach ($kind in $Kinds) {
  $outbox = Join-Path $Root (Join-Path "outbox" $kind)
  # -Include only applies when the path ends in a wildcard (or -Recurse is on);
  # with a bare folder path Get-ChildItem returns nothing at all.
  $files = Get-ChildItem -Path (Join-Path $outbox "*") -File -Include *.xlsx, *.xls, *.csv, *.json |
           Where-Object { $_.Name -notlike "~$*" } |
           Where-Object { ((Get-Date) - $_.LastWriteTime).TotalSeconds -ge 30 } |   # still being written
           Sort-Object LastWriteTime
  # The open/finished ODBC bundles are full snapshots - only the newest one
  # matters. If earlier ones piled up (a slow VPN upload, the machine asleep),
  # park them in processed\ as superseded instead of pushing stale data ahead
  # of fresh. Slice bundles (catalogue, tax) skip this and all go up in order.
  if ($SnapshotKinds -contains $kind -and $files.Count -gt 1) {
    $stale = $files | Select-Object -First ($files.Count - 1)
    foreach ($old in $stale) {
      $dest = Join-Path $Root (Join-Path "processed" (Join-Path $kind ("superseded-" + $old.Name)))
      Move-Item -Path $old.FullName -Destination $dest -Force
      Log "SKIP  [$kind] $($old.Name) superseded by a newer bundle"
    }
    $files = $files | Select-Object -Last 1
  }
  # A service bundle can run to several MB and Agility mirrors every ticket
  # before answering; over the VPN that can take well past three minutes.
  # Agility acknowledges a bundle as soon as it is stored (processing runs
  # after the reply), so a healthy upload answers in well under 5 minutes even
  # at 47 MB over the VPN. Waiting longer only ever meant the server was down.
  $timeout = if ($kind -like "epass-*") { 300 } else { 180 }
  foreach ($file in $files) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/epass-agent/upload" `
        -InFile $file.FullName -ContentType "application/octet-stream" `
        -Headers @{ "x-agent-key" = $AgentKey; "x-upload-kind" = $kind; "x-source-file" = $file.Name } `
        -TimeoutSec $timeout
      $dest = Join-Path $Root (Join-Path "processed" (Join-Path $kind ("$stamp-" + $file.Name)))
      Move-Item -Path $file.FullName -Destination $dest -Force
      Log ("OK    [{0}] {1} ({2:n0} KB, {3:n0}s) -> {4}" -f $kind, $file.Name, ($file.Length / 1024), $sw.Elapsed.TotalSeconds, (($resp | ConvertTo-Json -Compress -Depth 3)))
    } catch {
      $status = $null
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      if ($status -ge 400 -and $status -lt 500 -and $status -ne 429) {
        # Agility read the file and said no (wrong export, no rows) - park it
        # in failed\ so it doesn't retry forever.
        $dest = Join-Path $Root (Join-Path "failed" (Join-Path $kind ("$stamp-" + $file.Name)))
        Move-Item -Path $file.FullName -Destination $dest -Force
        Log "FAIL  [$kind] $($file.Name) HTTP $status $($_.ErrorDetails.Message)"
      } else {
        # Network / server hiccup - leave in the outbox, retry next run.
        Log ("RETRY [{0}] {1} ({2:n0} KB, after {3:n0}s) {4}" -f $kind, $file.Name, ($file.Length / 1024), $sw.Elapsed.TotalSeconds, $_.Exception.Message)
      }
    }
  }
}

# Tidy old processed files
foreach ($kind in $Kinds) {
  $dir = Join-Path $Root (Join-Path "processed" $kind)
  $keep = if ($kind -like "epass-*") { $KeepBundleDays } else { $KeepProcessedDays }
  Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keep) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

try { if ($haveLock) { $agentMutex.ReleaseMutex() } } catch {}
