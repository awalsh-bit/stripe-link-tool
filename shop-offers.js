// ---------------------------------------------------------------------------
// The promo codes shown on the shop (Andrew 11/23: "I built the first promo
// codes. I'd like them to appear in a classy way on the shop landing pages").
//
// One file for both pages, so they can't drift apart:
//   wilsonOffers.mountBand(el)    the landing page: a band under the hero
//   wilsonOffers.mountStrip(el)   the shop: a slim strip above Top deals
//   wilsonOffers.load()           -> { headline, offers }, fetched once a page
//   wilsonOffers.amount(o) / .condition(o) / .short(o)   the wording, shared
//                                 with the cart's one-tap offer in shop.html
//
// What shows comes from GET /api/shop/offers: only codes switched to "Show on
// the shop" in Online Shop Orders -> Promo codes, and only while they are
// live. No codes on, nothing is drawn. The headline is typed in Promo codes.
//
// Wording is built here from the code's own numbers ("$300 off", "on $3,000
// or more in appliances") so every offer reads the same way, whatever was
// typed as its description. See docs/shop/promo-codes-on-the-shop.md.
// ---------------------------------------------------------------------------
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  // $300, $3,000, $49.95
  const dollars = (n) => {
    const v = Number(n) || 0;
    return "$" + v.toLocaleString("en-US", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const targetOf = (kind) => (/delivery$/.test(kind || "") ? "delivery" : /_install$/.test(kind || "") ? "install" : "appliances");
  const isPercent = (kind) => kind === "percent" || /^percent_/.test(kind || "");
  const freeDelivery = (o) => o.kind === "free_delivery" || (o.kind === "percent_delivery" && Number(o.value) >= 100);

  // "$300 off" · "10% off" · "Free delivery" · "$50 off delivery" · "$100 off installation"
  function amount(o) {
    if (freeDelivery(o)) return "Free delivery";
    const off = isPercent(o.kind) ? `${Number(o.value)}% off` : `${dollars(o.value)} off`;
    const t = targetOf(o.kind);
    return t === "appliances" ? off : `${off} ${t === "install" ? "installation" : "delivery"}`;
  }
  // "on $3,000 or more in appliances" · "on appliances" · "with $1,000 or more in appliances"
  function condition(o) {
    const t = targetOf(o.kind), min = Number(o.minSubtotal) || 0;
    if (t === "appliances") return min > 0 ? `on ${dollars(min)} or more in appliances` : "on appliances";
    if (min > 0) return `with ${dollars(min)} or more in appliances`;
    return t === "install" ? "when we install it" : "on delivery orders";
  }
  // one short phrase for the strip: "$300 off $3,000+"
  function short(o) {
    const min = Number(o.minSubtotal) || 0;
    if (targetOf(o.kind) === "appliances") return min > 0 ? `${amount(o)} ${dollars(min)}+` : `${amount(o)} appliances`;
    return min > 0 ? `${amount(o)} with ${dollars(min)}+` : amount(o);
  }
  // "through December 2" when every shown code ends the same day (store time), else ""
  function ends(offers, monthStyle) {
    const days = [...new Set((offers || []).map((o) => {
      if (!o.endsAt) return "";
      const d = new Date(o.endsAt);
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: monthStyle || "long", day: "numeric", timeZone: "America/Chicago" });
    }))];
    return days.length === 1 && days[0] ? `through ${days[0]}` : "";
  }

  let loading = null;
  function load() {
    if (!loading) {
      loading = fetch("/api/shop/offers", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : { offers: [] }))
        .then((d) => ({ headline: String(d.headline || "Limited-time offers"), offers: Array.isArray(d.offers) ? d.offers.filter((o) => o && o.code && o.kind) : [] }))
        .catch(() => ({ headline: "", offers: [] }));
    }
    return loading;
  }

  const CSS = `
  .wo-band { background: #F2F1EE; color: #24211E; border-bottom: 1px solid #DDD8D0; font-family: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wo-band .wo-wrap { width: min(1180px, 100% - 48px); margin: 0 auto; padding: 44px 0 40px; text-align: center; }
  .wo-eyebrow { font-size: 11.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: #9A6A34; }
  .wo-title { font-family: "Familjen Grotesk", "Public Sans", system-ui, sans-serif; font-weight: 600; font-size: clamp(26px, 3.2vw, 38px); line-height: 1.1; letter-spacing: -.01em; margin-top: 10px; text-wrap: balance; }
  .wo-rule { width: 44px; height: 2px; background: #BE7D3C; margin: 18px auto 0; border: 0; }
  .wo-list { list-style: none; margin: 26px auto 0; padding: 0; display: grid; grid-template-columns: repeat(var(--wo-n, 3), minmax(0, 1fr)); max-width: calc(var(--wo-n, 3) * 330px); }
  .wo-offer { padding: 6px 22px 4px; border-left: 1px solid #DDD8D0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .wo-offer:first-child { border-left: 0; }
  .wo-amt { font-family: "Familjen Grotesk", "Public Sans", system-ui, sans-serif; font-weight: 600; font-size: clamp(28px, 3vw, 36px); line-height: 1.05; letter-spacing: -.01em; white-space: nowrap; }
  .wo-cond { font-size: 14px; line-height: 1.4; color: #655E56; text-wrap: balance; }
  .wo-code { margin-top: 8px; display: inline-flex; align-items: baseline; gap: 8px; padding: 6px 12px; border: 1px solid #D9C3A8; border-radius: 4px; background: #fff; }
  .wo-code small { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #8A8178; }
  .wo-code b { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-weight: 500; font-size: 14px; letter-spacing: .08em; color: #24211E; }
  .wo-note { margin-top: 26px; font-size: 13.5px; line-height: 1.5; color: #655E56; }
  .wo-note a { color: #67533E; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
  @media (max-width: 760px) {
    .wo-band .wo-wrap { width: min(1180px, 100% - 40px); padding: 34px 0 30px; }
    .wo-list { grid-template-columns: 1fr; max-width: 420px; margin-top: 20px; }
    .wo-offer { flex-direction: row; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; text-align: left; padding: 14px 2px; border-left: 0; border-top: 1px solid #DDD8D0; }
    .wo-offer:first-child { border-top: 0; }
    .wo-amt { font-size: 24px; }
    .wo-cond { flex: 1 1 100%; order: 3; font-size: 13.5px; }
    .wo-code { margin-top: 0; padding: 4px 9px; }
    .wo-code small { display: none; }
    .wo-code b { font-size: 13px; }
  }

  .wo-strip { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 18px; margin: 0 0 10px; padding: 11px 14px 11px 44px; position: relative; background: #fff; border: 1px solid #DDD8D0; border-left: 3px solid #BE7D3C; border-radius: 6px; font-size: 14px; line-height: 1.45; color: #24211E; }
  .wo-strip[hidden] { display: none; }
  .wo-strip .wo-s-ic { position: absolute; left: 13px; top: 12px; width: 20px; height: 20px; color: #BE7D3C; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .wo-s-title { font-family: "Familjen Grotesk", "Public Sans", system-ui, sans-serif; font-weight: 600; font-size: 15px; }
  .wo-s-title small { font-family: "Public Sans", system-ui, sans-serif; font-weight: 500; font-size: 12.5px; color: #655E56; margin-left: 6px; white-space: nowrap; }
  .wo-s-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 18px; flex: 1 1 auto; }
  .wo-s-list li { display: inline-flex; align-items: baseline; gap: 8px; white-space: nowrap; }
  .wo-s-list b { font-weight: 600; }
  .wo-s-list code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-weight: 500; font-size: 12px; letter-spacing: .06em; color: #67533E; }
  .wo-s-note { flex: 1 1 100%; font-size: 12.5px; color: #655E56; }
  @media (max-width: 560px) {
    .wo-strip { padding: 10px 12px 10px 40px; }
    .wo-strip .wo-s-ic { left: 11px; top: 11px; }
    .wo-s-title { flex: 1 1 100%; }
    .wo-s-list { flex-direction: column; gap: 1px; }
    .wo-s-list li { justify-content: space-between; width: 100%; }
  }`;
  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const s = document.createElement("style");
    s.setAttribute("data-wilson-offers", "");
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const el = (x) => (typeof x === "string" ? document.getElementById(x) : x);
  const TAG_SVG = '<svg class="wo-s-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>';

  // The landing page: a band under the hero. Nothing shown, nothing drawn.
  function mountBand(target, opts) {
    const host = el(target);
    if (!host) return Promise.resolve(false);
    return load().then(({ headline, offers }) => {
      if (!offers.length) { host.hidden = true; host.innerHTML = ""; return false; }
      style();
      const until = ends(offers);
      const shop = (opts && opts.shopHref) || "/shop.html";
      host.hidden = false;
      host.className = "wo-band";
      host.setAttribute("aria-label", headline);
      host.innerHTML = `<div class="wo-wrap">
        <p class="wo-eyebrow">${esc(until ? `Now ${until}` : "For a limited time")}</p>
        <h2 class="wo-title">${esc(headline)}</h2>
        <hr class="wo-rule">
        <ul class="wo-list" style="--wo-n:${Math.min(offers.length, 4)}">${offers.map((o) => `
          <li class="wo-offer">
            <span class="wo-amt">${esc(amount(o))}</span>
            <span class="wo-cond">${esc(condition(o))}</span>
            <span class="wo-code"><small>Code</small><b>${esc(o.code)}</b></span>
          </li>`).join("")}
        </ul>
        <p class="wo-note">${offers.length > 1 ? "One code per order. Your cart offers the one it qualifies for." : "Your cart offers the code when it qualifies."} <a href="${esc(shop)}">Shop all models</a></p>
      </div>`;
      return true;
    });
  }

  // The shop: a slim strip above Top deals.
  function mountStrip(target) {
    const host = el(target);
    if (!host) return Promise.resolve(false);
    return load().then(({ headline, offers }) => {
      if (!offers.length) { host.hidden = true; host.innerHTML = ""; return false; }
      style();
      const until = ends(offers, "short");
      host.className = "wo-strip";
      host.setAttribute("role", "note");
      host.setAttribute("aria-label", headline);
      host.innerHTML = `${TAG_SVG}<span class="wo-s-title">${esc(headline)}${until ? `<small>${esc(until)}</small>` : ""}</span>
        <ul class="wo-s-list">${offers.map((o) => `<li><b>${esc(short(o))}</b><code>${esc(o.code)}</code></li>`).join("")}</ul>
        <span class="wo-s-note">${offers.length > 1 ? "Your cart offers the code it qualifies for." : "Your cart offers the code when it qualifies."}</span>`;
      return true;
    });
  }

  window.wilsonOffers = { load, amount, condition, short, ends, dollars, targetOf, isPercent, mountBand, mountStrip };
})();
