# Wilson AC & Appliance — Service Call Journey

Working folder for moving the appliance/HVAC service repair workflow (request → diagnostic → quote → parts → install → payment) into the Wilson dashboard, with ePASS mirrored until NetSuite. Started 9/10/2026 with Cayden Mayfield.

## Layout

```
docs/
  01_Service_Journey_Blueprint.md   Target-state spec (status engine, automation rules, capacity/route builder,
                                    customer portal, notifications, ePASS sync, data model, rollout, decisions log)
  02_Field_Tool_Conventions.md      UX/technical conventions inherited from the maintenance portal field tool
  03_Rate_Book_Analysis.md          What the 13,646-line flat-rate book actually contains and how to restructure it
  04_ePASS_DispatchTrack_Feed.md    Where the ePASS auto-export lives and how the service side reuses it
  05_Prototype_Notes.md             What each prototype demonstrates and the sample-data assumptions to replace
  06_Data_Findings_Sep2026.md       What the Sep 10 ePASS pulls say: volumes, revenue, cycle time, zones per tech, the west
  07_Developer_Spec.md              THE HANDOFF (v1.17): schema, transition table, import/sync algorithm, capacity & trips, pricing/tax, Podium templates, API, build order, tunables
  08_Replay_Sep2026.md              The real Sep 10 schedule scored against the spec rules; tunable changes that came out of it
  09_Customer_Copy.md               Every customer-facing sentence (texts, emails, tracker, field-tool authorization, intake) for review
  10_Demo_Script.md                 Click-by-click script for the team meeting: two demos, sample customers, recovery steps, likely questions
  11_Shadow_Test_and_Dev_Handoff.md 9/14: the shadow test instance (all techs, real DT feed), the "Copy to service dashboard test module" button contract, retiring the AJH pilot
  12_Agility_Platform_Notes.md      Andrew's platform notes: Agility is Node + Postgres on Render, Phase 0 is already ported, outbound-only from the building
  13_Agility_Alignment.md           What doc 12 changes for docs 07/11, what the Agility port is still missing, the sv_number key question, and the order to close it in
  14–17_Team_Feedback_0919*.md      The 9/19 testing rounds (morning: field tool · pm: the other eight · late: Cayden's answers and the rate card · night: seven asks and the audit)
meeting/
  Wilson_Service_Journey_Team_Deck.pptx   Six slides with speaker notes for the service team meeting
  deck_preview.jpg                        Thumbnail grid of the deck
phase0/                             WORKING CODE — spec §10 Phase 0 (Python 3.10+, stdlib + openpyxl; pyodbc for SQL Server)
  wilson_service/                   schema+DDL, seed, DispatchTrack & ExportInvoice importers, upsert rules, status engine,
                                    sync queue with packets, stale/stuck rules, folder watcher, CLI (python -m wilson_service)
  schema/schema_mssql.sql           generated idempotent DDL for localhost\SQLEXPRESS (schema_sqlite.sql for dev)
  tests/test_phase0.py              89 tests against reference/data — run `python -m unittest -v` inside phase0/
  README.md                         setup, Task Scheduler, what the import owns, engine + sync semantics
prototypes/
  dispatch_board_and_tracker.html   Two-truck route board + customer "where's my repair" tracker — the 9/17 export, every scheduled week
  field_tool.html                   Tech phone view: Diogo's real routed days, findings → history, one estimate flow, warranty rates
  office_queues.html                Parts verify / estimates / ePASS sync queue, customers and twenty years of history, edit any ticket
  proto_*.js                        GENERATED sibling data the board loads (buildproto.py / buildlinks.py / buildhistory.py) — customer data, gitignored
  developer_spec_page.html          Styled version of docs/07
  blueprint_page.html               Styled, shareable version of the blueprint
reference/
  tech_roster.csv                                 Real roster with home base, start/end, skills, auto-route flags
  zone_table.csv                                  ePASS Map Zones → group, booking mode, distance, primary/secondary tech
  zip_zone_tech.csv                               79 zips → zone, techs seen, booking mode
  data/                                           ePASS pulls, gitignored: DispatchTrack CSVs, ExportInvoice 9/10 · 9/15 · 9/17, completed COD 2026, OE-23, the full ODBC export, the sales export
  2025.6.21_Service_Flat_Rates_ePASS_Ready.xlsx   Current rate book as imported into ePASS
  task_catalog_draft.csv                          Raw 743-row extraction from the rate book
  catalog_tasks.csv / catalog_modifiers.csv /     Clean seed data: 478 family tasks + 24 generic, 7 modifiers,
  catalog_rates.csv / catalog_family_tax.csv      rates, per-family labor tax rule
  wilson_maintenance_portal_v0965.zip             Maintenance portal (source of the field-tool pattern)
  wilson_routing_dashboard_context_3_sales_side.md  Sales/install routing prototype notes (out of scope; DT feed info)
```

The prototypes open directly in a browser. Nothing is saved between reloads (route settings and zones save in the browser only). They run on the **real 9/17 ePASS export** — 615 open tickets, real customers, units, techs and statuses — rebuilt by `reference/buildproto.py` from `reference/data/` (gitignored). The field tool and office pages carry their data inline; the board loads the `proto_*.js` siblings, which are gitignored with the rest of the customer data — copy them alongside the page, or open the live artifact.

## Live pages (claude.ai artifacts, private to Cayden until shared)

- Service Order Journey Blueprint — https://claude.ai/artifact/UMYt1GWVPdZdZr57tcPTJr
- Service Journey Developer Spec — https://claude.ai/artifact/2unJQ9vwaZ1oScSyZnuute
- Wilson Dispatch Prototype (board + tracker) — https://claude.ai/artifact/T5cj3HEiVi6F9AEUXsgQBy
- Wilson Service Field Tool — https://claude.ai/artifact/PL4GSvTJVS8oqr2M8niLhm
- Wilson Parts & Sync Queues (office) — https://claude.ai/artifact/AfoP4RNWDjGuPqUmSEZbHw

## Status

Blueprint v0.24, Developer Spec v1.17, Phase 0 (Python reference implementation, 89 tests on the real exports), 15 Playwright suites / 499 checks on the prototypes. **The build lives in Agility** — Node + Postgres on Render — where Phase 0 is already ported as `lib/service-journey-postgres.js` (docs 12 and 13). Docs 07 and 11 are the source of truth for intent; doc 12 for where it runs; doc 13 reconciles them; docs 14–17 are the 9/19 testing rounds. Open questions for Wilson are blueprint §14 and spec §12 (items 50–55).
