# Inventory feed for an outside website

Added 2026-10-22 for Andrew: a read-only, keyed feed so a website built on another service can see Wilson's on-hand inventory — model, serial, serial type — without anyone else being able to.

## The URLs

```
https://<agility host>/api/feeds/inventory.csv
https://<agility host>/api/feeds/inventory.json
```

Both return the same rows; pick whichever the other site can read. Add `?all=1` to include held units with a reason (see "What is in it").

## How the other site proves it is allowed

There is one secret key, `INVENTORY_FEED_KEY`, that lives **only** in Render's environment (never in the repo, never in a page). The other site has to send that key with every request. Three ways, best first:

1. **`Authorization: Bearer <key>`** header — the normal way for a server-to-server pull.
2. **`X-Feed-Key: <key>`** header — same strength, for tools that let you add a custom header but not an Authorization header.
3. **`?key=<key>`** on the URL — for site builders that can only be given a URL. It works, but a URL is the weakest place to carry a secret: it ends up in the other service's logs, in browser history if anyone opens it, and in anything that copies the link. Use it only if the builder cannot send a header, and never paste that URL into an email or a page.

The key is compared timing-safe (the server does not leak how many characters matched). A missing key, a wrong key, and "the feed is not set up yet" all get the same `401 Unauthorized`, so an outsider cannot tell which it was.

Second lock, optional: `INVENTORY_FEED_ALLOW_IPS` — a comma-separated list of the other site's outbound IP addresses. When it is set, a request from any other address is refused even with the right key. Most hosting services publish their outbound IPs; set this once you have them.

Every request is rate-limited (60 per 10 minutes per address — a site that polls every 10 minutes is nowhere near it) and audited: refusals are written to the audit log every time (`inventory_feed_denied`, with how the key was presented and whether the IP was allowed); successful pulls once per address per 15 minutes with the count (`inventory_feed_pulled`).

### Making the key

Any long random string. On the laptop, in PowerShell:

```
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

or on a Mac / Linux shell: `openssl rand -hex 32`. Put it in Render → the Agility service → Environment as `INVENTORY_FEED_KEY`, redeploy, then give the same value to the other site. Do not reuse `SHOP_SNAPSHOT_KEY` or `EPASS_AGENT_KEY` — each outside party gets its own key so one can be changed without touching the others.

### Rotating or revoking

Change `INVENTORY_FEED_KEY` in Render and redeploy; the old key stops working the moment the new build is live. To cut the other site off entirely, remove the variable — the feed then answers 401 to everyone. Nothing in Agility's own pages uses this key, so rotating it breaks nothing here.

## What is in it

The rows come from the shop inventory snapshot — the ePASS feed's on-hand serials, the same source the online clearance shop sells from (rebuilt after every feed pull, so it is at most about 15 minutes behind ePASS). One row per unit:

| Column | Meaning |
| --- | --- |
| Model | ePASS model code |
| Serial | serial number (upper-cased) |
| SerialType | ePASS serial type — `ALL` is new/boxed; others (`OB`, `DSP`, …) are open-box, display, etc. |
| Brand | brand name (from the NetSuite catalog when it has the model, else the ePASS brand table) |
| Description | model description |
| ProductCode | ePASS product code (`REF`, `DW`, `RNG` …) |
| Received | date the unit was received, `yyyy-mm-dd` |
| Status | `available`, or why it is held (only with `?all=1`) |

**By default only units a customer could actually buy are included**: not written to an invoice, not reserved for someone in ePASS (the "Reserve Exclusive" display/open-box flag does not count as reserved), not already sold or held on the online shop, and not a brand on the *Brands not sold online* list in Shop Orders (Sub-Zero, Wolf, Cove, Gaggenau — those never appear on an outside site either).

`?all=1` includes every on-hand unit and fills Status with `written to <invoice>`, `reserved`, `online sold` / `online held`, or `not sold online`.

**Never on this feed:** cost, landed cost, tag price, unique price, list, MAP, location, bin, or anything about the customer a unit is written to. If the other site needs prices, that is a separate conversation.

The JSON form is `{ asOf, source, count, units: [ { model, serial, serialType, brand, description, productCode, received, status } ] }`. Both forms carry an `X-Inventory-As-Of` header with the snapshot time, and `Cache-Control: no-store` so nothing between the two servers keeps a copy.

## Testing it yourself

From the laptop, with the key in a variable:

```
curl -H "Authorization: Bearer $KEY" https://<agility host>/api/feeds/inventory.csv
```

or in PowerShell: `Invoke-WebRequest -Headers @{ Authorization = "Bearer $KEY" } https://<agility host>/api/feeds/inventory.csv -OutFile inventory.csv`.

Without the header you should get `{"error":"Unauthorized."}`.
