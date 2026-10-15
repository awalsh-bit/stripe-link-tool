# 23 — Field tool pass (Andrew's 9/29 test notes), 10/15/2026

Source: "field tool and overall functionality 09.29.txt". This pass covers the
field tool itself; the dispatch-board edit button, photo browsing from the
office, the SV-number overwrite and the customer-tracker linkage are the next
pass (see §6).

## 1. Money rules (lib/service-field-postgres.js → normalizeLabor)

The server decides what labor a finding may carry, whatever the page sent.

| Ticket | Diagnostic-only outcome (fixed on site / declined / not worth repairing) | Quoted repair (parts / more parts) |
|---|---|---|
| COD | `DIAG` = settings `fee.diagnostic` (169.95). Nothing else — never a zone fee beside it. | `ZNn` (+`ZNADD`) + `FREIGHT` (office sets) + the component / manual lines. No diag. |
| Warranty, flat-rate brand | one locked `WTYFLAT` line at the brand's claim rate | the same single `WTYFLAT` line. Extra labor lines are dropped. Tech must still give part number(s) and the repair time. |
| Warranty, COD-paying brand (`warranty.cod_brands`) | component / manual lines at our rate | component / manual lines only (no zone, no freight, no diag) |

Settings (Service Journey settings table): `fee.diagnostic` 169.95;
`warranty.flat_rate_default` 113.68; `warranty.flat_rates` = `{ BRANDCODE: amount }`
(Andrew: per brand from day one — fill this in as the manufacturers' rates come in;
unknown brands use the default). `labor.diag_fees` (DZ1–DZ4) is no longer read.

Ready-to-bill and the delivered-dollars strip use the same function, so a
"fixed on site" COD ticket bills 169.95 flat and a flat-rate warranty ticket
shows the claim amount. Parts Verify's labor list is normalized the same way
(the buyer still prices parts; labor on a flat-rate warranty is the one line).

## 2. "Look the parts up later"

Checkbox on the parts quote. Server: outcome `parts` with `partsLater:true`
→ ticket to SO2, `sj_jobs.parts_research_pending_at/_tech/_note` set,
finding row `parts_later = true`, My Notifications item to the tech (tech
code → directory email). `GET /api/service-field/route` returns
`research: { items, blocking }`; a lookup from an EARLIER day is blocking:
`markEnroute` / `markArrived` refuse for that tech (setting
`field.block_on_parts_research`, default true) and the page greys the
buttons. Resolving: the tech opens "Parts lookups owed" (top of the field
tool, any device) → the stop opens on its own day in change-the-outcome
mode → sends the parts quote (amend). Or the parts buyer enters and verifies
the parts on Service Office Queues (the row is tagged "tech looking up
parts"); `verifyParts` clears the flag. `GET /api/service-field/lookups`
lists them for the office.

## 3. Editable calls

`POST /api/service-field/:sv/details` (`updateCallDetails`): customerName,
phone, phoneAlt, email, address1/2, city, state, zip, accessNotes, brand,
model, serial, problem, contactPref, `warranty` (true/false). Locked once
`billed_at` is set. Status history gets a `call.edited` line with the diff.
A warranty flip sets `is_warranty`, `payment_type` and
`sj_jobs.warranty_override` ('warranty' | 'cod'); all three feed importers
(ODBC, DispatchTrack, ExportInvoice) honour the override so ePASS stops
flipping it back. The open outcome's labor is re-normalized after a flip
unless pricing is locked (status SO2.2 and later, or billed).

Field tool: "Call details — edit" fold on every stop (any day). The board
can call the same endpoint — not wired yet (§6).

## 4. Field tool screen

Everything but the stop's basics is behind a tap: "History & Model Insight"
(closed by default; history shows **This house** — same address / same unit —
first, "Account & phone" behind the toggle), "Photos", "Call details — edit".
Bulletins still show at the top. Outcome form order: serial tag photo →
outcome → parts (or look-up-later) → labor (flat line on a flat-rate
warranty; zone + component on COD) → time → notes, with a "Still needed:"
strip. Diagnostic-only outcomes send no labor list.

## 5. On my way → Podium text

New Message Automations trigger `service_on_my_way` (vars first_name, name,
tech, sv). Off until an executive picks a template and enables it. Fires on
the first "On my way" tap per stop per day; the field tool shows "the
customer got a text".

## 6. Not in this pass (next)

Edit button + warranty toggle on the dispatch board (endpoint exists);
photos browsable from the office / estimates; overwrite the Agility service
order number with ePASS's SV00… once the ODBC feed shows the ticket;
customer-tracker linkage; a smarter default on parts-verify for warranty
pricing (Kezia keeps entering part prices).
