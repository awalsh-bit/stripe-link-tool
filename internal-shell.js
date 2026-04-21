(function () {
  const body = document.body;

  if (!body) return;

  const label = body.dataset.shellLabel || "Internal Tool";
  const icon = body.dataset.shellIcon || "payments";
  const replaceHero = body.dataset.shellReplaceHero === "true";

  function iconSvg(name) {
    const icons = {
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
      `
    };

    return icons[name] || icons.payments;
  }

  function buildHeader() {
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
                <a class="internal-shell-menu-link" href="dashboard.html">
                  <div class="internal-shell-menu-link-title">Payments</div>
                  <div class="internal-shell-menu-link-text">Payment queue, paid history, and balancing tools.</div>
                </a>
                <a class="internal-shell-menu-link" href="salesdashboard.html">
                  <div class="internal-shell-menu-link-title">Sales Tools</div>
                  <div class="internal-shell-menu-link-text">Open the sales tools workspace.</div>
                </a>
              </div>
            </div>
            <img class="internal-shell-logo" src="logo-black.png" alt="Wilson AC & Appliance" />
            <div class="internal-shell-labels">
              <div class="internal-shell-badge-wrap">
                <span class="internal-shell-badge-icon" aria-hidden="true">${iconSvg(icon)}</span>
                <div class="internal-shell-badge"><span>${label}</span></div>
              </div>
            </div>
          </div>
          <div class="internal-shell-tools">
            <div class="internal-shell-tools-top"></div>
            <div class="internal-shell-tools-row">
              <div class="internal-shell-tools-label">Internal Tools</div>
              <a class="internal-shell-tool-link" href="https://app.podium.com/home" target="_blank" rel="noopener noreferrer">
                <img class="internal-shell-tool-image podium" src="podium-logo.jpg" alt="Podium" />
              </a>
              <a class="internal-shell-tool-link" href="https://wilsonappliance.dispatchtrack.com/a18/login" target="_blank" rel="noopener noreferrer">
                <img class="internal-shell-tool-image" src="dispatchtrack-logo.png" alt="DispatchTrack" />
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function buildFooter() {
    return `
      <div class="internal-shell-footer-row">
        <div class="internal-shell-footer-text">Wilson AC & Appliance internal tools.</div>
        <div class="internal-shell-footer-links">
          <a class="internal-shell-footer-link" href="dashboard.html">Payments Dashboard</a>
          <a class="internal-shell-footer-link" href="salesdashboard.html">Sales Tools</a>
        </div>
      </div>
    `;
  }

  if (replaceHero) {
    const hero = document.querySelector(".hero");
    if (hero) {
      hero.innerHTML = buildHeader();
    }
  } else {
    const headerHost = document.getElementById("internal-shell-header");
    if (headerHost) {
      headerHost.innerHTML = buildHeader();
    }
  }

  const navFooter = document.querySelector(".internal-nav");
  if (navFooter) {
    navFooter.classList.add("internal-shell-footer");
    navFooter.innerHTML = buildFooter();
  } else {
    const footerHost = document.getElementById("internal-shell-footer");
    if (footerHost) {
      footerHost.classList.add("internal-shell-footer");
      footerHost.innerHTML = buildFooter();
    }
  }
})();
