# =============================================================================
# Agility ePASS MAIL Agent — the other half of the automation chain:
#
#   EPASS Reports (scheduled bookmark, Notify By: Email Attachment)
#     -> temp Gmail inbox (IMAP, app password)
#       -> this script saves attachments into W:\Agility\outbox\<kind>\
#         -> epass-agent.ps1 uploads them to Agility
#
# TEMPORARY by design (NetSuite ~2 months out): the Gmail account should be a
# Wilson-owned throwaway used for nothing else, and deleted after cutover.
#
# GMAIL SETUP (one time):
#   1. Create the account (e.g. wilsonagilityreports@gmail.com).
#   2. Turn ON 2-Step Verification (myaccount.google.com/security).
#      IMPORTANT: use a PHONE NUMBER (text) or Authenticator app as the
#      2-step method — a passkey alone hides App Passwords. Also turn OFF
#      "Skip password when possible" under Security > How you sign in.
#   3. Create an App Password (myaccount.google.com/apppasswords) — 16 chars,
#      paste it below. Normal password will NOT work for IMAP. If Google says
#      the setting "is not available for your account", see the CONFIG notes
#      below (fix the sign-in settings, or fall back to Zoho Mail).
#   4. Point every EPASS scheduled report's email distribution at the address.
#
# SCHEDULE: same Task Scheduler pattern as epass-agent.ps1, every 10 minutes,
# a couple of minutes BEFORE the upload agent (e.g. mail agent at :00/:10/…,
# upload agent at :02/:12/…). Requires internet + W: access; PowerShell 5+.
#
# First run downloads MailKit/MimeKit (NuGet, ~2MB) into W:\Agility\lib — the
# libraries PowerShell needs to speak IMAP. No other install required.
# =============================================================================

# ---- CONFIG ----------------------------------------------------------------
# Works with any IMAP mailbox. Gmail is the default; if Google won't offer
# App Passwords on the account (it hides them behind passkey-first sign-in,
# and sometimes on brand-new accounts), a free Zoho Mail box is the drop-in
# fallback: $ImapHost = "imap.zoho.com", same port, Zoho app password.
$ImapHost    = "imap.gmail.com"
$ImapPort    = 993
$MailUser    = "wilsonagilityreports@gmail.com"
$MailAppPw   = "PASTE-16-CHAR-APP-PASSWORD"       # App Password, NOT the login password
$Root        = "W:\Agility"
$FromFilter  = ""    # optional: only take mail from this sender (the EPASS SMTP from-address); "" = any
# Filename -> outbox kind. First match wins; unmatched attachments land in
# outbox\unsorted for a human to file (and the log says so).
$RouteMap = [ordered]@{
  "ExportModel"                  = "inventory"
  "ExportInvoice"                = "quotes"
  "Invoice.*Maint|Quote"         = "quotes"
  "OE-?23|Salesperson.*Activity" = "open-orders"
}
# ----------------------------------------------------------------------------

$LogFile = Join-Path $Root "agent.log"
function Log([string]$msg) {
  Add-Content -Path $LogFile -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)
}

# ---- MailKit bootstrap (one time) ------------------------------------------
$LibDir = Join-Path $Root "lib"
if (-not (Test-Path $LibDir)) { New-Item -ItemType Directory -Path $LibDir -Force | Out-Null }
$Packages = @(
  @{ Name = "MailKit";                  Version = "4.8.0";  Dll = "lib/netstandard2.0/MailKit.dll" },
  @{ Name = "MimeKit";                  Version = "4.8.0";  Dll = "lib/netstandard2.0/MimeKit.dll" },
  @{ Name = "BouncyCastle.Cryptography"; Version = "2.4.0"; Dll = "lib/netstandard2.0/BouncyCastle.Cryptography.dll" },
  @{ Name = "System.Buffers";           Version = "4.5.1";  Dll = "lib/netstandard2.0/System.Buffers.dll" }
)
foreach ($pkg in $Packages) {
  $dllPath = Join-Path $LibDir ("{0}.dll" -f $pkg.Name)
  if (-not (Test-Path $dllPath)) {
    $nupkg = Join-Path $env:TEMP ("{0}.zip" -f $pkg.Name)
    $url = "https://www.nuget.org/api/v2/package/{0}/{1}" -f $pkg.Name, $pkg.Version
    Log "SETUP downloading $($pkg.Name) $($pkg.Version)"
    Invoke-WebRequest -Uri $url -OutFile $nupkg -UseBasicParsing
    $extract = Join-Path $env:TEMP ("nuget-" + $pkg.Name)
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $nupkg -DestinationPath $extract -Force
    Copy-Item (Join-Path $extract $pkg.Dll) $dllPath -Force
    Remove-Item $nupkg -Force; Remove-Item $extract -Recurse -Force
  }
}
Add-Type -Path (Join-Path $LibDir "BouncyCastle.Cryptography.dll")
Add-Type -Path (Join-Path $LibDir "System.Buffers.dll") -ErrorAction SilentlyContinue
Add-Type -Path (Join-Path $LibDir "MimeKit.dll")
Add-Type -Path (Join-Path $LibDir "MailKit.dll")

# Outbox skeleton (matches epass-agent.ps1, plus unsorted)
foreach ($kind in @("inventory", "quotes", "open-orders", "unsorted")) {
  $dir = Join-Path $Root (Join-Path "outbox" $kind)
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

function RouteKind([string]$filename) {
  foreach ($pattern in $RouteMap.Keys) {
    if ($filename -match $pattern) { return $RouteMap[$pattern] }
  }
  return "unsorted"
}

# ---- Fetch -----------------------------------------------------------------
$client = New-Object MailKit.Net.Imap.ImapClient
try {
  $client.Connect($ImapHost, $ImapPort, $true)
  $client.Authenticate($MailUser, $MailAppPw)
  $inbox = $client.Inbox
  [void]$inbox.Open([MailKit.FolderAccess]::ReadWrite)

  $query = [MailKit.Search.SearchQuery]::NotSeen
  if ($FromFilter) { $query = [MailKit.Search.SearchQuery]::And($query, [MailKit.Search.SearchQuery]::FromContains($FromFilter)) }
  $uids = $inbox.Search($query)

  foreach ($uid in $uids) {
    $message = $inbox.GetMessage($uid)
    $savedAny = $false
    foreach ($attachment in $message.Attachments) {
      $name = $attachment.ContentDisposition.FileName
      if (-not $name) { $name = $attachment.ContentType.Name }
      if (-not $name -or $name -notmatch "\.(xlsx?|XLSX?)$") { continue }
      $kind = RouteKind $name
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $dest = Join-Path $Root (Join-Path "outbox" (Join-Path $kind ("$stamp-" + ($name -replace '[\\/:*?"<>|]', "_"))))
      $stream = [System.IO.File]::Create($dest)
      try { $attachment.Content.DecodeTo($stream) } finally { $stream.Dispose() }
      $savedAny = $true
      Log "MAIL  saved '$name' -> outbox\$kind$(if ($kind -eq 'unsorted') { '  (NO ROUTE MATCH - file it by hand)' })"
    }
    # Mark handled either way so a report with no usable attachment doesn't
    # get re-scanned forever; the log records what happened.
    [void]$inbox.AddFlags($uid, [MailKit.MessageFlags]::Seen, $true)
    if (-not $savedAny) { Log "MAIL  no spreadsheet attachment in '$($message.Subject)' — marked read, skipped" }
  }
  $client.Disconnect($true)
} catch {
  Log "MAIL  ERROR $($_.Exception.Message)"
  try { $client.Disconnect($true) } catch {}
}
