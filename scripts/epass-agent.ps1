# =============================================================================
# Agility ePASS Agent — runs ON the showroom server (the machine that can see
# the W: drive). Watches W:\Agility\outbox\<kind>\ and pushes new ePASS
# exports to Agility over HTTPS. Outbound-only: nothing in the cloud ever
# touches the drive or the VPN.
#
# Folder layout (created automatically on first run):
#   W:\Agility\outbox\inventory     <- ExportModel .xlsx (serial inventory)
#   W:\Agility\outbox\quotes        <- Invoice Maintenance quote export .xlsx
#   W:\Agility\outbox\open-orders   <- OE-23 open-orders export .xls/.xlsx
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
#   Args:     -NoProfile -ExecutionPolicy Bypass -File "W:\Agility\epass-agent.ps1"
#   Run whether user is logged on or not; use an account that can read W:.
# =============================================================================

# ---- CONFIG ----------------------------------------------------------------
$BaseUrl  = "https://dashboards.wilsonappliance.com"
$AgentKey = "PASTE-EPASS_AGENT_KEY-HERE"   # must match Render env EPASS_AGENT_KEY
$Root     = "W:\Agility"
$KeepProcessedDays = 60
# ----------------------------------------------------------------------------

$Kinds = @("inventory", "quotes", "open-orders")
$LogFile = Join-Path $Root "agent.log"

function Log([string]$msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line
}

# Folder skeleton
foreach ($kind in $Kinds) {
  foreach ($sub in @("outbox", "processed", "failed")) {
    $dir = Join-Path $Root (Join-Path $sub $kind)
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  }
}

foreach ($kind in $Kinds) {
  $outbox = Join-Path $Root (Join-Path "outbox" $kind)
  $files = Get-ChildItem -Path $outbox -File -Include *.xlsx, *.xls -Recurse:$false |
           Where-Object { $_.Name -notlike "~$*" } | Sort-Object LastWriteTime
  foreach ($file in $files) {
    # Skip files still being written (modified in the last 30 seconds).
    if (((Get-Date) - $file.LastWriteTime).TotalSeconds -lt 30) { continue }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    try {
      $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/epass-agent/upload" `
        -InFile $file.FullName -ContentType "application/octet-stream" `
        -Headers @{ "x-agent-key" = $AgentKey; "x-upload-kind" = $kind; "x-source-file" = $file.Name } `
        -TimeoutSec 180
      $dest = Join-Path $Root (Join-Path "processed" (Join-Path $kind ("$stamp-" + $file.Name)))
      Move-Item -Path $file.FullName -Destination $dest -Force
      Log "OK    [$kind] $($file.Name) -> $((($resp | ConvertTo-Json -Compress -Depth 3)))"
    } catch {
      $status = $null
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      if ($status -ge 400 -and $status -lt 500 -and $status -ne 429) {
        # Agility read the file and said no (wrong export, no rows) — park it
        # in failed\ so it doesn't retry forever.
        $dest = Join-Path $Root (Join-Path "failed" (Join-Path $kind ("$stamp-" + $file.Name)))
        Move-Item -Path $file.FullName -Destination $dest -Force
        Log "FAIL  [$kind] $($file.Name) HTTP $status $($_.ErrorDetails.Message)"
      } else {
        # Network / server hiccup — leave in the outbox, retry next run.
        Log "RETRY [$kind] $($file.Name) $($_.Exception.Message)"
      }
    }
  }
}

# Tidy old processed files
foreach ($kind in $Kinds) {
  $dir = Join-Path $Root (Join-Path "processed" $kind)
  Get-ChildItem -Path $dir -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepProcessedDays) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}
