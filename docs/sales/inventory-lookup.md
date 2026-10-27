# Inventory Lookup

Sales Tools → **Inventory Lookup** (`inventory-lookup.html`, grant under Sales). Added 2026-10-26 for the team — the ePASS "Serial Inventory" screen, rebuilt on the live feeds and NetSuite's words.

## Filters

- **Merch category → class → subclass** — NetSuite's hierarchy, cascading: pick a category and the class list shrinks to its classes, pick a class and the subclass list follows. Counts in brackets are models.
- **Model / Brand / Description** — three searches, each `contains` (default), `starts with` or `ends with`; combined with AND. Model matching ignores punctuation (`CL4850UFD/O` finds `CL4850UFDO`). Brand matches the NetSuite brand name or the ePASS brand code.
- **On hand only** — models with at least one unit in stock.
- **ATS only** — models with at least one unit available to sell (ALL serial type, free). Added 10/27.
- **Sort** — *Stocked first* (default: ATS, then on hand, then brand/model), or **Price low → high / high → low**. The sort price is **L1**, else the maker's UMRP/MAP code (Sub-Zero and Wolf carry no L1 — SZ-UMRP, WOLF-UMRP …), else Retail; models with no price at all go last either way. Rows carry it as `sortPrice`.
- **Closeout units only** — models with at least one unit that qualifies for the Clearance Hit List, by that list's own rule (`clearanceRuleFor`): serial type OPEN, or ALL received more than 365 days ago, or ALL with a UniqueSellPrice in ePASS. DISPLAY never qualifies. Cards show an "N closeout" chip; the drawer tags each qualifying unit with why (open box / days in stock / unique price) and the unique price when ePASS has one.
- **Active or in-stock only** (on by default) — a model shows when it has stock, or NetSuite has it and it isn't discontinued. Turn it off to find archive units: discontinued models and ePASS models NetSuite never carried.

Written and on-order quantities are deliberately not on this screen (Andrew: "that's really not important for inventory lookup" — the Ordering Report has them). Filters and sort are remembered per browser. On phones the fields are 16px so iOS Safari doesn't zoom the page when one is tapped (Andrew 10/27).

## Results

**On a phone** (the showroom view, under 900 px) the results are cards: model, brand · subclass, NetSuite short description, **L1 and Retail** side by side, and an **ATS** chip — plus "+N likely" in amber when units are written to far-out orders, and "discontinued" when NetSuite says so. Tap a card for the drawer.

**On a computer** it's a table: brand, model, description, class · subclass (ePASS product code when NetSuite has no class), then **ATS, L1, Retail**, closeout, on hand, likely, spoken for, reserved (+ exclusive). A model NetSuite doesn't have yet carries a small "ePASS" tag.

**ATS** (Andrew 10/26) = units of serial type **ALL** that are not reserved to an order and not on hold — the number a salesperson can promise today. Display / open-box units (other serial types) and "likely available" units are shown but not counted.

**Prices**: ePASS price levels — **L1 and Retail** on the card and in the table, plus the maker's own floor code when the model has one (**SZ-UMRP**, WOLF-UMRP, BESTMAP, SCOTMAP … — whatever MAP-ish code ePASS carries besides RETAIL; Andrew 10/27 asked for SZ-UMRP, and Sub-Zero / Wolf models usually have *only* that code, which is why their L1 / Retail tiles were blank), **L1 / L2 / Retail / UMRP** in the drawer (from `epass_model_list_prices`, the same feed the online shop prices from). NetSuite's **Base Price** is hidden for now (Andrew 10/27: "the data is really inconsistent" — it disagreed with L1 by a few dollars on models like SHX78CM5N and is blank on ~9,000 items); it still comes through the API (`basePrice` / `prices.base`) so it is one line to bring back. No cost anywhere on this screen.

If the three merch selects are empty, the banner at the top says why: the NetSuite items on file have no hierarchy columns. Upload the current NetSuite items export (the full saved search with Merch Category / Class / Subclass) on **Ordering Report → step 2, NetSuite items & suppliers**. Since 10/26 that one upload fills both tables — `netsuite_items` (type, base price, short description, supplier) and `model_brand_map` (brand, supplier, hierarchy, discontinued) — so there is no second place to import it; ePASS Uploads → NetSuite Item Catalog accepts the same file and does the same thing.

## The drawer

Tap a row. Same shape as the Ordering Report's position drawer, minus cost and the ordering sections: header with brand · supplier · category › class › subclass, price tiles (L1 / L2 / Retail), then **Available to sell** (= ATS; a sub-line says "+N open box / display, also free" when non-ALL units are free), closeout, on hand, likely available, spoken for, reserved. The Available-to-sell and Likely-available tiles carry an **[i]** — hover on a computer, tap on a phone — with the definition; the old footer sentence is gone. a **Last 12 months** tile — **written** and **delivered** units, Brand Sales' definitions: written = units on tickets *started* in the last 365 days (finished serials by start date + the model's lines still on the open book, QtyOrdered), delivered = units on invoices *finished* in the window; returns excluded; read live from `epass_sold_serials` and the open-order feed (the same one-row-per-unit ePASS feed table Brand Sales and the commission reports use, fifteen minutes fresh; the OE-23 warehouse is only the fallback on an empty database). Andrew 10/27: one simple gauge, units only, because this screen may be read over a salesperson's shoulder; the [i] names the window and the source; anything deeper is Brand Sales, and every unit on hand with:

| Status | Rule |
| --- | --- |
| **Available to sell** | not written to an order, not reserved — serial type ALL or OPEN (open box counts as sellable; Andrew 10/27) |
| **Display — ask the GM to sell** | a free **DISPLAY** unit. Never "available to sell" (Andrew 10/27): the unit row carries an **Ask the GM to sell** button → optional note → `POST /api/inventory-lookup/display-request`. The GM is employee code **E80** in the directory (`INVENTORY_DISPLAY_APPROVER_CODE` to change it) and gets a yellow dashboard flag plus an email naming the requester, the unit, its location and age; the requester sees "Request sent to …". Nothing moves in ePASS — the GM answers the salesperson directly. One request per person per serial per 10 minutes; audited as `inventory_display_sale_requested`. The same button sits on *Exclusive reserve* units. |
| **Likely available to sell** | written to an order whose delivery or pickup date is more than **60 days** out — shown with the days and the salesperson to check with before promising it |
| **Spoken for** | written to an order inside 60 days (or with no date yet) |
| **Reserved** | legacy — **since 10/27 a DateReserved without an order is not a hold anywhere in Agility** (Andrew: "DateReserved doesn't work without an order"). Only an invoice — written to it, or ordered-for an invoice that is still open — takes a unit out of ATS. The feed now writes the date to `reservedDate` for information and sets `reserved` only to `exclusive` (ePASS Reserve Exclusive), so the online shop, Clearance Hit List, Promo Item Builder and this page all follow the same rule from the next feed pull after deploy. |
| **Exclusive reserve** | ePASS Reserve Exclusive — display / open-box unit kept out of auto-allocation |

Plus the order, customer and salesperson, schedule or pickup date, job status, received date and age, location / bin, serial type and serial number. No cost column — this is a sales screen; say the word if the team should see it.

## Where the data comes from

The shop inventory snapshot (every on-hand serial from the ePASS feed, rebuilt after each pull), `epass_open_orders` for the written-to order's customer, dates and job status, NetSuite through the catalog resolver (brand, supplier, hierarchy, discontinued), and `epass_model_master` for models ePASS knows but has none of. The index is rebuilt after every feed pull and every NetSuite import, otherwise at most every five minutes. The 60-day threshold is `LIKELY_AVAILABLE_DAYS` in `lib/inventory-lookup.js`.

## Routes

`GET /api/inventory-lookup/options` (tree, totals, feed time) · `GET /api/inventory-lookup` (`category, cls, subclass, model, modelMode, brand, brandMode, description, descMode, onHand, ats, closeout, active, sort, limit`; rows carry `l1, l2, retail, umrp, umrpCode, basePrice`) · `GET /api/inventory-lookup/model/:model` (`prices.all` has every ePASS price code on the model; `sold12`, `written12`, `soldWindow`, `soldSource` for the trailing-12 tile) · `POST /api/inventory-lookup/display-request` (`model, serial, note`). Opening a model is audited (`inventory_lookup_model_viewed`).
