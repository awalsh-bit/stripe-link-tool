// Sends a test email through Resend using the same env vars the app uses.
//   node scripts/test-resend.js you@wilsonappliance.com
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL in .env (or the environment).
import "dotenv/config";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  process.env.PAYMENT_NOTIFICATION_FROM_EMAIL ||
  "";

const recipient = process.argv[2];

if (!recipient || !recipient.includes("@")) {
  console.error("Usage: node scripts/test-resend.js you@wilsonappliance.com");
  process.exit(1);
}

if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
  console.error("Missing RESEND_API_KEY and/or RESEND_FROM_EMAIL in the environment.");
  process.exit(1);
}

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RESEND_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    from: RESEND_FROM_EMAIL,
    to: [recipient],
    subject: "Resend test — Wilson internal tools",
    text: [
      "This is a test email from the Wilson payments/ops tool.",
      "",
      `From: ${RESEND_FROM_EMAIL}`,
      `Sent: ${new Date().toISOString()}`,
      "",
      "If you received this, Resend is configured correctly and the",
      "invite / verification / password-reset emails will work."
    ].join("\n")
  })
});

const body = await response.text();

if (response.ok) {
  console.log(`Sent. Resend response: ${body}`);
  console.log("Check the inbox (and spam folder) for the test message.");
} else {
  console.error(`Send failed (${response.status}): ${body}`);
  if (response.status === 403 && body.includes("domain is not verified")) {
    console.error("The domain is not verified yet — finish the DNS records and click 'Verify DNS Records' in Resend.");
  }
  process.exit(1);
}
