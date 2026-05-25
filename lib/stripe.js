import Stripe from "stripe";
import crypto from "crypto";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export function createStripeIdempotencyKey(prefix, ...parts) {
  const normalized = parts
    .flat()
    .map((part) => {
      if (part === undefined || part === null) return "";
      if (typeof part === "object") return JSON.stringify(part);
      return String(part).trim();
    })
    .join("|");

  const digest = crypto
    .createHash("sha256")
    .update(`${prefix}|${normalized}`)
    .digest("hex")
    .slice(0, 32);

  return `${prefix}-${digest}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStripeError(err) {
  return (
    err?.statusCode === 429 ||
    err?.code === "rate_limit" ||
    err?.type === "StripeRateLimitError"
  );
}

export function tryParseLinkLookupUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const candidates = raw.startsWith("http://") || raw.startsWith("https://")
    ? [raw]
    : [`https://${raw}`, raw];

  for (const candidate of candidates) {
    try {
      return new URL(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

export function getPaymentLinkLookupTokens(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const tokens = new Set([raw.toLowerCase()]);
  const parsedUrl = tryParseLinkLookupUrl(raw);

  if (parsedUrl) {
    const pathname = parsedUrl.pathname.replace(/\/+$/, "");
    const hostAndPath = `${parsedUrl.hostname}${pathname}`;
    tokens.add(parsedUrl.href.toLowerCase().replace(/\/+$/, ""));
    if (pathname) {
      tokens.add(pathname.toLowerCase());
      tokens.add(pathname.split("/").pop().toLowerCase());
    }
    tokens.add(hostAndPath.toLowerCase());
  }

  const pathMatch = raw.match(/\/([bcp]\/[A-Za-z0-9]+)(?:[/?#]|$)/i);
  if (pathMatch?.[1]) {
    tokens.add(`/${pathMatch[1].toLowerCase()}`);
    tokens.add(pathMatch[1].split("/").pop().toLowerCase());
  }

  return [...tokens].filter(Boolean);
}

export function paymentLinkLookupMatches(record, lookupValue) {
  const tokens = getPaymentLinkLookupTokens(lookupValue);
  if (!tokens.length) return false;

  const recordTokens = new Set();
  const paymentLinkId = String(record.paymentLinkId || "").trim().toLowerCase();
  const paymentLinkUrl = String(record.paymentLinkUrl || "").trim();
  const checkoutSessionId = String(record.checkoutSessionId || "").trim().toLowerCase();

  if (paymentLinkId) {
    recordTokens.add(paymentLinkId);
  }

  if (checkoutSessionId) {
    recordTokens.add(checkoutSessionId);
  }

  if (paymentLinkUrl) {
    const parsedRecordUrl = tryParseLinkLookupUrl(paymentLinkUrl);
    recordTokens.add(paymentLinkUrl.toLowerCase().replace(/\/+$/, ""));

    if (parsedRecordUrl) {
      const pathname = parsedRecordUrl.pathname.replace(/\/+$/, "");
      const hostAndPath = `${parsedRecordUrl.hostname}${pathname}`;
      if (pathname) {
        recordTokens.add(pathname.toLowerCase());
        recordTokens.add(pathname.split("/").pop().toLowerCase());
      }
      recordTokens.add(hostAndPath.toLowerCase());
    }
  }

  return tokens.some((token) => recordTokens.has(token));
}

export async function findStripePaymentLinkByLookup(lookupValue) {
  const raw = String(lookupValue || "").trim();
  if (!raw) return null;

  const directIdMatch = raw.match(/\bplink_[A-Za-z0-9]+\b/);
  if (directIdMatch?.[0]) {
    return await stripe.paymentLinks.retrieve(directIdMatch[0]);
  }

  const lookupTokens = getPaymentLinkLookupTokens(raw);
  if (!lookupTokens.length) return null;

  let startingAfter;

  for (let page = 0; page < 20; page += 1) {
    const response = await stripe.paymentLinks.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    const match = response.data.find((paymentLink) => {
      const linkTokens = getPaymentLinkLookupTokens(paymentLink.url || "");
      linkTokens.push(String(paymentLink.id || "").trim());
      const normalizedTokens = new Set(linkTokens.map((token) => String(token || "").trim()));
      return lookupTokens.some((token) => normalizedTokens.has(token));
    });

    if (match) {
      return match;
    }

    if (!response.has_more || response.data.length === 0) {
      break;
    }

    startingAfter = response.data[response.data.length - 1].id;
  }

  return null;
}

export async function buildRecoveredLinkRecordFromStripeLink(stripeLink, normalizeLinkRecord) {
  const metadata = {
    ...(stripeLink.metadata || {}),
    ...(stripeLink.payment_intent_data?.metadata || {})
  };

  const lineItems = await stripe.paymentLinks.listLineItems(stripeLink.id, {
    limit: 1
  });
  const firstLineItem = lineItems.data?.[0] || null;
  const lineAmount = Number(firstLineItem?.amount_total ?? firstLineItem?.amount_subtotal ?? 0) / 100;

  const workflowType = metadata.workflow_type === "hvac_deposit" ? "hvac_deposit" : "appliance";
  const requestedAmount = Number(metadata.deposit_amount || lineAmount || 0);
  const requestedTotalAmount = Number(metadata.requested_total_amount || requestedAmount || 0);
  const balanceAmount = Number(metadata.remaining_balance_amount || Math.max(requestedTotalAmount - requestedAmount, 0) || 0);
  const createdAt = new Date().toISOString();
  const sessions = await stripe.checkout.sessions.list({
    payment_link: stripeLink.id,
    limit: 10
  });
  const paidSession = sessions.data.find((session) => session.payment_status === "paid");
  const paymentIntentId = typeof paidSession?.payment_intent === "string"
    ? paidSession.payment_intent
    : paidSession?.payment_intent?.id || "";
  const paidIntent = paymentIntentId
    ? await retrievePaymentIntentWithDetails(paymentIntentId)
    : null;
  const paymentMethodType =
    paidIntent?.payment_method_types?.[0] ||
    paidSession?.payment_method_types?.[0] ||
    "";
  const isPaid = Boolean(paidSession);
  const paidAmount = Number(
    typeof paidSession?.amount_total === "number"
      ? paidSession.amount_total / 100
      : typeof paidIntent?.amount_received === "number"
        ? paidIntent.amount_received / 100
        : 0
  );
  const paidDate = isPaid
    ? new Date((paidSession?.created || Math.floor(Date.now() / 1000)) * 1000).toISOString()
    : "";
  const customerId =
    typeof paidIntent?.customer === "string"
      ? paidIntent.customer
      : paidIntent?.customer?.id || "";
  const paymentMethodId =
    typeof paidIntent?.payment_method === "string"
      ? paidIntent.payment_method
      : paidIntent?.payment_method?.id || "";

  return normalizeLinkRecord({
    id: `recovered_${Date.now()}`,
    createdAt,
    customerName: metadata.customer_name || "",
    customerPhone: metadata.customer_phone || "",
    customerEmail: metadata.customer_email || "",
    creatorCode: metadata.creator_code || "",
    creatorName: metadata.creator_name || "",
    creatorEmail: metadata.creator_email || "",
    department: metadata.department || "",
    salesOrder: metadata.sales_order || "",
    description: metadata.link_description || "",
    notes: metadata.notes || "",
    workflowType,
    requestedAmount,
    requestedTotalAmount,
    depositAmount: workflowType === "hvac_deposit" ? requestedAmount : 0,
    balanceAmount,
    agreementText: metadata.agreement_text || "",
    currency: stripeLink.currency || "usd",
    paymentLinkId: stripeLink.id,
    paymentLinkUrl: stripeLink.url || "",
    paymentMethodType,
    paymentStatusDetail: isPaid ? (paidIntent?.status || "succeeded") : "",
    paymentNotificationSentAt: "",
    paymentNotificationError: "",
    customerId,
    paymentMethodId,
    paidAmount,
    paidDate,
    paymentIntentId,
    checkoutSessionId: paidSession?.id || "",
    status: isPaid ? "paid" : (stripeLink.active ? "sent" : "deactivated"),
    active: isPaid ? false : Boolean(stripeLink.active),
    deactivatedAt: isPaid || stripeLink.active ? "" : createdAt,
    deactivationReason: isPaid ? "" : (stripeLink.active ? "" : (stripeLink.inactive_message || ""))
  });
}

export async function getStripeAmountsForPaymentIntent(paymentIntentId) {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"]
  });

  const latestCharge = paymentIntent.latest_charge;
  const balanceTransaction = latestCharge?.balance_transaction;

  const grossAmount = Number(
    typeof latestCharge?.amount === "number"
      ? latestCharge.amount / 100
      : paymentIntent.amount / 100 || 0
  );
  const feeAmount = Number(
    typeof balanceTransaction?.fee === "number"
      ? balanceTransaction.fee / 100
      : 0
  );
  const netAmount = Number(
    typeof balanceTransaction?.net === "number"
      ? balanceTransaction.net / 100
      : grossAmount - feeAmount
  );

  return {
    grossAmount,
    feeAmount,
    netAmount
  };
}

export async function getStripeAmountsForPaymentIntentWithRetry(paymentIntentId, attempt = 0) {
  try {
    return await getStripeAmountsForPaymentIntent(paymentIntentId);
  } catch (err) {
    if (!shouldRetryStripeError(err) || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return getStripeAmountsForPaymentIntentWithRetry(paymentIntentId, attempt + 1);
  }
}

export async function listPayoutsWithRetry(params, attempt = 0) {
  try {
    return await stripe.payouts.list(params);
  } catch (err) {
    if (!shouldRetryStripeError(err) || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return listPayoutsWithRetry(params, attempt + 1);
  }
}

export async function listChargesWithRetry(params, attempt = 0) {
  try {
    return await stripe.charges.list(params);
  } catch (err) {
    if (!shouldRetryStripeError(err) || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return listChargesWithRetry(params, attempt + 1);
  }
}

export async function listBalanceTransactionsForPayoutWithRetry(payoutId, startingAfter = "", attempt = 0) {
  try {
    return await stripe.balanceTransactions.list({
      payout: payoutId,
      limit: 100,
      expand: ["data.source"],
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });
  } catch (err) {
    if (!shouldRetryStripeError(err) || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return listBalanceTransactionsForPayoutWithRetry(payoutId, startingAfter, attempt + 1);
  }
}

export async function retrievePaymentIntentWithDetails(paymentIntentId) {
  return stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"]
  });
}

export async function retrievePaymentIntentWithDetailsWithRetry(paymentIntentId, attempt = 0) {
  try {
    return await retrievePaymentIntentWithDetails(paymentIntentId);
  } catch (err) {
    if (!shouldRetryStripeError(err) || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return retrievePaymentIntentWithDetailsWithRetry(paymentIntentId, attempt + 1);
  }
}

export async function retrieveChargeWithRetry(chargeId, attempt = 0) {
  try {
    return await stripe.charges.retrieve(chargeId);
  } catch (err) {
    if (!shouldRetryStripeError(err) || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return retrieveChargeWithRetry(chargeId, attempt + 1);
  }
}
