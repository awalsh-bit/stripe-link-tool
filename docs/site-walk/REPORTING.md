# Site walk reporting views (step two, part one; 11/18)

Cayden's standalone tool keeps a reporting copy of every walk in 25 SQL Server tables and 5 views
(`sql/sitewalk_schema.sql` in `wilson_site_walks_v0985`, filled by `sitewalk_sync.py`). On Agility every walk is
already stored whole in `sw_walks.payload`, so the same rows are **Postgres views** over it. Nothing is copied,
nothing has to be kept in step, and a view always shows the walks as they stand right now.

The rule is Cayden's and it holds here: the views read what the field tool worked out. They count and reshape;
they never decide a verdict, a status or a punch line.

## Where it lives

| File | What |
| --- | --- |
| `lib/site-walk-reporting.sql` | The views and the small reader functions they share. All named `sw_report_*`. |
| `lib/site-walk-reporting.js` | `ensureSiteWalkReportingViews()` puts them in place. It runs 9 seconds after the server starts, and only does anything when the `.sql` file has changed (its version is kept as the comment on `sw_report_walks`). A failure is logged and never stops the server. |
| `server.js` | The import, and the start-up call next to `registerSiteWalkRoutes`. |

It never touches Cayden's tables (`sw_walks`, `sw_walk_events`, `sw_spec_library`), only its own views and
functions. Nothing on the site reads the views yet.

## The views

| Standalone (SQL Server) | Agility (Postgres view) |
| --- | --- |
| `SiteWalkWalks` | `sw_report_walks` |
| `SiteWalkJobs` | `sw_report_jobs` |
| `SiteWalkBuilders` | `sw_report_builders` |
| `SiteWalkAccessPhotos` | `sw_report_access_photos` |
| `SiteWalkPrereqs` | `sw_report_prereqs` |
| `SiteWalkTicketDiffs` | `sw_report_ticket_diffs` |
| `SiteWalkOpenings` | `sw_report_openings` |
| `SiteWalkOpeningDimensions` | `sw_report_opening_dimensions` |
| `SiteWalkOpeningUtilities` | `sw_report_opening_utilities` |
| `SiteWalkOpeningObstructions` | `sw_report_opening_obstructions` |
| `SiteWalkOpeningPanelsMeasured` | `sw_report_opening_panels_measured` |
| `SiteWalkOpeningMergeUnits` | `sw_report_opening_merge_units` |
| `SiteWalkOpeningFormReadings` | `sw_report_opening_form_readings` |
| `SiteWalkOpeningFormChecks` | `sw_report_opening_form_checks` |
| `SiteWalkOpeningPanels` | `sw_report_opening_panels` |
| `SiteWalkOpeningFindings` | `sw_report_opening_findings` |
| `SiteWalkPhotos` | `sw_report_photos` |
| `SiteWalkOpeningOverlays` | `sw_report_opening_overlays` |
| `SiteWalkOpeningServicePhotos` | `sw_report_opening_service_photos` |
| `SiteWalkSyncLog` | `sw_report_sync_log` (from `sw_walk_events`) |
| `SiteWalkPacketDeliveries` | `sw_report_packet_deliveries` (the `sent` events) |
| `vw_SiteWalkWalkReadiness` | `sw_report_walk_readiness` |
| `vw_SiteWalkOpenPunchList` | `sw_report_open_punch_list` (adds owner, owner group and severity) |
| `vw_SiteWalkJobReadiness` | `sw_report_job_readiness` |
| `vw_SiteWalkBuilderScorecard` | `sw_report_builder_scorecard` |
| `vw_SiteWalkSpecVerification` | `sw_report_spec_verification` (built for Agility, see below) |
| `SiteWalkSchemaVersions` | not repeated: the version is the comment on `sw_report_walks` |
| `SiteWalkSpecModels`, `…SpecVariations`, `…SpecUtilities` | not repeated: the spec library ships inside the pages |

Two helpers that the others stand on: `sw_report_opening_source` (one row per opening, with the raw opening) and
`sw_report_walk_jobs` (each walk with its job's current details).

Names follow Postgres habit: `RequiredIn` is `required_in`. Keys are the browser's ids (`walk_id`,
`client_opening_id`, plus `opening_seq`, the opening's place in the walk) instead of SQL Server identity numbers.
Booleans are booleans, inches are numbers, JSON is `jsonb`.

## Where Agility differs from the standalone, on purpose

- **Sign-off, "sent" and the stage** come from the server's own columns on `sw_walks`. On Agility the server
  decides those, not the page.
- **Archived walks** are left out of the five report views. The row views keep them, with `archived_at` set.
- **Every finding is open.** The standalone lets the office mark a finding resolved; Agility has no such screen
  yet, so nothing is resolved.
- **Target delivery date** is not recorded by the tool yet (empty), the same as the standalone; the ePASS ticket
  comparison is meant to fill it.
- **Days** (days since walk, days outstanding) are counted in Central time.
- **A walk date that is not a real day** (a typed February 30) is left empty rather than kept as text.
- **Spec verification** is built from what the walks record (each opening's "numbers confirmed" stamp and the
  sheet its packet printed) plus confirmations in the shared spec library (`sw_spec_library`), since the
  standalone's three spec tables are not repeated. `needs_verification` is true when neither has confirmed it.
- **Job readiness** shows the job's builder with no contact-name fallback (as the standalone does); walk readiness
  and the punch list fall back to the contact's name.

## How it was checked

- **Every row view against Cayden's own code.** Each test walk was run through his `sitewalk_sync.map_payload`
  and every value compared with the view: 13,343 values on 9 ordinary walks, 104,923 on 57 walks built to be
  awkward (missing pieces, wrong types, odd dates, merges, overlays), and 4,801 on 13 more. All match.
- **The report views against his tables and views.** The same walks went through his `SqliteStore.apply()` (his
  builder and job matching, his row writer) and his five T-SQL views, translated to SQLite by hand: 1,514 values
  and 1,474 values compared. All match.
- **Spec verification** recounted independently (36 rows); confirming a model in the shared library flips it, and
  removing the confirmation flips it back.
- **Speed**, on a test database of 1,197 walks and 9,492 openings: every row view reads in well under a second;
  the report views take one to three seconds each.
- **Start-up**: a fresh database (no site walk tables yet), an existing one with an older version, a second start
  (nothing re-applied), and no database at all (skipped). Cayden's module tests and the 34 integration checks
  still pass.

## Example queries

```sql
-- What is still outstanding on open jobs, oldest first
SELECT job_no, project_name, builder_name, area, location, label, owner_group, days_outstanding
  FROM sw_report_open_punch_list
 ORDER BY days_outstanding DESC NULLS LAST, job_no, opening_seq, kind_rank, sort_order;

-- Jobs we can schedule
SELECT job_no, project_name, builder_name, current_walk_date
  FROM sw_report_job_readiness
 WHERE clear_for_delivery;

-- Which builders hand us the most rework
SELECT builder_name, walk_count, corrections_per_opening, first_pass_ready_rate
  FROM sw_report_builder_scorecard
 ORDER BY corrections_per_opening DESC;

-- Spec sheets nobody has confirmed, most-used first
SELECT * FROM sw_report_spec_verification WHERE needs_verification ORDER BY walks_affected DESC;
```

Read-only: these are views, so they can be queried by anything with read access to the database and can never
change a walk.

One caution: when `site-walk-reporting.sql` changes, every `sw_report_*` view is dropped and made again, and
anything someone has built **on top of** them in the database is dropped with them. Query them freely; put new
views in this file instead of building them by hand in the database.
