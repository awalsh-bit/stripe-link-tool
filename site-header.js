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
//   })
//
// LINKS: every destination on the main site is in WILSON_SITE below — base
// URL plus a path per link. Gavin confirms the slugs; nothing else moves.
// ---------------------------------------------------------------------------
(function () {
  const SITE = {
    base: "https://www.wilsonappliance.com",
    shop: "/",                                  // the Express shop landing (this host)
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
      { label: "About Wilson", path: "/about" },
      { label: "Builders & Designers", path: "/builders" },
      { label: "Sub-Zero, Wolf & Cove", href: "https://service.wilsonappliance.com/subzero" },
      { label: "Careers", path: "/careers" },
      { label: "Contact", path: "/contact" }
    ],
    nav: [
      { label: "Luxury Appliances", path: "/appliances" }, // the luxury page is only on the test site for now (Andrew 11/10) — same place as Appliances until it launches
      { label: "Appliances", path: "/appliances" },
      { label: "HVAC", path: "/hvac" },
      { label: "Cabinetry", path: "/cabinetry" },
      { label: "Sinks & Faucets", href: "https://dealers.thegalley.com/wilson-ac-appliance/" } // Wilson's Galley dealer page, for now (Andrew 11/10)
    ]
  };
  window.WILSON_SITE = SITE;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const hrefOf = (l) => l.path ? SITE.base + l.path : (SITE[l.href] !== undefined ? SITE[l.href] : l.href);
  const ICON = {
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6.2 6.2l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
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
          <div class="nav-wrap"><nav class="site-nav" aria-label="Wilson">${SITE.nav.map((l) => `<a href="${esc(hrefOf(l))}"${l.path ? ` data-site="${esc(l.path)}"` : ""}>${esc(l.label)}</a>`).join("")}</nav></div>
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
    // cluster rides into the band when the utility bar folds away
    const cluster = el.querySelector("#acctCluster");
    function placeCluster() {
      if (!cluster) return;
      const shrunk = el.classList.contains("scrolled") && window.innerWidth > 1024;
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
