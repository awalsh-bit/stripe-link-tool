import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// ABOUT WILSON on the shop (Andrew 11/20): "Kill the Luxury Appliances banner
// for now and change it to an About Wilson to the far right ... I need an
// about us page on the shop. Can you use the about us section of the
// wilsonappliance.com now and the why wilson rotating cards to build
// something?" — and, for shoppers arriving from a Google ad, the review
// rating in the header.
//
// data/about-wilson.json holds the page's words (Andrew's history of the
// company), the review rating the header shows, the Podium review widget's
// location, and the visit details. The Why Wilson cards come from
// data/why-wilson.json, the same file the product pages read. Both files are
// read at most once a minute; a missing or broken about file falls back to
// the plain facts below so the page and the header never break.
// ---------------------------------------------------------------------------

const FALLBACK = {
  rating: null,
  headline: "Family owned since 1949.",
  lede: "Wilson AC & Appliance sells, delivers, installs and services appliances and central air conditioning from our showroom in Dripping Springs, Texas.",
  history: { title: "Our history", paragraphs: [], milestones: [] },
  reviews: null,
  visit: {
    title: "Come see us in Dripping Springs.",
    address: "4205 E. Highway 290, Dripping Springs, TX 78620",
    directions: "https://www.google.com/maps/search/?api=1&query=4205+E+Hwy+290+Dripping+Springs+TX+78620",
    phone: "(512) 894-0907", email: "", hours: [], serviceArea: [], membership: ""
  }
};

const str = (v, max = 600) => String(v ?? "").trim().slice(0, max);
const safeHref = (h) => { const v = str(h, 600); return /^(https:\/\/|tel:|sms:|mailto:|\/(?!\/))/i.test(v) ? v : ""; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const jsonLd = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

// The rating as the header and page show it. Only a real number from the
// file is ever shown: no file, no rating.
export function cleanRating(r) {
  if (!r || typeof r !== "object") return null;
  const value = str(r.value, 4);
  const n = Number(value);
  if (!/^\d(\.\d)?$/.test(value) || !(n >= 1 && n <= 5)) return null;
  const count = str(r.count, 12);
  if (!/^[0-9][0-9,]*\+?$/.test(count)) return null;
  const source = str(r.source, 30) || "Google";
  return { value, count, source, href: safeHref(r.href) };
}

let memo = { at: 0, dir: "", value: null };
export async function loadAboutWilson(dataDir) {
  if (memo.value && memo.dir === dataDir && Date.now() - memo.at < 60 * 1000) return memo.value;
  let value = FALLBACK;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, "about-wilson.json"), "utf8"));
    const h = raw.history || {}, v = raw.visit || {}, rv = raw.reviews || {};
    const uid = str(rv.podiumLocationUid, 40).toLowerCase();
    value = {
      rating: cleanRating(raw.rating),
      headline: str(raw.headline, 120) || FALLBACK.headline,
      lede: str(raw.lede, 500) || FALLBACK.lede,
      history: {
        title: str(h.title, 80) || "Our history",
        paragraphs: (Array.isArray(h.paragraphs) ? h.paragraphs : []).map((p) => str(p, 2000)).filter(Boolean).slice(0, 8),
        milestones: (Array.isArray(h.milestones) ? h.milestones : []).map((m) => ({ when: str(m?.when, 20), text: str(m?.text, 300) })).filter((m) => m.when && m.text).slice(0, 8)
      },
      reviews: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uid)
        ? { title: str(rv.title, 80) || "From our customers", uid, count: Math.min(20, Math.max(1, Math.round(Number(rv.count) || 5))) }
        : null,
      visit: {
        title: str(v.title, 100) || FALLBACK.visit.title,
        address: str(v.address, 160) || FALLBACK.visit.address,
        directions: safeHref(v.directions) || FALLBACK.visit.directions,
        phone: str(v.phone, 30) || FALLBACK.visit.phone,
        email: /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(str(v.email, 120)) ? str(v.email, 120) : "",
        hours: (Array.isArray(v.hours) ? v.hours : []).map((x) => ({ days: str(x?.days, 40), time: str(x?.time, 40) })).filter((x) => x.days && x.time).slice(0, 8),
        serviceArea: (Array.isArray(v.serviceArea) ? v.serviceArea : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 30),
        membership: str(v.membership, 200)
      }
    };
  } catch (err) { if (err.code !== "ENOENT") console.error("about-wilson.json unreadable:", err.message); }
  memo = { at: Date.now(), dir: dataDir, value };
  return value;
}

const telOf = (phone) => "tel:" + String(phone || "").replace(/\D/g, "").replace(/^1?(\d{10})$/, "$1");
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor"/></svg>';

// The whole page. `why` is loadWhyWilsonCards' result; `origin` the shop's
// https address (canonical and structured data).
export function renderAboutPage({ about, why, origin = "" }) {
  const a = about || FALLBACK;
  const r = a.rating;
  const cards = why?.cards || []; // all of them, in the file's order
  const canonical = `${origin}/about`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    url: canonical,
    name: "About Wilson AC & Appliance",
    mainEntity: {
      "@type": "HomeGoodsStore",
      name: "Wilson AC & Appliance",
      url: "https://www.wilsonappliance.com",
      foundingDate: "1949",
      telephone: a.visit.phone,
      ...(a.visit.email ? { email: a.visit.email } : {}),
      address: { "@type": "PostalAddress", streetAddress: "4205 E. Highway 290", addressLocality: "Dripping Springs", addressRegion: "TX", postalCode: "78620", addressCountry: "US" },
      ...(a.visit.serviceArea.length ? { areaServed: a.visit.serviceArea.map((c) => ({ "@type": "City", name: `${c}, TX` })) } : {})
    }
  };
  const ratingHtml = r ? `
      <a class="rate" href="${esc(r.href || "#reviews")}"${r.href ? ' target="_blank" rel="noopener"' : ""}>
        <span class="stars" aria-hidden="true">${STAR.repeat(5)}</span>
        <span><b>${esc(r.value)}</b> on ${esc(r.source)} <span class="sep">·</span> ${esc(r.count)} reviews</span>
        <span class="go">Read the reviews <span aria-hidden="true">→</span></span>
      </a>` : "";
  const milestones = a.history.milestones.length ? `
        <ol class="tl">
${a.history.milestones.map((m) => `          <li><span class="when">${esc(m.when)}</span><span class="what">${esc(m.text)}</span></li>`).join("\n")}
        </ol>` : "";
  const historyHtml = a.history.paragraphs.length ? `
  <section class="section history" aria-labelledby="hTitle">
    <div class="wrap hgrid">
      <div>
        <div class="eyebrow">Since 1949</div>
        <h2 id="hTitle">${esc(a.history.title)}</h2>${milestones}
      </div>
      <div class="story">
${a.history.paragraphs.map((p) => `        <p>${esc(p)}</p>`).join("\n")}
      </div>
    </div>
  </section>` : "";
  const whyHtml = cards.length ? `
  <section class="section why" aria-labelledby="wTitle">
    <div class="wrap">
      <div class="eyebrow">${esc(why?.kicker || "Why Wilson")}</div>
      <h2 id="wTitle">One company, from the showroom to years after.</h2>
      <div class="wgrid">
${cards.map((c, i) => `        <article class="wcard"><span class="n">${String(i + 1).padStart(2, "0")}</span><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p>${c.link ? `<a href="${esc(c.link.href)}"${/^https:/i.test(c.link.href) ? ' target="_blank" rel="noopener"' : ""}>${esc(c.link.label)} <span aria-hidden="true">→</span></a>` : ""}</article>`).join("\n")}
      </div>
    </div>
  </section>` : "";
  const reviewsHtml = a.reviews ? `
  <section class="section reviews" id="reviews" aria-labelledby="rTitle">
    <div class="wrap">
      <div class="rhead">
        <div>
          <div class="eyebrow">Reviews</div>
          <h2 id="rTitle">${esc(a.reviews.title)}</h2>
        </div>
        ${r && r.href ? `<a class="btn line" href="${esc(r.href)}" target="_blank" rel="noopener">All ${esc(r.count)} reviews on ${esc(r.source)}</a>` : ""}
      </div>
      <div class="rframe">
        <iframe src="https://reviews-iframe.podium.com?locationUid=${esc(a.reviews.uid)}&amp;count=${a.reviews.count}" title="Recent reviews of Wilson AC &amp; Appliance" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>
    </div>
  </section>` : "";
  const v = a.visit;
  const visitHtml = `
  <section class="section visit" aria-labelledby="vTitle">
    <div class="wrap vgrid">
      <div class="vphoto"><img src="showroom/island.jpg" alt="Wilson's showroom floor in Dripping Springs, with ranges, refrigerators and wine storage on display" loading="lazy" decoding="async"></div>
      <div>
        <div class="eyebrow">Visit</div>
        <h2 id="vTitle">${esc(v.title)}</h2>
        <dl class="vfacts">
          <div><dt>Showroom</dt><dd><a href="${esc(v.directions)}" target="_blank" rel="noopener">${esc(v.address)}</a></dd></div>
          <div><dt>Call or text</dt><dd><a href="${esc(telOf(v.phone))}">${esc(v.phone)}</a>${v.email ? ` · <a href="mailto:${esc(v.email)}">${esc(v.email)}</a>` : ""}</dd></div>
          ${v.hours.length ? `<div><dt>Hours</dt><dd><ul class="hours">${v.hours.map((h) => `<li><span>${esc(h.days)}</span><span>${esc(h.time)}</span></li>`).join("")}</ul></dd></div>` : ""}
          ${v.serviceArea.length ? `<div><dt>We serve</dt><dd>${esc(v.serviceArea.join(", "))} and the surrounding Hill Country.</dd></div>` : ""}
        </dl>
        <div class="ctas">
          <a class="btn dark" href="/shop.html">Shop what's in stock</a>
          <a class="btn line" href="${esc(v.directions)}" target="_blank" rel="noopener">Get directions</a>
          <a class="btn line" href="https://service.wilsonappliance.com/applianceservice.html">Schedule service</a>
        </div>
        ${v.membership ? `<p class="member">${esc(v.membership)}</p>` : ""}
      </div>
    </div>
  </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <!-- Google Tag Manager (GTM-KCPSFXV7, the shop's own container; Andrew 11/20: keep it, not a second one). Google's
       install code, loaded only on shop.wilsonappliance.com so local copies and test servers never report to it. See docs/shop/google-tag.md. -->
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    if (location.hostname === "shop.wilsonappliance.com") {
      (function (s) { s.async = true; s.src = "https://www.googletagmanager.com/gtm.js?id=GTM-KCPSFXV7"; document.head.appendChild(s); })(document.createElement("script"));
    }
  </script>
  <!-- End Google Tag Manager -->
  <!-- Meta Pixel (dataset 1962893141241918, Andrew 11/20): loads only on shop.wilsonappliance.com. See docs/shop/meta-pixel.md. -->
  <script src="/meta-pixel.js"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>About Wilson AC &amp; Appliance · Family owned since 1949</title>
  <meta name="description" content="${esc(`Wilson AC & Appliance has served Austin and the Hill Country since 1949. Family owned in Dripping Springs, Texas: appliances, central air conditioning, kitchen design and cabinetry, delivered, installed and serviced by our own team.`)}">
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="preload" as="image" href="showroom/live-kitchen.jpg" fetchpriority="high">
  <meta property="og:type" content="website">
  <meta property="og:title" content="About Wilson AC &amp; Appliance">
  <meta property="og:description" content="Family owned since 1949. Appliances, central air, kitchen design and cabinetry in Dripping Springs, Texas.">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(`${origin}/showroom/live-kitchen.jpg`)}">
  <link rel="stylesheet" href="site-header.css">
  <style>
    @font-face { font-family: "Familjen Grotesk"; font-style: normal; font-weight: 400 700; font-display: swap; src: url("fonts/familjen-grotesk-latin-wght-normal.woff2") format("woff2-variations"); }
    @font-face { font-family: "Public Sans"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("fonts/public-sans-latin-wght-normal.woff2") format("woff2-variations"); }
    @font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 500; font-display: swap; src: url("fonts/ibm-plex-mono-latin-500-normal.woff2") format("woff2"); }
    :root {
      --ink: #24211E; --ivory: #F2F1EE; --ivory-2: #EDEAE4; --paper: #FFFFFF;
      --brass: #BE7D3C; --brass-2: #E0A86C; --brass-text: #96602A;
      --accent: #67533E; --accent-dark: #52412F; --muted: #655E56; --line: #DDD8D0; --r: 6px;
      --serif: "Familjen Grotesk", "Public Sans", system-ui, sans-serif;
      --sans: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
      --max: 1180px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: var(--sans); font-size: 16px; line-height: 1.6; background: var(--ivory); color: var(--ink); -webkit-font-smoothing: antialiased; }
    img { display: block; max-width: 100%; }
    a { color: inherit; text-decoration: none; }
    h1, h2, h3 { font-family: var(--serif); font-weight: 600; letter-spacing: -.01em; }
    .wrap { width: min(var(--max), 100% - 40px); margin: 0 auto; }
    .eyebrow { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--brass-text); font-weight: 700; }
    .section { padding: 88px 0; }
    .section h2 { font-size: clamp(28px, 3.4vw, 40px); line-height: 1.08; margin-top: 10px; text-wrap: balance; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 18px; border-radius: var(--r); font-weight: 600; font-size: 15px; border: 1px solid transparent; cursor: pointer; transition: transform .15s ease, background .15s ease, border-color .15s ease; }
    .btn:hover { transform: translateY(-1px); }
    .btn.dark { background: var(--accent); color: #fff; } .btn.dark:hover { background: var(--accent-dark); }
    .btn.light { background: var(--ivory); color: var(--ink); } .btn.light:hover { background: #fff; }
    .btn.ghost { border-color: rgba(255,255,255,.55); color: #fff; } .btn.ghost:hover { background: rgba(255,255,255,.1); }
    .btn.line { border-color: var(--line); background: var(--paper); color: var(--ink); } .btn.line:hover { border-color: var(--accent); }

    /* hero: the live kitchen in the showroom */
    .hero { position: relative; min-height: 78vh; display: flex; align-items: flex-end; color: #fff; overflow: hidden; background: #1a1c1a; }
    .hero img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 55%; filter: saturate(.92) contrast(1.04); }
    .hero::before { content: ""; position: absolute; inset: 0; z-index: 1; background:
      linear-gradient(90deg, rgba(10,12,10,.62) 0%, rgba(10,12,10,.3) 48%, rgba(10,12,10,.05) 78%),
      linear-gradient(180deg, rgba(10,12,10,.5) 0%, rgba(10,12,10,.1) 32%, rgba(10,12,10,.2) 60%, rgba(10,12,10,.88) 100%); }
    .hero .wrap { position: relative; z-index: 2; padding: calc(var(--site-head-h) + 48px) 0 56px; }
    .hero .eyebrow { color: var(--brass-2); text-shadow: 0 1px 10px rgba(0,0,0,.45); }
    .hero h1 { font-size: clamp(40px, 5.6vw, 72px); line-height: 1.02; max-width: 13ch; margin-top: 16px; text-wrap: balance; text-shadow: 0 2px 24px rgba(0,0,0,.35); }
    .hero p.lede { max-width: 600px; margin-top: 20px; font-size: 17px; line-height: 1.6; color: rgba(255,255,255,.9); text-shadow: 0 1px 12px rgba(0,0,0,.45); }
    .hero .ctas { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 30px; }

    /* the rating, under the hero */
    .rating { background: var(--paper); border-bottom: 1px solid var(--line); }
    .rate { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 18px 0; font-size: 16px; }
    .rate .stars { display: inline-flex; gap: 2px; color: var(--brass); }
    .rate .stars svg { width: 19px; height: 19px; }
    .rate b { font-family: var(--serif); font-size: 20px; }
    .rate .sep { color: var(--muted); margin: 0 4px; }
    .rate .go { margin-left: auto; color: var(--accent); font-weight: 600; font-size: 15px; }
    .rate:hover .go { text-decoration: underline; text-underline-offset: 3px; }

    /* history */
    .hgrid { display: grid; grid-template-columns: 5fr 7fr; gap: 72px; align-items: start; }
    .tl { list-style: none; margin-top: 34px; border-left: 2px solid var(--line); }
    .tl li { position: relative; padding: 0 0 26px 24px; display: grid; gap: 4px; }
    .tl li::before { content: ""; position: absolute; left: -7px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--ivory); border: 2px solid var(--brass); }
    .tl li:last-child { padding-bottom: 0; }
    .tl .when { font-family: var(--mono); font-size: 13px; color: var(--brass-text); }
    .tl .what { color: var(--ink); font-size: 15px; line-height: 1.55; }
    .story p { font-size: 17px; line-height: 1.75; color: #3a3530; }
    .story p + p { margin-top: 20px; }
    .story p:first-child::first-letter { font-family: var(--serif); font-weight: 600; float: left; font-size: 64px; line-height: .9; padding: 6px 10px 0 0; color: var(--accent); }

    /* why wilson */
    .why { background: var(--paper); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    /* hairlines between the cards; an odd last row just ends in white */
    .wgrid { margin-top: 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); background: var(--paper); border-top: 1px solid var(--line); border-left: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
    .wcard { background: var(--paper); padding: 28px 26px 30px; display: flex; flex-direction: column; gap: 10px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .wcard .n { font-family: var(--mono); font-size: 12.5px; color: var(--brass-text); }
    .wcard h3 { font-size: 21px; line-height: 1.2; }
    .wcard p { color: var(--muted); font-size: 15px; line-height: 1.6; }
    .wcard a { margin-top: auto; padding-top: 6px; color: var(--accent); font-weight: 600; font-size: 14.5px; }
    .wcard a:hover { text-decoration: underline; text-underline-offset: 3px; }

    /* reviews */
    .rhead { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
    .rframe { margin-top: 30px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
    .rframe iframe { display: block; width: 100%; height: 620px; border: 0; }

    /* visit */
    .visit { background: var(--ivory-2); }
    .vgrid { display: grid; grid-template-columns: 6fr 6fr; gap: 64px; align-items: center; }
    .vphoto img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--r); }
    .vfacts { margin-top: 26px; display: grid; gap: 16px; }
    .vfacts > div { display: grid; grid-template-columns: 130px 1fr; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
    .vfacts dt { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: var(--muted); padding-top: 3px; }
    .vfacts dd a { color: var(--accent); font-weight: 600; }
    .vfacts dd a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .hours { list-style: none; display: grid; gap: 4px; }
    .hours li { display: flex; justify-content: space-between; gap: 16px; max-width: 320px; }
    .hours li span:last-child { font-variant-numeric: tabular-nums; }
    .visit .ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
    .member { margin-top: 22px; font-size: 13.5px; color: var(--muted); }

    footer { background: #0c0d0c; color: rgba(245,242,235,.72); padding: 56px 0 40px; font-size: 13px; }
    footer .wrap { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 32px; }
    footer .logo img { height: 40px; width: auto; }
    footer h4 { color: #fff; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; margin-bottom: 14px; }
    footer ul { list-style: none; display: grid; gap: 9px; }
    footer a:hover { color: #fff; }
    footer .fine { grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,.1); margin-top: 24px; padding-top: 20px; font-size: 12px; color: rgba(245,242,235,.5); }

    @media (max-width: 1040px) {
      .hgrid { gap: 48px; }
      .vgrid { gap: 40px; }
      footer .wrap { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 860px) {
      .hgrid, .vgrid { grid-template-columns: 1fr; }
      .vphoto { order: 2; }
    }
    @media (max-width: 720px) {
      .section { padding: 56px 0; }
      .wrap { width: min(var(--max), 100% - 32px); }
      .hero { min-height: 86svh; }
      .hero::before { background: linear-gradient(180deg, rgba(10,12,10,.62) 0%, rgba(10,12,10,.38) 35%, rgba(10,12,10,.55) 60%, rgba(10,12,10,.94) 100%); }
      .hero img.bg { object-position: 62% 50%; }
      .hero .wrap { padding: calc(var(--site-head-h) + 28px) 0 40px; }
      .hero p.lede { font-size: 15.5px; }
      .hero .ctas .btn { flex: 1 1 100%; }
      .rate { gap: 6px 10px; font-size: 15px; }
      .rate .go { margin-left: 0; flex-basis: 100%; }
      .story p { font-size: 16px; }
      .story p:first-child::first-letter { font-size: 52px; }
      .wcard { padding: 22px 20px 24px; }
      .rframe iframe { height: 700px; }
      .vfacts > div { grid-template-columns: 1fr; gap: 4px; }
      .visit .ctas .btn { flex: 1 1 100%; }
      footer .wrap { grid-template-columns: 1fr; gap: 26px; }
    }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
  </style>
  <script type="application/ld+json">${jsonLd(ld)}</script>
</head>
<body>
  <header id="siteTop"></header>
  <script src="site-header.js"></script>
  <script>
    mountSiteHeader("siteTop", {
      mode: "overlay",
      current: "about",
      tag: "Express<br>Assortment",
      rightHtml: \`<a class="util-btn cart-btn" href="/shop.html?show=cart" aria-label="Cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg></a>\`,
      search: { placeholder: "Search", onSubmit(v) { location.href = "/shop.html" + (v.trim() ? "?q=" + encodeURIComponent(v.trim()) : ""); } }
    });
  </script>

  <main>
  <section class="hero">
    <img class="bg" src="showroom/live-kitchen.jpg" alt="" fetchpriority="high" decoding="async">
    <div class="wrap">
      <div class="eyebrow">About Wilson · Dripping Springs, Texas</div>
      <h1>${esc(a.headline)}</h1>
      <p class="lede">${esc(a.lede)}</p>
      <div class="ctas">
        <a class="btn light" href="/shop.html">Shop what's in stock</a>
        <a class="btn ghost" href="${esc(v.directions)}" target="_blank" rel="noopener">Visit the showroom</a>
      </div>
    </div>
  </section>
${r ? `  <div class="rating"><div class="wrap">${ratingHtml}
  </div></div>` : ""}
${historyHtml}
${whyHtml}
${reviewsHtml}
${visitHtml}
  </main>

  <footer>
    <div class="wrap">
      <div>
        <div class="logo"><img src="logo-white.png" alt="Wilson AC &amp; Appliance" width="921" height="304" loading="lazy"></div>
        <p style="margin-top:16px; max-width:38ch;">Family owned in Dripping Springs, Texas, since 1949. We sell, deliver, install and service what we sell.</p>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>
          <li><a href="/shop.html">Everything in stock</a></li>
          <li><a href="/shop.html?outlet=1">Outlet — open box &amp; display</a></li>
          <li><a href="/shop.html?dept=Cooking">Cooking</a></li>
          <li><a href="/shop.html?dept=Refrigeration">Refrigeration</a></li>
          <li><a href="/shop.html?dept=Laundry">Laundry</a></li>
        </ul>
      </div>
      <div>
        <h4>Visit</h4>
        <ul>
          <li><a href="${esc(v.directions)}" target="_blank" rel="noopener">${esc(v.address.replace(/, TX \d{5}$/, ""))}</a></li>
          <li><a href="${esc(telOf(v.phone))}">${esc(v.phone)}</a></li>
          <li><a href="https://service.wilsonappliance.com/subzero">Sub-Zero, Wolf &amp; Cove live kitchen</a></li>
          <li><a href="https://www.wilsonappliance.com" target="_blank" rel="noopener">wilsonappliance.com</a></li>
        </ul>
      </div>
      <div>
        <h4>Service</h4>
        <ul>
          <li><a href="https://service.wilsonappliance.com/applianceservice.html">Appliance service</a></li>
          <li><a href="https://service.wilsonappliance.com/hvacservice.html">HVAC service</a></li>
          <li><a href="https://service.wilsonappliance.com/terms.html">Terms</a></li>
        </ul>
      </div>
      <div class="fine">© ${new Date().getFullYear()} Wilson AC &amp; Appliance</div>
    </div>
  </footer>
</body>
</html>
`;
}
