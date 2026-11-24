# Charging a web order's saved card

*Added 11/20. Andrew: "For the online shop orders, there needs to be a charge card option for the sales DIBS claimer that auto fills the charge a saved card with SETI"*

At checkout the shop saves the shopper's card with Stripe (a SetupIntent, "SETI") and charges nothing. The consultant who claims the order now charges that card from the order itself.

## How it works

1. **Claim the order** on **Online Shop Orders**. A **Charge card** button appears on it, next to the ePASS ticket box.
2. **Type the ePASS ticket #** in that box if the ticket is built (optional), then click **Charge card**.
3. **Charge Saved Card opens with everything filled in:**
   - the SetupIntent, the Stripe customer and the saved card (the same as **Lookup saved card** would find)
   - the client's name
   - the amount: the order's **estimated total**
   - the description: "Online order WEB-1234"
   - the department: **Appliance**
   - the Sales / Service Order #: the ePASS ticket typed on the order, or the completed order's ticket; otherwise it's left empty to fill in
   - the employee code, from the sign-in, as always
4. **A note at the top** names the order, its claimer, the card and the estimated total.
5. **Check the amount** against the ePASS ticket, fill in the ticket # if it's empty, and click **Charge saved card**. Nothing is charged before that click.
6. **After the charge**, the page says it was recorded on the order, that the order is completed under the ticket #, and links back to Online Shop Orders.
   - The order is **completed** under the Sales / Service Order # used on the charge (see below). It leaves the Open list and sits under **Completed**.
   - The order shows a green **Charged $X** tag.
   - Each charge is listed in the order's details: amount, when, who, and the ticket #.
   - The button becomes **Charge card again**.

## Charging closes the order

*Added 11/24. Andrew, looking at a claimed order that had been charged and was still open: "Can this automatically close with the sales order number when the card is charged?"*

Before, a charged order stayed open until someone typed the ticket # a second time and pressed **Complete order**. Now a successful charge on a **claimed** order completes it, under the **Sales / Service Order #** entered on the charge. It is the same completion as the button: the order's ePASS ticket is set, its units go from the web lock to **Sold** under that ticket on the hit list, and the new-order flags on the floor's dashboards are cleared. Nothing is sent to the client.

- **Any amount closes it.** The charge names the ticket, so the order is finished as that ticket whether the amount is the estimated total, the ticket's own total, or part of it. A balance can still be charged afterward with **Charge card again**; that is recorded and the order's ticket is left alone.
- **The number has to be right.** It becomes the order's ePASS ticket and the Sold-under number on the hit list. Charge Saved Card says so above the form before the charge: "Charging completes WEB-1234 under the Sales / Service Order # below."
- **Who.** The order's claimer or an executive, the same people who can charge from the order. The order stays credited to its claimer.
- **Schedule by hand orders close too.** The tag and the delivery note stay on the completed order, but it is no longer on the Open list. Set the delivery day from the ePASS ticket.
- **Complete order is still there** for an order that is finished without charging its saved card here (paid another way).
- The audit entry is the usual `shop_order_completed`, with `byCharge: true` and the payment.

## Who can charge

- **The order's claimer.** Someone else's claimed order has no Charge card button. If its link is opened anyway, the page says whose order it is and fills nothing.
- **Executives,** on any claimed or completed order.
- **Only people with Charge Saved Card.** The sales job preset already includes it. Without it, the button doesn't show.

**When an order can be charged:**

- **Claimed orders.**
- **Completed orders,** for a balance or a change on the ticket.
  - Charged by whoever claimed them, or an executive.
  - An order completed without ever being claimed is executive-only.
- **Not new (unclaimed) or canceled orders.**

## Charging twice

If the order already has a charge, the note at the top turns amber and shows **Already charged $X**, with each charge listed.

- **For a balance,** change the amount to what's still owed.
- **Otherwise, don't charge again.**

Clicking **Charge saved card** twice with exactly the same details is one charge. Stripe treats the repeat as the same request.

## Other ways in

- **Lookup saved card on Charge Saved Card.**
  - Pasting a web order's SETI still fills the card. The page also says which online order the card was saved with, and who claimed it.
  - A charge made that way is still recorded on the order, matched by the SetupIntent.
  - It closes the order only when the person charging is the order's claimer or an executive. Anyone else's charge is recorded and the order stays open for its claimer.
  - **Fixed along the way:** before, looking up a shop card there also filed a blank request in the service queue. Shop cards no longer touch the service queue. Service cards work exactly as before.
- **The public service confirmation page** checks card status by SETI without a sign-in. For a shop card it now gets only the brand and last four, not the Stripe customer or card IDs.

## What goes to Stripe and the payments dashboard

The charge is an ordinary card-on-file charge: it appears on the payments dashboard like any other. Three things are added for a web order:

- **`web_order`** (like `WEB-1234`) in the payment's Stripe metadata.
- **The client's email** from the order, when the page didn't send one.
- **An audit entry,** `shop_order_charged`, with the order number, payment, amount and ticket.

## Checked before delivery

The real `server.js` ran against a local test database with made-up orders and users. Stripe was answered by a local stand-in, so nothing reached Stripe. 56 of 56 checks passed, and the earlier 17 Charge Saved Card department checks still pass. With the 11/24 change it is 74 of 74, and the 17 still pass.

- **Prefill:**
  - The claimer gets the SETI, customer, card, client, total and Appliance.
  - Someone else's order is refused, naming its claimer.
  - So are an unclaimed, canceled or never-claimed completed order (except, for the last, by an executive).
  - Someone without Charge Saved Card is refused.
- **Charging:**
  - Stripe got the order number, the client's email and the right amount on the saved card.
  - The charge was recorded on the order and audited once.
  - Sending the same charge twice recorded one.
  - A different Stripe customer against the order was refused, and so was another person's order.
  - An ordinary service charge was unchanged.
- **Closing by charge (11/24):**
  - The claimer's charge completed the order under the charge's ticket #, once, still credited to the claimer; the audit entry says it was by the charge.
  - The claimer charging through the manual lookup closed it too, and its unit went to Sold under the ticket on the hit list.
  - A charge by someone who isn't the claimer was recorded and left the order open.
  - An executive charging someone's order closed it and left it theirs.
  - A charge on an already completed order was recorded and its ticket was not changed.
  - Complete order still closed an uncharged order, and a completed order could not be completed again.
  - On the pages: the note warned before charging, the charge said the order was completed under the number, and the order had moved from Open to Completed with **Charge card again**.
- **The service lookup:**
  - A shop card filled the IDs and named its order, filed nothing in the service queue, and showed only brand and last four when signed out.
  - A service card still filed its request as before.
- **The pages** (desktop and phone, no page errors):
  - The Charge card button showed only on the right orders.
  - Clicking it filled every field, the typed ePASS ticket included.
  - Charging from the page recorded the charge, and Online Shop Orders then showed **Charged $1,622.67**.
  - An already-charged order showed the amber warning.

## For developers

- **`lib/shop-postgres.js`:**
  - New column `shop_orders.card_charges` (JSONB list: `paymentIntentId`, `amount`, `salesOrder`, `at`, `byEmail`, `byName`), added by `ALTER TABLE … IF NOT EXISTS` at startup.
  - `mapOrder` returns it as `cardCharges`.
  - `recordShopOrderCharge` appends once per PaymentIntent.
  - `getShopOrderBySetupIntent` finds the order a card came from.
- **`server.js`:**
  - `GET /api/shop-orders` adds `viewer: { email, isExecutive, canCharge }`.
  - **`GET /api/shop-orders/:id/charge-prefill`:**
    - Gated by the Charge Saved Card page grant, then `shopOrderChargeRefusal` (claimer or executive; claimed or completed; has a SETI).
    - Retrieves the SetupIntent with its payment method and requires it succeeded.
    - Returns the IDs, card, client, `amount` (estimated total), `salesOrder` (ePASS ticket or empty), description, department, claimer and earlier charges.
  - **`POST /api/card-on-file/charge`:**
    - Accepts `webOrderId`, held to the same rule, and requires `customerId` to match the order's Stripe customer.
    - Without `webOrderId`, a `setupIntentId` that belongs to a shop order is matched to it.
    - Either way it adds `web_order` to the metadata, defaults the client's email from the order, records the charge on the order and audits `shop_order_charged`.
    - 11/24: a succeeded charge on a `claimed` order that passes `shopOrderChargeRefusal` then calls `finishShopOrderAsTicket` with the charge's sales order # (trimmed, 60 characters).
    - The response adds `webOrderNumber`, and `webOrderCompleted` with `webOrderTicket` when the charge closed the order.
  - **`finishShopOrderAsTicket(req, id, epassTicket, auditExtra)`** (11/24): `completeShopOrder`, `upgradeWebToSold` per unit, the `shop_order_completed` audit and `retirePushedNotificationsByRef`. `POST /api/shop-orders/:id/complete` and the charge both use it.
  - **`GET /api/service/setup-intent-result/:id`:**
    - A SetupIntent with `metadata.source === "online_shop"` returns before the service-queue code.
    - Full IDs go to a signed-in user with Charge Saved Card. The session is read directly, because the path skips sign-in on the service host.
- **`shop-orders.html`:** `canChargeOrder`, `chargeButton` (opens `charge-saved-card.html?webOrder=<id>&ticket=<typed>`), the **Charged** tag and the charge lines.
- **`charge-saved-card.html`:**
  - `loadWebOrderPrefillIfPresent` runs before the other prefills.
  - The `#webOrderNote` banner; `webOrderId` in the payload.
  - The manual lookup handles `webOrder`.
  - Typing or auto-filling a valid employee code now clears only the "Employee code not found" message. Before, the sign-in autofill wiped whatever a prefill had just said.
