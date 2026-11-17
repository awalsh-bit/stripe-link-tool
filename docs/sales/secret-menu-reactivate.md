# Secret Menu: reactivating an expired item

*Added 11/16. Executives can bring an expired Secret Menu item back from the Secret Menu page itself.*

## What "expired" means

A Secret Menu item is a card from the Promo Item Builder. A card with an end date drops off the Secret Menu the day after that date. The sales team never sees an expired card.

## Reactivating

Executives only.

1. Open **Secret Menu**. If anything has expired, a **Show expired (N)** chip appears beside the brand filters. Click it.
2. Each expired item shows *Expired 11/10/2026* and a **Reactivate** button.
3. Press it, pick the new **Valid through** date (it starts a week out), and press **Reactivate**. Clearing the date gives the item no end date.

The item is back on the Secret Menu for the whole sales team straight away. Only the end date changes: items, quantities, prices, delivery and install charges and the card's position stay as they were. If a unit on the card has since sold, the card comes back showing that problem, the same as any other card.

Every reactivation is in the audit log (`secret_menu_card_reactivated`): who, which item, when it had expired, and the new end date.

## What can't be reactivated here

- A card that was **unpublished** or **archived** in the Promo Item Builder. Those were taken down on purpose; publish it again from the builder.
- A card that isn't on the Secret Menu channel.
- A card that hasn't expired.

People who hold the **Promo Item Builder** page can still change any card's dates there, as before. This button is the shortcut for executives who don't want to open the builder.

## Two things that changed alongside it

- **The sale window runs on the store's clock.** A card "valid through the 16th" now stays on the menu until midnight store time (Central). It used to drop off at 6 or 7 PM that evening, when the date turns over in UTC, and a card starting the next day used to appear at the same hour.
- **Unit cost no longer travels to the Secret Menu page.** It was never shown, but each item's ePASS cost was in the data the page received. The builder still has it.

## For developers

- `lib/promo-cards-postgres.js`: `reactivatePromoCard(id, { endsOn, today, byEmail })` updates `ends_on` only, in one statement that also checks the card is published and expired.
- `server.js`: `GET /api/secret-menu` adds expired published secret-channel cards (marked `expired`) for executives, sends `_meta.canReactivate` and `_meta.today`, and strips `cost` from items. `POST /api/secret-menu/cards/:id/reactivate` is behind `requireExecutiveApi`. `promoToday()` is the store's date and is what `resolvePromoCardsLive` now passes as `today`.
- `secret-menu.html`: the Reactivate control is drawn only when the server says `canReactivate` and the card is `expired`.
