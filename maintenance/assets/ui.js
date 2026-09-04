(function () {
  const pageBody = document.body;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(number);
  }

  function shortDate(value) {
    if (!value) return "-";
    const date = new Date(value + (String(value).length === 10 ? "T12:00:00" : ""));
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function daysFromNow(value) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const date = new Date(value + (String(value).length === 10 ? "T12:00:00" : ""));
    date.setHours(0, 0, 0, 0);
    return Math.round((date - today) / 86400000);
  }

  function sectionTitle() {
    return pageBody.dataset.pageTitle || (pageBody.dataset.mode === "public" ? "Wilson Guardian" : "Command Center");
  }

  /*
   * AGILITY SHELL.
   *
   * The prototype drew a replica of the Wilson header and footer here. Inside
   * Agility the chrome belongs to the house shells -- internal-shell.js for
   * signed-in pages (hamburger, tools card, colour scheme) and public-shell.js
   * for the customer-facing pages -- so this file only mounts their host
   * elements, loads the shell script from the dashboard root, and adds the
   * module's own row of links underneath. Everything below the header is the
   * prototype's own markup, untouched.
   */
  const SHELL_ROOT = "/";

  function loadScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const el = document.createElement("script");
    el.src = src;
    el.defer = true;
    document.body.appendChild(el);
  }

  function moduleLink(href, label, extraClass) {
    const here = window.location.pathname.split("/").pop() || "index.html";
    const current = here === href;
    return `<a class="module-nav-item${extraClass ? " " + extraClass : ""}${current ? " current" : ""}" href="${href}"` +
           `${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`;
  }

  function internalModuleNav() {
    const tm = (window.WILSON_CONFIG && window.WILSON_CONFIG.tempMonitoring && window.WILSON_CONFIG.tempMonitoring.serviceShortName) || "Temp Monitoring";
    return `
      <nav class="module-nav" aria-label="Wilson Guardian navigation">
        ${moduleLink("admin.html", "Command Center")}
        ${moduleLink("customers.html", "Customers")}
        ${moduleLink("monitoring.html", tm)}
        ${moduleLink("tech-maintenance.html", "Field Tool")}
        ${moduleLink("invoice-import.html", "Invoice Import")}
        ${moduleLink("filter-finder.html", "Filter Finder")}
        <a class="module-nav-item module-nav-cta" href="index.html">New Registration</a>
      </nav>`;
  }

  function publicModuleNav() {
    return `
      <nav class="module-nav" aria-label="Maintenance plans navigation">
        ${moduleLink("index.html", "Wilson Guardian")}
        ${moduleLink("appliance-signup.html", "Appliance plans")}
        ${moduleLink("hvac-signup.html", "HVAC plans")}
        ${moduleLink("customer-info.html", "How our service works")}
        <span class="module-nav-phone">Questions? 512-894-0907</span>
      </nav>`;
  }

  function renderHeader() {
    const host = document.getElementById("site-header");
    if (!host) return;
    const mode = pageBody.dataset.mode || "public";
    const internal = mode === "internal";
    host.className = "site-header";

    if (internal) {
      pageBody.dataset.shellLabel = pageBody.dataset.shellLabel || ("Wilson Guardian \u00b7 " + sectionTitle());
      pageBody.dataset.shellIcon = pageBody.dataset.shellIcon || "service";
      pageBody.dataset.shellRoot = SHELL_ROOT;
      host.innerHTML = `
        <div class="page-shell">
          <div id="internal-shell-header"></div>
          ${internalModuleNav()}
        </div>`;
      loadScript(SHELL_ROOT + "internal-shell.js");
    } else {
      pageBody.dataset.publicShellLabel = pageBody.dataset.publicShellLabel || "Wilson Guardian";
      pageBody.dataset.publicShellRoot = SHELL_ROOT;
      pageBody.dataset.publicShellFooterText = pageBody.dataset.publicShellFooterText || "Wilson Guardian by Wilson AC & Appliance. Trusted since 1949.";
      pageBody.dataset.publicShellFooterLinkLabel = pageBody.dataset.publicShellFooterLinkLabel || "How our service works";
      pageBody.dataset.publicShellFooterLinkHref = pageBody.dataset.publicShellFooterLinkHref || "customer-info.html";
      host.innerHTML = `
        <div class="page-shell">
          <div id="public-shell-header"></div>
          ${publicModuleNav()}
        </div>`;
      loadScript(SHELL_ROOT + "public-shell.js");
    }
  }

  function renderLaunchWarning() {
    if (window.location.protocol !== "file:") return;
    const warning = document.createElement("div");
    warning.className = "launch-warning";
    warning.innerHTML = `<strong>Open this module from Agility.</strong><span>You are viewing a local HTML file directly, which breaks navigation and the signed-in shell.</span>`;
    document.body.insertBefore(warning, document.body.firstChild);
  }

  function renderFooter() {
    const host = document.getElementById("site-footer");
    if (!host) return;
    const internal = (pageBody.dataset.mode || "public") === "internal";
    host.className = "site-footer";
    host.innerHTML = `
      <div class="page-shell">
        <div id="${internal ? "internal-shell-footer" : "public-shell-footer"}"></div>
      </div>`;
  }

  function toast(title, message) {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      /*
       * Announced, because this is not decoration. The toast is the ONLY
       * channel for "Required steps missing", "Report not generated",
       * "Billing blocked" and "Report email blocked" -- a technician using a
       * screen reader tapped Complete, heard nothing, and had no way to learn
       * why. Polite rather than assertive: it must not cut across someone
       * mid-checkpoint. offline.js and photo-sync.js already do this; this is
       * the same treatment.
       */
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "false");
      document.body.appendChild(region);
    }
    const item = document.createElement("div");
    item.className = "toast";
    item.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(message || "")}</div>`;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), 3600);
  }

  function setupTabs(root) {
    const container = root || document;
    container.querySelectorAll("[data-tab-target]").forEach(function (button) {
      button.addEventListener("click", function () {
        const target = button.dataset.tabTarget;
        container.querySelectorAll("[data-tab-target]").forEach((item) => item.classList.remove("active"));
        container.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
        button.classList.add("active");
        const panel = document.getElementById(target);
        if (panel) panel.classList.add("active");
        if (history.replaceState) history.replaceState(null, "", "#" + target.replace("panel-", ""));
      });
    });
  }

  window.WilsonUI = {
    escapeHtml,
    money,
    shortDate,
    daysFromNow,
    toast,
    setupTabs
  };

  /*
   * SIGNED-IN IDENTITY. The technician who stamps an inspection is whoever is
   * signed in to Agility -- never a dropdown, never a URL parameter. The
   * session is cached for synchronous readers (the field tool renders before
   * the fetch answers) and announced when it arrives.
   */
  function cachedSessionUser() {
    try {
      const raw = sessionStorage.getItem("wilsonSessionUser");
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }
  window.WILSON_SESSION_USER = cachedSessionUser();

  function loadSessionUser() {
    if ((pageBody.dataset.mode || "public") !== "internal") return;
    fetch(SHELL_ROOT + "api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const user = data && data.user;
        if (!user) return;
        const record = {
          id: user.id || null,
          email: user.email || "",
          name: String(user.displayName || user.name || user.email || "").trim() || "Wilson technician",
          code: user.employeeCode || user.code || ""
        };
        window.WILSON_SESSION_USER = record;
        try { sessionStorage.setItem("wilsonSessionUser", JSON.stringify(record)); } catch (err) { /* private mode */ }
        document.dispatchEvent(new CustomEvent("wilson:session", { detail: record }));
      })
      .catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderLaunchWarning();
    renderHeader();
    renderFooter();
    loadSessionUser();
  });
})();
