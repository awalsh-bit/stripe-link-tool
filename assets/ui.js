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
    return pageBody.dataset.pageTitle || (pageBody.dataset.mode === "public" ? "Maintenance Plans" : "Maintenance Operations");
  }

  function renderHeader() {
    const host = document.getElementById("site-header");
    if (!host) return;
    const mode = pageBody.dataset.mode || "public";
    const internal = mode === "internal";

    host.className = "site-header";
    host.innerHTML = `
      <div class="page-shell">
        <div class="header-row">
          <div class="brand-side">
            <button class="icon-button" id="menu-button" aria-label="Open navigation" type="button">☰</button>
            <a href="${internal ? "admin.html" : "index.html"}" aria-label="Wilson AC and Appliance home">
              <img class="brand-logo" src="assets/logo-black.png" alt="Wilson AC & Appliance">
            </a>
            <span class="header-edit" aria-hidden="true">✎</span>
            <span class="section-pill">${escapeHtml(sectionTitle())}</span>
          </div>
          ${internal ? `
            <div class="tool-rail">
              <div class="tool-label">Internal tools</div>
              <div class="tool-card"><span>◼ Podium</span></div>
              <div class="tool-card dispatch"><span>DispatchTrack</span></div>
            </div>
          ` : `
            <div class="public-actions">
              <span class="phone">Questions? 512-894-0907</span>
              <a class="button ghost" href="admin.html">Team login</a>
              <a class="button" href="index.html#choose-plan">View plans</a>
            </div>
          `}
        </div>
        <nav class="mobile-menu" id="mobile-menu" aria-label="Mobile navigation">
          ${internal ? `
            <a href="admin.html">Maintenance dashboard</a>
            <a href="quote-builder.html">New custom quote</a>
            <a href="report-builder.html">New health report</a>
            <a href="index.html">Customer enrollment</a>
          ` : `
            <a href="index.html">Maintenance home</a>
            <a href="appliance-signup.html">Household appliance plans</a>
            <a href="hvac-signup.html">HVAC plans</a>
          `}
        </nav>
      </div>
    `;

    const button = document.getElementById("menu-button");
    const menu = document.getElementById("mobile-menu");
    button.addEventListener("click", function () {
      menu.classList.toggle("open");
    });
  }

  function renderLaunchWarning() {
    if (window.location.protocol !== "file:") return;
    const warning = document.createElement("div");
    warning.className = "launch-warning";
    warning.innerHTML = `<strong>Open this prototype with OPEN_WILSON_PORTAL.bat.</strong><span>You are viewing a local HTML file directly, which can break navigation or saved demo data—especially when opened from inside the ZIP.</span>`;
    document.body.insertBefore(warning, document.body.firstChild);
  }

  function renderFooter() {
    const host = document.getElementById("site-footer");
    if (!host) return;
    const internal = (pageBody.dataset.mode || "public") === "internal";
    host.className = "site-footer";
    host.innerHTML = `
      <div class="page-shell">
        <div class="footer-card">
          <span>Wilson AC & Appliance ${internal ? "internal tools" : "- Trusted since 1949"}.</span>
          <nav class="footer-nav" aria-label="Footer navigation">
            ${internal ? `
              <a href="admin.html">Home</a>
              <a href="admin.html#households">Households</a>
              <a href="admin.html#filters">Filters</a>
              <a href="admin.html#reports">Health Reports</a>
              <a href="admin.html#quotes">Custom Quotes</a>
              <a href="index.html">Customer View</a>
            ` : `
              <a href="appliance-signup.html">Appliance Plans</a>
              <a href="hvac-signup.html">HVAC Plans</a>
              <a href="https://wilsonappliance.com">WilsonAppliance.com</a>
            `}
          </nav>
        </div>
      </div>
    `;
  }

  function toast(title, message) {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
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

  document.addEventListener("DOMContentLoaded", function () {
    renderLaunchWarning();
    renderHeader();
    renderFooter();
  });
})();
