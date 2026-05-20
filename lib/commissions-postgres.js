import { getPostgresPool } from "./data-postgres.js";

const COMMISSION_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS commission_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_label TEXT NOT NULL,
  source_file_name TEXT NOT NULL DEFAULT '',
  imported_by_username TEXT NOT NULL DEFAULT '',
  imported_by_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  CONSTRAINT commission_runs_status_check CHECK (
    status IN ('draft', 'locked', 'final_paid')
  )
);

CREATE INDEX IF NOT EXISTS idx_commission_runs_status ON commission_runs (status);
CREATE INDEX IF NOT EXISTS idx_commission_runs_created_at ON commission_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_runs_locked_at ON commission_runs (locked_at DESC);

CREATE TABLE IF NOT EXISTS commission_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES commission_runs(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL DEFAULT 0,
  display_sort INTEGER NOT NULL DEFAULT 0,
  salesperson_code TEXT NOT NULL DEFAULT '',
  salesperson_name TEXT NOT NULL DEFAULT '',
  salesperson_email TEXT NOT NULL DEFAULT '',
  salesperson_department TEXT NOT NULL DEFAULT '',
  sales_order TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  line_type TEXT NOT NULL DEFAULT '',
  product_model TEXT NOT NULL DEFAULT '',
  source_classification TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  imported_commission_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  imported_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_lines_run_id ON commission_lines (run_id);
CREATE INDEX IF NOT EXISTS idx_commission_lines_salesperson_code ON commission_lines (salesperson_code);
CREATE INDEX IF NOT EXISTS idx_commission_lines_sales_order ON commission_lines (sales_order);
CREATE INDEX IF NOT EXISTS idx_commission_lines_display_sort ON commission_lines (run_id, display_sort);

CREATE TABLE IF NOT EXISTS commission_salesperson_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES commission_runs(id) ON DELETE CASCADE,
  salesperson_key TEXT NOT NULL,
  salesperson_code TEXT NOT NULL DEFAULT '',
  salesperson_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  CONSTRAINT commission_salesperson_statuses_status_check CHECK (
    status IN ('draft', 'locked', 'final_paid')
  ),
  CONSTRAINT commission_salesperson_statuses_run_key_unique UNIQUE (run_id, salesperson_key)
);

CREATE INDEX IF NOT EXISTS idx_commission_salesperson_statuses_run_id
  ON commission_salesperson_statuses (run_id);
CREATE INDEX IF NOT EXISTS idx_commission_salesperson_statuses_status
  ON commission_salesperson_statuses (status);

CREATE TABLE IF NOT EXISTS commission_salesperson_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES commission_runs(id) ON DELETE CASCADE,
  salesperson_key TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commission_salesperson_adjustments_type_check CHECK (
    adjustment_type IN ('BONUS', 'DEDUCT', 'ADVANCE', 'MISC')
  ),
  CONSTRAINT commission_salesperson_adjustments_run_key_type_unique UNIQUE (run_id, salesperson_key, adjustment_type)
);

CREATE INDEX IF NOT EXISTS idx_commission_salesperson_adjustments_run_id
  ON commission_salesperson_adjustments (run_id);
`;

let schemaReadyPromise = null;
const ADJUSTMENT_TYPES = ["BONUS", "DEDUCT", "ADVANCE", "MISC"];

function roundTo(number, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(number) || 0) * factor) / factor;
}

function toText(value) {
  return String(value || "").trim();
}

function toNumber(value, decimals = 2) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return roundTo(numeric, decimals);
}

function getSalespersonKey(value) {
  const code = toText(value?.salespersonCode);
  const name = toText(value?.salespersonName);
  return code || name || "UNKNOWN";
}

function serializeRun(row) {
  return {
    id: row.id,
    periodLabel: row.period_label || "",
    sourceFileName: row.source_file_name || "",
    importedByUsername: row.imported_by_username || "",
    importedByName: row.imported_by_name || "",
    status: row.status || "draft",
    createdAt: row.created_at?.toISOString?.() || row.created_at || "",
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || "",
    lockedAt: row.locked_at?.toISOString?.() || row.locked_at || "",
    finalizedAt: row.finalized_at?.toISOString?.() || row.finalized_at || "",
    notes: row.notes || ""
  };
}

function serializeLine(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sourceRowNumber: Number(row.source_row_number || 0),
    displaySort: Number(row.display_sort || 0),
    salespersonCode: row.salesperson_code || "",
    salespersonName: row.salesperson_name || "",
    salespersonEmail: row.salesperson_email || "",
    salespersonDepartment: row.salesperson_department || "",
    salesOrder: row.sales_order || "",
    customerName: row.customer_name || "",
    lineType: row.line_type || "",
    productModel: row.product_model || "",
    sourceClassification: row.source_classification || "",
    quantity: toNumber(row.quantity, 2),
    sellPrice: toNumber(row.sell_price, 2),
    importedCommissionPercent: toNumber(row.imported_commission_percent, 4),
    importedCommissionAmount: toNumber(row.imported_commission_amount, 2),
    commissionPercent: toNumber(row.commission_percent, 4),
    commissionAmount: toNumber(row.commission_amount, 2),
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || ""
  };
}

function serializeSalespersonStatus(row) {
  return {
    id: row.id,
    runId: row.run_id,
    salespersonKey: row.salesperson_key || "",
    salespersonCode: row.salesperson_code || "",
    salespersonName: row.salesperson_name || "",
    status: row.status || "draft",
    createdAt: row.created_at?.toISOString?.() || row.created_at || "",
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || "",
    lockedAt: row.locked_at?.toISOString?.() || row.locked_at || "",
    finalizedAt: row.finalized_at?.toISOString?.() || row.finalized_at || ""
  };
}

function serializeSalespersonAdjustment(row) {
  return {
    id: row.id,
    runId: row.run_id,
    salespersonKey: row.salesperson_key || "",
    adjustmentType: row.adjustment_type || "",
    amount: toNumber(row.amount, 2),
    comment: row.comment || "",
    createdAt: row.created_at?.toISOString?.() || row.created_at || "",
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || ""
  };
}

function isWarrantyLine(line) {
  const type = toText(line?.lineType).toLowerCase();
  return type === "wty" || type === "warranty" || type === "protect";
}

function isOmittedLine(line) {
  return toText(line?.sourceClassification).toUpperCase() === "OMIT";
}

function isUnpaidLine(line) {
  return toText(line?.sourceClassification).toUpperCase() === "UNPAID";
}

function isExcludedFromPayout(line) {
  return isOmittedLine(line) || isUnpaidLine(line);
}

function getWarrantyPayoutTier(penetrationPercent) {
  if (penetrationPercent >= 5) {
    return 15;
  }
  if (penetrationPercent >= 1) {
    return 10;
  }
  return 5;
}

function getAdjustmentSignedAmount(adjustment) {
  const amount = toNumber(adjustment?.amount, 2);
  const type = toText(adjustment?.adjustmentType).toUpperCase();
  return ["DEDUCT", "ADVANCE"].includes(type) ? -Math.abs(amount) : Math.abs(amount);
}

function buildDefaultAdjustments(salespersonKey, runId, rawAdjustments = []) {
  const byType = new Map(
    rawAdjustments.map((adjustment) => {
      const serialized = serializeSalespersonAdjustment(adjustment);
      return [serialized.adjustmentType, serialized];
    })
  );

  return ADJUSTMENT_TYPES.map((adjustmentType) => {
    const existing = byType.get(adjustmentType);
    return existing || {
      id: "",
      runId,
      salespersonKey,
      adjustmentType,
      amount: 0,
      comment: "",
      createdAt: "",
      updatedAt: ""
    };
  });
}

function calculateExcludedCommissionAmount(line, warrantyPayoutPercent) {
  if (isWarrantyLine(line)) {
    return roundTo(Number(line?.sellPrice || 0) * (Number(warrantyPayoutPercent || 0) / 100), 2);
  }
  return toNumber(line?.commissionAmount, 2);
}

function buildSalespersonGroups(lines, salespersonStatuses = [], salespersonAdjustments = [], runId = "") {
  const byRep = new Map();
  const statusByKey = new Map(
    salespersonStatuses.map((row) => {
      const serialized = serializeSalespersonStatus(row);
      return [serialized.salespersonKey, serialized];
    })
  );
  const adjustmentsByKey = new Map();
  for (const row of salespersonAdjustments) {
    const serialized = serializeSalespersonAdjustment(row);
    if (!adjustmentsByKey.has(serialized.salespersonKey)) {
      adjustmentsByKey.set(serialized.salespersonKey, []);
    }
    adjustmentsByKey.get(serialized.salespersonKey).push(serialized);
  }

  for (const line of lines) {
    const key = getSalespersonKey(line);
    if (!byRep.has(key)) {
      const existingStatus = statusByKey.get(key) || null;
      const adjustmentSet = buildDefaultAdjustments(key, runId, adjustmentsByKey.get(key) || []);
      byRep.set(key, {
        salespersonKey: key,
        salespersonCode: line.salespersonCode,
        salespersonName: line.salespersonName,
        salespersonEmail: line.salespersonEmail,
        salespersonDepartment: line.salespersonDepartment,
        statusId: existingStatus?.id || "",
        status: existingStatus?.status || "draft",
        lockedAt: existingStatus?.lockedAt || "",
        finalizedAt: existingStatus?.finalizedAt || "",
        lineCount: 0,
        orderCount: 0,
        omittedLineCount: 0,
        unpaidLineCount: 0,
        totalSellPrice: 0,
        totalCommissionAmount: 0,
        applianceSalesRevenue: 0,
        warrantySellPrice: 0,
        adjustments: adjustmentSet,
        adjustmentNetAmount: 0,
        excludedCommissionAmount: 0,
        salesOrders: new Map(),
        lines: []
      });
    }

    const group = byRep.get(key);
    group.lines.push(line);
    if (isOmittedLine(line)) {
      group.omittedLineCount += 1;
    } else if (isUnpaidLine(line)) {
      group.unpaidLineCount += 1;
      group.lineCount += 1;
    } else {
      group.lineCount += 1;
      group.totalSellPrice = roundTo(group.totalSellPrice + line.sellPrice, 2);
      group.totalCommissionAmount = roundTo(group.totalCommissionAmount + line.commissionAmount, 2);

      if (isWarrantyLine(line)) {
        group.warrantySellPrice = roundTo(group.warrantySellPrice + line.sellPrice, 2);
      } else {
        group.applianceSalesRevenue = roundTo(group.applianceSalesRevenue + line.sellPrice, 2);
      }
    }

    const orderKey = line.salesOrder || `ROW-${line.displaySort}`;
    if (!isOmittedLine(line)) {
      if (!group.salesOrders.has(orderKey)) {
        group.salesOrders.set(orderKey, {
          salesOrder: line.salesOrder,
          customerName: line.customerName,
          lineCount: 0,
          totalSellPrice: 0,
          totalCommissionAmount: 0
        });
      }

      const order = group.salesOrders.get(orderKey);
      order.lineCount += 1;
      if (!isUnpaidLine(line)) {
        order.totalSellPrice = roundTo(order.totalSellPrice + line.sellPrice, 2);
        order.totalCommissionAmount = roundTo(order.totalCommissionAmount + line.commissionAmount, 2);
      }
    }
  }

  return Array.from(byRep.values())
    .map((group) => ({
      warrantyPenetrationPercent: group.applianceSalesRevenue > 0
        ? roundTo((group.warrantySellPrice / group.applianceSalesRevenue) * 100, 4)
        : 0,
      warrantyPayoutPercent: String(group.salespersonDepartment || "").trim().toLowerCase() === "appliance"
        ? getWarrantyPayoutTier(
            group.applianceSalesRevenue > 0
              ? roundTo((group.warrantySellPrice / group.applianceSalesRevenue) * 100, 4)
              : 0
          )
        : 0,
      salespersonCode: group.salespersonCode,
      salespersonName: group.salespersonName,
      salespersonEmail: group.salespersonEmail,
      salespersonDepartment: group.salespersonDepartment,
      salespersonKey: group.salespersonKey,
      statusId: group.statusId,
      status: group.status,
      lockedAt: group.lockedAt,
      finalizedAt: group.finalizedAt,
      lineCount: group.lineCount,
      orderCount: group.salesOrders.size,
      omittedLineCount: group.omittedLineCount,
      unpaidLineCount: group.unpaidLineCount,
      totalSellPrice: group.totalSellPrice,
      totalCommissionAmount: group.totalCommissionAmount,
      applianceSalesRevenue: group.applianceSalesRevenue,
      warrantySellPrice: group.warrantySellPrice,
      warrantyPayoutAmount: 0,
      excludedCommissionAmount: 0,
      adjustments: group.adjustments,
      adjustmentNetAmount: 0,
      salesOrders: Array.from(group.salesOrders.values()).sort((a, b) =>
        String(a.salesOrder || "").localeCompare(String(b.salesOrder || ""))
      ),
      lines: group.lines
    }))
    .map((group) => ({
      ...group,
      warrantyPayoutAmount: group.warrantyPayoutPercent > 0
        ? roundTo(group.warrantySellPrice * (group.warrantyPayoutPercent / 100), 2)
        : 0
    }))
    .map((group) => ({
      ...group,
      excludedCommissionAmount: roundTo(
        group.lines.reduce((sum, line) => {
          if (!isUnpaidLine(line)) {
            return sum;
          }
          return sum + calculateExcludedCommissionAmount(line, group.warrantyPayoutPercent);
        }, 0),
        2
      ),
      adjustmentNetAmount: roundTo(
        (group.adjustments || []).reduce((sum, adjustment) => sum + getAdjustmentSignedAmount(adjustment), 0),
        2
      )
    }))
    .map((group) => ({
      ...group,
      totalPayoutAmount: roundTo(
        Number(group.totalCommissionAmount || 0) +
        Number(group.warrantyPayoutAmount || 0) +
        Number(group.adjustmentNetAmount || 0),
        2
      )
    }))
    .sort((a, b) => String(a.salespersonName || a.salespersonCode).localeCompare(String(b.salespersonName || b.salespersonCode)));
}

function buildStatusCounts(salespeople) {
  return salespeople.reduce((summary, group) => {
    const status = group.status || "draft";
    if (status === "final_paid") {
      summary.finalPaidCount += 1;
    } else if (status === "locked") {
      summary.lockedCount += 1;
    } else {
      summary.draftCount += 1;
    }
    return summary;
  }, {
    draftCount: 0,
    lockedCount: 0,
    finalPaidCount: 0
  });
}

function deriveRunStatus(statusCounts, salespersonCount) {
  if (!salespersonCount) {
    return "draft";
  }
  if (statusCounts.finalPaidCount === salespersonCount) {
    return "final_paid";
  }
  if (statusCounts.lockedCount > 0 || statusCounts.finalPaidCount > 0) {
    return "locked";
  }
  return "draft";
}

function buildRunDetail(runRow, lineRows, salespersonStatusRows = [], salespersonAdjustmentRows = []) {
  const run = serializeRun(runRow);
  const lines = lineRows.map(serializeLine);
  const salespeople = buildSalespersonGroups(lines, salespersonStatusRows, salespersonAdjustmentRows, run.id);
  const statusCounts = buildStatusCounts(salespeople);
  run.status = deriveRunStatus(statusCounts, salespeople.length);

  return {
    run,
    summary: {
      salespersonCount: salespeople.length,
      draftCount: statusCounts.draftCount,
      lockedCount: statusCounts.lockedCount,
      finalPaidCount: statusCounts.finalPaidCount,
      lineCount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.lineCount || 0), 0), 0),
      omittedLineCount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.omittedLineCount || 0), 0), 0),
      unpaidLineCount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.unpaidLineCount || 0), 0), 0),
      totalSellPrice: roundTo(salespeople.reduce((sum, group) => sum + Number(group.totalSellPrice || 0), 0), 2),
      totalCommissionAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.totalCommissionAmount || 0), 0), 2),
      totalProtectPayoutAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.warrantyPayoutAmount || 0), 0), 2),
      totalAdjustmentNetAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.adjustmentNetAmount || 0), 0), 2),
      totalExcludedCommissionAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.excludedCommissionAmount || 0), 0), 2),
      totalPayoutAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.totalPayoutAmount || 0), 0), 2)
    },
    salespeople
  };
}

export async function ensureCommissionTables() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const pool = await getPostgresPool();
      await pool.query(COMMISSION_SCHEMA_SQL);
      await pool.query(`
        INSERT INTO commission_salesperson_statuses (
          run_id,
          salesperson_key,
          salesperson_code,
          salesperson_name,
          status,
          locked_at,
          finalized_at
        )
        SELECT DISTINCT
          l.run_id,
          COALESCE(NULLIF(BTRIM(l.salesperson_code), ''), NULLIF(BTRIM(l.salesperson_name), ''), 'UNKNOWN') AS salesperson_key,
          COALESCE(l.salesperson_code, '') AS salesperson_code,
          COALESCE(l.salesperson_name, '') AS salesperson_name,
          CASE
            WHEN r.status = 'final_paid' THEN 'final_paid'
            WHEN r.status = 'locked' THEN 'locked'
            ELSE 'draft'
          END AS status,
          r.locked_at,
          r.finalized_at
        FROM commission_lines l
        JOIN commission_runs r ON r.id = l.run_id
        LEFT JOIN commission_salesperson_statuses s
          ON s.run_id = l.run_id
         AND s.salesperson_key = COALESCE(NULLIF(BTRIM(l.salesperson_code), ''), NULLIF(BTRIM(l.salesperson_name), ''), 'UNKNOWN')
        WHERE s.id IS NULL
      `);
    })();
  }

  return schemaReadyPromise;
}

export async function finalizeExpiredCommissionRuns() {
  await ensureCommissionTables();
  const pool = await getPostgresPool();

  await pool.query(`
    UPDATE commission_salesperson_statuses
    SET status = 'final_paid',
        finalized_at = NOW(),
        updated_at = NOW()
    WHERE status = 'locked'
      AND locked_at IS NOT NULL
      AND locked_at <= NOW() - INTERVAL '48 hours'
  `);
}

export async function listCommissionRuns() {
  await finalizeExpiredCommissionRuns();
  const pool = await getPostgresPool();
  const runsResult = await pool.query(`
    SELECT
      r.*
    FROM commission_runs r
    ORDER BY r.created_at DESC
  `);

  if (runsResult.rowCount === 0) {
    return [];
  }

  const runIds = runsResult.rows.map((row) => row.id);
  const linesResult = await pool.query(`
    SELECT *
    FROM commission_lines
    WHERE run_id = ANY($1::uuid[])
    ORDER BY run_id ASC, display_sort ASC, source_row_number ASC, id ASC
  `, [runIds]);
  const statusesResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_statuses
    WHERE run_id = ANY($1::uuid[])
    ORDER BY salesperson_name ASC, salesperson_code ASC
  `, [runIds]);
  const adjustmentsResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_adjustments
    WHERE run_id = ANY($1::uuid[])
    ORDER BY adjustment_type ASC
  `, [runIds]);

  const linesByRunId = new Map();
  for (const row of linesResult.rows) {
    const key = row.run_id;
    if (!linesByRunId.has(key)) {
      linesByRunId.set(key, []);
    }
    linesByRunId.get(key).push(row);
  }
  const statusesByRunId = new Map();
  for (const row of statusesResult.rows) {
    const key = row.run_id;
    if (!statusesByRunId.has(key)) {
      statusesByRunId.set(key, []);
    }
    statusesByRunId.get(key).push(row);
  }
  const adjustmentsByRunId = new Map();
  for (const row of adjustmentsResult.rows) {
    const key = row.run_id;
    if (!adjustmentsByRunId.has(key)) {
      adjustmentsByRunId.set(key, []);
    }
    adjustmentsByRunId.get(key).push(row);
  }

  return runsResult.rows.map((row) => {
    const detail = buildRunDetail(
      row,
      linesByRunId.get(row.id) || [],
      statusesByRunId.get(row.id) || [],
      adjustmentsByRunId.get(row.id) || []
    );
    return {
      ...detail.run,
      lineCount: Number(detail.summary.lineCount || 0),
      omittedLineCount: Number(detail.summary.omittedLineCount || 0),
      unpaidLineCount: Number(detail.summary.unpaidLineCount || 0),
      salespersonCount: Number(detail.summary.salespersonCount || 0),
      draftCount: Number(detail.summary.draftCount || 0),
      lockedCount: Number(detail.summary.lockedCount || 0),
      finalPaidCount: Number(detail.summary.finalPaidCount || 0),
      totalSellPrice: toNumber(detail.summary.totalSellPrice, 2),
      totalCommissionAmount: toNumber(detail.summary.totalCommissionAmount, 2),
      totalProtectPayoutAmount: toNumber(detail.summary.totalProtectPayoutAmount, 2),
      totalAdjustmentNetAmount: toNumber(detail.summary.totalAdjustmentNetAmount, 2),
      totalExcludedCommissionAmount: toNumber(detail.summary.totalExcludedCommissionAmount, 2),
      totalPayoutAmount: toNumber(detail.summary.totalPayoutAmount, 2)
    };
  });
}

export async function createCommissionRun({ periodLabel, sourceFileName, importedByUsername, importedByName, lines }) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const runResult = await client.query(`
      INSERT INTO commission_runs (
        period_label,
        source_file_name,
        imported_by_username,
        imported_by_name
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [
      toText(periodLabel),
      toText(sourceFileName),
      toText(importedByUsername),
      toText(importedByName)
    ]);

    const run = runResult.rows[0];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] || {};
      await client.query(`
        INSERT INTO commission_lines (
          run_id,
          source_row_number,
          display_sort,
          salesperson_code,
          salesperson_name,
          salesperson_email,
          salesperson_department,
          sales_order,
          customer_name,
          line_type,
          product_model,
          source_classification,
          quantity,
          sell_price,
          imported_commission_percent,
          imported_commission_amount,
          commission_percent,
          commission_amount
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
      `, [
        run.id,
        Number(line.sourceRowNumber || 0),
        Number(line.displaySort || index + 1),
        toText(line.salespersonCode),
        toText(line.salespersonName),
        toText(line.salespersonEmail),
        toText(line.salespersonDepartment),
        toText(line.salesOrder),
        toText(line.customerName),
        toText(line.lineType),
        toText(line.productModel),
        toText(line.sourceClassification),
        toNumber(line.quantity, 2),
        toNumber(line.sellPrice, 2),
        toNumber(line.importedCommissionPercent, 4),
        toNumber(line.importedCommissionAmount, 2),
        toNumber(line.commissionPercent, 4),
        toNumber(line.commissionAmount, 2)
      ]);
    }

    const seenSalespeople = new Map();
    for (const line of lines) {
      const salespersonKey = getSalespersonKey(line);
      if (!seenSalespeople.has(salespersonKey)) {
        seenSalespeople.set(salespersonKey, {
          salespersonCode: toText(line.salespersonCode),
          salespersonName: toText(line.salespersonName)
        });
      }
    }

    for (const [salespersonKey, salesperson] of seenSalespeople.entries()) {
      await client.query(`
        INSERT INTO commission_salesperson_statuses (
          run_id,
          salesperson_key,
          salesperson_code,
          salesperson_name
        ) VALUES ($1, $2, $3, $4)
      `, [
        run.id,
        salespersonKey,
        salesperson.salespersonCode,
        salesperson.salespersonName
      ]);
    }

    await client.query("COMMIT");
    return run.id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCommissionRunDetail(runId) {
  await finalizeExpiredCommissionRuns();
  const pool = await getPostgresPool();

  const runResult = await pool.query(`
    SELECT *
    FROM commission_runs
    WHERE id = $1
  `, [runId]);

  if (runResult.rowCount === 0) {
    return null;
  }

  const linesResult = await pool.query(`
    SELECT *
    FROM commission_lines
    WHERE run_id = $1
    ORDER BY display_sort ASC, source_row_number ASC, id ASC
  `, [runId]);
  const statusesResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_statuses
    WHERE run_id = $1
    ORDER BY salesperson_name ASC, salesperson_code ASC
  `, [runId]);
  const adjustmentsResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_adjustments
    WHERE run_id = $1
    ORDER BY adjustment_type ASC
  `, [runId]);

  return buildRunDetail(runResult.rows[0], linesResult.rows, statusesResult.rows, adjustmentsResult.rows);
}

export async function recalculateCommissionLine(lineId, mode, value) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();

  const lineResult = await pool.query(`
    SELECT l.*
    FROM commission_lines l
    WHERE l.id = $1
  `, [lineId]);

  if (lineResult.rowCount === 0) {
    return null;
  }

  const current = serializeLine(lineResult.rows[0]);
  const salespersonStatusResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_statuses
    WHERE run_id = $1
      AND salesperson_key = $2
  `, [current.runId, getSalespersonKey(current)]);

  const salespersonStatus = salespersonStatusResult.rows[0]?.status || "draft";
  if (salespersonStatus !== "draft") {
    throw new Error("Only draft salespeople can be edited.");
  }

  const sellPrice = toNumber(current.sellPrice, 2);
  let commissionPercent = current.commissionPercent;
  let commissionAmount = current.commissionAmount;

  if (mode === "percent") {
    commissionPercent = toNumber(value, 4);
    commissionAmount = sellPrice > 0
      ? roundTo(sellPrice * (commissionPercent / 100), 2)
      : 0;
  } else if (mode === "amount") {
    commissionAmount = toNumber(value, 2);
    commissionPercent = sellPrice > 0
      ? roundTo((commissionAmount / sellPrice) * 100, 4)
      : 0;
  } else {
    throw new Error("Calculation mode must be 'percent' or 'amount'.");
  }

  const updateResult = await pool.query(`
    UPDATE commission_lines
    SET commission_percent = $2,
        commission_amount = $3,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [lineId, commissionPercent, commissionAmount]);

  return serializeLine(updateResult.rows[0]);
}

export async function updateCommissionLineClassification(lineId, sourceClassification) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();

  const lineResult = await pool.query(`
    SELECT l.*
    FROM commission_lines l
    WHERE l.id = $1
  `, [lineId]);

  if (lineResult.rowCount === 0) {
    return null;
  }

  const current = serializeLine(lineResult.rows[0]);
  const salespersonStatusResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_statuses
    WHERE run_id = $1
      AND salesperson_key = $2
  `, [current.runId, getSalespersonKey(current)]);

  const salespersonStatus = salespersonStatusResult.rows[0]?.status || "draft";
  if (salespersonStatus !== "draft") {
    throw new Error("Only draft salespeople can be edited.");
  }

  const normalizedClassification = toText(sourceClassification).toUpperCase();
  const allowedValues = new Set(["", "ALL", "SVC", "SPECIAL", "OPEN", "UNPAID", "OMIT"]);
  if (!allowedValues.has(normalizedClassification)) {
    throw new Error("Classification must be ALL, SVC, SPECIAL, OPEN, UNPAID, or OMIT.");
  }

  const updateResult = await pool.query(`
    UPDATE commission_lines
    SET source_classification = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [lineId, normalizedClassification]);

  return serializeLine(updateResult.rows[0]);
}

export async function lockCommissionRun(runId) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();
  const result = await pool.query(`
    UPDATE commission_salesperson_statuses
    SET status = 'locked',
        locked_at = NOW(),
        updated_at = NOW()
    WHERE run_id = $1
      AND status = 'draft'
    RETURNING run_id
  `, [runId]);

  if (result.rowCount === 0) {
    const existing = await pool.query(`SELECT * FROM commission_runs WHERE id = $1`, [runId]);
    if (existing.rowCount === 0) {
      return null;
    }
    throw new Error("Only draft salespeople can be locked.");
  }

  const detail = await getCommissionRunDetail(runId);
  return detail?.run || null;
}

export async function lockCommissionSalesperson(runId, salespersonKey) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();
  const result = await pool.query(`
    UPDATE commission_salesperson_statuses
    SET status = 'locked',
        locked_at = NOW(),
        updated_at = NOW()
    WHERE run_id = $1
      AND salesperson_key = $2
      AND status = 'draft'
    RETURNING *
  `, [runId, toText(salespersonKey)]);

  if (result.rowCount === 0) {
    const existing = await pool.query(`
      SELECT *
      FROM commission_salesperson_statuses
      WHERE run_id = $1
        AND salesperson_key = $2
    `, [runId, toText(salespersonKey)]);

    if (existing.rowCount === 0) {
      return null;
    }

    throw new Error("Only draft salespeople can be locked.");
  }

  return serializeSalespersonStatus(result.rows[0]);
}

export async function updateCommissionSalespersonAdjustment(runId, salespersonKey, adjustmentType, amount, comment) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();
  const normalizedType = toText(adjustmentType).toUpperCase();
  if (!ADJUSTMENT_TYPES.includes(normalizedType)) {
    throw new Error("Adjustment type must be BONUS, DEDUCT, ADVANCE, or MISC.");
  }

  const statusResult = await pool.query(`
    SELECT *
    FROM commission_salesperson_statuses
    WHERE run_id = $1
      AND salesperson_key = $2
  `, [runId, toText(salespersonKey)]);

  if (statusResult.rowCount === 0) {
    return null;
  }

  if ((statusResult.rows[0].status || "draft") !== "draft") {
    throw new Error("Only draft salespeople can be edited.");
  }

  const result = await pool.query(`
    INSERT INTO commission_salesperson_adjustments (
      run_id,
      salesperson_key,
      adjustment_type,
      amount,
      comment,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (run_id, salesperson_key, adjustment_type)
    DO UPDATE SET
      amount = EXCLUDED.amount,
      comment = EXCLUDED.comment,
      updated_at = NOW()
    RETURNING *
  `, [
    runId,
    toText(salespersonKey),
    normalizedType,
    toNumber(amount, 2),
    toText(comment)
  ]);

  return serializeSalespersonAdjustment(result.rows[0]);
}

export async function deleteCommissionRun(runId) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();

  const existing = await pool.query(`
    SELECT *
    FROM commission_runs
    WHERE id = $1
  `, [runId]);

  if (existing.rowCount === 0) {
    return null;
  }

  const statuses = await pool.query(`
    SELECT COUNT(*)::int AS non_draft_count
    FROM commission_salesperson_statuses
    WHERE run_id = $1
      AND status <> 'draft'
  `, [runId]);

  if (Number(statuses.rows[0]?.non_draft_count || 0) > 0) {
    throw new Error("Only all-draft commission runs can be deleted.");
  }

  await pool.query(`
    DELETE FROM commission_runs
    WHERE id = $1
  `, [runId]);

  return serializeRun(existing.rows[0]);
}
