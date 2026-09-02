> **SUPERSEDED — DO NOT BUILD TO THIS DOCUMENT (flagged 2026-08-24).**
>
> This contract is still at v0.3 and contradicts the rest of the package in two ways:
>
> 1. §11 specifies `POST /api/maintenance/admin/reports`, the office-built report flow.
>    That builder was **retired** in v0.7 — field data is the sole source for health
>    reports (context §25, MERGE_GUIDE §23). Building to §11 would rebuild the thing
>    that was deliberately removed.
> 2. It contains essentially no technician/field endpoints, so the entire v0.5–v0.9
>    field workflow is unrepresented.
>
> Until this file is rewritten to v0.9, treat `assets/store.js` (demo backend),
> `assets/tech-maintenance.js` (field workflow) and `docs/MERGE_GUIDE.md` as
> authoritative instead.

# Wilson Maintenance Portal - Proposed API Contract v0.3

This contract is a production handoff. Browser demo methods in `assets/store.js` should be replaced with authenticated API calls. All prices, plan selection, charge eligibility, scores, and permissions must be recalculated or verified by the server.

## Conventions

- Base path examples use `/api/maintenance`.
- Public enrollment endpoints use an idempotency token.
- Internal endpoints require Wilson authentication and role authorization.
- Money is represented as integer cents in API payloads whenever practical.
- Dates use `YYYY-MM-DD`; timestamps use UTC ISO 8601.
- IDs shown as integers may be UUIDs if the production standard prefers them.

---

## 1. Public plan configuration

### `GET /api/maintenance/public/plans`

Returns only approved public plan data and educational wording.

```json
{
  "version": "2026-08-21",
  "appliance": {
    "standardApplianceAnnualCents": 14995,
    "imucPerVisitCents": 24995,
    "imucDefaultVisitsPerYear": 2,
    "estatePlans": [
      {
        "code": "ESTATE_ANNUAL",
        "name": "Estate Annual",
        "baseAnnualCents": 119500,
        "visitsPerYear": 1,
        "includedAssetCount": 15,
        "additionalAssetCents": 6000
      }
    ]
  },
  "hvac": [
    {
      "code": "HVAC_MAINTENANCE",
      "annualPerSystemCents": 20000,
      "visitsPerYear": 2,
      "filterManagement": false
    },
    {
      "code": "HVAC_FILTER_MANAGEMENT",
      "annualPerSystemCents": 40000,
      "visitsPerYear": 2,
      "filterManagement": true,
      "filterMaterialIncluded": false
    }
  ]
}
```

Do not expose internal margin fields or unpublished plan versions.

---

## 2. Server pricing preview

### `POST /api/maintenance/public/pricing/appliances`

The server returns the trusted comparison and automatic plan decision.

Request:

```json
{
  "requestedPlanCode": "APPLIANCE_SINGLE",
  "assets": [
    {
      "clientAssetId": "draft_1",
      "assetTypeCode": "REFRIGERATOR",
      "quantity": 1
    },
    {
      "clientAssetId": "draft_2",
      "assetTypeCode": "IMUC",
      "quantity": 1,
      "selectedVisitsPerYear": 2
    }
  ]
}
```

Response:

```json
{
  "effectivePlanCode": "APPLIANCE_SINGLE",
  "autoSwitched": false,
  "annualCents": 64985,
  "comparison": {
    "perApplianceCents": 64985,
    "estateAnnualCents": 144495
  },
  "breakdown": [
    {"code": "STANDARD_ASSETS", "quantity": 1, "unitCents": 14995, "totalCents": 14995},
    {"code": "IMUC_FIRST_VISIT", "quantity": 1, "unitCents": 24995, "totalCents": 24995},
    {"code": "IMUC_SECOND_VISIT", "quantity": 1, "unitCents": 24995, "totalCents": 24995}
  ],
  "customReviewRequired": false,
  "pricingVersion": "2026-08-21"
}
```

### `POST /api/maintenance/public/pricing/hvac`

Request:

```json
{
  "planCode": "HVAC_FILTER_MANAGEMENT",
  "systemCount": 2
}
```

Response:

```json
{
  "annualCents": 80000,
  "visitsPerSystemPerYear": 2,
  "filterManagement": true,
  "filterMaterialIncluded": false,
  "pricingVersion": "2026-08-21"
}
```

---

## 3. Stripe payment-method setup

### `POST /api/maintenance/public/payment-setup`

Creates or reuses a pending household/customer and returns a SetupIntent client secret.

Request:

```json
{
  "enrollmentToken": "enr_opaque_token",
  "email": "ellen@example.com",
  "name": "Ellen Reynolds"
}
```

Response:

```json
{
  "setupIntentClientSecret": "seti_..._secret_...",
  "stripeCustomerReference": "opaque-server-reference"
}
```

The browser confirms with Stripe.js. Do not return a secret key.

---

## 4. Public enrollment

### `POST /api/maintenance/public/enrollments`

Headers:

```text
Idempotency-Key: client-generated-uuid
```

Request:

```json
{
  "category": "APPLIANCE",
  "requestedPlanCode": "APPLIANCE_SINGLE",
  "household": {
    "displayName": "Reynolds Estate",
    "address1": "1840 Ridgeview Trail",
    "city": "Austin",
    "stateCode": "TX",
    "postalCode": "78738",
    "accessNotes": "House manager coordinates access."
  },
  "contact": {
    "firstName": "Ellen",
    "lastName": "Reynolds",
    "email": "ellen@example.com",
    "phone": "512-555-0148",
    "preferredContact": "TEXT"
  },
  "assets": [
    {
      "assetTypeCode": "IMUC",
      "brand": "Scotsman",
      "model": "DCE33",
      "locationName": "Wet Bar",
      "selectedVisitsPerYear": 2
    }
  ],
  "paymentSetupIntentId": "seti_...",
  "autoRenewAuthorized": true,
  "scheduledChargeAuthorized": true,
  "termsVersion": "maintenance-2026-08-21",
  "preferredTiming": "March / September"
}
```

Server responsibilities:

1. Validate service area and required fields.
2. Verify SetupIntent succeeded and belongs to the expected Stripe customer.
3. Recalculate the effective plan and amount.
4. Apply automatic Estate Annual crossover.
5. Save household/contact/assets/payment/subscription pricing snapshot.
6. Create plan-year maintenance intervals.
7. Write consent and audit records.
8. Return only the customer's own confirmation data.

Response:

```json
{
  "enrollmentId": 5012,
  "householdReference": "WH-0005012",
  "effectivePlanCode": "ESTATE_ANNUAL",
  "annualCents": 144495,
  "status": "PENDING_REVIEW",
  "nextStep": "Wilson will verify the inventory and contact the household before the first scheduled charge."
}
```

---

## 5. Internal dashboard summary

### `GET /api/maintenance/admin/summary`

```json
{
  "activeHouseholds": 42,
  "visitsDueWithin30Days": 11,
  "overdueVisits": 2,
  "trackedAssets": 417,
  "filtersDueWithin30Days": 18,
  "paymentMethodsReady": 39,
  "openCustomQuotes": 6,
  "healthReportsStored": 98
}
```

---

## 6. Due queue

### `GET /api/maintenance/admin/visits?from=2026-08-21&to=2026-09-20&status=DUE`

Response item:

```json
{
  "visitId": 8801,
  "dueDate": "2026-09-02",
  "householdId": 120,
  "householdName": "Reynolds Estate",
  "city": "Austin",
  "category": "APPLIANCE",
  "planName": "Estate Concierge",
  "intervalLabel": "Spring portfolio visit",
  "assetScope": "All enrolled appliances",
  "chargeCents": 314500,
  "paymentStatus": "READY_TO_CHARGE",
  "cardDisplay": "Visa ending 4288",
  "serviceOrderStatus": "NOT_CREATED",
  "reportRequired": true,
  "filtersDueCount": 2
}
```

---

## 7. Household record

### `GET /api/maintenance/admin/households/{householdId}`

Returns:

- household and contacts,
- assets,
- subscriptions and pricing snapshots,
- payment-profile display status,
- intervals/visits,
- filters,
- health-report summaries,
- activity history.

Never return Stripe client secrets or secret provider payloads.

### `PATCH /api/maintenance/admin/households/{householdId}`

Supports authorized updates to contact, access, preferred timing, and non-financial household fields. Require an optimistic concurrency token such as `updatedAt` or `rowVersion`.

---

## 8. Charge scheduled interval

### `POST /api/maintenance/admin/visits/{visitId}/charge`

Request:

```json
{
  "acknowledgedAmountCents": 24995,
  "officeNote": "House manager confirmed September service."
}
```

The acknowledged amount is for the UI confirmation only. The server loads the trusted amount from the interval/pricing snapshot.

Response:

```json
{
  "visitId": 8801,
  "paymentStatus": "PROCESSING",
  "paymentIntentId": "pi_...",
  "amountCents": 24995
}
```

Possible errors:

- `409 ALREADY_PAID`
- `409 NOT_CHARGEABLE`
- `409 PAYMENT_METHOD_REQUIRED`
- `409 AMOUNT_CHANGED_REVIEW_REQUIRED`
- `422 SUBSCRIPTION_INACTIVE`

Stripe webhook events update the final state.

---

## 9. Generate NetSuite service order

### `POST /api/maintenance/admin/visits/{visitId}/service-order`

Request:

```json
{
  "provider": "NETSUITE",
  "confirmScope": true
}
```

Response while integration is not connected:

```json
{
  "visitId": 8801,
  "serviceOrderStatus": "INTEGRATION_PENDING",
  "message": "NetSuite service-order provider is not enabled."
}
```

Production response:

```json
{
  "visitId": 8801,
  "serviceOrderStatus": "CREATED",
  "provider": "NETSUITE",
  "externalOrderId": "123456",
  "externalOrderNumber": "SO-MAINT-1042"
}
```

The server should prevent duplicates through a visit-level idempotency key.

---

## 10. Filters

### `GET /api/maintenance/admin/filters?dueBefore=2026-09-20`

### `POST /api/maintenance/admin/households/{householdId}/filters`

```json
{
  "assetId": 3201,
  "filterType": "REFRIGERATOR_WATER",
  "partNumber": "4204490",
  "quantity": 1,
  "intervalMonths": 12,
  "coverageCode": "INCLUDED",
  "source": "WILSON",
  "nextDueOn": "2027-08-21"
}
```

### `POST /api/maintenance/admin/filters/{filterId}/replace`

```json
{
  "visitId": 8801,
  "changedOn": "2026-09-02",
  "quantityUsed": 1,
  "unitCostCents": 6995,
  "customerChargeCents": 0
}
```

The server advances the next due date and logs the action.

---

## 11. Appliance health reports

### `GET /api/maintenance/admin/report-templates/{assetTypeCode}`

Returns the active versioned template:

```json
{
  "templateCode": "IMUC_V1",
  "templateVersion": 1,
  "vitals": [
    {"code": "FREEZE_CYCLE_MIN", "label": "Freeze cycle", "unit": "min", "target": "Manufacturer target"}
  ],
  "checkpoints": [
    {"code": "BIN_CONDITION", "category": "Condition & Sanitation", "name": "Bin and interior condition", "weight": 1}
  ],
  "maintenanceTasks": [
    {"code": "DESCALE", "name": "Descale per manufacturer guidance"}
  ]
}
```

### `POST /api/maintenance/admin/reports`

```json
{
  "householdId": 120,
  "assetId": 3201,
  "visitId": 8801,
  "templateCode": "IMUC_V1",
  "templateVersion": 1,
  "inspectionDate": "2026-09-02",
  "technicianName": "Trevor",
  "reference": "SO-MAINT-1042",
  "nextDueOn": "2027-03-02",
  "summary": "The icemaker is operating normally...",
  "recommendations": "Replace the water filter at the next visit.",
  "vitals": [
    {
      "code": "FREEZE_CYCLE_MIN",
      "observedValue": "24",
      "unit": "min",
      "targetText": "Manufacturer target",
      "result": "IN_RANGE",
      "notes": ""
    }
  ],
  "checkpoints": [
    {
      "code": "BIN_CONDITION",
      "category": "Condition & Sanitation",
      "name": "Bin and interior condition",
      "rating": 4,
      "status": "PASS",
      "notes": "Clean after service."
    }
  ],
  "maintenanceTaskCodes": ["DESCALE", "VACUUM_COIL"],
  "correctiveMeasures": ["Replace water filter at next visit"],
  "filterPart": "SCCP5",
  "filterAction": "REPLACEMENT_RECOMMENDED",
  "photoUploadTokens": ["upload-token-1"]
}
```

The server:

- validates the template version,
- calculates score, grade, condition, and category losses,
- saves the full snapshot,
- returns the server score,
- queues final PDF generation.

Response:

```json
{
  "healthReportId": 901,
  "score": 84,
  "grade": "B",
  "condition": "GOOD_MONITOR",
  "status": "DRAFT",
  "pdfStatus": "QUEUED"
}
```

### `POST /api/maintenance/admin/reports/{reportId}/finalize`

Finalized reports become immutable. Corrections should create a revision.

### `GET /api/maintenance/admin/reports/{reportId}/pdf`

Returns an authenticated download or short-lived signed URL.

---

## 12. Custom maintenance quotes

### `POST /api/maintenance/admin/quotes/preview`

```json
{
  "planCode": "ESTATE_CONCIERGE",
  "items": [
    {"assetTypeCode": "REFRIGERATOR", "quantity": 1},
    {"assetTypeCode": "IMUC", "quantity": 2, "selectedVisitsPerYear": 2},
    {"assetTypeCode": "OTHER", "quantity": 17}
  ],
  "manualAdjustmentCents": 0
}
```

Response:

```json
{
  "assetCount": 20,
  "baseCents": 299500,
  "includedAssetCount": 15,
  "additionalAssetCount": 5,
  "additionalAssetUnitCents": 15000,
  "additionalAssetCents": 75000,
  "imucAddOnCount": 0,
  "imucAddOnCents": 0,
  "manualAdjustmentCents": 0,
  "annualTotalCents": 374500,
  "customReviewRequired": false,
  "pricingVersion": "2026-08-21"
}
```

### `POST /api/maintenance/admin/quotes`

Saves the full pricing and item snapshot, contact, address, notes, validity, and terms version.

### `PATCH /api/maintenance/admin/quotes/{quoteId}/status`

```json
{"status": "SENT"}
```

Allowed workflow:

```text
DRAFT -> REVIEW_REQUIRED -> APPROVED -> SENT -> ACCEPTED / DECLINED / EXPIRED
```

Managers may bypass `REVIEW_REQUIRED` only with an audit note.

### `GET /api/maintenance/admin/quotes/{quoteId}/pdf`

Returns the generated proposal PDF.

### `POST /api/maintenance/admin/quotes/{quoteId}/convert-to-enrollment`

Seeds a pending household/enrollment from an accepted quote without discarding the quote snapshot.

---

## 13. Wilson sales-invoice import

### `POST /api/maintenance/admin/invoice-imports/preview`

Authenticated internal multipart upload. Accept all related split PDFs in one request.

```text
Content-Type: multipart/form-data
files: S00063887.pdf
files: S00063887-1.pdf
```

Response shape:

```json
{
  "importBatchId": 481,
  "parserVersion": "wilson-invoice-2026-08-v1",
  "invoiceNumbers": ["S00063887", "S00063887-1"],
  "shipTo": {
    "displayName": "EXAMPLE HOUSEHOLD LLC",
    "phone": "5125550000",
    "address1": "100 EXAMPLE RANCH RD",
    "city": "AUSTIN",
    "stateCode": "TX",
    "postalCode": "78733"
  },
  "items": [
    {
      "importLineId": 9001,
      "sourceAreaName": "APARTMENT",
      "quantity": 1,
      "model": "DW2451",
      "brand": "Cove",
      "description": "24in. Panel Ready Dishwasher...",
      "sourceClassification": "COVE, DISHWASHER, Panel Ready",
      "exactTypeCode": "DISHWASHER",
      "customerCategoryCode": "DISHWASHER",
      "confidenceCode": "HIGH",
      "needsReview": false,
      "include": true
    }
  ],
  "ignoredLines": [
    {"description": "Dishwasher w/Panel Install", "reason": "INSTALLATION"}
  ],
  "warnings": ["Some split-invoice products have no printed area heading."]
}
```

The server must virus-scan and size-limit uploads, store only under the approved retention policy, calculate a SHA-256 hash, record parser version, and never trust browser classification edits without validating them.

### `PATCH /api/maintenance/admin/invoice-imports/{batchId}/lines/{lineId}`

```json
{
  "include": true,
  "areaName": "Main House",
  "quantity": 1,
  "customerCategoryCode": "VENTILATION",
  "reviewNote": "Confirmed main kitchen hood liner"
}
```

### `POST /api/maintenance/admin/invoice-imports/{batchId}/create-enrollment-draft`

Creates or matches the household, creates exact internal asset draft records, and returns a short-lived enrollment handoff token. It must preserve:

- invoice number and import line,
- exact brand/model/serial/type,
- broad customer category,
- source area and user-edited area,
- parser confidence and review state,
- any laundry-center split relationship.

```json
{
  "householdId": 812,
  "draftEnrollmentId": 1055,
  "publicHandoffToken": "short-lived-single-use-token",
  "assetCount": 20,
  "reviewRequired": true
}
```

---

## 14. Subscription cancellation

### `POST /api/maintenance/admin/subscriptions/{subscriptionId}/cancel`

```json
{
  "requestedBy": "CUSTOMER",
  "requestChannel": "PHONE",
  "effectiveDate": "2026-10-01",
  "reason": "Property sold",
  "notes": "Confirmed by house manager."
}
```

The server cancels future eligible intervals according to policy and preserves historical records.

---

## 15. Activity and audit

### `GET /api/maintenance/admin/households/{householdId}/activity`

Every write should record:

- actor ID/display name,
- action type,
- household/subscription/visit/report/quote references,
- timestamp,
- before/after values for important fields,
- request correlation ID,
- safe integration result metadata.

Never place Stripe secrets or sensitive raw provider payloads in the general activity log.
