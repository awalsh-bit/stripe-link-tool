(function () {
  const body = document.body;

  if (!body) return;

  const label = body.dataset.shellLabel || "Internal Tool";
  const icon = body.dataset.shellIcon || "payments";
  const replaceHero = body.dataset.shellReplaceHero === "true";
  // Pages served from a subfolder (e.g. /maintenance/) set
  // data-shell-root="/" so the shell's relative links and images still
  // resolve to the dashboard root instead of the subfolder.
  const shellRoot = body.dataset.shellRoot || "";
  function withRoot(href) {
    const value = String(href || "");
    if (!shellRoot || !value || /^(?:[a-z]+:|\/|#)/i.test(value)) return value;
    return shellRoot + value;
  }

  // ------------------------------------------------------------------
  // Color scheme. Green is the default; red and purple are per-user
  // choices saved on the profile. Applied as data-theme on <html>, which
  // the shared variable blocks in internal-shell.css pick up. The last
  // choice is cached locally so pages paint in the right scheme before
  // the session round-trip completes.
  // ------------------------------------------------------------------
  const THEMES = [
    { key: "green", label: "Green", swatch: "#21692c" },
    { key: "red", label: "Red", swatch: "#a32222" },
    { key: "purple", label: "Purple", swatch: "#635bff" }
  ];

  function applyTheme(theme) {
    const key = THEMES.some((t) => t.key === theme) ? theme : "green";
    if (key === "green") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = key;
    }
    document.querySelectorAll(".internal-shell-theme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themePick === key);
    });
    return key;
  }

  function cachedTheme() {
    try { return localStorage.getItem("wilsonTheme") || ""; } catch { return ""; }
  }

  applyTheme(cachedTheme());

  function pickTheme(theme) {
    const key = applyTheme(theme);
    try { localStorage.setItem("wilsonTheme", key); } catch {}
    fetch("/api/me/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ theme: key })
    }).catch(() => {});
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest?.("[data-theme-pick]");
    if (btn) pickTheme(btn.dataset.themePick);
  });

  function buildThemePicker() {
    return `
      <div class="internal-shell-menu-title" style="margin-top: 12px;">Color Scheme</div>
      <div class="internal-shell-theme-row">
        ${THEMES.map((t) => `
          <button type="button" class="internal-shell-theme-btn" data-theme-pick="${t.key}">
            <span class="internal-shell-theme-dot" style="background: ${t.swatch};"></span>${t.label}
          </button>`).join("")}
      </div>
    `;
  }

  function iconSvg(name) {
    const icons = {
      person: `
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"></circle>
          <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `,
      payments: `
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="12" rx="3" fill="currentColor" opacity="0.18"></rect>
          <rect x="3" y="8" width="18" height="3" rx="1.5" fill="currentColor"></rect>
          <rect x="6" y="14" width="5" height="1.8" rx="0.9" fill="currentColor"></rect>
          <rect x="13" y="14" width="4" height="1.8" rx="0.9" fill="currentColor" opacity="0.65"></rect>
        </svg>
      `,
      sales: `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M14.5 3.5l6 6-8.75 8.75-6.5 1 1-6.5L14.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
          <path d="M12 6l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `,
      lookup: `
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"></circle>
          <path d="M16 16L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `,
      link: `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M10 14L14 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M8 16H7a4 4 0 010-8h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M16 8h1a4 4 0 010 8h-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `,
      terminal: `
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="5" y="3.5" width="14" height="17" rx="3" stroke="currentColor" stroke-width="2"></rect>
          <rect x="8" y="7" width="8" height="2.5" rx="1.25" fill="currentColor"></rect>
          <circle cx="9" cy="14" r="1" fill="currentColor"></circle>
          <circle cx="12" cy="14" r="1" fill="currentColor"></circle>
          <circle cx="15" cy="14" r="1" fill="currentColor"></circle>
        </svg>
      `,
      card: `
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="12" rx="3" stroke="currentColor" stroke-width="2"></rect>
          <path d="M3 10h18" stroke="currentColor" stroke-width="2"></path>
          <rect x="6" y="14" width="5" height="1.8" rx="0.9" fill="currentColor"></rect>
        </svg>
      `,
      accounting: `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M6 4.5V19.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M18 4.5V19.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M6 7.5H18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M6 12H18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M6 16.5H18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `,
      service: `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M7 4.5H17L20 7.5V19a2 2 0 01-2 2H7a2 2 0 01-2-2V6.5a2 2 0 012-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
          <path d="M8.5 11H15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M8.5 15H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `,
      home: `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 11L12 4l8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M6 10v9a1 1 0 001 1h3.5v-5.5h3V20H17a1 1 0 001-1v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `,
      commissions: `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 18.5h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M8 15V10" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M12 15V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M16 15v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `
    };

    return icons[name] || icons.payments;
  }

  function firstNameOf(user) {
    const name = String(user?.displayName || user?.name || "").trim();
    return name ? name.split(/\s+/)[0] : "";
  }

  // data-shell-label-personal="Dashboard" renders as "<First>'s Dashboard"
  // for the logged-in user ("My Dashboard" when the name is unknown).
  function resolveLabel(session) {
    const personal = body.dataset.shellLabelPersonal;
    if (!personal) return label;
    const user = session?.user || session;
    const first = firstNameOf(user);
    return first ? `${first}'s ${personal}` : `My ${personal}`;
  }

  function canSeePage(session, href) {
    const pages = session?.grantedPages;

    if (!Array.isArray(pages)) {
      return true; // legacy sessions without page lists keep full nav
    }

    const path = "/" + String(href || "").split("?")[0].replace(/^\//, "");
    return pages.includes(path);
  }

  function filterLinksForSession(links, session) {
    return links
      .map((link) => {
        if (Array.isArray(link.children)) {
          const children = link.children.filter((child) => canSeePage(session, child.href));
          return children.length ? { ...link, children } : null;
        }

        if (link.href && link.href !== "logout.html" && !canSeePage(session, link.href)) {
          return null;
        }

        return link;
      })
      .filter(Boolean);
  }

  let menuIndex = [];
  function buildMenuLinks(session) {
    const links = [
      {
        href: "dashboard.html",
        title: "Home",
        icon: "home"
      },
      {
        title: "Payments",
        children: [
          { href: "index.html", title: "Send Payment Link" },
          { href: "terminal.html", title: "Send To Card Reader" },
          { href: "charge-saved-card.html", title: "Charge A Saved Card" },
          { href: "hvac-dashboard.html", title: "Deposit Agreements" }
        ]
      },
      {
        title: "Accounting",
        children: [
          { href: "paid-order-detail.html", title: "Paid Order Detail" },
          { href: "intent-lookup.html", title: "Issue Refund" },
          { href: "refund-dashboard.html", title: "Refund Dashboard" },
          { href: "incoming-payouts.html", title: "Incoming Payouts" },
          { href: "bank-balancing.html", title: "Bank Balancing" },
          { href: "credit-applications.html", title: "Builder Credit Applications" },
          { href: "mileage.html", title: "Mileage" },
          { href: "mileage-review.html", title: "Mileage Review" },
          { href: "receipts.html", title: "Card Receipts" },
          { href: "receipt-report.html", title: "Card Receipt Report" }
        ]
      },
      {
        title: "Client Care",
        children: [
          { href: "appliance-service-calls.html", title: "Service Request Queue" },
          { href: "service-order-health.html", title: "Service Order Health" },
          { href: "service-estimates.html", title: "Service Estimate Approvals" },
          { href: "closed-estimates.html", title: "Closed Service Estimates" },
          { href: "shopper-profiles.html", title: "Shopper Profiles" }
        ]
      },
      {
        title: "Sales Tools",
        children: [
          { href: "salesdashboard.html", title: "Sales Dashboard" },
          { href: "sales-order-health.html", title: "Sales Order Health Report" },
          { href: "sales-order-detail.html", title: "Sales Order Detail" },
          { href: "brand-sales.html", title: "Brand Sales" },
          { href: "lead-report.html", title: "DIBS Lead Report" },
          { href: "builder-prospects.html", title: "Builder Prospect List" },
          { href: "builder-prospect-manager.html", title: "Builder Prospect Manager" },
          { href: "quote-follow-up.html", title: "Quote Follow-Up" },
          { href: "aging-inventory.html", title: "Aging Inventory" },
          { href: "flag-closures.html", title: "Notification Closure Report" },
          { href: "target-builder.html", title: "Target Builder" },
          { href: "secret-menu.html", title: "Secret Menu" },
          { href: "clearance.html", title: "Clearance Hit List" },
          { href: "shop-orders.html", title: "Online Shop Orders" },
          { href: "spec-packages.html", title: "Spec Packages" },
          { href: "terms-signatures.html", title: "Terms & Conditions Signatures" }
        ]
      },
      {
        title: "Commissions",
        children: [
          { href: "commissions.html", title: "Sales Commissions" },
          { href: "my-commissions.html", title: "My Commission Review" },
          { href: "service-commissions.html", title: "Repair Service Commissions" },
          { href: "my-service-commissions.html", title: "My Service Commission" }
        ]
      },
      {
        title: "Purchasing",
        children: [
          { href: "speedqueen-truckload.html", title: "Speed Queen Truckload Builder" },
          { href: "written-models.html", title: "Ordering Report" }
        ]
      },
      {
        title: "Delivery",
        children: [
          { href: "dispatch.html", title: "Delivery Dispatch" },
          { href: "driver.html", title: "Driver Run Sheet" },
          { href: "dispatch-work.html", title: "Dispatch Work" },
          { href: "fleet.html", title: "Fleet Management" }
        ]
      },
      {
        title: "Installation",
        children: [
          { href: "install-damage.html", title: "Cosmetic Damage Form" }
        ]
      },
      {
        title: "Company Tools",
        children: [
          { href: "epass-uploads.html", title: "ePASS Upload Center" },
          { href: "message-automations.html", title: "Text Automations" },
          { href: "event-rsvps.html", title: "Event RSVPs" },
          { href: "signature-builder.html", title: "Email Signature" }
        ]
      },
      {
        title: "HR",
        children: [
          { href: "hr-phone-screen.html", title: "Phone Screen" },
          { href: "hr-candidates.html", title: "Candidates" },
          { href: "uniform-orders.html", title: "Uniform Ordering" }
        ]
      },
      {
        title: "Test Modules",
        children: [
          { href: "pilot-routing.html", title: "AJH Pilot — Routing" },
          { href: "pilot-field.html", title: "AJH Pilot — Field Tool" },
          { href: "pilot-parts.html", title: "AJH Pilot — Parts Pipeline" },
          { href: "service-journey.html", title: "Service Journey (ePASS mirror)" },
          { href: "service-proto-board.html", title: "Service Journey — Board prototype" },
          { href: "service-proto-field.html", title: "Service Journey — Field Tool prototype" },
          { href: "service-proto-office.html", title: "Service Journey — Office Queues prototype" },
          { href: "satisfaction-survey.html", title: "Client Satisfaction Survey" },
          { href: "satisfaction-results.html", title: "Satisfaction Results" },
          { href: "case-visit-survey.html", title: "Case Visit Survey" },
          { href: "case-visit-results.html", title: "Case Visit Results" }
        ]
      },
      {
        /* Cayden, 2026-09-04: four entries only. Customers, invoice import,
           filter finder and the quote builder are reached inside the tool. */
        title: "Wilson Guardian",
        children: [
          { href: "/maintenance/index.html", title: "Guardian Registration" },
          { href: "/maintenance/admin.html", title: "Guardian Command Center" },
          { href: "/maintenance/monitoring.html", title: "Guardian Temp Monitoring" },
          { href: "/maintenance/tech-maintenance.html", title: "Guardian Field Tool" }
        ]
      }
    ];

    if (session?.canManageUsers) {
      links.push({
        title: "Admin",
        children: [
          { href: "user-admin.html", title: "User Admin" },
          { href: "send-notification.html", title: "Send a Notification" },
          { href: "audit-log.html", title: "User Activity Audit" },
          { href: "returns-report.html", title: "Returns Report" }
        ]
      });
    }

    // Sign Out and the color scheme live in Personal Settings (header, top
    // right) since 2026-09-15 — the hamburger is tools only.
    const visible = filterLinksForSession(links, session);
    // Flat index for the type-to-filter box (Andrew, 2026-09-18: ~85 pages
    // for an exec — typing beats scrolling).
    menuIndex = [];
    for (const link of visible) {
      if (Array.isArray(link.children) && link.children.length) for (const c of link.children) menuIndex.push({ href: c.href, title: c.title, group: link.title });
      else if (link.href) menuIndex.push({ href: link.href, title: link.title, group: "" });
    }
    return visible.map((link) => {
      if (Array.isArray(link.children) && link.children.length) {
        return `
          <div class="internal-shell-menu-group">
            <button class="internal-shell-menu-link internal-shell-menu-link-button" type="button">
              <div class="internal-shell-menu-link-title">${link.title}</div>
              <span class="internal-shell-menu-link-caret" aria-hidden="true">&rsaquo;</span>
            </button>
            <div class="internal-shell-submenu-panel">
              ${link.children.map((child) => `
                <a class="internal-shell-submenu-link" href="${withRoot(child.href)}">${child.title}</a>
              `).join("")}
            </div>
          </div>
        `;
      }

      const iconHtml = link.icon
        ? `<span class="internal-shell-menu-link-icon" aria-hidden="true" style="display:inline-flex;width:15px;height:15px;vertical-align:-2px;margin-right:8px;">${iconSvg(link.icon).replace("<svg ", '<svg style="width:100%;height:100%;display:block;" ')}</span>`
        : "";
      return `
        <a class="internal-shell-menu-link" href="${withRoot(link.href)}">
          <div class="internal-shell-menu-link-title">${iconHtml}${link.title}</div>
          ${link.text ? `<div class="internal-shell-menu-link-text">${link.text}</div>` : ""}
        </a>
      `;
    }).join("");
  }

  function buildFooterLinks(session) {
    const candidates = [
      { href: "dashboard.html", title: "Home" },
      { href: "paid-order-detail.html", title: "Accounting" },
      { href: "salesdashboard.html", title: "Sales Tools" },
      { href: "event-rsvps.html", title: "Event RSVPs" }
    ];

    const links = candidates
      .filter((link) => canSeePage(session, link.href))
      .map((link) => `<a class="internal-shell-footer-link" href="${withRoot(link.href)}">${link.title}</a>`);

    if (session?.canManageUsers) {
      links.push(`<a class="internal-shell-footer-link" href="${withRoot("user-admin.html")}">User Admin</a>`);
      links.push(`<a class="internal-shell-footer-link" href="${withRoot("audit-log.html")}">Activity Audit</a>`);
    }

    links.push(`<a class="internal-shell-footer-link" href="${withRoot("logout.html")}">Sign Out</a>`);
    return links.join("");
  }

  function buildHeader(user) {
    const headerLabel = resolveLabel(user);
    if (body.dataset.shellLabelPersonal && document.title.includes(label)) {
      document.title = document.title.replace(label, headerLabel);
    }
    return `
      <div class="internal-shell-header">
        <div class="internal-shell-header-top">
          <div class="internal-shell-brand">
            <div class="internal-shell-menu-wrap">
              <button class="internal-shell-menu-trigger" type="button" aria-label="Dashboard menu">
                <span class="internal-shell-menu-bars">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </button>
              <div class="internal-shell-menu-panel">
                <div class="internal-shell-menu-title">Dashboards</div>
                <input class="internal-shell-menu-search" type="search" placeholder="Find a page… (type to filter)" autocomplete="off" aria-label="Find a page" />
                <div class="internal-shell-menu-results" hidden></div>
                <div class="internal-shell-menu-groups">${buildMenuLinks(user)}</div>
              </div>
            </div>
            <img class="internal-shell-logo" src="${withRoot("logo-agility.png")}" alt="Wilson AC & Appliance — Agility" />
            <div class="internal-shell-labels">
              <div class="internal-shell-badge-wrap">
                <span class="internal-shell-badge-icon" aria-hidden="true">${iconSvg(icon)}</span>
                <div class="internal-shell-badge"><span>${headerLabel}</span></div>
              </div>
            </div>
          </div>
          ${buildPersonalSettings(user)}
        </div>
      </div>
    `;
  }

  // Personal Settings (top right): who's signed in, color scheme, sign out.
  // Everything about the person rather than the business lives here so the
  // hamburger stays a tool list (Andrew, 2026-09-15).
  function buildPersonalSettings(session) {
    const user = session?.user || session || {};
    const name = String(user.displayName || user.name || "").trim();
    const email = String(user.email || user.username || "").trim();
    const initials = name ? name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") : "";
    // Profile photo (the email-signature headshot) when one is on file —
    // session.avatar is its updated-at stamp, which doubles as the cache key.
    // The initials stay underneath, so a failed image load falls back cleanly.
    const photo = session?.avatar ? `<img class="internal-shell-avatar-photo" src="${withRoot("api/me/avatar")}?v=${encodeURIComponent(String(session.avatar))}" alt="" onerror="this.remove()" />` : "";
    const avatar = initials
      ? `<span class="internal-shell-avatar">${initials}${photo}</span>`
      : `<span class="internal-shell-avatar internal-shell-avatar-icon" aria-hidden="true">${iconSvg("person")}${photo}</span>`;
    return `
      <div class="internal-shell-personal-wrap">
        <button class="internal-shell-personal-trigger" type="button" aria-label="Personal settings" title="Personal settings" aria-haspopup="true">
          ${avatar}
        </button>
        <div class="internal-shell-personal-panel">
          <div class="internal-shell-personal-who">
            ${avatar}
            <div>
              <div class="internal-shell-personal-name">${name || "Signed in"}</div>
              ${email ? `<div class="internal-shell-personal-email">${email}</div>` : ""}
            </div>
          </div>
          <button type="button" class="internal-shell-personal-item" data-open-profile>
            <span class="internal-shell-personal-item-title">Edit my profile</span>
            <span class="internal-shell-personal-item-text">Photo, uniform sizes, commute, birthday.</span>
          </button>
          ${buildThemePicker()}
          <a class="internal-shell-personal-signout" href="${withRoot("logout.html")}">
            <span class="internal-shell-personal-signout-title">Sign Out</span>
            <span class="internal-shell-personal-signout-text">End the current dashboard session.</span>
          </a>
        </div>
      </div>
    `;
  }

  function buildFooter(user) {
    return `
      <div class="internal-shell-footer-row">
        <div class="internal-shell-footer-text">Wilson AC & Appliance internal tools.</div>
        <div class="internal-shell-footer-links">
          ${buildFooterLinks(user)}
        </div>
      </div>
    `;
  }

  async function loadSessionUser() {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin"
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data.user) return null;
      // Return the full session payload: { user, grantedPages, canManageUsers }
      return { ...data, accessGroup: data.user.accessGroup };
    } catch {
      return null;
    }
  }

  function renderShell(user) {
    if (replaceHero) {
      const hero = document.querySelector(".hero");
      if (hero) {
        hero.innerHTML = buildHeader(user);
      }
    } else {
      const headerHost = document.getElementById("internal-shell-header");
      if (headerHost) {
        headerHost.innerHTML = buildHeader(user);
      }
    }

    wireMenuSearch();

    const navFooter = document.querySelector(".internal-nav");
    if (navFooter) {
      navFooter.classList.add("internal-shell-footer");
      navFooter.innerHTML = buildFooter(user);
    } else {
      const footerHost = document.getElementById("internal-shell-footer");
      if (footerHost) {
        footerHost.classList.add("internal-shell-footer");
        footerHost.innerHTML = buildFooter(user);
      }
    }
  }

  // ---- Type-to-filter in the hamburger --------------------------------
  // Typing replaces the group list with matching pages (every word typed
  // must appear in the page title or its group); Enter opens the first
  // match, ↑/↓ move through them, Esc clears. The input holding focus is
  // what keeps the hover panel open on desktop.
  function wireMenuSearch() {
    const input = document.querySelector(".internal-shell-menu-search");
    const results = document.querySelector(".internal-shell-menu-results");
    const groups = document.querySelector(".internal-shell-menu-groups");
    if (!input || !results || !groups) return;
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const run = () => {
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) { results.hidden = true; results.innerHTML = ""; groups.hidden = false; return; }
      const hits = menuIndex.filter((p) => { const hay = `${p.title} ${p.group}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
        .sort((a, b) => { const aw = a.title.toLowerCase().startsWith(words[0]) ? 0 : 1, bw = b.title.toLowerCase().startsWith(words[0]) ? 0 : 1; return aw - bw || a.title.localeCompare(b.title); })
        .slice(0, 14);
      results.innerHTML = hits.length
        ? hits.map((p, i) => `<a class="internal-shell-submenu-link internal-shell-menu-hit${i === 0 ? " is-first" : ""}" href="${withRoot(p.href)}">${esc(p.title)}${p.group ? `<span class="internal-shell-menu-hit-group">${esc(p.group)}</span>` : ""}</a>`).join("")
        : `<div class="internal-shell-menu-hit-none">No page matches “${esc(input.value.trim())}”.</div>`;
      results.hidden = false; groups.hidden = true;
    };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (ev) => {
      const hits = [...results.querySelectorAll(".internal-shell-menu-hit")];
      if (ev.key === "Enter") { const first = hits.find((h) => h.classList.contains("is-first")) || hits[0]; if (first) { ev.preventDefault(); window.location.href = first.href; } }
      else if (ev.key === "ArrowDown" && hits[0]) { ev.preventDefault(); hits[0].focus(); }
      else if (ev.key === "Escape") { input.value = ""; run(); }
    });
    results.addEventListener("keydown", (ev) => {
      const hits = [...results.querySelectorAll(".internal-shell-menu-hit")]; const i = hits.indexOf(document.activeElement);
      if (ev.key === "ArrowDown" && hits[i + 1]) { ev.preventDefault(); hits[i + 1].focus(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); (hits[i - 1] || input).focus(); }
      else if (ev.key === "Escape") { input.value = ""; run(); input.focus(); }
    });
    // Focus the box as soon as the panel opens (desktop hover / mobile tap).
    const wrap = input.closest(".internal-shell-menu-wrap");
    if (wrap) {
      wrap.addEventListener("mouseenter", () => { if (window.matchMedia("(hover: hover)").matches) setTimeout(() => { if (wrap.matches(":hover")) input.focus({ preventScroll: true }); }, 120); });
      wrap.querySelector(".internal-shell-menu-trigger")?.addEventListener("click", () => setTimeout(() => input.focus({ preventScroll: true }), 50));
    }
  }

  // ---- Edit my profile (modal) ----------------------------------------
  // The person's own directory record: sizes, commute and birthday are
  // theirs to edit; name, code, department, title and hire date are shown
  // read-only (User Admin / PEO records own those).
  function ensureProfileModal() {
    let modal = document.getElementById("internal-shell-profile");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "internal-shell-profile";
    modal.className = "internal-shell-profile-bg";
    modal.innerHTML = `
      <div class="internal-shell-profile" role="dialog" aria-modal="true" aria-labelledby="ispTitle">
        <div class="internal-shell-profile-head">
          <div>
            <div class="internal-shell-profile-title" id="ispTitle">My profile</div>
            <div class="internal-shell-profile-sub" id="ispSub"></div>
          </div>
          <button type="button" class="internal-shell-profile-close" data-close-profile aria-label="Close">&times;</button>
        </div>
        <div class="internal-shell-profile-body" id="ispBody"><div class="internal-shell-profile-note">Loading…</div></div>
        <div class="internal-shell-profile-foot">
          <div class="internal-shell-profile-msg" id="ispMsg"></div>
          <button type="button" class="internal-shell-profile-btn quiet" data-close-profile>Cancel</button>
          <button type="button" class="internal-shell-profile-btn" id="ispSave" disabled>Save</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (ev) => { if (ev.target === modal || ev.target.closest("[data-close-profile]")) closeProfileModal(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && modal.classList.contains("show")) closeProfileModal(); });
    document.getElementById("ispSave").addEventListener("click", saveProfile);
    return modal;
  }
  function closeProfileModal() { document.getElementById("internal-shell-profile")?.classList.remove("show"); }
  const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtDate = (iso) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  let profileState = null;
  async function openProfileModal() {
    const modal = ensureProfileModal();
    modal.classList.add("show");
    const body = document.getElementById("ispBody");
    const msg = document.getElementById("ispMsg");
    msg.textContent = ""; msg.className = "internal-shell-profile-msg";
    document.getElementById("ispSave").disabled = true;
    body.innerHTML = `<div class="internal-shell-profile-note">Loading…</div>`;
    try {
      const res = await fetch(withRoot("api/me/profile"), { credentials: "same-origin" });
      const me = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(me.error || "Couldn't load your profile.");
      profileState = me;
      document.getElementById("ispSub").textContent = [me.name, me.email].filter(Boolean).join(" · ");
      if (!me.found) {
        body.innerHTML = `<div class="internal-shell-profile-note">Your login isn't linked to a directory profile yet, so there's nothing to edit here. Ask an executive to link your email to your employee record in User Admin.</div>`;
        return;
      }
      const shirtOpts = `<option value="">— Pick —</option>` + (me.shirtSizes || []).map((sz) => `<option value="${escHtml(sz)}" ${sz === me.shirtSize ? "selected" : ""}>${escHtml(sz)}</option>`).join("");
      const photoSrc = me.avatar ? `${withRoot("api/me/avatar")}?v=${encodeURIComponent(String(me.avatar))}` : "";
      body.innerHTML = `
        <div class="internal-shell-profile-photo">
          <div class="internal-shell-profile-photo-frame" id="ispPhotoFrame">${photoSrc ? `<img id="ispPhotoImg" src="${photoSrc}" alt="Your profile photo" />` : `<span id="ispPhotoImg" class="internal-shell-profile-photo-empty">${escHtml((me.name || "").split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?")}</span>`}</div>
          <div class="internal-shell-profile-photo-text">
            <strong>Profile photo</strong>
            <span>This is your <a href="${withRoot("signature-builder.html")}">email signature</a> headshot — one picture for both. Changing it here updates signatures already installed in Outlook too. Square crop, resized in your browser before upload.</span>
            <div class="internal-shell-profile-photo-btns">
              <button type="button" class="internal-shell-profile-btn quiet" id="ispPhotoPick">${photoSrc ? "Change photo" : "Add photo"}</button>
              <input type="file" id="ispPhotoFile" accept="image/*" hidden />
            </div>
            <span class="internal-shell-profile-photo-msg" id="ispPhotoMsg"></span>
          </div>
        </div>
        <div class="internal-shell-profile-grid">
          <div class="internal-shell-profile-ro"><span>Employee code</span><strong>${escHtml(me.code || "—")}</strong></div>
          <div class="internal-shell-profile-ro"><span>Department</span><strong>${escHtml(me.department || "—")}</strong></div>
          <div class="internal-shell-profile-ro"><span>Title</span><strong>${escHtml(me.commissionPlan || "—")}</strong></div>
          <div class="internal-shell-profile-ro"><span>Hire date</span><strong>${escHtml(fmtDate(me.hireDate) || "Not on file")}</strong><small>From HR's records — ask HR if it's wrong.</small></div>
        </div>
        <div class="internal-shell-profile-sec">Uniforms</div>
        <div class="internal-shell-profile-grid">
          <label class="internal-shell-profile-field"><span>Shirt size</span><select id="ispShirt">${shirtOpts}</select></label>
          <label class="internal-shell-profile-field"><span>Shoe size</span><input id="ispShoe" type="text" maxlength="20" placeholder="10.5 · W 8 · 11 wide" value="${escHtml(me.shoeSize || "")}" /></label>
        </div>
        <div class="internal-shell-profile-sec">Commute &amp; celebrations</div>
        <div class="internal-shell-profile-grid">
          <label class="internal-shell-profile-field"><span>Commute (miles, round trip)</span><input id="ispCommute" type="number" min="0" max="500" step="0.1" value="${escHtml(me.commuteMiles ?? "")}" /></label>
          <label class="internal-shell-profile-field"><span>Birthday</span><input id="ispBirthday" type="date" value="${escHtml(me.birthday || "")}" /><small>Used for a birthday flag on the team's dashboards — the year is never shown.</small></label>
        </div>`;
      document.getElementById("ispSave").disabled = false;
      wirePhotoControls();
    } catch (err) {
      body.innerHTML = `<div class="internal-shell-profile-note">${escHtml(err.message)}</div>`;
    }
  }
  // ---- profile photo: pick → square-crop + downsize to 256px JPEG in the
  // browser → POST as multipart. Saves immediately (independent of the
  // Save button) and refreshes the header avatar in place.
  async function squareJpeg(file, size = 512) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const side = Math.min(bmp.width, bmp.height);
    const sx = Math.round((bmp.width - side) / 2), sy = Math.round((bmp.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    if (bmp.close) bmp.close();
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image."))), "image/jpeg", 0.86));
  }
  function refreshHeaderAvatar(stamp) {
    document.querySelectorAll(".internal-shell-avatar").forEach((el) => {
      el.querySelector(".internal-shell-avatar-photo")?.remove();
      if (!stamp) return;
      const img = document.createElement("img");
      img.className = "internal-shell-avatar-photo"; img.alt = "";
      img.src = `${withRoot("api/me/avatar")}?v=${encodeURIComponent(String(stamp))}`;
      img.onerror = () => img.remove();
      el.appendChild(img);
    });
  }
  function wirePhotoControls() {
    const pick = document.getElementById("ispPhotoPick"), file = document.getElementById("ispPhotoFile"), msg = document.getElementById("ispPhotoMsg");
    if (!pick || !file) return;
    pick.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      if (!/^image\//.test(f.type)) { msg.textContent = "Pick an image file."; return; }
      msg.textContent = "Uploading…";
      try {
        const blob = await squareJpeg(f);
        const form = new FormData(); form.append("photo", blob, "avatar.jpg");
        const res = await fetch(withRoot("api/me/avatar"), { method: "POST", credentials: "same-origin", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't save the photo.");
        const frame = document.getElementById("ispPhotoFrame");
        if (frame) frame.innerHTML = `<img id="ispPhotoImg" src="${URL.createObjectURL(blob)}" alt="Your profile photo" />`;
        pick.textContent = "Change photo";
        refreshHeaderAvatar(data.updatedAt || Date.now());
        msg.textContent = "Photo saved.";
      } catch (err) { msg.textContent = err.message; }
    });
  }
  async function saveProfile() {
    const btn = document.getElementById("ispSave");
    const msg = document.getElementById("ispMsg");
    const payload = {
      shirtSize: document.getElementById("ispShirt")?.value ?? "",
      shoeSize: (document.getElementById("ispShoe")?.value || "").trim(),
      commuteMiles: document.getElementById("ispCommute")?.value === "" ? 0 : Number(document.getElementById("ispCommute")?.value),
      birthday: document.getElementById("ispBirthday")?.value || ""
    };
    btn.disabled = true; msg.textContent = "Saving…"; msg.className = "internal-shell-profile-msg";
    try {
      const res = await fetch(withRoot("api/me/profile"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save.");
      msg.textContent = "Saved."; msg.className = "internal-shell-profile-msg ok";
      window.dispatchEvent(new CustomEvent("sizes-saved"));
      setTimeout(closeProfileModal, 900);
    } catch (err) {
      msg.textContent = err.message; msg.className = "internal-shell-profile-msg error";
    } finally { btn.disabled = false; }
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-open-profile]")) { event.preventDefault(); openProfileModal(); }
  });
  // Other pages (e.g. the dashboard's sizes card) can open it too.
  window.openMyProfile = openProfileModal;

  // "Transition to Podium Conversation" — any page that shows a customer
  // phone can render <button data-podium-phone="512…">. Tap → the Podium
  // inbox opens in a new tab already searched for that number (Podium has no
  // per-thread deep link; see lib/podium.js), and the Podium app claims the
  // link on a phone. The tab is opened synchronously in the tap so mobile
  // popup rules don't swallow it.
  async function openPodiumConversation(phone, button) {
    const digits = String(phone || "").replace(/\D/g, "").slice(-10);
    const label = button ? button.textContent : "";
    const say = (text, keep) => { if (!button) return; button.textContent = text; button.disabled = !!keep; if (!keep) setTimeout(() => { button.textContent = label; button.disabled = false; }, 3500); };
    if (digits.length !== 10) { say("No phone on file"); return; }
    // The link carries the number the way Podium's own CRM does (phoneNumber=);
    // the clipboard copy (must happen inside the tap) is a fallback for the
    // inbox search box should Podium ever stop honoring it.
    const win = window.open("", "_blank");
    let copied = false;
    try { await navigator.clipboard.writeText(digits); copied = true; } catch {}
    say("Opening Podium…", true);
    try {
      const res = await fetch(`/api/podium/conversation-link?phone=${encodeURIComponent(digits)}`, { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      const url = data.url || data.inboxUrl;
      if (!res.ok) {
        say(data.error || "Couldn't find it");
        if (win) { if (data.inboxUrl) win.location = data.inboxUrl; else win.close(); }
        return;
      }
      if (win) win.location = url; else window.location.href = url;
      say(data.found === false ? "No Podium thread with this number yet" : copied ? "Opening the conversation… (number copied too)" : label);
    } catch (err) {
      say("Podium unreachable");
      if (win) win.close();
    }
  }
  document.addEventListener("click", (event) => {
    const btn = event.target.closest?.("[data-podium-phone]");
    if (btn) { event.preventDefault(); openPodiumConversation(btn.dataset.podiumPhone, btn); }
  });
  window.openPodiumConversation = openPodiumConversation;

  // Paint the shell right away (logo, menu, badge, a blank avatar) so the
  // page never shows a stale static header while the session request is in
  // flight; the personal settings fill in when it resolves.
  try { renderShell(null); } catch (e) { console.warn("Shell pre-render skipped:", e.message); }
  loadSessionUser().then((session) => {
    renderShell(session);
    // The profile's saved scheme wins over the local cache (covers a new
    // machine, a cleared cache, or a choice made on another device). Either
    // way, re-apply after render so the picker buttons mark the active one.
    if (session?.theme) {
      try { localStorage.setItem("wilsonTheme", session.theme); } catch {}
    }
    applyTheme(session?.theme || cachedTheme());
  });
})();
