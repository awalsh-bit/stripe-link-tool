# ePASS history import

*Added 11/20. Andrew: "I just dropped all of ePASS's historical data in to the data folder in wilson-agility. Can you dig through it and see if you can figure out how to use that instead of pinging the ODBC for all of our historical data?" Asked what it should load, he chose all three: **Customer lifetime**, **Service history** and **Older sales orders**.*

The full ePASS export in `data/EPASS_FULL_EXPORT_20260917_0729/` (November 2006 to November 18, 2026) now loads Agility's history once. The ODBC pull no longer re-reads that history.

## What the export gives Agility

| What | From the export | Where it shows up in Agility |
|---|---|---|
| **Customer lifetime totals** | Every finished sales order and customer-pay service ticket, totalled per customer, plus the brands each customer bought. Covers finishes through 11/17/26. | Customer Master: lifetime sales, orders, first and last purchase, service, the **Bought these brands** filter. |
| **Service history** | 118,892 finished SV and WTY tickets, 2006 to 2026, each with complaint, work performed, parts and labor. | The tech field tool's customer history and Model Insight, and the dispatch board's history drawer. |
| **Older sales orders** | 76,896 finished sales orders (R, S, AC, CAB, MOD), each with its models, serials, misc and discount lines, items, labor and warranties. | Sales Order Detail, Brand Sales, serial lookups, and a customer's orders on Customer Master. |

After the export date, each of these keeps itself current:

- **Customer lifetime:** Agility adds every order finished after 11/17/26 from the hourly finished-orders feed. The Customer Master line reads *Lifetime sales and service from ePASS through 11/17/26, plus every order finished since*.
- **Service history:** the pull tops up the service catalogue every hour.
- **Sales orders:** the hourly finished-orders feed, as before.

## What it doesn't do

- **Anything current.** Open orders, quotes, open service and the hourly finished orders still come from the ODBC pull.
- **Commissions and Performance vs Target.** History orders never become a commission month, an HVAC statement month or a Performance vs Target month. The Quote Follow-Up scoreboard leaves them out too.
- **Months Agility already has.** A month that has any order from the live feed or an OE-23 upload is skipped whole. A service ticket already in the catalogue is left alone, because the ODBC copy also has the payer and the taxes.
- **Service tickets in Sales Order Detail.** Service history goes only to the catalogue, so service commissions never see it.
- **Sales tax history.** The export's service file has no tax columns. The Sales Tax Report still backfills over ODBC (`-TaxBackfill`).
- **Notes and comments.** Files 08 and 09 aren't loaded. Nothing in Agility reads old order notes, and free text is where card numbers end up.

**What's in the old data:**

- **Brands on older lines.** About a third of the older model lines, mostly before 2016, have no brand: their models are no longer in ePASS's model master. Brand Sales and the brand filter can't place those lines.
- **History service tickets.** Their totals leave out tax, and the warranty flag comes from the ticket type (WTY).
- **Invoices numbered SV.** Twenty-two sales-type invoices carry SV numbers. They're left out of Sales Order Detail, because Agility files anything numbered SV as service, but they count in the lifetime totals.
- **2009 margin.** Margins for 2009 run low, about 4%, because 115 orders have a recorded cost far above the sale (replacement units at no charge, most likely). That's how ePASS has them.

## What Andrew needs to do

1. **Push and wait for the Render deploy.** This has to come first. Without the new server, the agent's uploads are refused and the files land in `failed\epass-history`.
2. **Check the database has room.** The history adds roughly 0.4 GB to the Postgres database. In Render, open the database's page and check its storage before step 4.
3. **Copy the two scripts to the ePASS server.** Copy `scripts/epass-odbc-pull.ps1` and `scripts/epass-agent.ps1` from the repo to the Agility folder on the ePASS server, replacing the old ones, as for the Customer Master. The key stays in `epass-agent.key`.
4. **Copy the history files into the agent's outbox.** On the laptop, the files are in `C:\dev\wilson-agility\data\EPASS_FULL_EXPORT_20260917_0729\_agility-history\epass-history\` (264 files, 311 MB). Copy all of them into `outbox\epass-history\`, which sits next to `agent.log` on the ePASS server. The new agent creates that folder on its first run, or you can make it yourself.
5. **Let it run.** The agent sends them in order: customer totals first, then the service years, then the order months. Each run it sends about four minutes' worth, so the live feeds keep flowing in between, and then it picks up on the next run. Expect it to finish within an hour or two.

**Checking it:**

- **`agent.log`** shows `OK [epass-history]` lines and, between runs, `PAUSE [epass-history] N file(s) left`. When `outbox\epass-history` is empty, it's done.
- **Customer Master:** the line under the title reads *Lifetime sales and service from ePASS through 11/17/26, plus every order finished since*.
- **Sales Order Detail** for any 2015 month lists orders. **Brand Sales** for 2010 lists models.
- **A failed file** lands in `failed\epass-history`, with the reason in `agent.log`. Move it back into the outbox to try again.
- **Sending a file twice** adds nothing twice.

**Running the converter again.** You only need to if a newer export replaces this one:

```
cd C:\dev\wilson-agility
node scripts\epass-export-import.mjs
```

It reads the newest `data\EPASS_FULL_EXPORT_*` folder. It takes everything finished up to the day before the export's last refresh (the `00_Refresh_<date>.csv` file) and rewrites `_agility-history\`. It takes about ten seconds and needs Node 18 or newer.

## Data minimization

- **What's copied:** the converter copies only the columns the ODBC pull itself sends. It never copies emails, tax-exempt certificate numbers, credit fields, notes or comments.
- **Files it never reads:**
  - 01 (customers; the daily pull carries the master)
  - 02 (the all-type master)
  - 08 and 09 (comments and notes)
  - 13 and 15
  - the backup folders
- **Git:** the export folder and the bundles inside it are ignored by git (`data/EPASS_FULL_EXPORT_*/` in `.gitignore`), so they never go to GitHub or Render. Several export files are over GitHub's 100 MB limit, and `01_Customers.csv` holds every customer's contact details.

## Changes to the ODBC pull

- **Retired: the daily lifetime totals and brands** (`customer-sales`, `customer-service`, `customer-brands`). They re-read every invoice since 2006 each morning. The `epass-customers` bundle now carries only the master and its extras.
- **Retired: `service-history`.** It re-read three years of finished tickets, for every customer with an open ticket, every 15 minutes. The board's history drawer reads the service catalogue instead. The last `service-history` data stays in Agility as the drawer's fallback.
- **New: an hourly catalogue top-up.** The first pull of each hour except 6:00 sends the tickets finished in the last 3 days. The 6:00 pull still sends 21 days and the labor-rate book.

## Checked before delivery

**Synthetic data.** The real `server.js` ran on a local test database, fed a made-up export that uses the real file names and column headers: 3,000 orders and 3,000 tickets, with commas, quotes and line breaks inside fields. All 40 checks passed:

- **The converter:** its counts matched the generator's (orders, months, tickets, years, customer pairs, brand pairs). No email, tax-exempt or credit column made it into a bundle.
- **Months the live feed already had** (October and November 2026) were skipped whole. Their orders and units were untouched.
- **Every other finished sale** went into Sales Order Detail with its discount lines and salesperson, including cabinetry (CB) and modifications (MD). Service tickets and SV-numbered sales were left out.
- **Commissions:** the commission months, HVAC statement months, commission lines and Performance vs Target months stayed the feed's two. Brand Sales reached back to 2010.
- **The catalogue** held every finished ticket. Three tickets already loaded from ODBC kept their payer and complaint, and their parts and labor weren't doubled. Text with a comma, quotes and a line break came through intact.
- **Customer Master:**
  - The lifetime totals equalled the export's for 40 customers checked.
  - One order finished after the cutoff was added on top.
  - The brands were one per customer and brand.
  - The page said *through 11/17/26*.
- **The quote scoreboard's** direct sales left the history out (3 orders, not 414).
- **Sending everything twice** changed nothing.
- **Refusals:** a bad type, a missing date window, a missing `asOf`, a file that isn't JSON and a wrong key were each refused.
- **Earlier Customer Master tests:** 45 of 45, plus 9 of 9 before any lifetime data, plus the permission tests.

**At full scale** (78,000 made-up orders and 78,000 tickets):

- The converter took 9 s and peaked at 0.9 GB of memory.
- Loading all 264 bundles took 48 s on the local database and added about 285 MB.

**On the real export,** on Andrew's laptop, with counts only (no customer data left the laptop):

- **The converter:** 7 s, 264 files, 311 MB. The largest file is 8.4 MB (the upload limit is 60 MB).
- **The service catalogue:** 118,892 tickets. They match ePASS year by year, 2006 to 2026.
- **The sales orders:** 76,896 finished.
- **Agility's own feed code** built them into tickets:
  - Every one had a customer number and a salesperson.
  - Every unit found its model line.
  - The discount lines linked up.
- **The line files** matched the order totals:
  - models on 51,098 of 51,116 orders
  - misc on 46,225 of 46,226
  - items on all of them
  - service parts and labor on all but a handful

## For developers

- **`scripts/epass-export-import.mjs`** (Node, run on the laptop): a streaming CSV reader, then per-dataset allow-lists that map the export's prefixed columns (`Inv_`, `Model_`, `Serial_`, `Misc_`, `Item_`, `Labor_`, `Warranty_`) to the ODBC pull's column names. It writes:
  - `epass-history-1-customers-{totals,brands}.json`, with `history: "customers"` and `asOf`
  - `epass-history-2-catalogue-<yyyy>.json`, with `history: "service-catalogue"`
  - `epass-history-3-orders-<yyyy-mm>.json`, with `history: "finished-orders"`, `finishedSince` and `finishedUntil`

  Dates are written as `yyyy-mm-dd`, empty values are dropped, and `summary.txt` holds counts only.
- **`server.js`:** agent kind `epass-history`. `processHistoryBundle` answers once the bundle is in the database, so a 5xx leaves the file in the outbox. The last bundle shows on the ePASS feed status route as `history`, and each bundle is audited as `epass_history_received`.
  - **Orders:** `finishedTicketsFromFeed` on the sales types only (by `InvTypeCode`, never SV-numbered), then `insertHistoryOrders` and `insertHistorySoldSerials`.
  - **Catalogue:** `processCatalogueHistoryBundle`.
  - **Customers:** `ingestCustomerBundle`, lifetime datasets only.
- **`lib/sales-order-detail-postgres.js`:** `insertHistoryOrders` is insert-only.
  - It skips any month that has non-history rows.
  - It writes `source_month = ''` and `source_filename = 'ePASS history export'`, so the commission and HVAC month lists can't see these rows.
  - `salespersonNamesByCode` supplies the names.
- **`lib/epass-sold-serials-postgres.js`:**
  - **`epass_sold_serials.history`:** a new column. `listSoldSerialMonths` and `commissionLinesFromFeed` exclude history rows.
  - **`insertHistorySoldSerials`:** insert-only, and it skips months that already have feed units. Model master rows only fill blanks.
- **`lib/epass-catalogue-postgres.js`:** `processCatalogueHistoryBundle` inserts with `ON CONFLICT DO NOTHING`, adds parts and labor only for tickets it added, and records its slice in `epass_catalogue_meta.slices` without touching the last-pull fields.
- **`lib/customer-master-postgres.js`:**
  - **`customer_master_meta.as_of`:** a new column. `totalsSql` and `brandsSql` combine the lifetime tables with `sales_order_detail` and `epass_sold_serials` rows finished after `as_of`. Rows marked history are left out of that top-up.
  - **A lifetime part from an older pull** (no `asOf`) counts as covering the day before it was pulled.
  - **The sales pattern** now includes CB, MD and Q numbers.
- **`lib/quote-followup-postgres.js`:** the scoreboard's direct-sales count leaves out `ePASS history export` rows.
- **`customer-master.html`:** the source line shows the as-of date.
- **`scripts/epass-agent.ps1`:**
  - kind `epass-history`, not a snapshot
  - sent in name order
  - `$HistoryBudgetSeconds = 240` per run
- **`scripts/epass-odbc-pull.ps1`:**
  - the lifetime parts and `service-history` are removed
  - an hourly 3-day catalogue slice is added
