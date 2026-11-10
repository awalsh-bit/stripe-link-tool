# Installs & accessories by merch class

*Added 11/10. Which installs and install accessories the shop and the website offer with a product is set on Online Shop Orders — no file edit, no deploy.*

## Where

Online Shop Orders → **Installs & accessories by merch class** (`shop-orders.html#services`). Pick a **Merch Category** (15 Kitchen Appliances, 18 Appliance Cabinetry, 25 Laundry Appliances, 35 Plumbing, 85 Outdoor Living), or search for a class, subclass or item. Each Merch Class is a block: the class row on top, its subclasses underneath.

- **+ Assign to whole class** — every subclass in the class gets the item.
- **+ Assign** on a subclass — that subclass only.
- **✕ on an outlined chip** (an item that comes from the class) — drops it for that one subclass; it stays as a struck-through chip with **↺** to take it back.
- **✕ on a filled chip** — removes the assignment (on a class row it asks first, since it affects every subclass).
- *Only subclasses with nothing offered* lists what has no setup prompt at all.

What can be assigned: the **NetSuite service items** (the 62 installs) and **install accessories** (11) already in `data/shop-addons.json`, and any **ePASS misc charge** in the feed that is active and has a list price. A misc charge is offered at its ePASS list price with its ePASS tax flags, as an *accessory* or an *install service* (chosen when assigning; the picker guesses from the description and labor minutes). If ePASS later marks it obsolete or it loses its price, the shop stops offering it and the chip is outlined red here.

## How it resolves

`effective(subclass) = class items − the subclass's drops + the subclass's own`, listed in the order assigned. That set is what the shop's *Complete the setup* prompt shows and what `/api/shop/services` `byKey` returns to the website for every model in the subclass. On top of it, unchanged:

- **Finish** — where a set has both a no-panel and a with-panel install, NetSuite's finish picks one (`…-std` / `…-panel`).
- **Brand exceptions** (`variants` in the file) — DishDrawers and the pro-dishwasher brands swap the main install for their own; they keep anything added to the subclass here (a haul-away assigned to Dishwasher reaches a Miele too) and follow its accessories.
- **Required pairings** (`requires` in the file) — which accessory an install can't happen without.

## Storage

`shop_service_map (scope, code, item_id, mode, kind, updated_by, updated_at, seq)` — `scope` class / subclass, `mode` add / exclude, `item_id` an add-on id or `misc:<ePASS code>` (`lib/shop-service-map.js`). Until the first edit the table is empty and the shop runs on the file exactly as before. The first edit copies the file's map into the table (an item every subclass of a class already had becomes one class row) and from then on the table is the map; `loadShopData()` lays it over the file (`overlayAddons`). **Reset to defaults** empties the table. Every change and reset is audited (`shop_service_map_changed`, `shop_service_map_reset`). If the database can't be read, the shop falls back to the file rather than offering nothing.

Routes (behind the Shop Orders grant): `GET /api/shop/service-map`, `POST /api/shop/service-map` `{ scope, code, itemId, action: "add" | "remove", kind? }`, `POST /api/shop/service-map/reset`.
