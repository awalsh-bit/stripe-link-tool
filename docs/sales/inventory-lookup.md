# Inventory Lookup

Sales Tools → **Inventory Lookup** (`inventory-lookup.html`, grant under Sales). Added 2026-10-26 for the team — the ePASS "Serial Inventory" screen, rebuilt on the live feeds and NetSuite's words.

## Filters

- **Merch category → class → subclass** — NetSuite's hierarchy, cascading: pick a category and the class list shrinks to its classes, pick a class and the subclass list follows. Counts in brackets are models.
- **Model / Brand / Description** — three searches, each `contains` (default), `starts with` or `ends with`; combined with AND. Model matching ignores punctuation (`CL4850UFD/O` finds `CL4850UFDO`). Brand matches the NetSuite brand name or the ePASS brand code.
- **On hand only** — models with at least one unit in stock.
- **Active or in-stock only** (on by default) — a model shows when it has stock, or NetSuite has it and it isn't discontinued. Turn it off to find archive units: discontinued models and ePASS models NetSuite never carried.

Written and on-order quantities are deliberately not on this screen (Andrew: "that's really not important for inventory lookup" — the Ordering Report has them). Filters are remembered per browser.

## Results

One row per model, stocked models first: brand, model, description, NetSuite class · subclass (ePASS product code when NetSuite has no class), then the counts — **On hand**, **Available** (green), **Likely** (amber), **Spoken for**, **Reserved** (+ exclusive). A model NetSuite doesn't have yet carries a small "ePASS" tag.

## The drawer

Tap a row. Same shape as the Ordering Report's position drawer, minus cost and the ordering sections: header with brand · supplier · category › class › subclass, tiles for on hand / available to sell / likely available / spoken for / reserved, delivered-by-month when Sales Order Detail has it, and every unit on hand with:

| Status | Rule |
| --- | --- |
| **Available to sell** | not written to an order, not reserved |
| **Likely available to sell** | written to an order whose delivery or pickup date is more than **60 days** out — shown with the days and the salesperson to check with before promising it |
| **Spoken for** | written to an order inside 60 days (or with no date yet) |
| **Reserved** | ePASS DateReserved (held for someone), with the date |
| **Exclusive reserve** | ePASS Reserve Exclusive — display / open-box unit kept out of auto-allocation |

Plus the order, customer and salesperson, schedule or pickup date, job status, received date and age, location / bin, serial type and serial number. No cost column — this is a sales screen; say the word if the team should see it.

## Where the data comes from

The shop inventory snapshot (every on-hand serial from the ePASS feed, rebuilt after each pull), `epass_open_orders` for the written-to order's customer, dates and job status, NetSuite through the catalog resolver (brand, supplier, hierarchy, discontinued), and `epass_model_master` for models ePASS knows but has none of. The index is rebuilt after every feed pull and every NetSuite import, otherwise at most every five minutes. The 60-day threshold is `LIKELY_AVAILABLE_DAYS` in `lib/inventory-lookup.js`.

## Routes

`GET /api/inventory-lookup/options` (tree, totals, feed time) · `GET /api/inventory-lookup` (`category, cls, subclass, model, modelMode, brand, brandMode, description, descMode, onHand, active, limit`) · `GET /api/inventory-lookup/model/:model`. Opening a model is audited (`inventory_lookup_model_viewed`).
