# Secret Menu: reactivating an expired item

*Added 11/16, corrected 11/17. Executives can bring an expired Secret Menu item back from the Secret Menu page itself.*

## Two kinds of Secret Menu item

- **The old hand-kept list.** The eight items in `data/secret-menu.json`, made from the June spreadsheet. This is what the Secret Menu shows today.
- **Promo Item Builder cards.** The Secret Menu switches to these, and stops showing the old list, the first time a card is published to the Secret Menu channel in the builder.

The 11/16 version only reactivated builder cards, so the button never appeared on the live menu. Since 11/17 it works on both.

## What "expired" means

- **Old list:** an item's expiration is either a fixed date, or "always two days out, until a date". Once that date has passed the item reads *Expired 7/15/2026* and sits behind **Show expired**. Anyone on the sales team can still look at it there. Items marked *Until Out of Stock* never expire.
- **Builder cards:** a card with an end date drops off the Secret Menu the day after that date. The sales team never sees an expired card.

## Reactivating

Executives only.

1. Open **Secret Menu**. If anything has expired, a **Show expired (N)** chip appears beside the brand filters. Click it.
2. Each expired item shows *Expired …* and a **Reactivate** button.
3. Press it, pick the new **Valid through** date (it starts a week out), and press **Reactivate**. Clearing the date gives the item no end date.

The item is back on the Secret Menu for the whole sales team straight away. Only the date changes: prices, promo and required lines, items and quantities stay as they were.

An old-list item that counted down "two days out" keeps doing that; the date you pick is where it stops. So an item reactivated through 12/31 reads *Valid through* two days from today, every day, until 12/31.

Every reactivation is in the audit log: who, which item, the old expiration and the new one (`secret_menu_item_reactivated` for the old list, `secret_menu_card_reactivated` for builder cards).

## What can't be reactivated here

- An item that hasn't expired, including *Until Out of Stock* items.
- A builder card that was **unpublished** or **archived**. Those were taken down on purpose; publish it again from the builder.
- A builder card that isn't on the Secret Menu channel.

To change the date on an item that is still running: for a builder card, use the **Ends** date in the Promo Item Builder. An old-list item has no editor; its date is in the file.

## Where an old-list date is kept

The old list is a file, and the server can't change its files, so a reactivated date is saved in the database and laid over the file's value. It survives deploys and restarts.

If the expiration for that item is later edited in `data/secret-menu.json` itself, the file's new value takes over again.

## Two things that changed alongside it (11/16)

- **The sale window runs on the store's clock.** A card "valid through the 16th" now stays on the menu until midnight store time (Central). It used to drop off at 6 or 7 PM that evening, when the date turns over in UTC, and a card starting the next day used to appear at the same hour. Since 11/17 the old list's dates use the store's clock as well.
- **Unit cost no longer travels to the Secret Menu page.** It was never shown, but each item's ePASS cost was in the data the page received. The builder still has it.

## For developers

- `lib/promo-cards-postgres.js`: `reactivatePromoCard(id, { endsOn, today, byEmail })` updates `ends_on` only, in one statement that also checks the card is published and expired. For the old list: table `secret_menu_item_dates` (model key, `replaces`, `expiration`), `listSecretMenuItemDates()`, `secretMenuItemExpiration(item, dates)`, `reactivateSecretMenuItem(model, { fileExpiration, currentExpiration, endsOn, today, byEmail })`, and the pure date rules `legacyExpirationEnd`, `legacyExpirationIsExpired`, `legacyExpirationWithNewEnd`.
- `server.js`: `GET /api/secret-menu` sends `_meta.canReactivate` and `_meta.today` in both modes. In builder mode it adds expired published secret-channel cards (marked `expired`) for executives and strips `cost`. In old-list mode it lays saved dates over the file. `POST /api/secret-menu/cards/:id/reactivate` and `POST /api/secret-menu/items/reactivate` (body `{ model, endsOn }`) are behind `requireExecutiveApi`; the second answers 409 once builder cards exist. `promoToday()` is the store's date.
- `secret-menu.html`: one expiration strip for both kinds. Reactivate is drawn only when the server says `canReactivate` and the item is expired. A builder card's id is a number; an old-list item's is `m` plus the model.
