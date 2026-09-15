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
  07_Developer_Spec.md              THE HANDOFF (v1.3): schema, transition table, import/sync algorithm, capacity & trips, pricing/tax, Podium templates, API, build order, tunables
  08_Replay_Sep2026.md              The real Sep 10 schedule scored against the spec rules; tunable changes that came out of it
  09_Customer_Copy.md               Every customer-facing sentence (texts, emails, tracker, field-tool authorization, intake) for review
  10_Demo_Script.md                 Click-by-click script for the team meeting: two demos, sample customers, recovery steps, likely questions
  11_Shadow_Test_and_Dev_Handoff.md 9/14: the shadow test instance (all techs, real DT feed), the "Copy to service dashboard test module" button contract, retiring the AJH pilot
  12_Agility_Platform_Notes.md      9/15: Agility runs on Node + Postgres (Render), Phase 0 is already ported (lib/service-journey-postgres.js), live sj_* DDL, conventions, §14 mapped onto Agility
meeting/
  Wilson_Service_Journey_Team_Deck.pptx   Six slides with speaker notes for the service team meeting
  deck_preview.jpg                        Thumbnail grid of the deck
phase0/                             WORKING CODE — spec §10 Phase 0 (Python 3.10+, stdlib + openpyxl; pyodbc for SQL Server)
  wilson_service/                   schema+DDL, seed, DispatchTrack & ExportInvoice importers, upsert rules, status engine,
                                    sync queue with packets, stale/stuck rules, folder watcher, CLI (python -m wilson_service)
  schema/schema_mssql.sql           generated idempotent DDL for localhost\SQLEXPRESS (schema_sqlite.sql for dev)
  tests/test_phase0.py              31 tests against reference/data — run `python -m unittest -v` inside phase0/
  README.md                         setup, Task Scheduler, what the import owns, engine + sync semantics
prototypes/
  dispatch_board_and_tracker.html   Two-truck route board + customer "where's my repair" tracker (sample data)
  field_tool.html                   Tech phone view: route, on-my-way, findings, field quote + signature
  office_queues.html                Parts verify / order / receiving + ePASS sync queue
  developer_spec_page.html          Styled version of docs/07
  blueprint_page.html               Styled, shareable version of the blueprint
reference/
  tech_roster.csv                                 Real roster with home base, start/end, skills, auto-route flags
  zone_table.csv                                  ePASS Map Zones → group, booking mode, distance, primary/secondary tech
  zip_zone_tech.csv                               79 zips → zone, techs seen, booking mode
  data/                                           Sep 10 2026 pulls: DispatchTrack CSV, ExportInvoice, completed COD 2026, OE-23 (+ parsed JSON)
  2025.6.21_Service_Flat_Rates_ePASS_Ready.xlsx   Current rate book as imported into ePASS
  task_catalog_draft.csv                          Raw 743-row extraction from the rate book
  catalog_tasks.csv / catalog_modifiers.csv /     Clean seed data: 478 family tasks + 24 generic, 7 modifiers,
  catalog_rates.csv / catalog_family_tax.csv      rates, per-family labor tax rule
  wilson_maintenance_portal_v0965.zip             Maintenance portal (source of the field-tool pattern)
  wilson_routing_dashboard_context_3_sales_side.md  Sales/install routing prototype notes (out of scope; DT feed info)
```

Prototypes are single self-contained HTML files — open them directly in a browser. Nothing is saved; they run on invented sample data.

## Live pages (claude.ai artifacts, private to Cayden until shared)

- Service Order Journey Blueprint — https://claude.ai/code/artifact/dd8543fd-d1ed-455e-9653-0193065e61b3
- Wilson Dispatch Prototype (board + tracker) — https://claude.ai/code/artifact/d33298b0-4482-44fb-bad3-bdfa73c41cf0
- Wilson Service Field Tool — https://claude.ai/code/artifact/b4d231f1-bc77-401f-ab7a-5f6e1a8d2f00
- Wilson Parts & Sync Queues — https://claude.ai/code/artifact/4e4d1816-69ef-43df-8bfe-98e1c3bfd08e

## Status

Blueprint v0.12, Developer Spec v1.3, **Phase 0 v0.3.0 built and green** (`phase0/`, 37 tests on the real 9/10 exports: 236 DT orders, 657 invoice tickets, idempotent re-import, dashboard-owned fields preserved, sync confirm/discrepancy/reverse, stale rule, 9/11 capacity controls, hold/direct-ship rules, recall detection). Decisions settled are in docs/01 §13; open questions in docs/07 §12 and phase0/README "Open items". 9/14: placement against the real route (`placement.suggest`), the **SO4 auto-pencil** (ETA + 2 business days on the owning tech's best-fit day, dashboard-only, first date the customer sees), **route-first dates** in the picker, the **queue-copy intake** (`intake.from_queue` + `serve`) with automatic SV attach and a suggested-vs-actual scorecard (`shadow-report`), and manual part numbers in the field tool. The AJH pilot files are retired; the shadow test runs for all techs on this code — `docs/11_Shadow_Test_and_Dev_Handoff.md`.
