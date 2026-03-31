import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const linksFile = path.join(__dirname, "links.json");
const terminalPaymentsFile = path.join(__dirname, "terminal-payments.json");

const serviceCardsFile = path.join(__dirname, "service-cards.json");

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.use(express.static(__dirname, { index: false }));

import fsSync from "fs";
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

app.use((req, res, next) => {
  const openPaths = ["/favicon.ico"];
  if (openPaths.includes(req.path)) {
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

// -------------------------
// EXISTING PAYMENT LINK ROUTE
// -------------------------
app.post("/api/create-payment-link", async (req, res) => {
  try {
    const { customerName, customerEmail, amount, currency, description, notes } = req.body;

    const unitAmount = Math.round(Number(amount) * 100);

    const product = await stripe.products.create({
      name: description || "Customer payment"
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
      metadata: {
        customer_name: customerName || "",
        customer_email: customerEmail || "",
        description: description || "",
        notes: notes || ""
      }
    });

    const links = await readLinks();

    links.unshift({
      id: `req_${Date.now()}`,
      createdAt: new Date().toISOString(),
      customerName: customerName || "",
      customerEmail: customerEmail || "",
      description: description || "",
      notes: notes || "",
      requestedAmount: Number(amount) || 0,
      currency: currency || "usd",
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.url,
      status: "sent",
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
      customerEmail,
      notes,
      readerId
    } = req.body;

    if (!amount || !readerId) {
      return res.status(400).json({
        error: "amount and readerId are required"
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
        customer_name: customerName || "",
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
            state: serviceAddress.state || undefined,
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
    const exists = serviceCards.some((row) => row.setupIntentId === setupIntent.id);

    if (!exists) {
      serviceCards.unshift({
        id: `svc_${Date.now()}`,
        createdAt: new Date(setupIntent.created * 1000).toISOString(),
        setupIntentId: setupIntent.id,
        customerId: customer?.id || "",
        paymentMethodId: paymentMethod?.id || "",
        customerName: customer?.name || setupIntent.metadata?.customer_name || "",
        customerEmail: customer?.email || setupIntent.metadata?.customer_email || "",
        customerPhone: customer?.phone || setupIntent.metadata?.customer_phone || "",
        salesOrder: setupIntent.metadata?.sales_order || "",
        serviceAddress: setupIntent.metadata?.service_address || "",
        brand: setupIntent.metadata?.brand || "",
        model: setupIntent.metadata?.model || "",
        serial: setupIntent.metadata?.serial || "",
        purchaseDate: setupIntent.metadata?.purchase_date || "",
        problemDescription: setupIntent.metadata?.problem_description || "",
        cardBrand: brand,
        last4
      });

      await writeServiceCards(serviceCards);
    }

    res.json({
      setupIntentId: setupIntent.id,
      customerId: customer?.id || "",
      paymentMethodId: paymentMethod?.id || "",
      customerName: customer?.name || "",
      customerEmail: customer?.email || "",
      cardBrand: brand,
      last4
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to retrieve setup intent result."
    });
  }
});


app.post("/api/card-on-file/charge", async (req, res) => {
  try {
    const { customerId, paymentMethodId, amount, description } = req.body;

    if (!customerId || !paymentMethodId || !amount) {
      return res.status(400).json({
        error: "customerId, paymentMethodId, and amount are required"
      });
    }

    const amountInCents = Math.round(Number(amount) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: description || "Service charge"
    });

    res.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to charge saved card"
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

    const today = new Date().toISOString().slice(0, 10);

    for (const record of links) {
      if (!record.paymentLinkId) continue;

      const sessions = await stripe.checkout.sessions.list({
        payment_link: record.paymentLinkId,
        limit: 100
      });

      const paidSession = sessions.data.find(
        (session) => session.payment_status === "paid"
      );

      if (paidSession) {
        record.type = "link";
        record.reference = record.description || "";
        record.status = "paid";
        record.paidAmount = (paidSession.amount_total || 0) / 100;
        record.paidDate = paidSession.created
          ? new Date(paidSession.created * 1000).toISOString()
          : "";
        record.paymentIntentId = paidSession.payment_intent || "";
        record.checkoutSessionId = paidSession.id || "";
      } else {
        record.type = "link";
        record.reference = record.description || "";
      }
    }

    await writeLinks(links);

    const combinedRows = [...terminalPayments, ...links].sort((a, b) => {
      const aDate = new Date(a.paidDate || a.createdAt || 0).getTime();
      const bDate = new Date(b.paidDate || b.createdAt || 0).getTime();
      return bDate - aDate;
    });

    const paidRows = combinedRows.filter(
      (row) => row.status === "paid" && (row.paidDate || "").slice(0, 10) === today
    );

    const paidTotal = paidRows.reduce((sum, row) => sum + (row.paidAmount || 0), 0);
    const avgTicket = paidRows.length ? paidTotal / paidRows.length : 0;
    const openCount = combinedRows.filter((row) => row.status !== "paid").length;

    res.json({
      summary: {
        paidTotal,
        paidCount: paidRows.length,
        avgTicket,
        openCount
      },
      rows: combinedRows
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});


async function readLinks() {
  try {
    const raw = await fs.readFile(linksFile, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function readServiceCards() {
  try {
    const raw = await fs.readFile(serviceCardsFile, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeServiceCards(data) {
  await fs.writeFile(serviceCardsFile, JSON.stringify(data, null, 2), "utf8");
}

async function writeLinks(data) {
  await fs.writeFile(linksFile, JSON.stringify(data, null, 2), "utf8");
}

async function readTerminalPayments() {
  try {
    const raw = await fs.readFile(terminalPaymentsFile, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeTerminalPayments(data) {
  await fs.writeFile(terminalPaymentsFile, JSON.stringify(data, null, 2), "utf8");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});