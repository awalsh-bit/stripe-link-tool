# Speed Queen Truckload Builder: QOO from ePASS

*Changed 11/17.*

QOO (units on order) used to be a number someone typed, or filled by uploading the ePASS Model Maintenance export. A purchase order placed in ePASS never reached the builder, so the forecast kept asking for units already ordered.

QOO now comes from the ePASS feed.

## How it works

- Every pull sends ePASS's own on-order count for each model that has anything on order. It is the same QOO that Model Maintenance shows.
- Each Speed Queen model in the builder takes that number. A predecessor model number's units count toward the current model, as sales and on-hand already do.
- A model ePASS has nothing on order for is set to 0.
- The line under the tiles reads **On order: (time) · ePASS feed**.

While the feed is sending QOO, the column is a plain number: there is nothing to type and the Upload Model Maintenance button is hidden.

If the feed hasn't sent QOO for a day, the boxes and the upload button come back by themselves, holding the last numbers, and the line reads *typed or uploaded · ePASS last sent it (time)*.

## One step on the ePASS server

The pull script changed, and the copy that runs is the one on the ePASS server.

1. Copy `scripts\epass-odbc-pull.ps1` from this repo over `C:\Agility\epass-odbc-pull.ps1` on the ePASS server.
2. After the next run, `C:\Agility\odbc.log` has a line starting `models-on-order:` with a row count.
3. The builder's line under the tiles changes to *ePASS feed* within a few minutes.

Until that copy is made, nothing changes: QOO stays typed or uploaded, exactly as before. The order of the push and the copy doesn't matter.

## For developers

- `scripts/epass-odbc-pull.ps1`: dataset `models-on-order` in the sales bundle: `Code`, `BrandCode`, `TotalQOO` for every model with `TotalQOO > 0`. Guarded like the other optional views.
- `server.js`: the `epass-open-orders` upload keeps that dataset and calls `applySqFeedQoo` right after the inventory snapshot. A bundle without the dataset leaves QOO alone; an empty dataset means nothing is on order.
- `lib/speedqueen-truckload-postgres.js`: `applySqFeedQoo(rows, { pulledAt })`, `getSqQooFeed()`; the board carries `sources.qoo = { at, pulledAt, live }`. The feed's note is kept in `sq_tl_settings` under `qoo_feed`, apart from the builder's own settings.
- `speedqueen-truckload.html`: QOO cells, the upload button and the sources line follow `sources.qoo.live`.
