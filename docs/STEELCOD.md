# Steel Cod Integration (Spec Packages)

Connects the internal tools to the Steel Cod API v1 (spec-sheet packages for
appliance sales). Built against "Steel Cod API v1 – Doc Version 11" (API 1.2.84).

## What it does

`/spec-packages.html` (in the Sales Tools menu, permission-managed like every
other page) lets staff:

- **Create** a spec package from a sales order: order #, customer, model
  numbers → returns view/download links (full + slim), the customer Q&A page,
  and found / not-found / excluded model lists.
- **Search** packages by order #, title, or customer info, or list their own.
- **Delete** (executives only — deletion permanently purges the package and its
  PII from Steel Cod; deletions are recorded in the access audit log).

## Configuration

| Variable | Purpose |
| --- | --- |
| `STEELCOD_API_KEY` | Partner/company API key. Request from Steel Cod (tom@steelcod.com / help@steelcod.com); keys are issue-on-request only. |
| `STEELCOD_API_BASE` | Optional; defaults to `https://api.steelcod.com/v1`. |

Until the key is set, the page loads but all actions return
"Steel Cod is not configured yet."

## Identity requirements (important)

Steel Cod requires every API call to carry the email of the **authenticated
user acting on the request**, and their EULA forbids shared/service accounts.
Consequences:

1. Spec package actions require an **individual login** — the legacy shared
   `wilson` login gets a clear "sign in with your individual account" message.
   (The per-user auth system is what makes this integration compliant.)
2. Each user's tool email must match an **active Steel Cod user** at Wilson,
   or Steel Cod rejects the call (error 1009). Executives can compare rosters
   via `GET /api/steelcod-users`, which lists Wilson's registered Steel Cod
   users.

## Code map

- `lib/steelcod.js` — API client: createSpecPackage, searchSpecPackages,
  retrieveSpecPackage, deleteSpecPackage, retrieveUsers; maps Steel Cod error
  codes to friendly messages; derives the public/private URL set
  (`/Open`, `/Download`, `/SlimOpen`, `/SlimDownload`, `/Json`, `/Ask`,
  `/Edit`, `/PremEdit`) from the base URL.
- `server.js` — routes under `/api/spec-packages*` gated by
  `requirePagePermission("/spec-packages.html")`; delete + user-roster are
  executive-only.
- `spec-packages.html` — the UI.
