import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import {
  readLinks,
  writeLinks,
  upsertLink,
  readTerminalPayments,
  writeTerminalPayments,
  readDepositAgreements,
  writeDepositAgreements,
  readDepositPaymentEvents,
  writeDepositPaymentEvents,
  readServiceCards,
  writeServiceCards,
  readArchivedServiceCards,
  readEventCatalog,
  writeEventCatalog,
  readEventRsvps,
  writeEventRsvps
} from "./lib/data.js";
import {
  stripe,
  createStripeIdempotencyKey,
  createStripeIdempotencyKeyFromPayload,
  paymentLinkLookupMatches,
  findStripePaymentLinkByLookup,
  buildRecoveredLinkRecordFromStripeLink,
  getStripeAmountsForPaymentIntentWithRetry,
  listPayoutsWithRetry,
  listChargesWithRetry,
  listBalanceTransactionsForPayoutWithRetry,
  retrievePaymentIntentWithDetails,
  retrievePaymentIntentWithDetailsWithRetry,
  retrieveChargeWithRetry,
  sleep
} from "./lib/stripe.js";
import {
  isUserStoreConfigured,
  ensureUserAccessTables,
  normalizeEmail,
  isEmailInAllowedDomain,
  getAllowedSignupDomain,
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  createUser,
  findUserByEmail,
  getUserById,
  markUserVerifiedAndActive,
  updateUserPassword,
  setUserStatus,
  setUserExecutive,
  updateUserProfile,
  listUsersWithAccess,
  createAuthToken,
  consumeAuthToken,
  peekAuthToken,
  createSession,
  getSessionWithUser,
  deleteSessionByToken,
  deleteSessionsForUser,
  cleanupExpiredAuthRows,
  getGrantedPagesForUser,
  setUserPagePermissions,
  setUserPreferences,
  recordAudit,
  listAuditLog,
  searchAuditLog,
  listAuditActions,
  TOKEN_TTLS_SECONDS
} from "./lib/users-postgres.js";
import {
  ensureCommissionTables,
  finalizeExpiredCommissionRuns,
  listCommissionRuns,
  createCommissionRun,
  getCommissionRunDetail,
  recalculateCommissionLine,
  updateCommissionLineClassification,
  lockCommissionRun,
  lockCommissionSalesperson,
  updateCommissionSalespersonAdjustment,
  updateCommissionHvacOrderSettings,
  deleteCommissionRun
} from "./lib/commissions-postgres.js";
import {
  listEmployeeDirectory,
  getEmployeeDirectoryObject,
  upsertEmployeeDirectoryEntry,
  deleteEmployeeDirectoryEntry,
  findEmployeeDirectoryEntryByEmail,
  validateEmployeeCode,
  normalizeEmployeeCode
} from "./lib/employee-directory.js";
import {
  isSteelCodConfigured,
  SteelCodError,
  createSpecPackage,
  searchSpecPackages,
  retrieveSpecPackage,
  deleteSpecPackage,
  retrieveUsers as retrieveSteelCodUsers,
  buildSpecPackageUrls
} from "./lib/steelcod.js";
import { PDFDocument } from "pdf-lib";
import {
  computeReimbursedMiles,
  computeReportTotals,
  listMileageRates,
  getMileageRateForYear,
  upsertMileageRate,
  getMileageReportById,
  getOrCreateMileageReport,
  listMileageReportsForUser,
  listMileageReportsForReview,
  saveMileageEntries,
  setMileageReportStatus
} from "./lib/mileage-postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DASHBOARD_HOST = (process.env.DASHBOARD_HOST || "dashboards.wilsonappliance.com").toLowerCase();
const SERVICE_PUBLIC_HOST = (process.env.SERVICE_PUBLIC_HOST || "service.wilsonappliance.com").toLowerCase();
const AUTH_COOKIE_NAME = "wilson_dashboard_session";
const AUTH_COOKIE_TTL_SECONDS = 60 * 60 * 12;
const LEADER_USERNAME = String(process.env.APP_USERNAME || "wilson").trim();
const LEADER_PASSWORD = String(process.env.APP_PASSWORD || "");
const EXECUTIVE_USERNAME = String(process.env.EXECUTIVE_USERNAME || "awalsh@wilsonappliance.com").trim();
const EXECUTIVE_PASSWORD = String(process.env.EXECUTIVE_PASSWORD || "").trim();
const AUTH_COOKIE_SECRET =
  process.env.SESSION_SECRET ||
  `${LEADER_USERNAME}:${LEADER_PASSWORD || "wilson"}`;
// Feature flag for the legacy shared "wilson" login. Default true during the
// migration; set LEGACY_SHARED_LOGIN_ENABLED=false to fully deactivate it.
const LEGACY_SHARED_LOGIN_ENABLED =
  String(process.env.LEGACY_SHARED_LOGIN_ENABLED ?? "true").trim().toLowerCase() !== "false";
// Server-side session lifetime (defaults to the previous cookie TTL of 12h).
const SESSION_TTL_SECONDS =
  Number(process.env.SESSION_TTL_SECONDS) > 0
    ? Number(process.env.SESSION_TTL_SECONDS)
    : AUTH_COOKIE_TTL_SECONDS;
const app = express();
app.set("trust proxy", true);
app.use(cors());

const SERVICE_PUBLIC_PATHS = new Set([
  "/",
  "/fireflavor",
  "/applianceservice.html",
  "/fireflavor.html",
  "/terms.html",
  "/public-shell.css",
  "/public-shell.js",
  "/logo-black.png",
  "/fireflavor-hero.png",
  "/fireflavor-what-to-expect.png",
  "/favicon.svg",
  "/robots.txt",
  "/favicon.ico"
]);

const SERVICE_PUBLIC_API_PREFIXES = [
  "/api/config",
  "/api/events/fire-flavor/rsvp",
  "/api/service/setup-intent",
  "/api/service/submit-request",
  "/api/service/setup-intent-result/",
  "/api/service/prefill/"
];

const ALWAYS_PUBLIC_PATHS = new Set([
  "/api/stripe/webhook"
]);

const PUBLIC_AUTH_PATHS = new Set([
  "/logo-black.png",
  "/favicon.svg",
  "/api/login",
  "/api/logout",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/accept-invite",
  "/api/auth/request-reset",
  "/api/auth/reset",
  "/api/auth/token-status"
]);

const INTERNAL_PAGE_PATHS = new Set([
  "/dashboard.html",
  "/salesdashboard.html",
  "/secret-menu.html",
  "/event-rsvps.html",
  "/commissions.html",
  "/commissions-print.html",
  "/hvac-dashboard.html",
  "/link-detail-lookup.html",
  "/intent-lookup.html",
  "/login.html",
  "/logout.html",
  "/index.html",
  "/terminal.html",
  "/charge-saved-card.html",
  "/paid-order-detail.html",
  "/bank-balancing.html",
  "/incoming-payouts.html",
  "/appliance-service-calls.html",
  "/archive-service-calls.html",
  "/register.html",
  "/set-password.html",
  "/user-admin.html",
  "/audit-log.html",
  "/mileage.html",
  "/mileage-review.html",
  "/spec-packages.html"
]);

const UNAUTHENTICATED_INTERNAL_PATHS = new Set([
  "/login.html",
  "/logout.html",
  "/register.html",
  "/set-password.html"
]);

// ACCESS_GROUPS serve ONE purpose now: authorization for the LEGACY
// shared/env logins (unchanged behavior). Quick-assign presets in
// user-admin.html come from JOB_CODE_PRESETS below — do not add UI preset
// roles here, since every key in this map must remain a valid legacy login
// access group.
const ACCESS_GROUPS = {
  leader: {
    label: "Leader",
    pages: ["*"],
    excludedPages: ["/commissions.html", "/commissions-print.html", "/user-admin.html"]
  },
  executive: {
    label: "Executive",
    pages: ["*"]
  },
  accounting: {
    label: "Accounting",
    pages: ["/paid-order-detail.html", "/bank-balancing.html", "/incoming-payouts.html", "/intent-lookup.html", "/link-detail-lookup.html"]
  },
  sales: {
    label: "Sales",
    pages: ["/dashboard.html", "/salesdashboard.html", "/secret-menu.html", "/event-rsvps.html", "/index.html", "/terminal.html", "/charge-saved-card.html", "/link-detail-lookup.html", "/paid-order-detail.html"]
  },
  service: {
    label: "Service",
    pages: ["/appliance-service-calls.html", "/archive-service-calls.html", "/intent-lookup.html", "/link-detail-lookup.html", "/paid-order-detail.html"]
  }
};

// Pages that exist for the auth flow itself and are never permission-managed.
const AUTH_PAGE_PATHS = new Set([
  "/login.html",
  "/logout.html",
  "/register.html",
  "/set-password.html"
]);

// Executive-only pages: reachable only with is_executive, never grantable.
const EXECUTIVE_ONLY_PAGE_PATHS = new Set([
  "/user-admin.html",
  "/audit-log.html",
  "/commissions.html",
  "/commissions-print.html"
]);

// Canonical list of pages an executive can grant/deny per user. Derived from
// INTERNAL_PAGE_PATHS so the admin UI and enforcement share one source.
const MANAGEABLE_PAGE_PATHS = [...INTERNAL_PAGE_PATHS]
  .filter((p) => !AUTH_PAGE_PATHS.has(p) && !EXECUTIVE_ONLY_PAGE_PATHS.has(p))
  .sort();

// Job-code presets for the User Admin UI. Clicking one CHECKS the included
// pages in the permission editor (staged, additive — combine presets freely);
// nothing is applied until the executive clicks Save. "*" = every manageable
// page. Purely a convenience: the per-user rows remain the source of truth.
const JOB_CODE_PRESETS = {
  sales: {
    label: "Sales",
    pages: [
      "/salesdashboard.html",
      "/secret-menu.html",
      "/spec-packages.html",
      "/event-rsvps.html",
      "/dashboard.html",
      "/index.html",
      "/terminal.html",
      "/charge-saved-card.html",
      "/paid-order-detail.html"
    ]
  },
  repair_tech: {
    label: "Repair Tech",
    pages: [
      "/appliance-service-calls.html",
      "/archive-service-calls.html"
    ]
  },
  client_care: {
    label: "Client Care",
    pages: [
      "/appliance-service-calls.html",
      "/archive-service-calls.html",
      "/intent-lookup.html",
      "/link-detail-lookup.html",
      "/paid-order-detail.html"
    ]
  },
  accounting: {
    label: "Accounting",
    pages: [
      "/paid-order-detail.html",
      "/bank-balancing.html",
      "/incoming-payouts.html",
      "/intent-lookup.html",
      "/link-detail-lookup.html"
    ]
  },
  installer: {
    label: "Installer",
    pages: [
      "/hvac-dashboard.html",
      "/terminal.html",
      "/charge-saved-card.html"
    ]
  },
  warehouse: {
    label: "Warehouse",
    pages: [
      "/secret-menu.html",
      "/spec-packages.html"
    ]
  },
  leader: {
    label: "Leader",
    pages: ["*"]
  }
};

function expandJobCodePresetPages(presetKey) {
  const preset = JOB_CODE_PRESETS[presetKey];
  if (!preset) return [];
  if (preset.pages.includes("*")) return [...MANAGEABLE_PAGE_PATHS];
  return preset.pages.filter((p) => MANAGEABLE_PAGE_PATHS.includes(p));
}

const PAGE_LABELS = {
  "/dashboard.html": "Payments Dashboard",
  "/index.html": "Send Payment Link",
  "/terminal.html": "Send To Card Reader",
  "/charge-saved-card.html": "Charge A Saved Card",
  "/hvac-dashboard.html": "Deposit Agreements",
  "/paid-order-detail.html": "Paid Order Detail",
  "/intent-lookup.html": "Issue Refund",
  "/incoming-payouts.html": "Incoming Payouts",
  "/bank-balancing.html": "Bank Balancing",
  "/link-detail-lookup.html": "Link Detail Lookup",
  "/appliance-service-calls.html": "Service Request Queue",
  "/archive-service-calls.html": "Archived Service Calls",
  "/salesdashboard.html": "Sales Dashboard",
  "/secret-menu.html": "Secret Menu",
  "/event-rsvps.html": "Event RSVPs",
  "/spec-packages.html": "Spec Packages",
  "/commissions.html": "Commissions",
  "/commissions-print.html": "Commissions (Print)",
  "/user-admin.html": "User Admin",
  "/audit-log.html": "User Activity Audit",
  "/mileage.html": "Mileage",
  "/mileage-review.html": "Mileage Review"
};

// Category groupings for the User Admin permission UI. A page may appear in
// multiple categories (it is still one underlying permission); any manageable
// page not listed here lands in an automatic "Other" bucket in the UI.
const PAGE_CATEGORIES = [
  {
    key: "payments",
    label: "Payments",
    pages: [
      "/dashboard.html",
      "/index.html",
      "/terminal.html",
      "/charge-saved-card.html",
      "/hvac-dashboard.html",
      "/link-detail-lookup.html"
    ]
  },
  {
    key: "accounting",
    label: "Accounting",
    pages: [
      "/paid-order-detail.html",
      "/intent-lookup.html",
      "/incoming-payouts.html",
      "/bank-balancing.html",
      "/link-detail-lookup.html"
    ]
  },
  {
    key: "client_care",
    label: "Client Care",
    pages: [
      "/appliance-service-calls.html",
      "/archive-service-calls.html",
      "/intent-lookup.html",
      "/link-detail-lookup.html",
      "/paid-order-detail.html"
    ]
  },
  {
    key: "sales",
    label: "Sales",
    pages: [
      "/salesdashboard.html",
      "/secret-menu.html",
      "/spec-packages.html",
      "/event-rsvps.html",
      "/dashboard.html",
      "/index.html",
      "/terminal.html",
      "/charge-saved-card.html",
      "/paid-order-detail.html"
    ]
  }
];

// Convenience aliases that serve internal pages under different paths, so the
// page-permission check can't be bypassed by requesting the alias.
const DASHBOARD_PAGE_ALIASES = {
  "/": "/dashboard.html",
  "/secret-menu": "/secret-menu.html",
  "/commissions-print": "/commissions-print.html"
};

function resolveDashboardPagePath(pathname) {
  return DASHBOARD_PAGE_ALIASES[pathname] || pathname;
}

function normalizeUsernameValue(username) {
  return String(username || "").trim().toLowerCase();
}

function getConfiguredUsers() {
  const users = [
    {
      username: LEADER_USERNAME,
      normalizedUsername: normalizeUsernameValue(LEADER_USERNAME),
      password: LEADER_PASSWORD,
      displayName: "Wilson",
      role: "leader",
      accessGroup: "leader"
    }
  ];

  if (EXECUTIVE_USERNAME && EXECUTIVE_PASSWORD) {
    users.push({
      username: EXECUTIVE_USERNAME,
      normalizedUsername: normalizeUsernameValue(EXECUTIVE_USERNAME),
      password: EXECUTIVE_PASSWORD,
      displayName: "Andrew Walsh",
      role: "executive",
      accessGroup: "executive"
    });
  }

  return users;
}

function findConfiguredUser(username, password) {
  const normalizedUsername = normalizeUsernameValue(username);
  return getConfiguredUsers().find((user) =>
    user.normalizedUsername === normalizedUsername &&
    String(password || "") === user.password
  ) || null;
}

function getRequestHost(req) {
  return String(req.hostname || req.get("host") || "")
    .split(":")[0]
    .toLowerCase();
}

function isLocalHost(host) {
  return ["localhost", "127.0.0.1"].includes(host);
}

function isServicePublicPath(pathname) {
  return (
    SERVICE_PUBLIC_PATHS.has(pathname) ||
    SERVICE_PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
  );
}

function isAlwaysPublicPath(pathname) {
  return ALWAYS_PUBLIC_PATHS.has(pathname);
}

function isPublicAuthPath(pathname) {
  return PUBLIC_AUTH_PATHS.has(pathname);
}

function buildHostUrl(req, targetHost) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${targetHost}${req.originalUrl}`;
}

function getServiceBaseUrl(req) {
  const host = getRequestHost(req);

  if (SERVICE_PUBLIC_HOST && !isLocalHost(host)) {
    const protocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || req.protocol || "https";
    return `${protocol}://${SERVICE_PUBLIC_HOST}`;
  }

  return `${req.protocol}://${req.get("host")}`;
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  return header.split(";").reduce((acc, pair) => {
    const [rawName, ...rawValueParts] = pair.split("=");
    const name = rawName?.trim();
    if (!name) return acc;
    acc[name] = decodeURIComponent(rawValueParts.join("=").trim());
    return acc;
  }, {});
}

function signAuthPayload(payloadText) {
  return crypto
    .createHmac("sha256", AUTH_COOKIE_SECRET)
    .update(payloadText)
    .digest("base64url");
}

function createAuthCookieValue(user) {
  const payloadText = Buffer.from(JSON.stringify({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    accessGroup: user.accessGroup,
    issuedAt: Date.now(),
    expiresAt: Date.now() + AUTH_COOKIE_TTL_SECONDS * 1000
  })).toString("base64url");

  const signature = signAuthPayload(payloadText);
  return `${payloadText}.${signature}`;
}

function readAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const rawValue = cookies[AUTH_COOKIE_NAME];

  if (!rawValue || !rawValue.includes(".")) {
    return null;
  }

  const [payloadText, signature] = rawValue.split(".");
  const expectedSignature = signAuthPayload(payloadText);

  if (!signature || signature.length !== expectedSignature.length) {
    return null;
  }

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    if (!payload?.expiresAt || payload.expiresAt < Date.now()) {
      return null;
    }

    if (payload.accessGroup === "super_user" || payload.role === "super_user") {
      payload.accessGroup = "leader";
      payload.role = "leader";
      payload.displayName = payload.displayName || "Wilson";
    }

    return payload;
  } catch {
    return null;
  }
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return forwardedProto === "https" || req.secure;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setAuthCookie(req, res, user) {
  res.setHeader("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, createAuthCookieValue(user), {
    maxAge: AUTH_COOKIE_TTL_SECONDS,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(req)
  }));
}

function clearAuthCookie(req, res) {
  res.setHeader("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(req)
  }));
}

function buildSessionUser(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    accessGroup: user.accessGroup
  };
}

// req.authUser shape (set by the global auth middleware):
//   kind: "db" | "legacy"
//   id (db users), email, username, displayName
//   isExecutive: can manage users + reach executive-only pages/APIs
//   accessGroup: legacy group key, or "executive"/"member" for db users
//   grantedPages: string[] — effective page grants (db users; empty until an
//                 executive assigns pages)
function canAccessPathForUser(user, pathname) {
  if (!user) {
    return false;
  }

  if (AUTH_PAGE_PATHS.has(pathname)) {
    return true;
  }

  if (EXECUTIVE_ONLY_PAGE_PATHS.has(pathname)) {
    if (user.kind === "db") {
      return user.isExecutive === true;
    }
    // Legacy logins fall through to group logic (leader excludes these pages).
  }

  if (user.kind === "db") {
    if (user.isExecutive) {
      return true;
    }
    return Array.isArray(user.grantedPages) && user.grantedPages.includes(pathname);
  }

  // Legacy env-based logins: unchanged ACCESS_GROUPS behavior.
  if (!user.accessGroup) {
    return false;
  }

  const group = ACCESS_GROUPS[user.accessGroup];
  if (!group) {
    return false;
  }

  if (group.excludedPages?.includes(pathname)) {
    return false;
  }

  if (group.pages?.includes("*")) {
    return true;
  }

  return group.pages?.includes(pathname);
}

// Effective page list for the front-end nav (and the admin UI).
function getEffectivePagesForUser(user) {
  if (!user) return [];

  return [...INTERNAL_PAGE_PATHS]
    .filter((p) => !AUTH_PAGE_PATHS.has(p))
    .filter((p) => canAccessPathForUser(user, p))
    .sort();
}

function sendForbiddenPage(res) {
  return res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <title>Access restricted</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: Inter, system-ui, sans-serif; background: linear-gradient(180deg, #eef2ff 0%, #f7f8fc 100%); color: #1f2937; padding: 24px; }
    .card { width: min(100%, 480px); background: #fff; border: 1px solid rgba(99, 91, 255, 0.12); border-radius: 18px; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.08); padding: 28px; text-align: center; }
    h1 { margin: 0 0 10px; font-size: 32px; }
    p { margin: 0 0 18px; color: #6b7280; line-height: 1.6; }
    a { display: inline-flex; align-items: center; justify-content: center; padding: 12px 16px; border-radius: 12px; background: #635bff; color: #fff; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access restricted</h1>
    <p>Your account does not have access to this page. An executive can grant access from the User Admin screen.</p>
    <a href="/login.html">Back to sign in</a>
  </div>
</body>
</html>`);
}

function isExecutiveUser(user) {
  if (!user) return false;
  if (user.kind === "db") return user.isExecutive === true;
  return user.accessGroup === "executive";
}

function requireExecutiveApi(req, res, next) {
  if (!isExecutiveUser(req.authUser)) {
    return res.status(403).json({
      error: "Executive access is required."
    });
  }

  return next();
}

// API-level authorization: the request is allowed when the user holds a page
// grant for ANY of the listed pages (the pages that legitimately call the
// endpoint). Executives always pass. Mirrors requireExecutiveApi.
function requirePagePermission(...pagePaths) {
  return (req, res, next) => {
    const user = req.authUser;

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (isExecutiveUser(user) || pagePaths.some((page) => canAccessPathForUser(user, page))) {
      return next();
    }

    return res.status(403).json({
      error: "You do not have access to this tool. Ask an executive to grant access."
    });
  };
}

// ---------------------------------------------------------------------------
// Simple fixed-window, per-IP rate limiter for auth endpoints.
// ---------------------------------------------------------------------------

const rateLimitBuckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitBuckets) {
    if (now > entry.resetAt) {
      rateLimitBuckets.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

function rateLimit(name, maxAttempts, windowMs) {
  return (req, res, next) => {
    const key = `${name}|${req.ip || "unknown"}`;
    const now = Date.now();
    const entry = rateLimitBuckets.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;

    if (entry.count > maxAttempts) {
      return res.status(429).json({
        error: "Too many attempts. Please wait a few minutes and try again."
      });
    }

    return next();
  };
}

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use((req, res, next) => {
  const host = getRequestHost(req);

  if (isLocalHost(host) || !host) {
    return next();
  }

  if (host === SERVICE_PUBLIC_HOST && INTERNAL_PAGE_PATHS.has(req.path)) {
    return res.redirect(302, buildHostUrl(req, DASHBOARD_HOST));
  }

  if (host === DASHBOARD_HOST && req.path !== "/" && SERVICE_PUBLIC_PATHS.has(req.path)) {
    return res.redirect(302, buildHostUrl(req, SERVICE_PUBLIC_HOST));
  }

  next();
});


// Resolve the auth cookie to a user.
// - DB sessions: opaque random token (no "."), looked up server-side, so a
//   disabled user or deleted session is revoked on the very next request.
// - Legacy signed cookies: contain a "." (payload.signature). Leader cookies
//   are honored only while LEGACY_SHARED_LOGIN_ENABLED; the env break-glass
//   executive cookie is always honored so the DB can never lock you out.
async function resolveAuthUser(req) {
  const cookies = parseCookies(req);
  const rawValue = cookies[AUTH_COOKIE_NAME];

  if (!rawValue) {
    return null;
  }

  if (!rawValue.includes(".")) {
    if (!isUserStoreConfigured()) {
      return null;
    }

    try {
      const resolved = await getSessionWithUser(rawValue);
      if (!resolved) return null;

      const grantedPages = resolved.user.is_executive
        ? []
        : await getGrantedPagesForUser(resolved.user.id);

      return {
        kind: "db",
        id: resolved.user.id,
        sessionId: resolved.sessionId,
        email: resolved.user.email,
        username: resolved.user.email,
        displayName: resolved.user.display_name || resolved.user.email,
        isExecutive: Boolean(resolved.user.is_executive),
        accessGroup: resolved.user.is_executive ? "executive" : "member",
        role: resolved.user.is_executive ? "executive" : "member",
        grantedPages,
        preferences: resolved.user.preferences || {}
      };
    } catch (err) {
      console.error("Session lookup failed:", err.message);
      return null;
    }
  }

  const legacyUser = readAuthenticatedUser(req);

  if (!legacyUser) {
    return null;
  }

  const isLegacyExecutive = legacyUser.accessGroup === "executive";

  if (!LEGACY_SHARED_LOGIN_ENABLED && !isLegacyExecutive) {
    return null;
  }

  return {
    kind: "legacy",
    id: null,
    email: legacyUser.username || "",
    username: legacyUser.username || "",
    displayName: legacyUser.displayName || legacyUser.username || "",
    isExecutive: isLegacyExecutive,
    accessGroup: legacyUser.accessGroup,
    role: legacyUser.role,
    grantedPages: null
  };
}

app.use(async (req, res, next) => {
  const host = getRequestHost(req);
  const isWebhookRequest = isAlwaysPublicPath(req.path);
  const isPublicServiceRequest =
    (host === SERVICE_PUBLIC_HOST || isLocalHost(host)) &&
    isServicePublicPath(req.path);
  const isUnauthenticatedInternalPage =
    (host === DASHBOARD_HOST || isLocalHost(host)) &&
    UNAUTHENTICATED_INTERNAL_PATHS.has(req.path);
  const isPublicAuthRequest =
    (host === DASHBOARD_HOST || isLocalHost(host)) &&
    isPublicAuthPath(req.path);

  if (isWebhookRequest || isPublicServiceRequest || isUnauthenticatedInternalPage || isPublicAuthRequest) {
    return next();
  }

  let authUser = null;
  try {
    authUser = await resolveAuthUser(req);
  } catch (err) {
    console.error("Auth resolution failed:", err.message);
    authUser = null;
  }

  if (authUser) {
    req.authUser = authUser;

    if (host === DASHBOARD_HOST || isLocalHost(host)) {
      const effectivePath =
        host === DASHBOARD_HOST || req.path !== "/"
          ? resolveDashboardPagePath(req.path)
          : req.path;

      if (
        INTERNAL_PAGE_PATHS.has(effectivePath) &&
        !UNAUTHENTICATED_INTERNAL_PATHS.has(effectivePath) &&
        !canAccessPathForUser(authUser, effectivePath)
      ) {
        return sendForbiddenPage(res);
      }
    }

    return next();
  }

  const wantsHtml =
    req.method === "GET" &&
    !req.path.startsWith("/api/") &&
    (req.accepts("html") || req.path.endsWith(".html") || req.path === "/");

  if ((host === DASHBOARD_HOST || isLocalHost(host)) && wantsHtml) {
    return res.redirect(302, "/login.html");
  }

  return res.status(401).json({
    error: "Authentication required."
  });
});

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  process.env.PAYMENT_NOTIFICATION_FROM_EMAIL ||
  "";
const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Chicago";
const COMPLETED_PAYMENT_LINK_MESSAGE =
  "This link has completed successfully. Please contact Wilson Appliance for a copy of your invoice.";
const SINGLE_USE_PAYMENT_LINK_LIMIT = 1;

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET.");
    }

    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).send("Missing Stripe signature.");
    }

    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      await processCheckoutSessionWebhookEvent(event);
    }

    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed"
    ) {
      await processPaymentIntentWebhookEvent(event);
    }

    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook error: ${err.message}`);
  }
});

app.use(express.json({ limit: "10mb" }));

// ---------------------------------------------------------------------------
// Auth email delivery (Resend — same env vars as payment notifications)
// ---------------------------------------------------------------------------

function buildDashboardBaseUrl(req) {
  const host = getRequestHost(req);

  if (isLocalHost(host) || !host) {
    return `${req.protocol}://${req.get("host")}`;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${DASHBOARD_HOST}`;
}

async function sendAuthEmail(recipient, subject, text, html) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Email delivery is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL).");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [recipient],
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email API error: ${response.status} ${errorText}`);
  }
}

function buildAuthEmailHtml(title, bodyLines, buttonLabel, buttonUrl, footerLine) {
  const paragraphs = bodyLines
    .map((line) => `<p style="margin: 0 0 12px;">${escapeHtmlForEmail(line)}</p>`)
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 560px;">
      <h2 style="margin: 0 0 16px;">${escapeHtmlForEmail(title)}</h2>
      ${paragraphs}
      <p style="margin: 20px 0;">
        <a href="${buttonUrl}" style="display: inline-block; padding: 12px 20px; border-radius: 10px; background: #635bff; color: #ffffff; text-decoration: none; font-weight: 700;">${escapeHtmlForEmail(buttonLabel)}</a>
      </p>
      <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">If the button does not work, copy this link into your browser:<br>${escapeHtmlForEmail(buttonUrl)}</p>
      <p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtmlForEmail(footerLine)}</p>
    </div>
  `;
}

async function sendVerificationEmail(req, email, rawToken) {
  const url = `${buildDashboardBaseUrl(req)}/login.html?verifyToken=${encodeURIComponent(rawToken)}`;
  const hours = Math.round(TOKEN_TTLS_SECONDS.verify / 3600);
  const lines = [
    "Thanks for registering for the Wilson AC & Appliance internal tools.",
    "Confirm your email address to activate your account. After you verify, an executive still needs to grant you access to specific tools before you can use them.",
    `This link expires in ${hours} hours and can only be used once.`
  ];

  await sendAuthEmail(
    email,
    "Verify your email — Wilson internal tools",
    [...lines, "", `Verify: ${url}`].join("\n"),
    buildAuthEmailHtml("Verify your email", lines, "Verify email", url, "If you did not register, you can ignore this email.")
  );
}

async function sendInviteEmail(req, email, rawToken) {
  const url = `${buildDashboardBaseUrl(req)}/set-password.html?kind=invite&token=${encodeURIComponent(rawToken)}`;
  const hours = Math.round(TOKEN_TTLS_SECONDS.invite / 3600);
  const lines = [
    "You have been invited to the Wilson AC & Appliance internal tools.",
    "Choose a password to finish setting up your account.",
    `This invitation expires in ${hours} hours and can only be used once.`
  ];

  await sendAuthEmail(
    email,
    "You're invited — Wilson internal tools",
    [...lines, "", `Set your password: ${url}`].join("\n"),
    buildAuthEmailHtml("Set up your account", lines, "Set your password", url, "If you were not expecting this invitation, you can ignore this email.")
  );
}

async function sendPasswordResetEmail(req, email, rawToken) {
  const url = `${buildDashboardBaseUrl(req)}/set-password.html?kind=reset&token=${encodeURIComponent(rawToken)}`;
  const minutes = Math.round(TOKEN_TTLS_SECONDS.reset / 60);
  const lines = [
    "A password reset was requested for your Wilson internal tools account.",
    `This link expires in ${minutes} minutes and can only be used once.`
  ];

  await sendAuthEmail(
    email,
    "Reset your password — Wilson internal tools",
    [...lines, "", `Reset your password: ${url}`].join("\n"),
    buildAuthEmailHtml("Reset your password", lines, "Reset password", url, "If you did not request this, you can ignore this email — your password is unchanged.")
  );
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));

  if (bufA.length !== bufB.length) {
    // Compare anyway against self to keep timing flat, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

// Pre-computed dummy hash so login timing is identical for unknown emails.
const DUMMY_PASSWORD_HASH_PROMISE = hashPassword(crypto.randomBytes(16).toString("hex"));

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

function setDbSessionCookie(req, res, rawToken) {
  res.setHeader("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, rawToken, {
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(req)
  }));
}

function buildDbUserResponse(userRow, grantedPages) {
  return {
    id: userRow.id,
    email: userRow.email,
    username: userRow.email,
    displayName: userRow.display_name || userRow.email,
    isExecutive: Boolean(userRow.is_executive),
    accessGroup: userRow.is_executive ? "executive" : "member",
    role: userRow.is_executive ? "executive" : "member",
    grantedPages: Array.isArray(grantedPages) ? grantedPages : []
  };
}

// Break-glass: the env-configured executive can always sign in, even if the
// database is unreachable, so you can never be locked out. When the DB is
// available the login is materialized as a real executive user + DB session.
async function ensureBreakGlassExecutiveUser() {
  const normalized = normalizeEmail(EXECUTIVE_USERNAME) || String(EXECUTIVE_USERNAME).trim().toLowerCase();
  let userRow = await findUserByEmail(normalized);

  if (!userRow) {
    userRow = await createUser({
      email: normalized,
      displayName: "Andrew Walsh",
      status: "active",
      isExecutive: true
    });
    userRow = await markUserVerifiedAndActive(userRow.id);
  } else if (!userRow.is_executive || userRow.status !== "active" || !userRow.email_verified_at) {
    await setUserExecutive(userRow.id, true, userRow.id);
    userRow = await markUserVerifiedAndActive(userRow.id);
  }

  return userRow;
}

function isBreakGlassCredentials(identifier, password) {
  return Boolean(
    EXECUTIVE_USERNAME &&
    EXECUTIVE_PASSWORD &&
    normalizeUsernameValue(identifier) === normalizeUsernameValue(EXECUTIVE_USERNAME) &&
    timingSafeStringEqual(password, EXECUTIVE_PASSWORD)
  );
}

app.post("/api/login", rateLimit("login", 10, 15 * 60 * 1000), async (req, res) => {
  const { username = "", email = "", password = "" } = req.body || {};
  const identifier = String(email || username || "").trim();

  if (!identifier || !password) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  // 1. Legacy shared leader login — only while the feature flag is on.
  if (
    LEGACY_SHARED_LOGIN_ENABLED &&
    normalizeUsernameValue(identifier) === normalizeUsernameValue(LEADER_USERNAME) &&
    LEADER_PASSWORD &&
    timingSafeStringEqual(password, LEADER_PASSWORD)
  ) {
    const user = buildSessionUser({
      username: LEADER_USERNAME,
      displayName: "Wilson",
      role: "leader",
      accessGroup: "leader"
    });
    setAuthCookie(req, res, user);

    return res.json({
      success: true,
      user: { ...user, isExecutive: false, kind: "legacy" }
    });
  }

  // 2. Env break-glass executive — always available.
  if (isBreakGlassCredentials(identifier, password)) {
    if (isUserStoreConfigured()) {
      try {
        const userRow = await ensureBreakGlassExecutiveUser();
        const token = await createSession(userRow.id, {
          ip: req.ip,
          userAgent: req.get("user-agent"),
          ttlSeconds: SESSION_TTL_SECONDS
        });
        setDbSessionCookie(req, res, token);
        recordAudit({
      ip: req.ip,
          actorUserId: userRow.id,
          action: "login",
          targetUserId: userRow.id,
          detail: { method: "break_glass", ip: req.ip }
        }).catch(() => {});

        return res.json({ success: true, user: buildDbUserResponse(userRow, []) });
      } catch (err) {
        console.error("Break-glass DB login failed; using signed-cookie fallback:", err.message);
      }
    }

    // DB unreachable: signed-cookie fallback (honored regardless of the
    // legacy flag so the break-glass can never be locked out).
    const user = buildSessionUser({
      username: EXECUTIVE_USERNAME,
      displayName: "Andrew Walsh",
      role: "executive",
      accessGroup: "executive"
    });
    setAuthCookie(req, res, user);
    return res.json({ success: true, user: { ...user, isExecutive: true, kind: "legacy" } });
  }

  // 3. Database-backed individual accounts.
  if (!isUserStoreConfigured()) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  try {
    const userRow = await findUserByEmail(identifier);
    const passwordHash = userRow?.password_hash || (await DUMMY_PASSWORD_HASH_PROMISE);
    const passwordOk = await verifyPassword(password, passwordHash);

    if (
      !userRow ||
      !passwordOk ||
      userRow.status !== "active" ||
      !userRow.email_verified_at
    ) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const token = await createSession(userRow.id, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
      ttlSeconds: SESSION_TTL_SECONDS
    });
    setDbSessionCookie(req, res, token);
    recordAudit({
      ip: req.ip,
      actorUserId: userRow.id,
      action: "login",
      targetUserId: userRow.id,
      detail: { method: "password", ip: req.ip }
    }).catch(() => {});

    const grantedPages = userRow.is_executive ? [] : await getGrantedPagesForUser(userRow.id);
    return res.json({ success: true, user: buildDbUserResponse(userRow, grantedPages) });
  } catch (err) {
    console.error("Login failed:", err.message);
    return res.status(500).json({ error: "Unable to sign in right now. Please try again." });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const rawValue = cookies[AUTH_COOKIE_NAME];

    if (rawValue && !rawValue.includes(".") && isUserStoreConfigured()) {
      await deleteSessionByToken(rawValue);
    }
  } catch (err) {
    console.error("Logout session cleanup failed:", err.message);
  }

  clearAuthCookie(req, res);
  return res.json({ success: true });
});

app.get("/api/auth/session", (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  return res.json({
    user: req.authUser,
    grantedPages: getEffectivePagesForUser(req.authUser),
    canManageUsers: isExecutiveUser(req.authUser),
    legacyLoginEnabled: LEGACY_SHARED_LOGIN_ENABLED,
    availableAccessGroups: ACCESS_GROUPS,
    pageLabels: PAGE_LABELS,
    pageCategories: buildCategoriesPayload(),
    // Personal dashboard hero-card slots (db accounts only; legacy sessions
    // have nowhere to store preferences and get the defaults).
    dashboardSlots: req.authUser.kind === "db"
      ? (req.authUser.preferences?.dashboardSlots || null)
      : null,
    // Preferred default filters for the payments dashboard:
    // { employee: "self" | "all" | "<CODE>", department: "all" | "<name>" }
    dashboardView: req.authUser.kind === "db"
      ? (req.authUser.preferences?.dashboardView || null)
      : null,
    canCustomizeDashboard: req.authUser.kind === "db"
  });
});

// Save the signed-in user's preferred default dashboard view (employee +
// department filters). "self" tracks whoever they are in the employee
// directory, so it survives code re-keying (e.g. the NetSuite move).
app.post("/api/me/dashboard-view", async (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (req.authUser.kind !== "db") {
    return res.status(400).json({
      error: "Sign in with your individual account to save a default view."
    });
  }

  const employee = String(req.body?.employee || "self").trim();
  const department = String(req.body?.department || "all").trim();

  if (!/^(self|all|[A-Za-z0-9]{1,3})$/.test(employee)) {
    return res.status(400).json({ error: "Invalid employee selection." });
  }
  if (department.length > 40) {
    return res.status(400).json({ error: "Invalid department selection." });
  }

  try {
    const preferences = await setUserPreferences(req.authUser.id, {
      dashboardView: { employee, department }
    });
    return res.json({ success: true, dashboardView: preferences.dashboardView || null });
  } catch (err) {
    console.error("Save dashboard view failed:", err.message);
    return res.status(500).json({ error: "Unable to save your default view." });
  }
});

// Save the signed-in user's dashboard hero-card slots. Personal setting —
// each slot must be a manageable page the user can actually access, so the
// cards can never become a side door around page permissions.
app.post("/api/me/dashboard-slots", async (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (req.authUser.kind !== "db") {
    return res.status(400).json({
      error: "Sign in with your individual account to customize your dashboard cards."
    });
  }

  const raw = Array.isArray(req.body?.slots) ? req.body.slots : null;
  if (!raw) {
    return res.status(400).json({ error: "Send { slots: [pagePath, ...] }." });
  }

  const slots = [];
  for (const value of raw.slice(0, 4)) {
    const pagePath = String(value || "").trim();
    if (!pagePath) continue;
    if (slots.includes(pagePath)) continue;
    if (pagePath === "/dashboard.html") continue;
    // Any internal page is pinnable — including executive-only pages —
    // as long as this user can actually access it (canAccessPathForUser
    // enforces is_executive for the exec-only ones).
    if (!INTERNAL_PAGE_PATHS.has(pagePath) || AUTH_PAGE_PATHS.has(pagePath)) {
      return res.status(400).json({ error: `Unknown page: ${pagePath}` });
    }
    if (!canAccessPathForUser(req.authUser, pagePath)) {
      return res.status(403).json({ error: `You don't have access to ${pagePath}.` });
    }
    slots.push(pagePath);
  }

  try {
    const preferences = await setUserPreferences(req.authUser.id, { dashboardSlots: slots });
    return res.json({ success: true, dashboardSlots: preferences.dashboardSlots || [] });
  } catch (err) {
    console.error("Save dashboard slots failed:", err.message);
    return res.status(500).json({ error: "Unable to save your dashboard cards." });
  }
});

app.post("/api/auth/register", rateLimit("register", 5, 15 * 60 * 1000), async (req, res) => {
  // Always the same response whether or not the email exists — no enumeration.
  const genericResponse = {
    success: true,
    message: "If that address is eligible, we've sent a verification email. Check your inbox."
  };

  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "Registration is not available right now." });
    }

    const { email = "", password = "", displayName = "" } = req.body || {};
    const normalized = normalizeEmail(email);

    if (!normalized || !isEmailInAllowedDomain(normalized)) {
      return res.status(400).json({
        error: `Registration is limited to @${getAllowedSignupDomain()} email addresses.`
      });
    }

    const policyError = validatePasswordPolicy(password, normalized);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    const existing = await findUserByEmail(normalized);

    // The employee directory is the source of truth for names: when the
    // registering email is in the directory, its (properly cased) name wins
    // over whatever the person typed.
    let resolvedDisplayName = String(displayName || "").trim();
    try {
      const directoryEntry = await findEmployeeDirectoryEntryByEmail(normalized);
      if (directoryEntry?.name) {
        resolvedDisplayName = directoryEntry.name;
      }
    } catch {
      // Directory unavailable — keep the typed name.
    }

    if (!existing) {
      const passwordHash = await hashPassword(password);
      const userRow = await createUser({
        email: normalized,
        passwordHash,
        displayName: resolvedDisplayName,
        status: "pending_verification"
      });
      const rawToken = await createAuthToken(userRow.id, "verify");
      await sendVerificationEmail(req, normalized, rawToken);
      recordAudit({
      ip: req.ip,
        actorUserId: userRow.id,
        action: "register",
        targetUserId: userRow.id,
        detail: { ip: req.ip }
      }).catch(() => {});
    } else if (existing.status === "pending_verification" || existing.status === "invited") {
      // Not yet verified: whoever controls the mailbox wins. Update the
      // password and send a fresh single-use verification link.
      const passwordHash = await hashPassword(password);
      await updateUserPassword(existing.id, passwordHash);
      if (resolvedDisplayName) {
        await updateUserProfile(existing.id, { displayName: resolvedDisplayName });
      }
      const rawToken = await createAuthToken(existing.id, "verify");
      await sendVerificationEmail(req, normalized, rawToken);
    }
    // Active or disabled accounts: do nothing, respond identically.

    return res.json(genericResponse);
  } catch (err) {
    console.error("Registration failed:", err.message);
    return res.status(500).json({ error: "Unable to register right now. Please try again." });
  }
});

app.post("/api/auth/verify-email", rateLimit("verify", 10, 15 * 60 * 1000), async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "Verification is not available right now." });
    }

    const { token = "" } = req.body || {};
    const userRow = await consumeAuthToken("verify", token);

    if (!userRow || userRow.status === "disabled") {
      return res.status(400).json({
        error: "This verification link is invalid or has expired. Register again to receive a new one."
      });
    }

    await markUserVerifiedAndActive(userRow.id);
    recordAudit({
      ip: req.ip,
      actorUserId: userRow.id,
      action: "email_verified",
      targetUserId: userRow.id,
      detail: {}
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Email verified. You can now sign in. An executive still needs to grant you access to tools."
    });
  } catch (err) {
    console.error("Email verification failed:", err.message);
    return res.status(500).json({ error: "Unable to verify right now. Please try again." });
  }
});

app.post("/api/auth/accept-invite", rateLimit("accept-invite", 10, 15 * 60 * 1000), async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "Invitations are not available right now." });
    }

    const { token = "", password = "", displayName = "" } = req.body || {};
    const pending = await peekAuthToken("invite", token);

    if (!pending) {
      return res.status(400).json({
        error: "This invitation link is invalid or has expired. Ask an executive to resend it."
      });
    }

    const policyError = validatePasswordPolicy(password, pending.email);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    const userRow = await consumeAuthToken("invite", token);
    if (!userRow || userRow.status === "disabled") {
      return res.status(400).json({
        error: "This invitation link is invalid or has expired. Ask an executive to resend it."
      });
    }

    await updateUserPassword(userRow.id, await hashPassword(password));
    if (String(displayName || "").trim()) {
      await updateUserProfile(userRow.id, { displayName });
    }
    await markUserVerifiedAndActive(userRow.id);
    recordAudit({
      ip: req.ip,
      actorUserId: userRow.id,
      action: "invite_accepted",
      targetUserId: userRow.id,
      detail: {}
    }).catch(() => {});

    return res.json({ success: true, message: "Your account is ready. You can now sign in." });
  } catch (err) {
    console.error("Accept-invite failed:", err.message);
    return res.status(500).json({ error: "Unable to finish setup right now. Please try again." });
  }
});

app.post("/api/auth/request-reset", rateLimit("request-reset", 5, 15 * 60 * 1000), async (req, res) => {
  // Always the same response — no enumeration.
  const genericResponse = {
    success: true,
    message: "If that address has an account, we've sent a password reset email."
  };

  try {
    if (!isUserStoreConfigured()) {
      return res.json(genericResponse);
    }

    const { email = "" } = req.body || {};
    const userRow = await findUserByEmail(email);

    if (userRow && userRow.status === "active" && userRow.email_verified_at) {
      const rawToken = await createAuthToken(userRow.id, "reset");
      await sendPasswordResetEmail(req, userRow.email, rawToken);
      recordAudit({
      ip: req.ip,
        actorUserId: userRow.id,
        action: "reset_requested",
        targetUserId: userRow.id,
        detail: { ip: req.ip }
      }).catch(() => {});
    }

    return res.json(genericResponse);
  } catch (err) {
    console.error("Password reset request failed:", err.message);
    return res.json(genericResponse);
  }
});

app.post("/api/auth/reset", rateLimit("reset", 10, 15 * 60 * 1000), async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "Password reset is not available right now." });
    }

    const { token = "", password = "" } = req.body || {};
    const pending = await peekAuthToken("reset", token);

    if (!pending) {
      return res.status(400).json({
        error: "This reset link is invalid or has expired. Request a new one from the login page."
      });
    }

    const policyError = validatePasswordPolicy(password, pending.email);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }

    const userRow = await consumeAuthToken("reset", token);
    if (!userRow || userRow.status === "disabled") {
      return res.status(400).json({
        error: "This reset link is invalid or has expired. Request a new one from the login page."
      });
    }

    // Updates the hash and revokes every existing session for the user.
    await updateUserPassword(userRow.id, await hashPassword(password));
    recordAudit({
      ip: req.ip,
      actorUserId: userRow.id,
      action: "password_reset",
      targetUserId: userRow.id,
      detail: {}
    }).catch(() => {});

    return res.json({ success: true, message: "Password updated. You can now sign in." });
  } catch (err) {
    console.error("Password reset failed:", err.message);
    return res.status(500).json({ error: "Unable to reset right now. Please try again." });
  }
});

// Lets set-password.html validate a link before the user types a password.
app.get("/api/auth/token-status", rateLimit("token-status", 30, 15 * 60 * 1000), async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.json({ valid: false });
    }

    const kind = String(req.query.kind || "");
    const token = String(req.query.token || "");

    if (!["invite", "reset"].includes(kind)) {
      return res.json({ valid: false });
    }

    const pending = await peekAuthToken(kind, token);
    return res.json({
      valid: Boolean(pending && pending.status !== "disabled"),
      email: pending?.email || ""
    });
  } catch {
    return res.json({ valid: false });
  }
});

// ---------------------------------------------------------------------------
// Executive user-management API
// ---------------------------------------------------------------------------

function buildManageablePagesPayload() {
  return MANAGEABLE_PAGE_PATHS.map((path) => ({
    path,
    label: PAGE_LABELS[path] || path
  }));
}

function buildCategoriesPayload() {
  const categorized = new Set();
  const categories = PAGE_CATEGORIES.map((category) => {
    const pages = category.pages.filter((p) => MANAGEABLE_PAGE_PATHS.includes(p));
    pages.forEach((p) => categorized.add(p));
    return { key: category.key, label: category.label, pages };
  }).filter((category) => category.pages.length);

  const uncategorized = MANAGEABLE_PAGE_PATHS.filter((p) => !categorized.has(p));
  if (uncategorized.length) {
    categories.push({ key: "other", label: "Other", pages: uncategorized });
  }

  return categories;
}

function buildPresetsPayload() {
  const presets = {};

  for (const [key, preset] of Object.entries(JOB_CODE_PRESETS)) {
    const pages = expandJobCodePresetPages(key);
    if (pages.length) {
      presets[key] = { label: preset.label, pages };
    }
  }

  return presets;
}

app.get("/api/admin/users", requireExecutiveApi, async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "User management requires DATABASE_URL." });
    }

    const users = await listUsersWithAccess();
    return res.json({
      users,
      manageablePages: buildManageablePagesPayload(),
      categories: buildCategoriesPayload(),
      presets: buildPresetsPayload(),
      allowedDomain: getAllowedSignupDomain(),
      legacyLoginEnabled: LEGACY_SHARED_LOGIN_ENABLED
    });
  } catch (err) {
    console.error("List users failed:", err.message);
    return res.status(500).json({ error: "Unable to load users." });
  }
});

app.post("/api/admin/users/invite", requireExecutiveApi, async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "User management requires DATABASE_URL." });
    }

    const { email = "", displayName = "", isExecutive = false } = req.body || {};
    const normalized = normalizeEmail(email);

    if (!normalized || !isEmailInAllowedDomain(normalized)) {
      return res.status(400).json({
        error: `Invitations are limited to @${getAllowedSignupDomain()} email addresses.`
      });
    }

    let userRow = await findUserByEmail(normalized);

    if (userRow && userRow.status === "active") {
      return res.status(409).json({ error: "That user already has an active account." });
    }

    if (userRow && userRow.status === "disabled") {
      return res.status(409).json({ error: "That user is disabled. Re-enable them instead of inviting." });
    }

    if (!userRow) {
      userRow = await createUser({
        email: normalized,
        displayName,
        status: "invited",
        isExecutive: Boolean(isExecutive),
        createdBy: req.authUser.id || null
      });
    }

    const rawToken = await createAuthToken(userRow.id, "invite");
    await sendInviteEmail(req, normalized, rawToken);
    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "user_invited",
      targetUserId: userRow.id,
      detail: { email: normalized, isExecutive: Boolean(isExecutive) }
    }).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    console.error("Invite failed:", err.message);
    return res.status(500).json({ error: "Unable to send the invitation." });
  }
});

app.post("/api/admin/users/:userId/resend-invite", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);

    if (!userRow || !["invited", "pending_verification"].includes(userRow.status)) {
      return res.status(400).json({ error: "Only pending accounts can be re-invited." });
    }

    const kind = userRow.status === "invited" ? "invite" : "verify";
    const rawToken = await createAuthToken(userRow.id, kind);

    if (kind === "invite") {
      await sendInviteEmail(req, userRow.email, rawToken);
    } else {
      await sendVerificationEmail(req, userRow.email, rawToken);
    }

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "invite_resent",
      targetUserId: userRow.id,
      detail: { kind }
    }).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    console.error("Resend invite failed:", err.message);
    return res.status(500).json({ error: "Unable to resend the invitation." });
  }
});

app.post("/api/admin/users/:userId/permissions", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);
    if (!userRow) {
      return res.status(404).json({ error: "User not found." });
    }

    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    const invalid = changes.find((c) => !MANAGEABLE_PAGE_PATHS.includes(String(c?.pagePath)));

    if (!changes.length || invalid) {
      return res.status(400).json({ error: "Invalid page permission changes." });
    }

    const grantedPages = await setUserPagePermissions(
      userRow.id,
      changes.map((c) => ({ pagePath: String(c.pagePath), granted: Boolean(c.granted) })),
      req.authUser.id || null,
      req.ip
    );

    return res.json({ success: true, grantedPages });
  } catch (err) {
    console.error("Permission update failed:", err.message);
    return res.status(500).json({ error: "Unable to update permissions." });
  }
});

app.post("/api/admin/users/:userId/preset", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);
    if (!userRow) {
      return res.status(404).json({ error: "User not found." });
    }

    const presetKey = String(req.body?.preset || "");
    const presetPages = expandJobCodePresetPages(presetKey);

    if (!presetPages.length) {
      return res.status(400).json({ error: "Unknown preset." });
    }

    // Presets expand into individual per-user rows (replace semantics).
    const changes = MANAGEABLE_PAGE_PATHS.map((pagePath) => ({
      pagePath,
      granted: presetPages.includes(pagePath)
    }));

    const grantedPages = await setUserPagePermissions(userRow.id, changes, req.authUser.id || null, req.ip);
    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "preset_applied",
      targetUserId: userRow.id,
      detail: { preset: presetKey }
    }).catch(() => {});

    return res.json({ success: true, grantedPages });
  } catch (err) {
    console.error("Preset apply failed:", err.message);
    return res.status(500).json({ error: "Unable to apply the preset." });
  }
});

app.post("/api/admin/users/:userId/status", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);
    if (!userRow) {
      return res.status(404).json({ error: "User not found." });
    }

    const status = String(req.body?.status || "");

    if (!["active", "disabled"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'disabled'." });
    }

    if (req.authUser.id && req.authUser.id === userRow.id && status === "disabled") {
      return res.status(400).json({ error: "You cannot disable your own account." });
    }

    // Disabling deletes the user's sessions inside the same transaction, so
    // their access is revoked on the next request.
    await setUserStatus(userRow.id, status, req.authUser.id || null, req.ip);
    return res.json({ success: true });
  } catch (err) {
    console.error("Status change failed:", err.message);
    return res.status(500).json({ error: "Unable to update the user." });
  }
});

app.post("/api/admin/users/:userId/executive", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);
    if (!userRow) {
      return res.status(404).json({ error: "User not found." });
    }

    const isExecutive = Boolean(req.body?.isExecutive);

    if (req.authUser.id && req.authUser.id === userRow.id && !isExecutive) {
      return res.status(400).json({ error: "You cannot remove your own executive access." });
    }

    await setUserExecutive(userRow.id, isExecutive, req.authUser.id || null, req.ip);

    if (!isExecutive) {
      // Dropping executive re-scopes them to page grants; end open sessions.
      await deleteSessionsForUser(userRow.id);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Executive flag change failed:", err.message);
    return res.status(500).json({ error: "Unable to update the user." });
  }
});

app.post("/api/admin/users/:userId/force-reset", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);

    if (!userRow || userRow.status !== "active") {
      return res.status(400).json({ error: "Only active users can receive a reset email." });
    }

    // lockout: for shared/compromised passwords. Invalidates the current
    // password and ends every session IMMEDIATELY (single transaction);
    // the user gets back in only via the emailed reset link.
    const lockout = Boolean(req.body?.lockout);
    if (lockout) {
      await updateUserPassword(userRow.id, null);
    }

    const rawToken = await createAuthToken(userRow.id, "reset");
    await sendPasswordResetEmail(req, userRow.email, rawToken);
    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "reset_forced",
      targetUserId: userRow.id,
      detail: { lockout }
    }).catch(() => {});

    return res.json({ success: true, lockout });
  } catch (err) {
    console.error("Force reset failed:", err.message);
    return res.status(500).json({ error: "Unable to send the reset email." });
  }
});

app.get("/api/admin/audit-log", requireExecutiveApi, async (req, res) => {
  try {
    if (!isUserStoreConfigured()) {
      return res.status(503).json({ error: "User management requires DATABASE_URL." });
    }

    const startDate = String(req.query.start || "").trim();
    const endDate = String(req.query.end || "").trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
      return res.status(400).json({ error: "Provide start and end dates (YYYY-MM-DD)." });
    }
    if (endDate < startDate) {
      return res.status(400).json({ error: "The end date must be on or after the start date." });
    }

    const entries = await searchAuditLog({
      startDate,
      endDate,
      userId: String(req.query.userId || "").trim() || null,
      action: String(req.query.action || "").trim(),
      limit: Number(req.query.limit) || 2000
    });

    return res.json({ entries, capped: entries.length >= Math.min(Math.max(Number(req.query.limit) || 2000, 1), 10000) });
  } catch (err) {
    console.error("Audit log read failed:", err.message);
    return res.status(500).json({ error: "Unable to load the audit log." });
  }
});

// Distinct activity types, for the audit page's filter dropdown.
app.get("/api/admin/audit-actions", requireExecutiveApi, async (req, res) => {
  try {
    const actions = await listAuditActions();
    return res.json({ actions });
  } catch (err) {
    console.error("Audit actions read failed:", err.message);
    return res.status(500).json({ error: "Unable to load activity types." });
  }
});

// ---------------------------------------------------------------------------
// Steel Cod spec packages
// Steel Cod requires the email of the authenticated user acting on each
// request (no shared service accounts per their EULA), so these endpoints
// need an individual (database) login — the legacy shared login is rejected
// with a clear message.
// ---------------------------------------------------------------------------

function resolveSteelCodUserEmail(req, res) {
  if (!isSteelCodConfigured()) {
    res.status(503).json({
      error: "Steel Cod is not configured yet (missing STEELCOD_API_KEY)."
    });
    return null;
  }

  const email = req.authUser?.kind === "db" ? req.authUser.email : "";

  if (!email || !email.includes("@")) {
    res.status(400).json({
      error: "Steel Cod actions require signing in with your individual account (not the shared login), so Steel Cod knows who is acting."
    });
    return null;
  }

  return email;
}

function sendSteelCodError(res, err, fallbackMessage) {
  if (err instanceof SteelCodError) {
    const status =
      err.status === 400 ? 400 :
      err.status === 429 ? 429 :
      err.status === 503 ? 503 : 502;
    return res.status(status).json({
      error: err.message,
      errorCode: err.errorCode || undefined,
      errorDetails: err.errorDetails || undefined,
      logID: err.logID || undefined
    });
  }

  console.error("Steel Cod request failed:", err.message);
  return res.status(500).json({ error: fallbackMessage });
}

// Double/triple-click guard: at most one package creation per user per
// 10 seconds. In-process is fine (single process), mirroring the Zapier
// paid-text dedupe approach.
const SPEC_CREATE_COOLDOWN_MS = 10_000;
const lastSpecCreateByUser = new Map();

app.post("/api/spec-packages", requirePagePermission("/spec-packages.html"), async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const {
      documentID = "",
      title = "",
      subtitle = "",
      documentTypeLabel = "",
      salespersonEmail = "",
      emailCopyToSelf = false,
      customerName = "",
      customerPhone = "",
      customerEmail = "",
      customerNotes = "",
      modelNumbers = []
    } = req.body || {};

    const models = (Array.isArray(modelNumbers) ? modelNumbers : String(modelNumbers).split(/[\n,]/))
      .map((m) => String(m).trim())
      .filter(Boolean);

    if (!models.length) {
      return res.status(400).json({ error: "Enter at least one model number." });
    }

    if (!String(customerName).trim()) {
      return res.status(400).json({ error: "Customer name is required." });
    }

    // Cooldown check happens after validation so a typo fix isn't penalized,
    // and the timestamp is set before the Steel Cod call so a concurrent
    // double-submit is blocked even while the first request is in flight.
    const lastCreate = lastSpecCreateByUser.get(userEmail) || 0;
    if (Date.now() - lastCreate < SPEC_CREATE_COOLDOWN_MS) {
      return res.status(429).json({
        error: "Hold on — a spec package was just submitted from your account. Give it 10 seconds, then check the search list below before trying again."
      });
    }
    lastSpecCreateByUser.set(userEmail, Date.now());

    const result = await createSpecPackage({
      userEmail,
      salespersonEmail: salespersonEmail || userEmail,
      documentID,
      title,
      subtitle,
      documentTypeLabel: documentTypeLabel || "Sales Order",
      emailTo: emailCopyToSelf ? [userEmail] : [],
      customer: {
        name: String(customerName).trim(),
        phone: String(customerPhone || "").trim(),
        email: String(customerEmail || "").trim(),
        notes: String(customerNotes || "").trim()
      },
      modelNumbers: models
    });

    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to create the spec package.");
  }
});

app.get("/api/spec-packages", requirePagePermission("/spec-packages.html"), async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const result = await searchSpecPackages({
      userEmail,
      skip: Number(req.query.skip) || 0,
      title: String(req.query.title || ""),
      documentID: String(req.query.documentID || ""),
      pii: String(req.query.pii || ""),
      createdByUserEmail: String(req.query.createdByUserEmail || ""),
      salespersonUserEmail: String(req.query.salespersonUserEmail || "")
    });

    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to search spec packages.");
  }
});

app.get("/api/spec-packages/:navId", requirePagePermission("/spec-packages.html"), async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const result = await retrieveSpecPackage({ userEmail, navId: req.params.navId });
    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to load the spec package.");
  }
});

// Steel Cod's docs are ambiguous about where the retrieve response carries
// the package URL, and the first live test proved our field-name guesses
// wrong. Instead of guessing, scan the payload for any http(s) URL —
// preferring one that references the navId, then anything on a Steel Cod
// host — and strip a known page suffix to recover the base public URL.
const SPEC_URL_SUFFIXES = ["/Open", "/Download", "/SlimOpen", "/SlimDownload", "/Json", "/Ask", "/Edit", "/PremEdit"];

function findSpecPackageUrl(payload, navId) {
  const found = [];

  (function walk(value, depth) {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) found.push(trimmed);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach((item) => walk(item, depth + 1));
    }
  })(payload, 0);

  if (!found.length) return "";

  const preferred =
    (navId && found.find((u) => u.includes(navId))) ||
    found.find((u) => /steelcod/i.test(u)) ||
    found[0];

  let base = preferred.replace(/\/+$/, "");
  for (const suffix of SPEC_URL_SUFFIXES) {
    if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  return base;
}

// Shape summary for diagnostics (keys only, never values — no PII in logs).
function describeShape(value, depth = 0) {
  if (depth > 3 || value == null) return typeof value;
  if (Array.isArray(value)) {
    return [value.length ? describeShape(value[0], depth + 1) : "empty"];
  }
  if (typeof value === "object") {
    const shape = {};
    for (const key of Object.keys(value).slice(0, 20)) {
      shape[key] = describeShape(value[key], depth + 1);
    }
    return shape;
  }
  return typeof value;
}

// Append the compiled spec pages (slim or full) to the end of an uploaded
// sales order / quote PDF and return the merged document. User-initiated
// from the Spec Packages page; nothing is stored server-side. The package
// is looked up via Steel Cod as the acting user — the client never supplies
// a download URL, so this cannot be used to fetch arbitrary content.
app.post(
  "/api/spec-packages/:navId/attach-quote",
  requirePagePermission("/spec-packages.html"),
  express.raw({ type: ["application/pdf", "application/octet-stream"], limit: "30mb" }),
  async (req, res) => {
    const userEmail = resolveSteelCodUserEmail(req, res);
    if (!userEmail) return;

    const quoteBytes = req.body;
    if (!Buffer.isBuffer(quoteBytes) || quoteBytes.length < 5) {
      return res.status(400).json({ error: "Upload the sales order / quote PDF as the request body." });
    }
    if (quoteBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return res.status(400).json({ error: "The uploaded file does not look like a PDF." });
    }

    const variant = String(req.query.variant || "slim").toLowerCase() === "full" ? "full" : "slim";

    try {
      const pkg = await retrieveSpecPackage({ userEmail, navId: req.params.navId });
      const publicUrl = findSpecPackageUrl(pkg, req.params.navId);

      if (!publicUrl) {
        console.error(
          "Steel Cod retrieve returned no recognizable URL for navId",
          req.params.navId,
          "— response shape:",
          JSON.stringify(describeShape(pkg))
        );
        return res.status(502).json({ error: "Steel Cod did not return a URL for that spec package." });
      }

      const urls = buildSpecPackageUrls(publicUrl);
      if (!urls) {
        return res.status(502).json({ error: "Steel Cod did not return a URL for that spec package." });
      }

      const specUrl = variant === "full" ? urls.download : urls.slimDownload;
      let specResponse;
      try {
        specResponse = await fetch(specUrl);
      } catch (err) {
        return res.status(502).json({ error: `Unable to reach Steel Cod to download the spec PDF: ${err.message}` });
      }
      if (!specResponse.ok) {
        return res.status(502).json({ error: `Unable to download the spec PDF from Steel Cod (HTTP ${specResponse.status}).` });
      }

      const specBytes = Buffer.from(await specResponse.arrayBuffer());
      if (specBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return res.status(502).json({ error: "Steel Cod returned something that is not a PDF for this package." });
      }

      let quoteDoc;
      try {
        quoteDoc = await PDFDocument.load(quoteBytes);
      } catch {
        return res.status(400).json({ error: "Could not read the uploaded PDF. Is it password-protected or corrupted?" });
      }

      let specDoc;
      try {
        specDoc = await PDFDocument.load(specBytes);
      } catch {
        return res.status(502).json({ error: "Could not read the spec PDF returned by Steel Cod." });
      }

      const specPages = await quoteDoc.copyPages(specDoc, specDoc.getPageIndices());
      for (const page of specPages) quoteDoc.addPage(page);

      const mergedBytes = await quoteDoc.save();

      const safeName =
        String(req.query.name || "quote")
          .replace(/[^A-Za-z0-9 ._-]+/g, "")
          .trim()
          .slice(0, 80) || "quote";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-with-specs.pdf"`);
      return res.send(Buffer.from(mergedBytes));
    } catch (err) {
      return sendSteelCodError(res, err, "Unable to attach the spec pages to the quote.");
    }
  }
);

// Deleting purges the package (and its PII) permanently — executive only.
app.delete("/api/spec-packages/:navId", requireExecutiveApi, async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const result = await deleteSpecPackage({ userEmail, navId: req.params.navId });
    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "spec_package_deleted",
      targetUserId: null,
      detail: { navId: req.params.navId, logID: result.logID || "" }
    }).catch(() => {});
    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to delete the spec package.");
  }
});

// Registered Steel Cod users at Wilson (to verify staff accounts line up).
app.get("/api/steelcod-users", requireExecutiveApi, async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const result = await retrieveSteelCodUsers({ userEmail });
    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to load Steel Cod users.");
  }
});


// ---------------------------------------------------------------------------
// Mileage reimbursement
// Employees log their own months on /mileage.html; reviewers (page grant on
// /mileage-review.html — executives implicitly) approve/deny and may edit.
// All math is computed server-side from stored entries; approval snapshots
// the year's rate onto the report.
// ---------------------------------------------------------------------------

function resolveMileageUser(req, res) {
  if (req.authUser?.kind !== "db") {
    res.status(400).json({
      error: "Mileage requires signing in with your individual account (not the shared login)."
    });
    return null;
  }
  return req.authUser;
}

function isMileageReviewer(user) {
  return canAccessPathForUser(user, "/mileage-review.html");
}

async function attachMileageTotals(report) {
  if (report.rateUsed == null) {
    report.currentRate = await getMileageRateForYear(report.year);
  }
  report.totals = computeReportTotals(report);
  return report;
}

function validateMileageEntries(entries, year, month) {
  if (!Array.isArray(entries)) return "Send entries as an array.";
  if (entries.length > 62) return "Too many entries for one month.";

  const prefix = `${year}-${String(month).padStart(2, "0")}-`;

  for (const entry of entries) {
    const date = String(entry.entryDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(prefix)) {
      return `Each entry needs a date inside ${prefix.slice(0, -1)}.`;
    }
    const miles = Number(entry.miles);
    if (!Number.isFinite(miles) || miles < 0 || miles > 2000) {
      return "Miles must be between 0 and 2000.";
    }
  }
  return null;
}

// Current + historical rates (any signed-in user; the page shows the rate).
app.get("/api/mileage/rates", async (req, res) => {
  try {
    const rates = await listMileageRates();
    return res.json({ rates });
  } catch (err) {
    console.error("Mileage rates read failed:", err.message);
    return res.status(500).json({ error: "Unable to load mileage rates." });
  }
});

// Executive: add/update a year's rate.
app.post("/api/admin/mileage-rates", requireExecutiveApi, async (req, res) => {
  try {
    const year = Number(req.body?.year);
    const rate = Number(req.body?.rate);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ error: "Enter a valid year." });
    }
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 10) {
      return res.status(400).json({ error: "Enter a valid per-mile rate (e.g. 0.725)." });
    }
    const saved = await upsertMileageRate(year, rate, req.authUser.id || null);
    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "mileage_rate_saved",
      targetUserId: null,
      detail: saved
    }).catch(() => {});
    return res.json({ success: true, rate: saved });
  } catch (err) {
    console.error("Mileage rate save failed:", err.message);
    return res.status(500).json({ error: "Unable to save the rate." });
  }
});

// Employee: list own reports (for the month picker's status hints).
app.get("/api/mileage/my-reports", requirePagePermission("/mileage.html"), async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const year = Number(req.query.year) || null;
    const reports = await listMileageReportsForUser(user.id, year);
    return res.json({ reports });
  } catch (err) {
    console.error("Mileage list failed:", err.message);
    return res.status(500).json({ error: "Unable to load your mileage reports." });
  }
});

// Employee: open (or start) a month. Commute defaults from the directory.
app.post("/api/mileage/report", requirePagePermission("/mileage.html"), async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const year = Number(req.body?.year);
    const month = Number(req.body?.month);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Choose a valid year and month." });
    }

    let commute = 0;
    try {
      const directoryEntry = await findEmployeeDirectoryEntryByEmail(user.email);
      commute = directoryEntry?.commuteMiles || 0;
    } catch {}

    const report = await getOrCreateMileageReport(user.id, year, month, commute);
    await attachMileageTotals(report);
    return res.json({ report });
  } catch (err) {
    console.error("Mileage open failed:", err.message);
    return res.status(500).json({ error: "Unable to open that month." });
  }
});

// Save entries. Owners may save while draft/denied; reviewers while submitted
// (approver edits). Reviewers may also adjust the commute snapshot.
app.post("/api/mileage/report/:id/entries", async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const report = await getMileageReportById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found." });

    const isOwner = report.userId === user.id;
    const reviewer = isMileageReviewer(user);

    const ownerCanEdit = isOwner && ["draft", "denied"].includes(report.status) && canAccessPathForUser(user, "/mileage.html");
    const reviewerCanEdit = reviewer && report.status === "submitted";

    if (!ownerCanEdit && !reviewerCanEdit) {
      return res.status(403).json({ error: "This report can't be edited in its current status." });
    }

    const entries = req.body?.entries;
    const invalid = validateMileageEntries(entries, report.year, report.month);
    if (invalid) return res.status(400).json({ error: invalid });

    const commuteMiles =
      reviewerCanEdit && req.body?.commuteMiles != null
        ? Math.max(Number(req.body.commuteMiles) || 0, 0)
        : null;

    const saved = await saveMileageEntries(report.id, entries, { commuteMiles });
    await attachMileageTotals(saved);
    return res.json({ report: saved });
  } catch (err) {
    console.error("Mileage save failed:", err.message);
    return res.status(500).json({ error: "Unable to save entries." });
  }
});

// Employee: submit (locks the month for review).
app.post("/api/mileage/report/:id/submit", requirePagePermission("/mileage.html"), async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const report = await getMileageReportById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found." });
    if (report.userId !== user.id) return res.status(403).json({ error: "Not your report." });
    if (!["draft", "denied"].includes(report.status)) {
      return res.status(400).json({ error: "Only draft or denied reports can be submitted." });
    }
    if (!report.entries.length) {
      return res.status(400).json({ error: "Add at least one entry before submitting." });
    }

    const updated = await setMileageReportStatus(report.id, { status: "submitted" });
    await attachMileageTotals(updated);
    recordAudit({
      ip: req.ip,
      actorUserId: user.id,
      action: "mileage_submitted",
      targetUserId: user.id,
      detail: { year: report.year, month: report.month, reportId: report.id }
    }).catch(() => {});
    return res.json({ report: updated });
  } catch (err) {
    console.error("Mileage submit failed:", err.message);
    return res.status(500).json({ error: "Unable to submit the report." });
  }
});

// Reviewer: list reports for review.
app.get("/api/mileage/review", requirePagePermission("/mileage-review.html"), async (req, res) => {
  try {
    const reports = await listMileageReportsForReview({
      status: String(req.query.status || "").trim(),
      year: Number(req.query.year) || null,
      month: Number(req.query.month) || null
    });
    for (const report of reports) {
      await attachMileageTotals(report);
    }
    return res.json({ reports });
  } catch (err) {
    console.error("Mileage review list failed:", err.message);
    return res.status(500).json({ error: "Unable to load reports." });
  }
});

// Reviewer: approve (snapshots the year's rate) or deny (with a note).
app.post("/api/mileage/report/:id/decide", requirePagePermission("/mileage-review.html"), async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const report = await getMileageReportById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found." });
    if (report.status !== "submitted") {
      return res.status(400).json({ error: "Only submitted reports can be approved or denied." });
    }
    if (report.userId === user.id) {
      return res.status(400).json({ error: "You can't approve or deny your own mileage — ask another reviewer." });
    }

    const decision = String(req.body?.decision || "").trim();

    if (decision === "approve") {
      const rate = await getMileageRateForYear(report.year);
      if (rate == null) {
        return res.status(400).json({ error: `No mileage rate is set for ${report.year} — add one first.` });
      }
      const updated = await setMileageReportStatus(report.id, { status: "approved", deciderId: user.id, rateUsed: rate });
      await attachMileageTotals(updated);
      recordAudit({
        ip: req.ip,
        actorUserId: user.id,
        action: "mileage_approved",
        targetUserId: report.userId,
        detail: { year: report.year, month: report.month, reportId: report.id, rate, reimbursementTotal: updated.totals?.reimbursementTotal }
      }).catch(() => {});
      return res.json({ report: updated });
    }

    if (decision === "deny") {
      const note = String(req.body?.note || "").trim().slice(0, 500);
      if (!note) return res.status(400).json({ error: "A short note is required when denying." });
      const updated = await setMileageReportStatus(report.id, { status: "denied", deciderId: user.id, denialNote: note });
      await attachMileageTotals(updated);
      recordAudit({
        ip: req.ip,
        actorUserId: user.id,
        action: "mileage_denied",
        targetUserId: report.userId,
        detail: { year: report.year, month: report.month, reportId: report.id, note }
      }).catch(() => {});
      return res.json({ report: updated });
    }

    return res.status(400).json({ error: "decision must be approve or deny." });
  } catch (err) {
    console.error("Mileage decide failed:", err.message);
    return res.status(500).json({ error: "Unable to record the decision." });
  }
});

// Serve the employee directory from Postgres (editable in User Admin).
// Registered BEFORE express.static so it shadows the legacy static file,
// which remains the fallback when the database is unreachable.
app.get("/employee-directory.js", async (req, res) => {
  try {
    const directory = await getEmployeeDirectoryObject();
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(
      "window.WILSON_EMPLOYEE_DIRECTORY = " + JSON.stringify(directory, null, 2) + ";\n"
    );
  } catch (err) {
    console.error("Employee directory DB read failed, serving static fallback:", err.message);
    return res.sendFile(path.join(__dirname, "employee-directory.js"));
  }
});

// --- Executive API: employee directory management -------------------------

app.get("/api/admin/employee-directory", requireExecutiveApi, async (req, res) => {
  try {
    const entries = await listEmployeeDirectory();
    return res.json({ entries });
  } catch (err) {
    console.error("List employee directory failed:", err.message);
    return res.status(500).json({ error: "Unable to load the employee directory." });
  }
});

app.post("/api/admin/employee-directory", requireExecutiveApi, async (req, res) => {
  try {
    const { code = "", name = "", email = "", department = "", commuteMiles = 0 } = req.body || {};

    const codeError = validateEmployeeCode(code);
    if (codeError) {
      return res.status(400).json({ error: codeError });
    }
    if (!String(name).trim()) {
      return res.status(400).json({ error: "A name is required." });
    }
    const trimmedEmail = String(email).trim().toLowerCase();
    if (trimmedEmail && !trimmedEmail.includes("@")) {
      return res.status(400).json({ error: "Enter a valid email (or leave it blank)." });
    }

    const commute = Number(commuteMiles);
    if (!Number.isFinite(commute) || commute < 0 || commute > 500) {
      return res.status(400).json({ error: "Commute miles must be between 0 and 500." });
    }

    const entry = await upsertEmployeeDirectoryEntry(
      { code, name, email: trimmedEmail, department, commuteMiles: commute },
      req.authUser.id || null
    );

    // Names are joined: saving a directory entry updates the matching
    // account's display name so the two can never drift apart.
    let syncedUserId = null;
    if (entry.email) {
      try {
        const account = await findUserByEmail(entry.email);
        if (account && String(account.display_name || "") !== entry.name) {
          await updateUserProfile(account.id, { displayName: entry.name });
          syncedUserId = account.id;
        }
      } catch (err) {
        console.error("Directory name sync failed:", err.message);
      }
    }

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "employee_directory_saved",
      targetUserId: syncedUserId,
      detail: { code: entry.code, name: entry.name, email: entry.email, department: entry.department, commuteMiles: entry.commuteMiles, nameSynced: Boolean(syncedUserId) }
    }).catch(() => {});

    return res.json({ success: true, entry });
  } catch (err) {
    console.error("Save employee directory entry failed:", err.message);
    return res.status(500).json({ error: "Unable to save the directory entry." });
  }
});

app.delete("/api/admin/employee-directory/:code", requireExecutiveApi, async (req, res) => {
  try {
    const code = normalizeEmployeeCode(req.params.code);
    const removed = await deleteEmployeeDirectoryEntry(code);

    if (!removed) {
      return res.status(404).json({ error: "That employee code was not found." });
    }

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser.id || null,
      action: "employee_directory_deleted",
      targetUserId: null,
      detail: { code }
    }).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    console.error("Delete employee directory entry failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the directory entry." });
  }
});

// The static server serves the repo root, so without a guard ANY
// authenticated user (including zero-permission accounts) could download the
// data ledgers (customer PII), the server source, SQL, and internal docs.
// Explicitly deny everything that is not a front-end asset.
const STATIC_DENY_DIRS = /^\/(data|sql|docs|lib|scripts|items|node_modules|_to_delete|tmp_[^/]+)\//i;
const STATIC_DENY_FILES = /\.(json|sql|md|xlsx|xlsm|csv|log|txt|env|lock)$/i;
const STATIC_DENY_EXACT = new Set(["/server.js", "/employee-directory.js"]); // employee-directory.js is served by its DB route above

app.use((req, res, next) => {
  const requestPath = decodeURIComponent(req.path);
  if (requestPath === "/robots.txt") return next();
  if (
    STATIC_DENY_DIRS.test(requestPath) ||
    STATIC_DENY_FILES.test(requestPath) ||
    STATIC_DENY_EXACT.has(requestPath)
  ) {
    return res.status(404).send("Not found.");
  }
  return next();
});

app.use(express.static(__dirname, { index: false }));

app.get("/", (req, res) => {
  const host = getRequestHost(req);
  const landingPage =
    host === SERVICE_PUBLIC_HOST
      ? "applianceservice.html"
      : "dashboard.html";
  res.sendFile(path.join(__dirname, landingPage));
});

app.get("/fireflavor", (req, res) => {
  res.sendFile(path.join(__dirname, "fireflavor.html"));
});

app.get("/commissions-print", (req, res) => {
  res.sendFile(path.join(__dirname, "commissions-print.html"));
});

app.get("/secret-menu", (req, res) => {
  res.sendFile(path.join(__dirname, "secret-menu.html"));
});

app.get("/api/secret-menu", requirePagePermission("/secret-menu.html"), async (req, res) => {
  try {
    // NOTE: page access is fully decided by requirePagePermission above.
    // (An older ACCESS_GROUPS check here used to 403 individual accounts,
    // whose accessGroup is "member" — do not reintroduce it.)
    const fs = await import("fs/promises");
    const secretMenuPath = path.join(__dirname, "data", "secret-menu.json");
    const raw = await fs.readFile(secretMenuPath, "utf8");
    const data = JSON.parse(raw);
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    if (err?.code === "ENOENT") {
      return res.status(500).json({ error: "Secret Menu data file is missing." });
    }
    return res.status(500).json({ error: err.message || "Unable to load secret menu." });
  }
});

app.get("/api/commissions/runs", requireExecutiveApi, async (req, res) => {
  try {
    const runs = await listCommissionRuns();
    return res.json({ runs });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to load commission runs."
    });
  }
});

app.post("/api/commissions/import", requireExecutiveApi, async (req, res) => {
  try {
    await ensureCommissionTables();

    const periodLabel = String(req.body?.periodLabel || "").trim();
    const sourceFileName = String(req.body?.sourceFileName || "").trim();
    const importedLines = Array.isArray(req.body?.lines) ? req.body.lines : [];

    if (!periodLabel) {
      return res.status(400).json({ error: "A commission period label is required." });
    }

    if (!sourceFileName) {
      return res.status(400).json({ error: "A source file name is required." });
    }

    if (importedLines.length === 0) {
      return res.status(400).json({ error: "At least one commission line is required." });
    }

    const runId = await createCommissionRun({
      periodLabel,
      sourceFileName,
      importedByUsername: req.authUser?.username || "",
      importedByName: req.authUser?.displayName || "",
      lines: importedLines
    });

    const detail = await getCommissionRunDetail(runId);

    return res.json({
      success: true,
      run: detail?.run || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to import commission run."
    });
  }
});

app.get("/api/commissions/runs/:runId", requireExecutiveApi, async (req, res) => {
  try {
    const detail = await getCommissionRunDetail(req.params.runId);
    if (!detail) {
      return res.status(404).json({ error: "Commission run not found." });
    }

    return res.json(detail);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to load commission run."
    });
  }
});

app.post("/api/commissions/runs/:runId/salespeople/:salespersonKey/lock", requireExecutiveApi, async (req, res) => {
  try {
    const salespersonStatus = await lockCommissionSalesperson(
      req.params.runId,
      decodeURIComponent(req.params.salespersonKey || "")
    );

    if (!salespersonStatus) {
      return res.status(404).json({ error: "Salesperson status not found." });
    }

    await finalizeExpiredCommissionRuns();
    return res.json({ success: true, salespersonStatus });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to lock salesperson."
    });
  }
});

app.post("/api/commissions/lines/:lineId/calculate", requireExecutiveApi, async (req, res) => {
  try {
    const mode = String(req.body?.mode || "").trim();
    const value = req.body?.value;

    if (!mode) {
      return res.status(400).json({ error: "A calculation mode is required." });
    }

    const line = await recalculateCommissionLine(req.params.lineId, mode, value);
    if (!line) {
      return res.status(404).json({ error: "Commission line not found." });
    }

    return res.json({ success: true, line });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to recalculate commission line."
    });
  }
});

app.post("/api/commissions/lines/:lineId/classification", requireExecutiveApi, async (req, res) => {
  try {
    const sourceClassification = String(req.body?.sourceClassification || "").trim();

    const line = await updateCommissionLineClassification(req.params.lineId, sourceClassification);
    if (!line) {
      return res.status(404).json({ error: "Commission line not found." });
    }

    return res.json({ success: true, line });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to update commission line classification."
    });
  }
});

app.post("/api/commissions/runs/:runId/salespeople/:salespersonKey/adjustments", requireExecutiveApi, async (req, res) => {
  try {
    const runId = req.params.runId;
    const adjustment = await updateCommissionSalespersonAdjustment(
      runId,
      decodeURIComponent(req.params.salespersonKey || ""),
      String(req.body?.adjustmentType || "").trim(),
      req.body?.amount,
      String(req.body?.comment || "").trim()
    );

    if (!adjustment) {
      return res.status(404).json({ error: "Salesperson adjustment target not found." });
    }

    const detail = await getCommissionRunDetail(runId);
    return res.json({ success: true, adjustment, detail });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to update salesperson adjustment."
    });
  }
});

app.post("/api/commissions/runs/:runId/salespeople/:salespersonKey/orders/:salesOrder/hvac", requireExecutiveApi, async (req, res) => {
  try {
    const runId = req.params.runId;
    const order = await updateCommissionHvacOrderSettings(
      runId,
      decodeURIComponent(req.params.salespersonKey || ""),
      decodeURIComponent(req.params.salesOrder || ""),
      req.body?.laborAmount,
      req.body?.discountsAmount,
      req.body?.cogsAmount,
      req.body?.overheadPercent
    );

    if (!order) {
      return res.status(404).json({ error: "HVAC order target not found." });
    }

    const detail = await getCommissionRunDetail(runId);
    return res.json({ success: true, order, detail });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to update HVAC order settings."
    });
  }
});

app.post("/api/commissions/runs/:runId/lock", requireExecutiveApi, async (req, res) => {
  try {
    const run = await lockCommissionRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Commission run not found." });
    }

    await finalizeExpiredCommissionRuns();
    return res.json({ success: true, run });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to lock commission run."
    });
  }
});

app.delete("/api/commissions/runs/:runId", requireExecutiveApi, async (req, res) => {
  try {
    const run = await deleteCommissionRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Commission run not found." });
    }

    return res.json({ success: true, run });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Unable to delete commission run."
    });
  }
});



// -------------------------
// EXISTING PAYMENT LINK ROUTE
// -------------------------
app.post("/api/create-payment-link", requirePagePermission("/index.html"), async (req, res) => {
  try {
    const {
      linkType,
      customerName,
      customerPhone,
      customerPhoneDigits,
      customerEmail,
      creatorCode,
      creatorName,
      creatorEmail,
      department,
      salesOrder,
      amount,
      requestedTotalAmount,
      depositAmount,
      balanceAmount,
      description,
      notes,
      agreementText
    } = req.body;

    if (!amount || !salesOrder || !customerPhone) {
      return res.status(400).json({
        error: "amount, salesOrder, and customerPhone are required"
      });
    }

    const normalizedLinkType = linkType === "hvac_deposit" ? "hvac_deposit" : "appliance";
    const normalizedCurrency = "usd";
    const chargeNowAmount = Number(amount);
    const fullOrderAmount =
      normalizedLinkType === "hvac_deposit"
        ? Number(requestedTotalAmount || amount)
        : Number(amount);
    const remainingBalanceAmount =
      normalizedLinkType === "hvac_deposit"
        ? Number(balanceAmount || Math.max(fullOrderAmount - chargeNowAmount, 0))
        : 0;

    if (normalizedLinkType === "hvac_deposit" && !customerEmail) {
      return res.status(400).json({
        error: "customerEmail is required for deposit agreement links"
      });
    }

const unitAmount = Math.round(chargeNowAmount * 100);
if (!Number.isFinite(unitAmount) || unitAmount < 50) {
  return res.status(400).json({
    error: "Amount must be at least $0.50"
  });
}

const productConfig = {
  name:
    normalizedLinkType === "hvac_deposit"
      ? `${salesOrder || "Customer payment"} Deposit Agreement`
      : salesOrder || "Customer payment"
};

const product = await stripe.products.create(productConfig, {
  idempotencyKey: createStripeIdempotencyKeyFromPayload("payment-link-product", productConfig)
});

    const priceConfig = {
      product: product.id,
      unit_amount: unitAmount,
      currency: normalizedCurrency
    };
    const price = await stripe.prices.create(priceConfig, {
      idempotencyKey: createStripeIdempotencyKeyFromPayload("payment-link-price", priceConfig)
    });

const sharedMetadata = {
  workflow_type: normalizedLinkType,
  sales_order: salesOrder || "",
  customer_name: customerName || "",
  customer_phone: customerPhoneDigits || customerPhone || "",
  customer_email: customerEmail || "",
  creator_code: creatorCode || "",
  creator_name: creatorName || "",
  creator_email: creatorEmail || "",
  department: department || "",
  notes: notes || "",
  link_description: description || "",
  requested_total_amount: String(fullOrderAmount || 0),
  deposit_amount: String(normalizedLinkType === "hvac_deposit" ? (depositAmount || chargeNowAmount) : chargeNowAmount),
  remaining_balance_amount: String(remainingBalanceAmount || 0),
  agreement_text: agreementText || ""
};

const paymentLinkConfig = {
  line_items: [
    {
      price: price.id,
      quantity: 1
    }
  ],
  after_completion: {
    type: "hosted_confirmation",
    hosted_confirmation: {
      custom_message: COMPLETED_PAYMENT_LINK_MESSAGE
    }
  },
  inactive_message: COMPLETED_PAYMENT_LINK_MESSAGE,
  restrictions: {
    completed_sessions: {
      limit: SINGLE_USE_PAYMENT_LINK_LIMIT
    }
  },
  payment_intent_data: {
    description:
      normalizedLinkType === "hvac_deposit"
        ? `${salesOrder || description || "Customer payment"} deposit agreement`
        : salesOrder || description || "Customer payment",
    metadata: sharedMetadata
  },
  metadata: sharedMetadata
};

if (normalizedLinkType === "hvac_deposit") {
  paymentLinkConfig.customer_creation = "always";
  paymentLinkConfig.payment_intent_data.setup_future_usage = "off_session";
}

const paymentLink = await stripe.paymentLinks.create(paymentLinkConfig, {
  idempotencyKey: createStripeIdempotencyKeyFromPayload("payment-link-link", paymentLinkConfig)
});

    const links = await readLinks();
    const linkRecord = {
      id: `req_${Date.now()}`,
      createdAt: new Date().toISOString(),
      customerName: customerName || "",
      customerPhone: customerPhoneDigits || customerPhone || "",
      customerEmail: customerEmail || "",
      creatorCode: creatorCode || "",
      creatorName: creatorName || "",
      creatorEmail: creatorEmail || "",
      department: department || "",
      salesOrder: salesOrder || "",
      description: description || "",
      notes: notes || "",
      workflowType: normalizedLinkType,
      requestedAmount: chargeNowAmount || 0,
      requestedTotalAmount: fullOrderAmount || chargeNowAmount || 0,
      depositAmount: normalizedLinkType === "hvac_deposit" ? (Number(depositAmount) || chargeNowAmount || 0) : 0,
      balanceAmount: remainingBalanceAmount || 0,
      agreementText: agreementText || "",
      currency: normalizedCurrency,
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.url,
      status: "sent",
      active: true,
      deactivatedAt: "",
      deactivationReason: "",
      paymentMethodType: "",
      paymentStatusDetail: "",
      paymentNotificationSentAt: "",
      paymentNotificationError: "",
      customerId: "",
      paymentMethodId: "",
      paidAmount: 0,
      paidDate: "",
      paymentIntentId: "",
      checkoutSessionId: "",
      balanceChargedAt: "",
      balancePaymentIntentId: "",
      balancePaidAmount: 0
    };

    if (normalizedLinkType === "hvac_deposit") {
      linkRecord.depositAgreementId = getDepositAgreementIdFromLink(linkRecord);
    }

    links.unshift(linkRecord);

    await writeLinks(links);

    if (normalizedLinkType === "hvac_deposit") {
      await upsertDepositAgreement(buildDepositAgreementFromLink(linkRecord));
    }

    res.json({
      url: paymentLink.url,
      paymentLinkId: paymentLink.id,
      workflowType: normalizedLinkType,
      depositAgreementId: linkRecord.depositAgreementId || ""
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// -------------------------
// TERMINAL: LIST ONLINE READERS
// -------------------------
app.get("/api/terminal/readers", requirePagePermission("/terminal.html"), async (req, res) => {
  try {
    const readers = await stripe.terminal.readers.list({
      limit: 20
    });

    const simplified = readers.data.map((reader) => ({
      id: reader.id,
      label: reader.label,
      device_type: reader.device_type,
      status: reader.status,
      location: reader.location
    }));

    res.json({ readers: simplified });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// -------------------------
// TERMINAL: CREATE + COLLECT + PROCESS
// -------------------------
app.post("/api/terminal/charge", requirePagePermission("/terminal.html"), async (req, res) => {
  try {
const {
  amount,
  currency,
  description,
  customerName,
  customerPhone,
  customerPhoneDigits,
  customerEmail,
  creatorCode,
  creatorName,
  creatorEmail,
  department,
  salesOrder,
  notes,
  readerId
} = req.body;

   if (!amount || !readerId || !salesOrder || !customerPhone) {
  return res.status(400).json({
    error: "amount, readerId, salesOrder, and customerPhone are required"
  });
}

    const amountInCents = Math.round(Number(amount) * 100);

const terminalPaymentIntentConfig = {
  amount: amountInCents,
  currency: currency || "usd",
  payment_method_types: ["card_present"],
  capture_method: "automatic",
  description: description || "In-person payment",
  metadata: {
    sales_order: salesOrder || "",
    description: description || "",
    customer_name: customerName || "",
    customer_phone: customerPhoneDigits || customerPhone || "",
    customer_email: customerEmail || "",
    creator_code: creatorCode || "",
    creator_name: creatorName || "",
    creator_email: creatorEmail || "",
    department: department || "",
    notes: notes || "",
    reader_id: readerId || ""
  }
};

const paymentIntent = await stripe.paymentIntents.create(terminalPaymentIntentConfig, {
  idempotencyKey: createStripeIdempotencyKeyFromPayload("terminal-charge", terminalPaymentIntentConfig)
});

    const reader = await stripe.rawRequest(
      "POST",
      `/v1/terminal/readers/${readerId}/process_payment_intent`,
      {
        payment_intent: paymentIntent.id
      }
    );

    res.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      readerActionStatus: reader.action?.status || "in_progress",
      message: "Reader is ready. Customer can tap, insert, or swipe now."
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Terminal charge failed"
    });
  }
});


app.get("/api/terminal/payment-status/:paymentIntentId", requirePagePermission("/terminal.html"), async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      req.params.paymentIntentId
    );

    const charge = paymentIntent.latest_charge
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : null;

    const cardDetails =
      charge?.payment_method_details?.card_present ||
      charge?.payment_method_details?.card ||
      null;

    if (paymentIntent.status === "succeeded") {
      const terminalPayments = await readTerminalPayments();
      const alreadyExists = terminalPayments.some(
        (row) => row.paymentIntentId === paymentIntent.id
      );

      if (!alreadyExists) {
        terminalPayments.unshift({
          id: `term_${Date.now()}`,
          type: "terminal",
          createdAt: new Date(paymentIntent.created * 1000).toISOString(),
          customerName: paymentIntent.metadata?.customer_name || "",
          customerEmail: paymentIntent.metadata?.customer_email || "",
          creatorCode: paymentIntent.metadata?.creator_code || "",
          creatorName: paymentIntent.metadata?.creator_name || "",
          creatorEmail: paymentIntent.metadata?.creator_email || "",
          department: paymentIntent.metadata?.department || "",
          reference: paymentIntent.metadata?.sales_order || paymentIntent.description || "",
          description: paymentIntent.metadata?.description || paymentIntent.description || "",
          salesOrder: paymentIntent.metadata?.sales_order || "",
          notes: paymentIntent.metadata?.notes || "",
          status: "paid",
          paidAmount: (paymentIntent.amount || 0) / 100,
          paidDate: getPaymentIntentCreatedIso(paymentIntent),
          paymentIntentId: paymentIntent.id,
          cardBrand: cardDetails?.brand || "",
          last4: cardDetails?.last4 || ""
        });

        await writeTerminalPayments(terminalPayments);
      }
    }

    res.json({
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      created: paymentIntent.created,
      cardBrand: cardDetails?.brand || "",
      last4: cardDetails?.last4 || ""
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// -------------------------
// APPLIANCE SERVICE: SAVE CARD
// -------------------------


app.get("/api/config", (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(400).json({ error: "Missing STRIPE_PUBLISHABLE_KEY" });
  }

  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

app.post("/api/service/setup-intent", async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      existingServiceCardId,
      serviceAddress,
      gateCode,
      contactMethod,
      purchaseDate,
      purchasedWithin12Months,
      problemDescription,
      units,
      consent
    } = req.body;

    if (!customerName || !customerEmail) {
      return res.status(400).json({
        error: "Client name and client email are required."
      });
    }

    if (!consent) {
      return res.status(400).json({
        error: "Customer authorization is required."
      });
    }

    const normalizedAddressState =
      serviceAddress?.state === "Texas"
        ? "TX"
        : (serviceAddress?.state || undefined);

    const serviceCustomerConfig = {
      name: customerName,
      email: customerEmail,
      phone: customerPhone || undefined,
      address: serviceAddress
        ? {
            line1: serviceAddress.line1 || undefined,
            line2: serviceAddress.line2 || undefined,
            city: serviceAddress.city || undefined,
            state: normalizedAddressState,
            postal_code: serviceAddress.zip || undefined,
            country: "US"
          }
        : undefined,
      metadata: {
        existing_service_card_id: existingServiceCardId || "",
        gate_code: gateCode || "",
        contact_method: contactMethod || "",
        purchase_date: purchaseDate || "",
        purchased_within_12_months: purchasedWithin12Months || "",
        service_address_line1: serviceAddress?.line1 || "",
        service_address_line2: serviceAddress?.line2 || "",
        service_address_city: serviceAddress?.city || "",
        service_address_state: serviceAddress?.state || "",
        service_address_zip: serviceAddress?.zip || "",
        problem_description: problemDescription || ""
      }
    };

    const customer = await stripe.customers.create(serviceCustomerConfig, {
      idempotencyKey: createStripeIdempotencyKeyFromPayload("service-setup-customer", serviceCustomerConfig)
    });

    const setupIntentConfig = {
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        customer_name: customerName || "",
        customer_email: customerEmail || "",
        customer_phone: customerPhone || "",
        service_card_id: existingServiceCardId || "",
        service_address_line1: serviceAddress?.line1 || "",
        service_address_line2: serviceAddress?.line2 || "",
        service_address_city: serviceAddress?.city || "",
        service_address_state: serviceAddress?.state || "",
        service_address_zip: serviceAddress?.zip || "",
        gate_code: gateCode || "",
        contact_method: contactMethod || "",
        purchase_date: purchaseDate || "",
        purchased_within_12_months: purchasedWithin12Months || "",
        appliance_type_1: units?.[0]?.applianceType || "",
        brand_1: units?.[0]?.brand || "",
        model_1: units?.[0]?.model || "",
        serial_1: units?.[0]?.serial || "",
        purchased_from_us_1: units?.[0]?.purchasedFromUs || "",
        stacked_1: units?.[0]?.stacked || "",
        problem_description_1: units?.[0]?.problemDescription || "",
        appliance_type_2: units?.[1]?.applianceType || "",
        brand_2: units?.[1]?.brand || "",
        model_2: units?.[1]?.model || "",
        serial_2: units?.[1]?.serial || "",
        problem_description_2: units?.[1]?.problemDescription || ""
      }
    };

    const setupIntent = await stripe.setupIntents.create(setupIntentConfig, {
      idempotencyKey: createStripeIdempotencyKeyFromPayload("service-setup-intent", setupIntentConfig)
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId: customer.id
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to create setup intent."
    });
  }
});


app.get("/api/service/setup-intent-result/:setupIntentId", async (req, res) => {
  try {
    const setupIntent = await stripe.setupIntents.retrieve(
      req.params.setupIntentId,
      {
        expand: ["payment_method", "customer"]
      }
    );

    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({
        error: `SetupIntent is not complete. Current status: ${setupIntent.status}`
      });
    }

    const paymentMethod = setupIntent.payment_method;
    const customer = setupIntent.customer;

    const brand = paymentMethod?.card?.brand || "";
    const last4 = paymentMethod?.card?.last4 || "";

    const serviceCards = await readServiceCards();
    const existingServiceCardId = setupIntent.metadata?.service_card_id || "";
    const existingIndex = serviceCards.findIndex(
      (row) => row.setupIntentId === setupIntent.id
    );
    const existingCardIdIndex =
      existingIndex >= 0
        ? existingIndex
        : existingServiceCardId
          ? serviceCards.findIndex((row) => row.id === existingServiceCardId)
          : -1;

    const stripeFields = {
      customerId: customer?.id || "",
      paymentMethodId: paymentMethod?.id || "",
      cardBrand: brand,
      last4,
      setupIntentStatus: setupIntent.status,
      updatedAt: new Date().toISOString()
    };

    if (existingCardIdIndex >= 0) {
      serviceCards[existingCardIdIndex] = {
        ...serviceCards[existingCardIdIndex],
        setupIntentId: setupIntent.id,
        ...stripeFields
      };
    } else {
      serviceCards.unshift({
        id: `svc_${Date.now()}`,
        createdAt: new Date(setupIntent.created * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        queueStatus: "Call Status Pending",
        queueStatusNotes: "",
        erpOrderNumber: "",
        setupIntentId: setupIntent.id,
        setupIntentStatus: setupIntent.status,
        customerId: customer?.id || "",
        paymentMethodId: paymentMethod?.id || "",
        customerName: customer?.name || setupIntent.metadata?.customer_name || "",
        customerEmail: customer?.email || setupIntent.metadata?.customer_email || "",
        customerPhone: customer?.phone || setupIntent.metadata?.customer_phone || "",
        serviceAddress: {
          line1: setupIntent.metadata?.service_address_line1 || "",
          line2: setupIntent.metadata?.service_address_line2 || "",
          city: setupIntent.metadata?.service_address_city || "",
          state: setupIntent.metadata?.service_address_state || "",
          zip: setupIntent.metadata?.service_address_zip || ""
        },
        purchaseDate: setupIntent.metadata?.purchase_date || "",
        purchasedWithin12Months: setupIntent.metadata?.purchased_within_12_months || "",
        gateCode: setupIntent.metadata?.gate_code || "",
        contactMethod: setupIntent.metadata?.contact_method || "",
        unitCount:
          (setupIntent.metadata?.appliance_type_2 ||
           setupIntent.metadata?.brand_2 ||
           setupIntent.metadata?.model_2 ||
           setupIntent.metadata?.serial_2 ||
           setupIntent.metadata?.problem_description_2)
            ? "Multiple"
            : "One",
        units: [
          {
            applianceType: setupIntent.metadata?.appliance_type_1 || "",
            brand: setupIntent.metadata?.brand_1 || "",
            model: setupIntent.metadata?.model_1 || "",
            serial: setupIntent.metadata?.serial_1 || "",
            purchasedFromUs: setupIntent.metadata?.purchased_from_us_1 || "",
            stacked: setupIntent.metadata?.stacked_1 || "",
            problemDescription: setupIntent.metadata?.problem_description_1 || ""
          },
          ...(
            setupIntent.metadata?.appliance_type_2 ||
            setupIntent.metadata?.brand_2 ||
            setupIntent.metadata?.model_2 ||
            setupIntent.metadata?.serial_2 ||
            setupIntent.metadata?.problem_description_2
              ? [{
                  applianceType: setupIntent.metadata?.appliance_type_2 || "",
                  brand: setupIntent.metadata?.brand_2 || "",
                  model: setupIntent.metadata?.model_2 || "",
                  serial: setupIntent.metadata?.serial_2 || "",
                  problemDescription: setupIntent.metadata?.problem_description_2 || ""
                }]
              : []
          )
        ],
        problemDescription: setupIntent.metadata?.problem_description || "",
        cardRequired: true,
        cardBrand: brand,
        last4
      });
    }

    await writeServiceCards(serviceCards);

    res.json({
      setupIntentId: setupIntent.id,
      customerId: customer?.id || "",
      paymentMethodId: paymentMethod?.id || "",
      customerName: customer?.name || "",
      customerEmail: customer?.email || "",
      cardBrand: brand,
      last4,
      setupIntentStatus: setupIntent.status
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to retrieve setup intent result."
    });
  }
});


app.post("/api/service/submit-request", async (req, res) => {
  try {
    const { serviceRequest, setupIntentId, existingServiceCardId } = req.body;

    if (!serviceRequest || !serviceRequest.customerName) {
      return res.status(400).json({
        error: "Missing service request data."
      });
    }

    const serviceCards = await readServiceCards();
    const explicitExistingId =
      existingServiceCardId || serviceRequest.existingServiceCardId || "";

    if (setupIntentId) {
      const existingIndex = serviceCards.findIndex(
        (row) => row.setupIntentId === setupIntentId
      );
      const existingByIdIndex =
        existingIndex >= 0
          ? existingIndex
          : explicitExistingId
            ? serviceCards.findIndex((row) => row.id === explicitExistingId)
            : -1;

      if (existingByIdIndex >= 0) {
        serviceCards[existingByIdIndex] = {
          ...serviceCards[existingByIdIndex],
          updatedAt: new Date().toISOString(),
          setupIntentId: setupIntentId || serviceCards[existingByIdIndex].setupIntentId || "",
          customerName: serviceRequest.customerName || "",
          firstName: serviceRequest.firstName || "",
          lastName: serviceRequest.lastName || "",
          customerEmail: serviceRequest.customerEmail || "",
          customerPhone: serviceRequest.customerPhone || "",
          purchasedWithin12Months: serviceRequest.purchasedWithin12Months || "",
          cardRequired: serviceRequest.purchasedWithin12Months !== "Yes",
          gateCode: serviceRequest.gateCode || "",
          contactMethod: serviceRequest.contactMethod || "",
          purchaseDate: serviceRequest.purchaseDate || "",
          serviceAddress: serviceRequest.serviceAddress || {},
          billingAddress: serviceRequest.billingAddress || {},
          billingSameAsService: serviceRequest.billingSameAsService,
          unitCount: serviceRequest.unitCount || "One",
          units: serviceRequest.units || [],
          problemDescription: serviceRequest.problemDescription || "",
          consent: !!serviceRequest.consent
        };

        await writeServiceCards(serviceCards);

        return res.json({
          success: true,
          updatedExisting: true
        });
      }
    }

    if (explicitExistingId) {
      const existingByIdIndex = serviceCards.findIndex((row) => row.id === explicitExistingId);

      if (existingByIdIndex >= 0) {
        serviceCards[existingByIdIndex] = {
          ...serviceCards[existingByIdIndex],
          updatedAt: new Date().toISOString(),
          setupIntentId: setupIntentId || serviceCards[existingByIdIndex].setupIntentId || "",
          setupIntentStatus: setupIntentId
            ? serviceCards[existingByIdIndex].setupIntentStatus || "submitted_not_completed"
            : serviceCards[existingByIdIndex].setupIntentStatus || "not_required",
          customerName: serviceRequest.customerName || "",
          firstName: serviceRequest.firstName || "",
          lastName: serviceRequest.lastName || "",
          customerEmail: serviceRequest.customerEmail || "",
          customerPhone: serviceRequest.customerPhone || "",
          purchasedWithin12Months: serviceRequest.purchasedWithin12Months || "",
          cardRequired: serviceRequest.purchasedWithin12Months !== "Yes",
          gateCode: serviceRequest.gateCode || "",
          contactMethod: serviceRequest.contactMethod || "",
          purchaseDate: serviceRequest.purchaseDate || "",
          serviceAddress: serviceRequest.serviceAddress || {},
          billingAddress: serviceRequest.billingAddress || {},
          billingSameAsService: serviceRequest.billingSameAsService,
          unitCount: serviceRequest.unitCount || "One",
          units: serviceRequest.units || [],
          problemDescription: serviceRequest.problemDescription || "",
          consent: !!serviceRequest.consent
        };

        await writeServiceCards(serviceCards);

        return res.json({
          success: true,
          updatedExisting: true
        });
      }
    }

    serviceCards.unshift({
      id: `svc_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      queueStatus: "Call Status Pending",
      queueStatusNotes: "",
      erpOrderNumber: "",
      setupIntentId: setupIntentId || "",
      setupIntentStatus: setupIntentId ? "submitted_not_completed" : "not_required",
      customerId: "",
      paymentMethodId: "",
      customerName: serviceRequest.customerName || "",
      firstName: serviceRequest.firstName || "",
      lastName: serviceRequest.lastName || "",
      customerEmail: serviceRequest.customerEmail || "",
      customerPhone: serviceRequest.customerPhone || "",
      purchasedWithin12Months: serviceRequest.purchasedWithin12Months || "",
      cardRequired: serviceRequest.purchasedWithin12Months !== "Yes",
      gateCode: serviceRequest.gateCode || "",
      contactMethod: serviceRequest.contactMethod || "",
      purchaseDate: serviceRequest.purchaseDate || "",
      serviceAddress: serviceRequest.serviceAddress || {},
      billingAddress: serviceRequest.billingAddress || {},
      billingSameAsService: serviceRequest.billingSameAsService,
      unitCount: serviceRequest.unitCount || "One",
      units: serviceRequest.units || [],
      problemDescription: serviceRequest.problemDescription || "",
      consent: !!serviceRequest.consent,
      cardBrand: "",
      last4: ""
    });

    await writeServiceCards(serviceCards);

    res.json({
      success: true
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to submit service request."
    });
  }
});


app.post("/api/card-on-file/charge", requirePagePermission("/charge-saved-card.html"), async (req, res) => {
  try {
    const {
      customerId,
      paymentMethodId,
      amount,
      salesOrder,
      description,
      customerName,
      customerEmail,
      creatorCode,
      creatorName,
      creatorEmail,
      internalNotes,
      hvacDepositRecordId,
      depositAgreementId
    } = req.body;
    const resolvedDepositAgreementId = String(depositAgreementId || hvacDepositRecordId || "").trim();

    if (!customerId || !paymentMethodId || !amount || !salesOrder) {
      return res.status(400).json({
        error: "customerId, paymentMethodId, amount, and salesOrder are required"
      });
    }

    const amountInCents = Math.round(Number(amount) * 100);

    if (!Number.isFinite(amountInCents) || amountInCents < 50) {
      return res.status(400).json({
        error: "Amount must be at least $0.50"
      });
    }

    const savedCardChargeConfig = {
      amount: amountInCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: description || "Service charge",
      metadata: {
        sales_order: salesOrder,
        description: description || "",
        customer_name: customerName || "",
        customer_email: customerEmail || "",
        creator_code: creatorCode || "",
        creator_name: creatorName || "",
        creator_email: creatorEmail || "",
        notes: internalNotes || "",
        hvac_deposit_record_id: hvacDepositRecordId || "",
        deposit_agreement_id: resolvedDepositAgreementId
      }
    };

    const paymentIntent = await stripe.paymentIntents.create(savedCardChargeConfig, {
      idempotencyKey: createStripeIdempotencyKeyFromPayload("saved-card-charge", savedCardChargeConfig)
    });

    const terminalPayments = await readTerminalPayments();
    const alreadyExists = terminalPayments.some(
      (row) => row.paymentIntentId === paymentIntent.id
    );

    if (!alreadyExists && paymentIntent.status === "succeeded") {
      terminalPayments.unshift({
        id: `cof_${Date.now()}`,
        type: "card_on_file",
        createdAt: new Date(paymentIntent.created * 1000).toISOString(),
        customerName: customerName || "",
        customerEmail: customerEmail || "",
        creatorCode: creatorCode || "",
        creatorName: creatorName || "",
        creatorEmail: creatorEmail || "",
        reference: salesOrder || description || "Card on file charge",
        description: description || "Service charge",
        status: "paid",
        paidAmount: (paymentIntent.amount || 0) / 100,
        paidDate: getPaymentIntentCreatedIso(paymentIntent),
        paymentIntentId: paymentIntent.id,
        depositAgreementId: resolvedDepositAgreementId,
        salesOrder: salesOrder || "",
        notes: internalNotes || ""
      });

      await writeTerminalPayments(terminalPayments);
    }

    if (paymentIntent.status === "succeeded" && resolvedDepositAgreementId) {
      const links = await readLinks();
      const hvacRecord = links.find((row) =>
        row.id === hvacDepositRecordId ||
        row.depositAgreementId === resolvedDepositAgreementId ||
        getDepositAgreementIdFromLink(row) === resolvedDepositAgreementId
      );

      if (hvacRecord && normalizeLinkRecord(hvacRecord).workflowType === "hvac_deposit") {
        hvacRecord.depositAgreementId = getDepositAgreementIdFromLink(hvacRecord);
        hvacRecord.balanceChargedAt = getPaymentIntentCreatedIso(paymentIntent);
        hvacRecord.balancePaymentIntentId = paymentIntent.id;
        hvacRecord.balancePaidAmount = Number((paymentIntent.amount || 0) / 100);
        hvacRecord.customerId = customerId || hvacRecord.customerId || "";
        hvacRecord.paymentMethodId = paymentMethodId || hvacRecord.paymentMethodId || "";
        await writeLinks(links);

        const agreement = buildDepositAgreementFromLink(hvacRecord);
        await upsertDepositAgreement(agreement);
        await appendDepositPaymentEvent({
          depositAgreementId: agreement.id,
          eventType: "balance_charged",
          source: "card_on_file",
          department: agreement.department,
          salesOrder: agreement.salesOrder,
          customerName: agreement.customerName,
          approvedAt: getPaymentIntentCreatedIso(paymentIntent),
          paymentIntentId: paymentIntent.id,
          amount: Number((paymentIntent.amount || 0) / 100),
          currency: agreement.currency,
          reportType: "sale"
        });
      }
    }

    return res.json({
      success: true,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unable to charge saved card."
    });
  }
});

app.get("/api/service-cards", requirePagePermission("/appliance-service-calls.html", "/archive-service-calls.html"), async (req, res) => {
  try {
    const serviceCards = await readServiceCards();
    res.json({ rows: serviceCards });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load service cards."
    });
  }
});

app.get("/api/service-cards/archive", requirePagePermission("/appliance-service-calls.html", "/archive-service-calls.html"), async (req, res) => {
  try {
    const archiveRows = await readArchivedServiceCards();
    res.json({ rows: archiveRows });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load archived service cards."
    });
  }
});

app.get("/api/hvac-deposits", requirePagePermission("/hvac-dashboard.html", "/charge-saved-card.html"), async (req, res) => {
  try {
    const links = await readLinks();
    let didUpdate = false;
    const rows = [];

    for (const rawRow of links) {
      const row = normalizeLinkRecord(rawRow);

      if (
        row.workflowType !== "hvac_deposit" ||
        row.status !== "paid" ||
        Number(row.balanceAmount || 0) <= 0 ||
        row.balanceChargedAt ||
        row.balanceCanceledAt
      ) {
        continue;
      }

      if ((!row.customerId || !row.paymentMethodId) && row.paymentIntentId) {
        try {
          const paymentIntent = await retrievePaymentIntentWithDetails(row.paymentIntentId);
          row.customerId =
            typeof paymentIntent?.customer === "string"
              ? paymentIntent.customer
              : paymentIntent?.customer?.id || row.customerId || "";
          row.paymentMethodId =
            typeof paymentIntent?.payment_method === "string"
              ? paymentIntent.payment_method
              : paymentIntent?.payment_method?.id || row.paymentMethodId || "";
          didUpdate = true;
          await sleep(120);
        } catch {
          // Leave the record as-is so the dashboard can still render partial data.
        }
      }

      rows.push({
        id: row.id,
        depositAgreementId: row.depositAgreementId || getDepositAgreementIdFromLink(row),
        department: normalizeDepositDepartment(row.department || row.workflowType),
        createdAt: row.createdAt || "",
        paidDate: row.paidDate || "",
        customerName: row.customerName || "",
        customerEmail: row.customerEmail || "",
        creatorName: row.creatorName || "",
        creatorCode: row.creatorCode || "",
        salesOrder: row.salesOrder || "",
        description: row.description || "",
        requestedTotalAmount: Number(row.requestedTotalAmount || row.requestedAmount || 0),
        depositAmount: Number(row.depositAmount || row.requestedAmount || 0),
        balanceAmount: Number(row.balanceAmount || 0),
        currency: row.currency || "usd",
        customerId: row.customerId || "",
        paymentMethodId: row.paymentMethodId || "",
        paymentIntentId: row.paymentIntentId || "",
        agreementText: row.agreementText || "",
        paymentStatusDetail: row.paymentStatusDetail || ""
      });
    }

    if (didUpdate) {
      await writeLinks(links);
    }

    const agreements = await syncDepositAgreementsFromLinks(links);
    const agreementBySourceRecordId = new Map(
      agreements.map((agreement) => [agreement.sourceRecordId, agreement])
    );

    for (const row of rows) {
      const agreement = agreementBySourceRecordId.get(row.id);
      if (!agreement) continue;
      row.depositAgreementId = agreement.id;
      row.agreementStatus = agreement.status;
      row.department = agreement.department;
    }

    rows.sort((a, b) => String(b.paidDate || "").localeCompare(String(a.paidDate || "")));

    const totals = rows.reduce((acc, row) => {
      acc.totalAmount += Number(row.requestedTotalAmount || 0);
      acc.depositAmount += Number(row.depositAmount || 0);
      acc.balanceAmount += Number(row.balanceAmount || 0);
      return acc;
    }, {
      totalAmount: 0,
      depositAmount: 0,
      balanceAmount: 0
    });

    res.json({ rows, totals });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load deposit agreements."
    });
  }
});

app.get("/api/deposit-agreements", requirePagePermission("/hvac-dashboard.html"), async (req, res) => {
  try {
    const links = await readLinks();
    const agreements = await syncDepositAgreementsFromLinks(links);
    const paymentEvents = await readDepositPaymentEvents();
    const department = normalizeDepositDepartment(req.query.department || "");

    const filteredAgreements = agreements
      .filter((agreement) => !req.query.department || agreement.department === department)
      .sort((a, b) =>
        String(b.depositPaidAt || b.createdAt || "").localeCompare(String(a.depositPaidAt || a.createdAt || ""))
      );

    return res.json({
      rows: filteredAgreements,
      events: paymentEvents,
      totals: filteredAgreements.reduce((acc, agreement) => {
        acc.totalAmount += Number(agreement.totalAmount || 0);
        acc.depositAmount += Number(agreement.depositAmount || 0);
        acc.balanceAmount += Number(agreement.balanceAmount || 0);
        acc.balancePaidAmount += Number(agreement.balancePaidAmount || 0);
        return acc;
      }, {
        totalAmount: 0,
        depositAmount: 0,
        balanceAmount: 0,
        balancePaidAmount: 0
      })
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to load deposit agreements."
    });
  }
});

app.get("/api/hvac-deposits/:id", requirePagePermission("/hvac-dashboard.html", "/charge-saved-card.html"), async (req, res) => {
  try {
    const links = await readLinks();
    await syncDepositAgreementsFromLinks(links);
    const row = links.find((item) =>
      item.id === req.params.id ||
      item.depositAgreementId === req.params.id ||
      getDepositAgreementIdFromLink(item) === req.params.id
    );

    if (!row) {
      return res.status(404).json({
        error: "Deposit agreement record not found."
      });
    }

    normalizeLinkRecord(row);

    if (row.workflowType !== "hvac_deposit") {
      return res.status(400).json({
        error: "Record is not a deposit agreement."
      });
    }

    if (row.balanceCanceledAt) {
      return res.status(400).json({
        error: "This deposit agreement has been canceled from the balance-charge queue."
      });
    }

    if (row.balanceChargedAt) {
      return res.status(400).json({
        error: "This deposit agreement balance has already been charged."
      });
    }

    if ((!row.customerId || !row.paymentMethodId) && row.paymentIntentId) {
      const paymentIntent = await retrievePaymentIntentWithDetails(row.paymentIntentId);
      row.customerId =
        typeof paymentIntent?.customer === "string"
          ? paymentIntent.customer
          : paymentIntent?.customer?.id || row.customerId || "";
      row.paymentMethodId =
        typeof paymentIntent?.payment_method === "string"
          ? paymentIntent.payment_method
          : paymentIntent?.payment_method?.id || row.paymentMethodId || "";
      await writeLinks(links);
    }

    return res.json({
      id: row.id,
      depositAgreementId: row.depositAgreementId || getDepositAgreementIdFromLink(row),
      customerName: row.customerName || "",
      customerEmail: row.customerEmail || "",
      creatorCode: row.creatorCode || "",
      creatorName: row.creatorName || "",
      creatorEmail: row.creatorEmail || "",
      salesOrder: row.salesOrder || "",
      description: row.description || "",
      customerId: row.customerId || "",
      paymentMethodId: row.paymentMethodId || "",
      amount: Number(row.balanceAmount || 0),
      paymentIntentId: row.paymentIntentId || "",
      requestedTotalAmount: Number(row.requestedTotalAmount || row.requestedAmount || 0),
      depositAmount: Number(row.depositAmount || row.requestedAmount || 0),
      balanceAmount: Number(row.balanceAmount || 0),
      agreementText: row.agreementText || ""
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load deposit agreement record."
    });
  }
});

app.post("/api/hvac-deposits/:id/manage", requirePagePermission("/hvac-dashboard.html"), async (req, res) => {
  try {
    const { action, balanceAmount } = req.body || {};
    const links = await readLinks();
    await syncDepositAgreementsFromLinks(links);
    const row = links.find((item) =>
      item.id === req.params.id ||
      item.depositAgreementId === req.params.id ||
      getDepositAgreementIdFromLink(item) === req.params.id
    );

    if (!row) {
      return res.status(404).json({
        error: "Deposit agreement record not found."
      });
    }

    normalizeLinkRecord(row);

    if (row.workflowType !== "hvac_deposit") {
      return res.status(400).json({
        error: "Record is not a deposit agreement."
      });
    }

    if (row.balanceChargedAt) {
      return res.status(400).json({
        error: "This deposit agreement balance has already been charged."
      });
    }

    if (action === "cancel") {
      row.balanceCanceledAt = new Date().toISOString();
      row.balanceCancellationReason = "Canceled from deposit agreements dashboard";
      await writeLinks(links);
      await upsertDepositAgreement(buildDepositAgreementFromLink(row));

      return res.json({
        success: true,
        action: "cancel",
        message: "Deposit agreement removed from the open balance dashboard."
      });
    }

    if (action === "update_balance") {
      const normalizedBalance = Number(balanceAmount);

      if (!Number.isFinite(normalizedBalance) || normalizedBalance < 0.5) {
        return res.status(400).json({
          error: "Balance amount must be at least $0.50. Use cancel if the balance should be removed."
        });
      }

      row.balanceOriginalAmount = Number(row.balanceOriginalAmount || row.balanceAmount || 0);
      row.balanceAmount = normalizedBalance;
      row.requestedTotalAmount = Number(row.depositAmount || row.requestedAmount || 0) + normalizedBalance;
      row.balanceUpdatedAt = new Date().toISOString();
      row.balanceCanceledAt = "";
      row.balanceCancellationReason = "";
      await writeLinks(links);
      await upsertDepositAgreement(buildDepositAgreementFromLink(row));

      return res.json({
        success: true,
        action: "update_balance",
        balanceAmount: row.balanceAmount,
        requestedTotalAmount: row.requestedTotalAmount,
        message: "Future balance updated."
      });
    }

    return res.status(400).json({
      error: "Unsupported deposit agreement action."
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to update deposit agreement."
    });
  }
});

app.post("/api/service-cards/:id/status", requirePagePermission("/appliance-service-calls.html", "/archive-service-calls.html"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      queueStatus = "Call Status Pending",
      queueStatusNotes = "",
      erpOrderNumber = ""
    } = req.body || {};

    const allowedStatuses = [
      "Call Status Pending",
      "Call Scheduled",
      "Call Cancelled"
    ];

    if (!allowedStatuses.includes(queueStatus)) {
      return res.status(400).json({
        error: "Invalid queue status."
      });
    }

    const serviceCards = await readServiceCards();
    const index = serviceCards.findIndex((row) => row.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: "Service request not found."
      });
    }

    serviceCards[index] = {
      ...serviceCards[index],
      queueStatus,
      queueStatusNotes,
      erpOrderNumber,
      updatedAt: new Date().toISOString()
    };

    await writeServiceCards(serviceCards);

    res.json({
      success: true,
      row: serviceCards[index]
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to update service call status."
    });
  }
});


// -------------------------
// DASHBOARD: CHECK PAYMENT STATUS
// -------------------------

app.get("/api/payment-link-status", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const links = await readLinks();
    const terminalPayments = await readTerminalPayments();

    const normalizedTerminalPayments = terminalPayments.map((row) => ({
      ...row,
      type: row.type || "terminal",
      reference: row.reference || row.description || row.salesOrder || "",
      status: row.status || "paid",
      active: false
    }));

    const normalizedLinks = links.map((row) => normalizeLinkRecord({ ...row }));

    const combinedRows = [...normalizedTerminalPayments, ...normalizedLinks].sort((a, b) => {
      const aDate = new Date(a.paidDate || a.createdAt || 0).getTime();
      const bDate = new Date(b.paidDate || b.createdAt || 0).getTime();
      return bDate - aDate;
    });

    res.json({
      rows: combinedRows
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

app.get("/api/paid-order-detail", requirePagePermission("/paid-order-detail.html"), async (req, res) => {
  try {
    const { start, end, search = "" } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "start and end dates are required."
      });
    }

    const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
    const terminalPayments = await readTerminalPayments();
    const paidSourceRowsByPaymentIntentId = new Map(
      [...links, ...terminalPayments]
        .filter((row) => row.paymentIntentId)
        .map((row) => [row.paymentIntentId, row])
    );

    const detailedRows = await getSaleRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId);
    const localFallbackRows = await getLocalFallbackSaleRowsForDateRange(
      start,
      end,
      [...links, ...terminalPayments],
      detailedRows
    );
    detailedRows.push(...localFallbackRows);

    const refundRows = await getRefundRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId);
    detailedRows.push(...refundRows);

    const normalizedSearch = String(search || "").trim().toLowerCase();
    const filteredRows = detailedRows.filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      return [
        row.salesOrder,
        row.customerName,
        row.description,
        row.paymentIntentId
      ].join(" ").toLowerCase().includes(normalizedSearch);
    });

    const totals = filteredRows.reduce((acc, row) => {
      acc.paidAmount += Number(row.paidAmount || 0);
      acc.feeAmount += Number(row.feeAmount || 0);
      acc.netAmount += Number(row.netAmount || 0);
      return acc;
    }, {
      paidAmount: 0,
      feeAmount: 0,
      netAmount: 0
    });

    res.json({
      rows: filteredRows.sort((a, b) => new Date(b.paidDate || 0) - new Date(a.paidDate || 0)),
      totals
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load paid order detail."
    });
  }
});

app.get("/api/bank-balancing", requirePagePermission("/bank-balancing.html"), async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "start and end dates are required."
      });
    }

    const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
    const terminalPayments = await readTerminalPayments();
    const sourceRowsByPaymentIntentId = new Map(
      [...links, ...terminalPayments]
        .filter((row) => row.paymentIntentId)
        .map((row) => [row.paymentIntentId, row])
    );

    const payouts = (await listAutomaticPayoutsByArrivalDate(start, end)).filter((payout) =>
      isDateKeyWithinRange(getPayoutArrivalDateKey(payout), start, end)
    );
    const payoutRows = [];
    let payoutAmountTotal = 0;

    for (const payout of payouts) {
      payoutAmountTotal += Number((payout.amount || 0) / 100);
      const rows = await getBankBalancingRowsForPayout(payout, sourceRowsByPaymentIntentId);
      payoutRows.push(...rows);
      await sleep(120);
    }

    // Filter out non-sale, non-refund balance transactions by default so
    // the report stops double-counting reserve releases, adjustments, and
    // similar Stripe-internal movements as fresh deposits. Set
    // ?includeNonSales=true to see everything (useful for accounting
    // debugging and reconciling against Stripe's full payout export).
    const includeNonSales = String(req.query.includeNonSales || "").trim().toLowerCase() === "true";
    const defaultTypes = new Set(["sale", "refund"]);
    const visibleRows = includeNonSales
      ? payoutRows
      : payoutRows.filter((row) => defaultTypes.has(row.type));
    const hiddenCountByType = payoutRows.reduce((acc, row) => {
      if (!defaultTypes.has(row.type)) {
        acc[row.type] = (acc[row.type] || 0) + 1;
      }
      return acc;
    }, {});
    const hiddenCount = Object.values(hiddenCountByType).reduce((a, b) => a + b, 0);

    const totals = visibleRows.reduce((acc, row) => {
      acc.grossAmount += Number(row.grossAmount || 0);
      acc.feeAmount += Number(row.feeAmount || 0);
      acc.bankPayoutAmount += Number(row.bankPayoutAmount || 0);
      return acc;
    }, {
      grossAmount: 0,
      feeAmount: 0,
      bankPayoutAmount: 0
    });

    res.json({
      rows: visibleRows.sort((a, b) => String(b.arrivalDateKey || "").localeCompare(String(a.arrivalDateKey || ""))),
      totals: {
        ...totals,
        payoutAmountTotal,
        payoutCount: payouts.length,
        hiddenCount,
        hiddenCountByType,
        includeNonSales
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load bank balancing."
    });
  }
});

app.get("/api/incoming-payouts", requirePagePermission("/incoming-payouts.html"), async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days || 21), 1), 90);
    const todayKey = toTimeZoneDateKey(new Date().toISOString(), APP_TIMEZONE);
    const endKey = addDaysToDateKey(todayKey, days);
    const startUnix = dateKeyToUnixStart(todayKey);
    const endUnix = dateKeyToUnixEnd(endKey);

    const [balance, payoutsByArrivalDate, pendingAvailability] = await Promise.all([
      stripe.balance.retrieve(),
      listPayoutsByArrivalDate(todayKey, endKey),
      listPendingBalanceTransactionsByAvailableDate(startUnix, endUnix)
    ]);

    const payoutRows = payoutsByArrivalDate
      .filter((payout) => !["canceled", "failed"].includes(String(payout.status || "").toLowerCase()))
      .map((payout) => buildIncomingPayoutRow(payout))
      .sort((a, b) => String(a.arrivalDateKey || "").localeCompare(String(b.arrivalDateKey || "")));

    const availabilityBuckets = buildPendingAvailabilityBuckets(pendingAvailability)
      .filter((bucket) => isDateKeyWithinRange(bucket.availableOnDateKey, todayKey, endKey))
      .sort((a, b) => String(a.availableOnDateKey || "").localeCompare(String(b.availableOnDateKey || "")));

    const totals = {
      payoutCount: payoutRows.length,
      payoutAmount: payoutRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      pendingAvailabilityAmount: availabilityBuckets.reduce((sum, row) => sum + Number(row.netAmount || 0), 0),
      availableBalanceAmount: sumStripeBalanceEntries(balance.available),
      pendingBalanceAmount: sumStripeBalanceEntries(balance.pending)
    };

    return res.json({
      generatedAt: new Date().toISOString(),
      start: todayKey,
      end: endKey,
      days,
      payouts: payoutRows,
      availabilityBuckets,
      balance: {
        available: normalizeStripeBalanceEntries(balance.available),
        pending: normalizeStripeBalanceEntries(balance.pending)
      },
      totals
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to load incoming payouts."
    });
  }
});

app.get("/api/link-detail-lookup", requirePagePermission("/link-detail-lookup.html"), async (req, res) => {
  try {
    const query = String(req.query?.query || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "A payment link URL or ID is required."
      });
    }

    const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
    let record = links.find((row) => paymentLinkLookupMatches(row, query));

    let stripeLink = null;
    if (!record) {
      stripeLink = await findStripePaymentLinkByLookup(query);
      if (stripeLink?.id) {
        record = links.find((row) => String(row.paymentLinkId || "").trim() === stripeLink.id) || null;
      }
    }

    if (!record && !stripeLink) {
      return res.status(404).json({
        error: "No saved payment link record matched that URL or ID."
      });
    }

    res.json({
      record,
      stripeLink: stripeLink
        ? {
            id: stripeLink.id,
            url: stripeLink.url || "",
            active: Boolean(stripeLink.active)
          }
        : null
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to look up payment link details."
    });
  }
});

app.post("/api/link-detail-lookup/repair", requirePagePermission("/link-detail-lookup.html"), async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "A payment link URL or ID is required."
      });
    }

    const links = await readLinks();
    const existingRecord = links.find((row) => paymentLinkLookupMatches(normalizeLinkRecord({ ...row }), query));
    if (existingRecord) {
      return res.json({
        success: true,
        record: normalizeLinkRecord({ ...existingRecord }),
        repaired: false
      });
    }

    const stripeLink = await findStripePaymentLinkByLookup(query);
    if (!stripeLink) {
      return res.status(404).json({
        error: "Stripe could not find a payment link for that URL or ID."
      });
    }

    const duplicateById = links.find((row) => String(row.paymentLinkId || "").trim() === stripeLink.id);
    if (duplicateById) {
      return res.json({
        success: true,
        record: normalizeLinkRecord({ ...duplicateById }),
        repaired: false
      });
    }

    const recoveredRecord = await buildRecoveredLinkRecordFromStripeLink(stripeLink, normalizeLinkRecord);
    await upsertLink(recoveredRecord);

    return res.json({
      success: true,
      record: normalizeLinkRecord({ ...recoveredRecord }),
      repaired: true
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to create Wilson queue record from Stripe."
    });
  }
});

// Find recent payments by customer phone, email, or name — for issuing a
// refund when the PaymentIntent ID isn't handy. Searches the app's own
// ledgers (payment links + terminal/card-on-file charges).
app.get("/api/intent-lookup/find", requirePagePermission("/intent-lookup.html"), async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (query.length < 3) {
      return res.status(400).json({ error: "Enter at least 3 characters of a phone, email, or name." });
    }

    const digits = query.replace(/\D/g, "");
    const searchByPhone = digits.length >= 4;
    const searchByEmail = !searchByPhone && query.includes("@");
    const needle = query.toLowerCase();

    const [rawLinks, rawCharges] = await Promise.all([readLinks(), readTerminalPayments()]);

    const candidates = [];

    for (const raw of rawLinks) {
      const row = normalizeLinkRecord({ ...raw });
      candidates.push({
        source: "Payment link",
        paymentIntentId: row.paymentIntentId || "",
        customerName: row.customerName || "",
        customerPhone: row.customerPhone || "",
        customerEmail: row.customerEmail || "",
        salesOrder: row.salesOrder || row.reference || "",
        description: row.description || "",
        amount: Number(row.paidAmount || row.amount || 0),
        status: row.status || "",
        when: row.paidDate || row.createdAt || ""
      });
    }

    for (const row of rawCharges) {
      candidates.push({
        source: row.type === "terminal" ? "Terminal" : "Card on file",
        paymentIntentId: row.paymentIntentId || "",
        customerName: row.customerName || "",
        customerPhone: row.customerPhone || "",
        customerEmail: row.customerEmail || "",
        salesOrder: row.salesOrder || row.reference || "",
        description: row.description || "",
        amount: Number(row.paidAmount || 0),
        status: row.status || "paid",
        when: row.paidDate || row.createdAt || ""
      });
    }

    const matches = candidates
      .filter((c) => c.paymentIntentId)
      .filter((c) => {
        if (searchByPhone) {
          return String(c.customerPhone || "").replace(/\D/g, "").includes(digits);
        }
        if (searchByEmail) {
          return String(c.customerEmail || "").toLowerCase().includes(needle);
        }
        return String(c.customerName || "").toLowerCase().includes(needle);
      })
      .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
      .slice(0, 15);

    return res.json({ matches, searchedBy: searchByPhone ? "phone" : searchByEmail ? "email" : "name" });
  } catch (err) {
    console.error("Intent finder failed:", err.message);
    return res.status(500).json({ error: "Unable to search payments." });
  }
});

app.get("/api/intent-lookup/:kind/:id", requirePagePermission("/intent-lookup.html"), async (req, res) => {
  try {
    const kind = String(req.params.kind || "").toLowerCase();
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({
        error: "Intent ID is required."
      });
    }

    if (!["payment_intent", "setup_intent", "auto"].includes(kind)) {
      return res.status(400).json({
        error: "Kind must be payment_intent, setup_intent, or auto."
      });
    }

    const resolvedKind = kind === "auto"
      ? inferIntentKindFromId(id)
      : kind;

    if (!resolvedKind) {
      return res.status(400).json({
        error: "Could not determine whether this is a PaymentIntent or SetupIntent."
      });
    }

    if (resolvedKind === "payment_intent") {
      const links = await readLinks();
      const terminalPayments = await readTerminalPayments();
      const localLinkRow = links.find((row) => row.paymentIntentId === id) || null;
      const localRow =
        [
          ...links.map((row) => normalizeLinkRecord({ ...row })),
          ...terminalPayments
        ].find((row) => row.paymentIntentId === id) || null;
      const paymentIntent = await stripe.paymentIntents.retrieve(id, {
        expand: [
          "customer",
          "payment_method",
          "latest_charge.balance_transaction",
          "latest_charge.payment_method_details",
          "latest_charge.refunds.data.balance_transaction"
        ]
      });

      if (
        localLinkRow &&
        !getSucceededStripeChargeCreatedSec(paymentIntent) &&
        paymentIntent.latest_charge &&
        typeof paymentIntent.latest_charge === "object" &&
        paymentIntent.latest_charge.status === "failed" &&
        (localLinkRow.status === "paid" || localLinkRow.paidDate || Number(localLinkRow.paidAmount || 0) > 0)
      ) {
        applyFailedPaymentIntentState(localLinkRow, paymentIntent);
        localLinkRow.updatedAt = new Date().toISOString();
        await writeLinks(links);
      }

      return res.json(
        buildPaymentIntentLookupResponse(
          id,
          paymentIntent,
          localLinkRow ? normalizeLinkRecord({ ...localLinkRow }) : localRow
        )
      );
    }

    const serviceCards = await readServiceCards();
    const localRow = serviceCards.find((row) => row.setupIntentId === id) || null;
    const setupIntent = await stripe.setupIntents.retrieve(id, {
      expand: [
        "customer",
        "payment_method",
        "latest_attempt"
      ]
    });

    return res.json(
      buildSetupIntentLookupResponse(id, setupIntent, localRow)
    );
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to look up intent."
    });
  }
});

app.post("/api/events/fire-flavor/rsvp", async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const phoneDigits = phone.replace(/\D/g, "");
    const rawGuestCount = Number.parseInt(req.body?.guestCount, 10);
    const guestCount = Number.isFinite(rawGuestCount)
      ? Math.max(1, Math.min(12, rawGuestCount))
      : null;
    const attendeeType = String(req.body?.attendeeType || "").trim();
    const wantsEmailUpdates = Boolean(req.body?.wantsEmailUpdates);
    const wantsTextUpdates = Boolean(req.body?.wantsTextUpdates);
    const allowedAttendeeTypes = new Set(["Homeowner", "Builder", "Designer", "Outdoor Cooking Fan", "Other"]);

    if (!fullName) {
      return res.status(400).json({
        error: "Full name is required."
      });
    }

    if (wantsEmailUpdates && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({
        error: "A valid email address is required for email updates."
      });
    }

    if (wantsTextUpdates && !phone) {
      return res.status(400).json({
        error: "A phone number is required for text updates."
      });
    }

    if (wantsTextUpdates && phoneDigits.length !== 10) {
      return res.status(400).json({
        error: "A valid 10-digit phone number is required for text updates."
      });
    }

    if (!guestCount) {
      return res.status(400).json({
        error: "Please select how many people are attending."
      });
    }

    if (!allowedAttendeeTypes.has(attendeeType)) {
      return res.status(400).json({
        error: "Please choose the attendee type that fits you best."
      });
    }

    const rsvps = await readEventRsvps();
    const nowIso = new Date().toISOString();
    const existingIndex = rsvps.findIndex((entry) =>
      entry.eventSlug === "fire-and-flavor" &&
      (
        (email && String(entry.email || "").toLowerCase() === email) ||
        (!email && !String(entry.email || "").trim() && String(entry.fullName || "").trim().toLowerCase() === fullName.toLowerCase())
      )
    );

    const nextRecord = {
      id: existingIndex >= 0 ? rsvps[existingIndex].id : crypto.randomUUID(),
      eventSlug: "fire-and-flavor",
      eventName: "Fire & Flavor",
      fullName,
      email,
      phone,
      guestCount,
      attendeeType,
      wantsEmailUpdates,
      wantsTextUpdates,
      updatedAt: nowIso,
      createdAt: existingIndex >= 0 ? rsvps[existingIndex].createdAt : nowIso
    };

    if (existingIndex >= 0) {
      rsvps[existingIndex] = nextRecord;
    } else {
      rsvps.push(nextRecord);
    }

    await writeEventRsvps(rsvps);

    res.json({
      ok: true,
      message: existingIndex >= 0
        ? "Your RSVP has been updated. We look forward to seeing you."
        : "Thanks for your RSVP. We look forward to seeing you at Fire & Flavor."
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to submit RSVP."
    });
  }
});

app.get("/api/events/catalog", requirePagePermission("/event-rsvps.html"), async (req, res) => {
  try {
    const status = String(req.query.status || "all").trim().toLowerCase();
    const allowedStatuses = new Set(["all", "active", "archived"]);

    if (!allowedStatuses.has(status)) {
      return res.status(400).json({
        error: "status must be all, active, or archived."
      });
    }

    const [events, rsvps] = await Promise.all([
      readEventCatalog(),
      readEventRsvps()
    ]);

    const filteredEvents = status === "all"
      ? events
      : events.filter((event) => event.status === status);

    const countsBySlug = rsvps.reduce((acc, rsvp) => {
      const slug = String(rsvp.eventSlug || "").trim();
      if (!slug) {
        return acc;
      }

      if (!acc[slug]) {
        acc[slug] = {
          rsvpCount: 0,
          totalAttendees: 0,
          emailUpdatesCount: 0,
          textUpdatesCount: 0,
          latestRsvpAt: ""
        };
      }

      acc[slug].rsvpCount += 1;
      acc[slug].totalAttendees += Number(rsvp.guestCount || 0);
      acc[slug].emailUpdatesCount += rsvp.wantsEmailUpdates ? 1 : 0;
      acc[slug].textUpdatesCount += rsvp.wantsTextUpdates ? 1 : 0;

      const updatedAt = String(rsvp.updatedAt || rsvp.createdAt || "");
      if (updatedAt && updatedAt > acc[slug].latestRsvpAt) {
        acc[slug].latestRsvpAt = updatedAt;
      }

      return acc;
    }, {});

    res.json({
      events: filteredEvents.map((event) => ({
        ...event,
        stats: countsBySlug[event.slug] || {
          rsvpCount: 0,
          totalAttendees: 0,
          emailUpdatesCount: 0,
          textUpdatesCount: 0,
          latestRsvpAt: ""
        }
      }))
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load event catalog."
    });
  }
});

app.get("/api/events/rsvps", requirePagePermission("/event-rsvps.html"), async (req, res) => {
  try {
    const eventSlug = String(req.query.eventSlug || "").trim();
    const status = String(req.query.status || "all").trim().toLowerCase();
    const allowedStatuses = new Set(["all", "active", "archived"]);

    if (!allowedStatuses.has(status)) {
      return res.status(400).json({
        error: "status must be all, active, or archived."
      });
    }

    const [events, rsvps] = await Promise.all([
      readEventCatalog(),
      readEventRsvps()
    ]);

    const eventBySlug = new Map(events.map((event) => [event.slug, event]));
    const rows = rsvps
      .filter((rsvp) => {
        const slug = String(rsvp.eventSlug || "").trim();
        const event = eventBySlug.get(slug);
        if (!event) {
          return false;
        }

        if (status !== "all" && event.status !== status) {
          return false;
        }

        if (eventSlug && slug !== eventSlug) {
          return false;
        }

        return true;
      })
      .map((rsvp) => ({
        ...rsvp,
        eventName: eventBySlug.get(rsvp.eventSlug)?.name || rsvp.eventName || rsvp.eventSlug,
        eventStatus: eventBySlug.get(rsvp.eventSlug)?.status || "active"
      }))
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));

    res.json({ rows });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load event RSVPs."
    });
  }
});

app.post("/api/events/:slug/status", requirePagePermission("/event-rsvps.html"), async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const nextStatus = String(req.body?.status || "").trim().toLowerCase();

    if (!slug) {
      return res.status(400).json({
        error: "Event slug is required."
      });
    }

    if (!["active", "archived"].includes(nextStatus)) {
      return res.status(400).json({
        error: "status must be active or archived."
      });
    }

    const events = await readEventCatalog();
    const eventIndex = events.findIndex((event) => event.slug === slug);

    if (eventIndex < 0) {
      return res.status(404).json({
        error: "Event not found."
      });
    }

    events[eventIndex] = {
      ...events[eventIndex],
      status: nextStatus,
      updatedAt: new Date().toISOString()
    };

    await writeEventCatalog(events);

    res.json({
      ok: true,
      event: events[eventIndex]
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to update event status."
    });
  }
});

// Generic phrases that don't identify the product/service being refunded.
// The refund note must say WHAT was cancelled or returned, not just that the
// customer asked.
const GENERIC_REFUND_NOTES = /^(requested by( the)? customer|customer request(ed)?( it)?( a refund)?|per( the)? customer( request)?|customer( asked)?( for( a)? refund)?|refund( requested)?|return(ed)?|cancell?ed|cancellation|cancel|n\/?a|none|misc|other|test)[.!]*$/i;

function validateRefundNote(note) {
  const trimmed = String(note || "").trim();
  if (trimmed.length < 8 || GENERIC_REFUND_NOTES.test(trimmed)) {
    return 'Be specific about the product or service being refunded (e.g. "KDTS434SPS dishwasher returned" or "canceled HVAC maintenance visit").';
  }
  return null;
}

app.post("/api/intent-lookup/payment_intent/:id/refund", requirePagePermission("/intent-lookup.html"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestedAmount = req.body?.amount;
    const note = String(req.body?.note || "").trim();
    const requestedReason = String(req.body?.reason || "requested_by_customer").trim();
    const allowedReasons = new Set(["duplicate", "fraudulent", "requested_by_customer"]);

    if (!id) {
      return res.status(400).json({
        error: "PaymentIntent ID is required."
      });
    }

    // The irreversibility acknowledgement is required — refunds cannot be
    // pulled back, and re-collecting means paying card fees again.
    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        error: "Check the confirmation box acknowledging the refund cannot be reversed."
      });
    }

    const noteError = validateRefundNote(note);
    if (noteError) {
      return res.status(400).json({ error: noteError });
    }

    // Refunds no longer default to the full amount — the exact amount must
    // be entered deliberately.
    if (requestedAmount === undefined || requestedAmount === null || String(requestedAmount).trim() === "") {
      return res.status(400).json({
        error: "Enter the exact refund amount."
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(id, {
      expand: [
        "latest_charge",
        "latest_charge.balance_transaction",
        "latest_charge.refunds.data.balance_transaction"
      ]
    });

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        error: "Only succeeded PaymentIntents can be refunded from this page."
      });
    }

    const latestCharge = paymentIntent.latest_charge || null;
    if (!latestCharge?.id) {
      return res.status(400).json({
        error: "Stripe did not return a charge for this PaymentIntent."
      });
    }

    const remainingRefundableCents = getRemainingRefundableCents(paymentIntent);
    if (remainingRefundableCents <= 0) {
      return res.status(400).json({
        error: "This PaymentIntent has already been fully refunded."
      });
    }

    const parsedAmount = Number(requestedAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: "Refund amount must be greater than zero."
      });
    }

    const refundAmountCents = Math.round(parsedAmount * 100);
    if (refundAmountCents <= 0 || refundAmountCents > remainingRefundableCents) {
      return res.status(400).json({
        error: `Refund amount cannot exceed ${formatUsdFromCents(remainingRefundableCents)}.`
      });
    }

    const refundConfig = {
      payment_intent: id,
      ...(refundAmountCents === remainingRefundableCents ? {} : { amount: refundAmountCents }),
      reason: allowedReasons.has(requestedReason) ? requestedReason : "requested_by_customer",
      metadata: {
        refund_note: note.slice(0, 480),
        refunded_by: String(req.authUser?.email || req.authUser?.username || "")
      }
    };

    const refund = await stripe.refunds.create(refundConfig, {
      idempotencyKey: createStripeIdempotencyKeyFromPayload("refund", refundConfig)
    });

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser?.id || null,
      action: "refund_issued",
      targetUserId: null,
      detail: { paymentIntentId: id, amount: refundAmountCents / 100, note: note.slice(0, 200) }
    }).catch(() => {});

    return res.json({
      ok: true,
      refundId: refund.id,
      amount: Number((refund.amount || 0) / 100),
      status: refund.status || "pending"
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || "Unable to issue refund."
    });
  }
});

function resolvePaidOrderFields(row) {
  const rawSalesOrder = String(row.salesOrder || "").trim();
  const rawDescription = String(row.description || "").trim();
  const rawReference = String(row.reference || "").trim();

  if (rawSalesOrder) {
    return {
      salesOrder: rawSalesOrder,
      description: rawDescription || (rawReference && rawReference !== rawSalesOrder ? rawReference : "")
    };
  }

  if (rawReference && rawDescription && rawReference !== rawDescription) {
    return {
      salesOrder: rawReference,
      description: rawDescription
    };
  }

  if (looksLikeSalesOrder(rawReference)) {
    return {
      salesOrder: rawReference,
      description: rawDescription && rawDescription !== rawReference ? rawDescription : ""
    };
  }

  if (looksLikeSalesOrder(rawDescription)) {
    return {
      salesOrder: rawDescription,
      description: rawReference && rawReference !== rawDescription ? rawReference : ""
    };
  }

  return {
    salesOrder: "",
    description: rawDescription || rawReference || ""
  };
}

function looksLikeSalesOrder(value) {
  return /^[A-Z]*\d{5,}$/i.test(String(value || "").trim());
}

function inferIntentKindFromId(id) {
  if (/^pi_/i.test(id)) {
    return "payment_intent";
  }

  if (/^seti_/i.test(id)) {
    return "setup_intent";
  }

  return "";
}

function buildPaymentIntentLookupResponse(id, paymentIntent, localRow) {
  const latestCharge = paymentIntent.latest_charge || null;
  const balanceTransaction = latestCharge?.balance_transaction || null;
  const refunds = Array.isArray(latestCharge?.refunds?.data) ? latestCharge.refunds.data : [];
  const succeededChargeCreatedSec = getSucceededStripeChargeCreatedSec(paymentIntent);
  const isSucceededPayment = Boolean(succeededChargeCreatedSec);
  const metadata = paymentIntent.metadata || {};
  const resolvedFields = resolvePaidOrderFields(localRow || {});
  const paymentMethodType =
    paymentIntent.payment_method_types?.[0] ||
    latestCharge?.payment_method_details?.type ||
    paymentIntent.payment_method?.type ||
    "";
  const sentAmount =
    typeof localRow?.requestedAmount === "number"
      ? localRow.requestedAmount
      : Number((paymentIntent.amount || 0) / 100);
  const paidAmount =
    isSucceededPayment
      ? Number((paymentIntent.amount_received || latestCharge?.amount || 0) / 100)
      : 0;
  const refundedAmount = Number(
    refunds.reduce((sum, refund) => sum + Number(refund?.amount || 0), 0) / 100
  );
  const refundableAmount = Number(getRemainingRefundableCents(paymentIntent) / 100);

  const events = [];

  if (localRow?.createdAt) {
    events.push({
      date: localRow.createdAt,
      label: "Sent",
      amount: sentAmount,
      reason: resolvedFields.description || paymentIntent.description || "Payment request created"
    });
  }

  if (localRow?.deactivatedAt) {
    events.push({
      date: localRow.deactivatedAt,
      label: "Deactivated",
      amount: 0,
      reason: localRow.deactivationReason || "Payment link deactivated"
    });
  }

  if (isSucceededPayment) {
    events.push({
      date: localRow?.paidDate || new Date(succeededChargeCreatedSec * 1000).toISOString(),
      label: "Paid",
      amount: paidAmount,
      reason: describePaymentMethod(paymentMethodType, paymentIntent.payment_method || latestCharge?.payment_method_details)
    });
  }

  if (!isSucceededPayment && latestCharge?.status === "failed") {
    events.push({
      date: latestCharge.created ? new Date(latestCharge.created * 1000).toISOString() : new Date(paymentIntent.created * 1000).toISOString(),
      label: "Failed",
      amount: 0,
      reason: latestCharge.failure_message || latestCharge.failure_code || "Stripe payment failed"
    });
  }

  for (const refund of refunds) {
    events.push({
      date: new Date(refund.created * 1000).toISOString(),
      label: "Refund",
      amount: -Number((refund.amount || 0) / 100),
      reason: formatRefundReason(refund.reason) || "Refund created"
    });
  }

  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const customerMessage = !isSucceededPayment && latestCharge?.status === "failed"
    ? buildPaymentFailureCustomerMessage({
        summary: {
          customerName: localRow?.customerName || metadata.customer_name || paymentIntent.customer?.name || "",
          salesOrder: resolvedFields.salesOrder || metadata.sales_order || "",
          requestedAmount: sentAmount,
          paymentMethod: describePaymentMethod(paymentMethodType, paymentIntent.payment_method || latestCharge?.payment_method_details)
        },
        failureReason: latestCharge.failure_message || latestCharge.failure_code || ""
      })
    : "";

  return {
    kind: "payment_intent",
    id,
    summary: {
      employeeName: localRow?.creatorName || metadata.creator_name || "-",
      customerName: localRow?.customerName || metadata.customer_name || paymentIntent.customer?.name || "-",
      customerEmail: localRow?.customerEmail || metadata.customer_email || paymentIntent.customer?.email || "-",
      customerPhone: localRow?.customerPhone || metadata.customer_phone || paymentIntent.customer?.phone || "-",
      salesOrder: resolvedFields.salesOrder || metadata.sales_order || "-",
      description: resolvedFields.description || metadata.link_description || metadata.description || paymentIntent.description || "-",
      intentStatus: paymentIntent.status || "-",
      type: localRow?.type || (paymentMethodType === "us_bank_account" ? "ach_link" : "card_link"),
      paymentMethod: describePaymentMethod(paymentMethodType, paymentIntent.payment_method || latestCharge?.payment_method_details),
      sentDate: localRow?.createdAt || "",
      paidDate: isSucceededPayment ? (localRow?.paidDate || new Date(succeededChargeCreatedSec * 1000).toISOString()) : "",
      requestedAmount: sentAmount,
      paidAmount,
      refundedAmount,
      refundableAmount,
      feeAmount: isSucceededPayment ? Number((balanceTransaction?.fee || 0) / 100) : 0,
      netAmount: isSucceededPayment
        ? Number(
            typeof balanceTransaction?.net === "number"
              ? balanceTransaction.net / 100
              : paidAmount - Number((balanceTransaction?.fee || 0) / 100)
          )
        : 0,
      notes: localRow?.notes || metadata.notes || "",
      deactivationReason: localRow?.deactivationReason || "",
      customerId: paymentIntent.customer?.id || "",
      paymentMethodId: paymentIntent.payment_method?.id || ""
    },
    events,
    customerMessage
  };
}

function buildPaymentFailureCustomerMessage({ summary, failureReason }) {
  const customerFirstName = String(summary.customerName || "").trim().split(/\s+/)[0] || "there";
  const orderText = summary.salesOrder ? ` for order ${summary.salesOrder}` : "";
  const amountText = Number(summary.requestedAmount || 0) > 0
    ? ` of ${formatUsdFromCents(Math.round(Number(summary.requestedAmount || 0) * 100))}`
    : "";
  const normalizedFailure = String(failureReason || "").toLowerCase();
  const isMicrodepositTimeout =
    normalizedFailure.includes("microdeposit") ||
    normalizedFailure.includes("verification") ||
    normalizedFailure.includes("timed out");

  if (isMicrodepositTimeout) {
    return [
      `Hi ${customerFirstName}, this is Wilson AC & Appliance. We received a notice that your ACH bank payment${amountText}${orderText} did not complete because the bank account verification was not finished in time.`,
      "No funds were collected, and there is no completed payment to refund.",
      "To move forward, please use a new payment link and either complete the bank verification steps right away or choose a card payment instead. If you already see anything unusual at your bank, send us a screenshot and we will help review it."
    ].join("\n\n");
  }

  return [
    `Hi ${customerFirstName}, this is Wilson AC & Appliance. We received a notice that your payment${amountText}${orderText} did not complete.`,
    "No funds were collected, and there is no completed payment to refund.",
    "To move forward, please use a new payment link or contact us so we can help you try another payment method."
  ].join("\n\n");
}

function buildSetupIntentLookupResponse(id, setupIntent, localRow) {
  const metadata = setupIntent.metadata || {};
  const paymentMethod = setupIntent.payment_method || null;
  const events = [];
  const createdIso = new Date(setupIntent.created * 1000).toISOString();

  events.push({
    date: localRow?.createdAt || createdIso,
    label: "Setup requested",
    amount: 0,
    reason: "Customer authorization to save card"
  });

  if (setupIntent.status === "succeeded") {
    events.push({
      date: localRow?.updatedAt || createdIso,
      label: "Card saved",
      amount: 0,
      reason: describePaymentMethod(paymentMethod?.type || "card", paymentMethod)
    });
  }

  if (localRow?.queueStatus) {
    events.push({
      date: localRow.updatedAt || createdIso,
      label: localRow.queueStatus,
      amount: 0,
      reason: localRow.queueStatusNotes || "Service queue status updated"
    });
  }

  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  return {
    kind: "setup_intent",
    id,
    summary: {
      employeeName: "-",
      customerName: localRow?.customerName || metadata.customer_name || setupIntent.customer?.name || "-",
      customerEmail: localRow?.customerEmail || metadata.customer_email || setupIntent.customer?.email || "-",
      customerPhone: localRow?.customerPhone || metadata.customer_phone || setupIntent.customer?.phone || "-",
      salesOrder: localRow?.erpOrderNumber || "-",
      description: localRow?.problemDescription || describeUnits(localRow?.units) || "Saved card on file",
      intentStatus: setupIntent.status || "-",
      type: "setup_intent",
      paymentMethod: describePaymentMethod(paymentMethod?.type || "card", paymentMethod),
      sentDate: localRow?.createdAt || createdIso,
      paidDate: "",
      requestedAmount: 0,
      paidAmount: 0,
      feeAmount: 0,
      netAmount: 0,
      notes: localRow?.queueStatusNotes || "",
      deactivationReason: "",
      customerId: setupIntent.customer?.id || localRow?.customerId || "",
      paymentMethodId: paymentMethod?.id || localRow?.paymentMethodId || "",
      queueStatus: localRow?.queueStatus || "-",
      cardBrand: localRow?.cardBrand || paymentMethod?.card?.brand || "",
      last4: localRow?.last4 || paymentMethod?.card?.last4 || ""
    },
    events
  };
}

function describePaymentMethod(type, paymentMethod) {
  const normalizedType = String(type || paymentMethod?.type || "").toLowerCase();

  if (normalizedType === "us_bank_account") {
    const last4 = paymentMethod?.us_bank_account?.last4 || "";
    return last4 ? `ACH bank account ending in ${last4}` : "ACH bank account";
  }

  if (normalizedType === "card" || normalizedType === "card_present") {
    const cardSource = paymentMethod?.card || paymentMethod?.card_present || {};
    const brand = cardSource.brand || "Card";
    const last4 = cardSource.last4 || "";
    return last4 ? `${brand} ending in ${last4}` : brand;
  }

  return normalizedType ? normalizedType.replace(/_/g, " ") : "-";
}

function formatRefundReason(reason) {
  if (!reason) return "";

  return String(reason)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRemainingRefundableCents(paymentIntent) {
  const latestCharge = paymentIntent?.latest_charge || null;
  if (
    paymentIntent?.status !== "succeeded" ||
    !latestCharge ||
    typeof latestCharge !== "object" ||
    latestCharge.status !== "succeeded" ||
    latestCharge.paid !== true
  ) {
    return 0;
  }

  const grossAmount = Number(latestCharge.amount || paymentIntent?.amount_received || 0);
  const refundedAmount = Number(latestCharge.amount_refunded || 0);
  return Math.max(0, grossAmount - refundedAmount);
}

function formatUsdFromCents(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(cents || 0) / 100);
}

function describeUnits(units) {
  if (!Array.isArray(units) || !units.length) {
    return "";
  }

  return units
    .map((unit) => [unit?.brand, unit?.applianceType].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

function normalizeDepositDepartment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hvac" || normalized === "hvac_deposit") return "hvac";
  if (normalized === "sales") return "sales";
  if (normalized === "service") return "service";
  if (normalized === "appliance") return "appliance";
  return normalized || "appliance";
}

function getDepositAgreementIdFromLink(row) {
  return row.depositAgreementId || `dep_${row.id || row.paymentLinkId || Date.now()}`;
}

function buildDepositAgreementFromLink(row) {
  const createdAt = row.createdAt || new Date().toISOString();
  const department = normalizeDepositDepartment(row.department || row.workflowType);
  const depositAmount = Number(row.depositAmount || row.requestedAmount || 0);
  const balanceAmount = Number(row.balanceAmount || 0);
  const balancePaidAmount = Number(row.balancePaidAmount || 0);
  const status = row.balanceCanceledAt
    ? "canceled"
    : row.balanceChargedAt || balancePaidAmount > 0
      ? "completed"
      : row.status === "paid"
        ? "open_balance"
        : "pending_deposit";

  return {
    id: getDepositAgreementIdFromLink(row),
    source: "payment_link",
    sourceRecordId: row.id || "",
    department,
    createdAt,
    updatedAt: row.updatedAt || createdAt,
    customerName: row.customerName || "",
    customerEmail: row.customerEmail || "",
    customerPhone: row.customerPhone || "",
    creatorCode: row.creatorCode || "",
    creatorName: row.creatorName || "",
    creatorEmail: row.creatorEmail || "",
    salesOrder: row.salesOrder || "",
    description: row.description || "",
    notes: row.notes || "",
    currency: row.currency || "usd",
    totalAmount: Number(row.requestedTotalAmount || row.requestedAmount || depositAmount + balanceAmount || 0),
    depositAmount,
    balanceAmount,
    balancePaidAmount,
    status,
    depositPaidAt: row.paidDate || "",
    depositPaymentIntentId: row.paymentIntentId || "",
    balanceChargedAt: row.balanceChargedAt || "",
    balancePaymentIntentId: row.balancePaymentIntentId || "",
    balanceCanceledAt: row.balanceCanceledAt || "",
    balanceCancellationReason: row.balanceCancellationReason || "",
    customerId: row.customerId || "",
    paymentMethodId: row.paymentMethodId || "",
    agreementText: row.agreementText || ""
  };
}

async function syncDepositAgreementsFromLinks(links = null) {
  const sourceLinks = links || await readLinks();
  const agreements = await readDepositAgreements();
  const agreementById = new Map(agreements.map((agreement) => [agreement.id, agreement]));
  let didChange = false;

  for (const rawRow of sourceLinks) {
    const row = normalizeLinkRecord(rawRow);
    if (row.workflowType !== "hvac_deposit") continue;

    const agreement = buildDepositAgreementFromLink(row);
    row.depositAgreementId = agreement.id;
    const existing = agreementById.get(agreement.id);
    agreementById.set(agreement.id, { ...(existing || {}), ...agreement });
    if (row.status === "paid" && row.paymentIntentId && row.paidDate) {
      await appendDepositPaymentEvent({
        depositAgreementId: agreement.id,
        eventType: "deposit_collected",
        source: "payment_link",
        department: agreement.department,
        salesOrder: agreement.salesOrder,
        customerName: agreement.customerName,
        approvedAt: row.paidDate,
        paymentIntentId: row.paymentIntentId,
        amount: Number(row.paidAmount || agreement.depositAmount || 0),
        currency: agreement.currency,
        reportType: "sale"
      });
    }
    if (row.balancePaymentIntentId && row.balanceChargedAt) {
      await appendDepositPaymentEvent({
        depositAgreementId: agreement.id,
        eventType: "balance_charged",
        source: "card_on_file",
        department: agreement.department,
        salesOrder: agreement.salesOrder,
        customerName: agreement.customerName,
        approvedAt: row.balanceChargedAt,
        paymentIntentId: row.balancePaymentIntentId,
        amount: Number(row.balancePaidAmount || agreement.balanceAmount || 0),
        currency: agreement.currency,
        reportType: "sale"
      });
    }
    didChange = true;
  }

  if (didChange) {
    await writeDepositAgreements(
      Array.from(agreementById.values()).sort((a, b) =>
        String(b.depositPaidAt || b.createdAt || "").localeCompare(String(a.depositPaidAt || a.createdAt || ""))
      )
    );
  }

  return Array.from(agreementById.values());
}

async function upsertDepositAgreement(agreement) {
  const agreements = await readDepositAgreements();
  const index = agreements.findIndex((row) => row.id === agreement.id);
  const nextAgreement = {
    ...(index >= 0 ? agreements[index] : {}),
    ...agreement,
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) {
    agreements[index] = nextAgreement;
  } else {
    agreements.unshift(nextAgreement);
  }

  await writeDepositAgreements(agreements);
  return nextAgreement;
}

async function appendDepositPaymentEvent(event) {
  const events = await readDepositPaymentEvents();
  const paymentIntentId = String(event.paymentIntentId || "").trim();
  const eventType = String(event.eventType || "").trim();
  const alreadyExists = paymentIntentId && events.some((row) =>
    row.paymentIntentId === paymentIntentId && row.eventType === eventType
  );

  if (alreadyExists) {
    return events.find((row) => row.paymentIntentId === paymentIntentId && row.eventType === eventType);
  }

  const nextEvent = {
    id: `dpe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...event
  };
  events.unshift(nextEvent);
  await writeDepositPaymentEvents(events);
  return nextEvent;
}

async function recordDepositCollectedFromLink(row) {
  if (normalizeLinkRecord(row).workflowType !== "hvac_deposit" || row.status !== "paid") {
    return null;
  }

  const agreement = buildDepositAgreementFromLink(row);
  await upsertDepositAgreement(agreement);
  return appendDepositPaymentEvent({
    depositAgreementId: agreement.id,
    eventType: "deposit_collected",
    source: "payment_link",
    department: agreement.department,
    salesOrder: agreement.salesOrder,
    customerName: agreement.customerName,
    approvedAt: row.paidDate || "",
    paymentIntentId: row.paymentIntentId || "",
    amount: Number(row.paidAmount || agreement.depositAmount || 0),
    currency: agreement.currency,
    reportType: "sale"
  });
}

async function getSaleRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId) {
  const saleRows = [];
  const paymentIntentCache = new Map();
  let startingAfter = "";
  let keepLoading = true;
  const startUnix = dateKeyToUnixStart(addDaysToDateKey(start, -1));
  const endUnix = dateKeyToUnixEnd(addDaysToDateKey(end, 1));

  while (keepLoading) {
    const page = await listChargesWithRetry({
      limit: 100,
      created: {
        gte: startUnix,
        lte: endUnix
      },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.balance_transaction"]
    });

    if (!page.data.length) {
      break;
    }

    for (const charge of page.data) {
      if (!charge?.paid || charge?.status !== "succeeded") {
        continue;
      }

      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id || "";
      const sourceRow = paidSourceRowsByPaymentIntentId.get(paymentIntentId) || null;
      const paidIso = getSaleReportDateIso(charge, sourceRow);
      const paidDateOnly = toTimeZoneDateKey(paidIso, APP_TIMEZONE);

      if (!paidDateOnly || paidDateOnly < start || paidDateOnly > end) {
        continue;
      }

      const paymentIntent = paymentIntentId
        ? await getCachedPaymentIntent(paymentIntentId, paymentIntentCache)
        : null;

      saleRows.push(buildSaleReportRow(charge, paidIso, sourceRow, paymentIntent));

      if (paymentIntentId) {
        await sleep(120);
      }
    }

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }
  }

  return saleRows;
}

async function getLocalFallbackSaleRowsForDateRange(start, end, sourceRows, existingRows = []) {
  const existingPaymentIntentIds = new Set(
    existingRows
      .filter((row) => row.type === "sale" && row.paymentIntentId)
      .map((row) => row.paymentIntentId)
  );

  // Dedupe within local sources so a PI in both payment_links and
  // terminal-payments only produces one fallback row.
  const seenPaymentIntentIds = new Set();
  const fallbackRows = [];
  for (const row of sourceRows) {
    const paidDateOnly = toTimeZoneDateKey(row.paidDate, APP_TIMEZONE);
    if (
      row.status !== "paid" ||
      !row.paymentIntentId ||
      !paidDateOnly ||
      paidDateOnly < start ||
      paidDateOnly > end ||
      existingPaymentIntentIds.has(row.paymentIntentId) ||
      seenPaymentIntentIds.has(row.paymentIntentId)
    ) {
      continue;
    }
    seenPaymentIntentIds.add(row.paymentIntentId);
    fallbackRows.push(row);
  }

  const detailedFallbackRows = [];

  for (const row of fallbackRows) {
    const resolvedFields = resolvePaidOrderFields(row);
    const paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(row.paymentIntentId);
    if (!getSucceededStripeChargeCreatedSec(paymentIntent)) {
      await sleep(120);
      continue;
    }
    const stripeAmounts = await getStripeAmountsForPaymentIntentWithRetry(row.paymentIntentId);

    detailedFallbackRows.push({
      id: row.id || row.paymentIntentId || "",
      type: "sale",
      paidDate: row.paidDate || "",
      salesOrder: resolvedFields.salesOrder,
      customerName: row.customerName || "",
      description: resolvedFields.description,
      paymentIntentId: row.paymentIntentId || "",
      paidAmount: stripeAmounts.grossAmount,
      feeAmount: stripeAmounts.feeAmount,
      netAmount: stripeAmounts.netAmount
    });

    await sleep(120);
  }

  return detailedFallbackRows;
}

function getSucceededStripeChargeCreatedSec(paymentIntent) {
  const latestCharge = paymentIntent?.latest_charge;
  if (
    paymentIntent?.status !== "succeeded" ||
    !latestCharge ||
    typeof latestCharge !== "object" ||
    latestCharge.status !== "succeeded" ||
    latestCharge.paid !== true ||
    !latestCharge.created
  ) {
    return null;
  }

  return latestCharge.created;
}

async function getRefundRowsForDateRange(start, end, paidSourceRowsByPaymentIntentId) {
  const refundRows = [];
  let startingAfter = "";
  let keepLoading = true;

  while (keepLoading) {
    const page = await stripe.refunds.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.balance_transaction"]
    });

    if (!page.data.length) {
      break;
    }

    for (const refund of page.data) {
      if (!refund?.created) {
        continue;
      }

      const refundIso = new Date(refund.created * 1000).toISOString();
      const refundDateKey = toTimeZoneDateKey(refundIso, APP_TIMEZONE);

      if (refundDateKey < start) {
        keepLoading = false;
        break;
      }

      if (refundDateKey > end) {
        continue;
      }

      if (["failed", "canceled"].includes(refund.status)) {
        continue;
      }

      const sourceRow = paidSourceRowsByPaymentIntentId.get(refund.payment_intent || "") || null;
      const paymentIntent = refund.payment_intent
        ? await retrievePaymentIntentWithDetails(refund.payment_intent)
        : null;

      refundRows.push(buildRefundReportRow(refund, refundIso, sourceRow, paymentIntent));

      if (refund.payment_intent) {
        await sleep(120);
      }
    }

    if (!page.has_more || !keepLoading) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }
  }

  return refundRows;
}

async function listAutomaticPayoutsByArrivalDate(start, end) {
  const payouts = [];
  let startingAfter = "";

  const startUnix = dateKeyToUnixStart(start);
  const endUnix = dateKeyToUnixEnd(end);

  while (true) {
    const page = await listPayoutsWithRetry({
      limit: 100,
      status: "paid",
      arrival_date: {
        gte: startUnix,
        lte: endUnix
      },
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    if (!page.data.length) {
      break;
    }

    payouts.push(
      ...page.data.filter((payout) => payout.automatic !== false)
    );

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }

    await sleep(120);
  }

  return payouts;
}

async function getBankBalancingRowsForPayout(payout, sourceRowsByPaymentIntentId) {
  const rows = [];
  let startingAfter = "";
  const chargeCache = new Map();
  const paymentIntentCache = new Map();

  while (true) {
    const page = await listBalanceTransactionsForPayoutWithRetry(payout.id, startingAfter);

    if (!page.data.length) {
      break;
    }

    for (const transaction of page.data) {
      const row = await buildBankBalancingRow(
        payout,
        transaction,
        sourceRowsByPaymentIntentId,
        chargeCache,
        paymentIntentCache
      );

      if (row) {
        rows.push(row);
      }

      await sleep(120);
    }

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) {
      break;
    }
  }

  return rows;
}

async function buildBankBalancingRow(
  payout,
  transaction,
  sourceRowsByPaymentIntentId,
  chargeCache,
  paymentIntentCache
) {
  const paymentIntentId = await inferPaymentIntentIdFromBalanceTransaction(transaction, chargeCache);

  if (!paymentIntentId) {
    return null;
  }

  const sourceRow = sourceRowsByPaymentIntentId.get(paymentIntentId) || null;
  const resolvedFields = resolvePaidOrderFields(sourceRow || {});
  const shouldLoadPaymentIntent =
    !sourceRow ||
    !resolvedFields.salesOrder ||
    !resolvedFields.description ||
    !String(sourceRow.customerName || "").trim();
  const paymentIntent = shouldLoadPaymentIntent
    ? await getCachedPaymentIntent(paymentIntentId, paymentIntentCache)
    : null;
  const paymentIntentMetadata = paymentIntent?.metadata || {};
  const sourceObject = transaction.source && typeof transaction.source === "object"
    ? transaction.source
    : null;
  const fallbackCustomerName =
    String(paymentIntentMetadata.customer_name || "").trim() ||
    String(sourceObject?.billing_details?.name || "").trim() ||
    "";
  const fallbackDescription = String(
    paymentIntentMetadata.link_description ||
    paymentIntentMetadata.description ||
    paymentIntent?.description ||
    sourceObject?.description ||
    ""
  ).trim();
  const transactionType = inferBankBalancingType(transaction, sourceObject);

  return {
    id: transaction.id,
    payoutId: payout.id,
    arrivalDateKey: getPayoutArrivalDateKey(payout),
    payoutAmount: Number((payout.amount || 0) / 100),
    paymentIntentId,
    type: transactionType,
    balanceTransactionType: String(transaction?.type || "").toLowerCase(),
    balanceTransactionDescription: String(transaction?.description || "").trim(),
    salesOrder: resolvedFields.salesOrder || String(paymentIntentMetadata.sales_order || "").trim(),
    customerName: sourceRow?.customerName || fallbackCustomerName || "-",
    description: resolvedFields.description || fallbackDescription || "-",
    grossAmount: Number((transaction.amount || 0) / 100),
    feeAmount: Number((transaction.fee || 0) / 100),
    bankPayoutAmount: Number((transaction.net || 0) / 100)
  };
}

// Maps Stripe's balance transaction `type` to one of our accounting
// buckets. The previous version returned "sale" for everything except
// explicit refunds — including reserve releases, adjustments, and Stripe
// fee corrections — which is why some May invoices appeared as duplicate
// June "deposits" in the report. See:
// https://docs.stripe.com/api/balance_transactions/object#balance_transaction_object-type
function inferBankBalancingType(transaction, sourceObject) {
  const stripeType = String(transaction?.type || "").toLowerCase();

  switch (stripeType) {
    case "charge":
    case "payment":
      return "sale";
    case "refund":
    case "payment_refund":
    case "payment_failure_refund":
      return "refund";
    case "adjustment":
      return "adjustment";
    case "reserve_transaction":
    case "reserved_funds":
      return "reserve";
    case "payout":
    case "payout_failure":
    case "payout_cancel":
      return "payout";
    case "stripe_fee":
    case "application_fee":
    case "application_fee_refund":
      return "fee";
    case "transfer":
    case "transfer_cancel":
    case "transfer_failure":
    case "transfer_refund":
      return "transfer";
    case "issuing_authorization_hold":
    case "issuing_authorization_release":
    case "issuing_transaction":
    case "issuing_dispute":
      return "issuing";
    default:
      // Fallback only if Stripe's type is missing/unknown. Use source
      // object shape as a last-resort hint.
      if (sourceObject?.object === "refund") return "refund";
      if (sourceObject?.object === "charge") return "sale";
      return "other";
  }
}

async function inferPaymentIntentIdFromBalanceTransaction(transaction, chargeCache) {
  const sourceObject = transaction.source && typeof transaction.source === "object"
    ? transaction.source
    : null;

  if (!sourceObject) {
    return "";
  }

  if (sourceObject.object === "payment_intent") {
    return sourceObject.id || "";
  }

  if (sourceObject.object === "charge") {
    if (typeof sourceObject.payment_intent === "string") {
      return sourceObject.payment_intent;
    }

    const fullCharge = await getCachedCharge(sourceObject.id || "", chargeCache);
    return typeof fullCharge?.payment_intent === "string" ? fullCharge.payment_intent : "";
  }

  if (sourceObject.object === "refund") {
    if (typeof sourceObject.payment_intent === "string") {
      return sourceObject.payment_intent;
    }

    if (typeof sourceObject.charge === "string") {
      const refundCharge = await getCachedCharge(sourceObject.charge, chargeCache);
      return typeof refundCharge?.payment_intent === "string" ? refundCharge.payment_intent : "";
    }
  }

  return "";
}

async function getCachedPaymentIntent(paymentIntentId, paymentIntentCache) {
  if (!paymentIntentId) {
    return null;
  }

  if (paymentIntentCache.has(paymentIntentId)) {
    return paymentIntentCache.get(paymentIntentId);
  }

  const paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(paymentIntentId);
  paymentIntentCache.set(paymentIntentId, paymentIntent);
  return paymentIntent;
}

async function getCachedCharge(chargeId, chargeCache) {
  if (!chargeId) {
    return null;
  }

  if (chargeCache.has(chargeId)) {
    return chargeCache.get(chargeId);
  }

  const charge = await retrieveChargeWithRetry(chargeId);
  chargeCache.set(chargeId, charge);
  return charge;
}

function dateKeyToUnixStart(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 1000);
}

function dateKeyToUnixEnd(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T23:59:59Z`) / 1000);
}

function addDaysToDateKey(dateKey, dayDelta) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);

  if (!year || !month || !day) {
    return dateKey;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(dayDelta || 0));
  return date.toISOString().slice(0, 10);
}

function unixDateToDateKey(unixValue) {
  if (!unixValue) return "";

  return new Date(unixValue * 1000).toISOString().slice(0, 10);
}

function getPayoutArrivalDateKey(payout) {
  return unixDateToDateKey(payout?.arrival_date || payout?.created);
}

function buildIncomingPayoutRow(payout) {
  const balanceTransaction =
    payout?.balance_transaction && typeof payout.balance_transaction === "object"
      ? payout.balance_transaction
      : null;

  return {
    id: payout.id || "",
    status: payout.status || "",
    amount: Number((payout.amount || 0) / 100),
    currency: payout.currency || "usd",
    arrivalDateKey: getPayoutArrivalDateKey(payout),
    arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : "",
    createdAt: payout.created ? new Date(payout.created * 1000).toISOString() : "",
    automatic: Boolean(payout.automatic),
    method: payout.method || "",
    type: payout.type || "",
    sourceType: payout.source_type || "",
    description: payout.description || "",
    destination:
      typeof payout.destination === "string"
        ? payout.destination
        : payout.destination?.id || "",
    balanceTransactionId:
      typeof payout.balance_transaction === "string"
        ? payout.balance_transaction
        : balanceTransaction?.id || "",
    reconciliationStatus: payout.reconciliation_status || "",
    traceIdStatus: payout.trace_id?.status || "",
    traceId: payout.trace_id?.value || ""
  };
}

async function listPayoutsByArrivalDate(start, end) {
  const payouts = [];
  let startingAfter = "";
  const startUnix = dateKeyToUnixStart(start);
  const endUnix = dateKeyToUnixEnd(end);

  while (true) {
    const page = await listPayoutsWithRetry({
      limit: 100,
      arrival_date: {
        gte: startUnix,
        lte: endUnix
      },
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    payouts.push(...page.data);

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) break;
  }

  return payouts;
}

async function listPendingBalanceTransactionsByAvailableDate(startUnix, endUnix) {
  const rows = [];
  let startingAfter = "";

  while (true) {
    const page = await stripe.balanceTransactions.list({
      limit: 100,
      available_on: {
        gte: startUnix,
        lte: endUnix
      },
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    rows.push(...page.data.filter((transaction) =>
      transaction.status === "pending" &&
      Number(transaction.net || 0) > 0
    ));

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id || "";
    if (!startingAfter) break;
  }

  return rows;
}

function buildPendingAvailabilityBuckets(transactions) {
  const buckets = new Map();

  for (const transaction of transactions) {
    const key = unixDateToDateKey(transaction.available_on);
    if (!key) continue;

    const bucket = buckets.get(key) || {
      availableOnDateKey: key,
      transactionCount: 0,
      grossAmount: 0,
      feeAmount: 0,
      netAmount: 0,
      currency: transaction.currency || "usd",
      typeCounts: {}
    };

    bucket.transactionCount += 1;
    bucket.grossAmount += Number((transaction.amount || 0) / 100);
    bucket.feeAmount += Number((transaction.fee || 0) / 100);
    bucket.netAmount += Number((transaction.net || 0) / 100);
    const type = String(transaction.type || "unknown");
    bucket.typeCounts[type] = (bucket.typeCounts[type] || 0) + 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values());
}

function normalizeStripeBalanceEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    amount: Number((entry.amount || 0) / 100),
    currency: entry.currency || "usd",
    sourceTypes: entry.source_types || {}
  }));
}

function sumStripeBalanceEntries(entries) {
  return normalizeStripeBalanceEntries(entries).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function isDateKeyWithinRange(dateKey, startKey, endKey) {
  if (!dateKey || !startKey || !endKey) {
    return false;
  }

  return dateKey >= startKey && dateKey <= endKey;
}

function buildSaleReportRow(charge, paidIso, sourceRow, paymentIntent) {
  const paymentIntentMetadata = paymentIntent?.metadata || {};
  const chargeBalanceTransaction = charge?.balance_transaction || null;
  const fallbackFields = resolvePaidOrderFields(sourceRow || {});
  const salesOrder =
    fallbackFields.salesOrder ||
    String(paymentIntentMetadata.sales_order || charge.metadata?.sales_order || "").trim();
  const description =
    fallbackFields.description ||
    String(
      paymentIntentMetadata.link_description ||
      paymentIntentMetadata.description ||
      charge.metadata?.description ||
      charge.description ||
      ""
    ).trim();
  const customerName =
    sourceRow?.customerName ||
    String(paymentIntentMetadata.customer_name || "").trim() ||
    String(charge.billing_details?.name || "").trim() ||
    "-";

  return {
    id: charge.id,
    type: "sale",
    paidDate: paidIso,
    salesOrder,
    customerName,
    description,
    paymentIntentId:
      (typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id) ||
      sourceRow?.paymentIntentId ||
      "",
    paidAmount: Number((charge.amount || 0) / 100),
    feeAmount: Number(
      typeof chargeBalanceTransaction?.fee === "number"
        ? chargeBalanceTransaction.fee / 100
        : 0
    ),
    netAmount: Number(
      typeof chargeBalanceTransaction?.net === "number"
        ? chargeBalanceTransaction.net / 100
        : Number((charge.amount || 0) / 100)
    )
  };
}

function hasUsBankAccountPayment(sourceRow = null, paymentIntent = null, charge = null, session = null) {
  const latestCharge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === "object"
      ? paymentIntent.latest_charge
      : null;

  return Boolean(
    paymentIntent?.payment_method_types?.includes("us_bank_account") ||
    paymentIntent?.payment_method?.type === "us_bank_account" ||
    latestCharge?.payment_method_details?.type === "us_bank_account" ||
    charge?.payment_method_details?.type === "us_bank_account" ||
    session?.payment_method_types?.includes("us_bank_account") ||
    sourceRow?.paymentMethodType === "us_bank_account" ||
    sourceRow?.type === "ach_link" ||
    sourceRow?.status === "ach_pending"
  );
}

function normalizeDateIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function getStripeEventCreatedIso(event) {
  return event?.created ? new Date(event.created * 1000).toISOString() : "";
}

function getSaleReportDateIso(charge, sourceRow) {
  if (hasUsBankAccountPayment(sourceRow, null, charge)) {
    const localPaidIso = normalizeDateIso(sourceRow?.paidDate);
    if (localPaidIso) {
      return localPaidIso;
    }
  }

  return new Date((charge.created || 0) * 1000).toISOString();
}

function getPaymentIntentCreatedIso(paymentIntent) {
  return new Date((paymentIntent?.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

function buildRefundReportRow(refund, refundIso, sourceRow, paymentIntent) {
  const paymentIntentMetadata = paymentIntent?.metadata || {};
  const refundBalanceTransaction = refund.balance_transaction;
  const fallbackFields = resolvePaidOrderFields(sourceRow || {});
  const salesOrder =
    fallbackFields.salesOrder ||
    String(paymentIntentMetadata.sales_order || "").trim();
  const descriptionBase =
    fallbackFields.description ||
    String(
      paymentIntentMetadata.link_description ||
      paymentIntentMetadata.description ||
      ""
    ).trim();
  const grossAmount = -Number((refund.amount || 0) / 100);
  const feeAmount = -Number(
    typeof refundBalanceTransaction?.fee === "number"
      ? refundBalanceTransaction.fee / 100
      : 0
  );
  const netAmount = Number(
    typeof refundBalanceTransaction?.net === "number"
      ? refundBalanceTransaction.net / 100
      : grossAmount - feeAmount
  );

  return {
    id: refund.id,
    type: "refund",
    paidDate: refundIso,
    salesOrder,
    customerName:
      sourceRow?.customerName ||
      String(paymentIntentMetadata.customer_name || "").trim() ||
      "-",
    description: descriptionBase ? `Refund - ${descriptionBase}` : "Refund",
    paymentIntentId: refund.payment_intent || sourceRow?.paymentIntentId || "",
    paidAmount: grossAmount,
    feeAmount,
    netAmount
  };
}

app.post("/api/service-cards/:id/prefill-link", requirePagePermission("/appliance-service-calls.html", "/archive-service-calls.html"), async (req, res) => {
  try {
    const { id } = req.params;
    const serviceCards = await readServiceCards();
    const index = serviceCards.findIndex((row) => row.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: "Service request not found."
      });
    }

    const token = crypto.randomBytes(24).toString("hex");
    serviceCards[index] = {
      ...serviceCards[index],
      secureCardPrefillToken: token,
      secureCardPrefillUpdatedAt: new Date().toISOString()
    };

    await writeServiceCards(serviceCards);

    const url = `${getServiceBaseUrl(req)}/applianceservice.html?prefill=${encodeURIComponent(token)}`;

    res.json({
      success: true,
      url
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to build secure card link."
    });
  }
});

app.get("/api/service/prefill/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const serviceCards = await readServiceCards();
    const row = serviceCards.find((card) => card.secureCardPrefillToken === token);

    // Tokens expire: a forwarded or leaked prefill URL must not expose the
    // customer's stored details indefinitely. Staff can issue a fresh link
    // from the service queue at any time.
    const PREFILL_TOKEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
    const issuedAt = row ? new Date(row.secureCardPrefillUpdatedAt || 0).getTime() : 0;
    const expired = !Number.isFinite(issuedAt) || issuedAt <= 0 || Date.now() - issuedAt > PREFILL_TOKEN_MAX_AGE_MS;

    if (!row || expired) {
      return res.status(404).json({
        error: "This secure card link is no longer available. Please ask us to send a fresh one."
      });
    }

    res.json({
      serviceCardId: row.id,
      forceCardFlow: true,
      serviceRequest: {
        existingServiceCardId: row.id,
        customerName: row.customerName || "",
        firstName: row.firstName || "",
        lastName: row.lastName || "",
        customerEmail: row.customerEmail || "",
        customerPhone: row.customerPhone || "",
        purchasedWithin12Months: "No",
        serviceAddress: row.serviceAddress || {},
        billingAddress: row.billingAddress || row.serviceAddress || {},
        billingSameAsService: row.billingSameAsService !== false,
        gateCode: row.gateCode || "",
        contactMethod: row.contactMethod || "",
        purchaseDate: row.purchaseDate || "",
        unitCount: row.unitCount || (row.units?.length > 1 ? "Multiple" : "One"),
        units: row.units || [],
        problemDescription: row.problemDescription || "",
        consent: true,
        nameOnCard: row.customerName || ""
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to load prefilled service request."
    });
  }
});

app.patch("/api/payment-links/:id/status", requirePagePermission("/dashboard.html", "/link-detail-lookup.html"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body || {};
    const links = await readLinks();
    const record = links.find((row) => row.id === id);

    if (!record) {
      return res.status(404).json({
        error: "Payment link record not found."
      });
    }

    normalizeLinkRecord(record);

    if (record.status === "paid") {
      return res.status(400).json({
        error: "Paid links cannot be updated."
      });
    }

    if (!["sent", "deactivated"].includes(status)) {
      return res.status(400).json({
        error: "Status must be either sent or deactivated."
      });
    }

    if (record.paymentLinkId) {
      const stripeUpdate = {
        active: status === "sent"
      };

      if (status === "deactivated") {
        stripeUpdate.inactive_message =
          reason || "This link is no longer active. Please call or text Wilson AC & Appliance at 512-894-0907 if you are attempting to make a payment and are seeing this message.";
      }

      await stripe.paymentLinks.update(record.paymentLinkId, stripeUpdate);
    }

    record.status = status;
    record.active = status === "sent";
    record.deactivatedAt = status === "deactivated" ? new Date().toISOString() : "";
    record.deactivationReason = status === "deactivated" ? (reason || "") : "";

    await writeLinks(links);

    res.json({
      success: true,
      record: normalizeLinkRecord({ ...record })
    });
  } catch (err) {
    res.status(400).json({
      error: err.message || "Unable to update payment link status."
    });
  }
});


// Force-syncs a local payment_links row with the live state in Stripe.
// Use case: webhook missed / silently dropped, dashboard still shows the
// link as unpaid even though the customer paid. Pulls the latest sessions
// for the Stripe Payment Link, finds the paid one if any, and rewrites
// the local row using the same helpers the webhook handler uses, so the
// result is identical to "webhook succeeded after all."
app.post("/api/payment-links/:id/sync-from-stripe", requirePagePermission("/dashboard.html", "/link-detail-lookup.html"), async (req, res) => {
  try {
    const { id } = req.params;
    const links = await readLinks();
    const record = links.find((row) => row.id === id);

    if (!record) {
      return res.status(404).json({ error: "Payment link record not found." });
    }

    normalizeLinkRecord(record);

    if (!record.paymentLinkId) {
      return res.status(400).json({
        error: "This record has no Stripe payment_link_id to sync from."
      });
    }

    const changes = [];
    const beforeStatus = record.status;
    const beforePaidAmount = Number(record.paidAmount || 0);
    const beforeActive = Boolean(record.active);

    const sessions = await stripe.checkout.sessions.list({
      payment_link: record.paymentLinkId,
      limit: 10
    });

    const paidSession = sessions.data.find((s) => s.payment_status === "paid");

    if (paidSession) {
      const paymentIntentId =
        typeof paidSession.payment_intent === "string"
          ? paidSession.payment_intent
          : paidSession.payment_intent?.id || "";
      const paymentIntent = paymentIntentId
        ? await retrievePaymentIntentWithDetails(paymentIntentId)
        : null;

      applyPaidLinkState(record, paidSession, paymentIntent);
      if (beforeStatus !== "paid") {
        changes.push(`status: ${beforeStatus} -> paid`);
      }
      if (Number(record.paidAmount || 0) !== beforePaidAmount) {
        changes.push(`paidAmount set to $${Number(record.paidAmount || 0).toFixed(2)}`);
      }

      try {
        await deactivateCompletedPaymentLink(record);
        if (beforeActive) {
          changes.push("Stripe link deactivated");
        }
      } catch (deactivateErr) {
        console.warn(
          `[sync-from-stripe] Failed to deactivate Stripe link ${record.paymentLinkId}: ${deactivateErr.message}`
        );
      }

      try {
        await maybeSendLinkPaidNotification(record);
      } catch {
        // Notification failures are recorded on the record itself; don't
        // fail the sync because the email couldn't go out.
      }
    } else {
      // No paid session. Check for an ACH-pending one, then fall back to
      // "at least one session exists => the customer viewed the link."
      const achCandidate = sessions.data.find((s) => {
        const pmTypes = s.payment_method_types || [];
        return s.payment_status === "unpaid" && pmTypes.includes("us_bank_account");
      });

      if (achCandidate && record.status === "sent") {
        const piId =
          typeof achCandidate.payment_intent === "string"
            ? achCandidate.payment_intent
            : achCandidate.payment_intent?.id || "";
        const paymentIntent = piId
          ? await retrievePaymentIntentWithDetails(piId)
          : null;
        if (paymentIntent && isAchPendingIntent(paymentIntent, record)) {
          applyAchPendingState(record, achCandidate, paymentIntent);
          changes.push(`status: ${beforeStatus} -> ach_pending`);
        }
      } else if (sessions.data.length > 0 && record.status === "sent") {
        record.status = "viewed";
        record.active = true;
        changes.push(`status: ${beforeStatus} -> viewed`);
      }

      // Also reconcile against the Stripe Payment Link's active flag so a
      // link that was deactivated in Stripe (e.g. manually) gets reflected
      // locally.
      try {
        const stripeLink = await stripe.paymentLinks.retrieve(record.paymentLinkId);
        if (!stripeLink.active && record.active && record.status !== "paid" && record.status !== "ach_pending") {
          record.status = "deactivated";
          record.active = false;
          record.deactivatedAt = record.deactivatedAt || new Date().toISOString();
          record.deactivationReason =
            record.deactivationReason ||
            String(stripeLink.inactive_message || "Deactivated in Stripe");
          changes.push(`status: ${beforeStatus} -> deactivated (matches Stripe)`);
        }
      } catch (linkErr) {
        console.warn(
          `[sync-from-stripe] Failed to retrieve Stripe link ${record.paymentLinkId}: ${linkErr.message}`
        );
      }
    }

    record.updatedAt = new Date().toISOString();
    await writeLinks(links);

    return res.json({
      success: true,
      record: normalizeLinkRecord({ ...record }),
      changes,
      sessionCount: sessions.data.length,
      message: changes.length
        ? "Local record updated from Stripe."
        : "Already in sync with Stripe."
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unable to sync from Stripe."
    });
  }
});


// =========================================================================
// PAID-DATE REPAIR (corrective tool used from paid-order-detail.html)
// =========================================================================
const REPAIR_DRIFT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// The repair tool lives on paid-order-detail.html, so access follows that
// page's grant (works for both individual accounts and legacy group logins).
// An older ACCESS_GROUPS whitelist here used to 403 individual accounts.
function requireRepairAccess(req, res) {
  if (!canAccessPathForUser(req.authUser, "/paid-order-detail.html")) {
    res.status(403).json({ error: "You don't have access to the paid-date repair tool." });
    return false;
  }
  return true;
}

async function buildPaidDateDriftReport(startKey, endKey) {
  const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
  const terminalPayments = await readTerminalPayments();

  const candidates = [];
  for (const row of links) {
    if (row.status === "paid" && row.paymentIntentId && row.paidDate) {
      candidates.push({ source: "payment_links", row });
    }
  }
  for (const row of terminalPayments) {
    if (row.status === "paid" && row.paymentIntentId && row.paidDate) {
      candidates.push({ source: "terminal_payments", row });
    }
  }

  const inRange = (row) => {
    if (!startKey || !endKey) return true;
    const paidDateOnly = toTimeZoneDateKey(row.paidDate, APP_TIMEZONE);
    if (!paidDateOnly) return false;
    return paidDateOnly >= startKey && paidDateOnly <= endKey;
  };

  const driftItems = [];
  const skipped = {
    noStripeData: 0,
    noLatestCharge: 0,
    notSucceeded: 0,
    errors: 0,
    hvacExcluded: 0,
    achExcluded: 0
  };
  const seenPaymentIntentIds = new Set();

  for (const candidate of candidates) {
    if (!inRange(candidate.row)) continue;

    if (hasUsBankAccountPayment(candidate.row)) {
      skipped.achExcluded += 1;
      continue;
    }

    // HVAC deposit records have a deposit charge AND a separate balance
    // charge (run later via saved card). The local paidDate can
    // legitimately reflect EITHER, and the balance PI isn't reliably
    // tracked on the link record (depends on whether the operator
    // selected "HVAC deposit" in the card-on-file form). Auto-repair
    // can't reconcile this safely, so we skip HVAC records entirely
    // and surface the count in the UI. Manual review for these.
    if (
      candidate.source === "payment_links" &&
      String(candidate.row.workflowType || "").toLowerCase() === "hvac_deposit"
    ) {
      skipped.hvacExcluded += 1;
      continue;
    }

    const pi = candidate.row.paymentIntentId;
    const comparePi = pi;
    const isHvacBalance = false;

    if (seenPaymentIntentIds.has(comparePi)) continue;
    seenPaymentIntentIds.add(comparePi);

    let paymentIntent;
    try {
      paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(comparePi);
    } catch (err) {
      skipped.errors += 1;
      continue;
    }

    if (hasUsBankAccountPayment(candidate.row, paymentIntent)) {
      skipped.achExcluded += 1;
      continue;
    }

    const chargeCreatedSec = getSucceededStripeChargeCreatedSec(paymentIntent);

    if (!chargeCreatedSec) {
      if (paymentIntent?.latest_charge) {
        skipped.notSucceeded += 1;
      } else {
        skipped.noLatestCharge += 1;
      }
      continue;
    }

    const stripeIso = new Date(chargeCreatedSec * 1000).toISOString();
    const localMs = new Date(candidate.row.paidDate).getTime();
    const stripeMs = chargeCreatedSec * 1000;
    if (!Number.isFinite(localMs)) {
      skipped.noStripeData += 1;
      continue;
    }

    const diffMs = Math.abs(localMs - stripeMs);
    if (diffMs <= REPAIR_DRIFT_THRESHOLD_MS) continue;

    const resolved = resolvePaidOrderFields(candidate.row);
    driftItems.push({
      source: candidate.source,
      recordId: candidate.row.id,
      paymentIntentId: pi,
      compareAgainstPaymentIntentId: comparePi,
      isHvacBalance,
      customerName: candidate.row.customerName || "",
      salesOrder: resolved.salesOrder || "",
      description: resolved.description || "",
      currentPaidDate: candidate.row.paidDate,
      proposedPaidDate: stripeIso,
      stripeChargeCreated: stripeIso,
      driftDays: Math.round((diffMs / 86400000) * 10) / 10,
      direction: localMs > stripeMs ? "forward" : "backward"
    });

    await sleep(120);
  }

  driftItems.sort((a, b) => Math.abs(b.driftDays) - Math.abs(a.driftDays));

  return { driftItems, skipped, candidateCount: candidates.length };
}

app.post("/api/admin/repair-paid-dates/preview", requirePagePermission("/paid-order-detail.html"), async (req, res) => {
  try {
    if (!requireRepairAccess(req, res)) return;

    const startKey = String(req.body?.start || "").trim() || "";
    const endKey = String(req.body?.end || "").trim() || "";

    const report = await buildPaidDateDriftReport(startKey, endKey);

    return res.json({
      ok: true,
      mode: "preview",
      generatedAt: new Date().toISOString(),
      startKey,
      endKey,
      candidateCount: report.candidateCount,
      driftCount: report.driftItems.length,
      skipped: report.skipped,
      items: report.driftItems
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unable to preview paid-date drift."
    });
  }
});

app.post("/api/admin/repair-paid-dates/apply", requirePagePermission("/paid-order-detail.html"), async (req, res) => {
  try {
    if (!requireRepairAccess(req, res)) return;

    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    if (changes.length === 0) {
      return res.status(400).json({ error: "No changes were provided." });
    }
    if (changes.length > 500) {
      return res.status(400).json({
        error: "Too many changes in one request (limit 500). Run preview again for a narrower date range."
      });
    }

    const links = await readLinks();
    const terminalPayments = await readTerminalPayments();

    const linkByPi = new Map();
    for (const row of links) {
      if (row.paymentIntentId) linkByPi.set(row.paymentIntentId, row);
    }
    const terminalByPi = new Map();
    for (const row of terminalPayments) {
      if (row.paymentIntentId) terminalByPi.set(row.paymentIntentId, row);
    }

    const applied = [];
    const skipped = [];
    let linksDirty = false;
    let terminalDirty = false;

    for (const change of changes) {
      const pi = String(change?.paymentIntentId || "").trim();
      const source = String(change?.source || "").trim();
      const proposed = String(change?.proposedPaidDate || "").trim();
      if (!pi || !source || !proposed) {
        skipped.push({ paymentIntentId: pi, reason: "missing fields", change });
        continue;
      }

      const row = source === "terminal_payments" ? terminalByPi.get(pi) : linkByPi.get(pi);
      if (!row) {
        skipped.push({ paymentIntentId: pi, reason: "record not found", change });
        continue;
      }

      // For HVAC records where the preview compared against the balance
      // PI, we need to verify against the SAME PI on apply (otherwise
      // the proposed date won't match Stripe's deposit-PI date and the
      // change would be skipped).
      const verifyPi = String(change?.compareAgainstPaymentIntentId || pi).trim();
      let paymentIntent;
      try {
        paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(verifyPi);
      } catch (err) {
        skipped.push({ paymentIntentId: pi, reason: `stripe error: ${err.message}` });
        continue;
      }

      if (hasUsBankAccountPayment(row, paymentIntent)) {
        skipped.push({
          paymentIntentId: pi,
          reason: "ACH payments keep their clearing paid date and are excluded from drift repair"
        });
        continue;
      }

      const chargeCreatedSec = getSucceededStripeChargeCreatedSec(paymentIntent);
      if (!chargeCreatedSec) {
        skipped.push({
          paymentIntentId: pi,
          reason: paymentIntent?.latest_charge
            ? "Stripe PaymentIntent/latest_charge is not succeeded"
            : "no latest_charge on PI"
        });
        continue;
      }
      const verifiedIso = new Date(chargeCreatedSec * 1000).toISOString();
      if (verifiedIso !== proposed) {
        skipped.push({
          paymentIntentId: pi,
          reason: "Stripe value changed between preview and apply",
          stripeNow: verifiedIso,
          previewedProposed: proposed
        });
        continue;
      }

      const before = row.paidDate;
      row.paidDate = verifiedIso;
      row.updatedAt = new Date().toISOString();
      if (source === "terminal_payments") {
        terminalDirty = true;
      } else {
        linksDirty = true;
      }
      applied.push({
        paymentIntentId: pi,
        source,
        recordId: row.id,
        before,
        after: verifiedIso
      });

      await sleep(120);
    }

    if (linksDirty) await writeLinks(links);
    if (terminalDirty) await writeTerminalPayments(terminalPayments);

    return res.json({
      ok: true,
      mode: "apply",
      appliedAt: new Date().toISOString(),
      appliedCount: applied.length,
      skippedCount: skipped.length,
      applied,
      skipped
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unable to apply paid-date repairs."
    });
  }
});

function normalizeLinkRecord(record) {
  const normalized = record;
  normalized.type = normalized.type || "card_link";
  normalized.reference =
    normalized.reference ||
    normalized.description ||
    normalized.salesOrder ||
    "";
  normalized.active = typeof normalized.active === "boolean"
    ? normalized.active
    : normalized.status !== "deactivated";
  normalized.deactivatedAt = normalized.deactivatedAt || "";
  normalized.deactivationReason = normalized.deactivationReason || "";
  normalized.creatorCode = normalized.creatorCode || "";
  normalized.creatorName = normalized.creatorName || "";
  normalized.creatorEmail = normalized.creatorEmail || "";
  normalized.department = normalized.department || "";
  normalized.paymentMethodType = normalized.paymentMethodType || "";
  normalized.paymentStatusDetail = normalized.paymentStatusDetail || "";
  normalized.paymentNotificationSentAt = normalized.paymentNotificationSentAt || "";
  normalized.paymentNotificationError = normalized.paymentNotificationError || "";

  if (normalized.paidDate || Number(normalized.paidAmount) > 0) {
    normalized.status = "paid";
    normalized.active = false;
    normalized.type =
      normalized.paymentMethodType === "us_bank_account" || normalized.type === "ach_link"
        ? "ach_link"
        : "card_link";
  } else if (normalized.status === "deactivated" || normalized.active === false) {
    normalized.status = "deactivated";
    normalized.active = false;
  } else if (normalized.status === "ach_pending") {
    normalized.status = "ach_pending";
    normalized.active = true;
    normalized.type = "ach_link";
    normalized.paymentMethodType = normalized.paymentMethodType || "us_bank_account";
  } else if (normalized.status === "viewed") {
    normalized.status = "viewed";
    normalized.active = true;
    normalized.type = "card_link";
  } else {
    normalized.status = "sent";
    normalized.active = true;
    normalized.type = "card_link";
  }

  return normalized;
}

function toTimeZoneDateKey(isoValue, timeZone) {
  if (!isoValue) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(isoValue));
}

async function processCheckoutSessionWebhookEvent(event) {
  const session = event.data?.object;

  if (!session?.payment_link) {
    return;
  }

  const links = await readLinks();
  const record = links.find((row) =>
    row.paymentLinkId === session.payment_link ||
    row.checkoutSessionId === session.id ||
    row.paymentIntentId === session.payment_intent
  );

  if (!record) {
    // Surface webhook misses so we can find them in Render Logs — this is
    // what made the "paid in Stripe but stuck unpaid in dashboard" bug
    // invisible. Now it's a single grep away.
    console.warn(
      `[webhook miss] event=${event.type} payment_link=${session.payment_link || "-"} ` +
      `payment_intent=${session.payment_intent || "-"} session=${session.id || "-"} ` +
      `(no matching local payment_links row; sync from Stripe via the dashboard if expected)`
    );
    return;
  }

  normalizeLinkRecord(record);

  // checkout.session.expired fires when a Checkout Session times out
  // without being completed (default: 24 hours after creation). Stripe
  // does NOT publish checkout.session.created as a webhook event, so
  // expired is our only automatic signal that a session was opened at
  // all. Use it as a delayed proxy for "the customer clicked the link":
  // if the local record is still sitting in "sent", promote it to
  // "viewed". Never downgrade paid / ach_pending / deactivated rows.
  // For real-time viewed signal, sales should use the manual Sync
  // button on the dashboard.
  if (event.type === "checkout.session.expired") {
    if (record.status === "sent") {
      record.status = "viewed";
      record.active = true;
      record.updatedAt = new Date().toISOString();
      await writeLinks(links);
      console.log(`[webhook] marked ${record.id} as viewed via expired session ${session.id}`);
    }
    return;
  }

  const paymentIntent = session.payment_intent
    ? await retrievePaymentIntentWithDetails(session.payment_intent)
    : null;

  if (event.type === "checkout.session.completed") {
    if (paymentIntent?.status === "succeeded") {
      applyPaidLinkState(record, session, paymentIntent, {
        paidDateIso: getStripeEventCreatedIso(event)
      });
      await recordDepositCollectedFromLink(record);
      await deactivateCompletedPaymentLink(record);
      await maybeSendLinkPaidNotification(record);
    } else if (isAchPendingIntent(paymentIntent, record)) {
      applyAchPendingState(record, session, paymentIntent);
    }
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    applyPaidLinkState(record, session, paymentIntent, {
      paidDateIso: getStripeEventCreatedIso(event)
    });
    await recordDepositCollectedFromLink(record);
    await deactivateCompletedPaymentLink(record);
    await maybeSendLinkPaidNotification(record);
  }

  if (event.type === "checkout.session.async_payment_failed") {
    applyFailedPaymentIntentState(record, paymentIntent);
    record.checkoutSessionId = session.id || record.checkoutSessionId || "";
  }

  await writeLinks(links);
}

async function processPaymentIntentWebhookEvent(event) {
  const webhookPaymentIntent = event.data?.object;
  if (!webhookPaymentIntent?.id) {
    return;
  }

  const paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(webhookPaymentIntent.id);

  const links = await readLinks();
  const record = links.find((row) => row.paymentIntentId === paymentIntent.id);

  if (!record) {
    console.warn(`[webhook miss] event=${event.type} payment_intent=${paymentIntent.id} (no matching local payment_links row)`);
    return;
  }

  normalizeLinkRecord(record);

  if (event.type === "payment_intent.succeeded") {
    applyPaidLinkState(record, null, paymentIntent, {
      paidDateIso: getStripeEventCreatedIso(event)
    });
    await deactivateCompletedPaymentLink(record);
    await maybeSendLinkPaidNotification(record);
  }

  if (event.type === "payment_intent.payment_failed") {
    applyFailedPaymentIntentState(record, paymentIntent);
  }

  record.updatedAt = new Date().toISOString();
  await writeLinks(links);
}

async function deactivateCompletedPaymentLink(record) {
  if (!record?.paymentLinkId) {
    return;
  }

  await stripe.paymentLinks.update(record.paymentLinkId, {
    active: false,
    inactive_message: COMPLETED_PAYMENT_LINK_MESSAGE
  });
}

function applyPaidLinkState(record, session, paymentIntent, options = {}) {
  const paymentMethodType = inferPaymentMethodType(paymentIntent, session);
  // First paid event wins. Webhook re-deliveries and manual Sync clicks
  // must not bump the accounting date forward.
  const wasAlreadyPaid = record.status === "paid" && Boolean(record.paidDate);
  const nowIso = new Date().toISOString();
  const eventPaidDateIso = normalizeDateIso(options.paidDateIso);
  const isAchPayment = hasUsBankAccountPayment(record, paymentIntent, null, session);

  record.status = "paid";
  record.active = false;
  record.type = paymentMethodType === "us_bank_account" ? "ach_link" : "card_link";
  record.paymentMethodType = paymentMethodType;
  record.paymentStatusDetail = paymentIntent?.status || "succeeded";
  record.paidAmount = Number(
    typeof session?.amount_total === "number"
      ? session.amount_total / 100
      : typeof paymentIntent?.amount_received === "number"
        ? paymentIntent.amount_received / 100
        : record.paidAmount || 0
  );

  if (!wasAlreadyPaid) {
    const chargeCreatedSec = getSucceededStripeChargeCreatedSec(paymentIntent);
    record.paidDate = isAchPayment
      ? eventPaidDateIso || nowIso
      : chargeCreatedSec
        ? new Date(chargeCreatedSec * 1000).toISOString()
        : eventPaidDateIso || nowIso;
    record.deactivatedAt = nowIso;
  }

  record.paymentIntentId = paymentIntent?.id || session?.payment_intent || record.paymentIntentId || "";
  record.checkoutSessionId = session?.id || record.checkoutSessionId || "";
  record.customerId =
    typeof paymentIntent?.customer === "string"
      ? paymentIntent.customer
      : paymentIntent?.customer?.id || record.customerId || "";
  record.paymentMethodId =
    typeof paymentIntent?.payment_method === "string"
      ? paymentIntent.payment_method
      : paymentIntent?.payment_method?.id || record.paymentMethodId || "";
  record.deactivationReason = COMPLETED_PAYMENT_LINK_MESSAGE;
}

function applyFailedPaymentIntentState(record, paymentIntent) {
  const latestCharge = paymentIntent?.latest_charge;
  const failureMessage =
    latestCharge && typeof latestCharge === "object"
      ? latestCharge.failure_message || latestCharge.failure_code || ""
      : "";

  record.status = "viewed";
  record.active = true;
  record.type = inferPaymentMethodType(paymentIntent, null) === "us_bank_account" ? "ach_link" : record.type || "card_link";
  record.paymentMethodType = inferPaymentMethodType(paymentIntent, null) || record.paymentMethodType || "";
  record.paymentStatusDetail = paymentIntent?.status || "failed";
  record.paidAmount = 0;
  record.paidDate = "";
  record.deactivatedAt = "";
  record.deactivationReason = failureMessage || "Stripe payment failed";
  record.paymentIntentId = paymentIntent?.id || record.paymentIntentId || "";
}

function applyAchPendingState(record, session, paymentIntent) {
  record.status = "ach_pending";
  record.type = "ach_link";
  record.active = true;
  record.paymentMethodType =
    inferPaymentMethodType(paymentIntent, session) ||
    record.paymentMethodType ||
    "us_bank_account";
  record.paymentStatusDetail = paymentIntent?.status || "processing";
  record.paymentIntentId = paymentIntent?.id || session?.payment_intent || record.paymentIntentId || "";
  record.checkoutSessionId = session?.id || record.checkoutSessionId || "";
}

async function maybeSendLinkPaidNotification(record) {
  if (!record.paymentNotificationSentAt) {
    // Customer "payment received" text via Zapier -> Podium (best-effort;
    // guarded by the same one-shot flag plus an in-process dedupe set).
    await maybeSendPaidTextWebhook(record);

    if (record.creatorEmail) {
      try {
        await sendPaymentLinkPaidEmail(record);
        record.paymentNotificationSentAt = new Date().toISOString();
        record.paymentNotificationError = "";
      } catch (notificationError) {
        record.paymentNotificationError = notificationError.message || "Unable to send payment notification.";
      }
    } else if (paidTextWebhookSentIds.has(record.id)) {
      // No creator email to notify, but the customer text went out: mark the
      // record so webhook retries don't re-trigger notifications.
      record.paymentNotificationSentAt = new Date().toISOString();
      record.paymentNotificationError = "";
    }
  }
}

// ---------------------------------------------------------------------------
// Customer paid-confirmation text: POSTs the paid-link details to a Zapier
// catch-hook (ZAPIER_PAID_TEXT_HOOK_URL). The Zap forwards it to Podium's
// "Send Message" action. Skipped when the env var is unset or the record has
// no customer phone number.
// ---------------------------------------------------------------------------

const ZAPIER_PAID_TEXT_HOOK_URL = String(process.env.ZAPIER_PAID_TEXT_HOOK_URL || "").trim();
const paidTextWebhookSentIds = new Set();

async function maybeSendPaidTextWebhook(record) {
  if (!ZAPIER_PAID_TEXT_HOOK_URL) return;
  if (!record?.id || paidTextWebhookSentIds.has(record.id)) return;

  const phone = String(record.customerPhone || "").trim();
  if (!phone) return;

  try {
    const response = await fetch(ZAPIER_PAID_TEXT_HOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "payment_link_paid",
        linkId: record.id,
        customerName: record.customerName || "",
        customerPhone: phone,
        customerEmail: record.customerEmail || "",
        salesOrder: record.salesOrder || "",
        description: record.description || "",
        workflowType: record.workflowType || "appliance",
        amountPaid: Number(record.paidAmount || 0).toFixed(2),
        paidDate: record.paidDate || new Date().toISOString(),
        paymentIntentId: record.paymentIntentId || ""
      })
    });

    if (!response.ok) {
      throw new Error(`Zapier hook returned ${response.status}`);
    }

    paidTextWebhookSentIds.add(record.id);

    // Keep the dedupe set from growing unbounded.
    if (paidTextWebhookSentIds.size > 5000) {
      paidTextWebhookSentIds.clear();
    }
  } catch (err) {
    console.error(`Paid-text webhook failed for link ${record.id}:`, err.message);
  }
}

function inferPaymentMethodType(paymentIntent, session) {
  return (
    paymentIntent?.payment_method_types?.[0] ||
    session?.payment_method_types?.[0] ||
    ""
  );
}

function isAchPendingIntent(paymentIntent, record = null) {
  return (
    paymentIntent?.status === "processing" &&
    (
      paymentIntent?.payment_method_types?.includes("us_bank_account") ||
      paymentIntent?.payment_method?.type === "us_bank_account" ||
      record?.paymentMethodType === "us_bank_account" ||
      record?.type === "ach_link" ||
      record?.status === "ach_pending"
    )
  );
}

async function sendPaymentLinkPaidEmail(record) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Paid email notification is not configured.");
  }

  const recipient = record.creatorEmail;

  if (!recipient) {
    throw new Error("No creator email address is saved for this link.");
  }

  const paidDate = record.paidDate
    ? new Date(record.paidDate).toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : "just now";

  const subject = `Payment received: ${record.salesOrder || record.description || "payment link"}`;
  const text = [
    `Hi ${record.creatorName || record.creatorCode || "team"},`,
    "",
    "A payment link has been paid.",
    `Customer: ${record.customerName || "-"}`,
    `Sales order: ${record.salesOrder || "-"}`,
    `Description: ${record.description || "-"}`,
    `Amount paid: $${Number(record.paidAmount || 0).toFixed(2)}`,
    `Paid date: ${paidDate}`,
    `Payment intent: ${record.paymentIntentId || "-"}`,
    "",
    "Wilson AC & Appliance Payments"
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Hi ${escapeHtmlForEmail(record.creatorName || record.creatorCode || "team")},</p>
      <p>A payment link has been paid.</p>
      <ul>
        <li><strong>Customer:</strong> ${escapeHtmlForEmail(record.customerName || "-")}</li>
        <li><strong>Sales order:</strong> ${escapeHtmlForEmail(record.salesOrder || "-")}</li>
        <li><strong>Description:</strong> ${escapeHtmlForEmail(record.description || "-")}</li>
        <li><strong>Amount paid:</strong> $${Number(record.paidAmount || 0).toFixed(2)}</li>
        <li><strong>Paid date:</strong> ${escapeHtmlForEmail(paidDate)}</li>
        <li><strong>Payment intent:</strong> ${escapeHtmlForEmail(record.paymentIntentId || "-")}</li>
      </ul>
      <p>Wilson AC & Appliance Payments</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [recipient],
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email API error: ${response.status} ${errorText}`);
  }
}

function escapeHtmlForEmail(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}





if (isUserStoreConfigured()) {
  ensureUserAccessTables()
    .then(() => console.log("User access tables ready."))
    .catch((err) => console.error("Unable to prepare user access tables:", err.message));

  setInterval(() => {
    cleanupExpiredAuthRows().catch(() => {});
  }, 6 * 60 * 60 * 1000).unref();
} else {
  console.warn("DATABASE_URL is not set: individual user accounts are unavailable; only env logins will work.");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});

