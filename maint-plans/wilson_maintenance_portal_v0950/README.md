
## v0.8 field workflow update

The appliance field-maintenance tool is now optimized around a technician working from a phone. The residence banner is static and high-contrast, the home screen recommends the next appliance, areas show progress, Monitor/Needs Follow-up items stay surfaced, and field entries autosave. The signed-in technician is expected to come from the Wilson internal user session in production; the prototype also accepts a `technician` URL parameter for testing. See `docs/V08_DECISIONS.md`.

# Wilson Maintenance Portal Prototype v0.9.36

A working local prototype for customer maintenance enrollment, internal appliance/HVAC maintenance operations, Wilson sales-invoice import, custom estate proposals, filter tracking, and appliance health reports.

## Run it

### Windows

1. Right-click the ZIP and choose **Extract All**.
2. Open the extracted folder.
3. Double-click **`OPEN_WILSON_PORTAL.bat`**.
4. Keep the command window open while using the prototype.

The launcher selects the first open port from `8080` through `8090`, starts the local server, and opens the correct browser address. Opening the HTML directly is not supported because the invoice importer needs the local Python endpoint.

### macOS / Linux

```text
cd wilson_maintenance_portal_v0916
./start_demo.sh
```

## v0.3 customer enrollment

`appliance-signup.html` now uses fourteen broad customer-facing categories:

- Refrigeration — refrigerator, freezer, column, wine, beverage, and undercounter products
- Icemaker
- Cooktop / Rangetop
- Range
- Dishwasher
- Ventilation
- Microwave — including speed ovens for the simple customer flow
- Ovens
- Warming Drawer
- Built-In Coffee
- Washer
- Dryer

Each category has a custom Wilson-style 2D line icon based on the higher-end products Wilson typically sells: professional ranges and rangetops, top-control dishwashers, built-in refrigeration, hood liners, wall ovens, and premium front-load laundry.

The homeowner only selects quantities. Model entry has been removed from the public flow. Each selected appliance becomes a draggable card under **Main House**. The customer can add areas such as Casita, Guest House, Bar, Outdoor Kitchen, or Pool House and move individual appliances between them. A standard Move To menu remains available for phones and accessibility.

Pricing rules are unchanged:

- Standard appliance: **$149.95/year**
- IMUC: **$249.95 per visit**, with two annual visits selected by default
- Estate Annual: **$1,195/year**
- Estate Preferred: **$1,995/year**
- Estate Concierge: **$2,995/year**

Below the Estate crossover, the customer sees only the calculated total. Once Estate Annual becomes less expensive than per-appliance pricing, the form moves there automatically and reveals only the three Estate service-level choices.

## Wilson PDF sales-invoice import

Maintenance Operations now has an **Invoice Import** tab. It accepts multiple related Wilson invoice PDFs at once, including split invoices such as a main invoice and its `-1` file.

The parser is configured around the supplied Wilson invoice format:

- Reads invoice number, invoice date, Ship To name, phone, and address.
- Uses printed section headings such as `APARTMENT`, `MAIN HOUSE`, and `STUDIO` as household areas.
- Extracts quantity, model, description, manufacturer/category line, and serial number.
- Combines split invoice PDFs into one maintenance inventory.
- Filters installation, decorative panels, accessories, hoses, cords, delivery, payments, credits, promotional lines, and blower accessories.
- Keeps exact brand, model, serial, description, invoice number, and inferred product type on the internal asset record.
- Maps each product to the broad customer category used by the self-registration page.
- Places products without a printed area heading into **Unassigned — Review** rather than guessing.
- Flags WashTower/laundry-center products because the prototype currently expands each one into a washer record plus a dryer record for maintenance pricing review.

After review, **Create maintenance draft** opens the public-style enrollment with all broad icons counted and placed into the extracted areas. The exact invoice data remains attached behind the scenes.

The PDF parser runs locally through `serve_portal.py`. A compatible copy of the pure-Python `pypdf` library is bundled under `vendor/`; its license is included under `vendor/licenses/`.

See `docs/INVOICE_IMPORT.md` for field mapping and classification rules.

## Other pages

### Customer-facing

- `index.html` — first choice between Household Appliances and HVAC
- `appliance-signup.html` — icon-first appliance enrollment
- `hvac-signup.html` — separate HVAC enrollment
- `confirmation.html` — enrollment summary

### Internal

- `admin.html` — due queue, households, invoice import, filters, reports, custom quotes, and plan setup
- `household.html` — household asset/subscription history
- `quote-view.html` — the proposal document; quotes are built on `appliance-signup.html`
- `tech-maintenance.html` / `report-view.html` — field technician workflow and locked customer health-report template

## Data and integration boundaries

The prototype stores demo operational data in browser `localStorage`. The invoice PDFs themselves are parsed in memory and are not saved by the prototype. Production should replace browser storage with authenticated server APIs and SQL Server records.

The buttons deliberately stop at the external integration boundaries:

- **Connect payment** → Stripe Customer + SetupIntent
- **Charge card** → server-side Stripe PaymentIntent at the scheduled interval
- **Generate order** → future NetSuite service-order adapter
- **Save report** → SQL plus secure photo/PDF storage
- **Invoice import** → production document storage/retention policy and server-side audit trail

Never place Stripe secrets, NetSuite credentials, or trusted prices in browser JavaScript.

## QA performed for v0.3 (superseded: `bash _qa/run_all.sh` now runs 15 automated suites, 372 checks)

- JavaScript syntax checks for every script
- Python compilation checks for the launcher server and invoice parser
- Local API upload test using both supplied split Wilson invoices
- Verified extraction of 18 product lines and expansion to 20 maintenance records
- Verified exact model/brand/serial capture and section-area extraction
- Verified 53 non-appliance/support lines were filtered from the sample invoices
- Customer picker interaction test, quantity controls, area creation, automatic Estate crossover, and Estate tier selection rendering
- Invoice review rendering and maintenance-draft expansion test
- Verified the imported draft prefilled 20 customer-facing assets, four household areas, and the Ship To address

Reference screenshots were removed in v0.9.46: two of the v0.3-era captures carried REAL customer data from a live invoice import (name, phone, service address, invoice numbers), which the standing rule -- real Wilson invoice data never enters the repository or a packaged zip -- forbids. Re-shoot any needed reference images against SEEDED households only.

## Security status

This is a review prototype, not a production application. Production requires authentication, role-based authorization, HTTPS, CSRF protection, server-side pricing validation, audit logs, least-privilege SQL access, secure secret management, backups, retention rules, and secure report/invoice storage. The internal dashboard must not be exposed to the public internet.

## v0.7 additions
- Internal `admin.html` now opens to a command-center workflow rather than a dense due queue.
- `tech-maintenance.html` is the mobile-first field technician workflow and auto-generates health reports from completed checks. The old manual report builder has been retired.
- Household records can be switched between Card on File and Account / AR billing.
- Estate auto-selection now accounts for two-visit IMUC economics and can default to Estate Preferred.
- Completed field visits move their health-report package to **Ready to email** in the Command Center.
- Product lifecycle tier defaults from the appliance brand and remains technician-overridable.


## v0.7 refrigeration protocol
The mobile field tool now uses the agreed five-point refrigeration protocol, structured temperature readings, mandatory serial-tag photo, optional checkpoint photos, lifecycle stage, and customer-selected refrigeration filter service. See `docs/V06_DECISIONS.md` for refrigeration details and `docs/V07_DECISIONS.md` for the field-generated report workflow and brand-tier defaults.
