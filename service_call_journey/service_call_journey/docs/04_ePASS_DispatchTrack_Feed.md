# ePASS → Dispatch Track export feed (what the service dashboard can reuse)

Source: `reference/wilson_routing_dashboard_context_3_sales_side.md` (sales/install routing prototype, Aug 2026). Skimmed 9/11/2026 for the service project. Sales-side content is out of scope for now; this note pulls only what the service journey needs.

## Where the auto-exported files live

| Item | Value |
|---|---|
| Network folder | `\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport` |
| File pattern | `DispatchTrackDetail_*.csv` (e.g. `DispatchTrackDetail_20260513_161502.csv`) |
| Cadence | ePASS writes a new file **every 15 minutes** |
| Shape | **Full snapshot** each time, not a delta |
| Encoding | `cp1252` (UTF-8 read fails on byte 0xA0) |
| Existing importer | `C:\WilsonRouting\import_epass.py`, run every 5 min by Task Scheduler task **"Wilson Routing EPASS Import"**, into SQL Server Express `localhost\SQLEXPRESS`, database `WilsonRouting` |

## What's in it that matters for service

The sales importer deliberately **skips `SV00…` rows**. They are in the file. Columns identified:

`Order Number`, `Delivery Date`, `Truck`, `Ship Name`, `Ship Address1`, `Ship City`, `Ship State`, `Ship Zip`, `Phone1`, `Model`, `Description`, `Quantity`, `Deliver Quantity`, `Balance`, `Latitude`, `Longitude`, `Job Status`, `Directions`, `Qualifications`, `Salesperson`, `ProductCode`, `Points`, and a `Service Time` field.

For the service dashboard this means, without any new ePASS work:

- **Status mirror every 15 minutes**, not once a day: `Order Number` (SV#) + `Job Status` (SO1…SO9) + `Delivery Date` (scheduled date) + `Truck` (tech route code) is exactly what the Sync Queue / Discrepancy engine in blueprint §9 needs to auto-close sync items.
- **Geocodes are already there.** `Latitude`/`Longitude` per order means the route builder does not need to geocode addresses for existing tickets; only brand-new web-form requests need a geocode call.
- **Balance** feeds the COD / A/R flags on the board and the tech's job card.
- **Directions / Qualifications** map to gate code, access notes and skill requirements.
- `Model` / `Description` lines give the unit and, for SO4–SO6 tickets, the parts lines already keyed in ePASS.

## Known limitation (Cayden, 9/11)

The export is filtered to statuses where a tech is expected to roll: **SO1, SO4PRE, SO6** (to confirm). So today it is a *routing* feed, not a full status mirror — SO2 through SO5, SO7–SO9 and the WAR/SI statuses are invisible to it. Cayden is checking whether the ePASS export can be widened to all service tickets. Until then:

- The feed still covers the three statuses the route builder and board need, plus geocodes.
- The Sync Queue / Discrepancy engine needs the ExportInvoice report (all open SV/WTY tickets, already imported by Service Order Health) as its status source for the other statuses. Plan for two inputs and merge on SV#; if the DispatchTrack export is widened, drop the second.
- Completion detection (SO8) can't come from the feed today; the field tool's "Repair complete" is the source anyway.

## What to reuse vs. build

- Reuse the importer pattern (newest file, skip-if-already-imported, raw-rows table + upsert that preserves dashboard-owned fields). Drop the `S000/R000`-only filter and import `SV00` rows into the service tables instead.
- Keep the two side by side for now: `WilsonRouting` (sales/install) and a service database/schema, sharing the same CSV drop. When both are mature they can share one import batch table.
- Confirm on the ePASS side whether `Service Time` is populated for SV tickets (the sales side found `Points` was the real capacity field for S/R tickets; SV tickets may differ). The field tool's arrive/complete taps will replace it either way.

## Open items to verify on WILSON-EPASS01

1. Can the DispatchTrackDetail export be widened from SO1/SO4PRE/SO6 to all service statuses (including closed SO8/SO9)? — Cayden investigating.
2. Do `Job Status` values match the status list exactly (e.g. `SO2.2`, `SO4PRE`, `WAR4`)?
3. Is `Truck` for SV tickets the tech's SP code (AJH, CIT…) or a route code?
4. Whether the ExportInvoice report (used by Service Order Health today) adds anything the DispatchTrack file lacks — if not, retire the manual upload.
