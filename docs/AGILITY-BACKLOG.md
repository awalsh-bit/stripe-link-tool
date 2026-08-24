# Agility Backlog — deferred items

## Delivery runs v1 — BUILT 2026-08-24 (DT replacement pilot)

Shipped: dispatch.html (build/order runs, start day), driver.html (mobile run
sheet: arrived/photos/signature/complete/exception/skip + "taking a break"
pause), track.html (public tokenized tracking on the service host),
lib/deliveries-postgres.js, lib/samsara.js, lib/podium-send.js.
Flow: start run → geofence per stop (Samsara Addresses) + morning texts +
first "you're next" → geofence entry/exit webhooks auto-advance statuses and
fire next-stop texts (once per stop, suppressed while paused, released on
resume) → completion text on done → finish day deletes geofences.

Env needed on Render before pilot:
  SAMSARA_API_TOKEN   (self-serve: Samsara dashboard → Settings → API Tokens)
  SAMSARA_WEBHOOK_KEY (any random string; webhook URL is
                       https://dashboards.wilsonappliance.com/api/samsara/webhook/<key>
                       — configure in Samsara Webhooks for GeofenceEntry/Exit)
  PODIUM_SEND_HOOK    (Zapier catch-hook → Podium Send Message action; until
                       the Podium developer app is approved, then
                       PODIUM_API_TOKEN + PODIUM_LOCATION_UID replace it)
  GOOGLE_MAPS_API_KEY (optional: real geocoding + traffic ETAs; without it,
                       straight-line ETA estimates and no geofences unless
                       lat/lng entered manually)
Also: grant dispatchers /dispatch.html and drivers /driver.html; drivers need
Agility accounts with their run assigned by email.

Deferred from v1: night-before confirmation texts (dispatcher job-title
workflow), ePASS-order import into stops (manual entry v1), route
auto-optimization (manual ordering v1), staged review invite on completion
(see review section below), offline queueing on the driver page (photos
retry on tap; true offline sync later).


_Notes for future builds; commit lives in docs/ so it travels with the repo._

## Review invites — stage by job completion (deferred, do not build yet)

Current state (working, do not disturb): DispatchTrack "finish job" → Podium
review invite. High capture rate. This fires on EVERY DT finish job.

Problem to solve later: service repairs run through DispatchTrack too, so
clients get an invite after a **diagnosis** visit or a **recall/warranty**
visit — before the appliance is actually fixed. Clients text back
"I'll review you when you fix it." Most recognize it's automated, but the
ask is mistimed.

Refinement when we take this on: stage the review invite so it fires only on
**true job completion** (final repair complete / final delivery), never on
diagnosis or recall visits. Likely mechanics: classify the DT job type or the
ePASS service-order state (e.g., parts on order / return visit scheduled =
not complete) and gate the invite — either by filtering what reaches the
DT→Podium trigger or by moving the invite trigger to Agility once the Podium
developer app is live (Create Review Invite endpoint exists in API v4;
include the review-invite scope when configuring the app).

Related, lower priority: customer pickups (CPU) and any non-DT completions
get no invite at all today. CPU is a minor share of ticket count — gap-fill
later, same endpoint.

## Podium developer app (application submitted 2026-08-23)

When approved, configure app with scopes: read_messages, write_messages,
read_users, read_locations (+ review-invite scope for the item above).
Redirect URL: https://dashboards.wilsonappliance.com/api/podium/oauth/callback
Then build lib/podium.js (OAuth + token refresh + note/assign/send) and wire:
lead claimed → internal note (sender = claimer) + assign conversation
(by claimer email) + reopen. Zapier custom actions
(add_internal_note_to_conversation, list_users_with_uids) remain as
prototypes/fallback.
