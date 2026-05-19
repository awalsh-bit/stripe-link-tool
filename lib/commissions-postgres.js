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
`;

let schemaReadyPromise = null;

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

function isWarrantyLine(line) {
  const type = toText(line?.lineType).toLowerCase();
  return type === "wty" || type === "warranty";
}

function isOmittedLine(line) {
  return toText(line?.sourceClassification).toUpperCase() === "OMIT";
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

function buildSalespersonGroups(lines) {
  const byRep = new Map();

  for (const line of lines) {
    const key = line.salespersonCode || line.salespersonName || "UNKNOWN";
    if (!byRep.has(key)) {
      byRep.set(key, {
        salespersonCode: line.salespersonCode,
        salespersonName: line.salespersonName,
        salespersonEmail: line.salespersonEmail,
        salespersonDepartment: line.salespersonDepartment,
        lineCount: 0,
        orderCount: 0,
        omittedLineCount: 0,
        totalSellPrice: 0,
        totalCommissionAmount: 0,
        applianceSalesRevenue: 0,
        warrantySellPrice: 0,
        salesOrders: new Map(),
        lines: []
      });
    }

    const group = byRep.get(key);
    group.lines.push(line);
    if (isOmittedLine(line)) {
      group.omittedLineCount += 1;
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
      order.totalSellPrice = roundTo(order.totalSellPrice + line.sellPrice, 2);
      order.totalCommissionAmount = roundTo(order.totalCommissionAmount + line.commissionAmount, 2);
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
      lineCount: group.lineCount,
      orderCount: group.salesOrders.size,
      omittedLineCount: group.omittedLineCount,
      totalSellPrice: group.totalSellPrice,
      totalCommissionAmount: group.totalCommissionAmount,
      applianceSalesRevenue: group.applianceSalesRevenue,
      warrantySellPrice: group.warrantySellPrice,
      warrantyPayoutAmount: 0,
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
      totalPayoutAmount: roundTo(Number(group.totalCommissionAmount || 0) + Number(group.warrantyPayoutAmount || 0), 2)
    }))
    .sort((a, b) => String(a.salespersonName || a.salespersonCode).localeCompare(String(b.salespersonName || b.salespersonCode)));
}

function buildRunDetail(runRow, lineRows) {
  const run = serializeRun(runRow);
  const lines = lineRows.map(serializeLine);
  const salespeople = buildSalespersonGroups(lines);

  return {
    run,
    summary: {
      salespersonCount: salespeople.length,
      lineCount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.lineCount || 0), 0), 0),
      omittedLineCount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.omittedLineCount || 0), 0), 0),
      totalSellPrice: roundTo(salespeople.reduce((sum, group) => sum + Number(group.totalSellPrice || 0), 0), 2),
      totalCommissionAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.totalCommissionAmount || 0), 0), 2),
      totalProtectPayoutAmount: roundTo(salespeople.reduce((sum, group) => sum + Number(group.warrantyPayoutAmount || 0), 0), 2),
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
    })();
  }

  return schemaReadyPromise;
}

export async function finalizeExpiredCommissionRuns() {
  await ensureCommissionTables();
  const pool = await getPostgresPool();

  await pool.query(`
    UPDATE commission_runs
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

  const linesByRunId = new Map();
  for (const row of linesResult.rows) {
    const key = row.run_id;
    if (!linesByRunId.has(key)) {
      linesByRunId.set(key, []);
    }
    linesByRunId.get(key).push(row);
  }

  return runsResult.rows.map((row) => {
    const detail = buildRunDetail(row, linesByRunId.get(row.id) || []);
    return {
      ...detail.run,
      lineCount: Number(detail.summary.lineCount || 0),
      omittedLineCount: Number(detail.summary.omittedLineCount || 0),
      salespersonCount: Number(detail.summary.salespersonCount || 0),
      totalSellPrice: toNumber(detail.summary.totalSellPrice, 2),
      totalCommissionAmount: toNumber(detail.summary.totalCommissionAmount, 2),
      totalProtectPayoutAmount: toNumber(detail.summary.totalProtectPayoutAmount, 2),
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

  return buildRunDetail(runResult.rows[0], linesResult.rows);
}

export async function recalculateCommissionLine(lineId, mode, value) {
  await ensureCommissionTables();
  const pool = await getPostgresPool();

  const lineResult = await pool.query(`
    SELECT l.*, r.status AS run_status
    FROM commission_lines l
    JOIN commission_runs r ON r.id = l.run_id
    WHERE l.id = $1
  `, [lineId]);

  if (lineResult.rowCount === 0) {
    return null;
  }

  const current = serializeLine(lineResult.rows[0]);
  if (lineResult.rows[0].run_status !== "draft") {
    throw new Error("Only draft commission runs can be edited.");
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
    SELECT l.*, r.status AS run_status
    FROM commission_lines l
    JOIN commission_runs r ON r.id = l.run_id
    WHERE l.id = $1
  `, [lineId]);

  if (lineResult.rowCount === 0) {
    return null;
  }

  if (lineResult.rows[0].run_status !== "draft") {
    throw new Error("Only draft commission runs can be edited.");
  }

  const normalizedClassification = toText(sourceClassification).toUpperCase();
  const allowedValues = new Set(["", "ALL", "SVC", "SPECIAL", "OPEN", "OMIT"]);
  if (!allowedValues.has(normalizedClassification)) {
    throw new Error("Classification must be ALL, SVC, SPECIAL, OPEN, or OMIT.");
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
    UPDATE commission_runs
    SET status = 'locked',
        locked_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND status = 'draft'
    RETURNING *
  `, [runId]);

  if (result.rowCount === 0) {
    const existing = await pool.query(`SELECT * FROM commission_runs WHERE id = $1`, [runId]);
    if (existing.rowCount === 0) {
      return null;
    }
    throw new Error("Only draft commission runs can be locked.");
  }

  return serializeRun(result.rows[0]);
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

  if (existing.rows[0].status !== "draft") {
    throw new Error("Only draft commission runs can be deleted.");
  }

  await pool.query(`
    DELETE FROM commission_runs
    WHERE id = $1
  `, [runId]);

  return serializeRun(existing.rows[0]);
}
