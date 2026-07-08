// Steel Cod API v1 client (spec packages for appliance sales).
// Built against "Steel Cod API v1 - Doc Version 11" (API version 1.2.84).
//
// Env:
//   STEELCOD_API_KEY  - partner/company API key (request from Steel Cod)
//   STEELCOD_API_BASE - optional override, defaults to https://api.steelcod.com/v1
//
// Every call must carry the email of the authenticated user the request is
// made on behalf of (userEmail). Per the Steel Cod EULA, do NOT use a shared
// service account — pass the signed-in user's real email.

const DEFAULT_API_BASE = "https://api.steelcod.com/v1";

export function isSteelCodConfigured() {
  return Boolean(String(process.env.STEELCOD_API_KEY || "").trim());
}

function getApiKey() {
  return String(process.env.STEELCOD_API_KEY || "").trim();
}

function getApiBase() {
  return String(process.env.STEELCOD_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
}

// Known client error codes → friendlier messages for the UI.
const CLIENT_ERROR_HINTS = {
  1003: "The Steel Cod API key was not recognized.",
  1004: "The Steel Cod API key is not active.",
  1007: "The Wilson company account is not active in Steel Cod.",
  1009: "Your email address is not registered as a Steel Cod user for Wilson. Ask an admin to add you in Steel Cod first.",
  1010: "Your Steel Cod user account is disabled.",
  1011: "At least one model number is required.",
  1012: "Customer name is required.",
  1102: "That spec package ID was not found (use the Steel Cod navId, not the sales order number).",
  1104: "That spec package was already deleted.",
  1401: "This Steel Cod account is a Lite account; the API is not available on it.",
  1402: "The API module is not enabled for Wilson's Steel Cod account. Contact help@steelcod.com."
};

export class SteelCodError extends Error {
  constructor(message, { status = 0, errorCode = null, errorDetails = "", logID = "" } = {}) {
    super(message);
    this.name = "SteelCodError";
    this.status = status;
    this.errorCode = errorCode;
    this.errorDetails = errorDetails;
    this.logID = logID;
  }
}

async function callSteelCod(functionName, payload) {
  if (!isSteelCodConfigured()) {
    throw new SteelCodError("Steel Cod is not configured (missing STEELCOD_API_KEY).", { status: 503 });
  }

  const url = `${getApiBase()}/${functionName}`;
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: getApiKey(), ...payload })
    });
  } catch (err) {
    throw new SteelCodError(`Unable to reach Steel Cod: ${err.message}`, { status: 502 });
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // fall through with null body
  }

  if (response.ok) {
    return body || {};
  }

  if (response.status === 400 && body?.errorCode) {
    const hint = CLIENT_ERROR_HINTS[body.errorCode];
    throw new SteelCodError(
      hint || body.errorMessage || "Steel Cod rejected the request.",
      {
        status: 400,
        errorCode: body.errorCode,
        errorDetails: body.errorDetails || "",
        logID: body.logID || ""
      }
    );
  }

  throw new SteelCodError(
    body?.serverErrorMessage || `Steel Cod error (HTTP ${response.status}).`,
    { status: response.status, logID: body?.logID || "" }
  );
}

// ---------------------------------------------------------------------------
// Public URL helpers — all spec package URLs derive from the base public URL.
// ---------------------------------------------------------------------------

export function buildSpecPackageUrls(publicBaseUrl) {
  const base = String(publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) return null;

  return {
    base,
    open: `${base}/Open`,
    download: `${base}/Download`,
    slimOpen: `${base}/SlimOpen`,
    slimDownload: `${base}/SlimDownload`,
    json: `${base}/Json`,
    ask: `${base}/Ask`,
    // Private (company users only):
    edit: `${base}/Edit`,
    premEdit: `${base}/PremEdit`
  };
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function createSpecPackage({
  userEmail,
  salespersonEmail = "",
  documentID = "",
  emailTo = [],
  customer = null,
  address = null,
  modelNumbers = [],
  title = "",
  subtitle = "",
  documentTypeLabel = ""
}) {
  const payload = {
    userEmail: String(userEmail || "").trim(),
    modelNumbers: (modelNumbers || []).map((m) => String(m).trim()).filter(Boolean)
  };

  if (salespersonEmail) payload.salespersonEmail = String(salespersonEmail).trim();
  if (documentID) payload.documentID = String(documentID).trim();
  if (Array.isArray(emailTo) && emailTo.length) payload.emailTo = emailTo;
  if (customer && customer.name) payload.customer = customer;
  if (address) payload.address = address;
  if (title) payload.title = String(title).trim();
  if (subtitle) payload.subtitle = String(subtitle).trim();
  if (documentTypeLabel) payload.documentTypeLabel = String(documentTypeLabel).trim();

  const result = await callSteelCod("createSpecPackage", payload);
  return {
    ...result,
    urls: buildSpecPackageUrls(result.specPackageUrl)
  };
}

export async function searchSpecPackages({
  userEmail,
  skip = 0,
  title = "",
  createdByUserEmail = "",
  salespersonUserEmail = "",
  documentID = "",
  pii = ""
}) {
  const payload = { userEmail: String(userEmail || "").trim() };

  if (Number(skip) > 0) payload.skip = Number(skip);
  if (title) payload.title = String(title).trim();
  if (createdByUserEmail) payload.createdByUserEmail = String(createdByUserEmail).trim();
  if (salespersonUserEmail) payload.salespersonUserEmail = String(salespersonUserEmail).trim();
  if (documentID) payload.documentID = String(documentID).trim();
  if (pii) payload.pii = String(pii).trim();

  const result = await callSteelCod("searchSpecPackages", payload);

  return {
    ...result,
    specPackages: (result.specPackages || []).map((pkg) => ({
      ...pkg,
      urls: buildSpecPackageUrls(pkg.publicUrl)
    }))
  };
}

export async function retrieveSpecPackage({ userEmail, navId }) {
  return callSteelCod("retrieveSpecPackage", {
    userEmail: String(userEmail || "").trim(),
    navId: String(navId || "").trim()
  });
}

export async function deleteSpecPackage({ userEmail, navId }) {
  return callSteelCod("deleteSpecPackage", {
    userEmail: String(userEmail || "").trim(),
    navId: String(navId || "").trim()
  });
}

export async function retrieveUsers({ userEmail }) {
  return callSteelCod("retrieveUsers", {
    userEmail: String(userEmail || "").trim()
  });
}
