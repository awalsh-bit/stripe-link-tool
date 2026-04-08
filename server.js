import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

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
app.use(cors());


app.use((req, res, next) => {
  const openExactPaths = [
    "/favicon.ico",
    "/applianceservice.html",
    "/terms.html",
    "/api/config",
    "/api/service/setup-intent",
    "/api/service/submit-request"
  ];

  const openPrefixPaths = [
    "/api/service/setup-intent-result/"
  ];

  if (
    openExactPaths.includes(req.path) ||
    openPrefixPaths.some((prefix) => req.path.startsWith(prefix))
  ) {
    return next();
  }

  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Wilson Payments"');
    return res.status(401).send("Authentication required.");
  }

  const base64Credentials = auth.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
  const [username, password] = credentials.split(":");

  if (
    username !== process.env.APP_USERNAME ||
    password !== process.env.APP_PASSWORD
  ) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Wilson Payments"');
    return res.status(401).send("Invalid credentials.");
  }

  next();
});

app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  process.env.PAYMENT_NOTIFICATION_FROM_EMAIL ||
  "";





app.use(express.static(__dirname, { index: false }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});



// -------------------------
// EXISTING PAYMENT LINK ROUTE
// -------------------------
app.post("/api/create-payment-link", async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      customerPhoneDigits,
      customerEmail,
      creatorCode,
      creatorName,
      creatorEmail,
      salesOrder,
      amount,
      currency,
      description,
      notes
    } = req.body;

    if (!amount || !salesOrder || !customerPhone) {
      return res.status(400).json({
        error: "amount, salesOrder, and customerPhone are required"
      });
    }

    const unitAmount = Math.round(Number(amount) * 100);
if (!Number.isFinite(unitAmount) || unitAmount < 50) {
  return res.status(400).json({
    error: "Amount must be at least $0.50"
  });
}

const product = await stripe.products.create({
  name: salesOrder || "Customer payment"
});

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: unitAmount,
      currency: currency || "usd"
    });

const paymentLink = await stripe.paymentLinks.create({
  line_items: [
    {
      price: price.id,
      quantity: 1
    }
  ],
      payment_intent_data: {
    description: salesOrder || description || "Customer payment",
    metadata: {
      sales_order: salesOrder || "",
      customer_name: customerName || "",
      customer_phone: customerPhoneDigits || customerPhone || "",
      customer_email: customerEmail || "",
      creator_code: creatorCode || "",
      creator_name: creatorName || "",
      creator_email: creatorEmail || "",
      notes: notes || "",
      link_description: description || ""
    }
  },
  metadata: {
    sales_order: salesOrder || "",
    customer_name: customerName || "",
    customer_phone: customerPhoneDigits || customerPhone || "",
    customer_email: customerEmail || "",
    creator_code: creatorCode || "",
    creator_name: creatorName || "",
    creator_email: creatorEmail || "",
    notes: notes || "",
    link_description: description || ""
  }
});

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
      salesOrder: salesOrder || "",
      description: description || "",
      notes: notes || "",
      requestedAmount: Number(amount) || 0,
      currency: currency || "usd",
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.url,
      status: "sent",
      active: true,
      deactivatedAt: "",
      deactivationReason: "",
      paymentNotificationSentAt: "",
      paymentNotificationError: "",
      paidAmount: 0,
      paidDate: "",
      paymentIntentId: "",
      checkoutSessionId: ""
    });

    await writeLinks(links);

    res.json({
      url: paymentLink.url,
      paymentLinkId: paymentLink.id
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
    customer_name: customerName || "",
    customer_phone: customerPhoneDigits || customerPhone || "",
    customer_email: customerEmail || "",
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
          reference: paymentIntent.description || "",
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
    const existingIndex = serviceCards.findIndex(
      (row) => row.setupIntentId === setupIntent.id
    );

    const stripeFields = {
      customerId: customer?.id || "",
      paymentMethodId: paymentMethod?.id || "",
      cardBrand: brand,
      last4,
      setupIntentStatus: setupIntent.status,
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      serviceCards[existingIndex] = {
        ...serviceCards[existingIndex],
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
    const { serviceRequest, setupIntentId } = req.body;

    if (!serviceRequest || !serviceRequest.customerName) {
      return res.status(400).json({
        error: "Missing service request data."
      });
    }

    const serviceCards = await readServiceCards();

    if (setupIntentId) {
      const existingIndex = serviceCards.findIndex(
        (row) => row.setupIntentId === setupIntentId
      );

      if (existingIndex >= 0) {
        serviceCards[existingIndex] = {
          ...serviceCards[existingIndex],
          updatedAt: new Date().toISOString(),
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
      internalNotes
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
        customer_name: customerName || "",
        customer_email: customerEmail || "",
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
        const sessions = await stripe.checkout.sessions.list({
          payment_link: record.paymentLinkId,
          limit: 100
        });

        const paidSession = sessions.data.find(
          (session) => session.payment_status === "paid"
        );

        if (paidSession) {
          record.status = "paid";
          record.active = false;
          record.paidAmount = (paidSession.amount_total || 0) / 100;
          record.paidDate = paidSession.created
            ? new Date(paidSession.created * 1000).toISOString()
            : "";
          record.paymentIntentId = paidSession.payment_intent || "";
          record.checkoutSessionId = paidSession.id || "";

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
          reason || "This payment link is no longer active. Please contact Wilson AC & Appliance.";
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
  normalized.type = "link";
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
  normalized.paymentNotificationSentAt = normalized.paymentNotificationSentAt || "";
  normalized.paymentNotificationError = normalized.paymentNotificationError || "";

  if (normalized.paidDate || Number(normalized.paidAmount) > 0) {
    normalized.status = "paid";
    normalized.active = false;
  } else if (normalized.status === "deactivated" || normalized.active === false) {
    normalized.status = "deactivated";
    normalized.active = false;
  } else {
    normalized.status = "sent";
    normalized.active = true;
  }

  return normalized;
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
