// ---------------------------------------------------------------------------
// EVENT EMAIL (Andrew 11/18): "a 100 email address Resend tool for
// communicating events. We'd like to attach PDFs if possible."
//
// From an event on Event RSVPs, a person picks guests off the roster, adds any
// other addresses, writes a subject and a message, attaches PDFs and sends.
// Everyone gets their own email (nobody sees anyone else's address), so the
// message can greet each one by first name. Resend's batch endpoint takes no
// attachments, so each email is its own POST /emails, paced under Resend's
// 10-requests-a-second team limit (the rest of the app shares that limit).
//
// This file is the part with no database: reading pasted addresses, putting
// the email together, checking PDFs, and the sending loop. Storage is
// lib/event-email-postgres.js; the routes are in server.js.
//
// Nothing here sends on its own. A send only ever starts from a person's
// click (Andrew's no-surprise-contact rule); an interrupted send waits for a
// person to press "Send to the rest".
// ---------------------------------------------------------------------------

export const EVENT_EMAIL_MAX_RECIPIENTS = 100;
export const EVENT_EMAIL_MAX_FILES = 5;
export const EVENT_EMAIL_MAX_BYTES = 10 * 1024 * 1024; // all PDFs together; Resend allows 40 MB per email after Base64
export const EVENT_EMAIL_SUBJECT_MAX = 150;
export const EVENT_EMAIL_BODY_MAX = 10000;

// The business line in every footer (as on the shop's pages). A commercial
// email carries a physical address and a way to stop getting them.
export const WILSON_FOOTER = "Wilson AC & Appliance · 4205 E Hwy 290, Dripping Springs, TX 78620 · 512-894-0907";

const EMAIL_RE = /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[^\s@<>(),;:"\[\]\\]{2,}$/;
export const isEmailAddress = (e) => EMAIL_RE.test(String(e || "")) && String(e).length <= 254;
export const emailKey = (e) => String(e || "").trim().toLowerCase();

// Pasted addresses -> [{ email, name }] plus what could not be read.
// Takes one per line, or several per line split by commas or semicolons, in
// any of: jane@x.com · Jane Doe <jane@x.com> · "Doe, Jane" <jane@x.com>.
export function parseAddressList(textIn) {
  const text = String(textIn || "").slice(0, 50000);
  const found = [], invalid = [];
  // Quoted names may hold commas; take "Name" <email> and Name <email> whole
  // first, then split what is left on commas, semicolons and line breaks.
  const rest = text.replace(/"([^"\n]*)"\s*<([^<>\n]*)>|([^,;\n<>"]*)<([^<>\n]*)>/g, (m, qn, qe, n, e) => {
    const email = emailKey(qe ?? e);
    const name = String(qn ?? n ?? "").trim().replace(/\s+/g, " ");
    if (isEmailAddress(email)) found.push({ email, name: name.slice(0, 80) }); else invalid.push(m.trim().slice(0, 120));
    return "\n";
  });
  for (const raw of rest.split(/[,;\n\r\t]+/)) {
    const tok = raw.trim().replace(/^mailto:/i, "");
    if (!tok) continue;
    const email = emailKey(tok);
    if (isEmailAddress(email)) found.push({ email, name: "" });
    else invalid.push(tok.slice(0, 120));
  }
  return { found, invalid };
}

// Roster picks and pasted extras -> one list, one entry per address (the
// roster's name wins), with opted-out addresses held back.
export function buildRecipients({ invitees = [], extras = [], optedOut = new Set() } = {}) {
  const byEmail = new Map();
  const add = (r) => {
    const email = emailKey(r.email);
    if (!isEmailAddress(email)) return;
    const had = byEmail.get(email);
    if (had) { if (!had.name && r.name) had.name = r.name; if (!had.inviteeId && r.inviteeId) { had.inviteeId = r.inviteeId; had.source = "roster"; } return; }
    byEmail.set(email, { email, name: String(r.name || "").trim().slice(0, 80), inviteeId: r.inviteeId || null, source: r.inviteeId ? "roster" : "pasted" });
  };
  for (const i of invitees) add({ email: i.email, name: i.name, inviteeId: i.id });
  for (const x of extras) add(x);
  const all = [...byEmail.values()];
  const send = all.filter((r) => !optedOut.has(r.email));
  const skipped = all.filter((r) => optedOut.has(r.email));
  return { send, skipped };
}

// "Jane Q. Doe" -> "Jane". A company-looking or empty name -> "".
export function firstNameOf(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (!n || /@/.test(n)) return "";
  const first = n.split(" ")[0].replace(/[^\p{L}\p{M}'’-]/gu, "");
  return first.length >= 2 ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

// {first name} becomes the person's first name; with none, the word goes and
// so does the space before it ("Hi {first name}," reads "Hi,").
export function personalize(text, name) {
  const first = firstNameOf(name);
  return String(text || "").replace(/(\s*)\{\s*first\s*name\s*\}/gi, (m, sp) => (first ? sp + first : ""));
}

export const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// Plain text -> email paragraphs: a blank line starts a paragraph, a single
// line break stays a line break, and web addresses become links.
function paragraphsHtml(text) {
  const link = (s) => s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" style="color:#2f6f4f;">${u}</a>`);
  return String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;">${link(escHtml(p)).replace(/\n/g, "<br>")}</p>`).join("\n");
}

const TZ = "America/Chicago";
export function eventWhen(event) {
  const s = event?.startsAt ? new Date(event.startsAt) : null;
  if (!s || Number.isNaN(s.getTime())) return "";
  const day = s.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const t = (d) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const e = event.endsAt ? new Date(event.endsAt) : null;
  return `${day}, ${t(s)}${e && !Number.isNaN(e.getTime()) ? ` – ${t(e)}` : ""}${event.doorsNote ? ` (${event.doorsNote})` : ""}`;
}
function rsvpBy(event) {
  const d = event?.rsvpDeadline ? new Date(event.rsvpDeadline) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }) : "";
}

// One person's email: { subject, html, text }.
//   event        the event record (name, dates, place, status, publicUrl)
//   subject/body what the sender typed; {first name} is filled per person
//   includeDetails  add the event's card (when, where, the RSVP button)
//   unsubscribeUrl  this person's own link (a test copy gets a harmless one)
export function renderEventEmail({ event = {}, subject = "", body = "", name = "", includeDetails = true, unsubscribeUrl = "", logoUrl = "" } = {}) {
  const subj = personalize(subject, name).replace(/\s+/g, " ").trim();
  const msg = personalize(body, name).trim();
  const when = eventWhen(event);
  const where = [event.location, event.address].filter(Boolean).join(", ");
  const canRsvp = event.status === "published" && event.publicUrl;
  const by = rsvpBy(event);
  const details = includeDetails && (event.name || when || where);

  const card = details ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d9dfcf;border-radius:10px;background:#f8f8f1;margin:8px 0 18px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:17px;font-weight:700;color:#1f2a1f;margin:0 0 6px;">${escHtml(event.name)}</div>
              ${when ? `<div style="font-size:14px;color:#1f2a1f;margin:0 0 3px;">${escHtml(when)}</div>` : ""}
              ${where ? `<div style="font-size:14px;color:#5d6a5b;margin:0 0 3px;">${escHtml(where)}</div>` : ""}
              ${canRsvp ? `<div style="margin:14px 0 2px;"><a href="${escHtml(event.publicUrl)}" style="display:inline-block;background:#2f6f4f;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:8px;">RSVP</a>${by ? `<span style="font-size:13px;color:#5d6a5b;margin-left:12px;">by ${escHtml(by)}</span>` : ""}</div>` : ""}
            </td></tr>
          </table>` : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(subj)}</title></head>
<body style="margin:0;padding:0;background:#f4f4ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4ef;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e5e7df;">
        <tr><td style="padding:22px 26px 6px;">${logoUrl ? `<img src="${escHtml(logoUrl)}" alt="Wilson AC &amp; Appliance" width="150" style="display:block;border:0;height:auto;">` : `<div style="font-family:Arial,sans-serif;font-weight:700;font-size:16px;color:#1f2a1f;">Wilson AC &amp; Appliance</div>`}</td></tr>
        <tr><td style="padding:12px 26px 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2a1f;">
          ${paragraphsHtml(msg)}
          ${card}
        </td></tr>
        <tr><td style="padding:14px 26px 22px;border-top:1px solid #eef0e8;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#6b7280;">
          ${escHtml(WILSON_FOOTER)}<br>
          ${unsubscribeUrl ? `Not interested in our event emails? <a href="${escHtml(unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a>.` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const lines = [msg, ""];
  if (details) {
    lines.push(event.name || "");
    if (when) lines.push(when);
    if (where) lines.push(where);
    if (canRsvp) lines.push(`RSVP${by ? ` by ${by}` : ""}: ${event.publicUrl}`);
    lines.push("");
  }
  lines.push("--", WILSON_FOOTER);
  if (unsubscribeUrl) lines.push(`Unsubscribe from our event emails: ${unsubscribeUrl}`);
  return { subject: subj, html, text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n" };
}

// Uploaded files -> Resend attachments, or a reason to refuse.
// Only real PDFs (they start with %PDF-), at most 5, 10 MB together.
export function checkPdfFiles(files = []) {
  const list = Array.isArray(files) ? files : [];
  if (list.length > EVENT_EMAIL_MAX_FILES) return { error: `Attach up to ${EVENT_EMAIL_MAX_FILES} PDFs.` };
  let total = 0;
  const out = [];
  for (const f of list) {
    const buf = f?.buffer;
    const original = String(f?.originalname || f?.name || "attachment.pdf");
    if (!Buffer.isBuffer(buf) || buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: `"${original.slice(0, 80)}" isn't a PDF. Only PDFs can be attached.` };
    total += buf.length;
    let name = original.normalize("NFKC").replace(/[^A-Za-z0-9 ._()&'-]+/g, " ").replace(/\s+/g, " ").replace(/\s+\./g, ".").trim().slice(0, 100);
    if (!/\.pdf$/i.test(name)) name = (name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "attachment") + ".pdf";
    out.push({ name, bytes: buf.length, data: buf });
  }
  if (total > EVENT_EMAIL_MAX_BYTES) return { error: `The PDFs come to ${(total / 1048576).toFixed(1)} MB. Keep them under ${EVENT_EMAIL_MAX_BYTES / 1048576} MB together.` };
  return { files: out, total };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Send one email through Resend. Never throws: -> { ok, id } or { ok:false, error, code, stop, retry }.
//   stop:  give up on the whole send (quota used up, key refused)
//   retry: worth trying again later (rate limit, Resend down)
export async function resendSend({ apiKey, apiBase = "https://api.resend.com", fetchImpl = fetch, message, idempotencyKey }) {
  let res;
  try {
    res = await fetchImpl(`${apiBase}/emails`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: JSON.stringify(message)
    });
  } catch (err) {
    return { ok: false, error: `Couldn't reach Resend: ${String(err?.message || err).slice(0, 160)}`, code: "network", retry: true };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.ok && body?.id) return { ok: true, id: String(body.id) };
  const code = String(body?.name || body?.statusCode || res.status);
  const msg = String(body?.message || body?.error || `HTTP ${res.status}`).slice(0, 300);
  const wait = Number(res.headers?.get?.("retry-after"));
  if (code === "daily_quota_exceeded") return { ok: false, code, stop: true, error: "Resend's daily sending limit is used up (the free plan allows 100 emails a day, all of Agility's email counted). The rest can go after midnight UTC." };
  if (code === "monthly_quota_exceeded") return { ok: false, code, stop: true, error: "Resend's monthly sending limit is used up." };
  if (["missing_api_key", "restricted_api_key", "suspended_api_key", "invalid_api_key"].includes(code) || res.status === 401) return { ok: false, code, stop: true, error: `Resend refused the API key (${msg}).` };
  if (res.status === 403 && /domain/i.test(msg)) return { ok: false, code, stop: true, error: `Resend refused the sender: ${msg}` };
  if (res.status === 429 || code === "rate_limit_exceeded" || code === "concurrent_idempotent_requests") return { ok: false, code, retry: true, waitMs: Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1500, error: msg };
  if (res.status >= 500) return { ok: false, code, retry: true, error: `Resend had a problem (${msg}).` };
  return { ok: false, code, error: msg };
}

// The loop. Sends to every recipient handed in, a few at a time, and reports
// each result through onResult as it lands.
//   recipients  [{ id, email, name, attempts, unsubscribeUrl }]
//   build(r)    -> the Resend message for that person
//   pace        { concurrency, gapMs }: 2 at a time, a new one every 250 ms at most (≈4 a second)
export async function sendAll({ recipients, build, send, onResult, pace = { concurrency: 2, gapMs: 250 }, maxTries = 4 }) {
  const queue = [...recipients];
  let stopped = null;
  let lastStart = 0;
  const one = async (r) => {
    let out = null;
    for (let t = 1; t <= maxTries; t += 1) {
      const gap = lastStart + pace.gapMs - Date.now();
      if (gap > 0) await sleep(gap);
      lastStart = Date.now();
      out = await send(build(r), `wilson-event-email-${r.id}-${r.attempts || 0}`);
      if (out.ok || out.stop || !out.retry) break;
      await sleep(out.waitMs || 1000 * t);
    }
    return out;
  };
  const worker = async () => {
    while (queue.length && !stopped) {
      const r = queue.shift();
      const out = await one(r);
      if (out?.stop) stopped = out;
      await onResult(r, out);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, pace.concurrency) }, worker));
  return { stopped, left: queue };
}
