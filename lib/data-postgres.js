export const STORAGE_TABLE = "payment_links";

let poolPromise = null;

function getStorageMode() {
  return String(process.env.STORAGE_MODE || "json").trim().toLowerCase();
}

function getDatabaseUrl() {
  return String(process.env.DATABASE_URL || "").trim();
}

function getSslConfig() {
  const sslMode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
  const databaseUrl = getDatabaseUrl().toLowerCase();
  const isLocal =
    databaseUrl.includes("localhost") ||
    databaseUrl.includes("127.0.0.1");

  if (sslMode === "disable" || isLocal) {
    return false;
  }

  if (sslMode === "require" || databaseUrl.includes("render.com")) {
    return { rejectUnauthorized: false };
  }

  return false;
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const databaseUrl = getDatabaseUrl();

      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required when STORAGE_MODE=postgres.");
      }

      let pgModule;
      try {
        pgModule = await import("pg");
      } catch (err) {
        throw new Error("The pg package is not installed. Add pg before enabling STORAGE_MODE=postgres.");
      }

      const { Pool } = pgModule;
      return new Pool({
        connectionString: databaseUrl,
        ssl: getSslConfig()
      });
    })();
  }

  return poolPromise;
}

function mapRowToLinkRecord(row) {
  return {
    id: row.id,
    createdAt: row.created_at?.toISOString?.() || row.created_at || "",
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || "",
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",
    customerEmail: row.customer_email || "",
    creatorCode: row.creator_code || "",
    creatorName: row.creator_name || "",
    creatorEmail: row.creator_email || "",
    department: row.department || "",
    salesOrder: row.sales_order || "",
    description: row.description || "",
    notes: row.notes || "",
    reference: row.reference || "",
    workflowType: row.workflow_type || "appliance",
    status: row.status || "sent",
    active: Boolean(row.active),
    type: row.type || "card_link",
    currency: row.currency || "usd",
    requestedAmount: Number(row.requested_amount || 0),
    requestedTotalAmount: Number(row.requested_total_amount || 0),
    depositAmount: Number(row.deposit_amount || 0),
    balanceAmount: Number(row.balance_amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    paidDate: row.paid_date?.toISOString?.() || row.paid_date || "",
    paymentLinkId: row.payment_link_id || "",
    paymentLinkUrl: row.payment_link_url || "",
    checkoutSessionId: row.checkout_session_id || "",
    paymentIntentId: row.payment_intent_id || "",
    customerId: row.customer_id || "",
    paymentMethodId: row.payment_method_id || "",
    paymentMethodType: row.payment_method_type || "",
    paymentStatusDetail: row.payment_status_detail || "",
    agreementText: row.agreement_text || "",
    paymentNotificationSentAt: row.payment_notification_sent_at?.toISOString?.() || row.payment_notification_sent_at || "",
    paymentNotificationError: row.payment_notification_error || "",
    deactivatedAt: row.deactivated_at?.toISOString?.() || row.deactivated_at || "",
    deactivationReason: row.deactivation_reason || "",
    balanceChargedAt: row.balance_charged_at?.toISOString?.() || row.balance_charged_at || "",
    balancePaymentIntentId: row.balance_payment_intent_id || "",
    balancePaidAmount: Number(row.balance_paid_amount || 0),
    balanceCanceledAt: row.balance_canceled_at?.toISOString?.() || row.balance_canceled_at || "",
    balanceCancellationReason: row.balance_cancellation_reason || "",
    balanceOriginalAmount: Number(row.balance_original_amount || 0),
    balanceUpdatedAt: row.balance_updated_at?.toISOString?.() || row.balance_updated_at || ""
  };
}

function normalizeLinkRecordForStorage(record) {
  const normalized = { ...record };

  normalized.workflowType =
    normalized.workflowType === "hvac_deposit"
      ? "hvac_deposit"
      : "appliance";

  normalized.active = typeof normalized.active === "boolean"
    ? normalized.active
    : normalized.status !== "deactivated";

  if (normalized.paidDate || Number(normalized.paidAmount) > 0) {
    normalized.status = "paid";
    normalized.active = false;
    normalized.type =
      normalized.paymentMethodType === "us_bank_account" || normalized.type === "ach_link"
        ? "ach_link"
        : "card_link";
  } else if (normalized.status === "deactivated" || normalized.active === false) {
    normalized.status = "deactivated";
    normalized.active = false;
    normalized.type = normalized.type === "ach_link" ? "ach_link" : "card_link";
  } else if (normalized.status === "ach_pending") {
    normalized.status = "ach_pending";
    normalized.active = true;
    normalized.type = "ach_link";
    normalized.paymentMethodType = normalized.paymentMethodType || "us_bank_account";
  } else if (normalized.status === "viewed") {
    normalized.status = "viewed";
    normalized.active = true;
    normalized.type = "card_link";
  } else {
    normalized.status = "sent";
    normalized.active = true;
    normalized.type = "card_link";
  }

  return normalized;
}

export function mapLinkRecordToParams(record) {
  const normalized = normalizeLinkRecordForStorage(record);

  return [
    normalized.id,
    normalized.createdAt || new Date().toISOString(),
    normalized.updatedAt || new Date().toISOString(),
    normalized.customerName || "",
    normalized.customerPhone || "",
    normalized.customerEmail || "",
    normalized.creatorCode || "",
    normalized.creatorName || "",
    normalized.creatorEmail || "",
    normalized.department || "",
    normalized.salesOrder || "",
    normalized.description || "",
    normalized.notes || "",
    normalized.reference || "",
    normalized.workflowType || "appliance",
    normalized.status || "sent",
    typeof normalized.active === "boolean" ? normalized.active : true,
    normalized.type || "card_link",
    normalized.currency || "usd",
    Number(normalized.requestedAmount || 0),
    Number(normalized.requestedTotalAmount || 0),
    Number(normalized.depositAmount || 0),
    Number(normalized.balanceAmount || 0),
    Number(normalized.paidAmount || 0),
    normalized.paidDate || null,
    normalized.paymentLinkId || "",
    normalized.paymentLinkUrl || "",
    normalized.checkoutSessionId || "",
    normalized.paymentIntentId || "",
    normalized.customerId || "",
    normalized.paymentMethodId || "",
    normalized.paymentMethodType || "",
    normalized.paymentStatusDetail || "",
    normalized.agreementText || "",
    normalized.paymentNotificationSentAt || null,
    normalized.paymentNotificationError || "",
    normalized.deactivatedAt || null,
    normalized.deactivationReason || "",
    normalized.balanceChargedAt || null,
    normalized.balancePaymentIntentId || "",
    Number(normalized.balancePaidAmount || 0),
    normalized.balanceCanceledAt || null,
    normalized.balanceCancellationReason || "",
    Number(normalized.balanceOriginalAmount || 0),
    normalized.balanceUpdatedAt || null
  ];
}

export const PAYMENT_LINK_UPSERT_SQL = `
  INSERT INTO ${STORAGE_TABLE} (
    id, created_at, updated_at,
    customer_name, customer_phone, customer_email,
    creator_code, creator_name, creator_email, department,
    sales_order, description, notes, reference,
    workflow_type, status, active, type, currency,
    requested_amount, requested_total_amount, deposit_amount, balance_amount,
    paid_amount, paid_date,
    payment_link_id, payment_link_url, checkout_session_id, payment_intent_id,
    customer_id, payment_method_id, payment_method_type, payment_status_detail,
    agreement_text, payment_notification_sent_at, payment_notification_error,
    deactivated_at, deactivation_reason,
    balance_charged_at, balance_payment_intent_id, balance_paid_amount,
    balance_canceled_at, balance_cancellation_reason, balance_original_amount, balance_updated_at
  ) VALUES (
    $1, $2, $3,
    $4, $5, $6,
    $7, $8, $9, $10,
    $11, $12, $13, $14,
    $15, $16, $17, $18, $19,
    $20, $21, $22, $23,
    $24, $25,
    $26, $27, $28, $29,
    $30, $31, $32, $33,
    $34, $35, $36,
    $37, $38,
    $39, $40, $41,
    $42, $43, $44, $45
  )
  ON CONFLICT (id) DO UPDATE SET
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    customer_email = EXCLUDED.customer_email,
    creator_code = EXCLUDED.creator_code,
    creator_name = EXCLUDED.creator_name,
    creator_email = EXCLUDED.creator_email,
    department = EXCLUDED.department,
    sales_order = EXCLUDED.sales_order,
    description = EXCLUDED.description,
    notes = EXCLUDED.notes,
    reference = EXCLUDED.reference,
    workflow_type = EXCLUDED.workflow_type,
    status = EXCLUDED.status,
    active = EXCLUDED.active,
    type = EXCLUDED.type,
    currency = EXCLUDED.currency,
    requested_amount = EXCLUDED.requested_amount,
    requested_total_amount = EXCLUDED.requested_total_amount,
    deposit_amount = EXCLUDED.deposit_amount,
    balance_amount = EXCLUDED.balance_amount,
    paid_amount = EXCLUDED.paid_amount,
    paid_date = EXCLUDED.paid_date,
    payment_link_id = EXCLUDED.payment_link_id,
    payment_link_url = EXCLUDED.payment_link_url,
    checkout_session_id = EXCLUDED.checkout_session_id,
    payment_intent_id = EXCLUDED.payment_intent_id,
    customer_id = EXCLUDED.customer_id,
    payment_method_id = EXCLUDED.payment_method_id,
    payment_method_type = EXCLUDED.payment_method_type,
    payment_status_detail = EXCLUDED.payment_status_detail,
    agreement_text = EXCLUDED.agreement_text,
    payment_notification_sent_at = EXCLUDED.payment_notification_sent_at,
    payment_notification_error = EXCLUDED.payment_notification_error,
    deactivated_at = EXCLUDED.deactivated_at,
    deactivation_reason = EXCLUDED.deactivation_reason,
    balance_charged_at = EXCLUDED.balance_charged_at,
    balance_payment_intent_id = EXCLUDED.balance_payment_intent_id,
    balance_paid_amount = EXCLUDED.balance_paid_amount,
    balance_canceled_at = EXCLUDED.balance_canceled_at,
    balance_cancellation_reason = EXCLUDED.balance_cancellation_reason,
    balance_original_amount = EXCLUDED.balance_original_amount,
    balance_updated_at = EXCLUDED.balance_updated_at
`;

export function isPostgresLinkStorageEnabled() {
  return getStorageMode() === "postgres";
}

export async function getPostgresPool() {
  return getPool();
}

export async function readLinks() {
  const pool = await getPool();
  const result = await pool.query(`
    SELECT *
    FROM ${STORAGE_TABLE}
    ORDER BY created_at DESC
  `);

  return result.rows.map(mapRowToLinkRecord);
}

export async function writeLinks(data) {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${STORAGE_TABLE}`);

    for (const record of data) {
      const values = mapLinkRecordToParams(record);
      await client.query(PAYMENT_LINK_UPSERT_SQL, values);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
