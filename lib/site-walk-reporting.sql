-- ===========================================================================
-- Site walk reporting views (Postgres) — step two, part one.
--
-- The standalone tool projects each walk into SQL Server tables
-- (wilson_site_walks_v0985/sql/sitewalk_schema.sql, filled by
-- sitewalk_sync.py map_payload). On Agility every walk is already stored
-- whole in sw_walks.payload (JSONB), so the same rows are VIEWS over it:
-- nothing is copied, nothing has to be kept in step, and a view always shows
-- the walks as they stand.
--
-- The one rule is Cayden's and it holds here: these views read values the
-- field tool computed; they never decide a verdict, a status or a punch line.
-- They count and reshape, like his views did.
--
-- Names: the standalone table SiteWalkOpeningDimensions is
-- sw_report_opening_dimensions here; its column RequiredIn is required_in.
-- Keys: the browser's ids (walk_id, client_opening_id) instead of IDENTITY
-- numbers. Booleans are boolean, inches are numeric, JSON is jsonb.
--
-- Agility differences, on purpose:
--   - Sign-off, "sent" and the stage come from the server's own columns
--     (sw_walks.signed_off_*, packet_sent_*, stage): on Agility the server
--     decides those, not the page.
--   - An archived walk is out of the five report views (walk readiness,
--     punch list, job readiness, builder scorecard, spec verification). The
--     row views keep it, with archived_at set.
--   - No finding has been "resolved in the office" yet (no such screen), so
--     every finding is open.
--   - Target delivery date is not recorded by the tool yet (NULL), as in the
--     standalone; the ePASS ticket comparison is meant to fill it.
--   - Days are counted in Central time.
--   - The spec library ships inside the pages, so the three spec library
--     tables are not repeated; sw_report_spec_verification is built from what
--     the walks themselves record (whose numbers were confirmed, on which
--     sheet) plus the shared library's confirmations (sw_spec_library).
--
-- Applied by lib/site-walk-reporting.js on start-up, only when this file has
-- changed (the version is kept as the comment on sw_report_walks).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Readers, written to give the same answers as sitewalk_sync.py's helpers
-- ---------------------------------------------------------------------------

-- _s(): trimmed text, empty -> NULL, cut to n characters
CREATE FUNCTION sw_report_clean(t text, n int DEFAULT NULL) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(left(regexp_replace(t, '^\s+|\s+$', '', 'g'), COALESCE(n, 2147483647)), '')
$$;

CREATE FUNCTION sw_report_text(v jsonb, n int DEFAULT NULL) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(v)
    WHEN 'string'  THEN sw_report_clean(v #>> '{}', n)
    WHEN 'number'  THEN sw_report_clean(v #>> '{}', n)
    WHEN 'boolean' THEN sw_report_clean(CASE WHEN v = 'true'::jsonb THEN 'True' ELSE 'False' END, n)
    WHEN 'object'  THEN sw_report_clean(v::text, n)
    WHEN 'array'   THEN sw_report_clean(v::text, n)
  END
$$;

-- _n(): a number, or NULL. Booleans are not numbers.
CREATE FUNCTION sw_report_num(v jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(v)
    WHEN 'number' THEN (v #>> '{}')::numeric
    WHEN 'string' THEN CASE WHEN (v #>> '{}') ~ '^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$'
                            THEN (v #>> '{}')::numeric END
  END
$$;

-- _i(): a whole number (12.7 -> 12), or the default
CREATE FUNCTION sw_report_int(v jsonb, dflt int DEFAULT 0) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(v)
    WHEN 'boolean' THEN CASE WHEN v = 'true'::jsonb THEN 1 ELSE 0 END
    WHEN 'number'  THEN trunc((v #>> '{}')::numeric)::int
    WHEN 'string'  THEN CASE WHEN (v #>> '{}') ~ '^\s*[+-]?\d{1,9}\s*$' THEN (v #>> '{}')::int ELSE dflt END
    ELSE dflt
  END
$$;

-- _b(): true when the value is "truthy" the way Python reads it
CREATE FUNCTION sw_report_truthy(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(v)
    WHEN 'boolean' THEN v = 'true'::jsonb
    WHEN 'number'  THEN (v #>> '{}')::numeric <> 0
    WHEN 'string'  THEN (v #>> '{}') <> ''
    WHEN 'array'   THEN jsonb_array_length(v) > 0
    WHEN 'object'  THEN v <> '{}'::jsonb
    ELSE false
  END
$$;

-- "None if missing else _b()"
CREATE FUNCTION sw_report_flag(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL ELSE sw_report_truthy(v) END
$$;

-- _date(): YYYY-MM-DD, or NULL. A day that does not exist (Feb 30) is dropped, not guessed. Checked
-- without raising an error, so the views can run in parallel.
CREATE FUNCTION sw_report_day(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN t ~ '^\d{4}-\d{2}-\d{2}' AND substr(t, 1, 4)::int >= 1 AND substr(t, 6, 2)::int BETWEEN 1 AND 12 THEN
    CASE WHEN substr(t, 9, 2)::int BETWEEN 1 AND
              extract(day FROM make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, 1) + interval '1 month - 1 day')::int
         THEN make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, substr(t, 9, 2)::int) END
  END
$$;

CREATE FUNCTION sw_report_date(v jsonb) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT sw_report_day(sw_report_text(v))
$$;

-- _stamp(): an ISO time (a date, or a date and time with or without a zone), or NULL
CREATE FUNCTION sw_report_stamp(v jsonb) RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN sw_report_day(sw_report_text(v)) IS NOT NULL
               AND sw_report_text(v) ~ '^\d{4}-\d{2}-\d{2}([T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?)?(Z|[+-]([01]\d|2[0-3])(:?[0-5]\d)?)?$'
              THEN sw_report_text(v)::timestamptz END
$$;

-- an array's elements with their position, or nothing when it is not an array. ROWS and the fixed
-- search_path keep it a real function the planner counts as ~10 rows, not 1: with 1 it chose nested
-- loops that re-read every walk once per row.
CREATE FUNCTION sw_report_items(v jsonb) RETURNS TABLE (item jsonb, seq int)
LANGUAGE sql IMMUTABLE PARALLEL SAFE ROWS 10 SET search_path = pg_catalog AS $$
  SELECT e, i::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v) = 'array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY AS t(e, i)
$$;

-- an object, or NULL when it is anything else
CREATE FUNCTION sw_report_obj(v jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'object' THEN v END
$$;

-- the markup on a photograph: _markup_cols()
CREATE FUNCTION sw_report_markup_count(ph jsonb) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(ph -> 'markup') = 'object' THEN
    sw_report_int(CASE WHEN sw_report_truthy(ph -> 'markup' -> 'strokes') THEN ph -> 'markup' -> 'strokes' END, 0)
    + sw_report_int(CASE WHEN sw_report_truthy(ph -> 'markup' -> 'shapes') THEN ph -> 'markup' -> 'shapes' END, 0)
    + (SELECT count(*)::int FROM sw_report_items(ph -> 'markup' -> 'texts') x WHERE sw_report_truthy(x.item))
  ELSE 0 END
$$;

CREATE FUNCTION sw_report_markup_texts(ph jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT sw_report_clean(string_agg(CASE jsonb_typeof(x.item) WHEN 'string' THEN x.item #>> '{}' ELSE x.item::text END, ' | ' ORDER BY x.seq), 400)
    FROM sw_report_items(CASE WHEN jsonb_typeof(ph -> 'markup') = 'object' THEN ph -> 'markup' -> 'texts' END) x
   WHERE sw_report_truthy(x.item)
$$;

-- who owns a correction: _owner_cols()
CREATE FUNCTION sw_report_owner(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN sw_report_text(v, 20) IN ('builder','cabinet','electrician','plumber','trim','countertop','hvac','flooring','wilson','internal','sales')
              THEN sw_report_text(v, 20) ELSE 'builder' END
$$;

CREATE FUNCTION sw_report_owner_group(owner text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN owner IN ('wilson','internal') THEN 'wilson' WHEN owner = 'sales' THEN 'sales' ELSE 'builder' END
$$;

-- a model number's letters and digits, as the shared spec library keys it
CREATE FUNCTION sw_report_model_key(model text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(upper(COALESCE(model, '')), '[^A-Z0-9]', '', 'g')
$$;

-- ---------------------------------------------------------------------------
-- Walks, jobs, builders
-- ---------------------------------------------------------------------------

-- SiteWalkWalks. One row per walk on the server, archived ones included.
CREATE VIEW sw_report_walks AS
SELECT
  w.walk_id,
  CASE WHEN sw_report_text(wk -> 'jobNo', 60) IS NOT NULL
       THEN 'job:' || sw_report_text(wk -> 'jobNo', 60)
       ELSE 'project:' || COALESCE(sw_report_text(wk -> 'project', 200), '') || '|builder:' || COALESCE(sw_report_text(wk -> 'builder', 200), '')
  END                                                     AS job_key,
  sw_report_text(wk -> 'jobNo', 60)                       AS job_no,
  sw_report_text(wk -> 'project', 200)                    AS project_name,
  sw_report_text(wk -> 'address', 400)                    AS site_address,
  sw_report_text(wk -> 'builder', 200)                    AS builder_name,
  sw_report_text(wk -> 'specSource', 120)                 AS spec_package_ref,
  sw_report_date(wk -> 'walkDate')                        AS walk_date,
  sw_report_text(wk -> 'walkedBy', 150)                   AS walked_by_name_snapshot,
  sw_report_text(wk -> 'builderContact', 150)             AS builder_contact_name_snapshot,
  sw_report_text(wk -> 'builderEmail', 320)               AS builder_contact_email_snapshot,
  sw_report_text(wk -> 'specSource', 200)                 AS spec_source_snapshot,
  sw_report_text(wk -> 'salesName', 150)                  AS sales_name,
  sw_report_text(wk -> 'salesEmail', 320)                 AS sales_email,
  sw_report_flag(wk -> 'flooringPending')                 AS flooring_pending,
  sw_report_num(wk -> 'flooringThicknessIn')              AS flooring_thickness_in,
  sw_report_flag(wk -> 'prereqsAnswered')                 AS prereqs_answered,
  sw_report_text(tk -> 'jobBase', 30)                     AS ticket_job_base,
  sw_report_text(tk -> 'pulledAt', 40)                    AS ticket_pulled_at,
  sw_report_text(tk -> 'scheduleDate', 10)                AS ticket_schedule_date,
  (SELECT sw_report_clean(string_agg(CASE jsonb_typeof(x.item) WHEN 'string' THEN x.item #>> '{}' ELSE x.item::text END, ', ' ORDER BY x.seq), 300)
     FROM sw_report_items(tk -> 'tickets') x)             AS ticket_codes,
  CASE WHEN tk <> '{}'::jsonb THEN sw_report_int(tk -> 'open', 0) END   AS ticket_open_diffs,
  CASE WHEN tk <> '{}'::jsonb THEN sw_report_int(tk -> 'blocks', 0) END AS ticket_blocking_diffs,
  sw_report_text(wk -> 'installerName', 120)              AS installer_name,
  sw_report_text(wk -> 'installerPhone', 40)              AS installer_phone,
  sw_report_text(wk -> 'quoteNo', 60)                     AS quote_no,
  w.signed_off_at                                         AS reviewed_at,     -- the server's sign-off (Agility decides it)
  NULLIF(COALESCE(w.signed_off_by_name, w.signed_off_by), '') AS reviewed_by,
  w.signed_off_by                                         AS reviewed_by_email,
  sw_report_text(wk -> 'note')                            AS walk_note,
  w.stage                                                 AS stage_code,      -- the server's (it sets "sent")
  sw_report_int(roll -> 'openings', n_openings)          AS opening_count,
  sw_report_int(roll -> 'walked', 0)                      AS walked_count,
  sw_report_int(roll -> 'readyCount', 0)                  AS ready_count,
  sw_report_int(roll -> 'verifyCount', 0)                 AS verify_count,
  sw_report_int(roll -> 'modifyCount', 0)                 AS modify_count,
  sw_report_int(roll -> 'decisionCount', 0)               AS decision_count,
  sw_report_int(roll -> 'openCount', 0)                   AS open_count,
  sw_report_int(roll -> 'heldCount', 0)                   AS held_count,
  sw_report_int(roll -> 'blockerCount', 0)                AS blocker_count,
  sw_report_truthy(roll -> 'deliverable')                 AS is_deliverable,
  w.packet_sent_at,                                                             -- the server's record of "sent"
  NULLIF(w.packet_sent_to, '')                            AS packet_sent_to,
  w.packet_sent_by,
  sw_report_stamp(wk -> 'updatedAt')                      AS client_updated_at,
  sw_report_text(acc -> 'route', 30)                      AS access_route,
  sw_report_text(acc -> 'state', 20)                      AS access_state,
  sw_report_num(acc -> 'tightestIn')                      AS access_tightest_in,
  sw_report_text(acc -> 'note')                           AS access_note,
  NULLIF(w.last_sync_device, '')                          AS last_sync_device,
  sw_report_text(schema_v)                                AS payload_schema,
  w.first_synced_at,
  w.last_synced_at,
  NULLIF(w.last_synced_by, '')                            AS last_synced_by,
  w.archived_at,
  w.archived_by
FROM sw_walks w
-- OFFSET 0 keeps each piece computed once per walk: without it every column re-reads the whole stored payload
CROSS JOIN LATERAL (SELECT COALESCE(sw_report_obj(w.payload -> 'walk'), '{}'::jsonb) AS wk,
                           COALESCE(sw_report_obj(w.payload -> 'rollup'), '{}'::jsonb) AS roll,
                           (SELECT count(*)::int FROM sw_report_items(w.payload -> 'openings')) AS n_openings,
                           w.payload -> 'schema' AS schema_v
                    OFFSET 0) a
CROSS JOIN LATERAL (SELECT COALESCE(sw_report_obj(a.wk -> 'ticket'), '{}'::jsonb) AS tk,
                           COALESCE(sw_report_obj(a.wk -> 'access'), '{}'::jsonb) AS acc
                    OFFSET 0) b;

-- SiteWalkJobs. A job is its job number, or project + builder where there is
-- none yet (early walks often come before the number). Each detail is the
-- latest one any walk of the job gave, as the standalone's upsert kept it.
CREATE VIEW sw_report_jobs AS
SELECT
  w.job_key,
  (array_agg(w.job_no ORDER BY w.last_synced_at DESC, w.walk_id) FILTER (WHERE w.job_no IS NOT NULL))[1]                     AS job_no,
  (array_agg(w.project_name ORDER BY w.last_synced_at DESC, w.walk_id) FILTER (WHERE w.project_name IS NOT NULL))[1]         AS project_name,
  (array_agg(w.site_address ORDER BY w.last_synced_at DESC, w.walk_id) FILTER (WHERE w.site_address IS NOT NULL))[1]         AS site_address,
  (array_agg(w.spec_package_ref ORDER BY w.last_synced_at DESC, w.walk_id) FILTER (WHERE w.spec_package_ref IS NOT NULL))[1] AS spec_package_ref,
  (array_agg(w.builder_name ORDER BY w.last_synced_at DESC, w.walk_id) FILTER (WHERE w.builder_name IS NOT NULL))[1]         AS builder_name_snapshot,
  NULL::date                                              AS target_delivery_date,   -- not recorded by the tool yet
  count(*)                                                AS walk_count,
  min(w.walk_date)                                        AS first_walk_date,
  max(w.walk_date)                                        AS last_walk_date
FROM sw_report_walks w
GROUP BY w.job_key;

-- SiteWalkBuilders. A builder is its name; the contact is the latest one given.
CREATE VIEW sw_report_builders AS
SELECT
  w.builder_name,
  (array_agg(w.builder_contact_name_snapshot ORDER BY w.last_synced_at DESC) FILTER (WHERE w.builder_contact_name_snapshot IS NOT NULL))[1]  AS primary_contact_name,
  (array_agg(w.builder_contact_email_snapshot ORDER BY w.last_synced_at DESC) FILTER (WHERE w.builder_contact_email_snapshot IS NOT NULL))[1] AS primary_contact_email,
  count(DISTINCT w.job_key)                               AS job_count,
  count(*)                                                AS walk_count,
  max(w.walk_date)                                        AS last_walk_date
FROM sw_report_walks w
WHERE w.builder_name IS NOT NULL
GROUP BY w.builder_name;

-- ---------------------------------------------------------------------------
-- What the walk records about the house as a whole
-- ---------------------------------------------------------------------------

-- SiteWalkAccessPhotos
CREATE VIEW sw_report_access_photos AS
SELECT
  w.walk_id,
  x.seq,
  COALESCE(sw_report_text(x.item -> 'clientId', 80), '')  AS client_photo_id,
  sw_report_text(x.item -> 'portalId', 500)               AS storage_key,
  sw_report_text(x.item -> 'caption', 300)                AS caption,
  sw_report_int(x.item -> 'sortOrder', 0)                 AS sort_order,
  sw_report_text(x.item -> 'markup' -> 'json')            AS markup_json,
  sw_report_markup_count(x.item)                          AS markup_count,
  sw_report_markup_texts(x.item)                          AS markup_texts
FROM sw_walks w
CROSS JOIN LATERAL sw_report_items(w.payload -> 'walk' -> 'access' -> 'photos') x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkPrereqs: the before-delivery questions
CREATE VIEW sw_report_prereqs AS
SELECT
  w.walk_id,
  x.seq,
  COALESCE(sw_report_text(x.item -> 'code', 30), 'prereq') AS prereq_code,
  sw_report_text(x.item -> 'question', 200)               AS question,
  sw_report_text(x.item -> 'answer', 5)                   AS answer,
  sw_report_text(x.item -> 'fix', 400)                    AS fix_text,
  sw_report_text(x.item -> 'owner', 20)                   AS owner_code,
  sw_report_text(x.item -> 'kind', 12)                    AS item_kind
FROM sw_walks w
CROSS JOIN LATERAL sw_report_items(w.payload -> 'walk' -> 'prereqs') x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkTicketDiffs: the ePASS ticket comparison, when one was run
CREATE VIEW sw_report_ticket_diffs AS
SELECT
  w.walk_id,
  x.seq,
  COALESCE(sw_report_text(x.item -> 'id', 200), '')       AS diff_id,
  COALESCE(sw_report_text(x.item -> 'kind', 20), '')      AS kind,
  sw_report_text(x.item -> 'sub', 20)                     AS sub_kind,
  sw_report_text(x.item -> 'state', 12)                   AS state,
  sw_report_text(x.item -> 'owner', 20)                   AS owner_code,
  sw_report_text(x.item -> 'severity', 12)                AS severity,
  sw_report_text(x.item -> 'model', 80)                   AS model_no,
  sw_report_text(x.item -> 'invoice', 30)                 AS invoice_code,
  sw_report_text(x.item -> 'text')                        AS diff_text,
  sw_report_truthy(x.item -> 'applied')                   AS applied
FROM sw_walks w
CROSS JOIN LATERAL sw_report_items(sw_report_obj(w.payload -> 'walk' -> 'ticket') -> 'diffs') x
WHERE jsonb_typeof(x.item) = 'object';

-- ---------------------------------------------------------------------------
-- Openings and everything recorded on one
-- ---------------------------------------------------------------------------

-- SiteWalkOpenings
CREATE VIEW sw_report_openings AS
SELECT
  w.walk_id,
  o.seq                                                   AS opening_seq,
  sw_report_text(op -> 'clientId', 80)                    AS client_opening_id,
  sw_report_int(op -> 'sortOrder', o.seq)                 AS sort_order,
  sw_report_text(op -> 'area', 120)                       AS area,
  sw_report_text(op -> 'location', 200)                   AS location,
  sw_report_text(op -> 'brand', 80)                       AS brand,
  sw_report_text(op -> 'model', 80)                       AS model_no,
  sw_report_text(op -> 'flush' -> 'text', 400)            AS flush_text,
  sw_report_num(op -> 'flush' -> 'sideSetbackIn')         AS flush_side_setback_in,
  sw_report_num(op -> 'flush' -> 'sideSizeIn')            AS flush_side_size_in,
  sw_report_text(op -> 'swing' -> 'hinge', 8)             AS swing_hinge,
  sw_report_text(op -> 'swing' -> 'wallSide', 8)          AS swing_wall_side,
  sw_report_num(op -> 'swing' -> 'clearanceIn')           AS swing_clearance_in,
  sw_report_num(op -> 'swing' -> 'minIn')                 AS swing_min_in,
  sw_report_num(op -> 'finishedHeightIn')                 AS finished_height_in,
  sw_report_num(op -> 'flooringDeductionIn')              AS flooring_deduction_in,
  sw_report_text(op -> 'form' -> 'key', 20)               AS form_key,
  sw_report_truthy(op -> 'form' -> 'chosen')              AS form_chosen,
  COALESCE(jsonb_typeof(op -> 'merge') = 'object', false) AS is_merge,
  CASE WHEN jsonb_typeof(op -> 'merge') = 'object'
       THEN (SELECT count(*)::int FROM sw_report_items(op -> 'merge' -> 'units')) END AS merge_unit_count,
  sw_report_text(op -> 'merge' -> 'kitState', 12)         AS merge_kit_state,
  sw_report_text(op -> 'merge' -> 'widthBasis', 12)       AS merge_width_basis,
  sw_report_text(op -> 'merge' -> 'widthText', 400)       AS merge_width_text,
  sw_report_text(op -> 'appliance', 300)                  AS appliance_description,
  sw_report_text(op -> 'category', 40)                    AS category_code,
  sw_report_text(op -> 'installBasisCode', 40)            AS install_basis_code,
  sw_report_text(op -> 'installBasisLabel', 120)          AS install_basis_label_snapshot,
  sw_report_text(op -> 'specPageRef', 40)                 AS spec_page_ref,
  sw_report_text(op -> 'basisConfirmed')                  AS basis_confirmed_in_field,
  sw_report_truthy(op -> 'basisPending')                  AS basis_pending,
  sw_report_text(sw_report_obj(op -> 'basisConflict') -> 'chosen', 120)    AS basis_conflict_chosen,
  sw_report_text(sw_report_obj(op -> 'basisConflict') -> 'betterFit', 120) AS basis_conflict_better_fit,
  COALESCE(sw_report_text(op -> 'status'), 'open')        AS opening_status,   -- an opening nobody has walked is "open", never absent
  sw_report_truthy(op -> 'done')                          AS is_walked,
  sw_report_truthy(op -> 'started')                       AS is_started,
  sw_report_text(op -> 'notMeasuredReason', 200)          AS not_measured_reason,
  sw_report_truthy(op -> 'irregular')                     AS is_irregular,
  sw_report_text(op -> 'punchLine')                       AS punch_line,
  sw_report_text(op -> 'conclusion')                      AS conclusion,
  sw_report_text(op -> 'fieldNote')                       AS field_note,
  (SELECT count(*)::int FROM sw_report_items(op -> 'actions') x WHERE sw_report_truthy(x.item)) AS action_count,
  sw_report_text(op -> 'specPage' -> 'photoClientId', 80) AS spec_page_photo_client_id,
  sw_report_text(op -> 'specPage' -> 'portalId', 500)     AS spec_page_portal_id,
  sw_report_num(op -> 'specPage' -> 'pageNo')             AS spec_page_no,
  sw_report_text(op -> 'specPage' -> 'sourceDoc', 200)    AS spec_page_source_doc,
  sw_report_text(op -> 'specPage' -> 'heading', 120)      AS spec_page_heading,
  CASE WHEN jsonb_typeof(op -> 'specPages') = 'array' AND jsonb_array_length(op -> 'specPages') > 0 THEN op -> 'specPages' END       AS spec_pages_json,
  CASE WHEN jsonb_typeof(op -> 'prep') = 'array' AND jsonb_array_length(op -> 'prep') > 0 THEN op -> 'prep' END                      AS prep_json,
  CASE WHEN jsonb_typeof(op -> 'planePhotos') = 'array' AND jsonb_array_length(op -> 'planePhotos') > 0 THEN op -> 'planePhotos' END AS plane_photos_json,
  sw_report_truthy(op -> 'utilitiesNone')                 AS utilities_none,
  sw_report_text(op -> 'dimsVerified' -> 'by', 150)       AS dims_verified_by,
  sw_report_stamp(op -> 'dimsVerified' -> 'at')           AS dims_verified_at,
  sw_report_text(op -> 'dimsVerified' -> 'sourceDoc', 200) AS dims_verified_doc,
  sw_report_num(op -> 'dimsVerified' -> 'pageNo')         AS dims_verified_page_no,
  sw_report_text(op -> 'dimsVerified' -> 'sheetDate', 40) AS dims_verified_sheet_date
FROM sw_walks w
CROSS JOIN LATERAL sw_report_items(w.payload -> 'openings') o
CROSS JOIN LATERAL (SELECT o.item AS op) t
WHERE jsonb_typeof(o.item) = 'object';

-- The openings, one row each, with the array the children come from. Shared
-- by the views below so each reads the payload one way.
CREATE VIEW sw_report_opening_source AS
SELECT w.walk_id, o.seq AS opening_seq, sw_report_text(o.item -> 'clientId', 80) AS client_opening_id, o.item AS op
FROM sw_walks w
CROSS JOIN LATERAL sw_report_items(w.payload -> 'openings') o
WHERE jsonb_typeof(o.item) = 'object';

-- SiteWalkOpeningDimensions
CREATE VIEW sw_report_opening_dimensions AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, d.seq,
  sw_report_text(d.item -> 'axis')                        AS axis,
  sw_report_text(d.item -> 'label', 30)                   AS axis_label_snapshot,
  sw_report_text(d.item -> 'rule')                        AS rule_code,
  sw_report_num(d.item -> 'specIn')                       AS required_in,
  sw_report_num(d.item -> 'specMaxIn')                    AS required_max_in,
  sw_report_num(d.item -> 'actualIn')                     AS field_in,
  sw_report_num(d.item -> 'deltaIn')                      AS delta_in,
  sw_report_truthy(d.item -> 'notMeasured')               AS not_measured,
  sw_report_text(d.item -> 'verdict')                     AS verdict_code,
  sw_report_text(d.item -> 'verdictText', 200)            AS verdict_text,
  sw_report_text(d.item -> 'acceptedReason', 300)         AS accepted_reason,
  sw_report_text(d.item -> 'rawVerdict')                  AS raw_verdict_code,
  (SELECT sw_report_num(p.item -> 'valueIn') FROM sw_report_items(d.item -> 'points') p WHERE p.item ->> 'at' = 'left'   AND jsonb_typeof(p.item -> 'at') = 'string' ORDER BY p.seq LIMIT 1) AS left_in,
  (SELECT sw_report_num(p.item -> 'valueIn') FROM sw_report_items(d.item -> 'points') p WHERE p.item ->> 'at' = 'centre' AND jsonb_typeof(p.item -> 'at') = 'string' ORDER BY p.seq LIMIT 1) AS centre_in,
  (SELECT sw_report_num(p.item -> 'valueIn') FROM sw_report_items(d.item -> 'points') p WHERE p.item ->> 'at' = 'right'  AND jsonb_typeof(p.item -> 'at') = 'string' ORDER BY p.seq LIMIT 1) AS right_in,
  sw_report_text(d.item -> 'governingPoint', 10)          AS governing_point
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'dimensions') d
WHERE jsonb_typeof(d.item) = 'object';

-- SiteWalkOpeningUtilities: each connection the sheet calls for
CREATE VIEW sw_report_opening_utilities AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, u.seq,
  COALESCE(sw_report_text(u.item -> 'code', 30), 'utility') AS utility_code,
  sw_report_text(u.item -> 'label', 80)                   AS utility_label_snapshot,
  sw_report_text(u.item -> 'requirement', 300)            AS requirement_snapshot,
  sw_report_text(u.item -> 'belongs', 500)                AS belongs_snapshot,
  sw_report_text(u.item -> 'plane', 20)                   AS plane_code,
  sw_report_obj(u.item -> 'drawnZone')                    AS drawn_zone_json,
  sw_report_text(u.item -> 'zoneKind')                    AS zone_kind,
  sw_report_text(u.item -> 'answer')                      AS field_answer,
  sw_report_num(u.item -> 'markedXIn')                    AS marked_x_in,
  sw_report_num(u.item -> 'markedYIn')                    AS marked_y_in,
  sw_report_num(u.item -> 'offsetXIn')                    AS offset_x_in,
  sw_report_num(u.item -> 'offsetYIn')                    AS offset_y_in,
  sw_report_flag(u.item -> 'outsideZone')                 AS outside_zone,
  sw_report_text(u.item -> 'measuredText', 400)           AS measured_text,
  sw_report_num(u.item -> 'targetXIn')                    AS target_x_in,
  sw_report_num(u.item -> 'targetYIn')                    AS target_y_in,
  sw_report_text(u.item -> 'typeFound', 20)               AS type_found,
  sw_report_text(u.item -> 'typeRequired', 20)            AS type_required,
  sw_report_flag(u.item -> 'typeMismatch')                AS type_mismatch,
  CASE WHEN u.item -> 'unitIndex' IS NOT NULL AND jsonb_typeof(u.item -> 'unitIndex') <> 'null'
       THEN sw_report_int(u.item -> 'unitIndex', NULL) END AS unit_index,
  sw_report_text(u.item -> 'unitModel', 80)               AS unit_model
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'utilities') u
WHERE jsonb_typeof(u.item) = 'object';

-- SiteWalkOpeningObstructions: something in the way of the unit
CREATE VIEW sw_report_opening_obstructions AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq,
  sw_report_text(s.op -> 'obstruction' -> 'state')        AS obstruction_state,
  sw_report_text(s.op -> 'obstruction' -> 'kind', 80)     AS obstruction_kind,
  sw_report_num(s.op -> 'obstruction' -> 'projectsIn')    AS projects_in,
  sw_report_text(s.op -> 'obstruction' -> 'note', 500)    AS note_text
FROM sw_report_opening_source s
WHERE jsonb_typeof(s.op -> 'obstruction') = 'object';

-- SiteWalkOpeningPanelsMeasured
CREATE VIEW sw_report_opening_panels_measured AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, x.seq,
  sw_report_text(x.item -> 'clientPanelId', 40)           AS client_panel_id,
  COALESCE(sw_report_text(x.item -> 'label', 40), 'Panel') AS panel_label,
  sw_report_num(x.item -> 'widthIn')                      AS width_in,
  sw_report_num(x.item -> 'heightIn')                     AS height_in,
  sw_report_num(x.item -> 'targetWidthIn')                AS target_width_in,
  sw_report_num(x.item -> 'targetHeightIn')               AS target_height_in,
  sw_report_text(x.item -> 'plane', 12)                   AS plane,
  sw_report_truthy(x.item -> 'widthBad')                  AS width_bad,
  sw_report_truthy(x.item -> 'heightBad')                 AS height_bad,
  (SELECT NULLIF(string_agg(CASE jsonb_typeof(f.item) WHEN 'string' THEN f.item #>> '{}' ELSE f.item::text END, E'\n' ORDER BY f.seq), '')
     FROM sw_report_items(x.item -> 'fixes') f WHERE sw_report_truthy(f.item)) AS fixes_text
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'panelsMeasured') x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkOpeningMergeUnits: the units in a merged refrigeration opening
CREATE VIEW sw_report_opening_merge_units AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq,
  x.seq - 1                                               AS sort_order,
  sw_report_text(x.item -> 'position', 12)                AS position,
  sw_report_text(x.item -> 'clientId', 40)                AS client_unit_id,
  sw_report_text(x.item -> 'brand', 80)                   AS brand,
  sw_report_text(x.item -> 'model', 80)                   AS model_no,
  sw_report_text(x.item -> 'appliance', 300)              AS appliance_description,
  sw_report_text(x.item -> 'specRef', 40)                 AS spec_page_ref,
  sw_report_text(x.item -> 'basisKey', 40)                AS install_basis_code,
  sw_report_num(x.item -> 'openingWIn')                   AS opening_w_in,
  sw_report_num(x.item -> 'openingDIn')                   AS opening_d_in,
  sw_report_num(x.item -> 'openingHIn')                   AS opening_h_in
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(CASE WHEN jsonb_typeof(s.op -> 'merge') = 'object' THEN s.op -> 'merge' -> 'units' END) x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkOpeningFormReadings: the per-appliance form's numbers
CREATE VIEW sw_report_opening_form_readings AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, x.seq,
  COALESCE(sw_report_text(x.item -> 'code', 30), 'reading') AS reading_code,
  sw_report_text(x.item -> 'label', 120)                  AS reading_label,
  sw_report_num(x.item -> 'valueIn')                      AS value_in,
  sw_report_num(x.item -> 'minIn')                        AS min_in,
  sw_report_text(x.item -> 'state', 10)                   AS state
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(CASE WHEN jsonb_typeof(s.op -> 'form') = 'object' THEN s.op -> 'form' -> 'fields' END) x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkOpeningFormChecks: the per-appliance form's questions
CREATE VIEW sw_report_opening_form_checks AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, x.seq,
  COALESCE(sw_report_text(x.item -> 'code', 30), 'check') AS check_code,
  sw_report_text(x.item -> 'question', 200)               AS question,
  sw_report_text(x.item -> 'answer', 5)                   AS answer,
  sw_report_text(x.item -> 'fix', 400)                    AS fix_text,
  sw_report_text(x.item -> 'owner', 20)                   AS owner_code
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(CASE WHEN jsonb_typeof(s.op -> 'form') = 'object' THEN s.op -> 'form' -> 'checks' END) x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkOpeningPanels: the panel a panel-ready unit takes
CREATE VIEW sw_report_opening_panels AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq,
  sw_report_text(s.op -> 'panel' -> 'suppliedBy')         AS supplied_by,
  sw_report_text(s.op -> 'panel' -> 'onSiteState')        AS on_site_state,
  sw_report_text(s.op -> 'panel' -> 'pullsInstalled')     AS pulls_installed,
  sw_report_text(s.op -> 'panel' -> 'requiredText', 300)  AS required_text,
  sw_report_num(s.op -> 'panel' -> 'requiredWidthIn')     AS required_width_in,
  sw_report_num(s.op -> 'panel' -> 'requiredHeightIn')    AS required_height_in,
  sw_report_text(s.op -> 'panel' -> 'thickness', 120)     AS thickness_text,
  sw_report_text(s.op -> 'panel' -> 'weightLimit', 120)   AS weight_limit_text,
  sw_report_text(s.op -> 'panel' -> 'specPageRef', 40)    AS spec_page_ref,
  sw_report_truthy(s.op -> 'panel' -> 'specMissing')      AS spec_missing
FROM sw_report_opening_source s
WHERE jsonb_typeof(s.op -> 'panel') = 'object';

-- SiteWalkOpeningFindings: what each opening raises, in the order the packet
-- prints it: findings, then corrections (actions), then photographs that
-- disagree with the field answer.
CREATE VIEW sw_report_opening_findings AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, 1 AS kind_rank,
  x.seq                                                   AS sort_order,
  'FINDING'::text                                         AS finding_kind,
  sw_report_text(x.item -> 'label', 200)                  AS label,
  sw_report_text(x.item -> 'detail')                      AS detail,
  sw_report_owner(x.item -> 'owner')                      AS owner_code,
  sw_report_owner_group(sw_report_owner(x.item -> 'owner')) AS owner_group,
  CASE WHEN sw_report_text(x.item -> 'severity', 10) = 'cosmetic' THEN 'cosmetic' ELSE 'blocks' END AS severity,
  CASE WHEN sw_report_text(x.item -> 'kind', 10) IN ('fix','question','note') THEN sw_report_text(x.item -> 'kind', 10) ELSE 'fix' END AS action_kind,
  NULL::text                                              AS client_action_id,
  NULL::text                                              AS from_chip
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'findings') x
WHERE jsonb_typeof(x.item) = 'object'
UNION ALL
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, 2,
  x.seq,
  'ACTION',
  CASE WHEN jsonb_typeof(x.item) = 'object' THEN
    CASE COALESCE(sw_report_text(x.item -> 'kind', 10), 'fix') WHEN 'question' THEN 'Question for the builder'
                                                                 WHEN 'note' THEN 'Note to the installer'
                                                                 ELSE 'Required before delivery' END
  ELSE 'Required before delivery' END,
  CASE WHEN jsonb_typeof(x.item) = 'object' THEN sw_report_text(x.item -> 'text') ELSE sw_report_text(x.item) END,
  CASE WHEN jsonb_typeof(x.item) = 'object' THEN sw_report_owner(x.item -> 'owner') ELSE 'builder' END,
  CASE WHEN jsonb_typeof(x.item) = 'object' THEN sw_report_owner_group(sw_report_owner(x.item -> 'owner')) ELSE 'builder' END,
  CASE WHEN jsonb_typeof(x.item) = 'object' AND sw_report_text(x.item -> 'severity', 10) = 'cosmetic' THEN 'cosmetic' ELSE 'blocks' END,
  CASE WHEN jsonb_typeof(x.item) = 'object' AND sw_report_text(x.item -> 'kind', 10) IN ('fix','question','note') THEN sw_report_text(x.item -> 'kind', 10) ELSE 'fix' END,
  CASE WHEN jsonb_typeof(x.item) = 'object' THEN sw_report_text(x.item -> 'id', 40) END,
  CASE WHEN jsonb_typeof(x.item) = 'object' THEN sw_report_text(x.item -> 'chip', 40) END
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'actions') x
WHERE CASE WHEN jsonb_typeof(x.item) = 'object' THEN sw_report_text(x.item -> 'text') IS NOT NULL
           WHEN jsonb_typeof(x.item) IN ('string', 'number', 'boolean') THEN sw_report_text(x.item) IS NOT NULL
           ELSE false END
UNION ALL
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, 3,
  x.seq,
  'MARK_CONFLICT',
  'Photograph disagrees with the field answer',
  sw_report_text(x.item),
  NULL, NULL, NULL, NULL, NULL, NULL
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'utilityMarkConflicts') x;

-- SiteWalkPhotos: the opening's photographs (the bytes are in sw_photos)
CREATE VIEW sw_report_photos AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, x.seq,
  COALESCE(sw_report_text(x.item -> 'clientId', 80), '')  AS client_photo_id,
  sw_report_text(x.item -> 'portalId', 500)               AS storage_key,
  COALESCE(sw_report_text(x.item -> 'kind'), 'OPENING')   AS photo_kind,
  sw_report_text(x.item -> 'caption', 300)                AS caption,
  sw_report_int(x.item -> 'sortOrder', 0)                 AS sort_order,
  sw_report_text(x.item -> 'markup' -> 'json')            AS markup_json,
  sw_report_markup_count(x.item)                          AS markup_count,
  sw_report_markup_texts(x.item)                          AS markup_texts
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'photos') x
WHERE jsonb_typeof(x.item) = 'object';

-- SiteWalkOpeningOverlays
CREATE VIEW sw_report_opening_overlays AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq,
  sw_report_text(s.op -> 'overlay' -> 'photoClientId', 80) AS photo_client_id,
  sw_report_num(s.op -> 'overlay' -> 'planeWidthIn')      AS plane_width_in,
  sw_report_num(s.op -> 'overlay' -> 'planeHeightIn')     AS plane_height_in,
  CASE WHEN sw_report_truthy(s.op -> 'overlay' -> 'corners') THEN s.op -> 'overlay' -> 'corners' ELSE '[]'::jsonb END AS corners_json,
  CASE WHEN sw_report_truthy(s.op -> 'overlay' -> 'marks')   THEN s.op -> 'overlay' -> 'marks'   ELSE '{}'::jsonb END AS marks_json,
  CASE WHEN sw_report_truthy(s.op -> 'overlay' -> 'targets') THEN s.op -> 'overlay' -> 'targets' ELSE '{}'::jsonb END AS targets_json
FROM sw_report_opening_source s
WHERE jsonb_typeof(s.op -> 'overlay') = 'object';

-- SiteWalkOpeningServicePhotos: connections outside the opening's own face
CREATE VIEW sw_report_opening_service_photos AS
SELECT
  s.walk_id, s.client_opening_id, s.opening_seq, x.seq,
  sw_report_text(x.item -> 'group')                       AS group_code,
  COALESCE(sw_report_text(x.item -> 'photoClientId', 80), '') AS client_photo_id,
  sw_report_text(x.item -> 'portalId', 500)               AS storage_key,
  CASE WHEN sw_report_truthy(x.item -> 'pins') THEN x.item -> 'pins' ELSE '[]'::jsonb END AS pins_json
FROM sw_report_opening_source s
CROSS JOIN LATERAL sw_report_items(s.op -> 'servicePhotos') x
WHERE jsonb_typeof(x.item) = 'object';

-- ---------------------------------------------------------------------------
-- The server's own record
-- ---------------------------------------------------------------------------

-- SiteWalkSyncLog: every arrival, sign-off, reopen, send, archive and restore
CREATE VIEW sw_report_sync_log AS
SELECT e.id AS sync_log_id, e.walk_id, e.at AS received_at, e.kind AS outcome, NULLIF(e.actor_email, '') AS actor_email,
       sw_report_int(e.detail -> 'openings', NULL) AS openings, e.detail
FROM sw_walk_events e;

-- SiteWalkPacketDeliveries: each time the packet was recorded as sent
CREATE VIEW sw_report_packet_deliveries AS
SELECT e.id AS packet_delivery_id, e.walk_id, e.at AS sent_at, NULLIF(e.detail ->> 'to', '') AS sent_to_email, NULLIF(e.actor_email, '') AS sent_by
FROM sw_walk_events e
WHERE e.kind = 'sent';

-- ===========================================================================
-- The report views (vw_SiteWalk… in the standalone). They count; they do
-- not decide. Archived walks are left out of all of them.
--
-- Built for speed on a few thousand walks: every join is on walk_id (or a
-- walk_id + opening position), and a job's details ride on each walk row
-- (sw_report_walk_jobs) instead of a join on a computed job key.
-- ===========================================================================

-- Each walk with its job's current details (the same ones sw_report_jobs shows).
CREATE VIEW sw_report_walk_jobs AS
SELECT
  w.*,
  (array_agg(w.job_no)           FILTER (WHERE w.job_no IS NOT NULL)           OVER jw)[1] AS j_job_no,
  (array_agg(w.project_name)     FILTER (WHERE w.project_name IS NOT NULL)     OVER jw)[1] AS j_project_name,
  (array_agg(w.site_address)     FILTER (WHERE w.site_address IS NOT NULL)     OVER jw)[1] AS j_site_address,
  (array_agg(w.spec_package_ref) FILTER (WHERE w.spec_package_ref IS NOT NULL) OVER jw)[1] AS j_spec_package_ref,
  (array_agg(w.builder_name)     FILTER (WHERE w.builder_name IS NOT NULL)     OVER jw)[1] AS j_builder_name,
  NULL::date                                                                               AS j_target_delivery_date
FROM sw_report_walks w
WINDOW jw AS (PARTITION BY w.job_key ORDER BY w.last_synced_at DESC, w.walk_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING);

-- vw_SiteWalkWalkReadiness: one row per walk, the site walk lane
CREATE VIEW sw_report_walk_readiness AS
WITH w AS MATERIALIZED (
  SELECT * FROM sw_report_walk_jobs WHERE archived_at IS NULL
),
f AS MATERIALIZED (
  SELECT walk_id, count(*)::int AS n
    FROM sw_report_opening_findings
   WHERE finding_kind IN ('FINDING', 'MARK_CONFLICT')
   GROUP BY walk_id
)
SELECT
  w.walk_id,
  w.job_key,
  w.j_job_no                                              AS job_no,
  w.j_project_name                                        AS project_name,
  w.j_site_address                                        AS site_address,
  w.j_target_delivery_date                                AS target_delivery_date,
  COALESCE(w.j_builder_name, w.builder_contact_name_snapshot) AS builder_name,
  w.builder_contact_email_snapshot                        AS builder_email,
  w.walk_date,
  w.walked_by_name_snapshot,
  w.stage_code,
  w.opening_count, w.walked_count, w.ready_count, w.verify_count, w.modify_count,
  w.decision_count, w.open_count, w.held_count, w.blocker_count,
  w.is_deliverable,
  w.reviewed_at                                           AS signed_off_at,
  w.reviewed_by                                           AS signed_off_by,
  w.packet_sent_at,
  w.packet_sent_to,
  w.last_synced_at,
  w.access_route,
  w.access_state,
  w.access_tightest_in,
  (w.access_route IS NOT NULL AND w.access_state IS NOT NULL) AS access_recorded,
  (CASE WHEN w.opening_count > 0 THEN round(100.0 * w.walked_count / w.opening_count, 0) ELSE 0 END)::numeric(5,1) AS percent_walked,
  COALESCE(f.n, 0)                                        AS open_finding_count,
  ((now() AT TIME ZONE 'America/Chicago')::date - w.walk_date) AS days_since_walk,
  (w.j_target_delivery_date - (now() AT TIME ZONE 'America/Chicago')::date) AS days_to_delivery
FROM w
LEFT JOIN f ON f.walk_id = w.walk_id;

-- vw_SiteWalkOpenPunchList: every correction still outstanding (the Monday
-- morning list). Owner and severity are added so it can be cut by trade.
CREATE VIEW sw_report_open_punch_list AS
WITH w AS MATERIALIZED (
  SELECT * FROM sw_report_walk_jobs WHERE archived_at IS NULL
),
f AS MATERIALIZED (
  SELECT * FROM sw_report_opening_findings WHERE finding_kind IN ('FINDING', 'MARK_CONFLICT')
),
o AS MATERIALIZED (
  SELECT walk_id, opening_seq, area, location, brand, model_no, appliance_description, opening_status,
         install_basis_label_snapshot, spec_page_ref
    FROM sw_report_openings
)
SELECT
  f.client_opening_id,
  f.sort_order,
  f.finding_kind,
  f.label,
  f.detail,
  o.area,
  o.location,
  o.brand,
  o.model_no,
  o.appliance_description,
  o.opening_status,
  o.install_basis_label_snapshot,
  o.spec_page_ref,
  w.walk_id,
  w.walk_date,
  w.stage_code,
  w.packet_sent_at,
  w.job_key,
  w.j_job_no                                              AS job_no,
  w.j_project_name                                        AS project_name,
  w.j_target_delivery_date                                AS target_delivery_date,
  COALESCE(w.j_builder_name, w.builder_contact_name_snapshot) AS builder_name,
  w.builder_contact_email_snapshot                        AS builder_email,
  ((now() AT TIME ZONE 'America/Chicago')::date - w.walk_date) AS days_outstanding,
  f.owner_code,
  f.owner_group,
  f.severity,
  f.opening_seq,
  f.kind_rank
FROM f
JOIN w ON w.walk_id = f.walk_id
JOIN o ON o.walk_id = f.walk_id AND o.opening_seq = f.opening_seq;

-- vw_SiteWalkJobReadiness: one row per job, its most recent walk as the
-- current state. "Can we schedule the delivery?"
CREATE VIEW sw_report_job_readiness AS
WITH r AS MATERIALIZED (
  SELECT r.*,
         row_number() OVER (PARTITION BY r.job_key ORDER BY r.walk_date DESC NULLS LAST, w.first_synced_at DESC, r.walk_id DESC) AS rn,
         count(*) OVER (PARTITION BY r.job_key) AS job_walk_count,
         w.j_spec_package_ref,
         w.j_builder_name
    FROM sw_report_walk_readiness r
    JOIN sw_report_walk_jobs w ON w.walk_id = r.walk_id
)
SELECT
  r.job_key,
  r.job_no,
  r.project_name,
  r.site_address,
  r.target_delivery_date,
  r.j_spec_package_ref                                    AS spec_package_ref,
  r.j_builder_name                                        AS builder_name,      -- the job's builder; no contact-name fallback here (as in the standalone)
  r.walk_id                                               AS current_walk_id,
  r.walk_date                                             AS current_walk_date,
  r.stage_code                                            AS current_stage_code,
  r.opening_count,
  r.walked_count,
  r.ready_count,
  r.modify_count,
  r.decision_count,
  r.open_count,
  r.open_finding_count,
  r.is_deliverable,
  r.packet_sent_at,
  r.job_walk_count                                        AS walk_count,
  (r.open_finding_count = 0 AND r.is_deliverable)         AS clear_for_delivery
FROM r
WHERE r.rn = 1;

-- vw_SiteWalkBuilderScorecard: active sales health by builder.
-- first_pass_ready_rate is the number to watch: the share of first walks on a
-- job that needed nothing.
CREATE VIEW sw_report_builder_scorecard AS
WITH walks AS MATERIALIZED (
  SELECT w.walk_id, w.job_key, w.walk_date, w.is_deliverable, w.j_builder_name AS job_builder,
         row_number() OVER (PARTITION BY w.job_key ORDER BY w.walk_date ASC NULLS FIRST, w.first_synced_at ASC, w.walk_id ASC) AS first_rn
    FROM sw_report_walk_jobs w
   WHERE w.archived_at IS NULL
),
opening_stats AS MATERIALIZED (
  SELECT o.walk_id, count(*) AS openings,
         count(*) FILTER (WHERE o.opening_status = 'modify')   AS modify,
         count(*) FILTER (WHERE o.opening_status = 'decision') AS decision,
         count(*) FILTER (WHERE o.basis_conflict_better_fit IS NOT NULL) AS basis_conflicts
    FROM sw_report_openings o GROUP BY o.walk_id
),
utility_stats AS MATERIALIZED (
  SELECT u.walk_id,
         count(*) FILTER (WHERE u.field_answer = 'missing')   AS utilities_missing,
         count(*) FILTER (WHERE u.field_answer = 'misplaced') AS utilities_misplaced,
         count(*) FILTER (WHERE u.field_answer = 'roughed')   AS utilities_roughed_in
    FROM sw_report_opening_utilities u GROUP BY u.walk_id
),
panel_stats AS MATERIALIZED (
  SELECT p.walk_id, count(*) FILTER (WHERE p.supplied_by = 'custom' AND p.on_site_state = 'absent') AS custom_panels_absent
    FROM sw_report_opening_panels p GROUP BY p.walk_id
),
blockage_stats AS MATERIALIZED (
  SELECT b.walk_id, count(*) FILTER (WHERE b.obstruction_state = 'holds') AS obstructions_holding
    FROM sw_report_opening_obstructions b GROUP BY b.walk_id
),
waiver_stats AS MATERIALIZED (
  -- how often Wilson absorbs a miss rather than asking for a fix
  SELECT d.walk_id, count(*) FILTER (WHERE d.accepted_reason IS NOT NULL) AS dimensions_waived
    FROM sw_report_opening_dimensions d GROUP BY d.walk_id
)
SELECT
  COALESCE(w.job_builder, '(builder not recorded)')       AS builder_name,
  count(DISTINCT w.job_key)                               AS job_count,
  count(DISTINCT w.walk_id)                               AS walk_count,
  sum(COALESCE(os.openings, 0))::int                      AS openings_walked,
  sum(COALESCE(os.modify, 0) + COALESCE(os.decision, 0))::int AS openings_needing_work,
  sum(COALESCE(us.utilities_missing, 0))::int             AS utilities_missing,
  sum(COALESCE(us.utilities_misplaced, 0))::int           AS utilities_misplaced,
  sum(COALESCE(us.utilities_roughed_in, 0))::int          AS utilities_roughed_in,
  sum(COALESCE(ps.custom_panels_absent, 0))::int          AS custom_panels_absent,
  sum(COALESCE(os.basis_conflicts, 0))::int               AS basis_conflicts,
  sum(COALESCE(bs.obstructions_holding, 0))::int          AS obstructions_holding_units_off,
  sum(COALESCE(ws.dimensions_waived, 0))::int             AS dimensions_waived_by_wilson,
  (CASE WHEN sum(COALESCE(os.openings, 0)) > 0
        THEN round(1.0 * sum(COALESCE(os.modify, 0) + COALESCE(os.decision, 0)) / sum(COALESCE(os.openings, 0)), 3)
        ELSE 0 END)::numeric(6,3)                         AS corrections_per_opening,
  count(*) FILTER (WHERE w.first_rn = 1)::int             AS first_walks,
  count(*) FILTER (WHERE w.first_rn = 1 AND w.is_deliverable)::int AS first_walks_clear,
  (CASE WHEN count(*) FILTER (WHERE w.first_rn = 1) > 0
        THEN round(100.0 * count(*) FILTER (WHERE w.first_rn = 1 AND w.is_deliverable) / count(*) FILTER (WHERE w.first_rn = 1), 1)
   END)::numeric(5,1)                                     AS first_pass_ready_rate,
  max(w.walk_date)                                        AS last_walk_date
FROM walks w
LEFT JOIN opening_stats os  ON os.walk_id = w.walk_id
LEFT JOIN utility_stats us  ON us.walk_id = w.walk_id
LEFT JOIN panel_stats ps    ON ps.walk_id = w.walk_id
LEFT JOIN blockage_stats bs ON bs.walk_id = w.walk_id
LEFT JOIN waiver_stats ws   ON ws.walk_id = w.walk_id
GROUP BY COALESCE(w.job_builder, '(builder not recorded)');

-- vw_SiteWalkSpecVerification, for Agility: every model + install type the
-- walks stand on, how many walks and openings use it, and whether anybody has
-- confirmed its numbers against a sheet - on a walk (the opening's own stamp,
-- what its packet printed) or in the shared spec library. Work down the
-- unconfirmed rows by walks_affected.
CREATE VIEW sw_report_spec_verification AS
WITH o AS (
  SELECT o.*, sw_report_model_key(o.model_no) AS model_key
    FROM sw_report_openings o JOIN sw_walks w ON w.walk_id = o.walk_id
   WHERE w.archived_at IS NULL AND o.model_no IS NOT NULL
),
grouped AS (
  SELECT
    o.model_key,
    o.install_basis_code,
    (array_agg(o.brand ORDER BY o.walk_id, o.opening_seq) FILTER (WHERE o.brand IS NOT NULL))[1]  AS brand,
    (array_agg(o.model_no ORDER BY o.walk_id, o.opening_seq))[1]                                    AS model_no,
    (array_agg(o.install_basis_label_snapshot ORDER BY o.walk_id, o.opening_seq) FILTER (WHERE o.install_basis_label_snapshot IS NOT NULL))[1] AS variation_label,
    (array_agg(o.spec_page_ref ORDER BY o.walk_id, o.opening_seq) FILTER (WHERE o.spec_page_ref IS NOT NULL))[1] AS spec_page_ref,
    count(DISTINCT o.walk_id)                                                                       AS walks_affected,
    count(*)                                                                                        AS openings_affected,
    count(*) FILTER (WHERE o.dims_verified_by IS NOT NULL)                                          AS openings_confirmed,
    (array_agg(o.dims_verified_by ORDER BY o.dims_verified_at DESC NULLS LAST) FILTER (WHERE o.dims_verified_by IS NOT NULL))[1] AS last_confirmed_on_walk_by,
    max(o.dims_verified_at)                                                                         AS last_confirmed_on_walk_at
  FROM o
  GROUP BY o.model_key, o.install_basis_code
)
SELECT
  g.brand,
  g.model_no,
  g.model_key,
  g.install_basis_code                                    AS variation_code,
  g.variation_label,
  g.spec_page_ref,
  g.walks_affected,
  g.openings_affected,
  g.openings_confirmed,
  g.last_confirmed_on_walk_by,
  g.last_confirmed_on_walk_at,
  NULLIF(lib.doc ->> 'confirmedBy', '')                   AS library_confirmed_by,
  sw_report_stamp(lib.doc -> 'confirmedAt')               AS library_confirmed_at,
  NULLIF(lib.doc ->> 'confirmedSheetDate', '')            AS library_sheet_date,
  (g.openings_confirmed = 0 AND NULLIF(lib.doc ->> 'confirmedBy', '') IS NULL) AS needs_verification
FROM grouped g
LEFT JOIN sw_spec_library lib
  ON lib.kind = 'dims' AND lib.deleted_at IS NULL
 AND lib.lib_key = g.model_key || '|' || COALESCE(g.install_basis_code, '-');
