import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
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
  deleteUserAccount,
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
  listEmployeeDirectory,
  getEmployeeDirectoryObject,
  upsertEmployeeDirectoryEntry,
  deleteEmployeeDirectoryEntry,
  findEmployeeDirectoryEntryByEmail,
  setEmployeeDirectoryArchived,
  validateEmployeeCode,
  normalizeEmployeeCode,
  setJobCodeSeed,
  listJobTitles,
  listNotifyTitleNames,
  countJobTitleHolders,
  createJobTitle,
  updateJobTitle,
  deleteJobTitle,
  validateJobTitleName,
  listPermissionGroups,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment
} from "./lib/employee-directory.js";
import {
  isSteelCodConfigured,
  SteelCodError,
  createSpecPackage,
  searchSpecPackages,
  retrieveSpecPackage,
  deleteSpecPackage,
  retrieveUsers as retrieveSteelCodUsers,
  toggleDocumentInclusion,
  buildSpecPackageUrls
} from "./lib/steelcod.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import multer from "multer";
import { read as readWorkbook, utils as xlsxUtils } from "xlsx";
import {
  findOrCreateCandidate,
  createPhoneScreen,
  listCandidates,
  getCandidateWithScreens
} from "./lib/hr-postgres.js";
import {
  saveSpecQuote,
  listSpecQuotes,
  getSpecQuote,
  deleteSpecQuote
} from "./lib/spec-quotes-postgres.js";
import {
  saveSignaturePhoto,
  getSignaturePhoto,
  getSignaturePhotoByEmail
} from "./lib/signature-postgres.js";
import {
  listClearanceStatuses,
  markClearanceStatus,
  upgradeHoldToSold,
  clearClearanceStatus,
  getClearanceStatus,
  listPriceOverrides,
  setPriceOverride,
  clearPriceOverride,
  markWebLock,
  upgradeWebToSold
} from "./lib/clearance-postgres.js";
import {
  createShopper,
  getShopperByToken,
  createShopOrder,
  listShopOrders,
  getShopOrder,
  claimShopOrder,
  unclaimShopOrder,
  completeShopOrder,
  cancelShopOrder,
  findShopperByCodeAndPhone,
  findShopperByPhoneAndLastName,
  setShopperPassword,
  verifyShopperLogin,
  updateShopperProfile,
  updateShopperProfileById,
  searchShopShoppers,
  getShopperById,
  setShopperTempPassword,
  setShopperStripeCustomerId,
  importStripeCustomerRecord,
  deleteShopper,
  updateShopOrderCardSummary,
  updateShopOrderLockConflicts,
  saveShopInventorySnapshot,
  getShopInventorySnapshot,
  saveShopMapPrices,
  getShopMapPrices
} from "./lib/shop-postgres.js";
import {
  normalizeCreditAppToken,
  getCreditApplication,
  saveCreditApplicationStep,
  submitCreditApplication,
  listCreditApplications,
  recordCreditDecision,
  recordResultEmail,
  deleteCreditApplication
} from "./lib/credit-app-postgres.js";
import {
  TARGET_DEPARTMENTS,
  monthWorkingDays,
  isValidTargetMonth,
  getRevenueTarget,
  saveRevenueTarget
} from "./lib/revenue-targets-postgres.js";
import {
  parseActivityGrid,
  rollupByDepartment,
  rollupBySalesperson
} from "./lib/salesperson-activity.js";
import {
  saveRevenuePerformance,
  getRevenuePerformance
} from "./lib/revenue-performance-postgres.js";
import {
  extractServiceEstimateFromPdf,
  createServiceEstimate,
  listServiceEstimates,
  getServiceEstimateByToken,
  markServiceEstimateViewed,
  markServiceEstimateEmailed,
  saveServiceEstimateResponse,
  lookupKnownClientEmail,
  listStaleSentEstimates,
  markServiceEstimateStaleFlagged,
  setServiceEstimateClosed
} from "./lib/service-estimates-postgres.js";
import {
  createDeliveryRun,
  updateDeliveryRun,
  setDeliveryRunStatus,
  getDeliveryRun,
  deleteDeliveryRun,
  listDeliveryRuns,
  getRunForDriver,
  addDeliveryStop,
  updateDeliveryStop,
  deleteDeliveryStop,
  reorderDeliveryStops,
  listDeliveryStops,
  getDeliveryStop,
  getDeliveryStopByToken,
  getDeliveryStopByGeofence,
  setDeliveryStopStatus,
  markDeliveryStopDeparted,
  addDeliveryStopPhoto,
  setDeliveryStopSignature,
  logDeliveryStopText,
  markNextTextSent,
  getNextPendingStop,
  countStopsAhead
} from "./lib/deliveries-postgres.js";
import {
  samsaraConfigured,
  listVehicles as listSamsaraVehicles,
  getVehicleLocation,
  createStopGeofence,
  deleteStopGeofence,
  parseGeofenceEvent,
  roughEtaMinutes
} from "./lib/samsara.js";
import { sendCustomerText, podiumSendConfigured } from "./lib/podium-send.js";
import {
  podiumOAuthConfigured,
  podiumConnected,
  getPodiumConnection,
  disconnectPodium,
  makeOAuthState,
  verifyOAuthState,
  getAuthorizeUrl,
  exchangeOAuthCode,
  noteAndAssign as podiumNoteAndAssign,
  findConversationByPhone as podiumFindConversationByPhone,
  addConversationNote as podiumAddConversationNote,
  sendPodiumTemplateText,
  listMessageTemplates
} from "./lib/podium.js";
import {
  createCardConfirm,
  getCardConfirm,
  markCardConfirmDecided
} from "./lib/card-confirms-postgres.js";
import {
  listPodiumAutomations,
  upsertPodiumAutomation,
  resolveAutomationTemplate,
  claimPodiumPaymentNoteOnce
} from "./lib/podium-automations-postgres.js";
import {
  parseInvoiceMaintenanceQuotes,
  replaceOpenQuotes,
  saveQuoteDisposition,
  listQuoteOwners,
  getQuoteFollowupBoard,
  listQuoteSalespeople,
  getLatestQuoteUploadMeta
} from "./lib/quote-followup-postgres.js";
import { parseCommissionGrid } from "./lib/commission-report.js";
import {
  getBonusRules,
  saveBonusRules,
  computeBonus,
  BONUS_DEPARTMENTS
} from "./lib/bonus-rules-postgres.js";
import {
  upsertOrdersFromActivity,
  replaceCommissionLines,
  listServiceLeadConversions,
  listOrderDetail,
  listOrderLineDetail,
  listLinesForInvoice,
  listSourceVersions,
  listReturnLines,
  listCommissionLinesForMonths,
  listCommissionMonths,
  listSalespersonNames,
  listCommissionOverrides,
  saveCommissionOverride,
  saveCommissionBalanceCheck,
  listCommissionBalanceChecks,
  normalizeSalespersonName,
  getOrdersByInvoices,
  replaceOpenOrders,
  getOpenOrdersMeta,
  getOpenOrdersByInvoices
} from "./lib/sales-order-detail-postgres.js";
import {
  FIELD_SALES_PLAN,
  SHOWROOM_PLAN,
  COMMISSION_PAGE_PLANS,
  serialRevenueByCode,
  computeFieldSalesStatements
} from "./lib/field-sales-commissions.js";
import { buildCommissionStatementPdf } from "./lib/commission-statement-pdf.js";
import {
  upsertCommissionPost,
  deleteCommissionPost,
  listCommissionPostsForMonth,
  listPostedMonthsForEmail,
  getCommissionPostForEmail,
  createCommissionException,
  listCommissionExceptionsForMonth,
  listCommissionExceptionsForRep,
  countOpenCommissionExceptions,
  getCommissionException,
  resolveCommissionException,
  exceptionDeadlineDate,
  exceptionWindowOpen
} from "./lib/commission-review-postgres.js";
import { saveTermsSignature, listTermsSignatures, TERMS_VERSION } from "./lib/terms-signatures-postgres.js";
import { recordRefundEvent, listRefundEvents, getRefundEvent } from "./lib/refund-events-postgres.js";
import { getOrCreateReceiptToken, getReceiptTokenRecord } from "./lib/receipt-tokens-postgres.js";
import { extractRetailDeckFloors } from "./lib/retaildeck-prices.js";
import {
  getSalesOrderSnapshot,
  saveSalesOrderSnapshot,
  listOrderFlagDismissals,
  dismissOrderFlag,
  recordFlagClosure,
  listFlagClosures,
  listFlagClosuresRange,
  createPushedNotification,
  listMyPushedNotifications,
  getPushedNotification,
  retirePushedNotificationsByRef,
  claimPushedNotificationsByRef,
  unclaimPushedNotificationsByRef,
  pushedNotificationRefExists
} from "./lib/sales-orders-postgres.js";
import {
  getServiceOrderSnapshot,
  saveServiceOrderSnapshot
} from "./lib/service-orders-postgres.js";
import { extractQuoteDataFromPdfBuffer } from "./lib/spec-scan.js";
import { parseMaintenanceInvoices } from "./lib/maintenance-invoice-parser.js";
import {
  saveSatisfactionResponse,
  listSatisfactionResponses,
  SATISFACTION_PRIORITIES
} from "./lib/satisfaction-postgres.js";
import {
  saveCaseVisitResponse,
  updateCaseVisitResponse,
  listCaseVisitResponses,
  CASE_VISIT_PROGRESS_OPTIONS
} from "./lib/case-visit-postgres.js";
import {
  computeReimbursedMiles,
  computeReportTotals,
  listRatePeriods,
  getRateForReport,
  getRateEffectiveOn,
  upsertRatePeriod,
  getMileageReportById,
  getOrCreateMileageReport,
  listMileageReportsForUser,
  listMileageReportsForReview,
  saveMileageEntries,
  refreshReportCommute,
  markMileageReportsPaid,
  setMileageReportStatus,
  deleteMileageReport
} from "./lib/mileage-postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DASHBOARD_HOST = (process.env.DASHBOARD_HOST || "dashboards.wilsonappliance.com").toLowerCase();
const SERVICE_PUBLIC_HOST = (process.env.SERVICE_PUBLIC_HOST || "service.wilsonappliance.com").toLowerCase();
const SHOP_PUBLIC_HOST = (process.env.SHOP_PUBLIC_HOST || "shop.wilsonappliance.com").toLowerCase();
// MAP compliance: the shop only serves (and prices) deliveries inside this
// ZIP list — like an age gate on an alcohol site. Override with a
// comma-separated SHOP_ALLOWED_ZIPS env var.
const SHOP_ALLOWED_ZIPS = new Set(
  String(process.env.SHOP_ALLOWED_ZIPS || "78620,78737,78746,78749,78739,78738,78676,78703,78704,78748")
    .split(",").map((z) => z.trim()).filter(Boolean)
);
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
  "/builder-credit.html",
  "/builder-credit-terms.pdf",
  "/fireflavor.html",
  "/terms.html",
  "/terms-sign.html",
  "/card-saved.html",
  "/estimate.html",
  "/api/estimate/view",
  "/api/estimate/respond",
  "/subzero",
  "/subzero.html",
  "/api/subzero/inquiry",
  "/track.html",
  "/api/track",
  "/card-confirm.html",
  "/receipt.pdf",
  "/api/card-confirm/view",
  "/api/card-confirm/use",
  "/api/card-confirm/other",
  "/public-shell.css",
  "/public-shell.js",
  "/fonts/roboto-latin-wght-normal.woff2",
  "/fonts/roboto-latin-wght-italic.woff2",
  "/logo-black.png",
  "/fireflavor-hero.png",
  "/fireflavor-what-to-expect.png",
  "/favicon.svg",
  "/robots.txt",
  "/favicon.ico"
]);

const SERVICE_PUBLIC_API_PREFIXES = [
  "/api/config",
  // Trailing slash matters: the internal admin API lives at
  // /api/credit-applications and must NOT match this public prefix.
  "/api/credit-application/",
  "/api/events/fire-flavor/rsvp",
  "/api/terms/sign",
  "/api/service/setup-intent",
  "/api/service/submit-request",
  "/api/service/setup-intent-result/",
  "/api/service/prefill/"
];

// Online clearance shop (shop.wilsonappliance.com). shop.html is served at
// the shop host's root; these assets/APIs are reachable without a login on
// that host only.
const SHOP_PUBLIC_PATHS = new Set([
  "/",
  "/shop.html",
  "/public-shell.css",
  "/fonts/roboto-latin-wght-normal.woff2",
  "/fonts/roboto-latin-wght-italic.woff2",
  "/logo-black.png",
  "/favicon.svg",
  "/robots.txt",
  "/favicon.ico"
]);

const SHOP_PUBLIC_API_PREFIXES = [
  "/api/config",
  "/api/shop/zip-check",
  "/api/shop/register",
  "/api/shop/lookup",
  "/api/shop/recover-code",
  "/api/shop/login",
  "/api/shop/profile",
  "/api/shop/password",
  "/api/shop/catalog",
  "/api/shop/setup-intent",
  "/api/shop/submit-order",
  "/api/shop/setup-intent-result/"
];

const ALWAYS_PUBLIC_PATHS = new Set([
  "/api/stripe/webhook",
  // Machine-to-machine: the store PC's nightly ExportModel upload. Guarded
  // by its own shared key (SHOP_SNAPSHOT_KEY), not a session.
  "/api/shop/inventory-snapshot/file"
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
  "/sales-order-detail.html",
  "/returns-report.html",
  "/mileage.html",
  "/mileage-review.html",
  "/hr-phone-screen.html",
  "/hr-candidates.html",
  "/spec-packages.html",
  "/satisfaction-survey.html",
  "/satisfaction-results.html",
  "/case-visit-survey.html",
  "/case-visit-results.html",
  "/refund-dashboard.html",
  "/signature-builder.html",
  "/clearance.html",
  "/credit-applications.html",
  "/sales-order-health.html",
  "/quote-follow-up.html",
  "/epass-uploads.html",
  "/service-estimates.html",
  "/service-order-health.html",
  "/terms-signatures.html",
  "/flag-closures.html",
  "/target-builder.html",
  "/shop-orders.html",
  "/shopper-profiles.html",
  "/dispatch.html",
  "/driver.html",
  "/message-automations.html",
  "/aging-inventory.html",
  "/my-commissions.html",
  "/maintenance/index.html",
  "/maintenance/appliance-signup.html",
  "/maintenance/hvac-signup.html",
  "/maintenance/confirmation.html",
  "/maintenance/admin.html",
  "/maintenance/household.html",
  "/maintenance/quote-builder.html",
  "/maintenance/quote-view.html",
  "/maintenance/tech-maintenance.html",
  "/maintenance/report-view.html"
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
    excludedPages: ["/commissions.html", "/user-admin.html"]
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

// Pages every signed-in user can open — no per-user grant needed, never
// shown in the User Admin permission editor.
const EVERYONE_PAGE_PATHS = new Set([
  "/signature-builder.html"
]);

// Executive-only pages: reachable only with is_executive, never grantable.
const EXECUTIVE_ONLY_PAGE_PATHS = new Set([
  "/user-admin.html",
  "/audit-log.html",
  "/sales-order-detail.html",
  "/returns-report.html",
  "/commissions.html"
]);

// Canonical list of pages an executive can grant/deny per user. Derived from
// INTERNAL_PAGE_PATHS so the admin UI and enforcement share one source.
const MANAGEABLE_PAGE_PATHS = [...INTERNAL_PAGE_PATHS]
  .filter((p) => !AUTH_PAGE_PATHS.has(p) && !EXECUTIVE_ONLY_PAGE_PATHS.has(p) && !EVERYONE_PAGE_PATHS.has(p))
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
      "/clearance.html",
      "/shop-orders.html",
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
      "/service-estimates.html",
      "/service-order-health.html",
      "/shopper-profiles.html",
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

// The legacy hardcoded presets now only SEED the job_codes table on first
// boot — after that, executives manage codes in User Admin and the DB is
// the source of truth.
setJobCodeSeed(JOB_CODE_PRESETS);

function expandPermissionGroupPages(pages) {
  if ((pages || []).includes("*")) return [...MANAGEABLE_PAGE_PATHS];
  return (pages || []).filter((p) => MANAGEABLE_PAGE_PATHS.includes(p));
}

async function expandJobCodePresetPages(presetKey) {
  const groups = await listPermissionGroups();
  const group = groups.find((g) => g.key === presetKey);
  if (!group) return [];
  return expandPermissionGroupPages(group.pages);
}

const PAGE_LABELS = {
  "/dashboard.html": "User Dashboard",
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
  "/commissions.html": "Sales Commissions",
  "/user-admin.html": "User Admin",
  "/audit-log.html": "User Activity Audit",
  "/sales-order-detail.html": "Sales Order Detail",
  "/returns-report.html": "Returns Report",
  "/mileage.html": "Mileage",
  "/mileage-review.html": "Mileage Review",
  "/hr-phone-screen.html": "Phone Screen",
  "/hr-candidates.html": "Candidates",
  "/satisfaction-survey.html": "Client Satisfaction Survey",
  "/satisfaction-results.html": "Satisfaction Results",
  "/case-visit-survey.html": "Case Visit Survey",
  "/case-visit-results.html": "Case Visit Results",
  "/refund-dashboard.html": "Refund Dashboard",
  "/signature-builder.html": "Email Signature",
  "/clearance.html": "Clearance Hit List",
  "/credit-applications.html": "Builder Credit Applications",
  "/sales-order-health.html": "Sales Order Health Report",
  "/quote-follow-up.html": "Quote Follow-Up",
  "/epass-uploads.html": "ePASS Upload Center",
  "/service-estimates.html": "Service Estimate Approvals",
  "/terms-signatures.html": "Terms & Conditions Signatures",
  "/service-order-health.html": "Service Order Health",
  "/flag-closures.html": "Notification Closure Report",
  "/target-builder.html": "Target Builder",
  "/shop-orders.html": "Online Shop Orders",
  "/shopper-profiles.html": "Shopper Profiles",
  "/dispatch.html": "Delivery Dispatch",
  "/driver.html": "Driver Run Sheet",
  "/message-automations.html": "Text Automations",
  "/aging-inventory.html": "Aging Inventory",
  "/my-commissions.html": "My Commission Review",
  "/maintenance/index.html": "Maintenance Enrollment (Demo)",
  "/maintenance/appliance-signup.html": "Maintenance Appliance Signup",
  "/maintenance/hvac-signup.html": "Maintenance HVAC Signup",
  "/maintenance/confirmation.html": "Maintenance Enrollment Confirmation",
  "/maintenance/admin.html": "Maintenance Command Center",
  "/maintenance/household.html": "Maintenance Household Profile",
  "/maintenance/quote-builder.html": "Maintenance Quote Builder",
  "/maintenance/quote-view.html": "Maintenance Quote View",
  "/maintenance/tech-maintenance.html": "Maintenance Field Tool",
  "/maintenance/report-view.html": "Appliance Health Report View"
};

// Category groupings for the User Admin permission UI. A page may appear in
// multiple categories (it is still one underlying permission); any manageable
// page not listed here lands in an automatic "Other" bucket in the UI.
const PAGE_CATEGORIES = [
  {
    key: "hr",
    label: "HR",
    pages: ["/hr-phone-screen.html", "/hr-candidates.html"]
  },
  {
    key: "test_modules",
    label: "Test Modules",
    pages: [
      "/satisfaction-survey.html",
      "/satisfaction-results.html",
      "/case-visit-survey.html",
      "/case-visit-results.html",
      "/maintenance/index.html",
      "/maintenance/appliance-signup.html",
      "/maintenance/hvac-signup.html",
      "/maintenance/confirmation.html",
      "/maintenance/admin.html",
      "/maintenance/household.html",
      "/maintenance/quote-builder.html",
      "/maintenance/quote-view.html",
      "/maintenance/tech-maintenance.html",
      "/maintenance/report-view.html"
    ]
  },
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
      "/refund-dashboard.html",
      "/incoming-payouts.html",
      "/bank-balancing.html",
      "/link-detail-lookup.html",
      "/credit-applications.html"
    ]
  },
  {
    key: "client_care",
    label: "Client Care",
    pages: [
      "/appliance-service-calls.html",
      "/archive-service-calls.html",
      "/service-estimates.html",
      "/service-order-health.html",
      "/shopper-profiles.html",
      "/intent-lookup.html",
      "/link-detail-lookup.html",
      "/paid-order-detail.html"
    ]
  },
  {
    key: "delivery",
    label: "Delivery",
    pages: ["/dispatch.html", "/driver.html"]
  },
  {
    key: "automations",
    label: "Automations",
    pages: ["/message-automations.html"]
  },
  {
    key: "sales",
    label: "Sales",
    pages: [
      "/salesdashboard.html",
      "/my-commissions.html",
      "/shop-orders.html",
      "/sales-order-health.html",
      "/quote-follow-up.html",
      "/epass-uploads.html",
      "/aging-inventory.html",
      "/terms-signatures.html",
      "/flag-closures.html",
      "/target-builder.html",
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
  "/secret-menu": "/secret-menu.html"
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

function isShopPublicPath(pathname) {
  return (
    SHOP_PUBLIC_PATHS.has(pathname) ||
    SHOP_PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
  );
}

function isAlwaysPublicPath(pathname) {
  // Signature headshots are fetched by email clients with no cookies.
  if (/^\/public\/signature-photos\/[0-9a-fA-F-]{36}$/.test(pathname)) {
    return true;
  }
  // Samsara webhooks arrive with no session; guarded by the key in the URL.
  if (/^\/api\/samsara\/webhook\//.test(pathname)) {
    return true;
  }
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

  if (EVERYONE_PAGE_PATHS.has(pathname)) {
    return true; // every signed-in user
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
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: Inter, system-ui, sans-serif; background: linear-gradient(180deg, #eaf4ec 0%, #f7f8fc 100%); color: #1f2937; padding: 24px; }
    .card { width: min(100%, 480px); background: #fff; border: 1px solid rgba(33, 105, 44, 0.12); border-radius: 18px; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.08); padding: 28px; text-align: center; }
    h1 { margin: 0 0 10px; font-size: 32px; }
    p { margin: 0 0 18px; color: #6b7280; line-height: 1.6; }
    a { display: inline-flex; align-items: center; justify-content: center; padding: 12px 16px; border-radius: 12px; background: #21692c; color: #fff; text-decoration: none; font-weight: 700; }
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

// Does this signed-in user hold a specific page grant? (Executives always
// count as holding every page.) Used for in-handler checks where a route is
// gated by one page but a sub-action needs another.
async function userHoldsPage(user, pagePath) {
  if (!user) return false;
  if (isExecutiveUser(user)) return true;
  if (user.kind !== "db") return false;
  try {
    const pages = await getGrantedPagesForUser(user.id);
    return pages.includes(pagePath);
  } catch {
    return false;
  }
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

  if (host === SHOP_PUBLIC_HOST && INTERNAL_PAGE_PATHS.has(req.path)) {
    return res.redirect(302, buildHostUrl(req, DASHBOARD_HOST));
  }

  if (host === DASHBOARD_HOST && req.path !== "/" && SERVICE_PUBLIC_PATHS.has(req.path)) {
    return res.redirect(302, buildHostUrl(req, SERVICE_PUBLIC_HOST));
  }

  // shop.html lives on the shop host only.
  if (host !== SHOP_PUBLIC_HOST && req.path === "/shop.html") {
    return res.redirect(302, buildHostUrl(req, SHOP_PUBLIC_HOST));
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
  const isPublicShopRequest =
    (host === SHOP_PUBLIC_HOST || isLocalHost(host)) &&
    isShopPublicPath(req.path);
  const isUnauthenticatedInternalPage =
    (host === DASHBOARD_HOST || isLocalHost(host)) &&
    UNAUTHENTICATED_INTERNAL_PATHS.has(req.path);
  const isPublicAuthRequest =
    (host === DASHBOARD_HOST || isLocalHost(host)) &&
    isPublicAuthPath(req.path);

  if (isWebhookRequest || isPublicServiceRequest || isPublicShopRequest || isUnauthenticatedInternalPage || isPublicAuthRequest) {
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

// User-clicked emails keep the verified base from address but stamp the
// signed-in sender as reply_to, so client replies land in that person's
// inbox. reply_to is a per-message Resend field — no dashboard config, no
// verification needed. Automated sends (webhooks, sweeps) omit it.
function userReplyTo(req) {
  const email = String(req?.authUser?.email || "").trim();
  if (!email) return undefined;
  const name = String(req.authUser?.displayName || "").trim();
  return name ? `${name} <${email}>` : email;
}

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
        <a href="${buttonUrl}" style="display: inline-block; padding: 12px 20px; border-radius: 10px; background: #21692c; color: #ffffff; text-decoration: none; font-weight: 700;">${escapeHtmlForEmail(buttonLabel)}</a>
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
    // Vertical order of the dashboard module cards (e.g. ["queue","paid"]).
    dashboardModules: req.authUser.kind === "db"
      ? (req.authUser.preferences?.dashboardModules || null)
      : null,
    // Preferred default filters for the payments dashboard:
    // { employee: "self" | "all" | "<CODE>", department: "all" | "<name>" }
    dashboardView: req.authUser.kind === "db"
      ? (req.authUser.preferences?.dashboardView || null)
      : null,
    canCustomizeDashboard: req.authUser.kind === "db",
    // Preferred color scheme ("green" | "red" | "purple") — internal-shell.js
    // applies it as data-theme on <html>. Legacy sessions get the default.
    theme: req.authUser.kind === "db"
      ? (req.authUser.preferences?.theme || "green")
      : "green"
  });
});

// Save the signed-in user's color scheme. Legacy shared logins have no
// profile row, so their choice only lives in the browser's local cache.
app.post("/api/me/theme", async (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const theme = String(req.body?.theme || "").trim();
  if (!["green", "red", "purple"].includes(theme)) {
    return res.status(400).json({ error: "Unknown color scheme." });
  }
  if (req.authUser.kind !== "db") {
    return res.json({ success: true, saved: false, theme });
  }
  try {
    await setUserPreferences(req.authUser.id, { theme });
    return res.json({ success: true, saved: true, theme });
  } catch (err) {
    console.error("Save theme failed:", err.message);
    return res.status(500).json({ error: "Unable to save your color scheme." });
  }
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

// Save the signed-in user's dashboard module order (the vertical arrangement
// of the module cards). Personal setting, mirrors dashboard-slots.
const DASHBOARD_MODULE_IDS = ["queue", "paid", "revenue", "health", "bonus", "webshop"];

app.post("/api/me/dashboard-modules", async (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (req.authUser.kind !== "db") {
    return res.status(400).json({
      error: "Sign in with your individual account to arrange your dashboard modules."
    });
  }

  const raw = Array.isArray(req.body?.order) ? req.body.order : null;
  if (!raw) {
    return res.status(400).json({ error: "Send { order: [moduleId, ...] }." });
  }

  // Up to three slots, one position per module.
  const order = [];
  for (const value of raw.slice(0, 3)) {
    const id = String(value || "").trim();
    if (!DASHBOARD_MODULE_IDS.includes(id)) {
      return res.status(400).json({ error: `Unknown module: ${id}` });
    }
    if (!order.includes(id)) order.push(id);
  }

  try {
    const preferences = await setUserPreferences(req.authUser.id, { dashboardModules: order });
    return res.json({ success: true, dashboardModules: preferences.dashboardModules || [] });
  } catch (err) {
    console.error("Save dashboard modules failed:", err.message);
    return res.status(500).json({ error: "Unable to save your module order." });
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

async function buildPresetsPayload() {
  const presets = {};
  for (const group of await listPermissionGroups()) {
    const pages = expandPermissionGroupPages(group.pages);
    if (pages.length) {
      presets[group.key] = { label: group.label, pages, allPages: (group.pages || []).includes("*"), key: group.key };
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
      presets: await buildPresetsPayload(),
      jobTitles: await listJobTitles(),
      departments: await listDepartments(),
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

// ---------------------------------------------------------------------------
// Job titles & codes editor (User Admin, executives only). Titles double as
// the commission-plan selector and notification routing; codes are the
// quick-assign permission presets. Renaming a title migrates every holder.
// ---------------------------------------------------------------------------

app.post("/api/admin/job-titles", requireExecutiveApi, async (req, res) => {
  try {
    const nameError = validateJobTitleName(req.body?.name);
    if (nameError) return res.status(400).json({ error: nameError });
    const result = await createJobTitle({ name: req.body.name, code: req.body?.code, notifyWebOrders: Boolean(req.body?.notifyWebOrders) });
    if (!result.ok) return res.status(400).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "job_title_created", targetUserId: null,
      detail: { name: result.title.name, code: result.title.code, notifyWebOrders: result.title.notifyWebOrders }
    }).catch(() => {});
    return res.json({ ok: true, title: result.title });
  } catch (err) {
    console.error("Job title create failed:", err.message);
    return res.status(500).json({ error: "Unable to create the title." });
  }
});

app.patch("/api/admin/job-titles/:id", requireExecutiveApi, async (req, res) => {
  try {
    const nameError = validateJobTitleName(req.body?.name);
    if (nameError) return res.status(400).json({ error: nameError });
    const result = await updateJobTitle({
      id: Number(req.params.id),
      name: req.body.name,
      code: req.body?.code,
      notifyWebOrders: Boolean(req.body?.notifyWebOrders)
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "job_title_updated", targetUserId: null,
      detail: { name: result.title.name, code: result.title.code, oldName: result.oldName, migrated: result.migrated, notifyWebOrders: result.title.notifyWebOrders }
    }).catch(() => {});
    return res.json({ ok: true, title: result.title, migrated: result.migrated });
  } catch (err) {
    console.error("Job title update failed:", err.message);
    return res.status(500).json({ error: "Unable to update the title." });
  }
});

app.delete("/api/admin/job-titles/:id", requireExecutiveApi, async (req, res) => {
  try {
    const result = await deleteJobTitle(Number(req.params.id));
    if (!result.ok) return res.status(result.inUse ? 409 : 404).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "job_title_deleted", targetUserId: null,
      detail: { name: result.name }
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("Job title delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the title." });
  }
});

function cleanPermissionGroupPages(pages) {
  if (!Array.isArray(pages)) return [];
  if (pages.includes("*")) return ["*"];
  return [...new Set(pages.filter((p) => MANAGEABLE_PAGE_PATHS.includes(p)))];
}

app.post("/api/admin/permission-groups", requireExecutiveApi, async (req, res) => {
  try {
    const pages = cleanPermissionGroupPages(req.body?.pages);
    if (!pages.length) return res.status(400).json({ error: "Pick at least one page for this permission group." });
    const result = await createPermissionGroup({ label: req.body?.label, pages });
    if (!result.ok) return res.status(400).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "permission_group_created", targetUserId: null,
      detail: { key: result.group.key, label: result.group.label, pages: result.group.pages }
    }).catch(() => {});
    return res.json({ ok: true, group: result.group });
  } catch (err) {
    console.error("Permission group create failed:", err.message);
    return res.status(500).json({ error: "Unable to create the permission group." });
  }
});

app.patch("/api/admin/permission-groups/:key", requireExecutiveApi, async (req, res) => {
  try {
    const pages = cleanPermissionGroupPages(req.body?.pages);
    if (!pages.length) return res.status(400).json({ error: "Pick at least one page for this permission group." });
    const result = await updatePermissionGroup({ key: req.params.key, label: req.body?.label, pages });
    if (!result.ok) return res.status(404).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "permission_group_updated", targetUserId: null,
      detail: { key: result.group.key, label: result.group.label, pages: result.group.pages }
    }).catch(() => {});
    return res.json({ ok: true, group: result.group });
  } catch (err) {
    console.error("Permission group update failed:", err.message);
    return res.status(500).json({ error: "Unable to update the permission group." });
  }
});

app.delete("/api/admin/permission-groups/:key", requireExecutiveApi, async (req, res) => {
  try {
    const result = await deletePermissionGroup(req.params.key);
    if (!result.ok) return res.status(404).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "permission_group_deleted", targetUserId: null,
      detail: { key: req.params.key, label: result.label }
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("Permission group delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the permission group." });
  }
});

// ---- Departments (same editor pattern: permanent code, relabelable name) ----

app.post("/api/admin/departments", requireExecutiveApi, async (req, res) => {
  try {
    const result = await createDepartment({ name: req.body?.name, code: req.body?.code });
    if (!result.ok) return res.status(400).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "department_created", targetUserId: null,
      detail: { name: result.department.name, code: result.department.code }
    }).catch(() => {});
    return res.json({ ok: true, department: result.department });
  } catch (err) {
    console.error("Department create failed:", err.message);
    return res.status(500).json({ error: "Unable to create the department." });
  }
});

app.patch("/api/admin/departments/:id", requireExecutiveApi, async (req, res) => {
  try {
    const result = await updateDepartment({ id: Number(req.params.id), name: req.body?.name, code: req.body?.code });
    if (!result.ok) return res.status(400).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "department_updated", targetUserId: null,
      detail: { name: result.department.name, code: result.department.code, oldName: result.oldName, migrated: result.migrated }
    }).catch(() => {});
    return res.json({ ok: true, department: result.department, migrated: result.migrated });
  } catch (err) {
    console.error("Department update failed:", err.message);
    return res.status(500).json({ error: "Unable to update the department." });
  }
});

app.delete("/api/admin/departments/:id", requireExecutiveApi, async (req, res) => {
  try {
    const result = await deleteDepartment(Number(req.params.id));
    if (!result.ok) return res.status(result.inUse ? 409 : 404).json({ error: result.error });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "department_deleted", targetUserId: null,
      detail: { name: result.name }
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("Department delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the department." });
  }
});

app.post("/api/admin/users/:userId/preset", requireExecutiveApi, async (req, res) => {
  try {
    const userRow = await getUserById(req.params.userId);
    if (!userRow) {
      return res.status(404).json({ error: "User not found." });
    }

    const presetKey = String(req.body?.preset || "");
    const presetPages = await expandJobCodePresetPages(presetKey);

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
      customerAddress = "",
      customerPhone = "",
      customerEmail = "",
      customerNotes = "",
      modelNumbers = [],
      modelGroups = null
    } = req.body || {};

    const models = (Array.isArray(modelNumbers) ? modelNumbers : String(modelNumbers).split(/[\n,]/))
      .map((m) => String(m).trim())
      .filter(Boolean);

    // v1.3 grouped models (Scan & Build): { "Kitchen": ["WRF535..."], ... }.
    // Groups pre-assemble the PSP Editor sections on Steel Cod's side.
    const groups = {};
    if (modelGroups && typeof modelGroups === "object" && !Array.isArray(modelGroups)) {
      const entries = Object.entries(modelGroups).slice(0, 8);
      for (const [groupTitle, groupModels] of entries) {
        const cleanTitle = String(groupTitle || "").trim().slice(0, 60);
        const cleanModels = (Array.isArray(groupModels) ? groupModels : String(groupModels).split(/[\n,]/))
          .map((m) => String(m).trim())
          .filter(Boolean);
        if (cleanTitle && cleanModels.length) groups[cleanTitle] = cleanModels;
      }
    }
    const usingGroups = Object.keys(groups).length > 0;

    if (!usingGroups && !models.length) {
      return res.status(400).json({ error: "Enter at least one model number." });
    }

    if (!String(customerName).trim()) {
      return res.status(400).json({ error: "Client / project name is required." });
    }

    if (!String(customerPhone).trim()) {
      return res.status(400).json({ error: "Customer phone is required." });
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
        notes: [String(customerAddress || "").trim(), String(customerNotes || "").trim()]
          .filter(Boolean)
          .join(" — ")
      },
      modelNumbers: usingGroups ? [] : models,
      modelGroups: usingGroups ? groups : null
    });

    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to create the spec package.");
  }
});

// v1.3 curate: include/exclude one document in an existing package. The
// public and slim PDFs update on Steel Cod's side immediately.
app.post("/api/spec-packages/:navId/toggle-document", requirePagePermission("/spec-packages.html"), async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const xUid = String(req.body?.xUid || "").trim();
    if (!xUid) {
      return res.status(400).json({ error: "Missing document id (xUid)." });
    }
    const include = typeof req.body?.include === "boolean" ? req.body.include : undefined;
    const result = await toggleDocumentInclusion({
      userEmail,
      navId: req.params.navId,
      xUid,
      include
    });
    return res.json(result);
  } catch (err) {
    return sendSteelCodError(res, err, "Unable to update that document.");
  }
});

// On-demand merged PDF (ePASS quote + spec pages) served INLINE so the team
// can view the finished package in the browser right after create — and
// again after curating, since it re-fetches the current spec PDF each time.
app.get("/api/spec-packages/:navId/merged.pdf", requirePagePermission("/spec-packages.html"), async (req, res) => {
  const userEmail = resolveSteelCodUserEmail(req, res);
  if (!userEmail) return;

  try {
    const quoteId = String(req.query.quoteId || "").trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(quoteId)) {
      return res.status(400).json({ error: "A stored quote id is required for the merged view." });
    }
    const quote = await getSpecQuote(quoteId);
    if (!quote) {
      return res.status(404).json({ error: "That quote is no longer in the library." });
    }

    const variant = String(req.query.variant || "slim").toLowerCase() === "full" ? "full" : "slim";
    const position = normalizeQuotePosition(req.query.quotePosition);
    const { mergedBytes } = await buildMergedQuotePdf({
      userEmail,
      navId: req.params.navId,
      quoteBytes: quote.bytes,
      variant,
      position
    });

    const base = String(req.query.name || req.params.navId)
      .replace(/[^A-Za-z0-9 ._-]+/g, "").trim().slice(0, 60) || "spec-package";
    const disposition = String(req.query.download || "") === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="${base}-complete.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error("Merged view failed:", err.message);
    const message = (err.userFacing || err instanceof SteelCodError) ? err.message : "Unable to build the merged PDF.";
    return res.status(400).json({ error: message });
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

// Everyone with access to the Spec Packages page — powers the Quote Library
// uploader filter, so the dropdown shows the whole team (not just people who
// happen to have uploads right now). Must be registered BEFORE /:navId.
app.get("/api/spec-packages/team", requirePagePermission("/spec-packages.html"), async (req, res) => {
  try {
    const users = await listUsersWithAccess();
    const team = users
      .filter((u) => u.status === "active")
      .filter((u) => u.isExecutive ||
        (Array.isArray(u.grantedPages) && u.grantedPages.includes("/spec-packages.html")))
      .map((u) => ({ email: u.email, name: u.displayName || u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.json({ team });
  } catch (err) {
    console.error("Spec package team list failed:", err.message);
    return res.status(500).json({ error: "Unable to load the team list." });
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

// Merged quote PDFs are handed back via a one-time GET download rather than
// streamed as the POST response — a binary attachment returned to fetch() is
// blocked by some Edge/security setups (surfaces as "Failed to fetch"
// / net::ERR_FAILED). The POST returns a token; the browser downloads via a
// normal navigation the filters trust.
// Quote PDFs are uploaded via a NATIVE browser form (multipart), because some
// endpoint security blocks both raw binary fetch uploads AND JavaScript
// reading local files. The result is returned to a hidden iframe as an HTML
// page that postMessages the parent — no fetch, no JS file read anywhere.
const specQuoteUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

function specQuoteUploadMw(req, res, next) {
  specQuoteUpload.single("quote")(req, res, (err) => {
    if (err) {
      const origin = `${req.protocol}://${req.get("host")}`;
      const msg = err.code === "LIMIT_FILE_SIZE" ? "That PDF is too large (40 MB max)." : "Upload failed — try again.";
      return sendMergeResult(res, origin, { ok: false, error: msg });
    }
    next();
  });
}

// Render the hidden-iframe response that hands the result back to the page.
function sendMergeResult(res, origin, payload) {
  // Post to "*"; the receiving page verifies event.origin. Pinning a computed
  // origin risks a silent mismatch on a multi-domain deployment.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // The global X-Frame-Options is DENY (clickjacking protection), but THIS
  // response exists solely to render inside our own hidden iframe — DENY
  // blocks that on every machine and the page never hears the result.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  return res.send(
    "<!doctype html><html><body>Done. You can close this.<script>" +
    "try{parent.postMessage({specMerge:" + json + "},\"*\");}catch(e){}" +
    "</script></body></html>"
  );
}

const pendingQuoteMerges = new Map(); // token -> { bytes, filename, email, expiresAt }
const QUOTE_MERGE_TTL_MS = 5 * 60 * 1000;

function sweepQuoteMerges() {
  const now = Date.now();
  for (const [token, entry] of pendingQuoteMerges) {
    if (entry.expiresAt <= now) pendingQuoteMerges.delete(token);
  }
}

// Append the compiled spec pages (slim or full) to the end of an uploaded
// sales order / quote PDF and return the merged document. User-initiated
// from the Spec Packages page; nothing is stored server-side. The package
// is looked up via Steel Cod as the acting user — the client never supplies
// a download URL, so this cannot be used to fetch arbitrary content.
app.post(
  "/api/spec-packages/:navId/attach-quote",
  requirePagePermission("/spec-packages.html"),
  specQuoteUploadMw,
  async (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    const fail = (error) => sendMergeResult(res, origin, { ok: false, error });

    if (!isSteelCodConfigured()) return fail("Steel Cod is not configured yet.");
    const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
    if (!userEmail || !userEmail.includes("@")) {
      return fail("Sign in with your individual account to use Spec Packages.");
    }

    const quoteBytes = req.file?.buffer;
    if (!Buffer.isBuffer(quoteBytes) || quoteBytes.length < 5) {
      return fail("Choose the sales order / quote PDF.");
    }
    if (quoteBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return fail("The uploaded file does not look like a PDF.");
    }

    const variant = String(req.body?.variant || "slim").toLowerCase() === "full" ? "full" : "slim";

    try {
      const { token, filename } = await performQuoteSpecMerge({
        userEmail,
        navId: req.params.navId,
        quoteBytes,
        variant,
        baseName: req.body?.name,
        position: normalizeQuotePosition(req.body?.quotePosition)
      });
      return sendMergeResult(res, origin, { ok: true, token, filename });
    } catch (err) {
      console.error("attach-quote failed:", err.message);
      return fail(
        (err.userFacing || err instanceof SteelCodError)
          ? err.message
          : "Unable to attach the spec pages to the quote."
      );
    }
  }
);

const specUserError = (message) => Object.assign(new Error(message), { userFacing: true });

// Download a package's compiled spec PDF (slim or full) from Steel Cod, as
// the acting user. Shared by merge and email.
async function fetchSpecPdf({ userEmail, navId, variant }) {
  const pkg = await retrieveSpecPackage({ userEmail, navId });
  const publicUrl = findSpecPackageUrl(pkg, navId);

  console.log(
    "attach-quote:", navId,
    "| retrieve shape:", JSON.stringify(describeShape(pkg)),
    "| resolved URL:", publicUrl || "(none)"
  );

  if (!publicUrl) {
    console.error(
      "Steel Cod retrieve returned no recognizable URL for navId",
      navId,
      "— response shape:",
      JSON.stringify(describeShape(pkg))
    );
    throw specUserError("Steel Cod did not return a URL for that spec package.");
  }

  const urls = buildSpecPackageUrls(publicUrl);
  if (!urls) {
    throw specUserError("Steel Cod did not return a URL for that spec package.");
  }

  const specUrl = variant === "full" ? urls.download : urls.slimDownload;
  let specResponse;
  try {
    specResponse = await fetch(specUrl);
  } catch (err) {
    throw specUserError(`Unable to reach Steel Cod to download the spec PDF: ${err.message}`);
  }
  if (!specResponse.ok) {
    console.error("attach-quote: spec PDF download failed", specResponse.status, "from", specUrl);
    throw specUserError(`Unable to download the spec PDF from Steel Cod (HTTP ${specResponse.status}).`);
  }

  const specBytes = Buffer.from(await specResponse.arrayBuffer());
  if (specBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    console.error(
      "attach-quote: non-PDF response from", specUrl,
      "| content-type:", specResponse.headers.get("content-type"),
      "| first bytes:", specBytes.subarray(0, 40).toString("latin1").replace(/[^\x20-\x7e]/g, ".")
    );
    throw specUserError("Steel Cod returned something that is not a PDF for this package.");
  }

  return specBytes;
}

// Merge a quote PDF with the package's spec pages. `position` is where the
// QUOTE sits: "front" (quote first, specs appended — the classic layout) or
// "back" (specs first, quote at the end). Returns raw bytes.
async function buildMergedQuotePdf({ userEmail, navId, quoteBytes, variant, position = "front" }) {
  const specBytes = await fetchSpecPdf({ userEmail, navId, variant });

  let quoteDoc;
  try {
    quoteDoc = await PDFDocument.load(quoteBytes);
  } catch (loadErr) {
    console.error("attach-quote: quote PDF failed to parse:", loadErr.message);
    throw specUserError("Could not read the quote PDF. Is it password-protected or corrupted?");
  }

  let specDoc;
  try {
    specDoc = await PDFDocument.load(specBytes);
  } catch (loadErr) {
    console.error("attach-quote: Steel Cod spec PDF failed to parse:", loadErr.message);
    throw specUserError("Could not read the spec PDF returned by Steel Cod.");
  }

  const merged = await PDFDocument.create();
  const sources = position === "back" ? [specDoc, quoteDoc] : [quoteDoc, specDoc];
  for (const src of sources) {
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  return { mergedBytes: Buffer.from(await merged.save()), specBytes };
}

function normalizeQuotePosition(value) {
  return String(value || "front").toLowerCase() === "back" ? "back" : "front";
}

// Stage a merged PDF for one-time download (see quote-download route).
async function performQuoteSpecMerge({ userEmail, navId, quoteBytes, variant, baseName, position = "front" }) {
  const { mergedBytes } = await buildMergedQuotePdf({ userEmail, navId, quoteBytes, variant, position });

  const safeName =
    String(baseName || "quote")
      .replace(/[^A-Za-z0-9 ._-]+/g, "")
      .trim()
      .slice(0, 80) || "quote";

  sweepQuoteMerges();
  const downloadToken = crypto.randomBytes(24).toString("hex");
  const filename = `${safeName}-with-specs.pdf`;
  pendingQuoteMerges.set(downloadToken, {
    bytes: mergedBytes,
    filename,
    email: userEmail,
    expiresAt: Date.now() + QUOTE_MERGE_TTL_MS
  });

  return { token: downloadToken, filename };
}

// Merge using a quote already in the Quote Library — plain JSON, no upload,
// so it works from machines whose security blocks browser file uploads.
app.post(
  "/api/spec-packages/:navId/attach-quote-library",
  requirePagePermission("/spec-packages.html"),
  async (req, res) => {
    try {
      if (!isSteelCodConfigured()) {
        return res.status(503).json({ error: "Steel Cod is not configured yet." });
      }
      const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
      if (!userEmail || !userEmail.includes("@")) {
        return res.status(400).json({ error: "Sign in with your individual account to use Spec Packages." });
      }

      const quoteId = String(req.body?.quoteId || "").trim();
      if (!/^[0-9a-fA-F-]{36}$/.test(quoteId)) {
        return res.status(400).json({ error: "Pick a quote from the library first." });
      }

      const quote = await getSpecQuote(quoteId);
      if (!quote) {
        return res.status(404).json({ error: "That quote is no longer in the library (quotes purge after 90 days)." });
      }

      const variant = String(req.body?.variant || "slim").toLowerCase() === "full" ? "full" : "slim";
      const baseName = String(req.body?.name || "").trim() || quote.filename.replace(/\.pdf$/i, "");

      const { token, filename } = await performQuoteSpecMerge({
        userEmail,
        navId: req.params.navId,
        quoteBytes: quote.bytes,
        variant,
        baseName,
        position: normalizeQuotePosition(req.body?.quotePosition)
      });

      return res.json({ ok: true, token, filename });
    } catch (err) {
      console.error("attach-quote-library failed:", err.message);
      const message = err.userFacing || err instanceof SteelCodError
        ? err.message
        : "Unable to attach the spec pages to the quote.";
      return res.status(400).json({ error: message });
    }
  }
);

// Email the finished documents (complete merged package / specs only / ePASS
// file only) to the chosen recipients via Resend with attachments.
app.post("/api/spec-packages/:navId/email", requirePagePermission("/spec-packages.html"), async (req, res) => {
  try {
    if (!isSteelCodConfigured()) return res.status(503).json({ error: "Steel Cod is not configured yet." });
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." });
    }
    const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
    if (!userEmail || !userEmail.includes("@")) {
      return res.status(400).json({ error: "Sign in with your individual account to use Spec Packages." });
    }

    const recipients = (Array.isArray(req.body?.recipients) ? req.body.recipients : [])
      .map((r) => String(r || "").trim().toLowerCase())
      .filter(Boolean);
    const uniqueRecipients = [...new Set(recipients)];
    if (!uniqueRecipients.length || uniqueRecipients.length > 10) {
      return res.status(400).json({ error: "Provide 1–10 recipient email addresses." });
    }
    for (const email of uniqueRecipients) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: `"${email}" is not a valid email address.` });
      }
    }

    const contents = req.body?.contents || {};
    const wantComplete = Boolean(contents.complete);
    const wantSpecs = Boolean(contents.specsOnly);
    const wantEpass = Boolean(contents.epassOnly);
    if (!wantComplete && !wantSpecs && !wantEpass) {
      return res.status(400).json({ error: "Pick at least one document to send." });
    }

    const variant = String(req.body?.variant || "slim").toLowerCase() === "full" ? "full" : "slim";
    const position = normalizeQuotePosition(req.body?.quotePosition);
    const quoteId = String(req.body?.quoteId || "").trim();

    let quoteBytes = null;
    if (wantComplete || wantEpass) {
      if (!/^[0-9a-fA-F-]{36}$/.test(quoteId)) {
        return res.status(400).json({ error: "The complete package and ePASS file need a scanned or library quote." });
      }
      const quote = await getSpecQuote(quoteId);
      if (!quote) {
        return res.status(404).json({ error: "That quote is no longer in the library." });
      }
      quoteBytes = quote.bytes;
    }

    const base = String(req.body?.salesOrder || req.params.navId)
      .replace(/[^A-Za-z0-9 ._-]+/g, "").trim().slice(0, 60) || "spec-package";

    const attachments = [];
    if (wantComplete) {
      const { mergedBytes } = await buildMergedQuotePdf({
        userEmail, navId: req.params.navId, quoteBytes, variant, position
      });
      attachments.push({ filename: `${base}-complete.pdf`, content: mergedBytes.toString("base64") });
    }
    if (wantSpecs) {
      const specBytes = await fetchSpecPdf({ userEmail, navId: req.params.navId, variant });
      attachments.push({ filename: `${base}-specs-${variant}.pdf`, content: specBytes.toString("base64") });
    }
    if (wantEpass) {
      attachments.push({ filename: `${base}-sales-order.pdf`, content: Buffer.from(quoteBytes).toString("base64") });
    }

    // Sign with the salesperson's name (matched from Users by the form's
    // salesperson email) so the email reads like it came from a person.
    let salespersonName = "";
    const salespersonEmail = String(req.body?.salespersonEmail || "").trim();
    if (salespersonEmail && salespersonEmail.includes("@")) {
      try {
        const salespersonRow = await findUserByEmail(salespersonEmail);
        salespersonName = salespersonRow?.display_name || "";
      } catch (lookupErr) {
        console.error("Salesperson lookup failed:", lookupErr.message);
      }
    }

    const subject = "Specification Documents from Wilson AC & Appliance";
    const bodyText = [
      "Hello,",
      "",
      "Attached are the documents for your order" + (req.body?.salesOrder ? ` ${req.body.salesOrder}` : "") + ":",
      ...attachments.map((a) => `• ${a.filename}`),
      "",
      "Questions? Call or text Wilson AC & Appliance at 512-894-0907.",
      "",
      ...(salespersonName ? [salespersonName] : []),
      "Wilson AC & Appliance",
      "4205 E Hwy 290",
      "Dripping Springs, TX 78620"
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        reply_to: userReplyTo(req),
        to: uniqueRecipients,
        subject,
        text: bodyText,
        attachments
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Spec package email failed:", response.status, errorText);
      return res.status(502).json({ error: "The email service rejected the message — try again in a minute." });
    }

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser?.id || null,
      action: "spec_package_emailed",
      targetUserId: null,
      detail: { navId: req.params.navId, salesOrder: req.body?.salesOrder || "", to: uniqueRecipients, files: attachments.map((a) => a.filename) }
    }).catch(() => {});

    return res.json({ success: true, sent: uniqueRecipients.length, files: attachments.map((a) => a.filename) });
  } catch (err) {
    console.error("Spec package email error:", err.message);
    const message = (err.userFacing || err instanceof SteelCodError) ? err.message : "Unable to email the documents.";
    return res.status(400).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Quote Library — upload once (from any machine), reuse for merges anywhere.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Email Signature Builder — headshot upload (native form -> hidden iframe,
// same pattern as the quote library so endpoint security can't block it) and
// the public image route email clients load the picture from.
// ---------------------------------------------------------------------------

const signaturePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function sendSignaturePhotoResult(res, payload) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN"); // must be frameable by our page
  return res.send(
    "<!doctype html><html><body>Done. You can close this.<script>" +
    "try{parent.postMessage({signaturePhoto:" + json + "},\"*\");}catch(e){}" +
    "</script></body></html>"
  );
}

function signaturePhotoUploadMw(req, res, next) {
  signaturePhotoUpload.single("photo")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "That image is too large (8 MB max)." : "Upload failed — try again.";
      return sendSignaturePhotoResult(res, { ok: false, error: msg });
    }
    next();
  });
}

function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  return null;
}

function buildSignaturePhotoUrl(req, id) {
  const protocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || req.protocol || "https";
  return `${protocol}://${getRequestHost(req)}/public/signature-photos/${id}`;
}

app.post("/api/signature-photo", requirePagePermission("/signature-builder.html"), signaturePhotoUploadMw, async (req, res) => {
  try {
    const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
    if (!userEmail || !userEmail.includes("@")) {
      return sendSignaturePhotoResult(res, { ok: false, error: "Sign in with your individual account to upload a photo." });
    }

    const bytes = req.file?.buffer;
    const contentType = detectImageType(bytes);
    if (!contentType) {
      return sendSignaturePhotoResult(res, { ok: false, error: "Choose a JPG or PNG photo (a square headshot works best)." });
    }

    const saved = await saveSignaturePhoto({ userEmail, contentType, bytes });
    return sendSignaturePhotoResult(res, {
      ok: true,
      id: saved.id,
      url: buildSignaturePhotoUrl(req, saved.id)
    });
  } catch (err) {
    console.error("Signature photo upload failed:", err.message);
    return sendSignaturePhotoResult(res, { ok: false, error: "Unable to save the photo — try again." });
  }
});

app.get("/api/signature-photo/mine", requirePagePermission("/signature-builder.html"), async (req, res) => {
  try {
    const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
    if (!userEmail) return res.json({ photo: null });
    const photo = await getSignaturePhotoByEmail(userEmail);
    return res.json({
      photo: photo ? { id: photo.id, url: buildSignaturePhotoUrl(req, photo.id), updatedAt: photo.updatedAt } : null
    });
  } catch (err) {
    console.error("Signature photo lookup failed:", err.message);
    return res.json({ photo: null });
  }
});

// PUBLIC: email clients fetch this with no cookies. The unguessable UUID is
// the only thing exposed; the response is just the image.
app.get("/public/signature-photos/:id", async (req, res) => {
  try {
    if (!/^[0-9a-fA-F-]{36}$/.test(req.params.id)) {
      return res.status(400).send("Bad photo id.");
    }
    const photo = await getSignaturePhoto(req.params.id);
    if (!photo) {
      return res.status(404).send("Photo not found.");
    }
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(Buffer.from(photo.bytes));
  } catch (err) {
    console.error("Signature photo serve failed:", err.message);
    return res.status(500).send("Unable to load the photo.");
  }
});

function sendQuoteUploadResult(res, payload) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Same as sendMergeResult: must be frameable by our own page.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  return res.send(
    "<!doctype html><html><body>Done. You can close this.<script>" +
    "try{parent.postMessage({specQuoteUpload:" + json + "},\"*\");}catch(e){}" +
    "</script></body></html>"
  );
}

function quoteLibraryUploadMw(req, res, next) {
  specQuoteUpload.single("quote")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "That PDF is too large (40 MB max)." : "Upload failed — try again.";
      return sendQuoteUploadResult(res, { ok: false, error: msg });
    }
    next();
  });
}

app.post("/api/spec-quotes", requirePagePermission("/spec-packages.html"), quoteLibraryUploadMw, async (req, res) => {
  try {
    const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
    if (!userEmail || !userEmail.includes("@")) {
      return sendQuoteUploadResult(res, { ok: false, error: "Sign in with your individual account to upload quotes." });
    }

    const bytes = req.file?.buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length < 5) {
      return sendQuoteUploadResult(res, { ok: false, error: "Choose a quote PDF first." });
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return sendQuoteUploadResult(res, { ok: false, error: "That file does not look like a PDF." });
    }

    const quote = await saveSpecQuote({
      uploadedByEmail: userEmail,
      uploadedByName: req.authUser?.displayName || "",
      filename: req.file?.originalname || "quote.pdf",
      bytes
    });

    return sendQuoteUploadResult(res, { ok: true, quote });
  } catch (err) {
    console.error("Quote library upload failed:", err.message);
    return sendQuoteUploadResult(res, { ok: false, error: "Unable to save the quote — try again." });
  }
});

// Scanner: pull model numbers out of an ePASS quote PDF so nobody types
// them. Two entry points share the same extractor — an uploaded file (native
// form -> hidden iframe, like every other upload here) and a stored Quote
// Library file (plain JSON).

function sendScanResult(res, payload) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN"); // must render in our own iframe
  return res.send(
    "<!doctype html><html><body>Done. You can close this.<script>" +
    "try{parent.postMessage({specScan:" + json + "},\"*\");}catch(e){}" +
    "</script></body></html>"
  );
}

function scanUploadMw(req, res, next) {
  specQuoteUpload.single("quote")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "That PDF is too large (40 MB max)." : "Upload failed — try again.";
      return sendScanResult(res, { ok: false, error: msg });
    }
    next();
  });
}

app.post("/api/spec-quotes/scan", requirePagePermission("/spec-packages.html"), scanUploadMw, async (req, res) => {
  try {
    const bytes = req.file?.buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length < 5) {
      return sendScanResult(res, { ok: false, error: "Choose the quote PDF first." });
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return sendScanResult(res, { ok: false, error: "That file does not look like a PDF." });
    }

    const data = await extractQuoteDataFromPdfBuffer(bytes);

    // Scanned quotes are saved into the Quote Library automatically — the
    // same upload then powers the merge and the email attachments with no
    // second upload from the user's machine.
    let quote = null;
    const userEmail = req.authUser?.kind === "db" ? req.authUser.email : "";
    if (userEmail) {
      try {
        quote = await saveSpecQuote({
          uploadedByEmail: userEmail,
          uploadedByName: req.authUser?.displayName || "",
          filename: req.file?.originalname || (data.salesOrder ? data.salesOrder.toLowerCase() + ".pdf" : "quote.pdf"),
          bytes
        });
      } catch (saveErr) {
        console.error("Scan library save failed:", saveErr.message);
      }
    }

    return sendScanResult(res, {
      ok: true,
      models: data.models,
      customer: data.customer,
      salesOrder: data.salesOrder,
      quote
    });
  } catch (err) {
    console.error("Quote scan failed:", err.message);
    return sendScanResult(res, { ok: false, error: "Couldn't read that PDF — if it's a scan/image rather than an ePASS export, type the models instead." });
  }
});

app.get("/api/spec-quotes/:id/scan", requirePagePermission("/spec-packages.html"), async (req, res) => {
  try {
    if (!/^[0-9a-fA-F-]{36}$/.test(req.params.id)) {
      return res.status(400).json({ error: "Bad quote id." });
    }
    const quote = await getSpecQuote(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: "That quote is no longer in the library." });
    }
    const data = await extractQuoteDataFromPdfBuffer(quote.bytes);
    return res.json({ models: data.models, customer: data.customer, salesOrder: data.salesOrder, quote: { id: quote.id, filename: quote.filename } });
  } catch (err) {
    console.error("Library quote scan failed:", err.message);
    return res.status(500).json({ error: "Couldn't read that PDF — if it's a scan/image rather than an ePASS export, type the models instead." });
  }
});

app.get("/api/spec-quotes", requirePagePermission("/spec-packages.html"), async (req, res) => {
  try {
    return res.json({ quotes: await listSpecQuotes() });
  } catch (err) {
    console.error("Quote library list failed:", err.message);
    return res.status(500).json({ error: "Unable to load the quote library." });
  }
});

app.get("/api/spec-quotes/:id/pdf", requirePagePermission("/spec-packages.html"), async (req, res) => {
  try {
    if (!/^[0-9a-fA-F-]{36}$/.test(req.params.id)) {
      return res.status(400).send("Bad quote id.");
    }
    const quote = await getSpecQuote(req.params.id);
    if (!quote) {
      return res.status(404).send("That quote is no longer in the library.");
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${quote.filename.replace(/"/g, "")}"`);
    return res.send(quote.bytes);
  } catch (err) {
    console.error("Quote library view failed:", err.message);
    return res.status(500).send("Unable to load that quote.");
  }
});

app.delete("/api/spec-quotes/:id", requirePagePermission("/spec-packages.html"), async (req, res) => {
  try {
    if (!/^[0-9a-fA-F-]{36}$/.test(req.params.id)) {
      return res.status(400).json({ error: "Bad quote id." });
    }
    const removed = await deleteSpecQuote(req.params.id, req.authUser?.email || "", isExecutiveUser(req.authUser));
    if (!removed) {
      return res.status(403).json({ error: "Only the uploader (or an executive) can delete a quote." });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Quote library delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete that quote." });
  }
});

// One-time GET download of a merged quote PDF (see note above). A real
// navigation, so download blockers that trip on fetch()-returned binaries
// don't apply.
app.get(
  "/api/spec-packages/quote-download/:token",
  requirePagePermission("/spec-packages.html"),
  (req, res) => {
    const userEmail = resolveSteelCodUserEmail(req, res);
    if (!userEmail) return;

    sweepQuoteMerges();
    const entry = pendingQuoteMerges.get(req.params.token);

    if (!entry || entry.expiresAt <= Date.now()) {
      return res.status(404).send("This download has expired. Re-run the merge from the Spec Packages page.");
    }
    if (entry.email && entry.email !== userEmail) {
      return res.status(403).send("This download belongs to another user.");
    }

    pendingQuoteMerges.delete(req.params.token); // one-time
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${entry.filename}"`);
    return res.send(entry.bytes);
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
    report.currentRate = await getRateForReport(report.year, report.month);
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
    const rates = await listRatePeriods();
    return res.json({ rates });
  } catch (err) {
    console.error("Mileage rates read failed:", err.message);
    return res.status(500).json({ error: "Unable to load mileage rates." });
  }
});

// Executive: add/update a rate period (effective date + per-mile rate).
app.post("/api/admin/mileage-rates", requireExecutiveApi, async (req, res) => {
  try {
    const effectiveFrom = String(req.body?.effectiveFrom || "").trim();
    const rate = Number(req.body?.rate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      return res.status(400).json({ error: "Enter a valid effective date (YYYY-MM-DD)." });
    }
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 10) {
      return res.status(400).json({ error: "Enter a valid per-mile rate (e.g. 0.76)." });
    }
    const saved = await upsertRatePeriod(effectiveFrom, rate, req.authUser.id || null);
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

    // Pick up a commute that was set/changed in the directory after this
    // report was started (draft/denied only — locked reports keep their snapshot).
    if (["draft", "denied"].includes(report.status) && Number(report.commuteMiles) !== Number(commute)) {
      await refreshReportCommute(report.id, commute);
      report.commuteMiles = Number(commute) || 0;
    }

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

// Accounting: mark approved reports as paid (approved -> paid).
app.post("/api/mileage/mark-paid", requirePagePermission("/mileage-review.html"), async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const reportIds = Array.isArray(req.body?.reportIds) ? req.body.reportIds : [];
    if (!reportIds.length) {
      return res.status(400).json({ error: "Select at least one approved report to mark paid." });
    }

    const count = await markMileageReportsPaid(reportIds, user.id || null);
    recordAudit({
      ip: req.ip,
      actorUserId: user.id || null,
      action: "mileage_marked_paid",
      targetUserId: null,
      detail: { count, reportIds: reportIds.slice(0, 100) }
    }).catch(() => {});

    return res.json({ success: true, count });
  } catch (err) {
    console.error("Mileage mark-paid failed:", err.message);
    return res.status(500).json({ error: "Unable to mark reports paid." });
  }
});

// Reviewer: approve (snapshots the year's rate) or deny (with a note).
// Delete a draft month that never entered review — drafts are auto-created
// just by opening the Mileage page, so empty ones pile up in the review list.
app.post("/api/mileage/report/:id/delete", requirePagePermission("/mileage-review.html"), async (req, res) => {
  const user = resolveMileageUser(req, res);
  if (!user) return;
  try {
    const report = await getMileageReportById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found." });
    if (report.status !== "draft") {
      return res.status(400).json({ error: "Only draft months can be deleted. Use Deny to return a submitted month." });
    }

    const removed = await deleteMileageReport(report.id);
    if (!removed) return res.status(404).json({ error: "Report not found." });

    recordAudit({
      ip: req.ip,
      actorUserId: user.id,
      action: "mileage_draft_deleted",
      targetUserId: report.userId,
      detail: { year: report.year, month: report.month, reportId: report.id }
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error("Mileage draft delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the draft." });
  }
});

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
      const rate = await getRateForReport(report.year, report.month);
      if (rate == null) {
        return res.status(400).json({ error: `No mileage rate is set for ${report.year}-${String(report.month).padStart(2, "0")} — add one first.` });
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
    const departments = await listDepartments().catch(() => []);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(
      "window.WILSON_EMPLOYEE_DIRECTORY = " + JSON.stringify(directory, null, 2) + ";\n" +
      "window.WILSON_DEPARTMENTS = " + JSON.stringify(departments.map((d) => d.name)) + ";\n"
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

    // Trailing 6-month serial (Model-line) revenue per code, computed from
    // the Sales Order Detail warehouse — backs the Field Sales $500k
    // qualification check.
    let trailingRevenue = {};
    try {
      const months = (await listCommissionMonths()).slice(0, 6);
      trailingRevenue = serialRevenueByCode(await listCommissionLinesForMonths(months));
    } catch {
      trailingRevenue = {};
    }

    return res.json({ entries, trailingRevenue, trailingMonths: 6 });
  } catch (err) {
    console.error("List employee directory failed:", err.message);
    return res.status(500).json({ error: "Unable to load the employee directory." });
  }
});

app.post("/api/admin/employee-directory", requireExecutiveApi, async (req, res) => {
  try {
    const { code = "", name = "", email = "", department = "", commuteMiles = 0, commissionPlan = "" } = req.body || {};

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

    const plan = String(commissionPlan || "").trim();
    if (plan) {
      const validTitles = await listJobTitles();
      if (!validTitles.some((t) => t.name === plan)) {
        return res.status(400).json({ error: "Choose a job title from the list (or leave it blank)." });
      }
    }

    // Departments come from the DB vocabulary (User Admin editor). Pages
    // match on these strings (Send Payment Link, dashboard filters, refund
    // dashboard), so variants like "client care" are normalized to the
    // canonical spelling and unknown values rejected.
    const rawDepartment = String(department || "").trim();
    let normalizedDepartment = "";
    if (rawDepartment) {
      const validDepartments = await listDepartments();
      normalizedDepartment = validDepartments.find(
        (d) => d.name.toLowerCase() === rawDepartment.toLowerCase()
      )?.name || "";
      if (!normalizedDepartment) {
        return res.status(400).json({ error: "Choose a department from the list (or leave it blank)." });
      }
    }

    const entry = await upsertEmployeeDirectoryEntry(
      { code, name, email: trimmedEmail, department: normalizedDepartment, commuteMiles: commute, commissionPlan: plan },
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
      detail: { code: entry.code, name: entry.name, email: entry.email, department: entry.department, commuteMiles: entry.commuteMiles, commissionPlan: entry.commissionPlan, nameSynced: Boolean(syncedUserId) }
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

    // Profiles linked to a user account (by email) are permanent — deleting
    // the directory half would orphan the account. Deactivate instead; the
    // whole profile then moves to Deactivated users with its info intact.
    const entry = (await listEmployeeDirectory()).find((row) => row.code === code);
    if (entry?.email) {
      try {
        const account = await findUserByEmail(entry.email);
        if (account) {
          return res.status(400).json({
            error: `${entry.name || code} is linked to a user account (${entry.email}). Deactivate the account instead of deleting — the profile keeps its code, history, and directory info.`
          });
        }
      } catch (err) {
        console.error("Directory delete account check failed:", err.message);
        return res.status(500).json({ error: "Couldn't verify the linked account — try again." });
      }
    }

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

// INTERNAL: archive / restore a directory entry (former employees). The row
// and every record keyed on its code stay in the system — it just moves to
// Deactivated users and drops out of the title-driven tools.
app.post("/api/admin/employee-directory/:code/archive", requireExecutiveApi, async (req, res) => {
  try {
    const code = normalizeEmployeeCode(req.params.code);
    const archived = Boolean(req.body?.archived);
    const done = await setEmployeeDirectoryArchived(code, archived);
    if (!done) {
      return res.status(404).json({ error: "That employee code was not found." });
    }
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: archived ? "employee_directory_archived" : "employee_directory_restored",
      targetUserId: null, detail: { code }
    }).catch(() => {});
    return res.json({ success: true, archived });
  } catch (err) {
    console.error("Directory archive failed:", err.message);
    return res.status(500).json({ error: "Unable to update the directory entry." });
  }
});

// INTERNAL: remove a never-activated account (stale invite / abandoned
// registration). Active and deactivated accounts carry history and can only
// be deactivated, never deleted.
app.delete("/api/admin/users/:id", requireExecutiveApi, async (req, res) => {
  try {
    const target = await getUserById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: "That account was not found." });
    }
    if (target.id === req.authUser.id) {
      return res.status(400).json({ error: "You can't remove your own account." });
    }
    if (!["invited", "pending_verification"].includes(target.status)) {
      return res.status(400).json({ error: "Only invited or unverified accounts can be removed. Deactivate active accounts instead — their history stays intact." });
    }
    await deleteUserAccount(target.id);
    recordAudit({
      ip: req.ip, actorUserId: req.authUser.id || null,
      action: "user_account_removed", targetUserId: null,
      detail: { email: target.email, status: target.status }
    }).catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    console.error("User account removal failed:", err.message);
    return res.status(500).json({ error: "Unable to remove the account." });
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

// ---------------------------------------------------------------------------
// HR — candidate profiles + phone screens
// ---------------------------------------------------------------------------

function resolveHrUser(req, res) {
  if (req.authUser?.kind !== "db") {
    res.status(400).json({ error: "HR tools require signing in with your individual account." });
    return null;
  }
  return req.authUser;
}

app.get("/api/hr/candidates", requirePagePermission("/hr-candidates.html", "/hr-phone-screen.html"), async (req, res) => {
  try {
    const candidates = await listCandidates(String(req.query.q || ""));
    return res.json({ candidates });
  } catch (err) {
    console.error("HR list candidates failed:", err.message);
    return res.status(500).json({ error: "Unable to load candidates." });
  }
});

app.get("/api/hr/candidates/:id", requirePagePermission("/hr-candidates.html", "/hr-phone-screen.html"), async (req, res) => {
  try {
    const candidate = await getCandidateWithScreens(req.params.id);
    if (!candidate) return res.status(404).json({ error: "Candidate not found." });
    return res.json({ candidate });
  } catch (err) {
    console.error("HR candidate detail failed:", err.message);
    return res.status(500).json({ error: "Unable to load the candidate." });
  }
});

// File a phone screen — creates or reuses the candidate profile, then attaches
// the screen to it.
app.post("/api/hr/phone-screen", requirePagePermission("/hr-phone-screen.html"), async (req, res) => {
  const user = resolveHrUser(req, res);
  if (!user) return;
  try {
    const b = req.body || {};
    const name = String(b.candidateName || "").trim();
    if (!name) return res.status(400).json({ error: "Candidate name is required." });

    const screenDate = String(b.screenDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(screenDate)) {
      return res.status(400).json({ error: "A valid screen date is required." });
    }
    if (!String(b.roleApplied || "").trim()) {
      return res.status(400).json({ error: "Role applied for is required." });
    }

    const candidate = await findOrCreateCandidate(
      { name, email: b.candidateEmail, phone: b.candidatePhone, roleApplied: b.roleApplied },
      user.id || null
    );

    const screen = await createPhoneScreen({
      candidateId: candidate.id,
      interviewerName: String(b.interviewerName || user.displayName || user.email || "").trim(),
      screenDate,
      roleApplied: b.roleApplied,
      otherRoles: b.otherRoles,
      availabilityReviewed: b.availabilityReviewed === true || b.availabilityReviewed === "true",
      compReviewed: b.compReviewed === true || b.compReviewed === "true",
      roleQuestions: b.roleQuestions,
      recommendation: b.recommendation,
      notes: b.notes
    }, user.id || null);

    recordAudit({
      ip: req.ip,
      actorUserId: user.id || null,
      action: "hr_phone_screen_filed",
      targetUserId: null,
      detail: { candidateId: candidate.id, candidateName: candidate.name, recommendation: screen.recommendation }
    }).catch(() => {});

    return res.json({ success: true, candidate, screen });
  } catch (err) {
    console.error("HR phone screen failed:", err.message);
    return res.status(500).json({ error: "Unable to file the phone screen." });
  }
});

app.use(express.static(__dirname, { index: false }));

app.get("/", (req, res) => {
  const host = getRequestHost(req);
  const landingPage =
    host === SERVICE_PUBLIC_HOST
      ? "applianceservice.html"
      : host === SHOP_PUBLIC_HOST
        ? "shop.html"
        : "dashboard.html";
  res.sendFile(path.join(__dirname, landingPage));
});

app.get("/subzero", (req, res) => {
  res.sendFile(path.join(__dirname, "subzero.html"));
});

app.get("/fireflavor", (req, res) => {
  res.sendFile(path.join(__dirname, "fireflavor.html"));
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

app.get("/api/clearance", requirePagePermission("/clearance.html"), async (req, res) => {
  try {
    const fs = await import("fs/promises");
    const clearancePath = path.join(__dirname, "data", "clearance.json");
    const raw = await fs.readFile(clearancePath, "utf8");
    const data = JSON.parse(raw);

    // Attach live sold marks (kept in Postgres so they survive list
    // refreshes). If the DB is unreachable the list still loads, read-only.
    try {
      const [statuses, overrides] = await Promise.all([listClearanceStatuses(), listPriceOverrides()]);
      const byId = new Map(statuses.map((s) => [s.itemId, s]));
      const overrideById = new Map(overrides.map((o) => [o.itemId, o]));
      for (const item of data.items || []) {
        const status = byId.get(item.id);
        if (status) item.state = status;
        const override = overrideById.get(item.id);
        if (override) item.priceOverride = override;
      }
    } catch (dbErr) {
      console.error("Clearance status load failed:", dbErr.message);
      data._meta = { ...(data._meta || {}), statusUnavailable: true };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    if (err?.code === "ENOENT") {
      return res.status(500).json({ error: "Clearance data file is missing." });
    }
    return res.status(500).json({ error: err.message || "Unable to load the clearance list." });
  }
});

// Mark a clearance unit: 24-hour hold or sold. First writer wins — a second
// attempt gets the existing mark back as a 409 so the race is visible. The
// holder (or an executive) can complete their own hold as a sale.
app.post("/api/clearance/status", requirePagePermission("/clearance.html"), async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || "").trim();
    const action = String(req.body?.action || "").trim();
    const salesOrder = String(req.body?.salesOrder || "").trim();

    if (!itemId) return res.status(400).json({ error: "Missing item id." });
    if (!["sold", "hold"].includes(action)) {
      return res.status(400).json({ error: "Action must be sold or hold." });
    }
    if (action === "sold" && !salesOrder) {
      return res.status(400).json({ error: "Enter the sales order number." });
    }

    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    if (!userEmail) {
      return res.status(400).json({ error: "Sign in with your individual account to update a line." });
    }
    const userName = req.authUser?.displayName || "";

    const describe = (s) => s.status === "hold"
      ? `On hold for ${s.byName || s.byEmail} until ${new Date(s.heldUntil).toLocaleString("en-US", { timeZone: APP_TIMEZONE, weekday: "short", hour: "numeric", minute: "2-digit" })}.`
      : `Already sold by ${s.byName || s.byEmail} on ${s.salesOrder || "another order"}.`;

    const existing = await getClearanceStatus(itemId);
    if (existing) {
      const canAct = existing.byEmail === userEmail || isExecutiveUser(req.authUser);
      if (existing.status === "hold" && canAct && action === "sold") {
        const upgraded = await upgradeHoldToSold({ itemId, salesOrder, byEmail: userEmail, byName: userName });
        if (upgraded) {
          recordAudit({
            ip: req.ip, actorUserId: req.authUser?.id || null,
            action: "clearance_marked_sold", targetUserId: null,
            detail: { itemId, salesOrder, fromHold: true }
          }).catch(() => {});
          return res.json({ ok: true, state: upgraded });
        }
      }
      if (existing.status === "hold" && canAct && action === "hold") {
        return res.json({ ok: true, state: existing }); // already held by them
      }
      return res.status(409).json({ error: describe(existing), state: existing });
    }

    const result = await markClearanceStatus({ itemId, status: action, salesOrder, byEmail: userEmail, byName: userName });
    if (result.conflict) {
      return res.status(409).json({
        error: result.existing ? describe(result.existing) : "Someone else just updated this line.",
        state: result.existing
      });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: action === "sold" ? "clearance_marked_sold" : "clearance_marked_hold",
      targetUserId: null,
      detail: { itemId, salesOrder, heldUntil: result.status.heldUntil || "" }
    }).catch(() => {});

    return res.json({ ok: true, state: result.status });
  } catch (err) {
    console.error("Clearance status failed:", err.message);
    return res.status(500).json({ error: "Unable to update that line." });
  }
});

// Release a hold or reopen a sold line — the person who marked it, or an
// executive.
app.post("/api/clearance/release", requirePagePermission("/clearance.html"), async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || "").trim();
    if (!itemId) return res.status(400).json({ error: "Missing item id." });

    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    const existing = await getClearanceStatus(itemId);
    if (!existing) {
      return res.json({ ok: true }); // already clear (or the hold expired)
    }
    if (existing.byEmail !== userEmail && !isExecutiveUser(req.authUser)) {
      return res.status(403).json({ error: `Only ${existing.byName || existing.byEmail} or an executive can release this line.` });
    }

    await clearClearanceStatus(itemId);
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "clearance_released", targetUserId: null,
      detail: { itemId, previousStatus: existing.status, previousSalesOrder: existing.salesOrder, previouslyBy: existing.byEmail }
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error("Clearance release failed:", err.message);
    return res.status(500).json({ error: "Unable to release that line." });
  }
});

// Executive-only: override a clearance price (or clear the override by
// sending price: null). The workbook price is never modified — the override
// rides on top and survives list refreshes.
app.post("/api/clearance/price", requireExecutiveApi, async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || "").trim();
    if (!itemId) return res.status(400).json({ error: "Missing item id." });

    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    const rawPrice = req.body?.price;

    if (rawPrice === null || rawPrice === undefined || String(rawPrice).trim() === "") {
      await clearPriceOverride(itemId);
      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "clearance_price_cleared", targetUserId: null,
        detail: { itemId }
      }).catch(() => {});
      return res.json({ ok: true, priceOverride: null });
    }

    const price = Number(String(rawPrice).replace(/[,$\s]/g, ""));
    if (!Number.isFinite(price) || price < 0 || price > 1000000) {
      return res.status(400).json({ error: "Enter a valid price." });
    }

    const override = await setPriceOverride({
      itemId,
      price: Math.round(price * 100) / 100,
      byEmail: userEmail,
      byName: req.authUser?.displayName || ""
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "clearance_price_set", targetUserId: null,
      detail: { itemId, price: override.price }
    }).catch(() => {});

    return res.json({ ok: true, priceOverride: override });
  } catch (err) {
    console.error("Clearance price failed:", err.message);
    return res.status(500).json({ error: "Unable to update the price." });
  }
});

// ===========================================================================
// ONLINE CLEARANCE SHOP (shop.wilsonappliance.com)
//
// Public storefront for the Clearance Hit List, MAP-compliant:
//  - ZIP gate at the door (SHOP_ALLOWED_ZIPS) like an alcohol-site age check.
//  - Pricing is hidden until the visitor registers (name, shipping address,
//    phone, preferred contact) — registration issues a shopper token that
//    unlocks prices and checkout.
//  - Checkout saves a card via SetupIntent (never charged online) and creates
//    a WEB-### order; the units are immediately web-locked on the internal
//    hit list so the showroom can't double-sell them. The sales team claims
//    the order in the dashboard's Online Shop Orders module and finishes it as an ePASS ticket.
//  - Availability = clearance list ∩ latest ePASS serial snapshot (uploaded
//    in the Online Shop Orders module), minus anything sold/held/web-locked.
// ===========================================================================

// Items, parts, and delivery are taxed; install labor only when it's for
// freestanding product (built-in installs are exempt — taxable flags ride
// on data/shop-addons.json).
const SHOP_TAX_RATE = Number(process.env.SHOP_TAX_RATE || "0.0825");

// Machine credentials for the nightly ePASS export upload from the store
// server PC (scripts/upload-inventory-snapshot.ps1). Unset = endpoint off.
const SHOP_SNAPSHOT_KEY = String(process.env.SHOP_SNAPSHOT_KEY || "");

// Once the automated feed is live, a snapshot older than this pauses the
// storefront (tiles say "call for availability", checkout closes) rather
// than risk selling units ePASS no longer has. No snapshot at all keeps the
// pre-automation behavior (full clearance list, no pause).
const SHOP_SNAPSHOT_MAX_AGE_HOURS = Number(process.env.SHOP_SNAPSHOT_MAX_AGE_HOURS || "48");

// Published MAP/UMRP price spreadsheet (the ~35MB RES file). Fetched
// overnight and fully replaced each time; drives the public-price floor
// check together with data/shop-map-policy.json.
const SHOP_MAP_PRICE_URL = String(process.env.SHOP_MAP_PRICE_URL || "");

const SHOP_DELIVERY_OFFER = {
  id: "white-glove-delivery",
  name: "White Glove Delivery + Haul Away",
  price: 49.95,
  regularPrice: 89.95,
  note: "Special online offer — includes delivery and haul off of the appliance being replaced (if applicable)."
};

// Blind scheduling (Andrew, 2026-08-18): at checkout the client picks a DAY
// only — the 3rd, 4th, or 5th working day (Mon–Sat; Sundays closed) after
// today, Central time. Dispatch calls with the 4-hour window two business
// days before the selected day. Customer pickup skips both the fee and the
// scheduling entirely.
const SHOP_SCHEDULE_NOTE = "You'll receive a 4-hour arrival window two business days before your selected day.";
const SHOP_PICKUP_OFFER = {
  id: "customer-pickup",
  method: "pickup",
  name: "Customer Pickup",
  price: 0,
  note: "Free — skip the delivery fee. We'll follow up through your preferred contact method to confirm your order is ready."
};
const SHOP_PICKUP_LATER_NOTE = "Clearance and outlet items must be picked up within 30 days.";

// Pickup scheduling: orders placed before noon (Central) may choose same-day;
// otherwise the choices run up to three working days out (Mon–Sat), plus
// "I'd like to pick this up later" handled as the literal date "later".
function shopPickupDateChoices() {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
  const hourStr = new Date().toLocaleString("en-US", { timeZone: APP_TIMEZONE, hour12: false, hour: "2-digit" });
  const hour = Number(hourStr) % 24;
  const d = new Date(`${todayStr}T00:00:00Z`);
  const label = (day) => day.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const choices = [];
  if (hour < 12 && d.getUTCDay() !== 0) {
    choices.push({ date: todayStr, label: `Today (${label(d)})` });
  }
  let futureDays = 0;
  while (futureDays < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() === 0) continue; // closed Sundays
    futureDays++;
    choices.push({ date: d.toISOString().slice(0, 10), label: label(d) });
  }
  return choices;
}

function shopDeliveryDateChoices() {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
  const d = new Date(`${todayStr}T00:00:00Z`);
  const choices = [];
  let workingDays = 0;
  while (choices.length < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() === 0) continue; // closed Sundays
    workingDays++;
    if (workingDays >= 3) {
      choices.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
      });
    }
  }
  return choices;
}

function shopZipAllowed(zip) {
  return SHOP_ALLOWED_ZIPS.has(String(zip || "").trim().slice(0, 5));
}

async function loadShopData() {
  const fs = await import("fs/promises");
  const [clearanceRaw, addonsRaw] = await Promise.all([
    fs.readFile(path.join(__dirname, "data", "clearance.json"), "utf8"),
    fs.readFile(path.join(__dirname, "data", "shop-addons.json"), "utf8")
  ]);
  // Webfronts thumbnails by model — optional (regenerated by
  // scripts/build-shop-images.mjs from whse_inventory_and_prices.xlsx).
  let images = {};
  try {
    images = JSON.parse(await fs.readFile(path.join(__dirname, "data", "shop-images.json"), "utf8")).byModel || {};
  } catch {}
  // Public-pricing whitelist (brand + category rules) — optional.
  let mapPolicy = { rules: [] };
  try {
    mapPolicy = JSON.parse(await fs.readFile(path.join(__dirname, "data", "shop-map-policy.json"), "utf8"));
  } catch {}
  return { clearance: JSON.parse(clearanceRaw), addons: JSON.parse(addonsRaw), images, mapPolicy };
}

// Does this brand+category match a public-pricing rule? Brand matching is
// case-insensitive; categories are the clearance list's category keys.
function shopMapRuleMatch(mapPolicy, brand, category) {
  const b = String(brand || "").trim().toUpperCase();
  return (mapPolicy?.rules || []).some((rule) =>
    String(rule.brand || "").trim().toUpperCase() === b &&
    (rule.categories || []).includes(category)
  );
}

function normalizeModelKey(model) {
  return String(model || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// Storefront merchandising order: the volume categories people actually
// come for lead (laundry, refrigeration, dishwashers, ovens), then the
// rest by sales velocity, accessories last. Within a category the
// affordable units list first — the landing page shouldn't open on a
// $5,000 column. Unlisted categories fall between velocity and accessories.
const SHOP_CATEGORY_ORDER = [
  "Lau", "Ref", "DW", "Oven",
  "Range", "MW", "CT", "Steam Ov", "Vent", "Coffee", "IM", "Outdoor",
  "Lau Acc", "Ref Acc", "DW Acc", "Cook Acc", "Vent Acc", "Out Acc"
];
const SHOP_TOP_DEAL_MAX = 999;

function shopCategoryRank(key) {
  const i = SHOP_CATEGORY_ORDER.indexOf(key);
  return i >= 0 ? i : SHOP_CATEGORY_ORDER.indexOf("Outdoor") + 0.5;
}

function shopSortItems(items) {
  return items.sort((a, b) => {
    const rank = shopCategoryRank(a.category) - shopCategoryRank(b.category);
    if (rank) return rank;
    // Single ovens outrank doubles inside the Oven category.
    if (a.category === "Oven") {
      const doubleDiff = (/double/i.test(a.description) ? 1 : 0) - (/double/i.test(b.description) ? 1 : 0);
      if (doubleDiff) return doubleDiff;
    }
    return a.price - b.price;
  });
}

// ALL = sealed stock → "New in Box"; OPEN and DISPLAY both sell as
// "Open Box". Other pools (SPECIAL/SVC/RTV) get no condition claim.
function shopConditionOf(serialType) {
  const t = String(serialType || "").toUpperCase();
  if (t === "ALL") return "new";
  if (t === "OPEN" || t === "DISPLAY") return "open";
  return null;
}

// The single source of truth for what the shop will sell right now and at
// what price. Used by the catalog AND re-run at checkout so a stale cart
// can't buy an unavailable unit or an outdated price.
async function computeShopCatalog() {
  const { clearance, addons, images, mapPolicy } = await loadShopData();

  let statuses = [];
  let overrides = [];
  let snapshot = null;
  let mapPrices = null;
  try {
    [statuses, overrides, snapshot, mapPrices] = await Promise.all([
      listClearanceStatuses(),
      listPriceOverrides(),
      getShopInventorySnapshot(),
      getShopMapPrices().catch(() => null)
    ]);
  } catch (err) {
    // If the DB is down, sell nothing rather than something already sold.
    throw new Error("Shop availability is temporarily unreadable.");
  }

  // Stale automated feed → pause the store rather than sell ghosts. A shop
  // with no snapshot at all is still in pre-automation mode and stays open.
  const snapshotAgeHours = snapshot?.uploadedAt
    ? (Date.now() - Date.parse(snapshot.uploadedAt)) / 3600000
    : null;
  const paused = Boolean(
    snapshot && Number.isFinite(snapshotAgeHours) && snapshotAgeHours > SHOP_SNAPSHOT_MAX_AGE_HOURS
  );
  const mapFloor = mapPrices?.prices || {};

  const statusById = new Map(statuses.map((s) => [s.itemId, s]));
  const overrideById = new Map(overrides.map((o) => [o.itemId, o]));
  // Snapshot entries are "MODELKEY|SERIAL" composites (accessory pseudo-
  // serials like "00001" repeat across models). Legacy plain-serial
  // snapshots still work via the bare-serial fallback.
  const snapshotKeys = snapshot && Array.isArray(snapshot.serials) && snapshot.serials.length
    ? new Set(snapshot.serials)
    : null;
  const serialTypes = snapshot?.serialTypes || {};
  const serialWritten = snapshot?.serialWritten || {};
  const lookupKeyed = (map, composite, serial) => map[composite] ?? map[serial];

  const items = [];
  for (const item of clearance.items || []) {
    if (statusById.has(item.id)) continue; // sold, held, or web-locked
    const serial = String(item.serial || "").trim().toUpperCase();
    const composite = normalizeModelKey(item.model) + "|" + serial;
    if (snapshotKeys && !snapshotKeys.has(composite) && !snapshotKeys.has(serial)) continue; // no longer in ePASS
    // Already written to a sales order in ePASS — someone owns this unit.
    if (lookupKeyed(serialWritten, composite, serial)) continue;
    const override = overrideById.get(item.id);
    const price = override ? Number(override.price) : Number(item.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const serialType = lookupKeyed(serialTypes, composite, serial) || "";
    // Public (no-profile) price: whitelisted brand+category AND a MAP/UMRP
    // floor exists for the model AND our price is at or above it. No floor
    // entry → stays behind the gate; a penny below the floor → gate.
    const floor = mapFloor[normalizeModelKey(item.model)];
    const mapPublic = Boolean(
      shopMapRuleMatch(mapPolicy, item.brand, item.category) &&
      Number.isFinite(Number(floor)) &&
      price >= Number(floor) - 0.005
    );
    const itemMapFloor = Number.isFinite(Number(floor)) ? Number(floor) : null;
    items.push({
      id: item.id,
      model: item.model,
      brand: item.brand,
      product: item.product,
      category: item.category,
      description: item.description,
      serial,
      serialType,
      condition: shopConditionOf(serialType),
      image: images[normalizeModelKey(item.model)] || "",
      price: Math.round(price * 100) / 100,
      topDeal: price <= SHOP_TOP_DEAL_MAX,
      mapPublic,
      mapFloor: itemMapFloor
    });
  }
  shopSortItems(items);

  const categories = [...(clearance._meta?.categories || [])]
    .sort((a, b) => shopCategoryRank(a.key) - shopCategoryRank(b.key));

  return {
    items,
    addons,
    categories,
    listDate: clearance._meta?.listDate || "",
    paused,
    snapshotAgeHours,
    mapPriceCount: Object.keys(mapFloor).length,
    snapshot: snapshot
      ? { uploadedAt: snapshot.uploadedAt, sourceFile: snapshot.sourceFile, count: snapshot.serials.length }
      : null
  };
}

function shopAddonById(addons) {
  const map = new Map();
  for (const a of [...(addons.connectors || []), ...(addons.installs || [])]) {
    map.set(a.id, a);
  }
  return map;
}

// Recompute the whole cart server-side. Returns null if any unit is gone.
function priceShopCart(catalog, cart, fulfillment) {
  const itemById = new Map(catalog.items.map((i) => [i.id, i]));
  const addonMap = shopAddonById(catalog.addons);

  const items = [];
  for (const rawId of (Array.isArray(cart?.itemIds) ? cart.itemIds : [])) {
    const item = itemById.get(String(rawId));
    if (!item) return { unavailable: String(rawId) };
    items.push(item);
  }
  if (!items.length) return { empty: true };

  const addons = [];
  for (const raw of (Array.isArray(cart?.addons) ? cart.addons : [])) {
    const addon = addonMap.get(String(raw?.id || ""));
    if (!addon) continue;
    const qty = Math.max(1, Math.min(20, Math.round(Number(raw?.qty) || 1)));
    addons.push({ id: addon.id, name: addon.name, type: addon.type, price: addon.price, qty, taxable: addon.taxable !== false });
  }

  const itemsTotal = items.reduce((s, i) => s + i.price, 0);
  const addonsTotal = addons.reduce((s, a) => s + a.price * a.qty, 0);

  // Fulfillment: customer pickup skips scheduling and the delivery fee;
  // delivery must carry one of the offered blind-scheduling days.
  const method = fulfillment?.method === "pickup" ? "pickup" : "delivery";
  let delivery;
  if (method === "pickup") {
    const requested = String(fulfillment?.date || "").trim();
    if (requested === "later") {
      delivery = { ...SHOP_PICKUP_OFFER, later: true, pickupNote: SHOP_PICKUP_LATER_NOTE };
    } else {
      const choice = shopPickupDateChoices().find((c) => c.date === requested);
      if (!choice) return { badSchedule: true };
      delivery = { ...SHOP_PICKUP_OFFER, date: choice.date, dateLabel: choice.label };
    }
  } else {
    const requestedDate = String(fulfillment?.date || "").trim();
    const choice = shopDeliveryDateChoices().find((c) => c.date === requestedDate);
    if (!choice) return { badSchedule: true };
    delivery = { ...SHOP_DELIVERY_OFFER, method: "delivery", date: choice.date, dateLabel: choice.label, scheduleNote: SHOP_SCHEDULE_NOTE };
  }

  // Tax: items, parts, and delivery always; install labor only when the
  // addon is flagged taxable (freestanding product — built-ins are exempt).
  const taxableBase = itemsTotal
    + addons.reduce((s, a) => s + (a.taxable ? a.price * a.qty : 0), 0)
    + delivery.price;
  const tax = Math.round(taxableBase * SHOP_TAX_RATE * 100) / 100;
  const total = Math.round((itemsTotal + addonsTotal + delivery.price + tax) * 100) / 100;

  return {
    items,
    addons,
    delivery,
    totals: {
      items: Math.round(itemsTotal * 100) / 100,
      addons: Math.round(addonsTotal * 100) / 100,
      delivery: delivery.price,
      fulfillment: method,
      deliveryDate: delivery.date || null,
      taxRate: SHOP_TAX_RATE,
      tax,
      total,
      note: "Total includes sales tax (built-in installation labor is tax-exempt). Nothing is charged until a Wilson team member confirms your order."
    }
  };
}

// PUBLIC: the door check.
app.post("/api/shop/zip-check", (req, res) => {
  const zip = String(req.body?.zip || "").trim().slice(0, 10);
  if (!/^\d{5}/.test(zip)) {
    return res.status(400).json({ error: "Enter a 5-digit ZIP code." });
  }
  return res.json({ allowed: shopZipAllowed(zip) });
});

// Shared shopper-field validation for registration and profile edits.
// Returns { fields } or { error }.
function validateShopperFields(b) {
  const firstName = String(b?.firstName || "").trim();
  const lastName = String(b?.lastName || "").trim();
  const phone = String(b?.phone || "").trim();
  const email = String(b?.email || "").trim();
  const preferredContact = String(b?.preferredContact || "").trim();
  const address = {
    line1: String(b?.address?.line1 || "").trim(),
    line2: String(b?.address?.line2 || "").trim(),
    city: String(b?.address?.city || "").trim(),
    state: String(b?.address?.state || "TX").trim(),
    zip: String(b?.address?.zip || "").trim()
  };

  if (!firstName || !lastName) return { error: "First and last name are required." };
  if (!address.line1 || !address.city || !address.zip) return { error: "A complete shipping address is required." };
  if (!phone) return { error: "A contact phone number is required." };
  if (!["Call", "Text", "Email"].includes(preferredContact)) return { error: "Choose a preferred contact method." };
  if (preferredContact === "Email" && !email) return { error: "Add an email address so we can reach you by email." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address doesn't look right." };
  if (!shopZipAllowed(address.zip)) {
    return { error: "We can only deliver online clearance orders inside our local delivery area right now." };
  }
  return { fields: { firstName, lastName, email, phone, preferredContact, address } };
}

function shopperProfilePayload(shopper) {
  return {
    firstName: shopper.firstName,
    lastName: shopper.lastName,
    email: shopper.email,
    phone: shopper.phone,
    preferredContact: shopper.preferredContact,
    address: shopper.address,
    clientCode: shopper.clientCode,
    hasPassword: Boolean(shopper.hasPassword)
  };
}

// PUBLIC: the pricing wall. Registration requires the contact details the
// sales team needs to finish the order, and the shipping ZIP must be in zone.
app.post("/api/shop/register", async (req, res) => {
  try {
    const checked = validateShopperFields(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const { firstName, lastName, email, phone, preferredContact, address } = checked.fields;

    // Duplicate guard: same phone + same last name = same person. Steer
    // them to code recovery instead of minting another profile (and
    // another Stripe customer down the line).
    const existing = await findShopperByPhoneAndLastName({ phone, lastName }).catch(() => null);
    if (existing) {
      return res.status(409).json({
        duplicate: true,
        hasPassword: existing.hasPassword,
        error: existing.hasPassword
          ? "Good news — you already have a profile with this phone number. Sign in with your phone and password instead."
          : "Good news — you already have a client code for this phone number. Use \"Find my code\" to pick up right where you left off."
      });
    }

    const shopper = await createShopper({ firstName, lastName, email, phone, preferredContact, address });

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_shopper_registered", targetUserId: null,
      detail: { name: `${firstName} ${lastName}`, zip: address.zip }
    }).catch(() => {});

    return res.json({ token: shopper.token, firstName: shopper.firstName, clientCode: shopper.clientCode });
  } catch (err) {
    console.error("Shop registration failed:", err.message);
    return res.status(500).json({ error: "Unable to register right now." });
  }
});

// PUBLIC: code recovery — last name + phone reveals the client code (or, if
// a password exists, points at password sign-in without revealing anything).
// Those two facts already restore the profile here (name+phone -> code,
// code+phone -> profile), so this reveals no access an asker didn't have —
// same per-IP throttle as lookup. Registration's duplicate guard lands
// people here instead of minting a second profile.
app.post("/api/shop/recover-code", async (req, res) => {
  try {
    const now = Date.now();
    const key = "recover:" + String(req.ip || "");
    const attempts = (shopLookupAttempts.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (attempts.length >= 20) {
      return res.status(429).json({ error: "Too many attempts — please try again later or just fill out the form." });
    }
    attempts.push(now);
    shopLookupAttempts.set(key, attempts);

    const shopper = await findShopperByPhoneAndLastName({
      phone: req.body?.phone,
      lastName: req.body?.lastName
    });
    if (!shopper) {
      return res.status(404).json({ error: "We couldn't find a profile matching that phone number and last name. Double-check both, or just fill out the sign-up form — it only takes 30 seconds." });
    }

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_code_recovered", targetUserId: null,
      detail: { clientCode: shopper.clientCode, hasPassword: shopper.hasPassword }
    }).catch(() => {});

    if (shopper.hasPassword) {
      return res.json({ hasPassword: true, firstName: shopper.firstName });
    }
    return res.json({ clientCode: shopper.clientCode, firstName: shopper.firstName });
  } catch (err) {
    console.error("Shop code recovery failed:", err.message);
    return res.status(500).json({ error: "Unable to look that up right now." });
  }
});

// PUBLIC: return-visit lookup — client code + phone restores the profile so
// nobody retypes their address. Lightly throttled per IP against guessing.
const shopLookupAttempts = new Map();
app.post("/api/shop/lookup", async (req, res) => {
  try {
    const now = Date.now();
    const key = String(req.ip || "");
    const attempts = (shopLookupAttempts.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (attempts.length >= 20) {
      return res.status(429).json({ error: "Too many lookup attempts — please try again later or just fill out the form." });
    }
    attempts.push(now);
    shopLookupAttempts.set(key, attempts);
    if (shopLookupAttempts.size > 5000) shopLookupAttempts.clear(); // bounded memory

    const shopper = await findShopperByCodeAndPhone({
      clientCode: req.body?.clientCode,
      phone: req.body?.phone
    });
    if (!shopper) {
      return res.status(404).json({ error: "We couldn't match that client code and phone number." });
    }

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_shopper_lookup", targetUserId: null,
      detail: { clientCode: shopper.clientCode }
    }).catch(() => {});

    return res.json({ token: shopper.token, firstName: shopper.firstName, clientCode: shopper.clientCode });
  } catch (err) {
    console.error("Shop lookup failed:", err.message);
    return res.status(500).json({ error: "Unable to look that up right now." });
  }
});

// PUBLIC: phone + password sign-in (the optional account layer on top of
// the guest flow). Shares the lookup throttle.
app.post("/api/shop/login", async (req, res) => {
  try {
    const now = Date.now();
    const key = "login:" + String(req.ip || "");
    const attempts = (shopLookupAttempts.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (attempts.length >= 20) {
      return res.status(429).json({ error: "Too many sign-in attempts — please try again later." });
    }
    attempts.push(now);
    shopLookupAttempts.set(key, attempts);

    const shopper = await verifyShopperLogin({ phone: req.body?.phone, password: req.body?.password });
    if (!shopper) {
      return res.status(401).json({ error: "That phone number and password don't match. You can also restore your profile with your client code." });
    }

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_shopper_login", targetUserId: null,
      detail: { clientCode: shopper.clientCode }
    }).catch(() => {});

    return res.json({ token: shopper.token, firstName: shopper.firstName, clientCode: shopper.clientCode });
  } catch (err) {
    console.error("Shop login failed:", err.message);
    return res.status(500).json({ error: "Unable to sign in right now." });
  }
});

// PUBLIC: the shopper's own profile — view (GET) and update (POST). The
// token IS the credential; updates re-run the same validation as sign-up,
// including the delivery-ZIP gate.
app.get("/api/shop/profile", async (req, res) => {
  try {
    const shopper = await getShopperByToken(req.query.token);
    if (!shopper) return res.status(401).json({ error: "Please register or sign in first." });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ profile: shopperProfilePayload(shopper) });
  } catch (err) {
    console.error("Shop profile load failed:", err.message);
    return res.status(500).json({ error: "Unable to load your profile." });
  }
});

app.post("/api/shop/profile", async (req, res) => {
  try {
    const shopper = await getShopperByToken(req.body?.token);
    if (!shopper) return res.status(401).json({ error: "Please register or sign in first." });

    const checked = validateShopperFields(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error });

    const updated = await updateShopperProfile({ token: shopper.token, ...checked.fields });
    if (!updated) return res.status(401).json({ error: "Please register or sign in first." });

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_shopper_profile_updated", targetUserId: null,
      detail: { clientCode: updated.clientCode }
    }).catch(() => {});

    return res.json({ profile: shopperProfilePayload(updated), firstName: updated.firstName });
  } catch (err) {
    console.error("Shop profile update failed:", err.message);
    return res.status(500).json({ error: "Unable to save your profile." });
  }
});

// PUBLIC: set or change the optional password.
app.post("/api/shop/password", async (req, res) => {
  try {
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "Passwords need at least 8 characters." });

    const updated = await setShopperPassword({ token: req.body?.token, password });
    if (!updated) return res.status(401).json({ error: "Please register or sign in first." });

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_shopper_password_set", targetUserId: null,
      detail: { clientCode: updated.clientCode }
    }).catch(() => {});

    return res.json({ ok: true, hasPassword: true });
  } catch (err) {
    console.error("Shop password set failed:", err.message);
    return res.status(500).json({ error: err.message || "Unable to save that password." });
  }
});

// PUBLIC: the catalog. Prices appear with a valid shopper token, or — for
// MAP/UMRP-cleared items (brand+category whitelist + floor check) — for
// everyone. The rest of the anonymous view is model/brand/description with
// no advertised price (MAP). A stale automated feed pauses the whole store:
// no prices, no carting, checkout closed.
app.get("/api/shop/catalog", async (req, res) => {
  try {
    const catalog = await computeShopCatalog();
    const shopper = await getShopperByToken(req.query.token).catch(() => null);
    const withPrices = Boolean(shopper) && !catalog.paused;

    const items = catalog.items.map((i) => {
      const base = {
        id: i.id,
        model: i.model,
        brand: i.brand,
        product: i.product,
        category: i.category,
        description: i.description,
        condition: i.condition,
        image: i.image,
        topDeal: i.topDeal
      };
      if (withPrices || (i.mapPublic && !catalog.paused)) {
        return { ...base, price: i.price, mapPublic: i.mapPublic };
      }
      // Below-floor units advertise AT the floor (always compliant) with an
      // explainer icon -- the real price only shows behind a profile.
      if (!catalog.paused && Number.isFinite(i.mapFloor) && i.price < i.mapFloor) {
        return { ...base, mapDisplayPrice: Math.round(i.mapFloor * 100) / 100 };
      }
      return base;
    });

    // Add-on parts/install/delivery pricing is Wilson's own service pricing
    // (not manufacturer MAP) — it travels whenever anything is purchasable,
    // so a no-profile MAP shopper can build a complete cart.
    const canBuild = !catalog.paused && (withPrices || items.some((i) => i.mapPublic));

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      items,
      categories: catalog.categories,
      listDate: catalog.listDate,
      unlocked: Boolean(shopper),
      paused: catalog.paused,
      shopperName: shopper?.firstName || "",
      clientCode: shopper?.clientCode || "",
      addons: canBuild ? catalog.addons : null,
      delivery: canBuild ? SHOP_DELIVERY_OFFER : null,
      fulfillment: canBuild ? {
        pickup: SHOP_PICKUP_OFFER,
        deliveryDates: shopDeliveryDateChoices(),
        scheduleNote: SHOP_SCHEDULE_NOTE,
        pickupDates: shopPickupDateChoices(),
        pickupLaterNote: SHOP_PICKUP_LATER_NOTE
      } : null,
      taxRate: canBuild ? SHOP_TAX_RATE : null,
      topDealMax: SHOP_TOP_DEAL_MAX
    });
  } catch (err) {
    console.error("Shop catalog failed:", err.message);
    return res.status(500).json({ error: "The shop is temporarily unavailable." });
  }
});

// PUBLIC: begin checkout — validates the cart against live availability and
// opens a SetupIntent (card saved for the order, charged only by the sales
// team when the order is finalized).
app.post("/api/shop/setup-intent", async (req, res) => {
  try {
    const shopper = await getShopperByToken(req.body?.token);
    if (!shopper) return res.status(401).json({ error: "Please register to check out." });

    const catalog = await computeShopCatalog();
    if (catalog.paused) return res.status(503).json({ error: "Online checkout is briefly paused while we refresh inventory. Please try again soon or call the store." });
    const priced = priceShopCart(catalog, req.body?.cart, req.body?.fulfillment);
    if (priced.badSchedule) {
      return res.status(400).json({ error: "Please pick a day for your delivery or pickup — the option you selected is no longer available." });
    }
    if (priced.empty) return res.status(400).json({ error: "Your cart is empty." });
    if (priced.unavailable) {
      return res.status(409).json({ error: "An item in your cart was just claimed by another buyer. Refresh to see what's still available." });
    }

    const customerConfig = {
      name: `${shopper.firstName} ${shopper.lastName}`,
      email: shopper.email || undefined,
      phone: shopper.phone || undefined,
      address: {
        line1: shopper.address.line1 || undefined,
        line2: shopper.address.line2 || undefined,
        city: shopper.address.city || undefined,
        state: shopper.address.state === "Texas" ? "TX" : (shopper.address.state || undefined),
        postal_code: shopper.address.zip || undefined,
        country: "US"
      },
      metadata: {
        shop_shopper_id: shopper.id,
        shop_client_code: shopper.clientCode || "",
        preferred_contact: shopper.preferredContact,
        source: "online_shop"
      }
    };

    // ONE Stripe customer per shopper — reuse the linked record (keeping its
    // details fresh) so payment history accumulates on a single profile
    // instead of fragmenting into duplicates Stripe can never merge.
    let customer = null;
    if (shopper.stripeCustomerId) {
      try {
        customer = await stripe.customers.update(shopper.stripeCustomerId, customerConfig);
      } catch (err) {
        console.error("Stripe customer reuse failed, creating fresh:", err.message);
        customer = null;
      }
    }
    if (!customer) {
      customer = await stripe.customers.create(customerConfig, {
        idempotencyKey: createStripeIdempotencyKeyFromPayload("shop-customer", customerConfig)
      });
      await setShopperStripeCustomerId({ id: shopper.id, stripeCustomerId: customer.id }).catch(() => {});
    }

    const itemSummary = priced.items.map((i) => `${i.model} (${i.serial})`).join(", ").slice(0, 480);
    const setupIntentConfig = {
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        source: "online_shop",
        shop_shopper_id: shopper.id,
        items: itemSummary,
        estimated_total: String(priced.totals.total)
      }
    };
    const setupIntent = await stripe.setupIntents.create(setupIntentConfig, {
      idempotencyKey: createStripeIdempotencyKeyFromPayload("shop-setup-intent", setupIntentConfig)
    });

    return res.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId: customer.id,
      pricing: { totals: priced.totals, delivery: priced.delivery },
      // The payment element suppresses billing-detail collection (the
      // shopper already gave us everything), so the client must hand these
      // back to stripe.confirmSetup verbatim.
      billing: {
        name: `${shopper.firstName} ${shopper.lastName}`.trim(),
        email: shopper.email || "",
        phone: shopper.phone || "",
        address: {
          line1: shopper.address.line1 || "",
          line2: shopper.address.line2 || "",
          city: shopper.address.city || "",
          state: shopper.address.state === "Texas" ? "TX" : (shopper.address.state || "TX"),
          postal_code: shopper.address.zip || "",
          country: "US"
        }
      }
    });
  } catch (err) {
    console.error("Shop setup intent failed:", err.message);
    return res.status(400).json({ error: err.message || "Unable to start secure checkout." });
  }
});

// From address for web-order claim emails (Resend). The team asked for a
// plain no-reply sender; override with SHOP_ORDER_NOTIFY_FROM if needed.
const SHOP_ORDER_NOTIFY_FROM =
  process.env.SHOP_ORDER_NOTIFY_FROM || "Wilson Online Shop <no-reply@wilsonappliance.com>";

// Green flag on every Showroom Consultant's dashboard (routed by the
// directory's job title) PLUS a claim email to each of them — both fire
// when an order lands, and BOTH fire again if a claim is released back
// into the pool (unclaim re-pushes the flags, which re-sends the email).
async function pushWebOrderFlags({ orderNumber, customerName, total, models, fulfillment = "" }) {
  const [directory, notifyNames] = await Promise.all([listEmployeeDirectory(), listNotifyTitleNames()]);
  const notifySet = new Set(notifyNames.map((n) => n.trim().toLowerCase()));
  const consultants = directory.filter((entry) =>
    notifySet.has(String(entry.commissionPlan || "").trim().toLowerCase()) &&
    String(entry.email || "").trim()
  );
  const itemSummaryShort = (models || []).join(", ").slice(0, 120);
  for (const consultant of consultants) {
    await createPushedNotification({
      severity: "green",
      typeLabel: "New Web Order",
      refId: `weborder:${orderNumber}`,
      title: `${orderNumber} — ${customerName} · $${Number(total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      body: `${itemSummaryShort}.${fulfillment ? " " + fulfillment + "." : ""} Claim it on the Online Shop Orders page.`,
      audienceEmail: consultant.email,
      byEmail: "webshop",
      byName: "Online Shop"
    });
  }

  // Claim email — deliberately minimal (order number + where to claim it);
  // the dashboard flag and the page itself carry the details. Fire-and-
  // forget: a mail hiccup must never block the order or the unclaim.
  if (RESEND_API_KEY && consultants.length) {
    const pageUrl = `https://${DASHBOARD_HOST}/shop-orders.html`;
    const subject = `New Web Order ${orderNumber} — available to claim`;
    const text = `Web Order ${orderNumber} is available to claim on the Online Shop Orders page: ${pageUrl}`;
    const html = buildAuthEmailHtml(
      `Web Order ${orderNumber}`,
      [`A new Web Order (${orderNumber}) is available to claim on the Online Shop Orders page.`],
      "Open Online Shop Orders",
      pageUrl,
      "You're receiving this because your job title receives web-order notifications."
    );
    Promise.allSettled(consultants.map((consultant) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: SHOP_ORDER_NOTIFY_FROM, to: [consultant.email], subject, text, html })
      }).then((r) => {
        if (!r.ok) return r.text().then((t) => { throw new Error(`${r.status} ${t.slice(0, 200)}`); });
      })
    )).then((results) => {
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) console.error(`Web order email failed for ${failed.length}/${consultants.length} consultants (${orderNumber}):`, failed[0].reason?.message);
      else console.log(`Web order claim email sent to ${consultants.length} consultant(s) for ${orderNumber}.`);
    });
  }
}

// INTERNAL + PUBLIC: Service Estimate Approvals — Client Care scans the
// ePASS service quote PDF, sends the client a link; the client approves or
// asks to shop for a replacement (which fires the showroom-lead fan-out,
// same routing as new web orders).
const estimatePdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/api/service-estimates/scan", requirePagePermission("/service-estimates.html"), (req, res) => {
  estimatePdfUpload.single("quote")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That PDF is over the 10 MB limit." : "Upload failed — please try again." });
    }
    try {
      if (!req.file?.buffer?.length) return res.status(400).json({ error: "Attach the ePASS service quote PDF." });
      const summary = extractServiceEstimateFromPdf(req.file.buffer);
      // If the phone (or account number) matches a shopper we already know,
      // offer the email as a prefill — never auto-sent, always editable.
      let knownEmail = null;
      try {
        knownEmail = await lookupKnownClientEmail({ phone: summary.phone, customerNumber: summary.customerNumber });
      } catch { /* prefill is best-effort */ }
      return res.json({ ok: true, summary, knownEmail });
    } catch (scanErr) {
      return res.status(400).json({ error: scanErr.message || "Couldn't read that PDF." });
    }
  });
});

app.post("/api/service-estimates", requirePagePermission("/service-estimates.html"), async (req, res) => {
  try {
    const { svNumber = "", estimateName = "", customerName = "", customerNumber = "", contactPhone = "", contactEmail = "", contactPref = "", summary = null } = req.body || {};
    if (!String(customerName).trim()) return res.status(400).json({ error: "The client's name is required." });
    if (!String(contactPhone).trim() && !String(contactEmail).trim()) {
      return res.status(400).json({ error: "Add a phone number or email so the client can be reached." });
    }
    if (!summary || (summary.invoiceTotal == null && summary.subTotal == null)) {
      return res.status(400).json({ error: "Scan the quote PDF first — the summary is missing its totals." });
    }
    const estimate = await createServiceEstimate({
      svNumber, estimateName, customerName, customerNumber, contactPhone, contactEmail, contactPref, summary,
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });
    const url = `https://${SERVICE_PUBLIC_HOST}/estimate.html?e=${estimate.token}`;

    // Deliberately NO automated email here — clients often have a clear
    // contact preference (CALL PREF / TEXT PREF on the work order), so the
    // team copies the link into a call/text, or clicks "Email the link"
    // explicitly (POST /api/service-estimates/send-email below).
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "service_estimate_created", targetUserId: null,
      detail: { svNumber: estimate.svNumber, customerName: estimate.customerName, total: summary.invoiceTotal }
    }).catch(() => {});

    return res.json({ ok: true, estimate, url });
  } catch (err) {
    console.error("Service estimate create failed:", err.message);
    return res.status(500).json({ error: "Unable to create the estimate link." });
  }
});

// Explicit, on-click email of the estimate link to the client. Separate from
// create on purpose: no email goes out unless someone presses the button.
app.post("/api/service-estimates/send-email", requirePagePermission("/service-estimates.html"), async (req, res) => {
  try {
    const token = String(req.body?.token || "").slice(0, 60);
    const overrideEmail = String(req.body?.email || "").trim().toLowerCase();
    if (overrideEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideEmail)) {
      return res.status(400).json({ error: "That email address doesn't look right." });
    }
    const estimate = await getServiceEstimateByToken(token);
    if (!estimate) return res.status(404).json({ error: "Estimate not found." });
    const to = overrideEmail || String(estimate.contactEmail || "").trim().toLowerCase();
    if (!to) return res.status(400).json({ error: "Add the client's email address first." });
    if (!RESEND_API_KEY) return res.status(500).json({ error: "Email isn't configured on this server." });

    const url = `https://${SERVICE_PUBLIC_HOST}/estimate.html?e=${estimate.token}`;
    // "standard" introduces the estimate; "reminder" nudges one that's
    // been sitting unanswered.
    const variant = req.body?.variant === "reminder" ? "reminder" : "standard";
    const html = variant === "reminder"
      ? buildAuthEmailHtml(
          "A friendly reminder from Wilson",
          [
            `Just a quick reminder — your repair estimate${estimate.svNumber ? ` (${estimate.svNumber})` : ""} from Wilson AC & Appliance is still waiting for your review.`,
            "It takes about a minute: see the breakdown, then approve the repair — or let us know you'd rather shop for a replacement. If anything's unclear, we're happy to talk it through."
          ],
          "Review Your Estimate",
          url,
          "Questions? Call or text us at 512-894-0907."
        )
      : buildAuthEmailHtml(
          "Your Wilson service estimate is ready",
          [
            `Your repair estimate${estimate.svNumber ? ` (${estimate.svNumber})` : ""} from Wilson AC & Appliance is ready to review.`,
            "It takes about a minute: see the parts, labor, and tax breakdown, then approve the repair — or let us know you'd rather shop for a replacement."
          ],
          "Review Your Estimate",
          url,
          "Questions? Call us at 512-894-0907."
        );
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: SHOP_ORDER_NOTIFY_FROM,
        reply_to: userReplyTo(req),
        to: [to],
        subject: variant === "reminder"
          ? `Reminder — your Wilson service estimate${estimate.svNumber ? " (" + estimate.svNumber + ")" : ""} is waiting`
          : `Your Wilson service estimate${estimate.svNumber ? " — " + estimate.svNumber : ""}`,
        text: variant === "reminder"
          ? `Just a friendly reminder — your repair estimate is still waiting for your review: ${url}`
          : `Your repair estimate is ready to review and approve: ${url}`,
        html
      })
    });
    if (!r.ok) {
      console.error("Estimate email failed:", r.status, (await r.text()).slice(0, 200));
      return res.status(502).json({ error: "The email didn't go through — try again or copy the link instead." });
    }
    const updated = await markServiceEstimateEmailed(token, overrideEmail || "");

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "service_estimate_emailed", targetUserId: null,
      detail: { svNumber: estimate.svNumber, customerName: estimate.customerName, to, variant }
    }).catch(() => {});

    return res.json({ ok: true, to, estimate: updated || estimate });
  } catch (err) {
    console.error("Estimate send-email failed:", err.message);
    return res.status(500).json({ error: "Unable to send the email right now." });
  }
});

// Explicit, on-click TEXT of the estimate link — sent from the showroom
// number via the Podium connection, replies land in the Podium inbox.
// Same principle as email: nothing sends without the button press.
app.post("/api/service-estimates/send-text", requirePagePermission("/service-estimates.html"), async (req, res) => {
  try {
    const token = String(req.body?.token || "").slice(0, 60);
    const overridePhone = String(req.body?.phone || "").replace(/\D/g, "");
    const estimate = await getServiceEstimateByToken(token);
    if (!estimate) return res.status(404).json({ error: "Estimate not found." });
    if (!podiumSendConfigured()) {
      return res.status(503).json({ error: "Texting isn't connected — connect Podium in Text Automations first." });
    }
    const phone = overridePhone || String(estimate.contactPhone || "").replace(/\D/g, "");
    if (phone.length !== 10 && !(phone.length === 11 && phone.startsWith("1"))) {
      return res.status(400).json({ error: "Add the client's 10-digit mobile number first." });
    }

    const url = `https://${SERVICE_PUBLIC_HOST}/estimate.html?e=${estimate.token}`;
    const first = String(estimate.customerName || "").trim().split(/\s+/)[0] || "";
    const variant = req.body?.variant === "reminder" ? "reminder" : "standard";
    const body = variant === "reminder"
      ? `${first ? `Hi ${first}, this` : "This"} is Wilson AC & Appliance with a friendly reminder — ` +
        `your repair estimate${estimate.svNumber ? ` (${estimate.svNumber})` : ""} is still waiting for your review: ${url} ` +
        `If anything's unclear, just reply to this text and we'll help.`
      : `${first ? `Hi ${first}, this` : "This"} is Wilson AC & Appliance. ` +
        `Your repair estimate${estimate.svNumber ? ` (${estimate.svNumber})` : ""} is ready to review and approve: ${url} ` +
        `Questions? Just reply to this text.`;

    const result = await sendCustomerText({ phone, body });
    if (!result.ok) {
      return res.status(502).json({ error: "The text didn't go through — try again or copy the link instead." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "service_estimate_texted", targetUserId: null,
      detail: { svNumber: estimate.svNumber, customerName: estimate.customerName, to: phone, variant, transport: result.transport }
    }).catch(() => {});

    return res.json({ ok: true, to: phone });
  } catch (err) {
    console.error("Estimate send-text failed:", err.message);
    return res.status(500).json({ error: "Unable to send the text right now." });
  }
});

// Explicit, on-click TEXT of a payment link from the dashboard queue.
app.post("/api/payment-links/:id/send-text", requirePagePermission("/dashboard.html", "/index.html"), async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const overridePhone = String(req.body?.phone || "").replace(/\D/g, "");
    const links = await readLinks();
    const record = links.map((row) => normalizeLinkRecord({ ...row })).find((row) => String(row.id) === id);
    if (!record) return res.status(404).json({ error: "Payment link not found." });
    if (record.status === "paid") return res.status(400).json({ error: "That link is already paid." });
    if (!record.paymentLinkUrl) return res.status(400).json({ error: "That record has no client link to send." });
    if (!podiumSendConfigured()) {
      return res.status(503).json({ error: "Texting isn't connected — connect Podium in Text Automations first." });
    }
    const phone = overridePhone || String(record.customerPhone || "").replace(/\D/g, "");
    if (phone.length !== 10 && !(phone.length === 11 && phone.startsWith("1"))) {
      return res.status(400).json({ error: "Add the client's 10-digit mobile number first." });
    }

    const first = String(record.customerName || "").trim().split(/\s+/)[0] || "";
    const ref = String(record.salesOrder || record.description || "").trim();
    // Two flavors: "standard" introduces the link; "reminder" nudges gently
    // on a link that's been sitting.
    const variant = req.body?.variant === "reminder" ? "reminder" : "standard";
    const body = variant === "reminder"
      ? `${first ? `Hi ${first}, this` : "This"} is Wilson AC & Appliance with a friendly reminder — ` +
        `your secure payment link${ref ? ` for ${ref}` : ""} is still waiting for you: ${record.paymentLinkUrl} ` +
        `If anything is holding things up, just reply to this text and we'll help.`
      : `${first ? `Hi ${first}, this` : "This"} is Wilson AC & Appliance. ` +
        `Here's your secure payment link${ref ? ` for ${ref}` : ""}: ${record.paymentLinkUrl} ` +
        `Questions? Just reply to this text.`;

    const result = await sendCustomerText({ phone, body });
    if (!result.ok) {
      return res.status(502).json({ error: "The text didn't go through — try again or copy the link instead." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "payment_link_texted", targetUserId: null,
      detail: { linkId: id, salesOrder: record.salesOrder || "", customerName: record.customerName || "", to: phone, variant, transport: result.transport }
    }).catch(() => {});

    return res.json({ ok: true, to: phone });
  } catch (err) {
    console.error("Payment link send-text failed:", err.message);
    return res.status(500).json({ error: "Unable to send the text right now." });
  }
});

// Explicit, on-click EMAIL of a payment link — reply-to whoever clicked.
app.post("/api/payment-links/:id/send-email", requirePagePermission("/dashboard.html", "/index.html"), async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const overrideEmail = String(req.body?.email || "").trim().toLowerCase();
    if (overrideEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideEmail)) {
      return res.status(400).json({ error: "That email address doesn't look right." });
    }
    const links = await readLinks();
    const record = links.map((row) => normalizeLinkRecord({ ...row })).find((row) => String(row.id) === id);
    if (!record) return res.status(404).json({ error: "Payment link not found." });
    if (record.status === "paid") return res.status(400).json({ error: "That link is already paid." });
    if (!record.paymentLinkUrl) return res.status(400).json({ error: "That record has no client link to send." });
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured." });
    }
    const to = overrideEmail || String(record.customerEmail || "").trim().toLowerCase();
    if (!to) return res.status(400).json({ error: "Add the client's email address first." });

    const first = String(record.customerName || "").trim().split(/\s+/)[0] || "";
    const ref = String(record.salesOrder || record.description || "").trim();
    const amountText = Number(record.requestedTotalAmount || record.requestedAmount || 0) > 0
      ? `$${Number(record.requestedTotalAmount || record.requestedAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "";
    const subject = `Your Wilson AC & Appliance payment link${ref ? ` — ${ref}` : ""}`;
    const para1 = `Here's your secure payment link${ref ? ` for ${ref}` : ""}${amountText ? ` (${amountText})` : ""}:`;
    const bodyText = [
      first ? `Hi ${first},` : "Hello,",
      "",
      para1,
      record.paymentLinkUrl,
      "",
      "Payment is handled securely by Stripe. Questions? Just reply to this email or call us at 512-894-0907.",
      "",
      "Wilson AC & Appliance"
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 560px;">
        <p>${first ? `Hi ${escapeHtmlForEmail(first)},` : "Hello,"}</p>
        <p>${escapeHtmlForEmail(para1)}</p>
        <p><a href="${escapeHtmlForEmail(record.paymentLinkUrl)}">${escapeHtmlForEmail(record.paymentLinkUrl)}</a></p>
        <p>Payment is handled securely by Stripe. Questions? Just reply to this email or call us at 512-894-0907.</p>
        <p style="color: #6b7280; font-size: 13px;">Wilson AC &amp; Appliance · 512-894-0907</p>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        reply_to: userReplyTo(req),
        to: [to],
        subject,
        text: bodyText,
        html
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Payment link email failed:", response.status, errorText);
      return res.status(502).json({ error: "The email didn't go through — try again or copy the link instead." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "payment_link_emailed", targetUserId: null,
      detail: { linkId: id, salesOrder: record.salesOrder || "", customerName: record.customerName || "", to }
    }).catch(() => {});

    return res.json({ ok: true, to });
  } catch (err) {
    console.error("Payment link send-email failed:", err.message);
    return res.status(500).json({ error: "Unable to send the email right now." });
  }
});

// Estimates the client never opened: after the wait window (48h default) a
// yellow flag goes to everyone holding the Senior Customer Service job code
// (NE17) so they can chase the client. One flag per estimate, ever — the
// estimate is stamped once the flags are out. If nobody currently holds the
// code, the estimate stays unstamped and gets flagged when someone does.
const SERVICE_ESTIMATE_STALE_HOURS = Number(process.env.SERVICE_ESTIMATE_STALE_HOURS || 48);
const SENIOR_CS_JOB_CODE = (process.env.SENIOR_CS_JOB_CODE || "NE17").toUpperCase();
async function sweepStaleServiceEstimates() {
  try {
    const stale = await listStaleSentEstimates(SERVICE_ESTIMATE_STALE_HOURS);
    if (!stale.length) return;
    const directory = await listEmployeeDirectory();
    const seniors = directory.filter((entry) =>
      !entry.archived &&
      String(entry.jobTitleCode || "").trim().toUpperCase() === SENIOR_CS_JOB_CODE &&
      String(entry.email || "").trim()
    );
    if (!seniors.length) return;
    for (const est of stale) {
      const sentWhen = est.createdAt
        ? new Date(est.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "recently";
      const prefNote = { call: " (prefers a call)", text: " (prefers text)", email: " (prefers email)" }[est.contactPref] || "";
      for (const senior of seniors) {
        await createPushedNotification({
          severity: "yellow",
          typeLabel: "Estimate Not Viewed",
          refId: `svstale:${est.token}`,
          title: `${est.customerName}'s estimate hasn't been opened (${est.svNumber || "service"})`,
          body: `Sent ${sentWhen} by ${est.createdByName || est.createdByEmail || "the service team"} — the client hasn't viewed the link after ${SERVICE_ESTIMATE_STALE_HOURS} hours. Reach out and make sure it landed. Contact: ${[est.contactPhone, est.contactEmail].filter(Boolean).join(" / ") || "on the estimate record"}${prefNote}.`,
          audienceEmail: senior.email,
          byEmail: "service-estimates",
          byName: "Estimate Approvals"
        }).catch(() => {});
      }
      await markServiceEstimateStaleFlagged(est.token);
    }
  } catch (err) {
    if (!/DATABASE_URL/.test(err.message || "")) console.error("Stale estimate sweep failed:", err.message);
  }
}
const SWEEP_EVERY_MS = Number(process.env.SERVICE_ESTIMATE_SWEEP_MS || 30 * 60 * 1000);
setInterval(sweepStaleServiceEstimates, SWEEP_EVERY_MS).unref?.();
setTimeout(sweepStaleServiceEstimates, Math.min(SWEEP_EVERY_MS, 20 * 1000)).unref?.();

// Close (or reopen) an estimate from the internal list. Closed estimates
// leave the active table, stop accepting client responses, and are skipped
// by the not-viewed sweep.
app.post("/api/service-estimates/close", requirePagePermission("/service-estimates.html"), async (req, res) => {
  try {
    const token = String(req.body?.token || "").slice(0, 60);
    const closed = req.body?.closed !== false;
    const estimate = await setServiceEstimateClosed(token, closed, req.authUser?.email || req.authUser?.username || "");
    if (!estimate) return res.status(404).json({ error: "Estimate not found." });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: closed ? "service_estimate_closed" : "service_estimate_reopened", targetUserId: null,
      detail: { svNumber: estimate.svNumber, customerName: estimate.customerName }
    }).catch(() => {});
    return res.json({ ok: true, estimate });
  } catch (err) {
    console.error("Service estimate close failed:", err.message);
    return res.status(500).json({ error: "Unable to update that estimate." });
  }
});

app.get("/api/service-estimates", requirePagePermission("/service-estimates.html"), async (req, res) => {
  try {
    return res.json({ estimates: await listServiceEstimates(), publicHost: SERVICE_PUBLIC_HOST });
  } catch (err) {
    console.error("Service estimate list failed:", err.message);
    return res.status(500).json({ error: "Unable to load estimates." });
  }
});

// PUBLIC: the client's view of one estimate (marks it viewed).
app.post("/api/estimate/view", async (req, res) => {
  try {
    const token = String(req.body?.token || "").slice(0, 60);
    const estimate = await getServiceEstimateByToken(token);
    if (!estimate) return res.status(404).json({ error: "This estimate link isn't valid — call us at 512-894-0907 and we'll get you a fresh one." });
    if (estimate.closedAt && !["approved", "shopping", "elsewhere"].includes(estimate.status)) {
      return res.status(410).json({ error: "This estimate is no longer active — call or text us at 512-894-0907 and we'll get you a current one." });
    }
    if (estimate.status === "sent") await markServiceEstimateViewed(token);
    return res.json({
      svNumber: estimate.svNumber,
      estimateName: estimate.estimateName,
      customerName: estimate.customerName,
      summary: estimate.summary,
      status: estimate.status === "sent" ? "viewed" : estimate.status,
      response: estimate.response || {}
    });
  } catch (err) {
    console.error("Estimate view failed:", err.message);
    return res.status(500).json({ error: "Unable to load this estimate right now." });
  }
});

// PUBLIC: the client's decision. First response wins.
app.post("/api/estimate/respond", async (req, res) => {
  try {
    const token = String(req.body?.token || "").slice(0, 60);
    const choice = String(req.body?.choice || "");
    if (!["approve", "shop", "elsewhere"].includes(choice)) return res.status(400).json({ error: "Choose an option." });
    const existing = await getServiceEstimateByToken(token);
    if (!existing) return res.status(404).json({ error: "This estimate link isn't valid." });
    if (["approved", "shopping", "elsewhere"].includes(existing.status)) {
      return res.json({ ok: true, status: existing.status, alreadyResponded: true });
    }
    if (existing.closedAt) {
      return res.status(410).json({ error: "This estimate is no longer active — call or text us at 512-894-0907." });
    }
    const estimate = await saveServiceEstimateResponse(token, {
      choice,
      productDirection: req.body?.productDirection,
      visit: req.body?.visit,
      notes: req.body?.notes
    });
    if (!estimate) return res.status(409).json({ error: "This estimate was already answered." });

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: choice === "approve" ? "service_estimate_approved" : choice === "elsewhere" ? "service_estimate_elsewhere" : "service_estimate_shopping",
      targetUserId: null,
      detail: { svNumber: estimate.svNumber, customerName: estimate.customerName, response: estimate.response }
    }).catch(() => {});

    if (choice === "elsewhere") {
      // The client is starting their search elsewhere. No sales fan-out —
      // they asked not to be shopped — but the Client Care rep who sent the
      // estimate gets the experience feedback (and knows the $100-over-$999
      // service-client discount was offered on the way out).
      const feedback = String(estimate.response?.notes || "").trim();
      if (estimate.createdByEmail) {
        createPushedNotification({
          severity: "yellow",
          typeLabel: "Estimate — Went Elsewhere",
          refId: `svelse:${estimate.token}`,
          title: `${estimate.customerName} is starting their search elsewhere (${estimate.svNumber || "service"})`,
          body: `${feedback ? `Their feedback: “${feedback}”` : "No feedback left."} They were reminded of the $100 service-client discount toward a purchase over $999.`,
          audienceEmail: estimate.createdByEmail,
          byEmail: "service-estimates",
          byName: "Estimate Approvals"
        }).catch(() => {});
        if (RESEND_API_KEY) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: SHOP_ORDER_NOTIFY_FROM,
              to: [estimate.createdByEmail],
              subject: `Estimate feedback — ${estimate.customerName} is shopping elsewhere (${estimate.svNumber || "service"})`,
              text: [
                `${estimate.customerName} declined service estimate ${estimate.svNumber || ""} ($${Number(estimate.summary?.invoiceTotal || 0).toFixed(2)}) and chose to start their replacement search elsewhere.`,
                feedback ? `Their feedback: "${feedback}"` : "They didn't leave feedback.",
                "They were reminded of the $100 service-client discount toward a purchase over $999.",
                `Contact: ${[estimate.contactPhone, estimate.contactEmail].filter(Boolean).join(" / ") || "on the estimate record"}`
              ].join("\n")
            })
          }).catch((e) => console.error("Estimate-elsewhere email failed:", e.message));
        }
      }
    } else if (choice === "approve") {
      // Internal Podium note on the client's thread — anyone opening the
      // conversation sees the approval without leaving Podium. The respond
      // route is idempotent (already-responded estimates return early), so
      // one approval = one note.
      (async () => {
        if (!podiumOAuthConfigured() || !(await podiumConnected())) return;
        const digits = String(estimate.contactPhone || "").replace(/\D/g, "");
        if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) return;
        const convo = await podiumFindConversationByPhone(digits.length === 11 ? digits.slice(1) : digits);
        if (!convo) return;
        const total = `$${Number(estimate.summary?.invoiceTotal || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        await podiumAddConversationNote(
          convo.uid,
          `${estimate.customerName || "Client"} approved repair estimate${estimate.svNumber ? ` ${estimate.svNumber}` : ""} — ${total}. Schedule the repair.`,
          "Agility"
        );
      })().catch((noteErr) => console.error("Estimate-approved Podium note failed:", noteErr.message));

      // Tell the Client Care rep who sent it (flag + email).
      if (estimate.createdByEmail) {
        createPushedNotification({
          severity: "green",
          typeLabel: "Estimate Approved",
          refId: `svest:${estimate.token}`,
          title: `${estimate.customerName} approved ${estimate.svNumber || "their estimate"} — $${Number(estimate.summary?.invoiceTotal || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          body: "Schedule the repair.",
          audienceEmail: estimate.createdByEmail,
          byEmail: "service-estimates",
          byName: "Estimate Approvals"
        }).catch(() => {});
        if (RESEND_API_KEY) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: SHOP_ORDER_NOTIFY_FROM,
              to: [estimate.createdByEmail],
              subject: `Estimate approved — ${estimate.customerName} (${estimate.svNumber || "service"})`,
              text: `${estimate.customerName} approved ${estimate.svNumber || "their service estimate"} for $${Number(estimate.summary?.invoiceTotal || 0).toFixed(2)}. Schedule the repair.`
            })
          }).catch((e) => console.error("Estimate-approved email failed:", e.message));
        }
      }
    } else {
      // Showroom lead — same fan-out as new web orders (notify-title
      // consultants get the green flag + a claim email with the details).
      const r = estimate.response || {};
      const s = estimate.summary || {};
      const directionText = { similar: "wants something similar to their current unit", new: "open to trying something new", unsure: "not sure yet — wants help deciding" }[r.productDirection] || "";
      const visitText = { visit: "wants to schedule a showroom visit", contact: "wants a call/text first", info: "just wants info sent over" }[r.visit] || "";
      const prefText = { call: "PREFERS A CALL", text: "PREFERS TEXT", email: "PREFERS EMAIL" }[estimate.contactPref] || "";
      const applianceText = [[s.brand, s.product].filter(Boolean).join(" "), s.model ? `Model ${s.model}` : "", s.serial ? `Serial ${s.serial}` : ""].filter(Boolean).join(" · ");
      const detailBits = [directionText, visitText, r.notes ? `Notes: ${r.notes}` : ""].filter(Boolean).join(" · ");

      // Tell the Client Care rep who sent the estimate (flag + email) —
      // their repair isn't happening; the client elected to go shopping.
      if (estimate.createdByEmail) {
        createPushedNotification({
          severity: "green",
          typeLabel: "Estimate — Client Shopping",
          refId: `svshop:${estimate.token}`,
          title: `${estimate.customerName} elected to shop for a replacement (${estimate.svNumber || "service"})`,
          body: `The repair estimate wasn't approved — the showroom team has the lead. ${detailBits || "No preferences given."}`,
          audienceEmail: estimate.createdByEmail,
          byEmail: "service-estimates",
          byName: "Estimate Approvals"
        }).catch(() => {});
        if (RESEND_API_KEY) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: SHOP_ORDER_NOTIFY_FROM,
              to: [estimate.createdByEmail],
              subject: `Client shopping instead — ${estimate.customerName} (${estimate.svNumber || "service"})`,
              text: [
                `${estimate.customerName} elected to shop for a replacement instead of approving service estimate ${estimate.svNumber || ""} ($${Number(estimate.summary?.invoiceTotal || 0).toFixed(2)} repair).`,
                detailBits ? `Their preferences: ${detailBits}` : "",
                "The showroom team has been notified and will claim the lead — no action needed on the repair."
              ].filter(Boolean).join("\n")
            })
          }).catch((e) => console.error("Estimate-shopping creator email failed:", e.message));
        }
      }
      try {
        const [directory, notifyNames] = await Promise.all([listEmployeeDirectory(), listNotifyTitleNames()]);
        const notifySet = new Set(notifyNames.map((n) => n.trim().toLowerCase()));
        const consultants = directory.filter((entry) =>
          !entry.archived &&
          notifySet.has(String(entry.commissionPlan || "").trim().toLowerCase()) &&
          String(entry.email || "").trim()
        );
        for (const consultant of consultants) {
          await createPushedNotification({
            severity: "green",
            typeLabel: "Service Client Lead",
            refId: `svlead:${estimate.token}`,
            claimable: true,
            title: `${estimate.customerName} — replacing instead of repairing (${estimate.svNumber || "service"})`,
            body: [
              applianceText ? `Replacing: ${applianceText}.` : "",
              `${detailBits || "No preferences given."}`,
              `Contact: ${[estimate.contactPhone, estimate.contactEmail].filter(Boolean).join(" / ") || "see estimate record"}${prefText ? ` — ${prefText}` : ""}.`
            ].filter(Boolean).join(" "),
            audienceEmail: consultant.email,
            byEmail: "service-estimates",
            byName: "Estimate Approvals"
          }).catch(() => {});
        }
        if (RESEND_API_KEY && consultants.length) {
          // From-name per the sales team's ask; same verified send address.
          const notifyAddr = (SHOP_ORDER_NOTIFY_FROM.match(/<([^>]+)>/) || [null, SHOP_ORDER_NOTIFY_FROM])[1];
          const leadFrom = `New Lead Available on Your Dash <${notifyAddr}>`;
          const subject = `Service client lead — ${estimate.customerName}`;
          const applianceShort = [[s.brand, s.product].filter(Boolean).join(" "), s.model ? `Model ${s.model}` : ""].filter(Boolean).join(" · ");
          const text = [
            "Sales Team,",
            "",
            "A repair service client has chosen to shop instead of proceeding with repair. View the details below and claim the lead on your Dash.",
            "",
            `Client: ${estimate.customerName}`,
            applianceShort ? `Current appliance: ${applianceShort}` : null,
            [directionText, visitText].filter(Boolean).length ? `Direction & visit: ${[directionText, visitText].filter(Boolean).join(" · ")}` : null,
            r.notes ? `Notes: ${r.notes}` : null,
            `Contact: ${[estimate.contactPhone, estimate.contactEmail].filter(Boolean).join(" / ") || "on the estimate record"}`,
            prefText ? `Contact preference: ${prefText}` : null,
            "",
            `Claim the lead: https://${DASHBOARD_HOST}/dashboard.html`
          ].filter((line) => line !== null).join("\n");
          Promise.allSettled(consultants.map((consultant) =>
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: leadFrom, to: [consultant.email], subject, text })
            })
          )).then((results) => {
            const failed = results.filter((x) => x.status === "rejected");
            if (failed.length) console.error(`Service-lead email failed for ${failed.length}/${consultants.length}:`, failed[0].reason?.message);
          });
        }
      } catch (leadErr) {
        console.error("Service lead fan-out failed:", leadErr.message);
      }
    }

    return res.json({ ok: true, status: estimate.status });
  } catch (err) {
    console.error("Estimate respond failed:", err.message);
    return res.status(500).json({ error: "Unable to record your choice — please call 512-894-0907." });
  }
});

// ===========================================================================
// Podium OAuth — one org-level connection made by an exec. Tokens live in
// Postgres and auto-refresh; every Podium feature (delivery texts, lead-claim
// notes/assignment, later review invites) rides this connection.
// ===========================================================================
const podiumRedirectUri = () => `https://${DASHBOARD_HOST}/api/podium/oauth/callback`;

app.get("/api/podium/oauth/start", requireExecutiveApi, (req, res) => {
  if (!podiumOAuthConfigured()) {
    return res.status(400).json({ error: "Set PODIUM_CLIENT_ID and PODIUM_CLIENT_SECRET first." });
  }
  const state = makeOAuthState(AUTH_COOKIE_SECRET);
  return res.redirect(302, getAuthorizeUrl(podiumRedirectUri(), state));
});

app.get("/api/podium/oauth/callback", requireExecutiveApi, async (req, res) => {
  try {
    if (!verifyOAuthState(String(req.query.state || ""), AUTH_COOKIE_SECRET)) {
      return res.status(400).send("This connect link expired — start again from /api/podium/oauth/start.");
    }
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Podium didn't return an authorization code.");
    const connection = await exchangeOAuthCode(code, podiumRedirectUri(), req.authUser?.email || "");
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "podium_connected", targetUserId: null,
      detail: { locationUid: connection?.locationUid || "" }
    }).catch(() => {});
    return res.send(`<!doctype html><body style="font-family:system-ui;padding:40px;text-align:center;">
      <h2>✓ Podium connected</h2>
      <p>Location ${connection?.locationUid || "(resolving…)"} — texts, lead notes, and assignments now go direct. You can close this tab.</p>
    </body>`);
  } catch (err) {
    console.error("Podium OAuth callback failed:", err.message);
    return res.status(500).send("Connecting Podium failed — check the server logs and try again.");
  }
});

app.get("/api/podium/status", requireExecutiveApi, async (req, res) => {
  try {
    return res.json({ configured: podiumOAuthConfigured(), connection: await getPodiumConnection() });
  } catch (err) {
    return res.status(500).json({ error: "Unable to read the Podium connection." });
  }
});

// ---- Text automations (message-automations.html) --------------------------
// The registry of triggers Agility can text on. Adding a new automation is
// one entry here plus a resolveAutomationTemplate() call at the event site.
const TEXT_AUTOMATION_TRIGGERS = [
  {
    key: "payment_received",
    label: "Payment link paid",
    description: "Fires when a payment link is paid (card immediately, ACH when it clears). Sends at most one text per link, ever — webhook retries and manual syncs can't double-text.",
    vars: ["first_name", "name", "amount", "order"],
    sampleVars: { first_name: "Taylor", name: "Taylor Client", amount: "$1,234.56", order: "S012345" }
  }
];

app.get("/api/podium/automations", requireExecutiveApi, async (req, res) => {
  try {
    const saved = await listPodiumAutomations();
    const triggers = TEXT_AUTOMATION_TRIGGERS.map((t) => {
      const row = saved.find((r) => r.triggerKey === t.key);
      return {
        key: t.key, label: t.label, description: t.description, vars: t.vars,
        templateTitle: row?.templateTitle || "",
        enabled: row?.enabled === true,
        envFallback: t.key === "payment_received" ? PODIUM_TEMPLATE_PAYMENT_RECEIVED : "",
        updatedBy: row?.updatedBy || "", updatedAt: row?.updatedAt || null
      };
    });
    let templates = [];
    try { if (await podiumConnected()) templates = (await listMessageTemplates({ force: true })).map((t) => t.title).filter(Boolean); }
    catch (err) { console.error("Automation template list failed:", err.message); }
    return res.json({ triggers, templates, connected: await podiumConnected() });
  } catch (err) {
    console.error("Automations load failed:", err.message);
    return res.status(500).json({ error: "Unable to load automations." });
  }
});

app.post("/api/podium/automations", requireExecutiveApi, async (req, res) => {
  try {
    const key = String(req.body?.triggerKey || "");
    if (!TEXT_AUTOMATION_TRIGGERS.some((t) => t.key === key)) return res.status(400).json({ error: "Unknown trigger." });
    const enabled = req.body?.enabled === true;
    const templateTitle = String(req.body?.templateTitle || "").trim();
    if (enabled && !templateTitle) return res.status(400).json({ error: "Pick a template before enabling." });
    const row = await upsertPodiumAutomation({ triggerKey: key, templateTitle, enabled, byEmail: req.authUser?.email || "" });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "text_automation_updated", targetUserId: null,
      detail: { trigger: key, template: templateTitle, enabled }
    }).catch(() => {});
    return res.json({ ok: true, automation: row });
  } catch (err) {
    console.error("Automation save failed:", err.message);
    return res.status(500).json({ error: "Unable to save the automation." });
  }
});

// Send a sample of the trigger's template (with placeholder values) to a
// phone the exec types — always explicit, never a customer.
app.post("/api/podium/automations/test", requireExecutiveApi, async (req, res) => {
  try {
    const trigger = TEXT_AUTOMATION_TRIGGERS.find((t) => t.key === String(req.body?.triggerKey || ""));
    if (!trigger) return res.status(400).json({ error: "Unknown trigger." });
    const digits = String(req.body?.phone || "").replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) {
      return res.status(400).json({ error: "Enter a 10-digit phone number." });
    }
    const templateTitle = String(req.body?.templateTitle || "").trim() ||
      await resolveAutomationTemplate(trigger.key, trigger.key === "payment_received" ? PODIUM_TEMPLATE_PAYMENT_RECEIVED : "");
    if (!templateTitle) return res.status(400).json({ error: "Pick a template first." });
    const result = await sendPodiumTemplateText({ phone: digits, templateTitle, vars: trigger.sampleVars });
    if (!result.ok) return res.status(400).json({ error: `Send failed: ${result.error}.` });
    return res.json({ ok: true, usedTemplate: result.usedTemplate });
  } catch (err) {
    console.error("Automation test failed:", err.message);
    return res.status(500).json({ error: "Test send failed." });
  }
});

// The team's Podium templates (titles + text) — handy for picking the exact
// title to put in PODIUM_TEMPLATE_* env vars.
app.get("/api/podium/templates", requireExecutiveApi, async (req, res) => {
  try {
    if (!(await podiumConnected())) return res.status(400).json({ error: "Podium isn't connected yet." });
    return res.json({ templates: await listMessageTemplates({ force: true }) });
  } catch (err) {
    console.error("Podium templates failed:", err.message);
    return res.status(502).json({ error: "Couldn't fetch templates from Podium." });
  }
});

app.post("/api/podium/disconnect", requireExecutiveApi, async (req, res) => {
  try {
    await disconnectPodium();
    recordAudit({ ip: req.ip, actorUserId: req.authUser?.id || null, action: "podium_disconnected", targetUserId: null, detail: {} }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Unable to disconnect." });
  }
});

// ===========================================================================
// Delivery runs — the in-house delivery day (DispatchTrack replacement).
// Dispatch builds a run of stops; Samsara geofences auto-advance statuses;
// Podium texts narrate the day to customers from the showroom number; the
// driver page handles photos/signatures; /track.html is the customer link.
// ===========================================================================
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const SAMSARA_WEBHOOK_KEY = process.env.SAMSARA_WEBHOOK_KEY || "";

const deliveryTrackUrl = (token) => `https://${SERVICE_PUBLIC_HOST}/track.html?t=${token}`;

async function googleGeocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY || !String(address || "").trim()) return null;
  try {
    const base = (process.env.GOOGLE_GEOCODE_API_BASE || "https://maps.googleapis.com").replace(/\/$/, "");
    const res = await fetch(`${base}/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`);
    const data = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    return loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lng: loc.lng } : null;
  } catch (err) {
    console.error("Geocode failed:", err.message);
    return null;
  }
}

async function computeDriveEtaMinutes(fromLat, fromLng, toLat, toLng) {
  if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(Number(n)))) return null;
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const base = (process.env.GOOGLE_ROUTES_API_BASE || "https://routes.googleapis.com").replace(/\/$/, "");
      const res = await fetch(`${base}/directions/v2:computeRoutes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "routes.duration"
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
          destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE"
        })
      });
      const data = await res.json();
      const seconds = Number(String(data?.routes?.[0]?.duration || "").replace(/s$/, ""));
      if (Number.isFinite(seconds) && seconds > 0) return Math.max(2, Math.round(seconds / 60));
    } catch (err) {
      console.error("Routes ETA failed:", err.message);
    }
  }
  return roughEtaMinutes(fromLat, fromLng, toLat, toLng);
}

async function sendDeliveryText(stop, kind, body) {
  const result = await sendCustomerText({ phone: stop.phone, body });
  logDeliveryStopText(stop.id, { kind, to: stop.phone, body, ok: result.ok, transport: result.transport || null, error: result.error || null }).catch(() => {});
  if (!result.ok && result.error !== "bad_phone") console.error(`Delivery text (${kind}) failed for stop ${stop.id}:`, result.error);
  return result;
}

// Text the run's next pending stop that they're up — once per stop, ever.
// Suppressed while the run is paused; resume releases it.
async function notifyNextDeliveryStop(runId) {
  try {
    const run = await getDeliveryRun(runId);
    if (!run || run.status !== "active") return;
    const next = await getNextPendingStop(run.id);
    if (!next || !String(next.phone).trim()) return;
    if (!(await markNextTextSent(next.id))) return;
    let etaBit = " — the truck is on the way";
    try {
      if (run.vehicleId && samsaraConfigured() && next.lat != null && next.lng != null) {
        const loc = await getVehicleLocation(run.vehicleId);
        if (loc) {
          const mins = await computeDriveEtaMinutes(loc.lat, loc.lng, next.lat, next.lng);
          if (mins) etaBit = ` — about ${mins} minutes out`;
        }
      }
    } catch (err) {
      console.error("Next-stop ETA failed:", err.message);
    }
    await sendDeliveryText(next, "next_stop",
      `Wilson AC & Appliance: you're our next delivery stop${etaBit}. Track your delivery here: ${deliveryTrackUrl(next.trackingToken)}`);
  } catch (err) {
    console.error("notifyNextDeliveryStop failed:", err.message);
  }
}

const requireDispatch = requirePagePermission("/dispatch.html");
const requireDriver = requirePagePermission("/driver.html", "/dispatch.html");

async function canTouchRun(req, run) {
  if (!run) return false;
  const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
  if (run.driverEmail && run.driverEmail === email) return true;
  return isExecutiveUser(req.authUser) || await userHoldsPage(req.authUser, "/dispatch.html");
}

app.get("/api/deliveries/runs", requireDispatch, async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : null;
    const runs = await listDeliveryRuns({ date });
    const withStops = await Promise.all(runs.map(async (run) => ({ ...run, stops: await listDeliveryStops(run.id, { includePod: false }) })));
    return res.json({ runs: withStops, samsara: samsaraConfigured(), texting: podiumSendConfigured(), publicHost: SERVICE_PUBLIC_HOST });
  } catch (err) {
    console.error("Delivery runs load failed:", err.message);
    return res.status(500).json({ error: "Unable to load delivery runs." });
  }
});

app.post("/api/deliveries/runs", requireDispatch, async (req, res) => {
  try {
    const run = await createDeliveryRun({ ...req.body, byEmail: req.authUser?.email || req.authUser?.username || "" });
    return res.json({ ok: true, run });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Unable to create the run." });
  }
});

app.post("/api/deliveries/runs/:id/update", requireDispatch, async (req, res) => {
  try {
    const run = await updateDeliveryRun(Number(req.params.id), req.body || {});
    if (!run) return res.status(404).json({ error: "Run not found." });
    return res.json({ ok: true, run });
  } catch (err) {
    return res.status(500).json({ error: "Unable to update the run." });
  }
});

app.delete("/api/deliveries/runs/:id", requireDispatch, async (req, res) => {
  try {
    const ok = await deleteDeliveryRun(Number(req.params.id));
    return ok ? res.json({ ok: true }) : res.status(400).json({ error: "Only planned runs can be deleted." });
  } catch (err) {
    return res.status(500).json({ error: "Unable to delete the run." });
  }
});

app.post("/api/deliveries/runs/:id/stops", requireDispatch, async (req, res) => {
  try {
    const run = await getDeliveryRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found." });
    let { lat = null, lng = null } = req.body || {};
    if ((lat == null || lng == null) && req.body?.address) {
      const geo = await googleGeocodeAddress(req.body.address);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }
    const stop = await addDeliveryStop(run.id, { ...req.body, lat, lng });
    return res.json({ ok: true, stop });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Unable to add the stop." });
  }
});

app.post("/api/deliveries/stops/:id/update", requireDispatch, async (req, res) => {
  try {
    const stop = await updateDeliveryStop(Number(req.params.id), req.body || {});
    if (!stop) return res.status(404).json({ error: "Stop not found." });
    return res.json({ ok: true, stop });
  } catch (err) {
    return res.status(500).json({ error: "Unable to update the stop." });
  }
});

app.delete("/api/deliveries/stops/:id", requireDispatch, async (req, res) => {
  try {
    const stop = await getDeliveryStop(Number(req.params.id));
    if (stop?.geofenceId && samsaraConfigured()) deleteStopGeofence(stop.geofenceId).catch(() => {});
    const ok = await deleteDeliveryStop(Number(req.params.id));
    return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Stop not found." });
  } catch (err) {
    return res.status(500).json({ error: "Unable to remove the stop." });
  }
});

app.post("/api/deliveries/runs/:id/reorder", requireDispatch, async (req, res) => {
  try {
    const stops = await reorderDeliveryStops(Number(req.params.id), (req.body?.stopIds || []).map(Number));
    return res.json({ ok: true, stops });
  } catch (err) {
    return res.status(500).json({ error: "Unable to reorder stops." });
  }
});

// Start the day: create Samsara geofences (best effort), send each customer
// their morning "today's the day" text, then queue the first next-stop text.
app.post("/api/deliveries/runs/:id/start", requireDispatch, async (req, res) => {
  try {
    const run = await getDeliveryRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (run.status !== "planned") return res.status(400).json({ error: "This run has already started." });
    const stops = await listDeliveryStops(run.id, { includePod: false });
    if (!stops.length) return res.status(400).json({ error: "Add at least one stop before starting the run." });

    const warnings = [];
    if (samsaraConfigured()) {
      for (const stop of stops) {
        if (stop.lat == null || stop.lng == null || stop.geofenceId) continue;
        try {
          const geofenceId = await createStopGeofence({
            name: `Run ${run.runDate} #${stop.seq} — ${stop.customerName}`,
            formattedAddress: stop.address,
            lat: stop.lat, lng: stop.lng
          });
          if (geofenceId) await updateDeliveryStop(stop.id, { geofenceId });
        } catch (err) {
          warnings.push(`Geofence failed for stop ${stop.seq} (${stop.customerName}).`);
          console.error("Geofence create failed:", err.message);
        }
      }
    } else {
      warnings.push("Samsara isn't configured — statuses advance from driver taps only.");
    }

    const started = await setDeliveryRunStatus(run.id, "active");

    for (const stop of stops) {
      if (!String(stop.phone).trim()) continue;
      await sendDeliveryText(stop, "morning",
        `Wilson AC & Appliance: your delivery is today${stop.windowText ? ` (${stop.windowText})` : ""}. We'll text when you're next up. Track it anytime: ${deliveryTrackUrl(stop.trackingToken)}`);
    }
    await notifyNextDeliveryStop(run.id);

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "delivery_run_started", targetUserId: null,
      detail: { runId: run.id, runDate: run.runDate, stops: stops.length, driver: run.driverEmail }
    }).catch(() => {});

    return res.json({ ok: true, run: started, warnings });
  } catch (err) {
    console.error("Run start failed:", err.message);
    return res.status(500).json({ error: "Unable to start the run." });
  }
});

app.post("/api/deliveries/runs/:id/finish", requireDriver, async (req, res) => {
  try {
    const run = await getDeliveryRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (!(await canTouchRun(req, run))) return res.status(403).json({ error: "Not your run." });
    const stops = await listDeliveryStops(run.id, { includePod: false });
    if (samsaraConfigured()) {
      for (const stop of stops) if (stop.geofenceId) deleteStopGeofence(stop.geofenceId).catch(() => {});
    }
    const finished = await setDeliveryRunStatus(run.id, "done");
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "delivery_run_finished", targetUserId: null,
      detail: { runId: run.id, runDate: run.runDate, done: stops.filter((s) => s.status === "done").length, total: stops.length }
    }).catch(() => {});
    return res.json({ ok: true, run: finished });
  } catch (err) {
    return res.status(500).json({ error: "Unable to finish the run." });
  }
});

// Driver "taking a break" — pauses auto-texts; resume releases the pending one.
app.post("/api/deliveries/runs/:id/pause", requireDriver, async (req, res) => {
  try {
    const run = await getDeliveryRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (!(await canTouchRun(req, run))) return res.status(403).json({ error: "Not your run." });
    if (run.status !== "active") return res.status(400).json({ error: "The run isn't active." });
    const paused = await setDeliveryRunStatus(run.id, "paused", { pauseNote: req.body?.note || "" });
    return res.json({ ok: true, run: paused });
  } catch (err) {
    return res.status(500).json({ error: "Unable to pause." });
  }
});

app.post("/api/deliveries/runs/:id/resume", requireDriver, async (req, res) => {
  try {
    const run = await getDeliveryRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (!(await canTouchRun(req, run))) return res.status(403).json({ error: "Not your run." });
    if (run.status !== "paused") return res.status(400).json({ error: "The run isn't paused." });
    const resumed = await setDeliveryRunStatus(run.id, "active");
    await notifyNextDeliveryStop(run.id);
    return res.json({ ok: true, run: resumed });
  } catch (err) {
    return res.status(500).json({ error: "Unable to resume." });
  }
});

app.get("/api/deliveries/vehicles", requireDispatch, async (req, res) => {
  try {
    if (!samsaraConfigured()) return res.json({ vehicles: [], configured: false });
    return res.json({ vehicles: await listSamsaraVehicles(), configured: true });
  } catch (err) {
    console.error("Samsara vehicles failed:", err.message);
    return res.status(502).json({ error: "Couldn't reach Samsara." });
  }
});

// ---- driver page -----------------------------------------------------------

app.get("/api/deliveries/my-run", requireDriver, async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
    const run = await getRunForDriver(email, today);
    if (!run) return res.json({ run: null });
    const stops = await listDeliveryStops(run.id);
    return res.json({ run, stops, publicHost: SERVICE_PUBLIC_HOST });
  } catch (err) {
    console.error("My-run load failed:", err.message);
    return res.status(500).json({ error: "Unable to load your run." });
  }
});

app.post("/api/deliveries/stops/:id/status", requireDriver, async (req, res) => {
  try {
    const stop = await getDeliveryStop(Number(req.params.id));
    if (!stop) return res.status(404).json({ error: "Stop not found." });
    const run = await getDeliveryRun(stop.runId);
    if (!(await canTouchRun(req, run))) return res.status(403).json({ error: "Not your run." });
    const status = String(req.body?.status || "");
    if (!["arrived", "done", "skipped", "exception"].includes(status)) {
      return res.status(400).json({ error: "Bad status." });
    }
    const updated = await setDeliveryStopStatus(stop.id, status, { exceptionNote: req.body?.exceptionNote || "" });
    if (["done", "skipped", "exception"].includes(status)) {
      await notifyNextDeliveryStop(stop.runId);
      if (status === "done" && String(stop.phone).trim()) {
        await sendDeliveryText(updated, "completed",
          `Wilson AC & Appliance: your delivery is complete — thank you! Questions? Just reply to this text.`);
      }
    }
    return res.json({ ok: true, stop: updated });
  } catch (err) {
    console.error("Stop status failed:", err.message);
    return res.status(500).json({ error: "Unable to update the stop." });
  }
});

app.post("/api/deliveries/stops/:id/photo", requireDriver, async (req, res) => {
  try {
    const stop = await getDeliveryStop(Number(req.params.id));
    if (!stop) return res.status(404).json({ error: "Stop not found." });
    if (!(await canTouchRun(req, await getDeliveryRun(stop.runId)))) return res.status(403).json({ error: "Not your run." });
    const dataUrl = String(req.body?.dataUrl || "");
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return res.status(400).json({ error: "Send a photo." });
    if (dataUrl.length > 2_500_000) return res.status(400).json({ error: "Photo too large — retake at lower quality." });
    const updated = await addDeliveryStopPhoto(stop.id, dataUrl);
    if (!updated) return res.status(400).json({ error: "Photo limit reached for this stop." });
    return res.json({ ok: true, photoCount: updated.photoCount });
  } catch (err) {
    return res.status(500).json({ error: "Unable to save the photo." });
  }
});

app.post("/api/deliveries/stops/:id/signature", requireDriver, async (req, res) => {
  try {
    const stop = await getDeliveryStop(Number(req.params.id));
    if (!stop) return res.status(404).json({ error: "Stop not found." });
    if (!(await canTouchRun(req, await getDeliveryRun(stop.runId)))) return res.status(403).json({ error: "Not your run." });
    const dataUrl = String(req.body?.dataUrl || "");
    if (!/^data:image\/(png|jpeg);base64,/.test(dataUrl) || dataUrl.length > 500_000) {
      return res.status(400).json({ error: "Signature capture failed — try again." });
    }
    await setDeliveryStopSignature(stop.id, { dataUrl, signedName: req.body?.signedName || "" });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Unable to save the signature." });
  }
});

// ---- PUBLIC: customer tracking page ---------------------------------------

app.post("/api/track", async (req, res) => {
  try {
    const stop = await getDeliveryStopByToken(String(req.body?.token || "").slice(0, 80));
    if (!stop) return res.status(404).json({ error: "This tracking link isn't valid." });
    const run = await getDeliveryRun(stop.runId);
    const firstName = (String(stop.customerName).trim().split(/\s+/)[0] || "there");
    const payload = {
      firstName,
      windowText: stop.windowText,
      runDate: run?.runDate || null,
      status: stop.status,
      runStatus: run?.status || "planned",
      paused: run?.status === "paused",
      completedAt: stop.completedAt
    };
    if (run && ["active", "paused"].includes(run.status) && ["pending", "arrived"].includes(stop.status)) {
      payload.stopsAhead = await countStopsAhead(stop);
      // The truck's position is only shared when this customer is up next
      // (or the truck is at their home) — not all day.
      if (payload.stopsAhead === 0 && run.status === "active" && run.vehicleId && samsaraConfigured()) {
        try {
          const loc = await getVehicleLocation(run.vehicleId);
          if (loc) {
            payload.truck = { lat: loc.lat, lng: loc.lng, at: loc.at };
            if (stop.lat != null && stop.lng != null) {
              payload.etaMinutes = await computeDriveEtaMinutes(loc.lat, loc.lng, stop.lat, stop.lng);
            }
          }
        } catch (err) {
          console.error("Track truck location failed:", err.message);
        }
      }
    }
    return res.json(payload);
  } catch (err) {
    console.error("Track failed:", err.message);
    return res.status(500).json({ error: "Unable to load tracking right now." });
  }
});

// ---- Samsara webhook: geofence entry/exit auto-advances the day -----------

app.post("/api/samsara/webhook/:key", async (req, res) => {
  try {
    if (!SAMSARA_WEBHOOK_KEY || req.params.key !== SAMSARA_WEBHOOK_KEY) {
      return res.status(403).json({ error: "Bad key." });
    }
    const event = parseGeofenceEvent(req.body || {});
    if (!event || !event.addressId) return res.json({ ok: true, ignored: true });
    const stop = await getDeliveryStopByGeofence(event.addressId);
    if (!stop) return res.json({ ok: true, ignored: true });

    if (event.kind === "entry" && stop.status === "pending") {
      await setDeliveryStopStatus(stop.id, "arrived");
    } else if (event.kind === "exit" && ["arrived", "done"].includes(stop.status)) {
      await markDeliveryStopDeparted(stop.id);
      // Truck rolling → the next customer gets their heads-up (paperwork can
      // finish later; the guard makes this a no-op if already sent).
      await notifyNextDeliveryStop(stop.runId);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Samsara webhook failed:", err.message);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
});

// PUBLIC: Sub-Zero landing page consultation requests (subzero.html on the
// service host). Same routing as new web orders: a green dashboard flag and
// an email to every consultant whose job title receives web-order alerts.
const subzeroInquiryAttempts = new Map(); // ip -> [timestamps]
app.post("/api/subzero/inquiry", async (req, res) => {
  try {
    const now = Date.now();
    const hits = (subzeroInquiryAttempts.get(req.ip) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (hits.length >= 10) {
      return res.status(429).json({ error: "Too many requests — please call the showroom at 512-894-0907." });
    }
    hits.push(now);
    subzeroInquiryAttempts.set(req.ip, hits);

    const name = String(req.body?.name || "").trim().slice(0, 120);
    const contact = String(req.body?.contact || "").trim().slice(0, 160);
    const role = String(req.body?.role || "").trim().slice(0, 40);
    const message = String(req.body?.message || "").trim().slice(0, 1200);
    if (!name || !contact) {
      return res.status(400).json({ error: "Please include your name and an email or phone number." });
    }

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "subzero_inquiry", targetUserId: null,
      detail: { name, contact, role, message: message.slice(0, 300) }
    }).catch(() => {});

    const [directory, notifyNames] = await Promise.all([listEmployeeDirectory(), listNotifyTitleNames()]);
    const notifySet = new Set(notifyNames.map((n) => n.trim().toLowerCase()));
    const consultants = directory.filter((entry) =>
      !entry.archived &&
      notifySet.has(String(entry.commissionPlan || "").trim().toLowerCase()) &&
      String(entry.email || "").trim()
    );
    for (const consultant of consultants) {
      await createPushedNotification({
        severity: "green",
        typeLabel: "Sub-Zero Design Inquiry",
        refId: `subzero:${now}`,
        title: `${name} (${role || "prospect"}) — ${contact}`,
        body: message ? message.slice(0, 240) : "Consultation requested from the Sub-Zero landing page.",
        audienceEmail: consultant.email,
        claimable: true, // DIBS-able like a service lead: first claim wins, the rest vanish
        byEmail: "subzero-landing",
        byName: "Sub-Zero Landing Page"
      }).catch(() => {});
    }
    if (RESEND_API_KEY && consultants.length) {
      const subject = `Sub-Zero design inquiry — ${name}`;
      const text = `${name} (${role || "prospect"})\nContact: ${contact}\n\n${message || "(no project details given)"}\n\nSubmitted from the Sub-Zero landing page.`;
      Promise.allSettled(consultants.map((consultant) =>
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: SHOP_ORDER_NOTIFY_FROM, to: [consultant.email], subject, text })
        })
      )).then((results) => {
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length) console.error(`Sub-Zero inquiry email failed for ${failed.length}/${consultants.length}:`, failed[0].reason?.message);
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Sub-Zero inquiry failed:", err.message);
    return res.status(500).json({ error: "Unable to send that right now — please call 512-894-0907." });
  }
});

// PUBLIC: finish checkout after the card is saved client-side. Verifies the
// SetupIntent actually succeeded, re-prices the cart, web-locks the units on
// the hit list, and files the order for the sales team.
app.post("/api/shop/submit-order", async (req, res) => {
  try {
    const shopper = await getShopperByToken(req.body?.token);
    if (!shopper) return res.status(401).json({ error: "Please register to check out." });

    const setupIntentId = String(req.body?.setupIntentId || "").trim();
    if (!/^seti_/.test(setupIntentId)) return res.status(400).json({ error: "Missing card setup reference." });

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({ error: "Your card wasn't saved — please try the card step again." });
    }
    if (setupIntent.metadata?.shop_shopper_id !== shopper.id) {
      return res.status(400).json({ error: "This card setup doesn't match your session." });
    }

    const catalog = await computeShopCatalog();
    if (catalog.paused) return res.status(503).json({ error: "Online checkout is briefly paused while we refresh inventory. Please try again soon or call the store." });
    const priced = priceShopCart(catalog, req.body?.cart, req.body?.fulfillment);
    if (priced.badSchedule) {
      return res.status(400).json({ error: "Please pick a day for your delivery or pickup — the option you selected is no longer available." });
    }
    if (priced.empty) return res.status(400).json({ error: "Your cart is empty." });
    if (priced.unavailable) {
      return res.status(409).json({ error: "An item in your cart was just claimed by another buyer. Refresh to see what's still available." });
    }

    const card = setupIntent.payment_method?.card || {};
    const cardSummary = card.brand
      ? { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year }
      : {};

    // File the order, then lock its units. A lock conflict here is a
    // photo-finish race — the order still files with the conflict recorded
    // so the sales team can sort it out with the client.
    const lockConflicts = [];

    const order = await createShopOrder({
      shopperId: shopper.id,
      customer: {
        firstName: shopper.firstName,
        lastName: shopper.lastName,
        email: shopper.email,
        phone: shopper.phone,
        preferredContact: shopper.preferredContact,
        clientCode: shopper.clientCode,
        address: shopper.address
      },
      items: priced.items,
      addons: priced.addons,
      delivery: priced.delivery,
      totals: priced.totals,
      lockConflicts: [],
      stripeCustomerId: String(setupIntent.customer || ""),
      setupIntentId,
      cardSummary
    });

    for (const item of priced.items) {
      try {
        const lock = await markWebLock({ itemId: item.id, orderNumber: order.orderNumber });
        if (lock.conflict) lockConflicts.push({ itemId: item.id, model: item.model, existing: lock.existing });
      } catch (err) {
        lockConflicts.push({ itemId: item.id, model: item.model, error: err.message });
      }
    }
    if (lockConflicts.length) {
      // Persist what happened for the module to show loudly.
      await updateShopOrderLockConflicts({ id: order.id, lockConflicts }).catch(() => {});
    }

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_order_submitted", targetUserId: null,
      detail: {
        orderNumber: order.orderNumber,
        items: priced.items.length,
        total: priced.totals.total,
        fulfillment: priced.totals.fulfillment,
        deliveryDate: priced.totals.deliveryDate,
        conflicts: lockConflicts.length
      }
    }).catch(() => {});

    // Green flag on every Showroom Consultant's dashboard (routed by the
    // directory's job title) so new web orders get claimed fast.
    pushWebOrderFlags({
      orderNumber: order.orderNumber,
      customerName: `${shopper.firstName} ${shopper.lastName}`,
      total: priced.totals.total,
      models: priced.items.map((i) => i.model),
      fulfillment: priced.delivery.method === "pickup"
        ? (priced.delivery.later ? "Customer pickup — will schedule later" : `Customer pickup requested ${priced.delivery.dateLabel}`)
        : `Delivery requested ${priced.delivery.dateLabel}`
    }).catch((err) => console.error("Web order notification push failed:", err.message));

    return res.json({
      success: true,
      orderNumber: order.orderNumber,
      totals: priced.totals
    });
  } catch (err) {
    console.error("Shop order submit failed:", err.message);
    return res.status(500).json({ error: "Unable to file your order. Your card was not charged." });
  }
});

// PUBLIC: card-save result poll (mirrors the service flow).
app.get("/api/shop/setup-intent-result/:setupIntentId", async (req, res) => {
  try {
    const setupIntent = await stripe.setupIntents.retrieve(req.params.setupIntentId, { expand: ["payment_method"] });
    const card = setupIntent.payment_method?.card || {};
    return res.json({
      status: setupIntent.status,
      card: card.brand ? { brand: card.brand, last4: card.last4 } : null
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Unable to check the card status." });
  }
});

// INTERNAL: the sales module. Orders newest-first plus the snapshot banner.
app.get("/api/shop-orders", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const [orders, snapshot, mapPrices] = await Promise.all([
      listShopOrders(),
      getShopInventorySnapshot().catch(() => null),
      getShopMapPrices().catch(() => null)
    ]);
    const snapshotAgeHours = snapshot?.uploadedAt
      ? (Date.now() - Date.parse(snapshot.uploadedAt)) / 3600000
      : null;
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      orders,
      snapshot: snapshot
        ? {
            uploadedAt: snapshot.uploadedAt,
            sourceFile: snapshot.sourceFile,
            count: new Set((snapshot.serials || []).map((k) => String(k).split("|").pop())).size,
            typedCount: Object.keys(snapshot.serialTypes || {}).length,
            writtenCount: Object.keys(snapshot.serialWritten || {}).length,
            uploadedBy: snapshot.uploadedBy,
            stale: Number.isFinite(snapshotAgeHours) && snapshotAgeHours > SHOP_SNAPSHOT_MAX_AGE_HOURS,
            maxAgeHours: SHOP_SNAPSHOT_MAX_AGE_HOURS
          }
        : null,
      mapPrices: mapPrices
        ? { count: mapPrices.count, fetchedAt: mapPrices.fetchedAt, sourceNote: mapPrices.sourceNote }
        : null,
      mapFeedConfigured: Boolean(SHOP_MAP_PRICE_URL),
      mapFeedLastAttempt: shopMapLastAttempt,
      allowedZips: [...SHOP_ALLOWED_ZIPS]
    });
  } catch (err) {
    console.error("Shop orders load failed:", err.message);
    return res.status(500).json({ error: "Unable to load shop orders." });
  }
});

// INTERNAL: grab an order (first writer wins).
app.post("/api/shop-orders/:id/claim", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    if (!userEmail) return res.status(400).json({ error: "Sign in with your individual account to claim an order." });

    const order = await claimShopOrder({
      id: req.params.id,
      byEmail: userEmail,
      byName: req.authUser?.displayName || ""
    });
    if (!order) {
      const existing = await getShopOrder(req.params.id);
      return res.status(409).json({
        error: existing?.claimedByName
          ? `Already claimed by ${existing.claimedByName}.`
          : "This order is no longer claimable.",
        order: existing
      });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_order_claimed", targetUserId: null,
      detail: { orderNumber: order.orderNumber }
    }).catch(() => {});

    // The race is over — pull the green flag off every consultant's dashboard.
    retirePushedNotificationsByRef(`weborder:${order.orderNumber}`).catch(() => {});

    return res.json({ ok: true, order });
  } catch (err) {
    console.error("Shop order claim failed:", err.message);
    return res.status(500).json({ error: "Unable to claim the order." });
  }
});

// INTERNAL: release a claim back to the pool (grabbed it, then the phone
// rang). The claimer or an executive can unclaim; the green flags re-push
// to every consultant so the order gets picked up again.
app.post("/api/shop-orders/:id/unclaim", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const existing = await getShopOrder(req.params.id);
    if (!existing) return res.status(404).json({ error: "Order not found." });
    if (existing.status !== "claimed") return res.status(409).json({ error: "Only claimed orders can be unclaimed." });

    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    if (existing.claimedByEmail !== userEmail && !isExecutiveUser(req.authUser)) {
      return res.status(403).json({ error: `Only ${existing.claimedByName || existing.claimedByEmail} or an executive can unclaim this order.` });
    }

    const order = await unclaimShopOrder({ id: req.params.id });
    if (!order) return res.status(409).json({ error: "This order is no longer claimed." });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_order_unclaimed", targetUserId: null,
      detail: { orderNumber: order.orderNumber, previouslyClaimedBy: existing.claimedByEmail }
    }).catch(() => {});

    // Reopen the race.
    pushWebOrderFlags({
      orderNumber: order.orderNumber,
      customerName: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Web customer",
      total: order.totals?.total,
      models: (order.items || []).map((i) => i.model)
    }).catch((err) => console.error("Unclaim re-push failed:", err.message));

    return res.json({ ok: true, order });
  } catch (err) {
    console.error("Shop order unclaim failed:", err.message);
    return res.status(500).json({ error: "Unable to unclaim the order." });
  }
});

// INTERNAL: finish an order as an ePASS ticket — flips the web locks to Sold
// under the ticket number so the hit list shows the final state.
app.post("/api/shop-orders/:id/complete", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const epassTicket = String(req.body?.epassTicket || "").trim();
    if (!epassTicket) return res.status(400).json({ error: "Enter the ePASS ticket number." });

    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    const order = await completeShopOrder({ id: req.params.id, epassTicket });
    if (!order) return res.status(409).json({ error: "This order can't be completed (already completed or canceled)." });

    for (const item of order.items || []) {
      await upgradeWebToSold({
        itemId: item.id,
        salesOrder: epassTicket,
        byEmail: userEmail,
        byName: req.authUser?.displayName || ""
      }).catch(() => {});
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_order_completed", targetUserId: null,
      detail: { orderNumber: order.orderNumber, epassTicket }
    }).catch(() => {});
    retirePushedNotificationsByRef(`weborder:${order.orderNumber}`).catch(() => {});

    return res.json({ ok: true, order });
  } catch (err) {
    console.error("Shop order complete failed:", err.message);
    return res.status(500).json({ error: "Unable to complete the order." });
  }
});

// INTERNAL: cancel an order and release its web locks (only locks that still
// belong to this order — a unit re-sold in the meantime is left alone).
app.post("/api/shop-orders/:id/cancel", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const order = await cancelShopOrder({ id: req.params.id, reason: req.body?.reason || "" });
    if (!order) return res.status(409).json({ error: "This order can't be canceled (already completed or canceled)." });

    for (const item of order.items || []) {
      try {
        const status = await getClearanceStatus(item.id);
        if (status && status.status === "web" && status.salesOrder === order.orderNumber) {
          await clearClearanceStatus(item.id);
        }
      } catch {}
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_order_canceled", targetUserId: null,
      detail: { orderNumber: order.orderNumber, reason: order.cancelReason }
    }).catch(() => {});
    retirePushedNotificationsByRef(`weborder:${order.orderNumber}`).catch(() => {});

    return res.json({ ok: true, order });
  } catch (err) {
    console.error("Shop order cancel failed:", err.message);
    return res.status(500).json({ error: "Unable to cancel the order." });
  }
});

// INTERNAL: refresh the availability snapshot from the latest ePASS
// ExportModel export (parsed in the browser; serials only travel here).
app.post("/api/shop/inventory-snapshot", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const serials = Array.isArray(req.body?.serials) ? req.body.serials : [];
    if (!serials.length) return res.status(400).json({ error: "No serial numbers found in that file." });
    if (serials.length > 50000) return res.status(400).json({ error: "That file has more serials than expected — is it the right export?" });
    const asMap = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const types = asMap(req.body?.types);
    const written = asMap(req.body?.written);
    if (Object.keys(types).length > 50000 || Object.keys(written).length > 50000) {
      return res.status(400).json({ error: "That file has more serial rows than expected." });
    }

    const userEmail = String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase();
    const saved = await saveShopInventorySnapshot({
      serials,
      types,
      written,
      units: Array.isArray(req.body?.units) ? req.body.units : [],
      sourceFile: String(req.body?.sourceFile || "").slice(0, 200),
      uploadedBy: userEmail
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_snapshot_uploaded", targetUserId: null,
      detail: { count: saved.count, sourceFile: String(req.body?.sourceFile || "").slice(0, 120) }
    }).catch(() => {});

    return res.json({ ok: true, count: saved.count, typedCount: saved.typedCount, writtenCount: saved.writtenCount });
  } catch (err) {
    console.error("Shop snapshot upload failed:", err.message);
    return res.status(500).json({ error: "Unable to save the snapshot." });
  }
});

// ---------------------------------------------------------------------------
// AUTOMATED snapshot feed — the store server PC posts the raw ExportModel
// .xlsx nightly (scripts/upload-inventory-snapshot.ps1, Windows Task
// Scheduler). Auth is a shared key (SHOP_SNAPSHOT_KEY), not a session, so
// the parse happens HERE — the exact same extraction the browser upload
// does: composite MODELKEY|SERIAL keys per model-column spelling, Serial
// Type map, Written To map.
// ---------------------------------------------------------------------------

function extractSerialsFromWorkbook(buffer) {
  const workbook = readWorkbook(buffer, { type: "buffer", dense: true });
  const normHeader = (v) => String(v == null ? "" : v).replace(/[\s ]+/g, " ").trim().toLowerCase();
  const normModel = (v) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

  for (const name of workbook.SheetNames) {
    const grid = xlsxUtils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null });
    const headerIndex = grid.findIndex((row) => {
      if (!row) return false;
      const t = row.map(normHeader);
      return t.includes("serial") && t.some((x) => x === "* model" || x === "model" || x === "sku");
    });
    if (headerIndex < 0) continue;
    const headerTexts = grid[headerIndex].map(normHeader);
    // ePASS stars the sorted column ("* model") — strip the marker everywhere.
    const col = (name) => {
      const target = String(name).toLowerCase();
      return headerTexts.findIndex((h) => h.replace(/^\*\s*/, "") === target);
    };
    const serialCol = col("serial");
    const typeCol = col("serial type");
    const writtenCol = col("written to");
    const modelCol = col("model");
    const skuCol = col("sku");
    const brandCol = col("brand");
    const descCol = col("description");
    const prodCol = col("prod");
    const receivedCol = col("received");
    const costCol = col("act cost");
    const listCol = col("l1");
    const modelCols = [modelCol, skuCol].filter((c) => c >= 0);

    // Excel dates arrive as serial numbers, Date objects, or strings.
    const toIsoDate = (v) => {
      if (v == null || v === "") return "";
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
      if (typeof v === "number" && v > 20000 && v < 80000) {
        return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000 - Date.UTC(1970, 0, 1) + Date.UTC(1970, 0, 1)).toISOString().slice(0, 10);
      }
      const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[0];
      const us = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      return "";
    };

    const serials = new Set();
    const types = {};
    const written = {};
    const units = new Set();
    const unitRows = [];
    const seenUnitSerials = new Set();
    for (let r = headerIndex + 1; r < grid.length; r++) {
      const serial = String(grid[r]?.[serialCol] ?? "").trim().toUpperCase();
      if (!serial) continue;
      units.add(serial);
      const type = typeCol >= 0 ? String(grid[r]?.[typeCol] ?? "").trim() : "";
      const writtenTo = writtenCol >= 0 ? String(grid[r]?.[writtenCol] ?? "").trim() : "";
      // Serials repeat across models in ePASS (accessory tags like "00019"),
      // so unit identity is model|serial, matching the availability keys.
      const unitKey = (normModel(grid[r]?.[modelCol]) || normModel(grid[r]?.[skuCol]) || "?") + "|" + serial;
      if (!seenUnitSerials.has(unitKey)) {
        seenUnitSerials.add(unitKey);
        unitRows.push({
          serial,
          model: modelCol >= 0 ? String(grid[r]?.[modelCol] ?? "").trim() : "",
          sku: skuCol >= 0 ? String(grid[r]?.[skuCol] ?? "").trim() : "",
          brand: brandCol >= 0 ? String(grid[r]?.[brandCol] ?? "").trim() : "",
          description: descCol >= 0 ? String(grid[r]?.[descCol] ?? "").trim() : "",
          prod: prodCol >= 0 ? String(grid[r]?.[prodCol] ?? "").trim() : "",
          serialType: type,
          writtenTo,
          received: receivedCol >= 0 ? toIsoDate(grid[r]?.[receivedCol]) : "",
          cost: costCol >= 0 ? Number(grid[r]?.[costCol]) || 0 : 0,
          list: listCol >= 0 ? Number(grid[r]?.[listCol]) || 0 : 0
        });
      }
      const keys = new Set();
      for (const c of modelCols) {
        const mk = normModel(grid[r]?.[c]);
        if (mk) keys.add(mk + "|" + serial);
      }
      if (!keys.size) keys.add(serial);
      for (const key of keys) {
        serials.add(key);
        if (type) types[key] = type;
        if (writtenTo) written[key] = writtenTo;
      }
    }
    return { serials: [...serials], types, written, units: unitRows, unitCount: units.size };
  }
  throw new Error("Couldn't find a Serial column — is this the ExportModel (Model Maintenance) export?");
}

function snapshotKeyOk(provided) {
  if (!SHOP_SNAPSHOT_KEY || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(SHOP_SNAPSHOT_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// INTERNAL: ePASS Upload Center (epass-uploads.html) — one page where the
// office (Tracy) keeps every recurring ePASS export current until the
// exports are automated. Status + a session-gated inventory upload; the
// other uploads reuse their existing endpoints with this page added to
// their permission lists.
const epassInventoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

app.get("/api/epass-uploads/status", requirePagePermission("/epass-uploads.html"), async (req, res) => {
  try {
    const [snapshot, quoteMeta, versions, mapPrices, openOrders] = await Promise.all([
      getShopInventorySnapshot().catch(() => null),
      getLatestQuoteUploadMeta().catch(() => null),
      listSourceVersions().catch(() => ({ oe23: [], commissions: [] })),
      getShopMapPrices().catch(() => null),
      getOpenOrdersMeta().catch(() => null)
    ]);
    return res.json({
      inventory: snapshot ? { sourceFile: snapshot.sourceFile, uploadedAt: snapshot.uploadedAt, uploadedBy: snapshot.uploadedBy, count: (snapshot.serials || []).length } : null,
      openOrders,
      quotes: quoteMeta,
      oe23: (versions.oe23 || [])[0] || null,
      commissions: (versions.commissions || [])[0] || null,
      mapFeed: mapPrices ? { fetchedAt: mapPrices.fetchedAt, count: mapPrices.count, sourceNote: mapPrices.sourceNote, lastAttempt: shopMapLastAttempt } : { lastAttempt: shopMapLastAttempt },
      snapshotMaxAgeHours: SHOP_SNAPSHOT_MAX_AGE_HOURS
    });
  } catch (err) {
    console.error("ePASS status failed:", err.message);
    return res.status(500).json({ error: "Unable to load upload status." });
  }
});

// ---------------------------------------------------------------------------
// Maintenance module (pilot, Test Modules): Wilson sales-invoice import.
// Serves the invoice-import tab in /maintenance/admin.html — the JS port of
// the maintenance prototype's Python parser (lib/maintenance-invoice-parser.js).
// ---------------------------------------------------------------------------

const maintenanceInvoiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 10 } });

app.post("/api/invoice/import", requirePagePermission("/maintenance/admin.html"), (req, res) => {
  maintenanceInvoiceUpload.array("invoices", 10)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.code === "LIMIT_FILE_SIZE" ? "A file is over the 30 MB limit." : "Upload failed — please try again." });
    }
    try {
      const files = (req.files || []).filter((f) => f?.buffer?.length);
      if (!files.length) {
        return res.status(400).json({ ok: false, error: "Attach at least one Wilson sales invoice PDF." });
      }
      const result = await parseMaintenanceInvoices(
        files.map((f) => ({ filename: String(f.originalname || "invoice.pdf").slice(0, 200), buffer: f.buffer }))
      );
      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "maintenance_invoices_parsed", targetUserId: null,
        detail: {
          invoiceNumbers: result.invoiceNumbers,
          lineItemCount: result.lineItemCount,
          ignoredCount: result.ignored.length,
          sourceFiles: result.sourceFiles
        }
      }).catch(() => {});
      return res.json(result);
    } catch (parseErr) {
      console.error("Maintenance invoice import failed:", parseErr.message);
      return res.status(400).json({ ok: false, error: "The invoices could not be parsed — are they Wilson sales invoice PDFs?" });
    }
  });
});

app.post("/api/epass-uploads/inventory", requirePagePermission("/epass-uploads.html", "/shop-orders.html"), (req, res) => {
  epassInventoryUpload.single("report")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That file is over the 60 MB limit." : "Upload failed — please try again." });
    }
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Attach the ExportModel inventory export (.xlsx)." });
      }
      const { serials, types, written, units, unitCount } = extractSerialsFromWorkbook(req.file.buffer);
      if (!serials.length) return res.status(400).json({ error: "No serial numbers found in that file — is it the ExportModel export?" });
      const saved = await saveShopInventorySnapshot({
        serials, types, written,
      units,
        sourceFile: String(req.file.originalname || "ExportModel").slice(0, 200),
        uploadedBy: String(req.authUser?.kind === "db" ? req.authUser.email : "").toLowerCase()
      });
      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "shop_snapshot_uploaded", targetUserId: null,
        detail: { count: saved.count, sourceFile: String(req.file.originalname || "").slice(0, 120), via: "upload-center" }
      }).catch(() => {});
      return res.json({ ok: true, count: saved.count, unitCount });
    } catch (uploadErr) {
      console.error("Upload-center snapshot failed:", uploadErr.message);
      return res.status(400).json({ error: uploadErr.message || "Unable to parse that file." });
    }
  });
});

app.post("/api/shop/inventory-snapshot/file", express.raw({ type: () => true, limit: "60mb" }), async (req, res) => {
  try {
    if (!SHOP_SNAPSHOT_KEY) return res.status(503).json({ error: "Automated snapshot uploads are not configured (SHOP_SNAPSHOT_KEY)." });
    if (!snapshotKeyOk(req.headers["x-snapshot-key"])) return res.status(401).json({ error: "Bad snapshot key." });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "No file received." });

    const { serials, types, written, units, unitCount } = extractSerialsFromWorkbook(req.body);
    if (!serials.length) return res.status(400).json({ error: "No serial numbers found in that file." });

    const sourceFile = String(req.headers["x-source-file"] || "ExportModel (automated)").slice(0, 200);
    const saved = await saveShopInventorySnapshot({
      serials, types, written,
      units, sourceFile,
      uploadedBy: "automation"
    });

    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "shop_snapshot_uploaded", targetUserId: null,
      detail: { count: saved.count, sourceFile: sourceFile.slice(0, 120), via: "automation" }
    }).catch(() => {});

    return res.json({ ok: true, count: saved.count, unitCount, typedCount: saved.typedCount, writtenCount: saved.writtenCount });
  } catch (err) {
    console.error("Automated snapshot upload failed:", err.message);
    return res.status(400).json({ error: err.message || "Unable to parse that file." });
  }
});

// ---------------------------------------------------------------------------
// MAP/UMRP price feed — fetches the published price spreadsheet
// (SHOP_MAP_PRICE_URL, the ~35MB RES file) and fully replaces the stored
// floor-price table. Runs overnight (2–6am Central once the data is ~a day
// old) plus on boot when the table is empty; the internal page has a manual
// Refresh button. The parser hunts for a model column and the best
// UMRP/MAP-ish price column and records what it matched in sourceNote so
// the column mapping can be verified from the internal page.
// ---------------------------------------------------------------------------

async function parseMapPriceWorkbook(buffer) {
  // The live RetailDeck feed (whse_inventory_and_prices.xlsx, ~35MB, 108k
  // rows) is parsed with a purpose-built STREAMING scanner -- loading it
  // through the xlsx library peaks ~1.6GB of RSS and OOMs small cloud
  // instances, killing the refresh silently. The scanner keeps only the
  // pn/manufacturer_pn keys and the floor columns (rws_minimum first --
  // RetailDeck's resolved minimum across UMRP/MAP/LAP/PLAP/MAP-10/PMAP-10 --
  // then the UMRP/MAP cascade); peak memory is ~150MB, ~13s.
  try {
    return await extractRetailDeckFloors(buffer);
  } catch (err) {
    if (err?.code !== "NOT_RETAILDECK") throw err;
    // Not the RetailDeck layout -- fall through to the generic hunt below
    // (meant for small hand-made price lists, parsed in memory).
  }

  const workbook = readWorkbook(buffer, { type: "buffer", dense: true });
  const normHeader = (v) => String(v == null ? "" : v).replace(/[\s ]+/g, " ").trim().toLowerCase();

  // ---- generic fallback: hunt for a model column + a MAP/UMRP-ish price ----
  const MODEL_HEADERS = ["model", "* model", "model #", "model number", "sku", "item", "item #", "item number"];
  const PRICE_HEADERS = [
    /\bumrp\b/, /\bmap\b/, /minimum advertised/, /min.*advertised/, /\bmsrp\b/, /suggested retail/, /\bretail\b/
  ];

  let best = null;
  for (const name of workbook.SheetNames) {
    const grid = xlsxUtils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null });
    const scanMax = Math.min(grid.length, 30);
    for (let h = 0; h < scanMax; h++) {
      const texts = (grid[h] || []).map(normHeader);
      const modelCol = texts.findIndex((t) => MODEL_HEADERS.includes(t));
      if (modelCol < 0) continue;
      let priceCol = -1;
      let priceRank = PRICE_HEADERS.length;
      texts.forEach((t, idx) => {
        const rank = PRICE_HEADERS.findIndex((re) => re.test(t));
        if (rank >= 0 && rank < priceRank) { priceRank = rank; priceCol = idx; }
      });
      if (priceCol < 0) continue;

      const prices = {};
      for (let r = h + 1; r < grid.length; r++) {
        const model = String(grid[r]?.[modelCol] ?? "").trim();
        if (!model) continue;
        const raw = grid[r]?.[priceCol];
        const price = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[$,\s]/g, ""));
        if (Number.isFinite(price) && price > 0) prices[model] = price;
      }
      if (Object.keys(prices).length && (!best || Object.keys(prices).length > best.count)) {
        best = {
          prices,
          count: Object.keys(prices).length,
          note: `sheet "${name}" · model col "${texts[modelCol]}" · price col "${texts[priceCol]}"`
        };
      }
      break; // one header row per sheet
    }
  }
  if (!best) throw new Error("Couldn't find a model + MAP/UMRP price column in that spreadsheet.");
  return best;
}

let shopMapRefreshInFlight = null;
let shopMapLastAttempt = null;   // { at, ok, error } for the internal status line

async function refreshShopMapPricesNow() {
  if (!SHOP_MAP_PRICE_URL) throw new Error("SHOP_MAP_PRICE_URL is not configured.");
  if (shopMapRefreshInFlight) return shopMapRefreshInFlight;
  shopMapRefreshInFlight = (async () => {
    const response = await fetch(SHOP_MAP_PRICE_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`Price feed returned ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await parseMapPriceWorkbook(buffer);
    await saveShopMapPrices({ prices: parsed.prices, sourceUrl: SHOP_MAP_PRICE_URL, sourceNote: parsed.note });
    console.log(`MAP price feed refreshed: ${parsed.count} models (${parsed.note}).`);
    return { count: parsed.count, note: parsed.note };
  })().then(
    (result) => { shopMapLastAttempt = { at: new Date().toISOString(), ok: true, error: "" }; return result; },
    (err) => {
      const cause = err?.cause ? ' — ' + (err.cause.code || err.cause.message || '') : '';
      shopMapLastAttempt = { at: new Date().toISOString(), ok: false, error: (String(err?.message || err) + cause).slice(0, 300) };
      throw err;
    }
  ).finally(() => { shopMapRefreshInFlight = null; });
  return shopMapRefreshInFlight;
}

async function maybeRefreshShopMapPrices() {
  if (!SHOP_MAP_PRICE_URL) return;
  try {
    const existing = await getShopMapPrices().catch(() => null);
    const ageHours = existing?.fetchedAt ? (Date.now() - Date.parse(existing.fetchedAt)) / 3600000 : Infinity;
    const centralHour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false }));
    const overnight = centralHour >= 2 && centralHour < 6;
    if (!existing?.count || (ageHours > 20 && overnight) || ageHours > 48) {
      await refreshShopMapPricesNow();
    }
  } catch (err) {
    console.error("MAP price feed refresh failed:", err.message);
  }
}
setInterval(maybeRefreshShopMapPrices, 60 * 60 * 1000).unref?.();
setTimeout(maybeRefreshShopMapPrices, 30 * 1000).unref?.();

// INTERNAL: MAP feed status + manual refresh for the Online Shop Orders page.
app.post("/api/shop/map-prices/refresh", requirePagePermission("/shop-orders.html"), async (req, res) => {
  try {
    const result = await refreshShopMapPricesNow();
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_map_prices_refreshed", targetUserId: null,
      detail: result
    }).catch(() => {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Manual MAP refresh failed:", err.message);
    return res.status(500).json({ error: err.message || "Unable to refresh MAP prices." });
  }
});

// INTERNAL: shopper profile admin for the dashboard module — when a client
// calls in stuck, staff can find them, fix their contact details, and hand
// them a temporary password.
app.get("/api/shop-shoppers", requirePagePermission("/shopper-profiles.html"), async (req, res) => {
  try {
    const shoppers = await searchShopShoppers(req.query.search);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      shoppers: shoppers.map((s) => ({
        id: s.id,
        clientCode: s.clientCode,
        hasPassword: s.hasPassword,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        phone: s.phone,
        preferredContact: s.preferredContact,
        address: s.address,
        stripeLinked: Boolean(s.stripeCustomerId),
        createdAt: s.createdAt
      }))
    });
  } catch (err) {
    console.error("Shopper search failed:", err.message);
    return res.status(500).json({ error: "Unable to search shopper profiles." });
  }
});

app.post("/api/shop-shoppers/:id/profile", requirePagePermission("/shopper-profiles.html"), async (req, res) => {
  try {
    const checked = validateShopperFields(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error });

    const updated = await updateShopperProfileById({ id: req.params.id, ...checked.fields });
    if (!updated) return res.status(404).json({ error: "Shopper profile not found." });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_shopper_admin_updated", targetUserId: null,
      detail: { clientCode: updated.clientCode }
    }).catch(() => {});

    return res.json({ ok: true, shopper: { id: updated.id, clientCode: updated.clientCode } });
  } catch (err) {
    console.error("Shopper admin update failed:", err.message);
    return res.status(500).json({ error: "Unable to update the profile." });
  }
});

// INTERNAL: delete a shopper profile (test records, spam). Orders keep
// their embedded customer snapshot; only the login/profile goes away.
app.delete("/api/shop-shoppers/:id", requirePagePermission("/shopper-profiles.html"), async (req, res) => {
  try {
    const shopper = await getShopperById(req.params.id);
    if (!shopper) return res.status(404).json({ error: "Shopper profile not found." });
    const removed = await deleteShopper(req.params.id);
    if (!removed) return res.status(404).json({ error: "Shopper profile not found." });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_shopper_deleted", targetUserId: null,
      detail: { clientCode: shopper.clientCode, name: `${shopper.firstName} ${shopper.lastName}` }
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error("Shopper delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the profile." });
  }
});

// INTERNAL: pull existing Stripe customers into the Agility shopper list.
// Walks the full Stripe customer list; each record is linked to an existing
// shopper (phone/email match), imported as a new profile (client code and
// all), or skipped when Stripe has no usable contact info. Safe to re-run —
// already-linked customers are counted and left alone.
app.post("/api/shop-shoppers/import-stripe", requirePagePermission("/shopper-profiles.html"), async (req, res) => {
  try {
    const summary = { created: 0, linked: 0, already: 0, skipped: 0, scanned: 0 };
    const MAX_SCAN = 5000;

    let startingAfter = null;
    while (summary.scanned < MAX_SCAN) {
      const page = await stripe.customers.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });
      for (const customer of page.data) {
        summary.scanned++;
        try {
          const result = await importStripeCustomerRecord(customer);
          summary[result.outcome] = (summary[result.outcome] || 0) + 1;
        } catch (err) {
          console.error("Stripe import failed for", customer.id, err.message);
          summary.skipped++;
        }
      }
      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_stripe_import", targetUserId: null,
      detail: summary
    }).catch(() => {});

    return res.json({ ok: true, ...summary, capped: summary.scanned >= MAX_SCAN });
  } catch (err) {
    console.error("Stripe customer import failed:", err.message);
    return res.status(500).json({ error: err.message || "Unable to import Stripe customers." });
  }
});

// Generates a temporary password and returns it ONCE for the rep to read
// to the client (they can change it themselves in their shop profile).
app.post("/api/shop-shoppers/:id/temp-password", requirePagePermission("/shopper-profiles.html"), async (req, res) => {
  try {
    const result = await setShopperTempPassword({ id: req.params.id });
    if (!result) return res.status(404).json({ error: "Shopper profile not found." });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "shop_shopper_temp_password", targetUserId: null,
      detail: { clientCode: result.shopper.clientCode }
    }).catch(() => {});

    return res.json({ ok: true, tempPassword: result.tempPassword, clientCode: result.shopper.clientCode });
  } catch (err) {
    console.error("Shopper temp password failed:", err.message);
    return res.status(500).json({ error: "Unable to reset the password." });
  }
});

// INTERNAL (exec): Field Sales Commissions (commissions.html) — live monthly
// statements computed from the Sales Order Detail warehouse (Crystal upload
// feeds sales_order_lines). No import runs, no locks: re-uploading a month's
// reports on Sales Order Detail refreshes the statements. Plan math lives in
// lib/field-sales-commissions.js; eligibility is trailing-6-month serial
// revenue ending at the statement month.
// Shared by the statements API and the PDF download/email routes.
async function computeFieldCommissionMonth(requestedMonth) {
  const months = await listCommissionMonths();
  if (!months.length) {
    return { months: [], month: null, windowMonths: [], statements: [], balanceChecks: {} };
  }
  const month = /^\d{4}-\d{2}$/.test(String(requestedMonth || "")) && months.includes(requestedMonth)
    ? String(requestedMonth)
    : months[0];

  // Rolling window: the statement month plus the 5 calendar months before
  // it (only months actually uploaded contribute).
  const windowMonths = [];
  let [y, m] = month.split("-").map(Number);
  for (let i = 0; i < FIELD_SALES_PLAN.eligibility.rollingMonths; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (months.includes(key)) windowMonths.push(key);
    m--; if (m < 1) { m = 12; y--; }
  }

  const [windowLines, properNames, directory, overrides, balanceChecks] = await Promise.all([
    listCommissionLinesForMonths(windowMonths),
    listSalespersonNames(),
    listEmployeeDirectory().catch(() => []),
    listCommissionOverrides(windowMonths),
    listCommissionBalanceChecks(windowMonths)
  ]);

  // The whole window feeds the engine: current-month rows make the
  // statement; prior-month rows drive the unpaid hold / release cycle.
  const statements = computeFieldSalesStatements({
    monthLines: windowLines,
    month,
    balanceChecks,
    trailingByCode: serialRevenueByCode(windowLines, overrides),
    directory,
    properNames,
    overrides
  });

  return { months, month, windowMonths, statements, balanceChecks };
}

function commissionMonthLabel(month) {
  const [y, m] = String(month || "").split("-").map(Number);
  if (!y || !m) return String(month || "");
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][m - 1]} ${y}`;
}

app.get("/api/field-commissions", requireExecutiveApi, async (req, res) => {
  try {
    const { months, month, windowMonths, statements, balanceChecks } = await computeFieldCommissionMonth(req.query.month);
    const balanceMeta = {};
    for (const [m, check] of Object.entries(balanceChecks)) {
      balanceMeta[m] = {
        filename: check.filename, uploadedAt: check.uploadedAt,
        invoiceCount: check.invoiceCount, unpaidCount: check.unpaidCount
      };
    }
    return res.json({
      months, month, windowMonths, statements, balanceChecks: balanceMeta,
      plan: FIELD_SALES_PLAN,
      plans: [FIELD_SALES_PLAN, SHOWROOM_PLAN],
      pagePlans: COMMISSION_PAGE_PLANS
    });
  } catch (err) {
    console.error("Field commissions failed:", err.message);
    return res.status(500).json({ error: "Unable to compute commission statements." });
  }
});

// Statement PDF builder (commissions.html → Download). Same pdf-lib recipe
// as the payment receipt, one statement per file.
async function buildStatementPdfFor(month, code) {
  const { month: resolvedMonth, statements } = await computeFieldCommissionMonth(month);
  if (!resolvedMonth || resolvedMonth !== month) {
    const err = new Error("No commission data for that month.");
    err.statusCode = 400;
    throw err;
  }
  const statement = statements.find((s) => s.code === String(code || "").toUpperCase());
  if (!statement) {
    const err = new Error("No statement for that salesperson in that month.");
    err.statusCode = 404;
    throw err;
  }
  const pdfBytes = await buildCommissionStatementPdf({
    statement,
    monthLabel: commissionMonthLabel(month),
    logoBytes: getReceiptLogoBytes()
  });
  const fileLabel = `commission-statement-${statement.code}-${month}`.replace(/[^A-Za-z0-9_-]+/g, "-");
  return { pdfBytes, fileLabel, statement };
}

app.get("/api/field-commissions/statement-pdf", requireExecutiveApi, async (req, res) => {
  try {
    const month = String(req.query.month || "");
    const code = String(req.query.code || "");
    const { pdfBytes, fileLabel, statement } = await buildStatementPdfFor(month, code);

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "commission_statement_downloaded", targetUserId: null,
      detail: { month, code: statement.code, total: statement.totals.commission }
    }).catch(() => {});

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileLabel}.pdf"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Statement PDF error:", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Unable to build the statement." });
  }
});

// Email the statement PDF straight to the salesperson (user directory email,
// or an explicit override address).
app.post("/api/field-commissions/statement-email", requireExecutiveApi, async (req, res) => {
  try {
    const month = String(req.body?.month || "");
    const code = String(req.body?.code || "").toUpperCase();
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." });
    }

    const { pdfBytes, fileLabel, statement } = await buildStatementPdfFor(month, code);
    const email = String(req.body?.email || statement.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "No email on file for this salesperson — add one in the User Admin directory." });
    }

    const label = commissionMonthLabel(month);
    const firstName = statement.name.split(/\s+/)[0] || statement.name;
    const totalText = `$${statement.totals.commission.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const subject = `Your ${label} commission statement — ${totalText}`;
    const stillHeldNote = statement.totals.stillHeldCount
      ? `${statement.totals.stillHeldCount} line(s) are held on unpaid invoices and will pay automatically once the invoice clears.`
      : "";
    const bodyLines = [
      `Hi ${firstName},`,
      "",
      `Your Field Sales commission statement for ${label} is attached — total commission ${totalText}.`,
      stillHeldNote,
      "",
      "Questions about a line? Reply to this email.",
      "",
      "Wilson AC & Appliance"
    ].filter((lineText) => lineText !== "");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 560px;">
        <p>Hi ${escapeHtmlForEmail(firstName)},</p>
        <p>Your Field Sales commission statement for <strong>${escapeHtmlForEmail(label)}</strong> is attached — total commission <strong>${escapeHtmlForEmail(totalText)}</strong>.</p>
        ${stillHeldNote ? `<p>${escapeHtmlForEmail(stillHeldNote)}</p>` : ""}
        <p>Questions about a line? Reply to this email.</p>
        <p style="color: #6b7280; font-size: 13px;">Wilson AC & Appliance</p>
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
        reply_to: userReplyTo(req),
        to: [email],
        subject,
        text: bodyLines.join("\n"),
        html,
        attachments: [{
          filename: `${fileLabel}.pdf`,
          content: Buffer.from(pdfBytes).toString("base64")
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Statement email failed:", response.status, errorText);
      return res.status(502).json({ error: "The email service rejected the statement — try again in a minute." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "commission_statement_emailed", targetUserId: null,
      detail: { month, code: statement.code, to: email, total: statement.totals.commission }
    }).catch(() => {});

    return res.json({ success: true, to: email });
  } catch (err) {
    console.error("Statement email error:", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Unable to email the statement." });
  }
});

// ---------------------------------------------------------------------------
// Commission review: post final statements to the sales team's review page
// (my-commissions.html), collect exception requests within the 45-day window.
// Statements on commissions.html recompute live, so posting freezes a
// snapshot the rep can rely on. Per-rep posting; re-posting replaces.
// ---------------------------------------------------------------------------

// Exec: post (or re-post) one rep's statement for a month.
app.post("/api/field-commissions/post", requireExecutiveApi, async (req, res) => {
  try {
    const month = String(req.body?.month || "");
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!/^\d{4}-\d{2}$/.test(month) || !code) {
      return res.status(400).json({ error: "Missing statement month or salesperson code." });
    }
    const { month: resolvedMonth, statements } = await computeFieldCommissionMonth(month);
    if (resolvedMonth !== month) {
      return res.status(400).json({ error: "No commission data for that month." });
    }
    const statement = statements.find((s) => s.code === code);
    if (!statement) {
      return res.status(404).json({ error: "No statement for that salesperson this month." });
    }
    if (!statement.email) {
      return res.status(400).json({ error: "No directory email for this salesperson — add one in User Admin so the statement can route to their login." });
    }
    await upsertCommissionPost({
      month, code,
      repEmail: statement.email,
      repName: statement.name,
      statement,
      byEmail: req.authUser?.email || "",
      byName: req.authUser?.displayName || ""
    });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "commission_statement_posted", targetUserId: null,
      detail: { month, code, repEmail: statement.email, total: statement.totals.commission }
    }).catch(() => {});
    const posts = await listCommissionPostsForMonth(month);
    return res.json({ ok: true, posts });
  } catch (err) {
    console.error("Commission post failed:", err.message);
    return res.status(500).json({ error: "Unable to post the statement." });
  }
});

// Exec: retract a posted statement.
app.post("/api/field-commissions/unpost", requireExecutiveApi, async (req, res) => {
  try {
    const month = String(req.body?.month || "");
    const code = String(req.body?.code || "").trim().toUpperCase();
    const removed = await deleteCommissionPost(month, code);
    if (removed) {
      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "commission_statement_retracted", targetUserId: null,
        detail: { month, code }
      }).catch(() => {});
    }
    const posts = await listCommissionPostsForMonth(month);
    return res.json({ ok: true, removed, posts });
  } catch (err) {
    console.error("Commission unpost failed:", err.message);
    return res.status(500).json({ error: "Unable to retract the statement." });
  }
});

// Exec: posting + exception status for a month (drives the commissions.html
// Post buttons and the exceptions panel).
app.get("/api/field-commissions/review-status", requireExecutiveApi, async (req, res) => {
  try {
    const month = String(req.query.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Missing statement month." });
    const [posts, exceptions, openTotal] = await Promise.all([
      listCommissionPostsForMonth(month),
      listCommissionExceptionsForMonth(month),
      countOpenCommissionExceptions()
    ]);
    return res.json({
      month, posts, exceptions,
      openExceptionsTotal: openTotal,
      windowOpen: exceptionWindowOpen(month),
      windowCloses: exceptionDeadlineDate(month)
    });
  } catch (err) {
    console.error("Commission review status failed:", err.message);
    return res.status(500).json({ error: "Unable to load review status." });
  }
});

// Exec: resolve an exception request with a response the rep can read.
app.post("/api/field-commissions/exceptions/:id/resolve", requireExecutiveApi, async (req, res) => {
  try {
    const resolved = await resolveCommissionException(req.params.id, {
      byEmail: req.authUser?.email || "",
      byName: req.authUser?.displayName || "",
      response: String(req.body?.response || "")
    });
    if (!resolved) {
      const existing = await getCommissionException(req.params.id);
      return res.status(existing ? 409 : 404).json({ error: existing ? "Already resolved." : "Exception request not found." });
    }
    retirePushedNotificationsByRef(`cex:${resolved.id}`).catch(() => {});
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "commission_exception_resolved", targetUserId: null,
      detail: { id: resolved.id, month: resolved.month, code: resolved.code, response: resolved.response.slice(0, 300) }
    }).catch(() => {});
    return res.json({ ok: true, exception: resolved });
  } catch (err) {
    console.error("Commission exception resolve failed:", err.message);
    return res.status(500).json({ error: "Unable to resolve the request." });
  }
});

// Rep: their own posted statements (routed by directory email = login email).
app.get("/api/my-commissions", requirePagePermission("/my-commissions.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || "").toLowerCase();
    if (!email) return res.status(400).json({ error: "Your login has no email — statements route by directory email." });
    const posted = await listPostedMonthsForEmail(email);
    const months = posted.map((p) => p.month);
    if (!months.length) return res.json({ months: [], month: null, post: null, exceptions: [] });
    const month = months.includes(String(req.query.month || "")) ? String(req.query.month) : months[0];
    const [post, exceptions] = await Promise.all([
      getCommissionPostForEmail(email, month),
      listCommissionExceptionsForRep(email, month)
    ]);
    return res.json({
      months, month, post, exceptions,
      windowOpen: exceptionWindowOpen(month),
      windowCloses: exceptionDeadlineDate(month)
    });
  } catch (err) {
    console.error("My commissions failed:", err.message);
    return res.status(500).json({ error: "Unable to load your commission review." });
  }
});

// Rep: file an exception request against posted lines. Enforced server-side:
// the post must exist for THIS login, the 45-day window must be open, and
// every requested line must exist in the posted snapshot.
app.post("/api/my-commissions/exception", requirePagePermission("/my-commissions.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || "").toLowerCase();
    const month = String(req.body?.month || "");
    const note = String(req.body?.note || "").trim();
    const requested = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!email || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Missing statement month." });
    if (!requested.length) return res.status(400).json({ error: "Check at least one model line." });
    if (note.length < 5) return res.status(400).json({ error: "Tell us what's wrong and why (a sentence or two)." });

    const post = await getCommissionPostForEmail(email, month);
    if (!post) return res.status(404).json({ error: "No posted statement for that month." });
    if (!exceptionWindowOpen(month)) {
      return res.status(400).json({ error: `The exception window for this month closed on ${exceptionDeadlineDate(month)}.` });
    }

    // Validate every requested line against the snapshot and rebuild the
    // stored entries from the snapshot itself (never trust client copies).
    const st = post.statement || {};
    const sections = [
      ["new", st.newLines], ["closeout", st.closeoutLines], ["protect", st.protectLines],
      ["released", st.releasedLines], ["held", st.stillHeldLines], ["excluded", st.excludedLines]
    ];
    const byKey = new Map();
    for (const [section, lines] of sections) {
      for (const line of lines || []) {
        if (line?.lineKey) byKey.set(`${section}|${line.lineKey}`, { section, line });
      }
    }
    const lines = [];
    for (const r of requested.slice(0, 60)) {
      const hit = byKey.get(`${String(r.section || "")}|${String(r.lineKey || "")}`);
      if (!hit) return res.status(400).json({ error: "One of the checked lines is not on your posted statement — reload and try again." });
      lines.push({
        lineKey: hit.line.lineKey,
        section: hit.section,
        invoice: hit.line.invoice || "",
        product: hit.line.product || "",
        customer: hit.line.customer || ""
      });
    }

    const id = await createCommissionException({
      month, code: post.code, repEmail: email, repName: post.repName, lines, note
    });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "commission_exception_requested", targetUserId: null,
      detail: { id, month, code: post.code, lineCount: lines.length, models: lines.map((l) => l.product).slice(0, 10), note: note.slice(0, 300) }
    }).catch(() => {});

    // Yellow flag to the commission-exception job codes (E60 + E80 by
    // default, env-overridable). One copy per holder, all under the same
    // ref so resolving retires every copy. Falls back to whoever posted
    // the statement if no directory entry holds either code.
    try {
      const codes = String(process.env.COMMISSION_EXCEPTION_JOB_CODES || "E60,E80")
        .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
      const holders = [];
      for (const jobCode of codes) holders.push(...await jobCodeHolders(jobCode));
      const audienceEmails = [...new Set(holders.map((h) => String(h.email).toLowerCase()))];
      if (!audienceEmails.length && post.postedByEmail) audienceEmails.push(post.postedByEmail);
      const models = lines.map((l) => l.product).filter(Boolean);
      for (const audienceEmail of audienceEmails) {
        createPushedNotification({
          severity: "yellow",
          typeLabel: "Commission Exception",
          refId: `cex:${id}`,
          title: `${post.repName || post.code} requests a commission exception — ${commissionMonthLabel(month)}`,
          body: `${models.length} line(s): ${models.slice(0, 4).join(", ")}${models.length > 4 ? "…" : ""}. “${note.slice(0, 200)}”. Review on the Sales Commissions page.`,
          audienceEmail,
          byEmail: email,
          byName: post.repName || post.code
        }).catch(() => {});
      }
    } catch (flagErr) {
      console.error("Commission exception flag routing failed:", flagErr.message);
    }

    const exceptions = await listCommissionExceptionsForRep(email, month);
    return res.json({ ok: true, id, exceptions });
  } catch (err) {
    console.error("Commission exception failed:", err.message);
    return res.status(500).json({ error: "Unable to file the exception request." });
  }
});

// Upload a paid-balance check for a statement month: the finished Invoice
// Maintenance export, parsed in the browser to { invoice, balance } rows.
// Unpaid invoices (balance > 0) hold their commission lines that month;
// later months' checks release them once paid.
app.post("/api/field-commissions/balance-check", requireExecutiveApi, async (req, res) => {
  try {
    const month = String(req.body?.month || "");
    const rows = req.body?.rows;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Missing statement month." });
    }
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "No invoice rows found in the upload." });
    }
    if (rows.length > 30000) {
      return res.status(400).json({ error: "That upload has too many rows." });
    }

    const result = await saveCommissionBalanceCheck({
      month,
      rows,
      filename: String(req.body?.filename || "").slice(0, 200),
      byEmail: req.authUser?.email || req.authUser?.username || ""
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "commission_balance_check_uploaded", targetUserId: null,
      detail: { month, invoices: result.invoiceCount, unpaid: result.unpaidCount }
    }).catch(() => {});

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Balance check upload failed:", err.message);
    return res.status(500).json({ error: "Unable to store the balance check." });
  }
});

// Save (or clear) an exec override on one commission line: list price, cost,
// payout rate, and/or 100%-credit reassignment of a split. Overrides key on
// a stable line fingerprint, so they survive re-uploads of the same report.
app.post("/api/field-commissions/override", requireExecutiveApi, async (req, res) => {
  try {
    const b = req.body || {};
    const lineKey = String(b.lineKey || "");
    const sourceMonth = String(b.sourceMonth || "");
    if (!lineKey || !/^\d{4}-\d{2}$/.test(sourceMonth)) {
      return res.status(400).json({ error: "Missing line key or month." });
    }

    const num = (v, name, { min = -10000000, max = 10000000 } = {}) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Enter a valid ${name}.`);
      return Math.round(n * 100) / 100;
    };
    const listPrice = num(b.listPrice, "list price");
    const serialCost = num(b.serialCost, "cost");
    let rate = null;
    if (b.ratePercent != null && b.ratePercent !== "") {
      const p = Number(b.ratePercent);
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return res.status(400).json({ error: "Payout percent must be between 0 and 100." });
      }
      rate = Math.round(p * 1000) / 100000; // percent -> fraction, 3dp of percent
    }
    const fullCreditTo = String(b.fullCreditTo || "").trim().toUpperCase();
    if (fullCreditTo && !/^[A-Z0-9]{1,10}$/.test(fullCreditTo)) {
      return res.status(400).json({ error: "Invalid salesperson code for full credit." });
    }

    const omit = !!b.omit;
    if (omit && !String(b.note || "").trim()) {
      return res.status(400).json({ error: "Add a note explaining why the line is omitted (it shows on the statement)." });
    }

    const saved = await saveCommissionOverride({
      lineKey, sourceMonth, listPrice, serialCost, rate, fullCreditTo, omit,
      note: b.note, byEmail: req.authUser?.email || req.authUser?.username || ""
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: saved ? "commission_override_saved" : "commission_override_cleared",
      targetUserId: null,
      detail: { lineKey: lineKey.slice(0, 120), sourceMonth, listPrice, serialCost, rate, fullCreditTo, omit, note: String(b.note || "").slice(0, 200) }
    }).catch(() => {});

    return res.json({ ok: true, cleared: !saved });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Unable to save the override." });
  }
});

// -------------------------
// EXISTING PAYMENT LINK ROUTE
// -------------------------
// ---------------------------------------------------------------------------
// Card-on-file reuse for repeat service clients. SetupIntent-saved cards are
// durable: the PaymentMethod stays attached to its Stripe Customer until
// detached, and Stripe's network updater refreshes reissued cards. So when a
// card-capture link is requested for a phone we've captured before, we verify
// the old card is still alive and let the CLIENT confirm reusing it (brand +
// last4 shown on a tokenized page) instead of re-entering it.
// ---------------------------------------------------------------------------

async function findSavedCardForPhone(phone) {
  const target = String(phone || "").replace(/\D/g, "").slice(-10);
  if (target.length !== 10) return null;
  const links = await readLinks();
  const candidates = links.filter((row) =>
    row.workflowType === "card_capture" &&
    row.status === "card_saved" &&
    row.customerId && row.paymentMethodId &&
    String(row.customerPhone || "").replace(/\D/g, "").slice(-10) === target
  );
  for (const row of candidates) { // links store is newest-first
    try {
      const pm = await stripe.paymentMethods.retrieve(row.paymentMethodId);
      if (!pm?.customer) continue; // detached — no longer chargeable
      const card = pm.card || {};
      const now = new Date();
      const expOk = Number(card.exp_year) > now.getFullYear() ||
        (Number(card.exp_year) === now.getFullYear() && Number(card.exp_month) >= now.getMonth() + 1);
      if (!expOk) continue;
      return {
        customerId: typeof pm.customer === "string" ? pm.customer : pm.customer.id,
        paymentMethodId: pm.id,
        brand: card.brand || "card",
        last4: card.last4 || "",
        expMonth: Number(card.exp_month) || null,
        expYear: Number(card.exp_year) || null,
        fingerprint: card.fingerprint || "",
        fromSalesOrder: row.salesOrder || "",
        fromDate: row.createdAt || ""
      };
    } catch (err) {
      if (err?.statusCode !== 404) console.error("Saved-card check failed:", err.message);
    }
  }
  return null;
}

async function createCardCaptureStripeSession({ salesOrder, customerName, customerPhone, customerPhoneDigits, customerEmail, creatorCode, creatorName, creatorEmail, department, notes, description, clientRequestId }) {
  const captureMetadata = {
    workflow_type: "card_capture",
    sales_order: salesOrder || "",
    customer_name: customerName || "",
    customer_phone: customerPhoneDigits || customerPhone || "",
    customer_email: customerEmail || "",
    creator_code: creatorCode || "",
    creator_name: creatorName || "",
    creator_email: creatorEmail || "",
    department: department || "",
    notes: notes || "",
    link_description: description || ""
  };
  const customerConfig = {
    name: customerName || undefined,
    phone: customerPhone || undefined,
    email: customerEmail || undefined,
    metadata: { sales_order: salesOrder || "", source: "agility_card_capture" }
  };
  const captureCustomer = await stripe.customers.create(customerConfig, {
    idempotencyKey: createStripeIdempotencyKeyFromPayload("card-capture-customer", { ...customerConfig, salesOrder, t: clientRequestId || "" })
  });
  const sessionConfig = {
    mode: "setup",
    customer: captureCustomer.id,
    payment_method_types: ["card"],
    success_url: `https://${SERVICE_PUBLIC_HOST}/card-saved.html`,
    metadata: captureMetadata,
    setup_intent_data: { metadata: captureMetadata }
  };
  const captureSession = await stripe.checkout.sessions.create(sessionConfig, {
    idempotencyKey: createStripeIdempotencyKeyFromPayload("card-capture-session", sessionConfig)
  });
  return { captureCustomer, captureSession };
}

async function findCardConfirmRecord(token) {
  const cc = await getCardConfirm(token).catch(() => null);
  if (!cc) return { links: null, record: null, cc: null };
  const links = await readLinks();
  const record = links.find((row) => row.workflowType === "card_capture" && row.id === cc.linkId);
  return { links, record, cc };
}

// PUBLIC (service host): the client's view of a card-on-file confirmation.
app.post("/api/card-confirm/view", async (req, res) => {
  try {
    const { links, record, cc } = await findCardConfirmRecord(req.body?.token);
    if (!record) return res.status(404).json({ error: "This link isn't valid — call us at 512-894-0907." });
    if (record.status === "sent") {
      record.status = "viewed";
      record.updatedAt = new Date().toISOString();
      await writeLinks(links);
    }
    const prior = cc.prior || {};
    return res.json({
      firstName: String(record.customerName || "").trim().split(/\s+/)[0] || "there",
      salesOrder: record.salesOrder || "",
      brand: prior.brand || "card",
      last4: prior.last4 || "",
      expMonth: prior.expMonth, expYear: prior.expYear,
      fromDate: prior.fromDate || "",
      done: record.status === "card_saved",
      switchedToForm: Boolean(record.checkoutSessionId)
    });
  } catch (err) {
    console.error("Card-confirm view failed:", err.message);
    return res.status(500).json({ error: "Unable to load this page right now." });
  }
});

// PUBLIC: client approves reusing the card on file.
app.post("/api/card-confirm/use", async (req, res) => {
  try {
    const { links, record, cc } = await findCardConfirmRecord(req.body?.token);
    if (!record) return res.status(404).json({ error: "This link isn't valid." });
    if (record.status === "card_saved") return res.json({ ok: true, already: true });
    const prior = cc.prior || {};
    // Re-verify at decision time — the card could have died since the link went out.
    const pm = await stripe.paymentMethods.retrieve(prior.paymentMethodId).catch(() => null);
    if (!pm?.customer) {
      return res.status(409).json({ error: "That saved card is no longer available — tap \"Use a different card\" instead." });
    }
    record.status = "card_saved";
    record.active = false;
    record.customerId = prior.customerId;
    record.paymentMethodId = prior.paymentMethodId;
    record.paymentMethodType = "card";
    record.paymentStatusDetail = `Card on file confirmed — ${prior.brand} ending ${prior.last4}${prior.fromSalesOrder ? ` (from ${prior.fromSalesOrder})` : ""}`;
    await markCardConfirmDecided(cc.token).catch(() => {});
    record.updatedAt = new Date().toISOString();
    if (!record.paymentNotificationSentAt && record.creatorEmail) {
      try {
        await sendCardCapturedEmail(record, { brand: prior.brand, last4: prior.last4 });
        record.paymentNotificationSentAt = new Date().toISOString();
      } catch (mailErr) {
        record.paymentNotificationError = mailErr.message || "Unable to send card-confirmed notification.";
      }
    }
    await writeLinks(links);
    recordAudit({
      ip: req.ip, actorUserId: null,
      action: "card_on_file_confirmed", targetUserId: null,
      detail: { salesOrder: record.salesOrder, from: prior.fromSalesOrder, last4: prior.last4 }
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("Card-confirm use failed:", err.message);
    return res.status(500).json({ error: "Unable to confirm the card — please call us." });
  }
});

// PUBLIC: client wants to enter a different card — create the real Stripe
// Checkout session now and hand back its URL.
app.post("/api/card-confirm/other", async (req, res) => {
  try {
    const { links, record, cc } = await findCardConfirmRecord(req.body?.token);
    if (!record) return res.status(404).json({ error: "This link isn't valid." });
    if (record.status === "card_saved") return res.status(409).json({ error: "A card is already on file for this order." });
    if (record.checkoutSessionId && record.paymentLinkUrl.includes("stripe")) {
      return res.json({ ok: true, url: record.paymentLinkUrl });
    }
    const { captureCustomer, captureSession } = await createCardCaptureStripeSession({
      salesOrder: record.salesOrder, customerName: record.customerName,
      customerPhone: record.customerPhone, customerPhoneDigits: record.customerPhone,
      customerEmail: record.customerEmail, creatorCode: record.creatorCode,
      creatorName: record.creatorName, creatorEmail: record.creatorEmail,
      department: record.department, notes: record.notes, description: record.description,
      clientRequestId: cc.token
    });
    record.customerId = captureCustomer.id;
    record.checkoutSessionId = captureSession.id;
    record.paymentLinkUrl = captureSession.url;
    await markCardConfirmDecided(cc.token).catch(() => {});
    record.updatedAt = new Date().toISOString();
    await writeLinks(links);
    return res.json({ ok: true, url: captureSession.url });
  } catch (err) {
    console.error("Card-confirm other failed:", err.message);
    return res.status(500).json({ error: "Unable to open the card form — please call us." });
  }
});

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

    const normalizedLinkType =
      linkType === "hvac_deposit" ? "hvac_deposit" :
      linkType === "card_capture" ? "card_capture" :
      "appliance";

    if (!salesOrder || !customerPhone || (normalizedLinkType !== "card_capture" && !amount)) {
      return res.status(400).json({
        error: normalizedLinkType === "card_capture"
          ? "salesOrder and customerPhone are required"
          : "amount, salesOrder, and customerPhone are required"
      });
    }
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

// ---- SetupIntent capture: save a card, charge NOTHING ----
// Stripe Payment Links can't run in setup mode, so this uses a Checkout
// Session (mode:"setup") pinned to a pre-created customer — the card
// attaches automatically on completion and the webhook marks the record
// card_saved. Checkout sessions expire after 24h if unused (Stripe limit).
// Repeat clients: if a still-valid card is already on file from a prior
// capture (matched by phone, verified against Stripe), the link becomes a
// CONFIRM page — the client sees brand + last4 and approves reuse, or opts
// into the normal Stripe form for a different card.
if (normalizedLinkType === "card_capture") {
  let priorCard = null;
  try {
    priorCard = await findSavedCardForPhone(customerPhoneDigits || customerPhone);
  } catch (lookupErr) {
    console.error("Saved-card lookup failed (falling back to fresh capture):", lookupErr.message);
  }

  const makeCaptureRecord = (overrides) => ({
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
    workflowType: "card_capture",
    requestedAmount: 0,
    requestedTotalAmount: 0,
    depositAmount: 0,
    balanceAmount: 0,
    agreementText: "",
    currency: normalizedCurrency,
    paymentLinkId: "",
    status: "sent",
    active: true,
    deactivatedAt: "",
    deactivationReason: "",
    paymentMethodType: "",
    paymentStatusDetail: "",
    paymentNotificationSentAt: "",
    paymentNotificationError: "",
    paymentMethodId: "",
    setupIntentId: "",
    paidAmount: 0,
    paidDate: "",
    paymentIntentId: "",
    balanceChargedAt: "",
    balancePaymentIntentId: "",
    balancePaidAmount: 0,
    ...overrides
  });

  if (priorCard) {
    const confirmToken = crypto.randomBytes(18).toString("base64url");
    const confirmUrl = `https://${SERVICE_PUBLIC_HOST}/card-confirm.html?t=${confirmToken}`;
    const links = await readLinks();
    const confirmRecord = makeCaptureRecord({
      id: `req_${Date.now()}_${confirmToken.slice(0, 6)}`,
      paymentLinkUrl: confirmUrl,
      customerId: "",
      checkoutSessionId: "",
      paymentStatusDetail: `Awaiting client confirmation — ${priorCard.brand} ending ${priorCard.last4} on file`
    });
    links.unshift(confirmRecord);
    await writeLinks(links);
    await createCardConfirm({ token: confirmToken, linkId: confirmRecord.id, prior: priorCard });
    return res.json({
      url: confirmUrl,
      workflowType: "card_capture",
      cardOnFile: {
        brand: priorCard.brand, last4: priorCard.last4,
        expMonth: priorCard.expMonth, expYear: priorCard.expYear,
        fromSalesOrder: priorCard.fromSalesOrder
      }
    });
  }

  const { captureCustomer, captureSession } = await createCardCaptureStripeSession({
    salesOrder, customerName, customerPhone, customerPhoneDigits, customerEmail,
    creatorCode, creatorName, creatorEmail, department, notes, description,
    clientRequestId: req.body?.clientRequestId || ""
  });

  const links = await readLinks();
  links.unshift(makeCaptureRecord({
    paymentLinkUrl: captureSession.url,
    customerId: captureCustomer.id,
    checkoutSessionId: captureSession.id
  }));
  await writeLinks(links);

  return res.json({
    url: captureSession.url,
    checkoutSessionId: captureSession.id,
    workflowType: "card_capture"
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
      id: linkRecord.id,
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

    // Clients can re-open the confirmation page; only rewrite (and stamp
    // "Updated") when the Stripe result actually changed something.
    let cardResultChanged = true;
    let cardAuditRowId = "";
    if (existingCardIdIndex >= 0) {
      const beforeRow = serviceCards[existingCardIdIndex];
      cardResultChanged =
        (beforeRow.setupIntentId || "") !== setupIntent.id ||
        (beforeRow.paymentMethodId || "") !== stripeFields.paymentMethodId ||
        (beforeRow.setupIntentStatus || "") !== stripeFields.setupIntentStatus ||
        (beforeRow.last4 || "") !== last4;
      if (cardResultChanged) {
        serviceCards[existingCardIdIndex] = {
          ...beforeRow,
          setupIntentId: setupIntent.id,
          ...stripeFields
        };
        cardAuditRowId = beforeRow.id;
      }
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
      cardAuditRowId = serviceCards[0].id;
    }

    if (cardResultChanged) {
      await writeServiceCards(serviceCards);

      recordAudit({
        ip: req.ip,
        actorUserId: null,
        action: "service_request_card_saved",
        targetUserId: null,
        detail: { serviceCardId: cardAuditRowId, cardBrand: brand, last4 }
      }).catch(() => {});
    }

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


// PUBLIC: Trade Partner (builder) credit application — a three-step wizard.
// Each "Save & Continue" stores that step server-side under a short
// application code (BCA-XXXX-XXXX) so accounting can see and process
// partially completed applications (credit-applications.html) and the
// applicant can resume later with the code. The final submit flips the
// record to submitted and emails accounting, as the one-page form did.

const CREDIT_APP_INBOX = ["accounting@wilsonappliance.com"];

function cleanCreditValue(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

app.post("/api/credit-application/step", rateLimit("credit-application-step", 30, 60 * 60 * 1000), async (req, res) => {
  try {
    // Honeypot: bots fill every field; humans never see this one.
    if (String(req.body?.website || "").trim()) {
      return res.json({ ok: true, token: null });
    }

    const step = Number(req.body?.step);
    if (![1, 2].includes(step)) {
      return res.status(400).json({ error: "Bad step." });
    }

    const stepData = req.body?.data;
    if (!stepData || typeof stepData !== "object" || Array.isArray(stepData)) {
      return res.status(400).json({ error: "Missing step data." });
    }
    if (JSON.stringify(stepData).length > 40000) {
      return res.status(400).json({ error: "Step data is too large." });
    }

    if (step === 1) {
      const company = stepData.company || {};
      if (!cleanCreditValue(company.legalName)) {
        return res.status(400).json({ error: "Legal company name is required." });
      }
      if (!cleanCreditValue(company.contactName)) {
        return res.status(400).json({ error: "Primary contact name is required." });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanCreditValue(company.contactEmail))) {
        return res.status(400).json({ error: "Enter a valid contact email address." });
      }
    }

    let token = null;
    if (req.body?.token) {
      token = normalizeCreditAppToken(req.body.token);
      if (!token) return res.status(400).json({ error: "Bad application code." });
    }

    const saved = await saveCreditApplicationStep({
      token,
      step,
      stepData,
      legalName: cleanCreditValue(req.body?.legalName),
      contactName: cleanCreditValue(req.body?.contactName),
      contactEmail: cleanCreditValue(req.body?.contactEmail)
    });
    if (!saved) {
      return res.status(404).json({ error: "We couldn't find that application — it may already be submitted." });
    }

    return res.json({ ok: true, token: saved.token, stepCompleted: saved.stepCompleted });
  } catch (err) {
    console.error("Credit application step save failed:", err.message);
    return res.status(500).json({ error: "We couldn't save your progress — please try again." });
  }
});

app.get("/api/credit-application/resume/:token", rateLimit("credit-application-resume", 20, 60 * 60 * 1000), async (req, res) => {
  try {
    const token = normalizeCreditAppToken(req.params.token);
    if (!token) {
      return res.status(400).json({ error: "That doesn't look like an application code (BCA-XXXX-XXXX)." });
    }
    const application = await getCreditApplication(token);
    if (!application || application.status !== "in_progress") {
      return res.status(404).json({ error: "We couldn't find an in-progress application with that code." });
    }
    // Step 3 (affirmations/signature) never goes back out.
    const { step3, ...resumableData } = application.data || {};
    return res.json({
      ok: true,
      application: {
        token: application.token,
        stepCompleted: application.stepCompleted,
        data: resumableData
      }
    });
  } catch (err) {
    console.error("Credit application resume failed:", err.message);
    return res.status(500).json({ error: "Unable to look that up right now — please try again." });
  }
});

app.post("/api/credit-application/submit", rateLimit("credit-application", 5, 60 * 60 * 1000), async (req, res) => {
  try {
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured." });
    }

    const token = normalizeCreditAppToken(req.body?.token);
    if (!token) {
      return res.status(400).json({ error: "Missing application code — please start from step 1." });
    }

    const stepData = req.body?.data || {};
    const affirmations = stepData.affirmations || {};
    const signature = stepData.signature || {};

    if (!affirmations.accurate || !affirmations.terms || !affirmations.authorize) {
      return res.status(400).json({ error: "All three affirmations must be checked." });
    }
    if (!cleanCreditValue(signature.printedName) || !cleanCreditValue(signature.title)) {
      return res.status(400).json({ error: "The authorized signature section is required." });
    }

    const signatureMode = signature.mode === "typed" ? "typed" : "drawn";
    const signatureImage = String(signature.imageData || "");
    if (signatureMode === "typed") {
      if (!cleanCreditValue(signature.signatureText)) {
        return res.status(400).json({ error: "Type your full legal name as your signature." });
      }
    } else if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureImage) || signatureImage.length > 400000) {
      return res.status(400).json({ error: "We couldn't read your drawn signature — please try signing again." });
    }

    const existing = await getCreditApplication(token);
    if (!existing) {
      return res.status(404).json({ error: "We couldn't find that application — please start over." });
    }
    if (existing.status === "submitted") {
      return res.json({ ok: true, token }); // double-submit safe
    }
    if (!existing.data?.step1) {
      return res.status(400).json({ error: "Step 1 hasn't been saved yet — please start from the beginning." });
    }

    const record = await submitCreditApplication({
      token,
      stepData: {
        affirmations: { accurate: true, terms: true, authorize: true },
        signature: {
          printedName: cleanCreditValue(signature.printedName),
          title: cleanCreditValue(signature.title),
          mode: signatureMode,
          signatureText: cleanCreditValue(signature.signatureText),
          imageData: signatureMode === "drawn" ? signatureImage : "",
          date: cleanCreditValue(signature.date, 40)
        }
      }
    });
    if (!record) {
      return res.json({ ok: true, token });
    }

    const clean = cleanCreditValue;
    const company = record.data?.step1?.company || {};
    const business = record.data?.step1?.business || {};
    const bank = record.data?.step2?.bank || {};
    const references = Array.isArray(record.data?.step2?.references)
      ? record.data.step2.references.slice(0, 2)
      : [];
    const sig = record.data?.step3?.signature || {};
    const legalName = clean(company.legalName) || record.legalName || "(unknown)";
    const contactEmail = clean(company.contactEmail) || record.contactEmail;

    const esc = (value) => String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const row = (label, value) => value
      ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:12px;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:4px 0;font-size:13px;">${esc(value)}</td></tr>`
      : "";
    const section = (title, rows) =>
      `<h3 style="margin:18px 0 6px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#1f6329;">${esc(title)}</h3>` +
      `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;

    const mailingLine = [clean(company.mailingAddress), clean(company.mailingCity), clean(company.mailingState), clean(company.mailingZip)].filter(Boolean).join(", ");
    const physicalLine = company.physicalSameAsMailing
      ? "Same as mailing address"
      : [clean(company.physicalAddress), clean(company.physicalCity), clean(company.physicalState), clean(company.physicalZip)].filter(Boolean).join(", ");

    const refBlock = (label, ref) => section(label, [
      row("Company", clean(ref?.company)),
      row("Contact", clean(ref?.contact)),
      row("Email", clean(ref?.email)),
      row("Phone", clean(ref?.phone)),
      row("Terms / since", clean(ref?.terms))
    ].join(""));

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;">
      <h2 style="margin:0 0 2px;">Trade Partner Credit Application</h2>
      <div style="color:#6b7280;font-size:13px;margin-bottom:6px;">Application code ${esc(token)} — submitted ${esc(new Date().toLocaleString("en-US", { timeZone: APP_TIMEZONE }))} (Central) via the public form</div>
      ${section("Applicant Company", [
        row("Legal name", legalName),
        row("DBA / trade name", clean(company.dbaName)),
        row("Mailing address", mailingLine),
        row("Physical address", physicalLine),
        row("Primary contact", [clean(company.contactName), clean(company.contactTitle)].filter(Boolean).join(" — ")),
        row("Phone", clean(company.contactPhone)),
        row("Email", contactEmail),
        row("Accounts payable contact", clean(company.apContact)),
        row("Accounts payable phone", clean(company.apPhone)),
        row("Accounts payable email", clean(company.apEmail))
      ].join(""))}
      ${section("Business Information", [
        row("Business type", clean(business.businessType)),
        row("Time in business", clean(business.yearsInBusiness)),
        row("Federal tax ID (EIN)", clean(business.ein)),
        row("Nature of business", clean(business.natureOfBusiness)),
        row("Owner / officer 1", [clean(business.owner1Name), clean(business.owner1Title), clean(business.owner1Phone)].filter(Boolean).join(" — ")),
        row("Owner / officer 2", [clean(business.owner2Name), clean(business.owner2Title), clean(business.owner2Phone)].filter(Boolean).join(" — ")),
        row("Est. annual volume", clean(business.annualVolume)),
        row("Requested credit limit", clean(business.creditLimit)),
        row("PO required", clean(business.poRequired)),
        row("Tax-exempt", clean(business.taxExempt)),
        row("TX sales tax permit", clean(business.taxPermit)),
        row("Invoice delivery", clean(business.invoiceDelivery))
      ].join(""))}
      ${section("Bank Reference", [
        row("Bank name", clean(bank.bankName)),
        row("Contact name", clean(bank.contactName || bank.bankContact)),
        row("Contact phone", clean(bank.contactPhone)),
        row("Contact email", clean(bank.contactEmail)),
        row("Account reference", clean(bank.accountReference))
      ].join(""))}
      ${refBlock("Trade Reference 1", references[0])}
      ${refBlock("Trade Reference 2", references[1])}
      ${section("Affirmations", [
        row("Information accurate", "Yes"),
        row("Terms of sale accepted", "Yes"),
        row("References / credit reports authorized", "Yes")
      ].join(""))}
      ${section("Authorized Signature", [
        row("Printed name", clean(sig.printedName)),
        row("Title", clean(sig.title)),
        row("Signature", sig.mode === "typed" ? `Typed: ${clean(sig.signatureText)}` : "Drawn — attached as PNG"),
        row("Date", clean(sig.date))
      ].join(""))}
      ${clean(business.taxExempt) === "Yes" ? `<p style="font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 12px;border-radius:8px;">Applicant marked purchases tax-exempt — watch for their Texas resale certificate.</p>` : ""}
    </div>`;

    const emailPayload = {
      from: RESEND_FROM_EMAIL,
      to: CREDIT_APP_INBOX,
      reply_to: contactEmail || undefined,
      subject: `Trade Partner Credit Application — ${legalName}`,
      html
    };
    if (sig.mode === "drawn" && sig.imageData) {
      emailPayload.attachments = [{
        filename: `signature-${token}.png`,
        content: sig.imageData.split(",")[1]
      }];
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Credit application email failed:", response.status, errorText);
      // The application IS stored and marked submitted — accounting can still
      // process it from the admin page, so don't fail the applicant.
    }

    console.log(`Credit application ${token} submitted for ${legalName} (${contactEmail})`);
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("Credit application failed:", err.message);
    return res.status(500).json({ error: "Unable to submit the application." });
  }
});

// INTERNAL: Revenue targets (target-builder.html). GET is also readable by
// dashboard users so the Revenue Snapshot module can show % to target;
// editing requires the Target Builder page grant.
app.get("/api/revenue-targets", requirePagePermission("/target-builder.html", "/dashboard.html"), async (req, res) => {
  try {
    const month = String(req.query.month || "").trim() ||
      new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE }).slice(0, 7);
    if (!isValidTargetMonth(month)) {
      return res.status(400).json({ error: "Provide a month as YYYY-MM." });
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
    const target = await getRevenueTarget(month);
    const workingDays = monthWorkingDays(month, today);

    // Working-day proration: to-date target = month target × elapsed/total.
    const toDate = {
      total: Math.round(target.totalTarget * workingDays.progression * 100) / 100,
      byDepartment: {}
    };
    const byDepartment = {};
    for (const dept of TARGET_DEPARTMENTS) {
      const pct = Number(target.splits[dept] || 0);
      const monthTarget = Math.round(target.totalTarget * pct) / 100;
      byDepartment[dept] = { percent: pct, monthTarget };
      toDate.byDepartment[dept] = Math.round(monthTarget * workingDays.progression * 100) / 100;
    }

    return res.json({ target, byDepartment, workingDays, toDate, today });
  } catch (err) {
    console.error("Revenue target load failed:", err.message);
    return res.status(500).json({ error: "Unable to load revenue targets." });
  }
});

app.post("/api/revenue-targets", requirePagePermission("/target-builder.html"), async (req, res) => {
  try {
    const month = String(req.body?.month || "").trim();
    if (!isValidTargetMonth(month)) {
      return res.status(400).json({ error: "Provide a month as YYYY-MM." });
    }

    const totalTarget = Number(String(req.body?.totalTarget ?? "").toString().replace(/[,$\s]/g, ""));
    if (!Number.isFinite(totalTarget) || totalTarget <= 0 || totalTarget > 1000000000) {
      return res.status(400).json({ error: "Enter a valid monthly target amount." });
    }

    const splits = req.body?.splits || {};
    let sum = 0;
    for (const dept of TARGET_DEPARTMENTS) {
      const pct = Number(splits[dept]);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: `Enter a valid percentage for ${dept}.` });
      }
      sum += pct;
    }
    if (Math.abs(sum - 100) > 0.01) {
      return res.status(400).json({ error: `Department splits must add up to 100% (currently ${Math.round(sum * 100) / 100}%).` });
    }

    const saved = await saveRevenueTarget({
      month,
      totalTarget,
      splits,
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "revenue_target_saved", targetUserId: null,
      detail: { month, totalTarget: saved.totalTarget, splits: saved.splits }
    }).catch(() => {});

    return res.json({ ok: true, target: saved });
  } catch (err) {
    console.error("Revenue target save failed:", err.message);
    return res.status(500).json({ error: "Unable to save the target." });
  }
});

// INTERNAL: Revenue performance — the Salesperson Activity Report (ePASS
// OE-23, legacy .xls) parsed server-side. This is the revenue numerator to
// the target denominator: revenue = List "Total (no Tax)", departments come
// from the ticket prefix (SV → Repair Service, CB/MD → Kitchen Design,
// AC → HVAC Sales, R/S → Appliance). One snapshot per month keyed by the
// report's From date; re-uploads replace the month.
const activityReportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post("/api/revenue-performance", requirePagePermission("/target-builder.html", "/sales-order-detail.html", "/epass-uploads.html"), (req, res) => {
  activityReportUpload.single("report")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That file is over the 20 MB limit." : "Upload failed — please try again." });
    }
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Attach the Salesperson Activity Report export (.xls)." });
      }

      let grid;
      try {
        const workbook = readWorkbook(req.file.buffer, { type: "buffer", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        grid = xlsxUtils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      } catch (parseErr) {
        console.error("Activity report read failed:", parseErr.message);
        return res.status(400).json({ error: "Couldn't read that file as an Excel workbook. Export the Salesperson Activity Report from ePASS and upload it unmodified." });
      }

      const parsed = parseActivityGrid(grid);
      if (!parsed.periodFrom) {
        return res.status(400).json({ error: "Couldn't find the report period — is this the Salesperson Activity Report (OE-23)?" });
      }

      const month = parsed.periodFrom.slice(0, 7);
      const saved = await saveRevenuePerformance({
        month,
        periodFrom: parsed.periodFrom,
        periodTo: parsed.periodTo,
        filename: req.file.originalname || "",
        byEmail: req.authUser?.email || req.authUser?.username || "",
        byName: req.authUser?.displayName || "",
        ticketCount: parsed.tickets.length,
        totals: parsed.grandListTotals,
        byDepartment: rollupByDepartment(parsed.tickets),
        bySalesperson: rollupBySalesperson(parsed.tickets),
        warnings: parsed.warnings,
        tickets: parsed.tickets
      });

      // Feed the durable per-order warehouse (sales-order-detail.html).
      let ordersUpserted = 0;
      try {
        ordersUpserted = await upsertOrdersFromActivity(parsed.tickets, {
          sourceMonth: month,
          filename: req.file.originalname || ""
        });
      } catch (detailErr) {
        console.error("Sales order detail upsert failed:", detailErr.message);
      }

      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "revenue_performance_uploaded", targetUserId: null,
        detail: { month, periodFrom: parsed.periodFrom, periodTo: parsed.periodTo, tickets: parsed.tickets.length, ordersUpserted, filename: req.file.originalname || "", warnings: parsed.warnings.length }
      }).catch(() => {});

      return res.json({ ok: true, performance: saved, ordersUpserted });
    } catch (parseErr) {
      console.error("Activity report parse failed:", parseErr.message);
      return res.status(400).json({ error: parseErr.message || "Unable to parse the report." });
    }
  });
});

app.get("/api/revenue-performance", requirePagePermission("/target-builder.html", "/dashboard.html"), async (req, res) => {
  try {
    const month = String(req.query.month || "").trim() ||
      new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE }).slice(0, 7);
    if (!isValidTargetMonth(month)) {
      return res.status(400).json({ error: "Provide a month as YYYY-MM." });
    }
    const performance = await getRevenuePerformance(month);
    return res.json({ month, performance });
  } catch (err) {
    console.error("Revenue performance load failed:", err.message);
    return res.status(500).json({ error: "Unable to load revenue performance." });
  }
});

// INTERNAL: Quote Follow-Up (quote-follow-up.html) — the ePASS Invoice
// Maintenance quote export (Inv Type Q / Status Open) uploaded here and
// matched against the OE-23 sales_order_detail warehouse: an order with the
// same customer number + same salesperson code on/after the quote date is a
// conversion. Salespeople see their own queue (matched by their directory
// ePASS code); executives see everyone with a salesperson filter.
const quoteExportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function quoteFollowupViewer(req) {
  const exec = isExecutiveUser(req.authUser);
  const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
  let code = "";
  let name = "";
  try {
    const entry = await findEmployeeDirectoryEntryByEmail(email);
    code = String(entry?.code || "").trim().toUpperCase();
    name = entry?.name || "";
  } catch {}
  return { exec, code, name };
}

app.get("/api/quote-followup", requirePagePermission("/quote-follow-up.html"), async (req, res) => {
  try {
    const viewer = await quoteFollowupViewer(req);
    let spCode = null;
    if (viewer.exec) {
      const filter = String(req.query.salesperson || "").trim().toUpperCase();
      spCode = filter && filter !== "ALL" ? filter : null;
    } else {
      if (!viewer.code) {
        return res.json({ viewer, board: null, salespeople: [], noCode: true });
      }
      spCode = viewer.code;
    }
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const board = await getQuoteFollowupBoard({ spCode, from, to });
    // A rep whose job title isn't a sales title sees a clear notice instead
    // of a silently empty board.
    if (!viewer.exec && board.salesFilterActive && !board.salesCodes.includes(viewer.code)) {
      return res.json({ viewer, board: null, salespeople: [], notSalesRole: true });
    }
    const salespeople = viewer.exec ? await listQuoteSalespeople() : [];
    return res.json({ viewer, board, salespeople, filter: spCode });
  } catch (err) {
    console.error("Quote follow-up load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the quote follow-up board." });
  }
});

app.post("/api/quote-followup/upload", requirePagePermission("/quote-follow-up.html", "/epass-uploads.html"), async (req, res) => {
  // Executives, or anyone granted the ePASS Upload Center (Tracy's daily
  // upload duty) — but never regular quote-page salespeople.
  if (!(await userHoldsPage(req.authUser, "/epass-uploads.html"))) {
    return res.status(403).json({ error: "Executive access (or the ePASS Upload Center page) is required to upload the quote export." });
  }
  quoteExportUpload.single("report")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That file is over the 20 MB limit." : "Upload failed — please try again." });
    }
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Attach the Invoice Maintenance quote export (.xlsx)." });
      }
      let grid;
      try {
        const workbook = readWorkbook(req.file.buffer, { type: "buffer", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        grid = xlsxUtils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      } catch (parseErr) {
        console.error("Quote export read failed:", parseErr.message);
        return res.status(400).json({ error: "Couldn't read that file as an Excel workbook. Export Invoice Maintenance (quotes, Open) from ePASS and upload it unmodified." });
      }
      const parsed = parseInvoiceMaintenanceQuotes(grid);
      if (parsed.notInvoiceMaintenance) {
        return res.status(400).json({ error: "Couldn't find the header row — is this the Invoice Maintenance export?" });
      }
      if (!parsed.quotes.length) {
        return res.status(400).json({ error: "No open quotes found in that file." });
      }
      const count = await replaceOpenQuotes(parsed.quotes, {
        filename: req.file.originalname || "",
        byEmail: req.authUser?.email || req.authUser?.username || "",
        byName: req.authUser?.displayName || ""
      });
      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "quote_export_uploaded", targetUserId: null,
        detail: { quotes: count, filename: req.file.originalname || "", warnings: parsed.warnings.length }
      }).catch(() => {});
      return res.json({ ok: true, quotes: count, warnings: parsed.warnings.slice(0, 10) });
    } catch (uploadErr) {
      console.error("Quote export upload failed:", uploadErr.message);
      return res.status(500).json({ error: uploadErr.message || "Unable to process the export." });
    }
  });
});

// INTERNAL (exec): Service → Sales lead conversions — every service order
// whose customer bought within 30 days, paired tech → salesperson so lead
// routing (and any favoritism) is visible.
app.get("/api/quote-followup/service-leads", requirePagePermission("/quote-follow-up.html"), async (req, res) => {
  try {
    if (!isExecutiveUser(req.authUser)) {
      return res.status(403).json({ error: "Executive access is required for the service-lead report." });
    }
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const report = await listServiceLeadConversions({
      from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "",
      to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : ""
    });
    return res.json(report);
  } catch (err) {
    console.error("Service lead report failed:", err.message);
    return res.status(500).json({ error: "Unable to build the service-lead report." });
  }
});

app.post("/api/quote-followup/disposition", requirePagePermission("/quote-follow-up.html"), async (req, res) => {
  try {
    const viewer = await quoteFollowupViewer(req);
    const quoteNumbers = (Array.isArray(req.body?.quoteNumbers) ? req.body.quoteNumbers : [])
      .map((n) => String(n).trim().toUpperCase()).filter(Boolean);
    const action = String(req.body?.action || "");
    if (!quoteNumbers.length) {
      return res.status(400).json({ error: "No quote numbers provided." });
    }
    if (!viewer.exec) {
      const owners = await listQuoteOwners(quoteNumbers);
      const foreign = quoteNumbers.filter((n) => (owners[n] || "") !== viewer.code);
      if (!viewer.code || foreign.length) {
        return res.status(403).json({ error: "You can only update your own quotes." });
      }
    }
    const result = await saveQuoteDisposition({
      quoteNumbers,
      action,
      salesOrderNumber: req.body?.salesOrderNumber || "",
      comment: req.body?.comment || "",
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "quote_disposition_saved", targetUserId: null,
      detail: { action, quotes: quoteNumbers, salesOrderNumber: String(req.body?.salesOrderNumber || "").slice(0, 40) }
    }).catch(() => {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Quote disposition failed:", err.message);
    return res.status(400).json({ error: err.message || "Unable to save that update." });
  }
});

// INTERNAL: Bonus Tracker — attainment-tier rules (edited on the Target
// Builder) and the per-user payout view (dashboard module). Two ladders per
// department: dept MTD attainment and company MTD attainment, both vs the
// working-day-prorated targets.
app.get("/api/bonus-rules", requirePagePermission("/target-builder.html", "/dashboard.html"), async (req, res) => {
  try {
    const saved = await getBonusRules();
    return res.json({ ...saved, departments: BONUS_DEPARTMENTS });
  } catch (err) {
    console.error("Bonus rules load failed:", err.message);
    return res.status(500).json({ error: "Unable to load bonus rules." });
  }
});

app.post("/api/bonus-rules", requirePagePermission("/target-builder.html"), async (req, res) => {
  try {
    const clean = await saveBonusRules({
      rules: req.body?.rules || {},
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "bonus_rules_saved", targetUserId: null,
      detail: { departments: Object.keys(clean).filter((d) => (clean[d].deptTiers.length + clean[d].companyTiers.length) > 0) }
    }).catch(() => {});
    return res.json({ ok: true, rules: clean });
  } catch (err) {
    console.error("Bonus rules save failed:", err.message);
    return res.status(500).json({ error: "Unable to save bonus rules." });
  }
});

app.get("/api/bonus-tracker", requirePagePermission("/dashboard.html", "/target-builder.html"), async (req, res) => {
  try {
    const month = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE }).slice(0, 7);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });

    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    let department = null;
    try {
      const entry = await findEmployeeDirectoryEntryByEmail(email);
      department = entry?.department || null;
    } catch {}

    const [target, performance, savedRules] = await Promise.all([
      getRevenueTarget(month),
      getRevenuePerformance(month),
      getBonusRules()
    ]);
    const workingDays = monthWorkingDays(month, today);
    const progression = workingDays?.progression || 0;

    const companyRevenue = Number(performance?.totals?.totalNoTax) || 0;
    const companyToDateTarget = Math.round(target.totalTarget * progression * 100) / 100;
    const companyAttainment = companyToDateTarget > 0 && performance ? companyRevenue / companyToDateTarget * 100 : NaN;

    const deptPct = Number(target.splits?.[department] || 0);
    const deptMonthTarget = Math.round(target.totalTarget * deptPct) / 100;
    const deptToDateTarget = Math.round(deptMonthTarget * progression * 100) / 100;
    const deptRevenue = Number(performance?.byDepartment?.[department]?.revenue) || 0;
    const departmentHasTarget = deptPct > 0;
    const deptAttainment = departmentHasTarget && deptToDateTarget > 0 && performance ? deptRevenue / deptToDateTarget * 100 : NaN;

    const payout = computeBonus({
      department,
      deptAttainment,
      companyAttainment,
      rules: savedRules.rules
    });

    // Directory entry name → personal revenue (OE-23 keys are all-caps names).
    let personalName = "";
    try {
      const entry = await findEmployeeDirectoryEntryByEmail(email);
      personalName = entry?.name || "";
    } catch {}
    const normalizedPersonal = normalizeSalespersonName(personalName);
    const personalRevenueIn = (perf) => {
      if (!perf?.bySalesperson || !normalizedPersonal) return 0;
      for (const [name, stats] of Object.entries(perf.bySalesperson)) {
        if (normalizeSalespersonName(name) === normalizedPersonal) return Number(stats?.revenue) || 0;
      }
      return 0;
    };

    // Three months of target-vs-actual for the charts (oldest first). Past
    // months compare against the FULL month target; the current month against
    // the working-day-prorated to-date target.
    const history = [];
    const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    for (let back = 2; back >= 0; back--) {
      const d = new Date(Date.UTC(y, m - 1 - back, 1));
      const hm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const isCurrent = hm === month;
      const [hTarget, hPerf] = isCurrent
        ? [target, performance]
        : await Promise.all([getRevenueTarget(hm), getRevenuePerformance(hm)]);
      const factor = isCurrent ? progression : 1;
      const hDeptMonthTarget = Math.round(hTarget.totalTarget * Number(hTarget.splits?.[department] || 0)) / 100;
      history.push({
        month: hm,
        label: d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }),
        prorated: isCurrent,
        deptActual: Number(hPerf?.byDepartment?.[department]?.revenue) || 0,
        deptTarget: Math.round(hDeptMonthTarget * factor * 100) / 100,
        companyActual: Number(hPerf?.totals?.totalNoTax) || 0,
        companyTarget: Math.round(hTarget.totalTarget * factor * 100) / 100,
        personalActual: personalRevenueIn(hPerf)
      });
    }

    const personalRevenue = personalRevenueIn(performance);

    // Year-over-year comp: the same month last year, if its OE-23 was
    // uploaded (the plumbing accepts any historical export).
    const priorMonth = `${y - 1}-${String(m).padStart(2, "0")}`;
    let priorYear = null;
    try {
      const priorPerf = await getRevenuePerformance(priorMonth);
      if (priorPerf) {
        priorYear = {
          month: priorMonth,
          companyRevenue: Number(priorPerf.totals?.totalNoTax) || 0,
          deptRevenue: Number(priorPerf.byDepartment?.[department]?.revenue) || 0,
          personalRevenue: personalRevenueIn(priorPerf)
        };
      }
    } catch {}

    return res.json({
      month,
      department,
      departmentHasTarget,
      hasPerformance: Boolean(performance),
      performanceAsOf: performance?.uploadedAt || null,
      workingDays: { total: workingDays?.total || 0, elapsed: workingDays?.elapsed || 0 },
      dept: { revenue: deptRevenue, toDateTarget: deptToDateTarget, monthTarget: deptMonthTarget, attainment: Number.isFinite(deptAttainment) ? Math.round(deptAttainment * 10) / 10 : null },
      company: { revenue: companyRevenue, toDateTarget: companyToDateTarget, attainment: Number.isFinite(companyAttainment) ? Math.round(companyAttainment * 10) / 10 : null },
      personal: {
        name: personalName,
        revenue: personalRevenue,
        deptShare: deptRevenue > 0 ? Math.round(personalRevenue / deptRevenue * 1000) / 10 : null,
        companyShare: companyRevenue > 0 ? Math.round(personalRevenue / companyRevenue * 1000) / 10 : null
      },
      history,
      priorYear,
      progression: Math.round(progression * 10000) / 10000,
      payout,
      rulesSource: savedRules.source
    });
  } catch (err) {
    console.error("Bonus tracker load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the bonus tracker." });
  }
});

// INTERNAL: Revenue Snapshot module (dashboard.html) — finished-order
// revenue from the OE-23 warehouse vs targets, with a year-over-year comp.
// (Replaced the old Stripe payment-link tiles.)
app.get("/api/revenue-snapshot", requirePagePermission("/dashboard.html", "/target-builder.html"), async (req, res) => {
  try {
    const month = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE }).slice(0, 7);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
    const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];

    // Quarter months (calendar quarters), current month included.
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const quarterMonths = [0, 1, 2].map((i) => `${y}-${String(qStart + i).padStart(2, "0")}`);
    const quarterLabel = `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    const priorYearOf = (ym) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;

    // Load once per involved month: target, performance, prior-year performance.
    const monthData = new Map();
    async function loadMonthData(ym) {
      if (!monthData.has(ym)) {
        const [t, p, pp] = await Promise.all([
          getRevenueTarget(ym),
          getRevenuePerformance(ym).catch(() => null),
          getRevenuePerformance(priorYearOf(ym)).catch(() => null)
        ]);
        monthData.set(ym, { target: t, perf: p, priorPerf: pp });
      }
      return monthData.get(ym);
    }

    const currentWd = monthWorkingDays(month, today);
    const progressionOf = (ym) => (ym === month ? (currentWd?.progression || 0) : (ym < month ? 1 : 0));

    // Build one block (MTD = [current month], QTD = quarter months).
    async function buildBlock(months) {
      const block = {
        company: { actual: 0, toDateTarget: 0, fullTarget: 0, priorYearActual: 0 },
        byDepartment: {},
        elapsedWeight: 0,
        totalWeight: 0,
        hasAnyPerformance: false,
        hasPriorYear: false
      };
      for (const dept of TARGET_DEPARTMENTS) {
        block.byDepartment[dept] = { actual: 0, toDateTarget: 0, fullTarget: 0, priorYearActual: 0 };
      }
      for (const ym of months) {
        const { target, perf, priorPerf } = await loadMonthData(ym);
        const factor = progressionOf(ym);
        const wd = ym === month ? currentWd : monthWorkingDays(ym, today);
        block.totalWeight += wd?.total || 0;
        block.elapsedWeight += Math.round((wd?.total || 0) * factor);
        if (perf) block.hasAnyPerformance = true;
        if (priorPerf) block.hasPriorYear = true;

        block.company.actual += Number(perf?.totals?.totalNoTax) || 0;
        block.company.toDateTarget += target.totalTarget * factor;
        block.company.fullTarget += target.totalTarget;
        block.company.priorYearActual += Number(priorPerf?.totals?.totalNoTax) || 0;

        for (const dept of TARGET_DEPARTMENTS) {
          const pct = Number(target.splits?.[dept] || 0);
          const monthTarget = target.totalTarget * pct / 100;
          const d = block.byDepartment[dept];
          d.actual += Number(perf?.byDepartment?.[dept]?.revenue) || 0;
          d.toDateTarget += monthTarget * factor;
          d.fullTarget += monthTarget;
          d.priorYearActual += Number(priorPerf?.byDepartment?.[dept]?.revenue) || 0;
        }
      }
      const progression = block.totalWeight ? block.elapsedWeight / block.totalWeight : 0;
      const finish = (entry) => ({
        actual: Math.round(entry.actual * 100) / 100,
        toDateTarget: Math.round(entry.toDateTarget * 100) / 100,
        fullTarget: Math.round(entry.fullTarget * 100) / 100,
        attainment: entry.toDateTarget > 0 && block.hasAnyPerformance ? Math.round(entry.actual / entry.toDateTarget * 1000) / 10 : null,
        priorYearActual: block.hasPriorYear ? Math.round(entry.priorYearActual * 100) / 100 : null
      });
      return {
        progression: Math.round(progression * 10000) / 10000,
        hasPerformance: block.hasAnyPerformance,
        hasPriorYear: block.hasPriorYear,
        company: finish(block.company),
        byDepartment: Object.fromEntries(Object.entries(block.byDepartment).map(([k, v]) => [k, finish(v)]))
      };
    }

    const [mtd, qtd] = [await buildBlock([month]), await buildBlock(quarterMonths)];
    const { perf } = await loadMonthData(month);
    const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });

    return res.json({
      month,
      workingDays: { total: currentWd?.total || 0, elapsed: currentWd?.elapsed || 0 },
      performanceAsOf: perf?.uploadedAt || null,
      mtd: { ...mtd, label: `MTD — ${monthLabel}`, priorLabel: `${y - 1}-${String(m).padStart(2, "0")}` },
      qtd: { ...qtd, label: `QTD — ${quarterLabel}`, priorLabel: `Q${Math.floor((m - 1) / 3) + 1} ${y - 1}` }
    });
  } catch (err) {
    console.error("Revenue snapshot load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the revenue snapshot." });
  }
});

// INTERNAL: Sales Order Detail (sales-order-detail.html, Admin/executive).
// The commission report upload adds line items (models / warranty plans with
// qty, revenue, serial cost); each upload replaces its month. The order rows
// themselves are fed by the OE-23 upload on the Target Builder.
app.post("/api/commission-report", requirePagePermission("/sales-order-detail.html", "/epass-uploads.html"), (req, res) => {
  activityReportUpload.single("report")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That file is over the 20 MB limit." : "Upload failed — please try again." });
    }
    try {
      const month = String(req.body?.month || "").trim();
      if (!isValidTargetMonth(month)) {
        return res.status(400).json({ error: "Pick the month this commission report covers." });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Attach the commission report export (.xlsx)." });
      }

      let grid;
      try {
        const workbook = readWorkbook(req.file.buffer, { type: "buffer", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        grid = xlsxUtils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      } catch (parseErr) {
        console.error("Commission report read failed:", parseErr.message);
        return res.status(400).json({ error: "Couldn't read that file as an Excel workbook." });
      }

      const parsed = parseCommissionGrid(grid);
      await replaceCommissionLines(month, parsed.lines, { filename: req.file.originalname || "" });

      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "commission_report_uploaded", targetUserId: null,
        detail: { month, lines: parsed.lines.length, invoices: parsed.invoiceCount, revenueTotal: parsed.revenueTotal, filename: req.file.originalname || "" }
      }).catch(() => {});

      return res.json({
        ok: true,
        month,
        lines: parsed.lines.length,
        invoices: parsed.invoiceCount,
        revenueTotal: parsed.revenueTotal,
        serialCostTotal: parsed.serialCostTotal,
        warnings: parsed.warnings
      });
    } catch (parseErr) {
      console.error("Commission report parse failed:", parseErr.message);
      return res.status(400).json({ error: parseErr.message || "Unable to parse the report." });
    }
  });
});

app.get("/api/sales-order-detail", requirePagePermission("/sales-order-detail.html"), async (req, res) => {
  try {
    const startDate = String(req.query.start || "").trim();
    const endDate = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: "Provide start and end dates as YYYY-MM-DD." });
    }
    const orders = await listOrderDetail({
      startDate,
      endDate,
      department: String(req.query.department || "").trim() || null,
      salesperson: String(req.query.salesperson || "").trim() || null
    });
    return res.json({ orders });
  } catch (err) {
    console.error("Sales order detail load failed:", err.message);
    return res.status(500).json({ error: "Unable to load sales order detail." });
  }
});

app.get("/api/sales-order-detail/line-report", requirePagePermission("/sales-order-detail.html"), async (req, res) => {
  try {
    const startDate = String(req.query.start || "").trim();
    const endDate = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: "Provide start and end dates as YYYY-MM-DD." });
    }
    const lines = await listOrderLineDetail({
      startDate,
      endDate,
      department: String(req.query.department || "").trim() || null,
      salesperson: String(req.query.salesperson || "").trim() || null
    });
    return res.json({ lines });
  } catch (err) {
    console.error("Sales order line report failed:", err.message);
    return res.status(500).json({ error: "Unable to load the line item report." });
  }
});

// INTERNAL: Returns Report (returns-report.html) — negative-quantity
// commission lines (returns / RTV / swap-outs) by commission month.
app.get("/api/returns-report", requirePagePermission("/returns-report.html"), async (req, res) => {
  try {
    const startMonth = String(req.query.start || "").trim();
    const endMonth = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
      return res.status(400).json({ error: "Provide start and end months as YYYY-MM." });
    }
    const returns = await listReturnLines({ startMonth, endMonth });
    return res.json({ returns });
  } catch (err) {
    console.error("Returns report load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the returns report." });
  }
});

app.get("/api/sales-order-detail/sources", requirePagePermission("/sales-order-detail.html"), async (req, res) => {
  try {
    const sources = await listSourceVersions();
    return res.json(sources);
  } catch (err) {
    console.error("Source versions load failed:", err.message);
    return res.status(500).json({ error: "Unable to load source versions." });
  }
});

app.get("/api/sales-order-detail/lines", requirePagePermission("/sales-order-detail.html"), async (req, res) => {
  try {
    const invoice = String(req.query.invoice || "").trim().toUpperCase();
    if (!invoice) return res.status(400).json({ error: "Provide an invoice." });
    const lines = await listLinesForInvoice(invoice);
    return res.json({ invoice, lines });
  } catch (err) {
    console.error("Sales order lines load failed:", err.message);
    return res.status(500).json({ error: "Unable to load line items." });
  }
});

// INTERNAL: Sales Order Health Report (sales-order-health.html). The page
// parses the ExportInvoice xlsx in the browser and posts normalized rows;
// the latest snapshot is stored whole so everyone sees the same data.
app.get("/api/sales-orders", requirePagePermission("/sales-order-health.html"), async (req, res) => {
  try {
    const snapshot = await getSalesOrderSnapshot();
    return res.json({ snapshot });
  } catch (err) {
    console.error("Sales orders load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the sales order snapshot." });
  }
});

app.post("/api/sales-orders", requirePagePermission("/sales-order-health.html"), async (req, res) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "No order rows found in the upload." });
    }
    if (rows.length > 20000) {
      return res.status(400).json({ error: "That upload has too many rows." });
    }

    const cleanText = (value, max = 200) => String(value == null ? "" : value).trim().slice(0, max);
    const cleanNumber = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const cleanDate = (value) => {
      const s = String(value || "").trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
    };

    const normalized = rows
      .map((row) => ({
        invoice: cleanText(row.invoice, 40),
        sp: cleanText(row.sp, 20),
        userCreated: cleanText(row.userCreated, 20),
        dateCreated: cleanDate(row.dateCreated),
        paymentType: cleanText(row.paymentType, 20),
        balance: cleanNumber(row.balance),
        total: cleanNumber(row.total),
        status: cleanText(row.status, 40),
        pickupDate: cleanDate(row.pickupDate),
        schedDate: cleanDate(row.schedDate),
        route: cleanText(row.route, 20),
        jobStatus: cleanText(row.jobStatus, 20),
        customerNumber: cleanText(row.customerNumber, 40),
        name: cleanText(row.name, 120),
        address: cleanText(row.address, 160),
        zip: cleanText(row.zip, 20),
        po: cleanText(row.po, 60),
        reference: cleanText(row.reference, 120)
      }))
      .filter((row) => row.invoice);

    if (!normalized.length) {
      return res.status(400).json({ error: "No rows with an invoice number found — is this the right export?" });
    }

    const snapshot = await saveSalesOrderSnapshot({
      rows: normalized,
      filename: String(req.body?.filename || "").slice(0, 200),
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "sales_orders_uploaded", targetUserId: null,
      detail: { rows: normalized.length, filename: snapshot.filename }
    }).catch(() => {});

    return res.json({ ok: true, snapshot });
  } catch (err) {
    console.error("Sales orders upload failed:", err.message);
    return res.status(500).json({ error: "Unable to store the sales order snapshot." });
  }
});

// INTERNAL: Service Order Health (service-order-health.html, Client Care).
// Same pattern as /api/sales-orders — the page parses the ExportInvoice xlsx
// (SV + WTY invoice types) in the browser and posts normalized rows; the
// latest snapshot is stored whole. The GET additionally joins each ticket's
// Invoice # against the Service Request Queue's ERP Order Number (active +
// archived cards) so the page can show whether a secure card is on file —
// computed at read time so it always reflects the current queue.

// Both sides of the match are staff-entered / export-formatted text, so
// compare on tolerant keys: uppercase alphanumerics ("SV00092385"), the
// zero-compressed variant ("SV92385"), and the bare zero-stripped digits
// ("92385", ignored when shorter than 4 digits to avoid false hits).
function erpInvoiceMatchKeys(value) {
  const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return [];
  const keys = new Set([raw]);
  const compact = raw.replace(/([A-Z])0+(?=\d)/g, "$1").replace(/^0+(?=\d)/, "");
  keys.add(compact);
  const digits = raw.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length >= 4) keys.add(digits);
  return [...keys];
}

async function buildServiceCardMatchIndex() {
  const [active, archived] = await Promise.all([
    readServiceCards(),
    readArchivedServiceCards().catch(() => [])
  ]);
  const index = new Map();
  const add = (row, isArchived) => {
    const entry = {
      hasCard: !!(row.customerId && row.paymentMethodId),
      archived: isArchived,
      queueStatus: row.queueStatus || "",
      customerName: row.customerName || ""
    };
    for (const key of erpInvoiceMatchKeys(row.erpOrderNumber)) {
      const existing = index.get(key);
      // Prefer a match that has a card, then an active card over an archived one.
      if (!existing || (entry.hasCard && !existing.hasCard) ||
          (entry.hasCard === existing.hasCard && existing.archived && !isArchived)) {
        index.set(key, entry);
      }
    }
  };
  (Array.isArray(archived) ? archived : []).forEach((row) => add(row, true));
  (Array.isArray(active) ? active : []).forEach((row) => add(row, false));
  return index;
}

// ---------------------------------------------------------------------------
// Service Order Health → dashboard flag routing, run on every upload.
//   WTY tickets with problems  → per-ticket yellow flag to every Warranty
//                                Analyst (job code NE12), flagged once per
//                                invoice so daily uploads don't re-nag.
//   SV/COD tickets with problems → ONE living summary flag to every Senior
//                                Client Care Specialist (job code NE17),
//                                refreshed (replaced) on each upload and
//                                dropped entirely when the list is clean.
// "Problems" mirror the report page: scheduled/pickup date in the past, and
// for SV additionally no secure card on file via the request-queue match.
// ---------------------------------------------------------------------------
const WARRANTY_ANALYST_JOB_CODE = (process.env.WARRANTY_ANALYST_JOB_CODE || "NE12").toUpperCase();
const SVH_SV_COD_SUMMARY_REF = "svh:sv-cod-summary";

async function jobCodeHolders(code) {
  const directory = await listEmployeeDirectory();
  return directory.filter((entry) =>
    !entry.archived &&
    String(entry.jobTitleCode || "").trim().toUpperCase() === code &&
    String(entry.email || "").trim()
  );
}

async function pushServiceOrderHealthFlags(rows) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
  const effDate = (r) => r.schedDate || r.pickupDate || "";
  const isPast = (r) => { const d = effDate(r); return !!d && d < today; };

  // ---- WTY → Warranty Analyst (NE12), one flag per problem invoice, ever.
  const analysts = await jobCodeHolders(WARRANTY_ANALYST_JOB_CODE);
  if (analysts.length) {
    const wtyFlagged = rows.filter((r) => r.invType === "WTY" && isPast(r));
    for (const order of wtyFlagged) {
      const ref = `svhwty:${order.invoice}`;
      if (await pushedNotificationRefExists(ref)) continue;
      for (const analyst of analysts) {
        await createPushedNotification({
          severity: "yellow",
          typeLabel: "Warranty Ticket",
          refId: ref,
          title: `${order.invoice} — ${order.name || "warranty ticket"} needs attention`,
          body: `${order.jobStatus || "Open"} · dated ${effDate(order)} (past) · tech ${order.sp || "—"}${Number(order.balance) ? ` · balance $${Number(order.balance).toFixed(2)}` : ""}. Review it on Service Order Health.`,
          audienceEmail: analyst.email,
          byEmail: "service-order-health",
          byName: "Service Order Health"
        }).catch(() => {});
      }
    }
  }

  // ---- SV/COD → Senior Client Care (NE17), one living summary flag.
  const index = await buildServiceCardMatchIndex();
  const hasCard = (r) => {
    for (const key of erpInvoiceMatchKeys(r.invoice)) {
      const match = index.get(key);
      if (match) return match.hasCard;
    }
    return false;
  };
  const svCod = rows.filter((r) => r.invType === "SV" && /COD/i.test(r.paymentType || ""));
  const flagged = svCod.filter((r) => isPast(r) || !hasCard(r));
  const pastCount = flagged.filter((r) => isPast(r)).length;
  const noCardCount = flagged.filter((r) => !hasCard(r)).length;

  await retirePushedNotificationsByRef(SVH_SV_COD_SUMMARY_REF).catch(() => {});
  if (flagged.length) {
    const seniors = await jobCodeHolders(SENIOR_CS_JOB_CODE);
    for (const senior of seniors) {
      await createPushedNotification({
        severity: "yellow",
        typeLabel: "SV/COD Tickets",
        refId: SVH_SV_COD_SUMMARY_REF,
        title: `${flagged.length} SV/COD service ticket${flagged.length === 1 ? "" : "s"} need attention`,
        body: `${pastCount} past-date · ${noCardCount} without a secure card on file. The full list is on Service Order Health — this flag refreshes with each upload.`,
        audienceEmail: senior.email,
        byEmail: "service-order-health",
        byName: "Service Order Health"
      }).catch(() => {});
    }
  }
  return { wty: rows.filter((r) => r.invType === "WTY" && isPast(r)).length, svCod: flagged.length };
}

// INTERNAL: OE-23 OPEN-orders upload (Report by: Invoice Start Date,
// Record type: Current). Feeds ticket→salesperson attribution for OPEN
// orders — run the export with a period-from far in the past so long-open
// tickets (the aging ones!) are included. Same OE-23 layout, same parser.
app.post("/api/epass-uploads/open-orders", requirePagePermission("/epass-uploads.html", "/aging-inventory.html"), (req, res) => {
  epassInventoryUpload.single("report")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That file is over the size limit." : "Upload failed — try again." });
    }
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Attach the OE-23 open-orders export (.xls)." });
      }
      let grid;
      try {
        const workbook = readWorkbook(req.file.buffer, { type: "buffer", cellDates: true });
        grid = xlsxUtils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: true });
      } catch (readErr) {
        return res.status(400).json({ error: "Couldn't read that file as an Excel workbook — export OE-23 from ePASS and upload it unmodified." });
      }
      const parsed = parseActivityGrid(grid);
      if (!parsed.periodFrom || !parsed.tickets.length) {
        return res.status(400).json({ error: "Couldn't find OE-23 ticket blocks — is this the Salesperson Activity Report?" });
      }
      const saved = await replaceOpenOrders(parsed.tickets, {
        filename: String(req.file.originalname || "OE-23 open").slice(0, 200),
        byEmail: req.authUser?.email || req.authUser?.username || "",
        periodFrom: parsed.periodFrom, periodTo: parsed.periodTo
      });
      recordAudit({
        ip: req.ip, actorUserId: req.authUser?.id || null,
        action: "open_orders_uploaded", targetUserId: null,
        detail: { tickets: saved.count, periodFrom: parsed.periodFrom, periodTo: parsed.periodTo, filename: req.file.originalname }
      }).catch(() => {});
      return res.json({ ok: true, tickets: saved.count, periodFrom: parsed.periodFrom, periodTo: parsed.periodTo, warnings: parsed.warnings || [] });
    } catch (uploadErr) {
      console.error("Open-orders upload failed:", uploadErr.message);
      return res.status(500).json({ error: "Unable to store the open-orders report." });
    }
  });
});

// INTERNAL: Aging Inventory by salesperson. Joins the serial export's
// per-unit detail (receive date + Written To ticket) against OE-23 order
// detail (ticket → salesperson). Unreserved units group under STOCK.
app.get("/api/aging-inventory", requirePagePermission("/aging-inventory.html"), async (req, res) => {
  try {
    const snapshot = await getShopInventorySnapshot();
    if (!snapshot || !Array.isArray(snapshot.serialUnits) || !snapshot.serialUnits.length) {
      return res.json({ uploadedAt: snapshot?.uploadedAt || null, sourceFile: snapshot?.sourceFile || "", units: [], note: "The latest inventory upload predates per-unit detail — re-upload the ExportModel report." });
    }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
    const todayMs = new Date(today + "T00:00:00Z").getTime();
    const tickets = snapshot.serialUnits.map((u) => u.writtenTo).filter(Boolean);
    const [openOrders, finishedOrders, openMeta] = await Promise.all([
      getOpenOrdersByInvoices(tickets).catch(() => ({})),
      getOrdersByInvoices(tickets),
      getOpenOrdersMeta().catch(() => null)
    ]);
    const units = snapshot.serialUnits.map((u) => {
      const key = String(u.writtenTo || "").toUpperCase();
      const order = u.writtenTo ? openOrders[key] || finishedOrders[key] || null : null;
      const ageDays = /^\d{4}-\d{2}-\d{2}$/.test(u.received)
        ? Math.max(0, Math.round((todayMs - new Date(u.received + "T00:00:00Z").getTime()) / 86400000))
        : null;
      return {
        serial: u.serial, model: u.model || u.sku, brand: u.brand, description: u.description,
        prod: u.prod, serialType: u.serialType, received: u.received, ageDays,
        cost: u.cost, list: u.list,
        writtenTo: u.writtenTo || "",
        salesperson: order?.salesperson || "",
        salespersonCode: order?.salespersonCode || "",
        orderCustomer: order?.customerName || "",
        orderKnown: Boolean(order)
      };
    });
    return res.json({ uploadedAt: snapshot.uploadedAt, sourceFile: snapshot.sourceFile, openOrders: openMeta, units });
  } catch (err) {
    console.error("Aging inventory failed:", err.message);
    return res.status(500).json({ error: "Unable to build the aging report." });
  }
});

app.get("/api/service-orders", requirePagePermission("/service-order-health.html"), async (req, res) => {
  try {
    const snapshot = await getServiceOrderSnapshot();
    const cards = {};
    if (snapshot?.rows?.length) {
      const index = await buildServiceCardMatchIndex();
      for (const row of snapshot.rows) {
        for (const key of erpInvoiceMatchKeys(row.invoice)) {
          const match = index.get(key);
          if (match) { cards[row.invoice] = match; break; }
        }
      }
    }
    return res.json({ snapshot, cards });
  } catch (err) {
    console.error("Service orders load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the service order snapshot." });
  }
});

app.post("/api/service-orders", requirePagePermission("/service-order-health.html"), async (req, res) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "No ticket rows found in the upload." });
    }
    if (rows.length > 20000) {
      return res.status(400).json({ error: "That upload has too many rows." });
    }

    const cleanText = (value, max = 200) => String(value == null ? "" : value).trim().slice(0, max);
    const cleanNumber = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const cleanDate = (value) => {
      const s = String(value || "").trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
    };

    const normalized = rows
      .map((row) => ({
        invType: cleanText(row.invType, 10).toUpperCase(),
        invoice: cleanText(row.invoice, 40),
        sp: cleanText(row.sp, 20),
        userCreated: cleanText(row.userCreated, 20),
        dateCreated: cleanDate(row.dateCreated),
        paymentType: cleanText(row.paymentType, 20),
        balance: cleanNumber(row.balance),
        total: cleanNumber(row.total),
        status: cleanText(row.status, 40),
        pickupDate: cleanDate(row.pickupDate),
        schedDate: cleanDate(row.schedDate),
        route: cleanText(row.route, 20),
        jobStatus: cleanText(row.jobStatus, 30),
        customerNumber: cleanText(row.customerNumber, 40),
        name: cleanText(row.name, 120),
        address: cleanText(row.address, 160),
        zip: cleanText(row.zip, 20),
        po: cleanText(row.po, 60),
        reference: cleanText(row.reference, 120)
      }))
      .filter((row) => row.invoice);

    if (!normalized.length) {
      return res.status(400).json({ error: "No rows with an invoice number found — is this the right export?" });
    }

    const snapshot = await saveServiceOrderSnapshot({
      rows: normalized,
      filename: String(req.body?.filename || "").slice(0, 200),
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });

    let flagCounts = null;
    try {
      flagCounts = await pushServiceOrderHealthFlags(normalized);
    } catch (flagErr) {
      console.error("Service order flag routing failed:", flagErr.message);
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "service_orders_uploaded", targetUserId: null,
      detail: { rows: normalized.length, filename: snapshot.filename, flags: flagCounts }
    }).catch(() => {});

    return res.json({ ok: true, snapshot, flags: flagCounts });
  } catch (err) {
    console.error("Service orders upload failed:", err.message);
    return res.status(500).json({ error: "Unable to store the service order snapshot." });
  }
});

// INTERNAL: "My Order Flags" queue on the user dashboard — the caller's
// flagged sales orders, matched by their employee code from the directory
// (account email → code). Flags themselves are computed client-side with the
// same shared rules the health report uses.
app.get("/api/sales-orders/mine", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const entry = await findEmployeeDirectoryEntryByEmail(email);
    if (!entry?.code) {
      return res.json({ code: null, rows: [], dismissals: [], uploadedAt: null });
    }

    const snapshot = await getSalesOrderSnapshot();
    const code = String(entry.code).toUpperCase();
    const rows = (snapshot?.rows || []).filter(
      (row) => String(row.sp || "").trim().toUpperCase() === code
    );
    const dismissals = await listOrderFlagDismissals(email);

    return res.json({ code, rows, dismissals, uploadedAt: snapshot?.uploadedAt || null });
  } catch (err) {
    console.error("My order flags failed:", err.message);
    return res.status(500).json({ error: "Unable to load your order flags." });
  }
});

app.post("/api/sales-orders/dismiss", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const invoice = String(req.body?.invoice || "").trim();
    if (!email || !invoice) {
      return res.status(400).json({ error: "Missing invoice." });
    }
    const signature = String(req.body?.signature || "");

    await dismissOrderFlag({ userEmail: email, invoice, signature });

    // Append a flag-instance record (RFI-…/YFI-…) so closed fixes can be
    // inspected on the Sales Order Health Report page. The order row is
    // snapshotted from the stored report, not trusted from the client.
    let token = null;
    try {
      const snapshot = await getSalesOrderSnapshot();
      const orderRow = (snapshot?.rows || []).find(
        (row) => String(row.invoice || "").trim() === invoice
      );
      const severity = req.body?.severity === "red" ? "red" : "yellow";
      const flags = Array.isArray(req.body?.flags)
        ? req.body.flags
            .slice(0, 20)
            .map((f) => ({
              level: f?.level === "red" ? "red" : "yellow",
              text: String(f?.text || "").slice(0, 120)
            }))
        : [];
      token = await recordFlagClosure({
        severity,
        invoice,
        signature,
        flags,
        orderSnapshot: orderRow || {},
        byEmail: email,
        byName: req.authUser?.displayName || "",
        // Tie the instance to the report version it was closed against.
        reportUploadedAt: snapshot?.uploadedAt || null,
        reportFilename: snapshot?.filename || ""
      });
    } catch (logErr) {
      // The close itself succeeded — don't fail the user over the log.
      console.error("Flag closure log failed:", logErr.message);
    }

    return res.json({ ok: true, token });
  } catch (err) {
    console.error("Order flag dismiss failed:", err.message);
    return res.status(500).json({ error: "Unable to close that flag." });
  }
});

// INTERNAL: My Notifications — pushed items (company news, supervisor
// actions) for the signed-in user. Order flags ride alongside these on the
// dashboard via /api/sales-orders/mine.
app.get("/api/notifications/mine", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const notifications = await listMyPushedNotifications(email);
    return res.json({ notifications });
  } catch (err) {
    console.error("Notifications load failed:", err.message);
    return res.status(500).json({ error: "Unable to load notifications." });
  }
});

// Closing a pushed notification mints a token (NFI/GFI/YFI/RFI by severity)
// into the closure log — which doubles as the read receipt supervisors can
// inspect on the Notification Closure Report.
app.post("/api/notifications/:id/close", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const notification = await getPushedNotification(req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    if (notification.audienceEmail && notification.audienceEmail !== email) {
      return res.status(403).json({ error: "That notification isn't addressed to you." });
    }

    const token = await recordFlagClosure({
      severity: notification.severity,
      invoice: "",
      signature: `notification:${notification.id}`,
      flags: [{ level: notification.severity, text: notification.typeLabel }],
      orderSnapshot: {},
      byEmail: email,
      byName: req.authUser?.displayName || "",
      kind: "notification",
      refId: String(notification.id),
      title: notification.title
    });

    // A claimed lead the claimer closes is done — retire the whole ref
    // group so the hidden copies don't linger for anyone else.
    if (notification.claimable && notification.refId && notification.claimedByEmail === email) {
      retirePushedNotificationsByRef(notification.refId).catch(() => {});
    }

    return res.json({ ok: true, token });
  } catch (err) {
    console.error("Notification close failed:", err.message);
    return res.status(500).json({ error: "Unable to close that notification." });
  }
});

// Claim a claimable notification (e.g. a Service Client Lead): the lead
// stays on the claimer's dashboard and disappears from everyone else's.
// First claim wins.
app.post("/api/notifications/:id/claim", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const notification = await getPushedNotification(req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    if (!notification.claimable || !notification.refId) return res.status(400).json({ error: "That notification isn't claimable." });
    if (notification.audienceEmail && notification.audienceEmail !== email) {
      return res.status(403).json({ error: "That notification isn't addressed to you." });
    }
    if (notification.claimedByEmail === email) return res.json({ ok: true, alreadyYours: true });
    if (notification.claimedByEmail) {
      return res.status(409).json({ error: `Already claimed by ${notification.claimedByName || notification.claimedByEmail}.` });
    }
    const count = await claimPushedNotificationsByRef(notification.refId, email, req.authUser?.displayName || "");
    if (!count) {
      const again = await getPushedNotification(req.params.id);
      return res.status(409).json({ error: `Already claimed by ${again?.claimedByName || again?.claimedByEmail || "someone else"}.` });
    }
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "notification_claimed", targetUserId: null,
      detail: { refId: notification.refId, title: notification.title }
    }).catch(() => {});

    // Service client lead claimed → drop a context note into the customer's
    // Podium thread as the claimer and route the conversation to their
    // queue. Best-effort: a Podium hiccup never blocks the claim.
    if (notification.refId.startsWith("svlead:") && podiumOAuthConfigured()) {
      (async () => {
        try {
          if (!(await podiumConnected())) return;
          const estimate = await getServiceEstimateByToken(notification.refId.slice("svlead:".length));
          if (!estimate?.contactPhone) return;
          const s = estimate.summary || {};
          const appliance = [[s.brand, s.product].filter(Boolean).join(" "), s.model ? `model ${s.model}` : ""].filter(Boolean).join(", ");
          const r = estimate.response || {};
          const prefText = { call: "prefers a call", text: "prefers text", email: "prefers email" }[estimate.contactPref] || "";
          const claimerName = req.authUser?.displayName || email;
          const note = [
            `Claimed the service client lead in Agility (${estimate.svNumber || "service"}).`,
            appliance ? `Replacing: ${appliance}.` : "",
            `Repair estimate was $${Number(s.invoiceTotal || 0).toFixed(2)} — client chose to shop instead.`,
            r.notes ? `Client notes: "${r.notes}"` : "",
            prefText ? `Contact preference: ${prefText}.` : ""
          ].filter(Boolean).join(" ");
          const result = await podiumNoteAndAssign({ phone: estimate.contactPhone, note, senderName: claimerName, assigneeEmail: email });
          if (!result.ok) console.error("Podium lead note skipped:", result.error);
        } catch (err) {
          console.error("Podium lead note failed:", err.message);
        }
      })();
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Notification claim failed:", err.message);
    return res.status(500).json({ error: "Unable to claim that lead." });
  }
});

// Release a claim made in error — the lead goes back into the pool and
// reappears on every consultant's dashboard.
app.post("/api/notifications/:id/unclaim", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const email = String(req.authUser?.email || req.authUser?.username || "").trim().toLowerCase();
    const notification = await getPushedNotification(req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    if (notification.claimedByEmail !== email) {
      return res.status(403).json({ error: "Only the person who claimed this can release it." });
    }
    await unclaimPushedNotificationsByRef(notification.refId, email);
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "notification_unclaimed", targetUserId: null,
      detail: { refId: notification.refId, title: notification.title }
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("Notification unclaim failed:", err.message);
    return res.status(500).json({ error: "Unable to release that claim." });
  }
});

// Executives can push a notification to one user or everyone. (Management UI
// comes later; this endpoint is the foundation.)
app.post("/api/notifications", requireExecutiveApi, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "A title is required." });
    const severity = String(req.body?.severity || "neutral");
    if (!["neutral", "green", "yellow", "red"].includes(severity)) {
      return res.status(400).json({ error: "Severity must be neutral, green, yellow, or red." });
    }

    const notification = await createPushedNotification({
      severity,
      typeLabel: req.body?.typeLabel,
      title,
      body: req.body?.body,
      audienceEmail: req.body?.audienceEmail,
      byEmail: req.authUser?.email || req.authUser?.username || "",
      byName: req.authUser?.displayName || ""
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "notification_pushed", targetUserId: null,
      detail: { id: notification.id, severity, title, audience: notification.audienceEmail || "all" }
    }).catch(() => {});

    return res.json({ ok: true, notification });
  } catch (err) {
    console.error("Notification push failed:", err.message);
    return res.status(500).json({ error: "Unable to push the notification." });
  }
});

// Closed-flag history for inspection on the Sales Order Health Report page.
app.get("/api/sales-orders/closures", requirePagePermission("/sales-order-health.html"), async (req, res) => {
  try {
    const closures = await listFlagClosures();
    return res.json({ closures });
  } catch (err) {
    console.error("Flag closures load failed:", err.message);
    return res.status(500).json({ error: "Unable to load the closed flag log." });
  }
});

// INTERNAL: Notification Closure Report (flag-closures.html) — date-ranged view
// of every flag-instance close, for auditing that closed flags were actually
// fixed on the ePASS order.
app.get("/api/flag-closures", requirePagePermission("/flag-closures.html"), async (req, res) => {
  try {
    const start = String(req.query.start || "").trim();
    const end = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: "Provide start and end dates (YYYY-MM-DD)." });
    }
    if (end < start) {
      return res.status(400).json({ error: "End date is before start date." });
    }
    const closures = await listFlagClosuresRange({ start, end });
    return res.json({ closures });
  } catch (err) {
    console.error("Instance closure report failed:", err.message);
    return res.status(500).json({ error: "Unable to load the closure report." });
  }
});

// INTERNAL: Builder Credit Applications admin (credit-applications.html) —
// tokens and saved answers for complete and partially complete applications.
app.get("/api/credit-applications", requirePagePermission("/credit-applications.html"), async (req, res) => {
  try {
    const applications = await listCreditApplications();
    return res.json({ applications });
  } catch (err) {
    console.error("Credit applications list failed:", err.message);
    return res.status(500).json({ error: "Unable to load credit applications." });
  }
});

app.get("/api/credit-applications/:token", requirePagePermission("/credit-applications.html"), async (req, res) => {
  try {
    const token = normalizeCreditAppToken(req.params.token);
    if (!token) return res.status(400).json({ error: "Bad application code." });
    const application = await getCreditApplication(token);
    if (!application) return res.status(404).json({ error: "Application not found." });
    return res.json({ application });
  } catch (err) {
    console.error("Credit application detail failed:", err.message);
    return res.status(500).json({ error: "Unable to load the application." });
  }
});

// Approve (with a credit line) or decline (with a reason) a submitted
// application. Anyone with the page grant can decide; the latest decision
// wins so a mistaken click can be corrected.
app.post("/api/credit-applications/:token/decision", requirePagePermission("/credit-applications.html"), async (req, res) => {
  try {
    const token = normalizeCreditAppToken(req.params.token);
    if (!token) return res.status(400).json({ error: "Bad application code." });

    const decision = String(req.body?.decision || "");
    let creditLine = String(req.body?.creditLine || "").trim();
    const reason = String(req.body?.reason || "").trim();

    if (decision === "approved") {
      if (!creditLine) return res.status(400).json({ error: "Enter the approved credit line." });
      // Normalize to whole dollars with a dollar sign, however it was typed.
      const amount = Number(creditLine.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Enter a valid dollar amount for the credit line." });
      }
      creditLine = "$" + Math.round(amount).toLocaleString("en-US");
    } else if (decision === "declined") {
      if (!reason) return res.status(400).json({ error: "Enter a reason for the decline." });
    } else {
      return res.status(400).json({ error: "Bad decision." });
    }

    const application = await recordCreditDecision({
      token,
      decision,
      creditLine: decision === "approved" ? creditLine : "",
      reason: decision === "declined" ? reason : "",
      byName: req.authUser?.displayName || req.authUser?.username || ""
    });
    if (!application) {
      return res.status(404).json({ error: "Only submitted applications can be approved or declined." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: decision === "approved" ? "credit_application_approved" : "credit_application_declined",
      targetUserId: null,
      detail: { token, creditLine, reason }
    }).catch(() => {});

    return res.json({ ok: true, application });
  } catch (err) {
    console.error("Credit application decision failed:", err.message);
    return res.status(500).json({ error: "Unable to record the decision." });
  }
});

// Email the applicant the result of the decision — the user confirms the
// destination address first, like a card receipt.
app.post("/api/credit-applications/:token/email-result", requirePagePermission("/credit-applications.html"), async (req, res) => {
  try {
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured." });
    }

    const token = normalizeCreditAppToken(req.params.token);
    if (!token) return res.status(400).json({ error: "Bad application code." });

    const email = String(req.body?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const application = await getCreditApplication(token);
    if (!application) return res.status(404).json({ error: "Application not found." });
    if (!application.decision) {
      return res.status(400).json({ error: "Approve or decline the application before emailing the result." });
    }

    const esc = (value) => String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const company = application.data?.step1?.company || {};
    const legalName = company.legalName || application.legalName || "your company";
    const contactFirst = String(company.contactName || application.contactName || "").trim().split(/\s+/)[0] || "there";
    const termsUrl = `${getServiceBaseUrl(req)}/builder-credit-terms.pdf`;
    const senderName = String(req.authUser?.displayName || "").trim();
    const termsPdf = getBuilderTermsPdfBase64();

    // Written like a person from accounting would write it — short prose
    // paragraphs, no data tables, no reference codes in the body. The terms
    // ride along as an attachment (with a link fallback if the PDF is ever
    // missing from the deploy). Replies go to whoever clicked Send.
    const p = (text) => `<p style="font-size:14px;line-height:1.55;margin:0 0 16px;">${text}</p>`;
    const signoffHtml = `<p style="font-size:14px;line-height:1.55;margin:0;">Thank you,${senderName ? `<br/>${esc(senderName)}` : ""}<br/>Wilson AC &amp; Appliance Accounting</p>`;
    const signoffText = `Thank you,\n${senderName ? senderName + "\n" : ""}Wilson AC & Appliance Accounting`;

    let subject;
    let bodyHtml;
    let bodyText;
    if (application.decision === "approved") {
      const line = formatCreditLineForDisplay(application.decisionCreditLine);
      subject = `${legalName} Credit App - Wilson AC & Appliance`;
      const termsSentence = termsPdf
        ? "We've attached our credit terms for your records, which cover payment, deposits, and ordering."
        : `Our credit terms, which cover payment, deposits, and ordering, are here for your records: ${termsUrl}`;
      const para1 = `We received your credit application and wanted to let you know that it has been approved, and your account has been set up with a ${line} limit on net 30 terms. As we continue to work together, we're happy to revisit the limit if your needs grow.`;
      const para2 = `${termsSentence} Please don't hesitate to contact us with any questions as we get started. Glad to have you on board and we look forward to working with you!`;
      bodyHtml = p(`Hi ${esc(contactFirst)},`) + p(esc(para1)) + p(esc(para2)) + signoffHtml;
      bodyText = `Hi ${contactFirst},\n\n${para1}\n\n${para2}\n\n${signoffText}`;
    } else {
      subject = `${legalName} Credit App - Wilson AC & Appliance`;
      const para1 = `Thank you for applying for a trade account for ${legalName} — we appreciate you thinking of us. After reviewing the application, we aren't able to extend credit terms right now.`;
      const reasonPara = String(application.decisionReason || "").trim();
      const para2 = `We'd still love to work with you. Purchases are always welcome on standard payment at the time of sale, and you're welcome to reapply down the road as things change. If any of this raises questions, just reply — this email comes straight to us.`;
      bodyHtml = p(`Hi ${esc(contactFirst)},`) + p(esc(para1)) + (reasonPara ? p(esc(reasonPara)) : "") + p(esc(para2)) + signoffHtml;
      bodyText = `Hi ${contactFirst},\n\n${para1}\n\n${reasonPara ? reasonPara + "\n\n" : ""}${para2}\n\n${signoffText}`;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [email],
        // Replies go to the accounting person who clicked Send; the shared
        // accounting inbox stays the fallback for sessions without an email.
        reply_to: userReplyTo(req) || "accounting@wilsonappliance.com",
        subject,
        text: bodyText,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:600px;">${bodyHtml}</div>`,
        ...(application.decision === "approved" && termsPdf
          ? { attachments: [{ filename: "builder-credit-terms.pdf", content: termsPdf }] }
          : {})
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Credit result email failed:", response.status, errorText);
      return res.status(502).json({ error: "The email couldn't be sent just now — please try again." });
    }

    const updated = await recordResultEmail({ token, email });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "credit_application_result_emailed", targetUserId: null,
      detail: { token, email, decision: application.decision }
    }).catch(() => {});

    return res.json({ ok: true, application: updated });
  } catch (err) {
    console.error("Credit result email failed:", err.message);
    return res.status(500).json({ error: "Unable to send the result email." });
  }
});

app.post("/api/credit-applications/:token/delete", requireExecutiveApi, async (req, res) => {
  try {
    const token = normalizeCreditAppToken(req.params.token);
    if (!token) return res.status(400).json({ error: "Bad application code." });
    const removed = await deleteCreditApplication(token);
    if (!removed) return res.status(404).json({ error: "Application not found." });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "credit_application_deleted", targetUserId: null,
      detail: { token }
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error("Credit application delete failed:", err.message);
    return res.status(500).json({ error: "Unable to delete the application." });
  }
});

// On-behalf contact sub-objects from the public form: keep only the expected
// string fields, and drop the object entirely if every field is blank.
function sanitizeOnBehalfContact(raw, fields) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  let any = false;
  for (const field of fields) {
    const value = String(raw[field] == null ? "" : raw[field]).trim().slice(0, 200);
    out[field] = value;
    if (value) any = true;
  }
  return any ? out : null;
}

// ---------------------------------------------------------------------------
// Terms & Conditions signatures. The PUBLIC form (terms-sign.html, direct
// URL only) and the INTERNAL capture page (terms-signatures.html) both post
// here; authed submissions record as internal captures with the staff email.
// Replaces the FormSite terms form.
// ---------------------------------------------------------------------------
app.post("/api/terms/sign", async (req, res) => {
  try {
    const record = await saveTermsSignature({
      name: req.body?.name,
      signature: req.body?.signature,
      source: req.authUser ? "internal" : "public",
      capturedBy: req.authUser ? (req.authUser.email || req.authUser.username || "") : "",
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] || "")
    });

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "terms_signature_captured", targetUserId: null,
      detail: { name: record.name, source: record.source, termsVersion: TERMS_VERSION }
    }).catch(() => {});

    return res.json({ success: true, id: record.id, signedAt: record.signedAt });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Unable to save the signature." });
  }
});

app.get("/api/terms-signatures", requirePagePermission("/terms-signatures.html"), async (req, res) => {
  try {
    const rows = await listTermsSignatures({ search: req.query.search, limit: req.query.limit });
    return res.json({ rows, termsVersion: TERMS_VERSION });
  } catch (err) {
    console.error("Terms signatures list failed:", err.message);
    return res.status(500).json({ error: "Unable to load signatures." });
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

    // Tenant/manager sub-answers only persist alongside their parent checkbox;
    // the repair-contact override only when the tenant is NOT the primary contact.
    const tenantIsPrimaryContact = serviceRequest.onBehalfOfTenant
      ? (serviceRequest.tenantIsPrimaryContact === "No" ? "No" : "Yes")
      : "";
    const repairContact = tenantIsPrimaryContact === "No"
      ? sanitizeOnBehalfContact(serviceRequest.repairContact, ["name", "phone", "email"])
      : null;
    const managerIsPrimaryContact = serviceRequest.onBehalfManagement
      ? (serviceRequest.managerIsPrimaryContact === "No" ? "No" : "Yes")
      : "";
    const managerContact = managerIsPrimaryContact === "Yes"
      ? sanitizeOnBehalfContact(serviceRequest.managerContact, ["name", "jobTitle", "phone", "email"])
      : null;

    const serviceCards = await readServiceCards();
    const explicitExistingId =
      existingServiceCardId || serviceRequest.existingServiceCardId || "";

    // Client-side lifecycle events land in the audit trail (actor null = the
    // public service site, not a signed-in team member).
    const auditServiceSubmit = (action, row) => {
      recordAudit({
        ip: req.ip,
        actorUserId: null,
        action,
        targetUserId: null,
        detail: {
          serviceCardId: row?.id || "",
          customerName: row?.customerName || "",
          customerPhone: row?.customerPhone || ""
        }
      }).catch(() => {});
    };

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
          onBehalfOfTenant: !!serviceRequest.onBehalfOfTenant,
          tenantIsPrimaryContact,
          repairContact,
          onBehalfManagement: !!serviceRequest.onBehalfManagement,
          managerIsPrimaryContact,
          managerContact,
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

        auditServiceSubmit("service_request_resubmitted", serviceCards[existingByIdIndex]);

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
          onBehalfOfTenant: !!serviceRequest.onBehalfOfTenant,
          tenantIsPrimaryContact,
          repairContact,
          onBehalfManagement: !!serviceRequest.onBehalfManagement,
          managerIsPrimaryContact,
          managerContact,
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

        auditServiceSubmit("service_request_resubmitted", serviceCards[existingByIdIndex]);

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
      onBehalfOfTenant: !!serviceRequest.onBehalfOfTenant,
      tenantIsPrimaryContact,
      repairContact,
      onBehalfManagement: !!serviceRequest.onBehalfManagement,
      managerIsPrimaryContact,
      managerContact,
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

    auditServiceSubmit("service_request_submitted", serviceCards[0]);

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

      // Internal Podium note on the client's thread — phone comes from the
      // Stripe customer the saved card is attached to. Fire-and-forget.
      (async () => {
        let phone = "";
        try {
          const customer = await stripe.customers.retrieve(customerId);
          phone = customer?.phone || "";
        } catch { /* no phone — note skipped */ }
        await addPodiumPaymentNote({
          id: `cof:${paymentIntent.id}`,
          type: "card_on_file",
          customerPhone: phone,
          customerName: customerName || "",
          paidAmount: (paymentIntent.amount || 0) / 100,
          salesOrder: salesOrder || ""
        });
      })().catch((noteErr) => console.error("Card-on-file Podium note failed:", noteErr.message));
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
      "Awaiting SetupIntent",
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

    // Field-level diff so a Save that changes nothing doesn't rewrite the row
    // (a no-op Save used to bump "Updated" and make old calls look freshly
    // touched) and so the audit trail records exactly what changed.
    const before = serviceCards[index];
    const changes = {};
    if ((before.queueStatus || "Call Status Pending") !== queueStatus) {
      changes.queueStatus = { from: before.queueStatus || "Call Status Pending", to: queueStatus };
    }
    if ((before.queueStatusNotes || "") !== queueStatusNotes) {
      changes.queueStatusNotes = { from: before.queueStatusNotes || "", to: queueStatusNotes };
    }
    if ((before.erpOrderNumber || "") !== erpOrderNumber) {
      changes.erpOrderNumber = { from: before.erpOrderNumber || "", to: erpOrderNumber };
    }

    if (Object.keys(changes).length === 0) {
      return res.json({ success: true, unchanged: true, row: before });
    }

    serviceCards[index] = {
      ...before,
      queueStatus,
      queueStatusNotes,
      erpOrderNumber,
      updatedAt: new Date().toISOString(),
      updatedBy: req.authUser?.displayName || req.authUser?.email || "",
      updatedByEmail: req.authUser?.email || ""
    };

    await writeServiceCards(serviceCards);

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser?.id || null,
      action: "service_request_saved",
      targetUserId: null,
      detail: {
        serviceCardId: id,
        customerName: before.customerName || "",
        erpOrderNumber: erpOrderNumber || before.erpOrderNumber || "",
        changes
      }
    }).catch(() => {});

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
    const refundEvents = await listRefundEvents().catch(() => []);

    const normalizedTerminalPayments = terminalPayments.map((row) => ({
      ...row,
      type: row.type || "terminal",
      reference: row.reference || row.description || row.salesOrder || "",
      status: row.status || "paid",
      active: false
    }));

    const normalizedLinks = links.map((row) => normalizeLinkRecord({ ...row }));

    // Refunds issued in Agility ride Paid History as negative rows with
    // their own receipt actions (refund receipt PDF/email).
    const refundRows = refundEvents.map((event) => ({
      type: "refund",
      status: "refunded",
      active: false,
      refundId: event.refundId,
      paymentIntentId: event.paymentIntentId,
      customerName: event.customerName,
      customerEmail: event.customerEmail,
      creatorCode: event.creatorCode,
      creatorName: event.refundedByName || event.creatorName,
      salesOrder: event.salesOrder,
      description: event.description,
      reference: [event.salesOrder, event.description].filter(Boolean).join(" | ") || event.paymentIntentId,
      cardBrand: event.cardBrand,
      last4: event.last4,
      paidAmount: -Math.abs(event.amount),
      paidDate: event.createdAt,
      createdAt: event.createdAt
    }));

    const combinedRows = [...normalizedTerminalPayments, ...normalizedLinks, ...refundRows].sort((a, b) => {
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

// ---------------------------------------------------------------------------
// Emailed credit card receipts (Paid History -> Email Receipt)
// ---------------------------------------------------------------------------

// Builder & Trade credit terms PDF, attached to approval result emails.
let builderTermsPdfCache = null;
function getBuilderTermsPdfBase64() {
  if (builderTermsPdfCache === null) {
    try {
      builderTermsPdfCache = fs.readFileSync(path.join(__dirname, "builder-credit-terms.pdf")).toString("base64");
    } catch {
      builderTermsPdfCache = false; // missing from the deploy: fall back to the terms link
    }
  }
  return builderTermsPdfCache || null;
}

let receiptLogoBytes = null;
function getReceiptLogoBytes() {
  if (receiptLogoBytes === null) {
    try {
      receiptLogoBytes = fs.readFileSync(path.join(__dirname, "logo-black.png"));
    } catch {
      receiptLogoBytes = false; // missing logo: render the text header only
    }
  }
  return receiptLogoBytes || null;
}

async function buildReceiptPdf(details) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.12, 0.14, 0.2);
  const muted = rgb(0.42, 0.45, 0.52);
  const line = rgb(0.9, 0.91, 0.94);
  const margin = 64;
  let y = 792 - 68;

  let logoDrawn = false;
  const logoBytes = getReceiptLogoBytes();
  if (logoBytes) {
    try {
      const logo = await doc.embedPng(logoBytes);
      const logoWidth = 150;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      page.drawImage(logo, { x: margin, y: y - logoHeight + 12, width: logoWidth, height: logoHeight });
      y -= logoHeight + 6;
      logoDrawn = true;
    } catch {
      // fall through to the text header
    }
  }

  if (!logoDrawn) {
    page.drawText("Wilson AC & Appliance", { x: margin, y, size: 16, font: helveticaBold, color: ink });
    y -= 18;
  }
  page.drawText("4205 E Hwy 290, Dripping Springs, TX 78620", { x: margin, y, size: 10, font: helvetica, color: muted });
  y -= 15;
  page.drawText("512-894-0907  |  wilsonappliance.com", { x: margin, y, size: 10, font: helvetica, color: muted });

  // Title block on the right (payment receipt by default; refund receipts
  // pass their own title/labels/rows through the same layout).
  const title = details.title || "PAYMENT RECEIPT";
  const titleX = 612 - margin - helveticaBold.widthOfTextAtSize(title, 15);
  page.drawText(title, { x: titleX, y: 792 - 68, size: 15, font: helveticaBold, color: ink });
  page.drawText(details.paidDate, { x: titleX, y: 792 - 86, size: 10, font: helvetica, color: muted });

  y -= 34;
  page.drawLine({ start: { x: margin, y }, end: { x: 612 - margin, y }, thickness: 1, color: line });
  y -= 40;

  // Amount headline
  page.drawText(details.amountLabel || "Amount paid", { x: margin, y, size: 10, font: helvetica, color: muted });
  y -= 26;
  page.drawText(details.amountText, { x: margin, y, size: 26, font: helveticaBold, color: ink });
  if (details.refundedNote) {
    page.drawText(details.refundedNote, { x: margin + helveticaBold.widthOfTextAtSize(details.amountText, 26) + 14, y: y + 4, size: 11, font: helveticaBold, color: rgb(0.6, 0.11, 0.11) });
  }
  y -= 44;

  // Receipt = who collected the payment (not the sales order), so the
  // collecting Wilson user leads the detail rows.
  const rows = (details.detailRows || [
    ["Payment initiated by", details.salesperson],
    ["Payment method", details.methodText],
    ["Customer", details.customerName],
    ["Reference", details.reference],
    ["Payment ID", details.paymentIntentId]
  ]).filter(([, value]) => String(value || "").trim());

  for (const [label, value] of rows) {
    page.drawText(label, { x: margin, y, size: 10, font: helvetica, color: muted });
    const text = String(value);
    page.drawText(text.length > 76 ? `${text.slice(0, 73)}...` : text, { x: margin + 130, y, size: 11, font: helvetica, color: ink });
    y -= 24;
  }

  y -= 12;
  page.drawLine({ start: { x: margin, y }, end: { x: 612 - margin, y }, thickness: 1, color: line });
  y -= 30;
  page.drawText(details.footerTitle || "Thank you for your business!", { x: margin, y, size: 11, font: helveticaBold, color: ink });
  const footerLines = details.footerLines || [
    "Questions about this payment? Call or text Wilson AC & Appliance at 512-894-0907."
  ];
  for (const footerLine of footerLines) {
    y -= 18;
    page.drawText(footerLine, { x: margin, y, size: 10, font: helvetica, color: muted });
  }

  return doc.save();
}

function formatReceiptDate(isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  }).format(date);
}

// Shared by the email and download routes: local record for context, Stripe
// for the truth of what was charged, pdf-lib for the document.
async function buildReceiptForPaymentIntent(paymentIntentId) {
  const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
  const terminalPayments = await readTerminalPayments();
  const record = [...links, ...terminalPayments].find((row) => row.paymentIntentId === paymentIntentId) || {};

  const paymentIntent = await retrievePaymentIntentWithDetailsWithRetry(paymentIntentId);
  const charge = paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === "object"
    ? paymentIntent.latest_charge
    : null;

  if (paymentIntent?.status !== "succeeded" || !charge || charge.status !== "succeeded") {
    const err = new Error("That payment hasn't succeeded in Stripe — there's no receipt to send.");
    err.statusCode = 400;
    throw err;
  }

  const pm = charge.payment_method_details || {};
  const card = pm.card_present || pm.card || null;
  const ach = pm.us_bank_account || null;
  const methodText = card
    ? `${String(card.brand || "Card").replace(/_/g, " ").toUpperCase()} ending in ${card.last4 || "----"}`
    : ach
      ? `Bank transfer (ACH)${ach.last4 ? ` ending in ${ach.last4}` : ""}`
      : String(pm.type || "Card").replace(/_/g, " ");

  const amount = (charge.amount || 0) / 100;
  const amountText = `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const refundedAmount = (charge.amount_refunded || 0) / 100;
  const refundedNote = refundedAmount >= amount && amount > 0
    ? "FULLY REFUNDED"
    : refundedAmount > 0
      ? `PARTIALLY REFUNDED ($${refundedAmount.toFixed(2)})`
      : "";

  const reference = [record.salesOrder, record.description || record.reference]
    .filter(Boolean).join(" | ") || paymentIntent.description || "";
  const customerName = record.customerName || charge.billing_details?.name || "";
  const paidDate = formatReceiptDate(new Date(charge.created * 1000));

  const pdfBytes = await buildReceiptPdf({
    paidDate,
    amountText,
    refundedNote,
    methodText,
    customerName,
    reference,
    salesperson: record.creatorName || "",
    paymentIntentId
  });

  const fileLabel = String(record.salesOrder || paymentIntentId).replace(/[^A-Za-z0-9_-]+/g, "-");
  const customerPhone = String(record.customerPhone || charge.billing_details?.phone || "").replace(/\D/g, "");
  return { pdfBytes, fileLabel, amountText, refundedNote, methodText, reference, customerName, customerPhone, paidDate };
}

// Internal Podium note when a receipt goes out (text or email): the exact
// line the team asked for, signed by whoever clicked Send. No once-guard —
// each send is its own event worth noting. Skips quietly with no thread.
function notePodiumReceiptSent(phone, senderName) {
  (async () => {
    if (!podiumOAuthConfigured() || !(await podiumConnected())) return;
    const digits = String(phone || "").replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) return;
    const convo = await podiumFindConversationByPhone(digits.length === 11 ? digits.slice(1) : digits);
    if (!convo) return;
    await podiumAddConversationNote(convo.uid, "Sent client receipt", senderName || "Agility");
  })().catch((err) => console.error("Receipt Podium note failed:", err.message));
}

app.post("/api/receipts/email", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const paymentIntentId = String(req.body?.paymentIntentId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
      return res.status(400).json({ error: "That record has no valid payment intent." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." });
    }

    const { pdfBytes, fileLabel, amountText, methodText, reference, customerName, customerPhone, paidDate } =
      await buildReceiptForPaymentIntent(paymentIntentId);
    const subject = `Receipt from Wilson AC & Appliance — ${amountText}`;
    const bodyLines = [
      customerName ? `Hi ${customerName},` : "Hello,",
      "",
      `Thank you for your payment of ${amountText} on ${paidDate}.`,
      reference ? `Reference: ${reference}` : "",
      `Payment method: ${methodText}`,
      "",
      "Your receipt is attached as a PDF.",
      "",
      "Wilson AC & Appliance",
      "512-894-0907"
    ].filter((lineText) => lineText !== "");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 560px;">
        <p>${customerName ? `Hi ${escapeHtmlForEmail(customerName)},` : "Hello,"}</p>
        <p>Thank you for your payment of <strong>${escapeHtmlForEmail(amountText)}</strong> on ${escapeHtmlForEmail(paidDate)}.</p>
        <ul>
          ${reference ? `<li><strong>Reference:</strong> ${escapeHtmlForEmail(reference)}</li>` : ""}
          <li><strong>Payment method:</strong> ${escapeHtmlForEmail(methodText)}</li>
        </ul>
        <p>Your receipt is attached as a PDF.</p>
        <p style="color: #6b7280; font-size: 13px;">Wilson AC & Appliance · 512-894-0907</p>
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
        reply_to: userReplyTo(req),
        to: [email],
        subject,
        text: bodyLines.join("\n"),
        html,
        attachments: [{
          filename: `receipt-${fileLabel}.pdf`,
          content: Buffer.from(pdfBytes).toString("base64")
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Receipt email failed:", response.status, errorText);
      return res.status(502).json({ error: "The email service rejected the receipt — try again in a minute." });
    }

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser?.id || null,
      action: "receipt_emailed",
      targetUserId: null,
      detail: { paymentIntentId, to: email, amount: amountText, reference }
    }).catch(() => {});

    notePodiumReceiptSent(customerPhone, req.authUser?.displayName || "");

    return res.json({ success: true });
  } catch (err) {
    console.error("Receipt email error:", err.message);
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Unable to send the receipt. Check the payment intent and try again." });
  }
});

// Text the receipt (Paid History -> Text pill): an SMS receipt summary from
// the showroom number — no PDF over SMS, the text IS the receipt. Explicit
// click only, like everything else.
app.post("/api/receipts/text", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const paymentIntentId = String(req.body?.paymentIntentId || "").trim();
    const overridePhone = String(req.body?.phone || "").replace(/\D/g, "");
    if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
      return res.status(400).json({ error: "That record has no valid payment intent." });
    }
    if (!podiumSendConfigured()) {
      return res.status(503).json({ error: "Texting isn't connected — connect Podium in Text Automations first." });
    }

    const { amountText, methodText, reference, customerName, customerPhone, paidDate } =
      await buildReceiptForPaymentIntent(paymentIntentId);
    const phone = overridePhone || customerPhone;
    if (phone.length !== 10 && !(phone.length === 11 && phone.startsWith("1"))) {
      return res.status(400).json({ error: "Add the client's 10-digit mobile number first." });
    }

    // Tokenized PDF link on the public service host — the same receipt the
    // email attaches, regenerated live from Stripe whenever it's opened.
    let receiptUrl = "";
    try {
      const shareToken = await getOrCreateReceiptToken(paymentIntentId);
      receiptUrl = `${getServiceBaseUrl(req)}/receipt.pdf?r=${shareToken}`;
    } catch (tokenErr) {
      console.error("Receipt link token failed:", tokenErr.message);
    }

    const first = String(customerName || "").trim().split(/\s+/)[0] || "";
    const body =
      `${first ? `Hi ${first}, this` : "This"} is Wilson AC & Appliance. ` +
      `Your receipt: ${amountText} paid ${paidDate}${reference ? ` for ${reference}` : ""} with ${methodText}. ` +
      `${receiptUrl ? `PDF copy: ${receiptUrl} ` : ""}` +
      `Thank you! Questions? Just reply to this text.`;

    const result = await sendCustomerText({ phone, body });
    if (!result.ok) {
      return res.status(502).json({ error: "The text didn't go through — try again or email the receipt instead." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "receipt_texted", targetUserId: null,
      detail: { paymentIntentId, to: phone, amount: amountText, reference, transport: result.transport }
    }).catch(() => {});

    notePodiumReceiptSent(phone, req.authUser?.displayName || "");

    return res.json({ success: true, to: phone });
  } catch (err) {
    console.error("Receipt text error:", err.message);
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: "Unable to send the receipt text." });
  }
});

// PUBLIC (service host): tokenized receipt PDF — the link texted to clients.
// The token is 24 random bytes, one per payment, expiring per
// RECEIPT_LINK_DAYS (365 default). The PDF regenerates from Stripe on each
// open; nothing is stored server-side.
app.get("/receipt.pdf", async (req, res) => {
  try {
    const share = await getReceiptTokenRecord(req.query.r);
    if (!share) {
      return res.status(404).send("This receipt link is no longer available. Call or text Wilson AC & Appliance at 512-894-0907 for a copy.");
    }
    const { pdfBytes, fileLabel } = await buildReceiptForPaymentIntent(share.paymentIntentId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="receipt-${fileLabel}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Public receipt link error:", err.message);
    return res.status(500).send("Unable to load this receipt right now. Call or text Wilson AC & Appliance at 512-894-0907 for a copy.");
  }
});

// Download the same PDF receipt directly (Paid History -> Download pill).
app.get("/api/receipts/:paymentIntentId/pdf", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const paymentIntentId = String(req.params.paymentIntentId || "").trim();
    if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
      return res.status(400).json({ error: "That record has no valid payment intent." });
    }

    const { pdfBytes, fileLabel, amountText, reference } = await buildReceiptForPaymentIntent(paymentIntentId);

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser?.id || null,
      action: "receipt_downloaded",
      targetUserId: null,
      detail: { paymentIntentId, amount: amountText, reference }
    }).catch(() => {});

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${fileLabel}.pdf"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Receipt download error:", err.message);
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "Unable to build the receipt. Check the payment intent and try again." });
  }
});

// ---------------------------------------------------------------------------
// Refund receipts (Paid History). Refunds issued in Agility are recorded in
// refund_events at issue time; Stripe stays the truth for amount/status.
// ---------------------------------------------------------------------------

async function buildReceiptForRefund(refundId) {
  const event = await getRefundEvent(refundId);
  if (!event) {
    const err = new Error("That refund isn't on record here — it may have been issued outside Agility.");
    err.statusCode = 404;
    throw err;
  }

  const refund = await stripe.refunds.retrieve(refundId);
  if (["failed", "canceled"].includes(String(refund?.status || ""))) {
    const err = new Error(`That refund ${refund.status} in Stripe — there's no receipt to send.`);
    err.statusCode = 400;
    throw err;
  }

  const amount = (refund?.amount || 0) / 100 || event.amount;
  const amountText = `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const methodText = event.cardBrand
    ? `${event.cardBrand} ending in ${event.last4 || "----"}`
    : "Original payment method";
  const refundDate = formatReceiptDate(refund?.created ? new Date(refund.created * 1000) : new Date(event.createdAt));
  const reference = [event.salesOrder, event.description].filter(Boolean).join(" | ");

  const pdfBytes = await buildReceiptPdf({
    title: "REFUND RECEIPT",
    amountLabel: "Amount refunded",
    paidDate: refundDate,
    amountText,
    detailRows: [
      ["Refund issued by", event.refundedByName],
      ["Refunded to", methodText],
      ["Customer", event.customerName],
      ["Reference", reference],
      ["Refund ID", refundId],
      ["Original payment", event.paymentIntentId]
    ],
    footerTitle: "Your refund is on its way.",
    footerLines: [
      "Refunds typically appear on your statement within 5-10 business days, depending on your bank.",
      "Questions about this refund? Call or text Wilson AC & Appliance at 512-894-0907."
    ]
  });

  const fileLabel = String(event.salesOrder || refundId).replace(/[^A-Za-z0-9_-]+/g, "-");
  return { pdfBytes, fileLabel, amountText, methodText, reference, customerName: event.customerName, refundDate };
}

app.get("/api/receipts/refund/:refundId/pdf", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const refundId = String(req.params.refundId || "").trim();
    if (!/^re_[A-Za-z0-9]+$/.test(refundId)) {
      return res.status(400).json({ error: "That record has no valid refund id." });
    }
    const { pdfBytes, fileLabel, amountText, reference } = await buildReceiptForRefund(refundId);
    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "refund_receipt_downloaded", targetUserId: null,
      detail: { refundId, amount: amountText, reference }
    }).catch(() => {});
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="refund-receipt-${fileLabel}.pdf"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Refund receipt download error:", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Unable to build the refund receipt." });
  }
});

app.post("/api/receipts/refund-email", requirePagePermission("/dashboard.html"), async (req, res) => {
  try {
    const refundId = String(req.body?.refundId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^re_[A-Za-z0-9]+$/.test(refundId)) {
      return res.status(400).json({ error: "That record has no valid refund id." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
      return res.status(500).json({ error: "Email delivery is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." });
    }

    const { pdfBytes, fileLabel, amountText, methodText, reference, customerName, refundDate } =
      await buildReceiptForRefund(refundId);
    const subject = `Refund receipt from Wilson AC & Appliance — ${amountText}`;
    const bodyLines = [
      customerName ? `Hi ${customerName},` : "Hello,",
      "",
      `We've issued your refund of ${amountText} on ${refundDate}, returned to your ${methodText.toLowerCase()}.`,
      "Refunds typically appear on your statement within 5-10 business days, depending on your bank.",
      reference ? `Reference: ${reference}` : "",
      "",
      "Your refund receipt is attached as a PDF.",
      "",
      "Wilson AC & Appliance",
      "512-894-0907"
    ].filter((lineText) => lineText !== "");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 560px;">
        <p>${customerName ? `Hi ${escapeHtmlForEmail(customerName)},` : "Hello,"}</p>
        <p>We've issued your refund of <strong>${escapeHtmlForEmail(amountText)}</strong> on ${escapeHtmlForEmail(refundDate)},
        returned to your ${escapeHtmlForEmail(methodText.toLowerCase())}. Refunds typically appear on your statement
        within 5&ndash;10 business days, depending on your bank.</p>
        ${reference ? `<p><strong>Reference:</strong> ${escapeHtmlForEmail(reference)}</p>` : ""}
        <p>Your refund receipt is attached as a PDF.</p>
        <p style="color: #6b7280; font-size: 13px;">Wilson AC &amp; Appliance · 512-894-0907</p>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        reply_to: userReplyTo(req),
        to: [email],
        subject,
        text: bodyLines.join("\n"),
        html,
        attachments: [{
          filename: `refund-receipt-${fileLabel}.pdf`,
          content: Buffer.from(pdfBytes).toString("base64")
        }]
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Refund receipt email failed:", response.status, errorText);
      return res.status(502).json({ error: "The email service rejected the receipt — try again in a minute." });
    }

    recordAudit({
      ip: req.ip, actorUserId: req.authUser?.id || null,
      action: "refund_receipt_emailed", targetUserId: null,
      detail: { refundId, to: email, amount: amountText, reference }
    }).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    console.error("Refund receipt email error:", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Unable to send the refund receipt." });
  }
});

// ---------------------------------------------------------------------------
// Client satisfaction survey (Test Modules) — internal pilot of the eventual
// public survey.
// ---------------------------------------------------------------------------

app.post("/api/satisfaction/responses", requirePagePermission("/satisfaction-survey.html"), async (req, res) => {
  try {
    const score = Number(req.body?.score);
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      return res.status(400).json({ error: "Pick a score from 1 to 10." });
    }

    const priority = String(req.body?.priority || "").trim();
    if (!SATISFACTION_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Pick one of the experience options." });
    }

    const saved = await saveSatisfactionResponse({
      score,
      priority,
      source: "internal_test",
      recordedByEmail: req.authUser?.email || ""
    });

    return res.json({ success: true, response: saved });
  } catch (err) {
    console.error("Satisfaction save failed:", err.message);
    return res.status(500).json({ error: "Unable to save the response — try again." });
  }
});

app.get("/api/satisfaction/responses", requirePagePermission("/satisfaction-results.html"), async (req, res) => {
  try {
    const start = String(req.query.start || "").trim();
    const end = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: "start and end dates are required (YYYY-MM-DD)." });
    }

    const responses = await listSatisfactionResponses(start, end, APP_TIMEZONE);
    return res.json({ responses, priorities: SATISFACTION_PRIORITIES });
  } catch (err) {
    console.error("Satisfaction list failed:", err.message);
    return res.status(500).json({ error: "Unable to load survey results." });
  }
});

// Case visit survey (Test Modules — temporary/external pilot).
// Each window asks ONE question and saves on the first tap; passing the id
// back updates the same record when the visitor changes their answer.
app.post("/api/case-visit/responses", requirePagePermission("/case-visit-survey.html"), async (req, res) => {
  try {
    const staffRating = String(req.body?.staffRating || "").trim();
    const progress = String(req.body?.progress || "").trim();
    const id = String(req.body?.id || "").trim();

    if (staffRating && !["sad", "neutral", "happy"].includes(staffRating)) {
      return res.status(400).json({ error: "Pick a face for the security experience." });
    }
    if (progress && !CASE_VISIT_PROGRESS_OPTIONS.includes(progress)) {
      return res.status(400).json({ error: "Pick one of the progress options." });
    }
    if (!staffRating && !progress) {
      return res.status(400).json({ error: "Pick an answer first." });
    }

    let saved;
    if (id) {
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
        return res.status(400).json({ error: "Bad response id." });
      }
      saved = await updateCaseVisitResponse(id, { staffRating: staffRating || null, progress });
      if (!saved) {
        return res.status(404).json({ error: "That response was not found." });
      }
    } else {
      saved = await saveCaseVisitResponse({
        staffRating: staffRating || null,
        progress,
        recordedByEmail: req.authUser?.email || ""
      });
    }

    return res.json({ success: true, response: saved });
  } catch (err) {
    console.error("Case visit save failed:", err.message);
    return res.status(500).json({ error: "Unable to save the response — try again." });
  }
});

app.get("/api/case-visit/responses", requirePagePermission("/case-visit-results.html"), async (req, res) => {
  try {
    const start = String(req.query.start || "").trim();
    const end = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: "start and end dates are required (YYYY-MM-DD)." });
    }

    const responses = await listCaseVisitResponses(start, end, APP_TIMEZONE);
    return res.json({ responses });
  } catch (err) {
    console.error("Case visit list failed:", err.message);
    return res.status(500).json({ error: "Unable to load survey results." });
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

// Structured reason codes for refunds — suggested from the note on the Issue
// Refund page, user-correctable, stored in the refund's metadata so the
// Refund Dashboard doesn't have to guess from free text.
const REFUND_REASON_CODES = new Set([
  "Cancelled order",
  "Return / exchange",
  "Damaged / defective",
  "Price adjustment",
  "Duplicate charge",
  "Delivery / install issue",
  "Service issue",
  "Fraudulent",
  "Other"
]);

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

    const reasonCode = String(req.body?.reasonCode || "").trim();
    const storedReasonCode = REFUND_REASON_CODES.has(reasonCode) ? reasonCode : "";

    // The structured code also drives Stripe's coarse reason enum.
    const stripeReason =
      storedReasonCode === "Duplicate charge" ? "duplicate"
      : storedReasonCode === "Fraudulent" ? "fraudulent"
      : (allowedReasons.has(requestedReason) ? requestedReason : "requested_by_customer");

    const refundConfig = {
      payment_intent: id,
      ...(refundAmountCents === remainingRefundableCents ? {} : { amount: refundAmountCents }),
      reason: stripeReason,
      metadata: {
        refund_note: note.slice(0, 480),
        refund_reason_code: storedReasonCode,
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

    // Record the refund for Paid History + refund receipts. Context comes
    // from the expanded charge and the local link/terminal record; failing
    // to record never fails the refund itself.
    (async () => {
      const pmCard = latestCharge.payment_method_details?.card_present || latestCharge.payment_method_details?.card || {};
      const metadata = paymentIntent.metadata || {};
      let localRecord = {};
      try {
        const links = (await readLinks()).map((row) => normalizeLinkRecord({ ...row }));
        const terminalPayments = await readTerminalPayments();
        localRecord = [...links, ...terminalPayments].find((row) => row.paymentIntentId === id) || {};
      } catch { /* context only */ }
      await recordRefundEvent({
        refundId: refund.id,
        paymentIntentId: id,
        amount: (refund.amount || refundAmountCents) / 100,
        customerName: localRecord.customerName || latestCharge.billing_details?.name || metadata.customer_name || "",
        customerEmail: localRecord.customerEmail || latestCharge.billing_details?.email || "",
        cardBrand: String(pmCard.brand || "").toUpperCase(),
        last4: pmCard.last4 || "",
        salesOrder: localRecord.salesOrder || metadata.sales_order || "",
        description: localRecord.description || localRecord.reference || paymentIntent.description || "",
        reasonCode: storedReasonCode,
        note,
        creatorCode: localRecord.creatorCode || metadata.creator_code || "",
        creatorName: localRecord.creatorName || metadata.creator_name || "",
        refundedByEmail: req.authUser?.email || "",
        refundedByName: req.authUser?.displayName || req.authUser?.username || ""
      });
    })().catch((recordErr) => console.error("Refund event record failed:", recordErr.message));

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
    // App refunds carry the required product/service note and the issuer in
    // metadata — show those, not Stripe's generic reason enum. A refund with
    // no metadata was almost certainly issued directly in the Stripe
    // dashboard (or predates the note requirement).
    const refundNote = String(refund.metadata?.refund_note || "").trim();
    const refundedBy = String(refund.metadata?.refunded_by || "").trim();
    const reasonBits = [];
    if (refundNote) reasonBits.push(refundNote);
    if (refundedBy) reasonBits.push(`by ${refundedBy}`);
    if (!reasonBits.length) {
      reasonBits.push(formatRefundReason(refund.reason) || "Refund created");
      reasonBits.push("no note on file — likely issued directly in Stripe");
    }
    events.push({
      date: new Date(refund.created * 1000).toISOString(),
      label: "Refund",
      amount: -Number((refund.amount || 0) / 100),
      reason: reasonBits.join(" — ")
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

// ---------------------------------------------------------------------------
// Refund Dashboard — refunds in a date range with the refund note (reason),
// who issued it, and the employee code ("sender code") from the original
// payment's metadata as a proxy for the salesperson who sold the ticket.
// ---------------------------------------------------------------------------

app.get("/api/refund-dashboard", requirePagePermission("/refund-dashboard.html"), async (req, res) => {
  try {
    const start = String(req.query.start || "").trim();
    const end = String(req.query.end || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return res.status(400).json({ error: "Provide a valid start and end date (YYYY-MM-DD)." });
    }
    const spanDays = (new Date(end + "T00:00:00Z") - new Date(start + "T00:00:00Z")) / 86400000;
    if (spanDays > 400) {
      return res.status(400).json({ error: "Pick a range of 400 days or less." });
    }

    const rows = [];
    const piCache = new Map(); // several partial refunds can share one PI
    let startingAfter = "";
    let keepLoading = true;

    while (keepLoading) {
      const page = await stripe.refunds.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });
      if (!page.data.length) break;

      for (const refund of page.data) {
        if (!refund?.created) continue;
        const refundIso = new Date(refund.created * 1000).toISOString();
        const dateKey = toTimeZoneDateKey(refundIso, APP_TIMEZONE);
        if (dateKey < start) { keepLoading = false; break; } // list is newest-first
        if (dateKey > end) continue;
        if (["failed", "canceled"].includes(refund.status)) continue;

        let paymentIntent = null;
        const piId = refund.payment_intent || "";
        if (piId) {
          if (piCache.has(piId)) {
            paymentIntent = piCache.get(piId);
          } else {
            try {
              paymentIntent = await stripe.paymentIntents.retrieve(piId);
            } catch (piErr) {
              console.error("Refund dashboard PI retrieve failed:", piId, piErr.message);
              paymentIntent = null;
            }
            piCache.set(piId, paymentIntent);
            await sleep(120); // stay friendly with Stripe rate limits
          }
        }

        const metadata = paymentIntent?.metadata || {};
        rows.push({
          id: refund.id,
          date: refundIso,
          amount: Number(((refund.amount || 0) / 100).toFixed(2)),
          stripeReason: refund.reason || "",
          note: String(refund.metadata?.refund_note || "").trim(),
          reasonCode: String(refund.metadata?.refund_reason_code || "").trim(),
          refundedBy: String(refund.metadata?.refunded_by || "").trim(),
          senderCode: String(metadata.creator_code || "").trim().toUpperCase(),
          senderName: String(metadata.creator_name || "").trim(),
          department: String(metadata.department || "").trim(),
          salesOrder: String(metadata.sales_order || "").trim(),
          customerName: String(metadata.customer_name || "").trim(),
          paymentIntentId: piId
        });
      }

      if (!page.has_more || !keepLoading) break;
      startingAfter = page.data[page.data.length - 1]?.id || "";
      if (!startingAfter) break;
    }

    return res.json({ refunds: rows, start, end });
  } catch (err) {
    console.error("Refund dashboard failed:", err.message);
    return res.status(500).json({ error: "Unable to load refunds from Stripe." });
  }
});

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

    recordAudit({
      ip: req.ip,
      actorUserId: req.authUser?.id || null,
      action: "service_card_link_generated",
      targetUserId: null,
      detail: {
        serviceCardId: id,
        customerName: serviceCards[index].customerName || ""
      }
    }).catch(() => {});

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
        onBehalfOfTenant: !!row.onBehalfOfTenant,
        tenantIsPrimaryContact: row.tenantIsPrimaryContact || "",
        repairContact: row.repairContact || null,
        onBehalfManagement: !!row.onBehalfManagement,
        managerIsPrimaryContact: row.managerIsPrimaryContact || "",
        managerContact: row.managerContact || null,
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
  } else if (normalized.status === "card_saved") {
    normalized.active = false;
    normalized.type = "setup_link";
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

// Card-capture (setup mode) sessions: on completion, pull the saved
// payment method off the SetupIntent, mark the record card_saved, and email
// the rep who sent the link. Expiry promotes sent → viewed like other links.
async function processSetupSessionWebhookEvent(event, session) {
  const links = await readLinks();
  const record = links.find((row) => row.checkoutSessionId === session.id);
  if (!record || record.workflowType !== "card_capture") {
    if (!record) {
      console.warn(`[webhook miss] event=${event.type} setup session=${session.id} (no matching card_capture row)`);
    }
    return;
  }

  if (event.type === "checkout.session.expired") {
    if (record.status === "sent") {
      record.status = "viewed";
      record.active = true;
      record.updatedAt = new Date().toISOString();
      await writeLinks(links);
    }
    return;
  }

  if (event.type !== "checkout.session.completed" || !session.setup_intent) {
    return;
  }

  const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent, { expand: ["payment_method"] });
  if (setupIntent.status !== "succeeded") return;

  const card = setupIntent.payment_method?.card || {};
  record.status = "card_saved";
  record.active = false;
  record.customerId = String(session.customer || record.customerId || "");
  record.paymentMethodId = setupIntent.payment_method?.id || "";
  record.setupIntentId = setupIntent.id;
  record.paymentMethodType = "card";
  record.paymentStatusDetail = card.brand
    ? `Card saved — ${card.brand} ending ${card.last4}`
    : "Card saved";
  record.updatedAt = new Date().toISOString();

  if (!record.paymentNotificationSentAt && record.creatorEmail) {
    try {
      await sendCardCapturedEmail(record, card);
      record.paymentNotificationSentAt = new Date().toISOString();
      record.paymentNotificationError = "";
    } catch (err) {
      record.paymentNotificationError = err.message || "Unable to send card-captured notification.";
    }
  }

  await writeLinks(links);
  console.log(`[webhook] card captured for ${record.salesOrder || record.id} (${record.paymentMethodId})`);
}

async function sendCardCapturedEmail(record, card) {
  const subject = `Card captured — ${record.salesOrder || record.customerName || "sales order"}`;
  const cardBit = card?.brand ? `${card.brand} ending ${card.last4}` : "their card";
  const lines = [
    `${record.customerName || "Your client"} saved ${cardBit} on file for ${record.salesOrder || "the sales order"}. Nothing was charged.`,
    `Charge it when ready from the Charge A Saved Card page — the customer and payment method are in Link Detail Lookup under this sales order.`
  ];
  await sendAuthEmail(
    record.creatorEmail,
    subject,
    lines.join(" "),
    buildAuthEmailHtml(
      "Card captured",
      lines,
      "Open Charge A Saved Card",
      `https://${DASHBOARD_HOST}/charge-saved-card.html`,
      "Sent by the Agility payment tools."
    )
  );
}

// ---------------------------------------------------------------------------
// Stripe event → Podium template texts. Templates are authored in Podium
// (Inbox → Templates) so the team owns the copy without deploys; the env var
// names which template a Stripe event fires. Unset env = feature off.
// Variables filled server-side (Podium's send API doesn't expand them):
//   {{first_name}} {{name}} {{amount}} {{order}}
// One text per link record, ever (customerTextSentAt guard survives webhook
// re-deliveries and manual Sync clicks).
// ---------------------------------------------------------------------------
const PODIUM_TEMPLATE_PAYMENT_RECEIVED = process.env.PODIUM_TEMPLATE_PAYMENT_RECEIVED || "";

// Internal Podium note on the client's thread when a payment lands, so
// whoever opens the conversation sees the money without leaving Podium.
// One note per link record ever (podium_payment_notes guard). Skips quietly
// when Podium isn't connected or the client has no conversation yet.
function paymentMethodLabelForNote(record) {
  if (record.type === "card_on_file") return "Stripe Charge Card on File";
  if (record.workflowType === "hvac_deposit") return "Stripe Deposit Agreement";
  return "Stripe Secure Link";
}

async function addPodiumPaymentNote(record) {
  try {
    if (!podiumOAuthConfigured() || !(await podiumConnected())) return;
    const digits = String(record.customerPhone || "").replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) return;
    if (!(await claimPodiumPaymentNoteOnce(record.id))) return;

    const convo = await podiumFindConversationByPhone(digits.length === 11 ? digits.slice(1) : digits);
    if (!convo) return; // no thread yet — nothing to annotate
    const name = String(record.customerName || "").trim() || "Client";
    const amount = `$${Number(record.paidAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const note = `${name} paid ${amount}${record.salesOrder ? ` for order ${record.salesOrder}` : ""} via ${paymentMethodLabelForNote(record)}.`;
    await podiumAddConversationNote(convo.uid, note, "Agility");
  } catch (err) {
    console.error("Podium payment note failed:", err.message);
  }
}

async function sendPaymentReceivedTemplateText(record) {
  try {
    if (record.customerTextSentAt) return;
    const templateTitle = await resolveAutomationTemplate("payment_received", PODIUM_TEMPLATE_PAYMENT_RECEIVED);
    if (!templateTitle) return;
    if (!podiumOAuthConfigured() || !(await podiumConnected())) return;
    const digits = String(record.customerPhone || "").replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) return;
    const name = String(record.customerName || "").trim();
    const result = await sendPodiumTemplateText({
      phone: digits,
      templateTitle,
      vars: {
        first_name: name.split(/\s+/)[0] || "there",
        name: name || "there",
        amount: `$${Number(record.paidAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        order: record.salesOrder || ""
      },
      fallbackBody: `Wilson AC & Appliance: we received your payment of $${Number(record.paidAmount || 0).toFixed(2)}${record.salesOrder ? ` on order ${record.salesOrder}` : ""}. Thank you!`
    });
    if (result.ok) {
      record.customerTextSentAt = new Date().toISOString();
      if (!result.usedTemplate) console.warn(`Podium template "${templateTitle}" not found — sent the built-in fallback text.`);
    } else {
      console.error("Payment-received text skipped:", result.error);
    }
  } catch (err) {
    console.error("Payment-received text failed:", err.message);
  }
}

async function processCheckoutSessionWebhookEvent(event) {
  const session = event.data?.object;

  // SetupIntent-capture links are Checkout Sessions in setup mode — no
  // payment_link, no money. Matched by session id.
  if (session?.mode === "setup") {
    await processSetupSessionWebhookEvent(event, session);
    return;
  }

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
      await sendPaymentReceivedTemplateText(record);
      await addPodiumPaymentNote(record);
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
    await sendPaymentReceivedTemplateText(record);
      await addPodiumPaymentNote(record);
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
    await sendPaymentReceivedTemplateText(record);
      await addPodiumPaymentNote(record);
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

// Decisions saved before credit-line normalization shipped may hold a raw
// number; re-format at send time so the email always reads "$4,000"-style.
function formatCreditLineForDisplay(value) {
  const raw = String(value || "").trim();
  const amount = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return raw;
  return "$" + Math.round(amount).toLocaleString("en-US");
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

