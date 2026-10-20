# PO ETA Import Builder

Purchasing → **PO ETA Import Builder** (`po-eta-import.html`). Added 2026-10-20 for Andrew.

## Why

When a PO is pushed out to match a job, the vendor's new ETA and acknowledged requested date have to be keyed back into ePASS PO by PO. That never keeps up, so Cash Ops Projection sees a wall of ETAs in the past. ePASS has an **ETA Date Import** utility that takes a workbook with four columns; this tool builds that workbook from whatever the vendor portal exports.

## ePASS utility settings

Tools → ETA Date Import:

| Field | Value |
| --- | --- |
| Import Type | **Models** |
| PO # Column | **A** |
| Item/Model | **Code**, Column **B** |
| ETA Date Column | **C** |
| Req Delivery Column | **D** |
| Reference Column | blank (not written) |
| Serial Type Column | blank (not written) |

The file has no header row by default (the utility is driven by column letters; a header row can be ticked on). **CSV is the default** — the utility came up blank on an .xlsx (Andrew 10/20) — with dates as `mm/dd/yyyy` text. .xlsx is still offered from the same dropdown (the builder can also write .xls if ever needed), with real date cells formatted `mm/dd/yyyy` or, with "dates as text" ticked, text strings. Each run remembers which format it was built in, so "Download again" gives back the same kind of file.

## Flow

1. **Vendor and export** — pick the vendor (Whirlpool, GE, BSH, Sub-Zero/Wolf/Cove, or Other) and the portal's export (`.xlsx`, `.xls`, `.csv`). The header row is found automatically even under a title block.
2. **Confirm the columns** — PO #, model, ETA (required), requested delivery, qty, status (optional). First time per vendor the page guesses from the headings; once matched with "Remember these columns" ticked, the map is saved in `po_eta_vendor_maps` and reapplied next time (by exact header signature, or by header names if the portal reorders columns).
3. **Review what moved** — every portal row is matched to the open PO lines in the ePASS finance feed (`epass_po_open_lines`):
   - PO: exact → ignoring punctuation → without leading zeros → portal number that contains ours (`PO0012345`, `12345-1`).
   - Model: exact → ignoring punctuation → unique prefix on that PO (`WRX735SDHZ00` vs `WRX735SDHZ`).
   - Several portal rows for one PO + model (split shipments) collapse to one line; the **earliest** ETA is used.
   - Results: **Changed** (ETA or requested date differs from ePASS — ticked for the file), **Same as ePASS**, **PO not open**, **Model not on PO**, **No vendor ETA** (blank / "TBD"), **Cancelled** (status column). Only matched lines can be ticked; dates can be edited inline before building.
   - A requested date the portal does not give is filled from ePASS's current RDD so the import never blanks it. An ETA is never invented.
   - "sent m/d" badge: this PO + model was already in a file built in the last 21 days — ePASS may just not have been imported yet, or the feed has not re-pulled.
4. **Build ePASS import file** — downloads `epass-eta-import_<vendor>_<date>.csv` (or .xlsx) and records the run (`po_eta_import_runs`: who, vendor, portal file, counts, the lines and the file bytes). Runs can be re-downloaded from the page.

## Vendor parsers

`lib/po-eta-import.js` → `VENDORS`. Each vendor is a set of header hints (regexes per field), optionally a `derive()` hook that reads the raw row once the columns are mapped, plus the generic data-shape fallback. Any vendor whose "date" column is really a paragraph gets the earliest date found in it (`datesInText`).

### BSH (built from the 2026-10-20 sample)

One row per order item; serial-number continuation rows underneath are skipped (no PO, no material). Columns: **PO Number** (`38835`, `P230`), **Material** (model), **Pref. Delivery Date** (`AUG/07/2026`, requested delivery → col D), **Estimated date** (free text: `Estimated arrival of items: 1 pcs on NOV/05/2026`, `Items in stock: 4 pcs on OCT/20/2026 / 8 pcs on OCT/21/2026`, sometimes both blocks), **Delivery Status** (`not confirmed`, `Delivery confirmed to the 10/30/2026`, `to the 10/29/2026 3 unit(s) confirmed`, `Delivery completed`), **Req.Qty.**

ETA rule: a date in Delivery Status is BSH's commitment and wins; otherwise the earliest date in the Estimated text (first units land). Every choice is written into the line's notes ("BSH confirmed 10/29 for 3 unit(s); estimated: 4 on 10/20, 8 on 10/21"). `Delivery completed` rows land in the **Delivered** group and are never imported.

### Whirlpool (built from the 2026-10-20 sample)

Partner-portal **Order Status Report**: title block, account line and totals strip, then the grid on row 6 with merged cells that do not line up with the headings underneath (heading N:P, value M:P; heading S:T, value T:U …). The reader turns every merged heading into one logical column and hands each data cell to the heading whose span sits closest, so the columns come out clean: **PO NUMBER** (`39325`, `BC_S145`), **MODEL NUMBER**, **QTY ORDERED** / DELIVERED / READY FOR DELIVERY / REMAINING, **QTY REMAINING TO DELIVER BY** (= ETA, `10/21/2026`). Rows are grouped by delivery date with a `Totals: … Freight Charge:` row after each group; totals rows are skipped.

There is **no requested-delivery column**. Column D is filled from ePASS's current RDD so the import never blanks it (Andrew: Whirlpool RDDs rarely change). The portal's qty ready / delivered counts are written into the line's notes.

### GE Appliances (built from the 2026-10-20 sample)

Dealer-portal **Orders** export: header on row 1, one row per order line (one row per *unit* — a PO with two of a model has two lines, which collapse to one with the earliest date). Columns: **P.O.#** (`39053`, `P221`, `S180-1`), **Product #** (model; **Ordered Item** is the alternate), **Req. Delivery Date** (→ col D), **Target Arrival Date** (GE's original target, `08/21/26` — goes stale), **Expected Available Date** (GE's current estimate — the ETA), **Delivery Appointment** (set once a delivery is booked), **Line Status** (`Backorder Hold`, `Backorder Available`, `Awaiting Shipping`), **Product Status** (`Prod TBD`, `In Transit`, `On Hand`, `Expires`), **Quantity Ordered**, **Reserved Quantity**.

ETA rule: Delivery Appointment, else Expected Available Date, else Target Arrival Date. The line/product status, original target and reserved count go into the notes. Two-digit years (`11/09/26`) are read as 20xx.

### Sub-Zero · Wolf · Cove (built from the 2026-10-20 sample)

**Open Orders Detail** CSV: title block (customer, run time, search criteria), grid on row 8, `Day Total` rows at the end (skipped). Columns: **P.O. Number**, **Item** (Sub-Zero's item number — the alternate model), **Item Description** (the model as ePASS knows it: `DW2451`, `CL4850UFD/O`, `ID-24R`; or an accessory description like `KIT,PNL,ASSY,24,4,PH`), **Request Date** (→ col D), **Estimated Available Date** (ETA), **Open Qty**, **Promise Qty**, **Ship Qty**, **Comments**. **Shipping Instruction** says `Delivered` on every line — it is the delivery method, never read as a status.

Model matching tries Item Description first (so `CL4850UFD/O` also matches an ePASS code written `CL4850UFDO`), then the Sub-Zero item number — that is how accessory lines whose description is not a model still match when ePASS carries them by item number. Sub-Zero delivers to Wilson on **Thursdays**, so two date rules apply (Andrew 10/20):

- **Request Date → +2 business days.** Their Request Date is the day the warehouse picks; the truck arrives two business days later (Tuesday pick → Thursday truck; a Monday pick in a holiday week → Wednesday; Thursday → Monday). ePASS gets the truck day.
- **Month-only estimates → third Thursday.** Far-out lines carry a month-only estimate (`02/2027`, 171 of 683 lines in the sample); the third Thursday of that month is used. A full Estimated Available Date is written as given.

Every adjustment is spelled out in the line's notes.

### Generic rules added along the way

- **Alt. model / item #** is an optional seventh column in the map: tried when the primary model does not match an open line on the PO.
- A month-only ETA (`02/2027`, `Feb 2027`) becomes the 1st of that month, with a note (Sub-Zero overrides this to the third Thursday).
- Rows whose first cell is a total (`Totals:`, `Day Total`, `Grand Total`) are skipped.

## Not done on purpose

- Reference (col E) and serial type are not written — Andrew 10/20.
- Nothing is written to ePASS from Agility; the buyer imports the file in ePASS and the next feed pull shows the new dates here and in Cash Ops.

## Tables

- `po_eta_vendor_maps` — one row per vendor: header signature, header names per field, column indexes, sheet name.
- `po_eta_import_runs` — one row per file built, with the exported lines (JSONB) and the `.xlsx` (BYTEA).

## Routes

`GET /api/po-eta-import/context` · `POST /api/po-eta-import/inspect` (multipart) · `POST /api/po-eta-import/match` (multipart) · `POST /api/po-eta-import/build` (JSON → xlsx) · `GET /api/po-eta-import/runs` · `GET /api/po-eta-import/runs/:id` · `GET /api/po-eta-import/runs/:id/file`. All behind the `/po-eta-import.html` page grant (Purchasing category in User Admin).
