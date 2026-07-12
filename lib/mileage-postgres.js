import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Mileage reimbursement (replaces the monthly Excel worksheet).
//
// Model (mirrors the worksheet):
//   - One report per employee per month (mileage_reports), carrying the
//     employee's standard round-trip commute (snapshotted from the employee
//     directory when the report is created; editable only by reviewers).
//   - Daily entries (mileage_entries): date, showroom-start Y/N, purpose,
//     miles. Reimbursed miles are COMPUTED, never stored per entry:
//       showroom_start ? miles : max(miles - commute, 0)
//   - Per-year rates (mileage_rates), executive-managed. Approval snapshots
//     the rate onto the report (rate_used) so later rate edits never change
//     an approved month.
//
// Status flow: draft -> submitted -> approved | denied
//   denied behaves like draft for the employee (edit + resubmit), keeping
//   the reviewer's denial note visible.
// ---------------------------------------------------------------------------

const MILEAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mileage_rates (
  year INT PRIMARY KEY,
  rate NUMERIC(6,3) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS mileage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  commute_miles NUMERIC(7,1) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','denied')),
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES app_users(id),
  denial_note TEXT NOT NULL DEFAULT '',
  rate_used NUMERIC(6,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_mileage_reports_status ON mileage_reports (status);
CREATE INDEX IF NOT EXISTS idx_mileage_reports_user ON mileage_reports (user_id);

CREATE TABLE IF NOT EXISTS mileage_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES mileage_reports(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  showroom_start BOOLEAN NOT NULL DEFAULT TRUE,
  purpose TEXT NOT NULL DEFAULT '',
  miles NUMERIC(7,1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mileage_entries_report ON mileage_entries (report_id);
`;

// Seeded only when the rates table is empty (values from the worksheet).
const SEED_RATES = [
  [2025, 0.67],
  [2026, 0.725]
];

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(MILEAGE_SCHEMA_SQL);
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM mileage_rates`);
      if (!rows[0].count) {
        for (const [year, rate] of SEED_RATES) {
          await pool.query(
            `INSERT INTO mileage_rates (year, rate) VALUES ($1, $2) ON CONFLICT (year) DO NOTHING`,
            [year, rate]
          );
        }
      }
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  await ensurePromise;
  return pool;
}

// ---------------------------------------------------------------------------
// Computation — single source of truth for the worksheet formula.
// ---------------------------------------------------------------------------

export function computeReimbursedMiles(entry, commuteMiles) {
  const miles = Number(entry.miles) || 0;
  if (entry.showroomStart) return miles;
  return Math.max(miles - (Number(commuteMiles) || 0), 0);
}

export function computeReportTotals(report) {
  const totalMiles = report.entries.reduce((sum, e) => sum + (Number(e.miles) || 0), 0);
  const reimbursedMiles = report.entries.reduce(
    (sum, e) => sum + computeReimbursedMiles(e, report.commuteMiles),
    0
  );
  const rate = report.rateUsed != null ? Number(report.rateUsed) : (report.currentRate != null ? Number(report.currentRate) : null);
  return {
    totalMiles: Math.round(totalMiles * 10) / 10,
    reimbursedMiles: Math.round(reimbursedMiles * 10) / 10,
    rate,
    reimbursementTotal: rate != null ? Math.round(reimbursedMiles * rate * 100) / 100 : null
  };
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export async function listMileageRates() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT year, rate FROM mileage_rates ORDER BY year DESC`);
  return result.rows.map((row) => ({ year: row.year, rate: Number(row.rate) }));
}

export async function getMileageRateForYear(year) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT rate FROM mileage_rates WHERE year = $1`, [year]);
  return result.rows[0] ? Number(result.rows[0].rate) : null;
}

export async function upsertMileageRate(year, rate, actorUserId = null) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO mileage_rates (year, rate, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (year) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW(), updated_by = EXCLUDED.updated_by
     RETURNING year, rate`,
    [year, rate, actorUserId]
  );
  return { year: result.rows[0].year, rate: Number(result.rows[0].rate) };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function mapReportRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    year: row.year,
    month: row.month,
    commuteMiles: Number(row.commute_miles) || 0,
    status: row.status,
    submittedAt: row.submitted_at?.toISOString?.() || row.submitted_at || null,
    decidedAt: row.decided_at?.toISOString?.() || row.decided_at || null,
    decidedBy: row.decided_by || null,
    denialNote: row.denial_note || "",
    rateUsed: row.rate_used != null ? Number(row.rate_used) : null,
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    employeeName: row.employee_name || undefined,
    employeeEmail: row.employee_email || undefined,
    decidedByEmail: row.decided_by_email || undefined
  };
}

function mapEntryRow(row) {
  const date = row.entry_date;
  const dateText =
    typeof date === "string"
      ? date.slice(0, 10)
      : date?.toISOString?.().slice(0, 10) || "";
  return {
    id: row.id,
    entryDate: dateText,
    showroomStart: Boolean(row.showroom_start),
    purpose: row.purpose || "",
    miles: Number(row.miles) || 0,
    sortOrder: row.sort_order || 0
  };
}

async function loadEntries(pool, reportId) {
  const result = await pool.query(
    `SELECT * FROM mileage_entries WHERE report_id = $1 ORDER BY entry_date ASC, sort_order ASC`,
    [reportId]
  );
  return result.rows.map(mapEntryRow);
}

export async function getMileageReportById(reportId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT r.*, u.display_name AS employee_name, u.email AS employee_email,
            d.email AS decided_by_email
     FROM mileage_reports r
     JOIN app_users u ON u.id = r.user_id
     LEFT JOIN app_users d ON d.id = r.decided_by
     WHERE r.id = $1`,
    [reportId]
  );
  if (!result.rows[0]) return null;
  const report = mapReportRow(result.rows[0]);
  report.entries = await loadEntries(pool, report.id);
  return report;
}

export async function getOrCreateMileageReport(userId, year, month, defaultCommuteMiles) {
  const pool = await getReadyPool();

  const existing = await pool.query(
    `SELECT r.*, u.display_name AS employee_name, u.email AS employee_email
     FROM mileage_reports r JOIN app_users u ON u.id = r.user_id
     WHERE r.user_id = $1 AND r.year = $2 AND r.month = $3`,
    [userId, year, month]
  );

  let row = existing.rows[0];

  if (!row) {
    const inserted = await pool.query(
      `INSERT INTO mileage_reports (user_id, year, month, commute_miles)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, year, month) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId, year, month, Number(defaultCommuteMiles) || 0]
    );
    row = inserted.rows[0];
    const withUser = await pool.query(
      `SELECT r.*, u.display_name AS employee_name, u.email AS employee_email
       FROM mileage_reports r JOIN app_users u ON u.id = r.user_id WHERE r.id = $1`,
      [row.id]
    );
    row = withUser.rows[0];
  }

  const report = mapReportRow(row);
  report.entries = await loadEntries(pool, report.id);
  return report;
}

export async function listMileageReportsForUser(userId, year = null) {
  const pool = await getReadyPool();
  const params = [userId];
  let where = `r.user_id = $1`;
  if (year) {
    params.push(year);
    where += ` AND r.year = $2`;
  }
  const result = await pool.query(
    `SELECT r.*, u.display_name AS employee_name, u.email AS employee_email
     FROM mileage_reports r JOIN app_users u ON u.id = r.user_id
     WHERE ${where}
     ORDER BY r.year DESC, r.month DESC`,
    params
  );
  return result.rows.map(mapReportRow);
}

export async function listMileageReportsForReview({ status = "", year = null, month = null } = {}) {
  const pool = await getReadyPool();
  const params = [];
  const where = [];

  if (status) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  if (year) {
    params.push(year);
    where.push(`r.year = $${params.length}`);
  }
  if (month) {
    params.push(month);
    where.push(`r.month = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT r.*, u.display_name AS employee_name, u.email AS employee_email,
            d.email AS decided_by_email
     FROM mileage_reports r
     JOIN app_users u ON u.id = r.user_id
     LEFT JOIN app_users d ON d.id = r.decided_by
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY r.year DESC, r.month DESC, u.display_name ASC
     LIMIT 500`,
    params
  );

  const reports = result.rows.map(mapReportRow);
  for (const report of reports) {
    report.entries = await loadEntries(pool, report.id);
  }
  return reports;
}

// Replace a report's entries wholesale (the save model the grid UI uses).
// Optionally updates commute_miles (reviewer edits only — enforced by caller).
export async function saveMileageEntries(reportId, entries, { commuteMiles = null } = {}) {
  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (commuteMiles != null) {
      await client.query(
        `UPDATE mileage_reports SET commute_miles = $2, updated_at = NOW() WHERE id = $1`,
        [reportId, Number(commuteMiles) || 0]
      );
    } else {
      await client.query(`UPDATE mileage_reports SET updated_at = NOW() WHERE id = $1`, [reportId]);
    }

    await client.query(`DELETE FROM mileage_entries WHERE report_id = $1`, [reportId]);

    let order = 0;
    for (const entry of entries) {
      await client.query(
        `INSERT INTO mileage_entries (report_id, entry_date, showroom_start, purpose, miles, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          reportId,
          entry.entryDate,
          Boolean(entry.showroomStart),
          String(entry.purpose || "").trim().slice(0, 200),
          Number(entry.miles) || 0,
          order++
        ]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getMileageReportById(reportId);
}

export async function setMileageReportStatus(reportId, { status, deciderId = null, denialNote = "", rateUsed = null }) {
  const pool = await getReadyPool();

  const sets = [`status = $2`, `updated_at = NOW()`];
  const params = [reportId, status];

  if (status === "submitted") {
    sets.push(`submitted_at = NOW()`, `decided_at = NULL`, `decided_by = NULL`, `denial_note = ''`, `rate_used = NULL`);
  }
  if (status === "approved" || status === "denied") {
    params.push(deciderId);
    sets.push(`decided_at = NOW()`, `decided_by = $${params.length}`);
    params.push(String(denialNote || ""));
    sets.push(`denial_note = $${params.length}`);
    if (status === "approved") {
      params.push(rateUsed);
      sets.push(`rate_used = $${params.length}`);
    }
  }

  await pool.query(`UPDATE mileage_reports SET ${sets.join(", ")} WHERE id = $1`, params);
  return getMileageReportById(reportId);
}
