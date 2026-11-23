// ---------------------------------------------------------------------------
// Wilson site header for the Express shop pages (Andrew 11/10): the same top
// as wilsonappliance.com, so a shopper moving between the website and the
// shop never feels a seam. Pairs with site-header.css.
//
//   mountSiteHeader(container, {
//     mode: "photo" | "overlay",   photo = band carries the showroom photo
//     tag: "Express<br>Assortment", the small mark beside the logo that says this is
//                                  the shopping side of the site; links to the shop home
//     current: "express",          which utility link is the current page
//     rightHtml: "…",              extra controls after Directions (account, cart)
//     leftHtml: "…",               control before the logo (shop's menu button)
//     below: HTMLElement|string,   an extra row inside the fixed header (departments)
//     search: { placeholder, onInput(value), onSubmit(value) }   omit for none
//     rating: false,               leave out the review rating (it shows by default, 11/20)
//   })
//
// THE RATING (11/20, Andrew: Google ads land on the shop, "we need to show our
// reviews somewhere in the banner"): "4.9 · 1,200+ Google reviews" at the
// start of the utility bar, from data/about-wilson.json through
// /api/shop/reviews-summary. It links to the About page's reviews. No number
// on file (or the request fails) shows nothing.
//
// LINKS: every destination on the main site is in WILSON_SITE below — base
// URL plus a path per link. Gavin confirms the slugs; nothing else moves.
// ---------------------------------------------------------------------------
(function () {
  const SITE = {
    base: "https://www.wilsonappliance.com",
    shop: "/",                                  // the Express shop landing (this host)
    catalog: "/shop.html",                      // the shop's full catalog (this host)
    about: "/about",                            // About Wilson on the shop (this host, 11/20)
    service: "https://service.wilsonappliance.com/applianceservice.html",
    phone: "(512) 894-0907",
    tel: "tel:5128940907",
    directions: "https://maps.google.com/?q=Wilson+AC+%26+Appliance,+4205+E+Hwy+290,+Dripping+Springs,+TX+78620",
    utility: [
      { label: "Schedule Service", href: "service", strong: true },
      { label: "Financing", path: "/financing" },
      { label: "Rebates", path: "/rebates" },
      { label: "Showroom", path: "/showroom" },
      { label: "Express Shop", href: "shop", key: "express" }
    ],
    more: [
      { label: "Builders & Designers", path: "/builders" },
      { label: "Sub-Zero, Wolf & Cove", href: "https://service.wilsonappliance.com/subzero" },
      { label: "Careers", path: "/careers" },
      { label: "Contact", path: "/contact" }
    ],
    nav: [
      // "Luxury Appliances" came out 11/20 (Andrew: "Kill the Luxury Appliances banner for now"); add it back here when the page launches
      // Appliances stays on the shop (Andrew 11/23: it used to go to wilsonappliance.com/appliances)
      { label: "Appliances", href: "catalog" },
      { label: "HVAC", path: "/hvac" },
      { label: "Cabinetry", path: "/cabinetry" },
      { label: "Sinks & Faucets", href: "https://dealers.thegalley.com/wilson-ac-appliance/" }, // Wilson's Galley dealer page, for now (Andrew 11/10)
      { label: "About Wilson", href: "about", key: "about" } // far right, the shop's own About page (Andrew 11/20)
    ]
  };
  window.WILSON_SITE = SITE;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const hrefOf = (l) => l.path ? SITE.base + l.path : (SITE[l.href] !== undefined ? SITE[l.href] : l.href);
  const ICON = {
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6.2 6.2l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor"/></svg>'
  };
  window.WILSON_SITE_ICONS = ICON;

  window.mountSiteHeader = function mountSiteHeader(container, opts = {}) {
    const el = typeof container === "string" ? document.getElementById(container) : container;
    if (!el) return null;
    const mode = opts.mode === "overlay" ? "overlay" : "photo";
    const current = opts.current || "";
    el.className = `site-head ${mode}${opts.tag ? " has-tag" : ""}`;
    el.id = el.id || "siteTop";
    el.innerHTML = `
      <div class="util">
        <div class="util-inner">
          <nav class="util-links" aria-label="Wilson sites">
            ${SITE.utility.map((l) => `<a href="${esc(hrefOf(l))}"${l.strong ? ' class="strong"' : l.key && l.key === current ? ' class="current" aria-current="page"' : ""}${l.path ? ` data-site="${esc(l.path)}"` : ""}>${esc(l.label)}</a>`).join("")}
            <div class="util-more">
              <button type="button" id="utilMoreBtn" aria-haspopup="true" aria-expanded="false">More ${ICON.chev}</button>
              <div class="util-menu" id="utilMenu">${SITE.more.map((l) => `<a href="${esc(hrefOf(l))}"${l.path ? ` data-site="${esc(l.path)}"` : ""}>${esc(l.label)}</a>`).join("")}<div class="nav-dup">${SITE.nav.map((l) => `<a href="${esc(hrefOf(l))}">${esc(l.label)}</a>`).join("")}${SITE.utility.filter((l) => !l.strong && !(l.key && l.key === current)).map((l) => `<a class="plain" href="${esc(hrefOf(l))}">${esc(l.label)}</a>`).join("")}</div></div>
            </div>
          </nav>
          <div class="util-right">
            <a class="util-ic" href="${esc(SITE.tel)}">${ICON.phone}<span>${esc(SITE.phone)}</span></a>
            <a class="util-ic" href="${esc(SITE.directions)}" target="_blank" rel="noopener">${ICON.pin}<span>Directions</span></a>
            ${opts.rightHtml ? `<div class="acct-cluster" id="acctCluster"><span class="util-sep" aria-hidden="true"></span>${opts.rightHtml}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="band">
        <div class="band-inner">
          ${opts.leftHtml || ""}
          <a class="band-logo" href="${esc(SITE.base)}" title="Wilson AC &amp; Appliance"><img src="logo-white.png" alt="Wilson AC &amp; Appliance" width="921" height="304"></a>
          ${opts.tag ? `<a class="band-tag" href="${esc(SITE.shop)}" title="Express Assortment — shop what's in stock">${opts.tag}</a>` : ""}
          <div class="nav-wrap"><nav class="site-nav" aria-label="Wilson">${SITE.nav.map((l) => `<a href="${esc(hrefOf(l))}"${l.path ? ` data-site="${esc(l.path)}"` : ""}${l.key && l.key === current ? ' class="current" aria-current="page"' : ""}>${esc(l.label)}</a>`).join("")}</nav></div>
          ${opts.search ? `<form class="band-search" id="topSearchForm" role="search"><input type="search" id="topSearch" placeholder="${esc(opts.search.placeholder || "Search")}" aria-label="Search" autocomplete="off"><button type="submit" aria-label="Search">${ICON.search}</button></form>` : ""}
        </div>
      </div>`;
    if (opts.below) {
      const row = document.createElement("div");
      row.className = "ribbon";
      if (typeof opts.below === "string") row.innerHTML = opts.below;
      else row.appendChild(opts.below);
      el.appendChild(row);
      document.documentElement.style.setProperty("--ribbon-h", opts.ribbonHeight || "44px");
    }
    if (mode === "photo") document.body.style.paddingTop = "var(--site-head-h)";

    // the review rating, first in the utility bar's right side
    if (opts.rating !== false) {
      fetch("/api/shop/reviews-summary", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d || !/^\d(\.\d)?$/.test(String(d.value || "")) || !d.count) return;
          const right = el.querySelector(".util-right");
          if (!right || right.querySelector(".util-rating")) return;
          const a = document.createElement("a");
          a.className = "util-rating";
          a.href = d.href || (SITE.about + "#reviews");
          a.setAttribute("aria-label", `Rated ${d.value} out of 5 on ${d.source || "Google"}, ${d.count} reviews`);
          a.innerHTML = `<span class="r-stars" aria-hidden="true">${ICON.star.repeat(5)}</span><span class="r-one" aria-hidden="true">${ICON.star}</span><b>${esc(d.value)}</b><span class="r-long">${esc(d.count)} ${esc(d.source || "Google")} reviews</span><span class="r-short">(${esc(d.count)})</span>`;
          right.insertBefore(a, right.firstChild);
          // It gives way first: when the bar is too full (a phone, a signed-in
          // name chip), the count goes, then the rating itself, so the cart
          // and account buttons never get pushed off the edge.
          const inner = el.querySelector(".util-inner");
          let queued = false;
          const fit = () => {
            queued = false;
            if (!inner || el.classList.contains("scrolled")) return;
            a.classList.remove("r-tight", "r-gone");
            if (inner.scrollWidth > inner.clientWidth + 1) a.classList.add("r-tight");
            if (inner.scrollWidth > inner.clientWidth + 1) a.classList.add("r-gone");
          };
          const later = () => { if (!queued) { queued = true; requestAnimationFrame(fit); } };
          fit();
          window.addEventListener("resize", later);
          if (window.MutationObserver) new MutationObserver((recs) => { if (recs.some((r) => !a.contains(r.target))) later(); }).observe(right, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden"], characterData: true });
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
        })
        .catch(() => {});
    }

    // "More" menu
    const moreBtn = el.querySelector("#utilMoreBtn");
    moreBtn.addEventListener("click", (e) => { e.stopPropagation(); const open = moreBtn.parentElement.classList.toggle("open"); moreBtn.setAttribute("aria-expanded", open ? "true" : "false"); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".util-more")) { moreBtn.parentElement.classList.remove("open"); moreBtn.setAttribute("aria-expanded", "false"); } });

    // search hooks
    if (opts.search) {
      const input = el.querySelector("#topSearch");
      if (opts.search.onInput) input.addEventListener("input", () => opts.search.onInput(input.value));
      el.querySelector("#topSearchForm").addEventListener("submit", (e) => { e.preventDefault(); if (opts.search.onSubmit) opts.search.onSubmit(input.value, { collapsed: getComputedStyle(input).display === "none" }); });
    }

    // shrink on scroll (hysteresis so it never flickers); the account/cart
    // cluster rides into the band when the utility bar folds away - on every
    // screen. Until 11/18 it only did so above 1024px, so on a phone the cart
    // went away with the utility bar as soon as the page scrolled (Andrew:
    // "the cart in the upper right went away").
    const cluster = el.querySelector("#acctCluster");
    function placeCluster() {
      if (!cluster) return;
      const shrunk = el.classList.contains("scrolled");
      const home = shrunk ? el.querySelector(".band-inner") : el.querySelector(".util-right");
      if (cluster.parentElement !== home) home.appendChild(cluster);
    }
    let ticking = false;
    function check() {
      ticking = false;
      if (document.documentElement.classList.contains("scroll-locked")) return; // the page is pinned behind a pop-up — not a real scroll
      const y = window.scrollY || 0;
      if (y > 120 && !el.classList.contains("scrolled")) { el.classList.add("scrolled"); placeCluster(); }
      else if (y < 24 && el.classList.contains("scrolled")) { el.classList.remove("scrolled"); placeCluster(); }
    }
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    window.addEventListener("resize", placeCluster);
    check();
    return el;
  };
})();
