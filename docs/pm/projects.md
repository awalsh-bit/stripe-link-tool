# Project Manager — Dashboard, Route Planner, job-site page

Added 2026-10-29 (Andrew). Menu group **Project Management**: `pm-dashboard.html`, `pm-route.html` (grant both). Public page `project.html` on service.wilsonappliance.com.

## What a project is

A **job site** — every open sales ticket shipping to the same address, across sales orders and their splits (Andrew 10/29: "address based, not sales order based — all tickets that go against the same ship-to address") — that clears the **Project Parameters** (top of the dashboard). The site key is the ticket's ship-to address (sold-to when there is no ship-to), normalized so "123 Oak Street, Ste 4" and "123 OAK ST. SUITE 4" are one site (case, punctuation, common suffixes and directions, ZIP5); a ticket with no address at all is keyed by its customer number so it still shows up. The drawer lists every sales order at the site with its own date and total; the card's ticket number is the first order there, with "+N more".

- **Minimum order total** ($, summed across every ticket at the site) and **minimum major appliances** (model lines whose NetSuite class is an appliance bucket — ranges, refrigeration, dishwashers, laundry, ventilation, outdoor… — counted by quantity; accessories, panels, install codes and parts don't count).
- **Qualify when** either threshold is met (default) or both.
- **Always a project** / **Never a project** — customer-name fragments, one per line, case-insensitive (`Smith Custom` matches "SMITH CUSTOM HOMES LLC"). A customer never qualifies on its own (Andrew 10/29): the lists are the only customer lever.
- Route start (the showroom, geocoded on save) and the PM phone shown on the job-site page.

The book is rebuilt **after every ePASS open-orders pull** (and on **Re-scan the open book now**): qualifying open sales orders become cards (status *New*); every tracked project refreshes its facts from the feed — customer, address (SoldTo address / city / state / ZIP), phone, salesperson, **needed-by = the earliest ePASS ScheduleDate on a parent ticket at the site** (splits only fill in when no parent is dated; the PM never edits the date — change it in ePASS), total, models, appliance count. A site whose tickets have all left the open book is marked *Delivered* automatically; a delivered project that reappears (reopened ticket) goes back to *New*. Raising a threshold never removes an existing card.

## Dashboard

Tiles: Overdue / Next 7 days / 8–21 days / Later / No date yet / Delivered — click to filter. Filters: status, PM (everyone / mine / unassigned), search, show closed. Cards: customer, site address, needed-by with days, total, appliances, ticket, salesperson, PM, "site replied" flag, last note.

Drawer: status steps (New → Contacted → Site visit scheduled → Site visited → Site ready → Delivered → Closed; each change is logged), models (accessories marked), job-site contact (name / mobile / email), job-site address override (re-geocoded on save; the ticket address stays as the fallback), site visit date-time, **Copy site link**, **Text site link** (through Podium, user-initiated, to the site contact's mobile — the standard wording names the PM and the address; replies land in Podium), readiness answers from the site, PM assignment (anyone granted the dashboard), notes (note / call / site visit / scheduling) and the timeline (notes, status changes, texts, site submissions).

## Job-site page (public)

`https://service.wilsonappliance.com/project.html?t=<token>` — one token per project, generated when the card is created. Shows the customer, site address, planned date, the PM's name and phone, the appliances on the order (no prices, no install codes), a **readiness checklist** (truck access, cabinets/openings, electrical, gas, water/drain, countertops, someone to receive), an optional requested delivery date, notes, and the site contact's name and mobile. Submitting writes the answers to the project, adds a *site* note, and pushes a green dashboard flag to the assigned PM. Rate-limited; closed / delivered projects stop accepting updates. The site manager can update it as many times as they like.

## Route Planner

Lists open projects (filters: open / needed within 14 days / visit scheduled / mine) with a pin on a Mapbox map when the browser token is set. Tick up to 11 stops, **Optimize today's route**: the server calls Mapbox Optimization (driving, round trip from the route start) and returns the stop order, each leg's minutes and miles, the running clock, the return leg and the total; the route line is drawn on the map. **Open in Google Maps** hands the whole ordered route (origin → stops → origin) to the phone; **Apple Maps** gets the first stop (Apple Maps can't take multiple stops from a link). Projects without a map pin are listed as not routed. Without `MAPBOX_TOKEN` the planner still works as a pick list (no ordering or drive times).

## Render environment

- `MAPBOX_TOKEN` — server token for geocoding (Search Box / Geocoding v6) and the Optimization API. A token with the default public scopes is enough; leave its URL restriction empty (it's called from Render, not a browser).
- `MAPBOX_PUBLIC_TOKEN` — a `pk.` token for the browser map, URL-restricted on mapbox.com to `agility.wilsonappliance.com`.
- Until `MAPBOX_TOKEN` is set, addresses are geocoded with the existing `GOOGLE_MAPS_API_KEY` when present, so pins can appear before Mapbox is finished.

## Plumbing

`lib/projects-postgres.js` (settings, `syncProjectsFromFeed`, CRUD, notes, readiness; tables `project_settings`, `projects`, `project_notes`), `lib/mapbox.js` (geocode, optimized round trip). Routes: `/api/pm/config`, `/api/pm/settings`, `/api/pm/rescan`, `/api/pm/projects[/:id][/notes|/text-link]`, `/api/pm/route/optimize`; public `/api/project/view?t=`, `/api/project/readiness`. Feed hook: `syncProjectsNow()` at the end of the sales-bundle post-processing chain (`counts.projects`). Audit: `project_settings_saved`, `projects_rescanned`, `project_updated`, `project_note_added`, `project_site_link_texted`, `project_route_built`.
