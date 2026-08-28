# ePASS Agent — automating the W: drive exports

**The security model, in one sentence:** Agility never reaches into the
W: drive, the VPN, or the building — a small script ON the showroom server
pushes files OUT to Agility over ordinary HTTPS, authenticated by a shared
key. Outbound-only, no inbound firewall holes, no drive shares exposed, no
VPN credentials in the cloud. Same trust model as the nightly ExportModel
feed that already runs (SHOP_SNAPSHOT_KEY).

## What's automated (v1 — the dailies)

| Outbox folder                  | ePASS export                              | Feeds |
|--------------------------------|-------------------------------------------|-------|
| `W:\Agility\outbox\inventory`  | ExportModel (Model Maintenance serials)   | Shop availability, hit list, aging inventory |
| `W:\Agility\outbox\quotes`     | Invoice Maintenance — quotes, Open        | Quote Follow-Up board |
| `W:\Agility\outbox\open-orders`| OE-23 Salesperson Activity (open orders)  | Aging/open-orders reporting |

Still manual (they need a human month choice): the monthly Crystal
commission report and the monthly balance check — keep using the ePASS
Upload Center / Commissions pages for those.

## One-time setup

1. **Generate a key** (any long random string, e.g. in PowerShell:
   `-join ((48..57)+(97..122) | Get-Random -Count 48 | % {[char]$_})`).
2. **Render** → Environment → add `EPASS_AGENT_KEY=<that key>` → deploy.
3. **Showroom server**: copy `scripts/epass-agent.ps1` to `W:\Agility\epass-agent.ps1`,
   paste the same key into `$AgentKey` at the top.
4. **Task Scheduler** on the showroom server → Create Task:
   - Trigger: daily, repeat every 10 minutes.
   - Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "W:\Agility\epass-agent.ps1"`
   - Run whether user is logged on or not, with an account that can read W:.
5. Run it once by hand — it creates the outbox/processed/failed folders.

## Daily use (the office)

Export from ePASS and **save straight into the matching outbox folder**.
Within 10 minutes the agent uploads it: accepted files move to
`processed\` (kept 60 days), rejected ones to `failed\` with the reason in
`W:\Agility\agent.log`. A file left sitting in an outbox means a network
retry is pending — the agent picks it up next run.

The ePASS Upload Center page still shows the freshness of every feed, so a
glance there confirms the agent is doing its job (uploads show as
"ePASS Agent (W: drive)" / `via: "epass-agent"` in the audit trail).

## Notes

- The endpoint (`/api/epass-agent/upload`) validates the key with a
  timing-safe compare, enforces a 60MB cap, and runs the exact same parsers
  as the manual upload pages — a malformed file is rejected, never stored.
- Rotating the key = change it in Render and in the script; nothing else.
- If the showroom server is ever rebuilt, steps 3–5 are the whole recovery.

## Mail agent — fully hands-off via a temp Gmail (until NetSuite)

`scripts/epass-mail-agent.ps1` closes the loop so nobody saves files by hand:

    EPASS scheduled bookmark (Notify By: Email Attachment, XLS)
      -> temp Gmail inbox
        -> mail agent saves attachments into W:\Agility\outbox\<kind>
          -> upload agent pushes them to Agility

Setup: create a Wilson-owned throwaway Gmail (used for nothing else), turn on
2-Step Verification, generate an **App Password** (the normal password will
not work over IMAP), paste user + app password into the script config, and
schedule it every 10 minutes a couple of minutes before the upload agent.
First run auto-downloads the small mail libraries it needs into
W:\Agility\lib (one-time, ~2MB from NuGet).

**If Google says App Passwords "is not available for your account"** even
with 2-Step on: (1) turn OFF "Skip password when possible" under Security →
How you sign in — a passkey-first account hides App Passwords; (2) make sure
a phone number (text) is on the account as a 2-step method, not just a
passkey; (3) brand-new accounts are sometimes held back for a day or two —
sign in on a desktop, use it normally, retry. If none of that brings the
page back, the script works with any IMAP mailbox — a free **Zoho Mail**
account is the drop-in fallback (set `$ImapHost = "imap.zoho.com"` in the
config and use a Zoho app password).

Attachments route to an outbox by filename (ExportModel -> inventory,
ExportInvoice / Invoice Maintenance / Quote -> quotes, OE-23 / Salesperson
Activity -> open-orders); anything unrecognized lands in `outbox\unsorted`
with a log line so a human can file it. Processed messages are marked read.

**Decommission with NetSuite**: delete the Gmail account, remove both
scheduled tasks, and drop EPASS_AGENT_KEY from Render. Nothing else depends
on any of it.
