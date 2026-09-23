# 22 · The tech field tool, second pass (Sept 23, 2026)

Andrew, after the first cut of `service-field.html` went live: *"please re-inspect
Cayden's field tool prototype from the most recent file, there is a lot of
functionality that didn't survive … catch things that did not make it to the
live tool functionality wise."* Then eight specific asks. This doc is the audit
(what Cayden's tool and docs 07 §5.1a/b, §5.6, §8, §8a–c, §1.6–1.7 describe
against what was live), what is built now, and what is still open.

The re-read covered the docs and Phase 0 code (`07_Developer_Spec`,
`14–17_Team_Feedback_0919*`, `phase0/wilson_service/labor.py`, `tracker.py`,
`importers/fullexport.py`) and, once the folder was linked again, the
prototype page itself (`prototypes/field_tool.html`, 9/19 late build). The
second half of §1 is what only the page showed.

## 0. Standing rule — roles by job code, never a person

Andrew, 9/23: *"make sure the code is flexible based on a quick swap to a job
code instead of a specific person — I'm building this to scale beyond
individuals, please make that a hard code rule."*

So: **nothing in the service journey names a person.** Every notification,
gate and line of copy that used to say Noell, Kezia or Mark names a **role**,
and a role is a list of directory **job title codes** (User Admin → Job
titles & codes — the permanent `E31`-style key, not the label).
`lib/service-roles.js` resolves a role to the people who hold those codes
(archived rows excluded), plus any explicit emails as a stop-gap. Swapping
the person is a directory edit; a second estimator is a second person on
the same code; nothing in code changes.

| Role | Used for |
|---|---|
| `service_manager` | model flags from the techs → publishes bulletins; can review flags |
| `service_estimator` | the warranty SO3 flag + email (was `notify.warranty_so3.emails`) |
| `parts_buyer` | Parts Verify / ETAs copy ("the parts buyer") |
| `warranty_admin` | warranty claims copy |
| `dispatcher` | reserved |
| `field_tech` | the field tool first on the dashboard (a directory code on the tech roster counts too) |

Settings `roles.<role>.job_codes` / `roles.<role>.emails`, edited on
**Service Journey → Settings → Roles by job code** (executive), or
`POST /api/service-journey/roles/:role {jobCodes, emails}`. The legacy
person-keyed lists (`notify.warranty_so3.emails`, `notify.model_flags.emails`)
are still read as the role's explicit emails so nothing goes quiet on
deploy — empty them once the codes are set. A role with nobody in it logs a
warning; it never falls back to a hard-coded address.

The rule for anything built from here: **if a feature needs "the person
who does X", add a role to `ROLES` and resolve it — do not write an email,
a name or a directory code into code or into a settings default.**

## 1. The audit — what had not survived

| In Cayden's tool / docs | First cut (9/22) | Now |
|---|---|---|
| Labor lines: zone fee auto by distance from the shop, component change-out from the rate book with its price, time pick that prices at $130/h and sizes the return trip, freight, every amount editable (§5.1a, §8a) | A free-text "labor you expect" box | **Built** — §2 |
| Customer history per stop, "read the last visit", every past call opens to complaint / work performed / parts / labor (§1.6e, §8c) | Nothing on the stop | **Built** on the ePASS catalogue — §3 |
| Model Insight in three tiers with the parts that actually went in (§1.7) | Nothing | **Built** — §3 |
| Model flags → service manager → published bulletin every tech sees (§1.7) | Nothing | **Built** — §3 |
| Serial-tag photo required on a new diagnostic when `unit.serial_tag_photo_id` is null; install screens show the existing one (§8) | No photos at all | **Built** — §4 |
| "Any relevant photos?" on diagnostic and install (§8a) | None | **Built** — §4 |
| Delivered-dollars strip on the route header: today · week · pace vs target; tap for the per-stop split (§5.6) | None | **Built** — §5 |
| Findings go to the unit's history at once, marked *this visit · you*; reopen (§8c) | Findings saved, but a finished stop was locked | **Built**: add a note any time, change the outcome — §6 |
| Outcome as a `<select>` pre-set to the usual answer (§8a) | Six buttons | **Built** |
| Typeahead on the component / part description from what the model family has needed (§8a) | None | **Partly**: part descriptions offer the family's parts; the labor box searches ePASS's labor list |
| Warranty in the field: no zone fee, no freight, tax exempt, labor at our rate only on True / Scotsman / Zephyr / BlueStar (§5.1b) | Not modelled | **Built** into the auto lines and the note on the form |
| Read-only look-ahead at the tech's own week (§8b) | Day arrows already existed | Day arrows kept; future days are labelled read-only, past days allow notes |
| Field tool on the tech's dashboard | Menu item only | **Built**: a dashboard module, first for techs — §7 |
| Field quote + customer signature at the door (§5.4) | — | Not built — Cayden suspended it (`quoting.field_quote_enabled`) until a part price can be verified at the door |
| PWA: offline banner, autosave to local storage, photos to IndexedDB before "saved" (§8) | — | Not built; the page shrinks photos client-side and uploads at once |
| Error-code field behind the *Error code* symptom chip (§8) | — | **Built** — the chip asks for the code and drops "Error code E24" into the findings |
| **From the prototype page itself** (`field_tool.html`, 9/19 late): | | |
| *Taking it to the shop with me* as its own outcome → SI (Cayden 9/19 pm: the unit is on the van, the office owes a delivery back) | — | **Built** — outcome `shop` → SI1, note required |
| The shop-return stop: "the unit is at the shop — it goes back on this trip", its own outcome list | Treated as a diagnostic | **Built** — `shop_return` kind on SI* stops, banner on the return trip |
| *Parts on this truck for this job* on install stops, with the bin | — | **Built** from the ticket's ePASS part lines + `bin_location` |
| Symptom chips per product family (*What you found*), cause chips, all dropping into the note | — | **Built** (`SYMPTOMS` / `CAUSES`, family from the ePASS product code) |
| Labor modifiers — difficult access ½ h, stacked/built-in 0.35 h, additional tech ½ h, additional component ½ h | — | **Built** as chips on the labor builder, priced at the hourly rate |
| *Could not access* on an install | — | **Built** |
| Text / Call the customer, their contact preference on the card | Call only | **Built** (`sms:` / `tel:`, preference chip) |
| Labor **total** override with reset (`labor_override`) | — | Not as a total: every line's amount is editable instead, which is what Andrew asked for |
| *My notifications* — questions from the office to the tech, *Answer* | — | Not built; there is no office→tech messaging in Agility yet (open) |
| *Ship parts to customer* (SO4H direct ship) | — | Office-side; not in the field tool |
| Half-day / full-day quick picks (`LAB-HALF` / `LAB-FULL`) | — | Covered by the time pick (half day / full day) |

## 2. Labor lines the tech builds

Andrew: *"by default, there will be a zone fee on COD repairs which is
determined by proximity to our showroom. The tech will then add on a
component change out for the part they need to install … that repair will
have the drain pump part, a zone 1 fee, a drain pump replacement fee and
freight. the tech also needs to choose the amount of time the repair will
take so we can get the capacity side right on the return trip … we still need
to let the tech change the labor lines before hitting the complete call /
send to office to be quoted button."*

On **Needs parts** (diagnostic) and **Additional parts needed** (install) the
form carries a labor builder:

* **Zone fee, automatic.** Straight-line miles from the shop (the job's
  geocode; else its zone's distance; else the ZIP's override — downtown
  78701 is ZN3) → ZN1 ≤ 7 mi · ZN2 ≤ 26 · ZN3 ≤ 47 · ZN4 beyond, at the 2026
  ePASS rates ($120 / $130 / $140 / $150), brand variant (`ZN1-GE`) when the
  labor table has one. `ZNADD` $85 per extra unit on the ticket. The tech can
  edit the amount but not remove the line.
* **Component change-out, from ePASS.** The box searches the LaborRate table
  (the flat-rate book as imported into ePASS — `CE400`, `WA210-GE` …); the
  result shows the ePASS price, brand variant first. Picking one adds the line
  with *ePASS book $138.50* beside it. Nothing in the list → *add "…" as your
  own line*.
* **Time pick** — 30 min · 1 · 1.5 · 2 · 3 hr · half day · full day. Prices
  every component line he has not hand-edited at hours × `labor.hourly_rate`
  ($130) and writes `est_minutes` (and dispatch units, rounded up to hours)
  on the job, so the board and the engine size the return trip from it.
  Required on a parts outcome.
* **FREIGHT $20** shows, read-only for the tech: Cayden 9/19 — *"shipping
  should just default to $20 unless kezia changes it in the parts verify
  process. dont have the tech mess with it. no freight on warranty stuff."*
  The parts buyer edits it on Parts Verify.
* **Warranty.** No zone fee, no freight. On a COD-paying brand (True,
  Scotsman, Zephyr, BlueStar) the component line prices at our rate; on
  every other brand the form says the manufacturer pays a flat rate on the
  claim and the amount is the warranty admin's — the tech still adds the
  component line so the office knows what to claim.
* Every amount is an input. An edited line keeps its number when the time
  pick changes (`edited: true`); the office sees *tech edited*.

**Parts Verify** (Service Office Queues) now shows the labor lines under the
part lines — code, description, amount, the book price and the time — and
the parts buyer can change them (freight especially) before *Verified → SO2.1*. They
ride on the finding (`verified_labor`) for the estimator. Settings:
`labor.hourly_rate`, `labor.zone_bands_miles`, `labor.zone_fees`,
`labor.diag_fees`, `labor.zone_band_by_zip`, `parts.shipping_default`,
`warranty.cod_brands`.

## 3. Customer history, Model Insight, bulletins

**The ePASS catalogue.** A fourth agent bundle, `epass-service-catalogue`,
carries every finished SV/WTY ticket — header, complaint, work performed,
unit, payer, totals — plus its part lines (price, cost) and labor lines
(with the LaborRate description), and the whole LaborRate table. It runs by
itself on the 6:00 pull (tickets finished in the last three weeks) and once,
by hand, as the backfill: `epass-odbc-pull.ps1 -CatalogueBackfill` writes one
bundle per year since 2005 (a few MB each) and the agent pushes them. Agility
upserts by invoice number, so any slice can be pulled again. Tables
`epass_service_catalogue` (+ `_parts`, `_labor`), `epass_labor_rates`;
status on `/api/epass/open-orders/status` → `catalogue`.

**On the stop — "Before you knock".** Past calls for the same ePASS account,
phone, address or serial (same unit first), plus our own closed tickets the
feed has not finished yet; each opens to *Said / Done / Parts / Labor*.
Model Insight in three tiers — the exact model, its family (Bosch handle
rule and the letters-plus-first-digits stem from doc 07 §1.7), the brand's
product type — with the count, the parts that actually went in, the labor
billed, and the recent calls. The part-description box offers the family's
parts as you type.

**"Something every tech should know about this model?"** — a flag with a
reason (required) goes to `sj_model_flags` as *pending* and raises a
notification to everyone holding the `service_manager` role. Service
Office Queues has a **Model flags** section where that role (or an
executive) publishes it as a bulletin (their words or the tech's),
dismisses or retires it. A published
bulletin sits at the top of *Before you knock* for every call on that model
family.

The board's history drawer reads the catalogue too (`getServiceHistory`).
The office queues can call `/api/service-field/history` and `/insight` for
the same reads.

## 4. Photos and the serial tag

Andrew: *"the field tool should require a serial tag photo on new diagnostics
when we have not previously serviced the appliance / don't already have the
photo on file. when returning to install parts the serial tag photo is not
required as we already have it."*

`sj_field_photos` (Postgres, like the request-form photos; the page shrinks
to 1600 px JPEG first). A diagnostic cannot be finished (any outcome but
*Could not access*) until the serial tag is on file, where "on file" is: a
serial-tag photo for that serial or ticket, the serial in the ePASS
catalogue, or a closed Agility ticket on it. Installs never ask. The Photos
tab says which of those applies, and shows this ticket's and this serial's
photos. "Any relevant photos?" on every stop. Switch `field.serial_tag_required`.

## 5. Delivered dollars as the day goes

Andrew: *"add the progress tracking functionality that shows techs as they go
how they are trending for the day in terms of delivered revenue."* Doc 07
§5.6: `delivered = labor_list + (parts_list − parts_cost)`, warranty counts
labor only.

The strip at the top of the day: **today · this week (of quota) · pace / wk**
with a bar; tap it for each stop's number and what it is based on. Per stop,
provisional, written on the finding when it is submitted: fixed on site /
declined / not worth repairing = the diagnostic band (`DZ1` $157 …) plus any
labor lines, plus parts profit at list (cost from the line if known, else
list × (1 − `pay.parts_margin_default` 0.35)); install complete = the
approved estimate's labor + parts × margin, else the tech's own quote lines;
a parts outcome shows as *quoted* (pipeline), not delivered. The week is the
finished-ticket feed (the same math as the Service Commissions board:
`svTicketsBetween`) plus today's provisional stops, minus any the feed
already finished; pace = week-to-date ÷ working days elapsed × working days
in the week (the tech's `work_days`). The target is the tech's weekly quota
from Service Commissions, else his 4-week average. Nothing about other techs
is shown. `dayDollars()`.

## 6. Going back into a finished stop

Andrew: *"can't go back in to a call if already complete. techs need to be
able to go backwards and go add additional notes or make changes to calls
they may have completed earlier in the day."*

A finished stop stays on the day with its outcome, minutes on site and
dollars. **Add a note** (any day, any time) appends a `note` entry and a
history line, no status change. **Change the outcome** reopens the form
pre-filled from the last finding; submitting it records a new finding that
`amends` the old one and moves the status again through `setJobStatus`
(reason `tech_update`, packet queued). A ticket already closed in ePASS from
an earlier day takes notes only.

## 7. Where a tech finds it

A **Tech Field Tool** dashboard module — delivered today, the week and pace,
the next stop, a button into the tool on that stop. It exists only for logins
that can open the tool; for a login the directory maps to a tech code it is
placed first whatever the saved layout. `GET /api/service-field/summary`.

## 8. Endpoints added

`GET /api/service-field/:sv/context` · `GET /:sv/labor` · `POST /:sv/outcome`
(now with `labor`, `minutes`, `photos`, `serialTagPhotoId`, `amend`) ·
`POST /:sv/note` · `POST /photo` (multipart) · `GET /photo/:id` ·
`GET /labor-rates?q=&brand=` · `GET /call/:code` · `GET /history` ·
`GET /insight` · `POST /:sv/flag-model` · `GET /model-flags` ·
`POST /model-flags/:id/review` · `GET /summary`. Office:
`POST /api/service-office/verify/:sv` takes `labor`. Agent kind
`epass-service-catalogue`.

## 9. Andrew's side

1. Copy the updated `scripts\epass-odbc-pull.ps1` and `epass-agent.ps1` to
   `C:\Agility` on the ePASS server.
2. Once, off-hours, from that folder:
   `powershell -File C:\Agility\epass-odbc-pull.ps1 -Root C:\Agility -CatalogueBackfill`
   (~20 bundles; the agent pushes them; watch `agent.log` for
   `[epass-service-catalogue]` lines and `/api/epass/open-orders/status` →
   `catalogue.tickets`). The daily 6:00 top-up needs nothing.
3. Service Journey → Settings → **Roles by job code**: pick the job title
   code(s) for `service_manager`, `service_estimator`, `parts_buyer`
   (and `field_tech` if any tech is not on the roster by SP code). Then
   empty the legacy `notify.warranty_so3.emails` list.
4. Weekly quotas on the Service Commissions page give the techs a target;
   without one the strip uses their 4-week average.
5. The LaborRate price column is picked by name (`Rate`, `Price`,
   `SellingPrice`, …). If the component list shows *no price* after the
   first catalogue bundle, the column has another name — the raw row is kept
   on `epass_labor_rates.raw`, so it is a one-line fix.
