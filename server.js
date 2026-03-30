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

import fsSync from "fs";
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
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

app.listen(3000, () => {
  console.log("Running on http://localhost:3000");
});