import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DASHBOARD_HOST = (process.env.DASHBOARD_HOST || "dashboards.wilsonappliance.com").toLowerCase();
const SERVICE_PUBLIC_HOST = (process.env.SERVICE_PUBLIC_HOST || "service.wilsonappliance.com").toLowerCase();
const AUTH_COOKIE_NAME = "wilson_dashboard_session";
const AUTH_COOKIE_TTL_SECONDS = 60 * 60 * 12;
const AUTH_COOKIE_SECRET =
  process.env.SESSION_SECRET ||
  `${process.env.APP_USERNAME || "wilson"}:${process.env.APP_PASSWORD || "wilson"}`;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureJsonFile(filename, defaultValue = []) {
  ensureDataDir();
  const fullPath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, JSON.stringify(defaultValue, null, 2), "utf8");
  }

  return fullPath;
}

const LINKS_FILE = ensureJsonFile("links.json", []);
const TERMINAL_PAYMENTS_FILE = ensureJsonFile("terminal-payments.json", []);
const SERVICE_CARDS_FILE = ensureJsonFile("service-cards.json", []);


const app = express();
app.set("trust proxy", true);
app.use(cors());

const SERVICE_PUBLIC_PATHS = new Set([
  "/",
  "/applianceservice.html",
  "/terms.html",
  "/public-shell.css",
  "/public-shell.js",
  "/logo-black.png",
  "/robots.txt",
  "/favicon.ico"
]);

const SERVICE_PUBLIC_API_PREFIXES = [
  "/api/config",
  "/api/service/setup-intent",
  "/api/service/submit-request",
  "/api/service/setup-intent-result/",
  "/api/service/prefill/"
];

const ALWAYS_PUBLIC_PATHS = new Set([
  "/api/stripe/webhook"
]);

const PUBLIC_AUTH_PATHS = new Set([
  "/logo-black.png",
  "/api/login",
  "/api/logout"
]);

const INTERNAL_PAGE_PATHS = new Set([
  "/dashboard.html",
  "/salesdashboard.html",
  "/hvac-dashboard.html",
  "/intent-lookup.html",
  "/login.html",
  "/logout.html",
  "/index.html",
  "/terminal.html",
  "/charge-saved-card.html",
  "/paid-order-detail.html",
  "/bank-balancing.html",
  "/appliance-service-calls.html"
]);

const UNAUTHENTICATED_INTERNAL_PATHS = new Set([
  "/login.html",
  "/logout.html"
]);

const ACCESS_GROUPS = {
  super_user: {
    label: "Super User",
    pages: ["*"]
  },
  accounting: {
    label: "Accounting",
    pages: ["/paid-order-detail.html", "/bank-balancing.html", "/intent-lookup.html"]
  },
  sales: {
    label: "Sales",
    pages: ["/dashboard.html", "/salesdashboard.html", "/index.html", "/terminal.html", "/charge-saved-card.html"]
  },
  service: {
    label: "Service",
    pages: ["/appliance-service-calls.html", "/intent-lookup.html"]
  }
};

function getRequestHost(req) {
  return String(req.hostname || req.get("host") || "")
    .split(":")[0]
    .toLowerCase();
}

function isLocalHost(host) {
  return ["localhost", "127.0.0.1"].includes(host);
}

function isServicePublicPath(pathname) {
  return (
    SERVICE_PUBLIC_PATHS.has(pathname) ||
    SERVICE_PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
  );
}

function isAlwaysPublicPath(pathname) {
  return ALWAYS_PUBLIC_PATHS.has(pathname);
}

function isPublicAuthPath(pathname) {
  return PUBLIC_AUTH_PATHS.has(pathname);
}

function buildHostUrl(req, targetHost) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${targetHost}${req.originalUrl}`;
}

function getServiceBaseUrl(req) {
  const host = getRequestHost(req);

  if (SERVICE_PUBLIC_HOST && !isLocalHost(host)) {
    const protocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || req.protocol || "https";
    return `${protocol}://${SERVICE_PUBLIC_HOST}`;
  }

  return `${req.protocol}://${req.get("host")}`;
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  return header.split(";").reduce((acc, pair) => {
    const [rawName, ...rawValueParts] = pair.split("=");
    const name = rawName?.trim();
    if (!name) return acc;
    acc[name] = decodeURIComponent(rawValueParts.join("=").trim());
    return acc;
  }, {});
}

function signAuthPayload(payloadText) {
  return crypto
    .createHmac("sha256", AUTH_COOKIE_SECRET)
    .update(payloadText)
    .digest("base64url");
}

function createAuthCookieValue(user) {
  const payloadText = Buffer.from(JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    accessGroup: user.accessGroup,
    issuedAt: Date.now(),
    expiresAt: Date.now() + AUTH_COOKIE_TTL_SECONDS * 1000
  })).toString("base64url");

  const signature = signAuthPayload(payloadText);
  return `${payloadText}.${signature}`;
}

function readAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const rawValue = cookies[AUTH_COOKIE_NAME];

  if (!rawValue || !rawValue.includes(".")) {
    return null;
  }

  const [payloadText, signature] = rawValue.split(".");
  const expectedSignature = signAuthPayload(payloadText);

  if (!signature || signature.length !== expectedSignature.length) {
    return null;
  }

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    if (!payload?.expiresAt || payload.expiresAt < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return forwardedProto === "https" || req.secure;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setAuthCookie(req, res, user) {
  res.setHeader("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, createAuthCookieValue(user), {
    maxAge: AUTH_COOKIE_TTL_SECONDS,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(req)
  }));
}

function clearAuthCookie(req, res) {
  res.setHeader("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(req)
  }));
}

function buildCurrentSuperUser(username) {
  return {
    username,
    displayName: "Wilson",
    role: "super_user",
    accessGroup: "super_user"
  };
}

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

app.use((req, res, next) => {
  const host = getRequestHost(req);

  if (isLocalHost(host) || !host) {
    return next();
  }

  if (host === SERVICE_PUBLIC_HOST && INTERNAL_PAGE_PATHS.has(req.path)) {
    return res.redirect(302, buildHostUrl(req, DASHBOARD_HOST));
  }

  if (host === DASHBOARD_HOST && req.path !== "/" && SERVICE_PUBLIC_PATHS.has(req.path)) {
    return res.redirect(302, buildHostUrl(req, SERVICE_PUBLIC_HOST));
  }

  next();
});


app.use((req, res, next) => {
  const host = getRequestHost(req);
  const isWebhookRequest = isAlwaysPublicPath(req.path);
  const isPublicServiceRequest =
    (host === SERVICE_PUBLIC_HOST || isLocalHost(host)) &&
    isServicePublicPath(req.path);
  const isUnauthenticatedInternalPage =
    (host === DASHBOARD_HOST || isLocalHost(host)) &&
    UNAUTHENTICATED_INTERNAL_PATHS.has(req.path);
  const isPublicAuthRequest =
    (host === DASHBOARD_HOST || isLocalHost(host)) &&
    isPublicAuthPath(req.path);

  if (isWebhookRequest || isPublicServiceRequest || isUnauthenticatedInternalPage || isPublicAuthRequest) {
    return next();
  }

  const authUser = readAuthenticatedUser(req);

  if (authUser) {
    req.authUser = authUser;
    return next();
  }

  const wantsHtml =
    req.method === "GET" &&
    !req.path.startsWith("/api/") &&
    (req.accepts("html") || req.path.endsWith(".html") || req.path === "/");

  if ((host === DASHBOARD_HOST || isLocalHost(host)) && wantsHtml) {
    return res.redirect(302, "/login.html");
  }

  return res.status(401).json({
    error: "Authentication required."
  });
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  process.env.PAYMENT_NOTIFICATION_FROM_EMAIL ||
  "";
const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Chicago";

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET.");
    }

    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).send("Missing Stripe signature.");
    }

    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      await processCheckoutSessionWebhookEvent(event);
    }

    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook error: ${err.message}`);
  }
});

app.use(express.json());

app.post("/api/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  const normalizedUsername = String(username || "").trim();

  if (
    normalizedUsername !== String(process.env.APP_USERNAME || "wilson") ||
    String(password || "") !== String(process.env.APP_PASSWORD || "")
  ) {
    return res.status(401).json({
      error: "Invalid username or password."
    });
  }

  const user = buildCurrentSuperUser(normalizedUsername);
  setAuthCookie(req, res, user);

  return res.json({
    success: true,
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      accessGroup: user.accessGroup,
      availableAccessGroups: ACCESS_GROUPS
    }
  });
});

app.post("/api/logout", (req, res) => {
  clearAuthCookie(req, res);
  return res.json({ success: true });
});

app.use(express.static(__dirname, { index: false }));

app.get("/", (req, res) => {
  const host = getRequestHost(req);
  const landingPage =
    host === SERVICE_PUBLIC_HOST
      ? "applianceservice.html"
      : "dashboard.html";
  res.sendFile(path.join(__dirname, landingPage));
});



// -------------------------
// EXISTING PAYMENT LINK ROUTE
// -------------------------
app.post("/api/create-payment-link", async (req, res) => {
  try {
    const {
      linkType,
      customerName,
      customerPhone,
      customerPhoneDigits,
      customerEmail,
      creatorCode,
      creatorName,
      creatorEmail,
      department,
      salesOrder,
      amount,
      requestedTotalAmount,
      depositAmount,
      balanceAmount,
      description,
      notes,
      agreementText
    } = req.body;

    if (!amount || !salesOrder || !customerPhone) {
      return res.status(400).json({
        error: "amount, salesOrder, and customerPhone are required"
      });
    }

    const normalizedLinkType = linkType === "hvac_deposit" ? "hvac_deposit" : "appliance";
    const normalizedCurrency = "usd";
    const chargeNowAmount = Number(amount);
    const fullOrderAmount =
      normalizedLinkType === "hvac_deposit"
        ? Number(requestedTotalAmount || amount)
        : Number(amount);
    const remainingBalanceAmount =
      normalizedLinkType === "hvac_deposit"
        ? Number(balanceAmount || Math.max(fullOrderAmount - chargeNowAmount, 0))
        : 0;

    if (normalizedLinkType === "hvac_deposit" && !customerEmail) {
      return res.status(400).json({
        error: "customerEmail is required for HVAC deposit links"
      });
    }

    const unitAmount = Math.round(chargeNowAmount * 100);
if (!Number.isFinite(unitAmount) || unitAmount < 50) {
  return res.status(400).json({
    error: "Amount must be at least $0.50"
  });
}

const product = await stripe.products.create({
  name:
    normalizedLinkType === "hvac_deposit"
      ? `${salesOrder || "Customer payment"} HVAC Deposit`
      : salesOrder || "Customer payment"
});

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: unitAmount,
      currency: normalizedCurrency
    });

const sharedMetadata = {
  workflow_type: normalizedLinkType,
  sales_order: salesOrder || "",
  customer_name: customerName || "",
  customer_phone: customerPhoneDigits || customerPhone || "",
  customer_email: customerEmail || "",
  creator_code: creatorCode || "",
  creator_name: creatorName || "",
  creator_email: creatorEmail || "",
  department: department || "",
  notes: notes || "",
  link_description: description || "",
  requested_total_amount: String(fullOrderAmount || 0),
  deposit_amount: String(normalizedLinkType === "hvac_deposit" ? (depositAmount || chargeNowAmount) : chargeNowAmount),
  remaining_balance_amount: String(remainingBalanceAmount || 0),
  agreement_text: agreementText || ""
};

const paymentLinkConfig = {
  line_items: [
    {
      price: price.id,
      quantity: 1
    }
  ],
  payment_intent_data: {
    description:
      normalizedLinkType === "hvac_deposit"
        ? `${salesOrder || description || "Customer payment"} HVAC deposit`
        : salesOrder || description || "Customer payment",
    metadata: sharedMetadata
  },
  metadata: sharedMetadata
};

if (normalizedLinkType === "hvac_deposit") {
  paymentLinkConfig.customer_creation = "always";
  paymentLinkConfig.payment_intent_data.setup_future_usage = "off_session";
}

const paymentLink = await stripe.paymentLinks.create(paymentLinkConfig);

    const links = await readLinks();

    links.unshift({
      id: `req_${Date.now()}`,
      createdAt: new Date().toISOString(),
      customerName: customerName || "",
      customerPhone: customerPhoneDigits || customerPhone || "",
      customerEmail: customerEmail || "",
      creatorCode: creatorCode || "",
      creatorName: creatorName || "",
      creatorEmail: creatorEmail || "",
      department: department || "",
      salesOrder: salesOrder || "",
      description: description || "",
      notes: notes || "",
      workflowType: normalizedLinkType,
      requestedAmount: chargeNowAmount || 0,
      requestedTotalAmount: fullOrderAmount || chargeNowAmount || 0,
      depositAmount: normalizedLinkType === "hvac_deposit" ? (Number(depositAmount) || chargeNowAmount || 0) : 0,
      balanceAmount: remainingBalanceAmount || 0,
      agreementText: agreementText || "",
      currency: normalizedCurrency,
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.url,
      status: "sent",
      active: true,
      deactivatedAt: "",
      deactivationReason: "",
      paymentMethodType: "",
      paymentStatusDetail: "",
      paymentNotificationSentAt: "",
      paymentNotificationError: "",
      customerId: "",
      paymentMethodId: "",
      paidAmount: 0,
      paidDate: "",
      paymentIntentId: "",
      checkoutSessionId: "",
      balanceChargedAt: "",
      balancePaymentIntentId: "",
      balancePaidAmount: 0
    });

    await writeLinks(links);

    res.json({
      url: paymentLink.url,
      paymentLinkId: paymentLink.id,
      workflowType: normalizedLinkType
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// -------------------------
// TERMINAL: LIST ONLINE READERS
// -------------------------
app.get("/api/terminal/readers", async (req, res) => {
  try {
    const readers = await stripe.terminal.readers.list({
      limit: 20
    });

    const simplified = readers.data.map((reader) => ({
      id: reader.id,
      label: reader.label,
      device_type: reader.device_type,
      status: reader.status,
      location: reader.location
    }));

    res.json({ readers: simplified });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// -------------------------
// TERMINAL: CREATE + COLLECT + PROCESS
// -------------------------
app.post("/api/terminal/charge", async (req, res) => {
  try {
const {
  amount,
  currency,
  description,
  customerName,
  customerPhone,
  customerPhoneDigits,
  customerEmail,
  creatorCode,
  creatorName,
  creatorEmail,
  salesOrder,
  notes,
  readerId
} = req.body;

   if (!amount || !readerId || !salesOrder || !customerPhone) {
  return res.status(400).json({
    error: "amount, readerId, salesOrder, and customerPhone are required"
  });
}

    const amountInCents = Math.round(Number(amount) * 100);

const paymentIntent = await stripe.paymentIntents.create({
  amount: amountInCents,
  currency: currency || "usd",
  payment_method_types: ["card_present"],
  capture_method: "automatic",
  description: description || "In-person payment",
  metadata: {
    sales_order: salesOrder || "",
    description: description || "",
    customer_name: customerName || "",
    customer_phone: customerPhoneDigits || customerPhone || "",
    customer_email: customerEmail || "",
    creator_code: creatorCode || "",
    creator_name: creatorName || "",
    creator_email: creatorEmail || "",
    notes: notes || ""
  }
});

    const reader = await stripe.rawRequest(
      "POST",
      `/v1/terminal/readers/${readerId}/process_payment_intent`,
      {
        payment_intent: paymentIntent.id
      }
    );

    res.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      readerActionStatus: reader.action?.status || "in_progress",
      message: "Reader is ready. Customer can tap, insert, or swipe now."
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Terminal charge failed"
    });
  }
});


app.get("/api/terminal/payment-status/:paymentIntentId", async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      req.params.paymentIntentId
    );

    const charge = paymentIntent.latest_charge
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : null;

    const cardDetails =
      charge?.payment_method_details?.card_present ||
      charge?.payment_method_details?.card ||
      null;

    if (paymentIntent.status === "succeeded") {
      const terminalPayments = await readTerminalPayments();
      const alreadyExists = terminalPayments.some(
        (row) => row.paymentIntentId === paymentIntent.id
      );

      if (!alreadyExists) {
        terminalPayments.unshift({
          id: `term_${Date.now()}`,
          type: "terminal",
          createdAt: new Date(paymentIntent.created * 1000).toISOString(),
          customerName: paymentIntent.metadata?.customer_name || "",
          customerEmail: paymentIntent.metadata?.customer_email || "",
          creatorCode: paymentIntent.metadata?.creator_code || "",
          creatorName: paymentIntent.metadata?.creator_name || "",
          creatorEmail: paymentIntent.metadata?.creator_email || "",
          reference: paymentIntent.metadata?.sales_order || paymentIntent.description || "",
          description: paymentIntent.metadata?.description || paymentIntent.description || "",
          salesOrder: paymentIntent.metadata?.sales_order || "",
          notes: paymentIntent.metadata?.notes || "",
          status: "paid",
          paidAmount: (paymentIntent.amount || 0) / 100,
          paidDate: new Date().toISOString(),
          paymentIntentId: paymentIntent.id,
          cardBrand: cardDetails?.brand || "",
          last4: cardDetails?.last4 || ""
        });

        await writeTerminalPayments(terminalPayments);
      }
    }

    res.json({
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      created: paymentIntent.created,
      cardBrand: cardDetails?.brand || "",
      last4: cardDetails?.last4 || ""
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// -------------------------
// APPLIANCE SERVICE: SAVE CARD
// -------------------------


app.get("/api/config", (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(400).json({ error: "Missing STRIPE_PUBLISHABLE_KEY" });
  }

  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

app.post("/api/service/setup-intent", async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      existingServiceCardId,
      serviceAddress,
      gateCode,
      contactMethod,
      purchaseDate,
      purchasedWithin12Months,
      problemDescription,
      units,
      consent
    } = req.body;

    if (!customerName || !customerEmail) {
      return res.status(400).json({
        error: "Client name and client email are required."
      });
    }

    if (!consent) {
      return res.status(400).json({
        error: "Customer authorization is required."
      });
    }

    const customer = await stripe.customers.create({
      name: customerName,
      email: customerEmail,
      phone: customerPhone || undefined,
      address: serviceAddress
        ? {
            line1: serviceAddress.line1 || undefined,
            line2: serviceAddress.line2 || undefined,
            city: serviceAddress.city || undefined,
            state:
  serviceAddress.state === "Texas"
    ? "TX"
    : (serviceAddress.state || undefined),
            postal_code: serviceAddress.zip || undefined,
            country: "US"
          }
        : undefined,
      metadata: {
        gate_code: gateCode || "",
        contact_method: contactMethod || "",
        purchase_date: purchaseDate || "",
        purchased_within_12_months: purchasedWithin12Months || "",
        service_address_line1: serviceAddress?.line1 || "",
        service_address_line2: serviceAddress?.line2 || "",
        service_address_city: serviceAddress?.city || "",
        service_address_state: serviceAddress?.state || "",
        service_address_zip: serviceAddress?.zip || "",
        problem_description: problemDescription || ""
      }
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        customer_name: customerName || "",
        customer_email: customerEmail || "",
        customer_phone: customerPhone || "",
        service_card_id: existingServiceCardId || "",
        service_address_line1: serviceAddress?.line1 || "",
        service_address_line2: serviceAddress?.line2 || "",
        service_address_city: serviceAddress?.city || "",
        service_address_state: serviceAddress?.state || "",
        service_address_zip: serviceAddress?.zip || "",
        gate_code: gateCode || "",
        contact_method: contactMethod || "",
        purchase_date: purchaseDate || "",
        purchased_within_12_months: purchasedWithin12Months || "",
        appliance_type_1: units?.[0]?.applianceType || "",
        brand_1: units?.[0]?.brand || "",
        model_1: units?.[0]?.model || "",
        serial_1: units?.[0]?.serial || "",
        purchased_from_us_1: units?.[0]?.purchasedFromUs || "",
        stacked_1: units?.[0]?.stacked || "",
        problem_description_1: units?.[0]?.problemDescription || "",
        appliance_type_2: units?.[1]?.applianceType || "",
        brand_2: units?.[1]?.brand || "",
        model_2: units?.[1]?.model || "",
        serial_2: units?.[1]?.serial || "",
        problem_description_2: units?.[1]?.problemDescription || ""
      }
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId: customer.id
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to create setup intent."
    });
  }
});


app.get("/api/service/setup-intent-result/:setupIntentId", async (req, res) => {
  try {
    const setupIntent = await stripe.setupIntents.retrieve(
      req.params.setupIntentId,
      {
        expand: ["payment_method", "customer"]
      }
    );

    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({
        error: `SetupIntent is not complete. Current status: ${setupIntent.status}`
      });
    }

    const paymentMethod = setupIntent.payment_method;
    const customer = setupIntent.customer;

    const brand = paymentMethod?.card?.brand || "";
    const last4 = paymentMethod?.card?.last4 || "";

    const serviceCards = await readServiceCards();
    const existingServiceCardId = setupIntent.metadata?.service_card_id || "";
    const existingIndex = serviceCards.findIndex(
      (row) => row.setupIntentId === setupIntent.id
    );
    const existingCardIdIndex =
      existingIndex >= 0
        ? existingIndex
        : existingServiceCardId
          ? serviceCards.findIndex((row) => row.id === existingServiceCardId)
          : -1;

    const stripeFields = {
      customerId: customer?.id || "",
      paymentMethodId: paymentMethod?.id || "",
      cardBrand: brand,
      last4,
      setupIntentStatus: setupIntent.status,
      updatedAt: new Date().toISOString()
    };

    if (existingCardIdIndex >= 0) {
      serviceCards[existingCardIdIndex] = {
        ...serviceCards[existingCardIdIndex],
        setupIntentId: setupIntent.id,
        ...stripeFields
      };
    } else {
      serviceCards.unshift({
        id: `svc_${Date.now()}`,
        createdAt: new Date(setupIntent.created * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        queueStatus: "Call Status Pending",
        queueStatusNotes: "",
        erpOrderNumber: "",
        setupIntentId: setupIntent.id,
        setupIntentStatus: setupIntent.status,
        customerId: customer?.id || "",
        paymentMethodId: paymentMethod?.id || "",
        customerName: customer?.name || setupIntent.metadata?.customer_name || "",
        customerEmail: customer?.email || setupIntent.metadata?.customer_email || "",
        customerPhone: customer?.phone || setupIntent.metadata?.customer_phone || "",
        serviceAddress: {
          line1: setupIntent.metadata?.service_address_line1 || "",
          line2: setupIntent.metadata?.service_address_line2 || "",
          city: setupIntent.metadata?.service_address_city || "",
          state: setupIntent.metadata?.service_address_state || "",
          zip: setupIntent.metadata?.service_address_zip || ""
        },
        purchaseDate: setupIntent.metadata?.purchase_date || "",
        purchasedWithin12Months: setupIntent.metadata?.purchased_within_12_months || "",
        gateCode: setupIntent.metadata?.gate_code || "",
        contactMethod: setupIntent.metadata?.contact_method || "",
        unitCount:
          (setupIntent.metadata?.appliance_type_2 ||
           setupIntent.metadata?.brand_2 ||
           setupIntent.metadata?.model_2 ||
           setupIntent.metadata?.serial_2 ||
           setupIntent.metadata?.problem_description_2)
            ? "Multiple"
            : "One",
        units: [
          {
            applianceType: setupIntent.metadata?.appliance_type_1 || "",
            brand: setupIntent.metadata?.brand_1 || "",
            model: setupIntent.metadata?.model_1 || "",
            serial: setupIntent.metadata?.serial_1 || "",
            purchasedFromUs: setupIntent.metadata?.purchased_from_us_1 || "",
            stacked: setupIntent.metadata?.stacked_1 || "",
            problemDescription: setupIntent.metadata?.problem_description_1 || ""
          },
          ...(
            setupIntent.metadata?.appliance_type_2 ||
            setupIntent.metadata?.brand_2 ||
            setupIntent.metadata?.model_2 ||
            setupIntent.metadata?.serial_2 ||
            setupIntent.metadata?.problem_description_2
              ? [{
                  applianceType: setupIntent.metadata?.appliance_type_2 || "",
                  brand: setupIntent.metadata?.brand_2 || "",
                  model: setupIntent.metadata?.model_2 || "",
                  serial: setupIntent.metadata?.serial_2 || "",
                  problemDescription: setupIntent.metadata?.problem_description_2 || ""
                }]
              : []
          )
        ],
        problemDescription: setupIntent.metadata?.problem_description || "",
        cardRequired: true,
        cardBrand: brand,
        last4
      });
    }

    await writeServiceCards(serviceCards);

    res.json({
      setupIntentId: setupIntent.id,
      customerId: customer?.id || "",
      paymentMethodId: paymentMethod?.id || "",
      customerName: customer?.name || "",
      customerEmail: customer?.email || "",
      cardBrand: brand,
      last4,
      setupIntentStatus: setupIntent.status
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to retrieve setup intent result."
    });
  }
});


app.post("/api/service/submit-request", async (req, res) => {
  try {
    const { serviceRequest, setupIntentId, existingServiceCardId } = req.body;

    if (!serviceRequest || !serviceRequest.customerName) {
      return res.status(400).json({
        error: "Missing service request data."
      });
    }

    const serviceCards = await readServiceCards();
    const explicitExistingId =
      existingServiceCardId || serviceRequest.existingServiceCardId || "";

    if (setupIntentId) {
      const existingIndex = serviceCards.findIndex(
        (row) => row.setupIntentId === setupIntentId
      );
      const existingByIdIndex =
        existingIndex >= 0
          ? existingIndex
          : explicitExistingId
            ? serviceCards.findIndex((row) => row.id === explicitExistingId)
            : -1;

      if (existingByIdIndex >= 0) {
        serviceCards[existingByIdIndex] = {
          ...serviceCards[existingByIdIndex],
          updatedAt: new Date().toISOString(),
          setupIntentId: setupIntentId || serviceCards[existingByIdIndex].setupIntentId || "",
          customerName: serviceRequest.customerName || "",
          firstName: serviceRequest.firstName || "",
          lastName: serviceRequest.lastName || "",
          customerEmail: serviceRequest.customerEmail || "",
          customerPhone: serviceRequest.customerPhone || "",
          purchasedWithin12Months: serviceRequest.purchasedWithin12Months || "",
          cardRequired: serviceRequest.purchasedWithin12Months !== "Yes",
          gateCode: serviceRequest.gateCode || "",
          contactMethod: serviceRequest.contactMethod || "",
          purchaseDate: serviceRequest.purchaseDate || "",
          serviceAddress: serviceRequest.serviceAddress || {},
          billingAddress: serviceRequest.billingAddress || {},
          billingSameAsService: serviceRequest.billingSameAsService,
          unitCount: serviceRequest.unitCount || "One",
          units: serviceRequest.units || [],
          problemDescription: serviceRequest.problemDescription || "",
          consent: !!serviceRequest.consent
        };

        await writeServiceCards(serviceCards);

        return res.json({
          success: true,
          updatedExisting: true
        });
      }
    }

    if (explicitExistingId) {
      const existingByIdIndex = serviceCards.findIndex((row) => row.id === explicitExistingId);

      if (existingByIdIndex >= 0) {
        serviceCards[existingByIdIndex] = {
          ...serviceCards[existingByIdIndex],
          updatedAt: new Date().toISOString(),
          setupIntentId: setupIntentId || serviceCards[existingByIdIndex].setupIntentId || "",
          setupIntentStatus: setupIntentId
            ? serviceCards[existingByIdIndex].setupIntentStatus || "submitted_not_completed"
            : serviceCards[existingByIdIndex].setupIntentStatus || "not_required",
          customerName: serviceRequest.customerName || "",
          firstName: serviceRequest.firstName || "",
          lastName: serviceRequest.lastName || "",
          customerEmail: serviceRequest.customerEmail || "",
          customerPhone: serviceRequest.customerPhone || "",
          purchasedWithin12Months: serviceRequest.purchasedWithin12Months || "",
          cardRequired: serviceRequest.purchasedWithin12Months !== "Yes",
          gateCode: serviceRequest.gateCode || "",
          contactMethod: serviceRequest.contactMethod || "",
          purchaseDate: serviceRequest.purchaseDate || "",
          serviceAddress: serviceRequest.serviceAddress || {},
          billingAddress: serviceRequest.billingAddress || {},
          billingSameAsService: serviceRequest.billingSameAsService,
          unitCount: serviceRequest.unitCount || "One",
          units: serviceRequest.units || [],
          problemDescription: serviceRequest.problemDescription || "",
          consent: !!serviceRequest.consent
        };

        await writeServiceCards(serviceCards);

        return res.json({
          success: true,
          updatedExisting: true
        });
      }
    }

    serviceCards.unshift({
      id: `svc_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      queueStatus: "Call Status Pending",
      queueStatusNotes: "",
      erpOrderNumber: "",
      setupIntentId: setupIntentId || "",
      setupIntentStatus: setupIntentId ? "submitted_not_completed" : "not_required",
      customerId: "",
      paymentMethodId: "",
      customerName: serviceRequest.customerName || "",
      firstName: serviceRequest.firstName || "",
      lastName: serviceRequest.lastName || "",
      customerEmail: serviceRequest.customerEmail || "",
      customerPhone: serviceRequest.customerPhone || "",
      purchasedWithin12Months: serviceRequest.purchasedWithin12Months || "",
      cardRequired: serviceRequest.purchasedWithin12Months !== "Yes",
      gateCode: serviceRequest.gateCode || "",
      contactMethod: serviceRequest.contactMethod || "",
      purchaseDate: serviceRequest.purchaseDate || "",
      serviceAddress: serviceRequest.serviceAddress || {},
      billingAddress: serviceRequest.billingAddress || {},
      billingSameAsService: serviceRequest.billingSameAsService,
      unitCount: serviceRequest.unitCount || "One",
      units: serviceRequest.units || [],
      problemDescription: serviceRequest.problemDescription || "",
      consent: !!serviceRequest.consent,
      cardBrand: "",
      last4: ""
    });

    await writeServiceCards(serviceCards);

    res.json({
      success: true
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to submit service request."
    });
  }
});


app.post("/api/card-on-file/charge", async (req, res) => {
  try {
    const {
      customerId,
      paymentMethodId,
      amount,
      salesOrder,
      description,
      customerName,
      customerEmail,
      creatorCode,
      creatorName,
      creatorEmail,
      internalNotes,
      hvacDepositRecordId
    } = req.body;

    if (!customerId || !paymentMethodId || !amount || !salesOrder) {
      return res.status(400).json({
        error: "customerId, paymentMethodId, amount, and salesOrder are required"
      });
    }

    const amountInCents = Math.round(Number(amount) * 100);

    if (!Number.isFinite(amountInCents) || amountInCents < 50) {
      return res.status(400).json({
        error: "Amount must be at least $0.50"
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: description || "Service charge",
      metadata: {
        sales_order: salesOrder,
        description: description || "",
        customer_name: customerName || "",
        customer_email: customerEmail || "",
        creator_code: creatorCode || "",
        creator_name: creatorName || "",
        creator_email: creatorEmail || "",
        notes: internalNotes || ""
      }
    });

    const terminalPayments = await readTerminalPayments();
    const alreadyExists = terminalPayments.some(
      (row) => row.paymentIntentId === paymentIntent.id
    );

    if (!alreadyExists && paymentIntent.status === "succeeded") {
      terminalPayments.unshift({
        id: `cof_${Date.now()}`,
        type: "card_on_file",
        createdAt: new Date(paymentIntent.created * 1000).toISOString(),
        customerName: customerName || "",
        customerEmail: customerEmail || "",
        creatorCode: creatorCode || "",
        creatorName: creatorName || "",
        creatorEmail: creatorEmail || "",
        reference: salesOrder || description || "Card on file charge",
        description: description || "Service charge",
        status: "paid",
        paidAmount: (paymentIntent.amount || 0) / 100,
        paidDate: new Date().toISOString(),
        paymentIntentId: paymentIntent.id,
        salesOrder: salesOrder || "",
        notes: internalNotes || ""
      });

      await writeTerminalPayments(terminalPayments);
    }

    if (paymentIntent.status === "succeeded" && hvacDepositRecordId) {
      const links = await readLinks();
      const hvacRecord = links.find((row) => row.id === hvacDepositRecordId);

      if (hvacRecord && normalizeLinkRecord(hvacRecord).workflowType === "hvac_deposit") {
        hvacRecord.balanceChargedAt = new Date().toISOString();
        hvacRecord.balancePaymentIntentId = paymentIntent.id;
        hvacRecord.balancePaidAmount = Number((paymentIntent.amount || 0) / 100);
        hvacRecord.customerId = customerId || hvacRecord.customerId || "";
        hvacRecord.paymentMethodId = paymentMethodId || hvacRecord.paymentMethodId || "";
        await writeLinks(links);
      }
    }

    return res.json({
      success: true,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unable to charge saved card."
    });
  }
});

app.get("/api/service-cards", async (req, res) => {
  try {
    const serviceCards = await readServiceCards();
    res.json({ rows: serviceCards });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load service cards."
    });
  }
});

app.get("/api/hvac-deposits", async (req, res) => {
  try {
    const links = await readLinks();
    let didUpdate = false;
    const rows = [];

    for (const rawRow of links) {
      const row = normalizeLinkRecord(rawRow);

      if (
        row.workflowType !== "hvac_deposit" ||
        row.status !== "paid" ||
        Number(row.balanceAmount || 0) <= 0 ||
        row.balanceChargedAt
      ) {
        continue;
      }

      if ((!row.customerId || !row.paymentMethodId) && row.paymentIntentId) {
        try {
          const paymentIntent = await retrievePaymentIntentWithDetails(row.paymentIntentId);
          row.customerId =
            typeof paymentIntent?.customer === "string"
              ? paymentIntent.customer
              : paymentIntent?.customer?.id || row.customerId || "";
          row.paymentMethodId =
            typeof paymentIntent?.payment_method === "string"
              ? paymentIntent.payment_method
              : paymentIntent?.payment_method?.id || row.paymentMethodId || "";
          didUpdate = true;
          await sleep(120);
        } catch {
          // Leave the record as-is so the dashboard can still render partial data.
        }
      }

      rows.push({
        id: row.id,
        createdAt: row.createdAt || "",
        paidDate: row.paidDate || "",
        customerName: row.customerName || "",
        customerEmail: row.customerEmail || "",
        creatorName: row.creatorName || "",
        creatorCode: row.creatorCode || "",
        salesOrder: row.salesOrder || "",
        description: row.description || "",
        requestedTotalAmount: Number(row.requestedTotalAmount || row.requestedAmount || 0),
        depositAmount: Number(row.depositAmount || row.requestedAmount || 0),
        balanceAmount: Number(row.balanceAmount || 0),
        currency: row.currency || "usd",
        customerId: row.customerId || "",
        paymentMethodId: row.paymentMethodId || "",
        paymentIntentId: row.paymentIntentId || "",
        agreementText: row.agreementText || "",
        paymentStatusDetail: row.paymentStatusDetail || ""
      });
    }

    if (didUpdate) {
      await writeLinks(links);
    }

    rows.sort((a, b) => String(b.paidDate || "").localeCompare(String(a.paidDate || "")));

    const totals = rows.reduce((acc, row) => {
      acc.totalAmount += Number(row.requestedTotalAmount || 0);
      acc.depositAmount += Number(row.depositAmount || 0);
      acc.balanceAmount += Number(row.balanceAmount || 0);
      return acc;
    }, {
      totalAmount: 0,
      depositAmount: 0,
      balanceAmount: 0
    });

    res.json({ rows, totals });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load HVAC deposits."
    });
  }
});

app.get("/api/hvac-deposits/:id", async (req, res) => {
  try {
    const links = await readLinks();
    const row = links.find((item) => item.id === req.params.id);

    if (!row) {
      return res.status(404).json({
        error: "HVAC deposit record not found."
      });
    }

    normalizeLinkRecord(row);

    if (row.workflowType !== "hvac_deposit") {
      return res.status(400).json({
        error: "Record is not an HVAC deposit."
      });
    }

    if ((!row.customerId || !row.paymentMethodId) && row.paymentIntentId) {
      const paymentIntent = await retrievePaymentIntentWithDetails(row.paymentIntentId);
      row.customerId =
        typeof paymentIntent?.customer === "string"
          ? paymentIntent.customer
          : paymentIntent?.customer?.id || row.customerId || "";
      row.paymentMethodId =
        typeof paymentIntent?.payment_method === "string"
          ? paymentIntent.payment_method
          : paymentIntent?.payment_method?.id || row.paymentMethodId || "";
      await writeLinks(links);
    }

    return res.json({
      id: row.id,
      customerName: row.customerName || "",
      customerEmail: row.customerEmail || "",
      creatorCode: row.creatorCode || "",
      creatorName: row.creatorName || "",
      creatorEmail: row.creatorEmail || "",
      salesOrder: row.salesOrder || "",
      description: row.description || "",
      customerId: row.customerId || "",
      paymentMethodId: row.paymentMethodId || "",
      amount: Number(row.balanceAmount || 0),
      paymentIntentId: row.paymentIntentId || "",
      requestedTotalAmount: Number(row.requestedTotalAmount || row.requestedAmount || 0),
      depositAmount: Number(row.depositAmount || row.requestedAmount || 0),
      balanceAmount: Number(row.balanceAmount || 0),
      agreementText: row.agreementText || ""
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load HVAC deposit record."
    });
  }
});

app.post("/api/service-cards/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      queueStatus = "Call Status Pending",
      queueStatusNotes = "",
      erpOrderNumber = ""
    } = req.body || {};

    const allowedStatuses = [
      "Call Status Pending",
      "Call Scheduled",
      "Call Cancelled"
    ];

    if (!allowedStatuses.includes(queueStatus)) {
      return res.status(400).json({
        error: "Invalid queue status."
      });
    }

    const serviceCards = await readServiceCards();
    const index = serviceCards.findIndex((row) => row.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: "Service request not found."
      });
    }

    serviceCards[index] = {
      ...serviceCards[index],
      queueStatus,
      queueStatusNotes,
      erpOrderNumber,
      updatedAt: new Date().toISOString()
    };

    await writeServiceCards(serviceCards);

    res.json({
      success: true,
      row: serviceCards[index]
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to update service call status."
    });
  }
});


// -------------------------
// DASHBOARD: CHECK PAYMENT STATUS
// -------------------------

app.get("/api/payment-link-status", async (req, res) => {
  try {
    const links = await readLinks();
    const terminalPayments = await readTerminalPayments();

    for (const record of links) {
      normalizeLinkRecord(record);
      if (!record.paymentLinkId) continue;

      if (record.status !== "paid") {
        if (record.status === "ach_pending" && record.paymentIntentId) {
          const trackedIntent = await retrievePaymentIntentWithDetails(record.paymentIntentId);

          if (trackedIntent?.status === "succeeded") {
            applyPaidLinkState(record, null, trackedIntent);

            if (!record.paymentNotificationSentAt && record.creatorEmail) {
              try {
                await sendPaymentLinkPaidEmail(record);
                record.paymentNotificationSentAt = new Date().toISOString();
                record.paymentNotificationError = "";
              } catch (notificationError) {
                record.paymentNotificationError = notificationError.message || "Unable to send payment notification.";
              }
            }
          } else if (isAchPendingIntent(trackedIntent, record)) {
            applyAchPendingState(record, null, trackedIntent);
            continue;
          }
        }

        const sessions = await stripe.checkout.sessions.list({
          payment_link: record.paymentLinkId,
          limit: 100
        });

        const paidSession = sessions.data.find(
          (session) => session.payment_status === "paid"
        );
        const intentSessions = sessions.data.filter(
          (session) => session.payment_intent
        );

        if (paidSession) {
          const paymentIntent = paidSession.payment_intent
            ? await retrievePaymentIntentWithDetails(paidSession.payment_intent)
            : null;

          applyPaidLinkState(record, paidSession, paymentIntent);

          if (!record.paymentNotificationSentAt && record.creatorEmail) {
            try {
              await sendPaymentLinkPaidEmail(record);
              record.paymentNotificationSentAt = new Date().toISOString();
              record.paymentNotificationError = "";
            } catch (notificationError) {
              record.paymentNotificationError = notificationError.message || "Unable to send payment notification.";
            }
          }
        } else if (record.status !== "deactivated" && intentSessions.length > 0) {
          const prioritizedIntentSessions = [
            ...intentSessions.filter((session) => session.payment_intent === record.paymentIntentId),
            ...intentSessions.filter((session) => session.payment_intent !== record.paymentIntentId)
          ];

          let achPendingMatch = null;

          for (const session of prioritizedIntentSessions) {
            const paymentIntent = await retrievePaymentIntentWithDetails(session.payment_intent);

            if (isAchPendingIntent(paymentIntent, record)) {
              achPendingMatch = { session, paymentIntent };
              break;
            }
          }

          if (achPendingMatch) {
            applyAchPendingState(record, achPendingMatch.session, achPendingMatch.paymentIntent);
          } else {
            const fallbackSession = prioritizedIntentSessions[0];
            record.status = "viewed";
            record.active = true;
            record.paymentStatusDetail = "";
            record.checkoutSessionId = fallbackSession?.id || record.checkoutSessionId || "";
          }
        } else if (record.status !== "deactivated" && sessions.data.length > 0) {
          record.status = "viewed";
          record.active = true;
        }
      }
    }

    await writeLinks(links);

    const normalizedTerminalPayments = terminalPayments.map((row) => ({
      ...row,
      type: row.type || "terminal",
      reference: row.reference || row.description || row.salesOrder || "",
      status: row.status || "paid",
      active: false
    }));

    const normalizedLinks = links.map((row) => normalizeLinkRecord({ ...row }));

    const combinedRows = [...normalizedTerminalPayments, ...normalizedLinks].sort((a, b) => {
      const aDate = new Date(a.paidDate || a.createdAt || 0).getTime();
      const bDate = new Date(b.paidDate || b.createdAt || 0).getTime();
      return bDate - aDate;
    });

    res.json({
      rows: combinedRows
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

app.get("/api/paid-order-detail", async (req, res) => {
  try {
    const { start, end, search = "" } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "start and end dates are required."
      });
    }

    const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
    const terminalPayments = await readTerminalPayments();
    const paidSourceRowsByPaymentIntentId = new Map(
      [...links, ...terminalPayments]
        .filter((row) => row.paymentIntentId)
        .map((row) => [row.paymentIntentId, row])
    );

    const detailedRows = await getSaleRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId);
    const localFallbackRows = await getLocalFallbackSaleRowsForDateRange(
      start,
      end,
      [...links, ...terminalPayments],
      detailedRows
    );
    detailedRows.push(...localFallbackRows);

    const refundRows = await getRefundRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId);
    detailedRows.push(...refundRows);

    const normalizedSearch = String(search || "").trim().toLowerCase();
    const filteredRows = detailedRows.filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      return [
        row.salesOrder,
        row.customerName,
        row.description,
        row.paymentIntentId
      ].join(" ").toLowerCase().includes(normalizedSearch);
    });

    const totals = filteredRows.reduce((acc, row) => {
      acc.paidAmount += Number(row.paidAmount || 0);
      acc.feeAmount += Number(row.feeAmount || 0);
      acc.netAmount += Number(row.netAmount || 0);
      return acc;
    }, {
      paidAmount: 0,
      feeAmount: 0,
      netAmount: 0
    });

    res.json({
      rows: filteredRows.sort((a, b) => new Date(b.paidDate || 0) - new Date(a.paidDate || 0)),
      totals
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load paid order detail."
    });
  }
});

app.get("/api/bank-balancing", async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "start and end dates are required."
      });
    }

    const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
    const terminalPayments = await readTerminalPayments();
    const sourceRowsByPaymentIntentId = new Map(
      [...links, ...terminalPayments]
        .filter((row) => row.paymentIntentId)
        .map((row) => [row.paymentIntentId, row])
    );

    const payouts = (await listAutomaticPayoutsByArrivalDate(start, end)).filter((payout) =>
      isDateKeyWithinRange(getPayoutArrivalDateKey(payout), start, end)
    );
    const payoutRows = [];
    let payoutAmountTotal = 0;

    for (const payout of payouts) {
      payoutAmountTotal += Number((payout.amount || 0) / 100);
      const rows = await getBankBalancingRowsForPayout(payout, sourceRowsByPaymentIntentId);
      payoutRows.push(...rows);
      await sleep(120);
    }

    const totals = payoutRows.reduce((acc, row) => {
      acc.grossAmount += Number(row.grossAmount || 0);
      acc.feeAmount += Number(row.feeAmount || 0);
      acc.bankPayoutAmount += Number(row.bankPayoutAmount || 0);
      return acc;
    }, {
      grossAmount: 0,
      feeAmount: 0,
      bankPayoutAmount: 0
    });

    res.json({
      rows: payoutRows.sort((a, b) => String(b.arrivalDateKey || "").localeCompare(String(a.arrivalDateKey || ""))),
      totals: {
        ...totals,
        payoutAmountTotal,
        payoutCount: payouts.length
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load bank balancing."
    });
  }
});

app.get("/api/intent-lookup/:kind/:id", async (req, res) => {
  try {
    const kind = String(req.params.kind || "").toLowerCase();
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({
        error: "Intent ID is required."
      });
    }

    if (!["payment_intent", "setup_intent", "auto"].includes(kind)) {
      return res.status(400).json({
        error: "Kind must be payment_intent, setup_intent, or auto."
      });
    }

    const resolvedKind = kind === "auto"
      ? inferIntentKindFromId(id)
      : kind;

    if (!resolvedKind) {
      return res.status(400).json({
        error: "Could not determine whether this is a PaymentIntent or SetupIntent."
      });
    }

    if (resolvedKind === "payment_intent") {
      const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
      const terminalPayments = await readTerminalPayments();
      const localRow =
        [...links, ...terminalPayments].find((row) => row.paymentIntentId === id) || null;
      const paymentIntent = await stripe.paymentIntents.retrieve(id, {
        expand: [
          "customer",
          "payment_method",
          "latest_charge.balance_transaction",
          "latest_charge.payment_method_details",
          "latest_charge.refunds.data.balance_transaction"
        ]
      });

      return res.json(
        buildPaymentIntentLookupResponse(id, paymentIntent, localRow)
      );
    }

    const serviceCards = await readServiceCards();
    const localRow = serviceCards.find((row) => row.setupIntentId === id) || null;
    const setupIntent = await stripe.setupIntents.retrieve(id, {
      expand: [
        "customer",
        "payment_method",
        "latest_attempt"
      ]
    });

    return res.json(
      buildSetupIntentLookupResponse(id, setupIntent, localRow)
    );
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to look up intent."
    });
  }
});

function resolvePaidOrderFields(row) {
  const rawSalesOrder = String(row.salesOrder || "").trim();
  const rawDescription = String(row.description || "").trim();
  const rawReference = String(row.reference || "").trim();

  if (rawSalesOrder) {
    return {
      salesOrder: rawSalesOrder,
      description: rawDescription || (rawReference && rawReference !== rawSalesOrder ? rawReference : "")
    };
  }

  if (rawReference && rawDescription && rawReference !== rawDescription) {
    return {
      salesOrder: rawReference,
      description: rawDescription
    };
  }

  if (looksLikeSalesOrder(rawReference)) {
    return {
      salesOrder: rawReference,
      description: rawDescription && rawDescription !== rawReference ? rawDescription : ""
    };
  }

  if (looksLikeSalesOrder(rawDescription)) {
    return {
      salesOrder: rawDescription,
      description: rawReference && rawReference !== rawDescription ? rawReference : ""
    };
  }

  return {
    salesOrder: "",
    description: rawDescription || rawReference || ""
  };
}

function looksLikeSalesOrder(value) {
  return /^[A-Z]*\d{5,}$/i.test(String(value || "").trim());
}

function inferIntentKindFromId(id) {
  if (/^pi_/i.test(id)) {
    return "payment_intent";
  }

  if (/^seti_/i.test(id)) {
    return "setup_intent";
  }

  return "";
}

function buildPaymentIntentLookupResponse(id, paymentIntent, localRow) {
  const latestCharge = paymentIntent.latest_charge || null;
  const balanceTransaction = latestCharge?.balance_transaction || null;
  const refunds = Array.isArray(latestCharge?.refunds?.data) ? latestCharge.refunds.data : [];
  const metadata = paymentIntent.metadata || {};
  const resolvedFields = resolvePaidOrderFields(localRow || {});
  const paymentMethodType =
    paymentIntent.payment_method_types?.[0] ||
    paymentIntent.payment_method?.type ||
    "";
  const sentAmount =
    typeof localRow?.requestedAmount === "number"
      ? localRow.requestedAmount
      : Number((paymentIntent.amount || 0) / 100);
  const paidAmount =
    typeof localRow?.paidAmount === "number" && localRow.paidAmount > 0
      ? localRow.paidAmount
      : Number((paymentIntent.amount_received || paymentIntent.amount || 0) / 100);

  const events = [];

  if (localRow?.createdAt) {
    events.push({
      date: localRow.createdAt,
      label: "Sent",
      amount: sentAmount,
      reason: resolvedFields.description || paymentIntent.description || "Payment request created"
    });
  }

  if (localRow?.deactivatedAt) {
    events.push({
      date: localRow.deactivatedAt,
      label: "Deactivated",
      amount: 0,
      reason: localRow.deactivationReason || "Payment link deactivated"
    });
  }

  if (localRow?.paidDate || paymentIntent.status === "succeeded") {
    events.push({
      date: localRow?.paidDate || new Date(paymentIntent.created * 1000).toISOString(),
      label: "Paid",
      amount: paidAmount,
      reason: describePaymentMethod(paymentMethodType, paymentIntent.payment_method)
    });
  }

  for (const refund of refunds) {
    events.push({
      date: new Date(refund.created * 1000).toISOString(),
      label: "Refund",
      amount: -Number((refund.amount || 0) / 100),
      reason: formatRefundReason(refund.reason) || "Refund created"
    });
  }

  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  return {
    kind: "payment_intent",
    id,
    summary: {
      employeeName: localRow?.creatorName || metadata.creator_name || "-",
      customerName: localRow?.customerName || metadata.customer_name || paymentIntent.customer?.name || "-",
      customerEmail: localRow?.customerEmail || metadata.customer_email || paymentIntent.customer?.email || "-",
      customerPhone: localRow?.customerPhone || metadata.customer_phone || paymentIntent.customer?.phone || "-",
      salesOrder: resolvedFields.salesOrder || metadata.sales_order || "-",
      description: resolvedFields.description || metadata.link_description || metadata.description || paymentIntent.description || "-",
      intentStatus: paymentIntent.status || "-",
      type: localRow?.type || (paymentMethodType === "us_bank_account" ? "ach_link" : "card_link"),
      paymentMethod: describePaymentMethod(paymentMethodType, paymentIntent.payment_method),
      sentDate: localRow?.createdAt || "",
      paidDate: localRow?.paidDate || "",
      requestedAmount: sentAmount,
      paidAmount,
      feeAmount: Number((balanceTransaction?.fee || 0) / 100),
      netAmount: Number(
        typeof balanceTransaction?.net === "number"
          ? balanceTransaction.net / 100
          : paidAmount - Number((balanceTransaction?.fee || 0) / 100)
      ),
      notes: localRow?.notes || metadata.notes || "",
      deactivationReason: localRow?.deactivationReason || "",
      customerId: paymentIntent.customer?.id || "",
      paymentMethodId: paymentIntent.payment_method?.id || ""
    },
    events
  };
}

function buildSetupIntentLookupResponse(id, setupIntent, localRow) {
  const metadata = setupIntent.metadata || {};
  const paymentMethod = setupIntent.payment_method || null;
  const events = [];
  const createdIso = new Date(setupIntent.created * 1000).toISOString();

  events.push({
    date: localRow?.createdAt || createdIso,
    label: "Setup requested",
    amount: 0,
    reason: "Customer authorization to save card"
  });

  if (setupIntent.status === "succeeded") {
    events.push({
      date: localRow?.updatedAt || createdIso,
      label: "Card saved",
      amount: 0,
      reason: describePaymentMethod(paymentMethod?.type || "card", paymentMethod)
    });
  }

  if (localRow?.queueStatus) {
    events.push({
      date: localRow.updatedAt || createdIso,
      label: localRow.queueStatus,
      amount: 0,
      reason: localRow.queueStatusNotes || "Service queue status updated"
    });
  }

  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  return {
    kind: "setup_intent",
    id,
    summary: {
      employeeName: "-",
      customerName: localRow?.customerName || metadata.customer_name || setupIntent.customer?.name || "-",
      customerEmail: localRow?.customerEmail || metadata.customer_email || setupIntent.customer?.email || "-",
      customerPhone: localRow?.customerPhone || metadata.customer_phone || setupIntent.customer?.phone || "-",
      salesOrder: localRow?.erpOrderNumber || "-",
      description: localRow?.problemDescription || describeUnits(localRow?.units) || "Saved card on file",
      intentStatus: setupIntent.status || "-",
      type: "setup_intent",
      paymentMethod: describePaymentMethod(paymentMethod?.type || "card", paymentMethod),
      sentDate: localRow?.createdAt || createdIso,
      paidDate: "",
      requestedAmount: 0,
      paidAmount: 0,
      feeAmount: 0,
      netAmount: 0,
      notes: localRow?.queueStatusNotes || "",
      deactivationReason: "",
      customerId: setupIntent.customer?.id || localRow?.customerId || "",
      paymentMethodId: paymentMethod?.id || localRow?.paymentMethodId || "",
      queueStatus: localRow?.queueStatus || "-",
      cardBrand: localRow?.cardBrand || paymentMethod?.card?.brand || "",
      last4: localRow?.last4 || paymentMethod?.card?.last4 || ""
    },
    events
  };
}

function describePaymentMethod(type, paymentMethod) {
  const normalizedType = String(type || paymentMethod?.type || "").toLowerCase();

  if (normalizedType === "us_bank_account") {
    const last4 = paymentMethod?.us_bank_account?.last4 || "";
    return last4 ? `ACH bank account ending in ${last4}` : "ACH bank account";
  }

  if (normalizedType === "card" || normalizedType === "card_present") {
    const cardSource = paymentMethod?.card || paymentMethod?.card_present || {};
    const brand = cardSource.brand || "Card";
    const last4 = cardSource.last4 || "";
    return last4 ? `${brand} ending in ${last4}` : brand;
  }

  return normalizedType ? normalizedType.replace(/_/g, " ") : "-";
}

function formatRefundReason(reason) {
  if (!reason) return "";

  return String(reason)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function describeUnits(units) {
  if (!Array.isArray(units) || !units.length) {
    return "";
  }

  return units
    .map((unit) => [unit?.brand, unit?.applianceType].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

async function getSaleRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId) {
  const saleRows = [];
  const paymentIntentCache = new Map();
  let startingAfter = "";
  let keepLoading = true;
  const startUnix = dateKeyToUnixStart(addDaysToDateKey(start, -1));
  const endUnix = dateKeyToUnixEnd(addDaysToDateKey(end, 1));

  while (keepLoading) {
    const page = await listChargesWithRetry({
      limit: 100,
      created: {
        gte: startUnix,
        lte: endUnix
      },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.balance_transaction"]
    });

    if (!page.data.length) {
      break;
    }

    for (const charge of page.data) {
      if (!charge?.paid || charge?.status !== "succeeded") {
        continue;
      }

      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id || "";
      const sourceRow = paidSourceRowsByPaymentIntentId.get(paymentIntentId) || null;
      const paidIso = getSaleReportDateIso(charge, sourceRow);
      const paidDateOnly = toTimeZoneDateKey(paidIso, APP_TIMEZONE);

      if (!paidDateOnly || paidDateOnly < start || paidDateOnly > end) {
        continue;
      }

      const paymentIntent = paymentIntentId
        ? await getCachedPaymentIntent(paymentIntentId, paymentIntentCache)
        : null;

      saleRows.push(buildSaleReportRow(charge, paidIso, sourceRow, paymentIntent));

      if (paymentIntentId) {
        await sleep(120);
      }
    }

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }
  }

  return saleRows;
}

async function getLocalFallbackSaleRowsForDateRange(start, end, sourceRows, existingRows = []) {
  const existingPaymentIntentIds = new Set(
    existingRows
      .filter((row) => row.type === "sale" && row.paymentIntentId)
      .map((row) => row.paymentIntentId)
  );

  const fallbackRows = sourceRows.filter((row) => {
    const paidDateOnly = toTimeZoneDateKey(row.paidDate, APP_TIMEZONE);
    return (
      row.status === "paid" &&
      row.paymentIntentId &&
      paidDateOnly &&
      paidDateOnly >= start &&
      paidDateOnly <= end &&
      !existingPaymentIntentIds.has(row.paymentIntentId)
    );
  });

  const detailedFallbackRows = [];

  for (const row of fallbackRows) {
    const resolvedFields = resolvePaidOrderFields(row);
    const stripeAmounts = await getStripeAmountsForPaymentIntentWithRetry(row.paymentIntentId);

    detailedFallbackRows.push({
      id: row.id || row.paymentIntentId || "",
      type: "sale",
      paidDate: row.paidDate || "",
      salesOrder: resolvedFields.salesOrder,
      customerName: row.customerName || "",
      description: resolvedFields.description,
      paymentIntentId: row.paymentIntentId || "",
      paidAmount: stripeAmounts.grossAmount,
      feeAmount: stripeAmounts.feeAmount,
      netAmount: stripeAmounts.netAmount
    });

    await sleep(120);
  }

  return detailedFallbackRows;
}

async function getRefundRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId) {
  const refundRows = [];
  let startingAfter = "";
  let keepLoading = true;

  while (keepLoading) {
    const page = await stripe.refunds.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.balance_transaction"]
    });

    if (!page.data.length) {
      break;
    }

    for (const refund of page.data) {
      if (!refund?.created) {
        continue;
      }

      const refundIso = new Date(refund.created * 1000).toISOString();
      const refundDateKey = toTimeZoneDateKey(refundIso, APP_TIMEZONE);

      if (refundDateKey < start) {
        keepLoading = false;
        break;
      }

      if (refundDateKey > end) {
        continue;
      }

      if (["failed", "canceled"].includes(refund.status)) {
        continue;
      }

      const sourceRow = paidSourceRowsByPaymentIntentId.get(refund.payment_intent || "") || null;
      const paymentIntent = refund.payment_intent
        ? await retrievePaymentIntentWithDetails(refund.payment_intent)
        : null;

      refundRows.push(buildRefundReportRow(refund, refundIso, sourceRow, paymentIntent));

      if (refund.payment_intent) {
        await sleep(120);
      }
    }

    if (!page.has_more || !keepLoading) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }
  }

  return refundRows;
}

async function listAutomaticPayoutsByArrivalDate(start, end) {
  const payouts = [];
  let startingAfter = "";

  const startUnix = dateKeyToUnixStart(start);
  const endUnix = dateKeyToUnixEnd(end);

  while (true) {
    const page = await listPayoutsWithRetry({
      limit: 100,
      status: "paid",
      arrival_date: {
        gte: startUnix,
        lte: endUnix
      },
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    if (!page.data.length) {
      break;
    }

    payouts.push(
      ...page.data.filter((payout) => payout.automatic !== false)
    );

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }

    await sleep(120);
  }

  return payouts;
}

async function getBankBalancingRowsForPayout(payout, sourceRowsByPaymentIntentId) {
  const rows = [];
  let startingAfter = "";
  const chargeCache = new Map();
  const paymentIntentCache = new Map();

  while (true) {
    const page = await listBalanceTransactionsForPayoutWithRetry(payout.id, startingAfter);

    if (!page.data.length) {
      break;
    }

    for (const transaction of page.data) {
      const row = await buildBankBalancingRow(
        payout,
        transaction,
        sourceRowsByPaymentIntentId,
        chargeCache,
        paymentIntentCache
      );

      if (row) {
        rows.push(row);
      }

      await sleep(120);
    }

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }
  }

  return rows;
}

async function buildBankBalancingRow(
  payout,
  transaction,
  sourceRowsByPaymentIntentId,
  chargeCache,
  paymentIntentCache
) {
  const paymentIntentId = await inferPaymentIntentIdFromBalanceTransaction(transaction, chargeCache);

  if (!paymentIntentId) {
    return null;
  }

  const sourceRow = sourceRowsByPaymentIntentId.get(paymentIntentId) || null;
  const resolvedFields = resolvePaidOrderFields(sourceRow || {});
  const shouldLoadPaymentIntent =
    !sourceRow ||
    !resolvedFields.salesOrder ||
    !resolvedFields.description ||
    !String(sourceRow.customerName || "").trim();
  const paymentIntent = shouldLoadPaymentIntent
    ? await getCachedPaymentIntent(paymentIntentId, paymentIntentCache)
    : null;
  const paymentIntentMetadata = paymentIntent?.metadata || {};
  const sourceObject = transaction.source && typeof transaction.source === "object"
    ? transaction.source
    : null;
  const fallbackCustomerName =
    String(paymentIntentMetadata.customer_name || "").trim() ||
    String(sourceObject?.billing_details?.name || "").trim() ||
    "";
  const fallbackDescription = String(
    paymentIntentMetadata.link_description ||
    paymentIntentMetadata.description ||
    paymentIntent?.description ||
    sourceObject?.description ||
    ""
  ).trim();
  const transactionType = inferBankBalancingType(transaction, sourceObject);

  return {
    id: transaction.id,
    payoutId: payout.id,
    arrivalDateKey: getPayoutArrivalDateKey(payout),
    payoutAmount: Number((payout.amount || 0) / 100),
    paymentIntentId,
    type: transactionType,
    salesOrder: resolvedFields.salesOrder || String(paymentIntentMetadata.sales_order || "").trim(),
    customerName: sourceRow?.customerName || fallbackCustomerName || "-",
    description: resolvedFields.description || fallbackDescription || "-",
    grossAmount: Number((transaction.amount || 0) / 100),
    feeAmount: Number((transaction.fee || 0) / 100),
    bankPayoutAmount: Number((transaction.net || 0) / 100)
  };
}

function inferBankBalancingType(transaction, sourceObject) {
  if (transaction.type === "refund" || transaction.type === "payment_refund" || sourceObject?.object === "refund") {
    return "refund";
  }

  return "sale";
}

async function inferPaymentIntentIdFromBalanceTransaction(transaction, chargeCache) {
  const sourceObject = transaction.source && typeof transaction.source === "object"
    ? transaction.source
    : null;

  if (!sourceObject) {
    return "";
  }

  if (sourceObject.object === "payment_intent") {
    return sourceObject.id || "";
  }

  if (sourceObject.object === "charge") {
    if (typeof sourceObject.payment_intent === "string") {
      return sourceObject.payment_intent;
    }

    const fullCharge = await getCachedCharge(sourceObject.id || "", chargeCache);
    return typeof fullCharge?.payment_intent === "string" ? fullCharge.payment_intent : "";
  }

  if (sourceObject.object === "refund") {
    if (typeof sourceObject.payment_intent === "string") {
      return sourceObject.payment_intent;
    }

    if (typeof sourceObject.charge === "string") {
      const refundCharge = await getCachedCharge(sourceObject.charge, chargeCache);
      return typeof refundCharge?.payment_intent === "string" ? refundCharge.payment_intent : "";
    }
  }

  return "";
}

async function getCachedPaymentIntent(paymentIntentId, paymentIntentCache) {
  if (!paymentIntentId) {
    return null;
  }

  if (paymentIntentCache.has(paymentIntentId)) {
    return paymentIntentCache.get(paymentIntentId);
  }

  const paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(paymentIntentId);
  paymentIntentCache.set(paymentIntentId, paymentIntent);
  return paymentIntent;
}

async function getCachedCharge(chargeId, chargeCache) {
  if (!chargeId) {
    return null;
  }

  if (chargeCache.has(chargeId)) {
    return chargeCache.get(chargeId);
  }

  const charge = await retrieveChargeWithRetry(chargeId);
  chargeCache.set(chargeId, charge);
  return charge;
}

function dateKeyToUnixStart(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 1000);
}

function dateKeyToUnixEnd(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T23:59:59Z`) / 1000);
}

function addDaysToDateKey(dateKey, dayDelta) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(dayDelta || 0));
  return date.toISOString().slice(0, 10);
}

function unixDateToDateKey(unixValue) {
  if (!unixValue) return "";

  return new Date(unixValue * 1000).toISOString().slice(0, 10);
}

function getPayoutArrivalDateKey(payout) {
  return unixDateToDateKey(payout?.arrival_date || payout?.created);
}

function isDateKeyWithinRange(dateKey, startKey, endKey) {
  if (!dateKey || !startKey || !endKey) {
    return false;
  }

  return dateKey >= startKey && dateKey <= endKey;
}

function buildSaleReportRow(charge, paidIso, sourceRow, paymentIntent) {
  const paymentIntentMetadata = paymentIntent?.metadata || {};
  const chargeBalanceTransaction = charge?.balance_transaction || null;
  const fallbackFields = resolvePaidOrderFields(sourceRow || {});
  const salesOrder =
    fallbackFields.salesOrder ||
    String(paymentIntentMetadata.sales_order || charge.metadata?.sales_order || "").trim();
  const description =
    fallbackFields.description ||
    String(
      paymentIntentMetadata.link_description ||
      paymentIntentMetadata.description ||
      charge.metadata?.description ||
      charge.description ||
      ""
    ).trim();
  const customerName =
    sourceRow?.customerName ||
    String(paymentIntentMetadata.customer_name || "").trim() ||
    String(charge.billing_details?.name || "").trim() ||
    "-";

  return {
    id: charge.id,
    type: "sale",
    paidDate: paidIso,
    salesOrder,
    customerName,
    description,
    paymentIntentId:
      (typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id) ||
      sourceRow?.paymentIntentId ||
      "",
    paidAmount: Number((charge.amount || 0) / 100),
    feeAmount: Number(
      typeof chargeBalanceTransaction?.fee === "number"
        ? chargeBalanceTransaction.fee / 100
        : 0
    ),
    netAmount: Number(
      typeof chargeBalanceTransaction?.net === "number"
        ? chargeBalanceTransaction.net / 100
        : Number((charge.amount || 0) / 100)
    )
  };
}

function getSaleReportDateIso(charge, sourceRow) {
  if (sourceRow?.type === "ach_link" && sourceRow?.paidDate) {
    return sourceRow.paidDate;
  }

  return new Date((charge.created || 0) * 1000).toISOString();
}

function buildRefundReportRow(refund, refundIso, sourceRow, paymentIntent) {
  const paymentIntentMetadata = paymentIntent?.metadata || {};
  const refundBalanceTransaction = refund.balance_transaction;
  const fallbackFields = resolvePaidOrderFields(sourceRow || {});
  const salesOrder =
    fallbackFields.salesOrder ||
    String(paymentIntentMetadata.sales_order || "").trim();
  const descriptionBase =
    fallbackFields.description ||
    String(
      paymentIntentMetadata.link_description ||
      paymentIntentMetadata.description ||
      ""
    ).trim();
  const grossAmount = -Number((refund.amount || 0) / 100);
  const feeAmount = -Number(
    typeof refundBalanceTransaction?.fee === "number"
      ? refundBalanceTransaction.fee / 100
      : 0
  );
  const netAmount = Number(
    typeof refundBalanceTransaction?.net === "number"
      ? refundBalanceTransaction.net / 100
      : grossAmount - feeAmount
  );

  return {
    id: refund.id,
    type: "refund",
    paidDate: refundIso,
    salesOrder,
    customerName:
      sourceRow?.customerName ||
      String(paymentIntentMetadata.customer_name || "").trim() ||
      "-",
    description: descriptionBase ? `Refund - ${descriptionBase}` : "Refund",
    paymentIntentId: refund.payment_intent || sourceRow?.paymentIntentId || "",
    paidAmount: grossAmount,
    feeAmount,
    netAmount
  };
}

app.post("/api/service-cards/:id/prefill-link", async (req, res) => {
  try {
    const { id } = req.params;
    const serviceCards = await readServiceCards();
    const index = serviceCards.findIndex((row) => row.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: "Service request not found."
      });
    }

    const token = crypto.randomBytes(24).toString("hex");
    serviceCards[index] = {
      ...serviceCards[index],
      secureCardPrefillToken: token,
      secureCardPrefillUpdatedAt: new Date().toISOString()
    };

    await writeServiceCards(serviceCards);

    const url = `${getServiceBaseUrl(req)}/applianceservice.html?prefill=${encodeURIComponent(token)}`;

    res.json({
      success: true,
      url
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to build secure card link."
    });
  }
});

app.get("/api/service/prefill/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const serviceCards = await readServiceCards();
    const row = serviceCards.find((card) => card.secureCardPrefillToken === token);

    if (!row) {
      return res.status(404).json({
        error: "This secure card link is no longer available."
      });
    }

    res.json({
      serviceCardId: row.id,
      forceCardFlow: true,
      serviceRequest: {
        existingServiceCardId: row.id,
        customerName: row.customerName || "",
        firstName: row.firstName || "",
        lastName: row.lastName || "",
        customerEmail: row.customerEmail || "",
        customerPhone: row.customerPhone || "",
        purchasedWithin12Months: "No",
        serviceAddress: row.serviceAddress || {},
        billingAddress: row.billingAddress || row.serviceAddress || {},
        billingSameAsService: row.billingSameAsService !== false,
        gateCode: row.gateCode || "",
        contactMethod: row.contactMethod || "",
        purchaseDate: row.purchaseDate || "",
        unitCount: row.unitCount || (row.units?.length > 1 ? "Multiple" : "One"),
        units: row.units || [],
        problemDescription: row.problemDescription || "",
        consent: true,
        nameOnCard: row.customerName || ""
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load prefilled service request."
    });
  }
});

app.patch("/api/payment-links/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body || {};
    const links = await readLinks();
    const record = links.find((row) => row.id === id);

    if (!record) {
      return res.status(404).json({
        error: "Payment link record not found."
      });
    }

    normalizeLinkRecord(record);

    if (record.status === "paid") {
      return res.status(400).json({
        error: "Paid links cannot be updated."
      });
    }

    if (!["sent", "deactivated"].includes(status)) {
      return res.status(400).json({
        error: "Status must be either sent or deactivated."
      });
    }

    if (record.paymentLinkId) {
      const stripeUpdate = {
        active: status === "sent"
      };

      if (status === "deactivated") {
        stripeUpdate.inactive_message =
          reason || "This link is no longer active. Please call or text Wilson AC & Appliance at 512-894-0907 if you are attempting to make a payment and are seeing this message.";
      }

      await stripe.paymentLinks.update(record.paymentLinkId, stripeUpdate);
    }

    record.status = status;
    record.active = status === "sent";
    record.deactivatedAt = status === "deactivated" ? new Date().toISOString() : "";
    record.deactivationReason = status === "deactivated" ? (reason || "") : "";

    await writeLinks(links);

    res.json({
      success: true,
      record: normalizeLinkRecord({ ...record })
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to update payment link status."
    });
  }
});

async function readJson(filePath, fallback = []) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    console.error(`Error reading JSON from ${filePath}:`, err);
    throw err;
  }
}

async function writeJson(filePath, data) {
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Error writing JSON to ${filePath}:`, err);
    throw err;
  }
}

async function readLinks() {
  return readJson(LINKS_FILE, []);
}

async function writeLinks(data) {
  return writeJson(LINKS_FILE, data);
}

async function readTerminalPayments() {
  return readJson(TERMINAL_PAYMENTS_FILE, []);
}

async function writeTerminalPayments(data) {
  return writeJson(TERMINAL_PAYMENTS_FILE, data);
}

async function readServiceCards() {
  return readJson(SERVICE_CARDS_FILE, []);
}

async function writeServiceCards(data) {
  return writeJson(SERVICE_CARDS_FILE, data);
}

function normalizeLinkRecord(record) {
  const normalized = record;
  normalized.type = normalized.type || "card_link";
  normalized.reference =
    normalized.reference ||
    normalized.description ||
    normalized.salesOrder ||
    "";
  normalized.active = typeof normalized.active === "boolean"
    ? normalized.active
    : normalized.status !== "deactivated";
  normalized.deactivatedAt = normalized.deactivatedAt || "";
  normalized.deactivationReason = normalized.deactivationReason || "";
  normalized.creatorCode = normalized.creatorCode || "";
  normalized.creatorName = normalized.creatorName || "";
  normalized.creatorEmail = normalized.creatorEmail || "";
  normalized.department = normalized.department || "";
  normalized.paymentMethodType = normalized.paymentMethodType || "";
  normalized.paymentStatusDetail = normalized.paymentStatusDetail || "";
  normalized.paymentNotificationSentAt = normalized.paymentNotificationSentAt || "";
  normalized.paymentNotificationError = normalized.paymentNotificationError || "";

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

async function getStripeAmountsForPaymentIntent(paymentIntentId) {
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

async function getStripeAmountsForPaymentIntentWithRetry(paymentIntentId, attempt = 0) {
  try {
    return await getStripeAmountsForPaymentIntent(paymentIntentId);
  } catch (err) {
    const shouldRetry =
      err?.statusCode === 429 ||
      err?.code === "rate_limit" ||
      err?.type === "StripeRateLimitError";

    if (!shouldRetry || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return getStripeAmountsForPaymentIntentWithRetry(paymentIntentId, attempt + 1);
  }
}

async function listPayoutsWithRetry(params, attempt = 0) {
  try {
    return await stripe.payouts.list(params);
  } catch (err) {
    const shouldRetry =
      err?.statusCode === 429 ||
      err?.code === "rate_limit" ||
      err?.type === "StripeRateLimitError";

    if (!shouldRetry || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return listPayoutsWithRetry(params, attempt + 1);
  }
}

async function listChargesWithRetry(params, attempt = 0) {
  try {
    return await stripe.charges.list(params);
  } catch (err) {
    const shouldRetry =
      err?.statusCode === 429 ||
      err?.code === "rate_limit" ||
      err?.type === "StripeRateLimitError";

    if (!shouldRetry || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return listChargesWithRetry(params, attempt + 1);
  }
}

async function listBalanceTransactionsForPayoutWithRetry(payoutId, startingAfter = "", attempt = 0) {
  try {
    return await stripe.balanceTransactions.list({
      payout: payoutId,
      limit: 100,
      expand: ["data.source"],
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });
  } catch (err) {
    const shouldRetry =
      err?.statusCode === 429 ||
      err?.code === "rate_limit" ||
      err?.type === "StripeRateLimitError";

    if (!shouldRetry || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return listBalanceTransactionsForPayoutWithRetry(payoutId, startingAfter, attempt + 1);
  }
}

async function retrievePaymentIntentWithDetailsWithRetry(paymentIntentId, attempt = 0) {
  try {
    return await retrievePaymentIntentWithDetails(paymentIntentId);
  } catch (err) {
    const shouldRetry =
      err?.statusCode === 429 ||
      err?.code === "rate_limit" ||
      err?.type === "StripeRateLimitError";

    if (!shouldRetry || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return retrievePaymentIntentWithDetailsWithRetry(paymentIntentId, attempt + 1);
  }
}

async function retrieveChargeWithRetry(chargeId, attempt = 0) {
  try {
    return await stripe.charges.retrieve(chargeId);
  } catch (err) {
    const shouldRetry =
      err?.statusCode === 429 ||
      err?.code === "rate_limit" ||
      err?.type === "StripeRateLimitError";

    if (!shouldRetry || attempt >= 4) {
      throw err;
    }

    const delayMs = 500 * Math.pow(2, attempt);
    await sleep(delayMs);
    return retrieveChargeWithRetry(chargeId, attempt + 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTimeZoneDateKey(isoValue, timeZone) {
  if (!isoValue) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(isoValue));
}

async function processCheckoutSessionWebhookEvent(event) {
  const session = event.data?.object;

  if (!session?.payment_link) {
    return;
  }

  const links = await readLinks();
  const record = links.find((row) =>
    row.paymentLinkId === session.payment_link ||
    row.checkoutSessionId === session.id ||
    row.paymentIntentId === session.payment_intent
  );

  if (!record) {
    return;
  }

  normalizeLinkRecord(record);

  const paymentIntent = session.payment_intent
    ? await retrievePaymentIntentWithDetails(session.payment_intent)
    : null;

  if (event.type === "checkout.session.completed") {
    if (paymentIntent?.status === "succeeded") {
      applyPaidLinkState(record, session, paymentIntent);
      await maybeSendLinkPaidNotification(record);
    } else if (isAchPendingIntent(paymentIntent, record)) {
      applyAchPendingState(record, session, paymentIntent);
    }
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    applyPaidLinkState(record, session, paymentIntent);
    await maybeSendLinkPaidNotification(record);
  }

  if (event.type === "checkout.session.async_payment_failed") {
    record.status = "viewed";
    record.type = "ach_link";
    record.active = true;
    record.paymentMethodType = "us_bank_account";
    record.paymentStatusDetail = "failed";
    record.paymentIntentId = paymentIntent?.id || record.paymentIntentId || "";
    record.checkoutSessionId = session.id || record.checkoutSessionId || "";
  }

  await writeLinks(links);
}

function applyPaidLinkState(record, session, paymentIntent) {
  const paymentMethodType = inferPaymentMethodType(paymentIntent, session);

  record.status = "paid";
  record.active = false;
  record.type = paymentMethodType === "us_bank_account" ? "ach_link" : "card_link";
  record.paymentMethodType = paymentMethodType;
  record.paymentStatusDetail = paymentIntent?.status || "succeeded";
  record.paidAmount = Number(
    typeof session?.amount_total === "number"
      ? session.amount_total / 100
      : typeof paymentIntent?.amount_received === "number"
        ? paymentIntent.amount_received / 100
        : record.paidAmount || 0
  );
  record.paidDate = new Date().toISOString();
  record.paymentIntentId = paymentIntent?.id || session?.payment_intent || record.paymentIntentId || "";
  record.checkoutSessionId = session?.id || record.checkoutSessionId || "";
  record.customerId =
    typeof paymentIntent?.customer === "string"
      ? paymentIntent.customer
      : paymentIntent?.customer?.id || record.customerId || "";
  record.paymentMethodId =
    typeof paymentIntent?.payment_method === "string"
      ? paymentIntent.payment_method
      : paymentIntent?.payment_method?.id || record.paymentMethodId || "";
}

function applyAchPendingState(record, session, paymentIntent) {
  record.status = "ach_pending";
  record.type = "ach_link";
  record.active = true;
  record.paymentMethodType =
    inferPaymentMethodType(paymentIntent, session) ||
    record.paymentMethodType ||
    "us_bank_account";
  record.paymentStatusDetail = paymentIntent?.status || "processing";
  record.paymentIntentId = paymentIntent?.id || session?.payment_intent || record.paymentIntentId || "";
  record.checkoutSessionId = session?.id || record.checkoutSessionId || "";
}

async function maybeSendLinkPaidNotification(record) {
  if (!record.paymentNotificationSentAt && record.creatorEmail) {
    try {
      await sendPaymentLinkPaidEmail(record);
      record.paymentNotificationSentAt = new Date().toISOString();
      record.paymentNotificationError = "";
    } catch (notificationError) {
      record.paymentNotificationError = notificationError.message || "Unable to send payment notification.";
    }
  }
}

async function retrievePaymentIntentWithDetails(paymentIntentId) {
  return stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"]
  });
}

function inferPaymentMethodType(paymentIntent, session) {
  return (
    paymentIntent?.payment_method_types?.[0] ||
    session?.payment_method_types?.[0] ||
    ""
  );
}

function isAchPendingIntent(paymentIntent, record = null) {
  return (
    paymentIntent?.status === "processing" &&
    (
      paymentIntent?.payment_method_types?.includes("us_bank_account") ||
      paymentIntent?.payment_method?.type === "us_bank_account" ||
      record?.paymentMethodType === "us_bank_account" ||
      record?.type === "ach_link" ||
      record?.status === "ach_pending"
    )
  );
}

async function sendPaymentLinkPaidEmail(record) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Paid email notification is not configured.");
  }

  const recipient = record.creatorEmail;

  if (!recipient) {
    throw new Error("No creator email address is saved for this link.");
  }

  const paidDate = record.paidDate
    ? new Date(record.paidDate).toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : "just now";

  const subject = `Payment received: ${record.salesOrder || record.description || "payment link"}`;
  const text = [
    `Hi ${record.creatorName || record.creatorCode || "team"},`,
    "",
    "A payment link has been paid.",
    `Customer: ${record.customerName || "-"}`,
    `Sales order: ${record.salesOrder || "-"}`,
    `Description: ${record.description || "-"}`,
    `Amount paid: $${Number(record.paidAmount || 0).toFixed(2)}`,
    `Paid date: ${paidDate}`,
    `Payment intent: ${record.paymentIntentId || "-"}`,
    "",
    "Wilson AC & Appliance Payments"
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Hi ${escapeHtmlForEmail(record.creatorName || record.creatorCode || "team")},</p>
      <p>A payment link has been paid.</p>
      <ul>
        <li><strong>Customer:</strong> ${escapeHtmlForEmail(record.customerName || "-")}</li>
        <li><strong>Sales order:</strong> ${escapeHtmlForEmail(record.salesOrder || "-")}</li>
        <li><strong>Description:</strong> ${escapeHtmlForEmail(record.description || "-")}</li>
        <li><strong>Amount paid:</strong> $${Number(record.paidAmount || 0).toFixed(2)}</li>
        <li><strong>Paid date:</strong> ${escapeHtmlForEmail(paidDate)}</li>
        <li><strong>Payment intent:</strong> ${escapeHtmlForEmail(record.paymentIntentId || "-")}</li>
      </ul>
      <p>Wilson AC & Appliance Payments</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [recipient],
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email API error: ${response.status} ${errorText}`);
  }
}

function escapeHtmlForEmail(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}





const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});
