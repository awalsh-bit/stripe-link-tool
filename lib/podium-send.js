// ---------------------------------------------------------------------------
// Customer texting via Podium — the showroom number, with replies landing in
// the Podium inbox the team actually watches (unlike DispatchTrack's hosted
// number and orphaned dashboard).
//
// Transports, checked in order:
//   1. Podium OAuth connection (lib/podium.js — the developer app, connected
//      once by an exec). The preferred production path.
//   2. Static token: PODIUM_API_TOKEN + PODIUM_LOCATION_UID env
//      (PODIUM_API_BASE override for tests).
//   3. Zapier bridge: PODIUM_SEND_HOOK is a Zapier catch-hook URL whose Zap
//      runs Podium's stock "Send Message" action.
//
// If none is configured, sends report ok:false and callers log the miss
// instead of crashing.
// ---------------------------------------------------------------------------

import { podiumOAuthConfigured, podiumConnected, podiumSendMessage } from "./podium.js";

export function podiumSendConfigured() {
  return Boolean(podiumOAuthConfigured() || process.env.PODIUM_API_TOKEN || process.env.PODIUM_SEND_HOOK);
}

export async function sendCustomerText({ phone, body }) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 10 && !(digits.length === 11 && digits.startsWith("1"))) {
    return { ok: false, error: "bad_phone" };
  }
  const to = digits.length === 11 ? digits.slice(1) : digits;
  const message = String(body || "").trim().slice(0, 1200);
  if (!message) return { ok: false, error: "empty_body" };

  if (podiumOAuthConfigured()) {
    try {
      if (await podiumConnected()) {
        await podiumSendMessage({ phone: to, body: message });
        return { ok: true, transport: "oauth" };
      }
    } catch (err) {
      console.error("Podium OAuth send failed:", err.message);
      return { ok: false, error: "podium_oauth_failed", transport: "oauth" };
    }
  }

  const apiToken = process.env.PODIUM_API_TOKEN;
  const locationUid = process.env.PODIUM_LOCATION_UID;
  if (apiToken && locationUid) {
    try {
      const base = (process.env.PODIUM_API_BASE || "https://api.podium.com").replace(/\/$/, "");
      const res = await fetch(`${base}/v4/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: { type: "phone", identifier: to },
          body: message,
          locationUid
        })
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("Podium send failed:", res.status, text.slice(0, 200));
        return { ok: false, error: `podium_${res.status}`, transport: "api" };
      }
      return { ok: true, transport: "api" };
    } catch (err) {
      console.error("Podium send failed:", err.message);
      return { ok: false, error: "podium_unreachable", transport: "api" };
    }
  }

  const hook = process.env.PODIUM_SEND_HOOK;
  if (hook) {
    try {
      const res = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: to, body: message })
      });
      if (!res.ok) return { ok: false, error: `hook_${res.status}`, transport: "zapier" };
      return { ok: true, transport: "zapier" };
    } catch (err) {
      console.error("Podium hook send failed:", err.message);
      return { ok: false, error: "hook_unreachable", transport: "zapier" };
    }
  }

  return { ok: false, error: "not_configured" };
}
