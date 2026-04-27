(function () {
  const body = document.body;

  if (!body) return;

  const label = body.dataset.publicShellLabel || "Service Request";

  function iconSvg() {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4.5H17L20 7.5V19a2 2 0 01-2 2H7a2 2 0 01-2-2V6.5a2 2 0 012-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
        <path d="M8.5 11H15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <path d="M8.5 15H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function buildHeader() {
    return `
      <div class="public-shell-header">
        <div class="public-shell-header-top">
          <div class="public-shell-brand">
            <div class="public-shell-menu-wrap">
              <button class="public-shell-menu-trigger" type="button" aria-label="Service forms menu">
                <span class="public-shell-menu-bars">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </button>
              <div class="public-shell-menu-panel">
                <div class="public-shell-menu-empty" aria-hidden="true"></div>
              </div>
            </div>
            <img class="public-shell-logo" src="logo-black.png" alt="Wilson AC & Appliance" />
            <div class="public-shell-badge-wrap">
              <span class="public-shell-badge-icon">${iconSvg()}</span>
              <div class="public-shell-badge"><span>${label}</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function buildFooter() {
    return `
      <div class="public-shell-footer-row">
        <div class="public-shell-footer-text">Wilson AC & Appliance service request forms.</div>
        <a class="public-shell-footer-link" href="terms.html">Service Terms</a>
      </div>
    `;
  }

  const headerHost = document.getElementById("public-shell-header");
  if (headerHost) {
    headerHost.innerHTML = buildHeader();
  }

  const footerHost = document.getElementById("public-shell-footer");
  if (footerHost) {
    footerHost.classList.add("public-shell-footer");
    footerHost.innerHTML = buildFooter();
  }
})();
