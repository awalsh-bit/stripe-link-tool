# Payment links: a second link for the same client and order

*Written 11/16, after a report that a second payment link for the same client and sales order couldn't be created.*

**Create Link** (`index.html`). This covers what happens when a link is asked for that matches one already made: same sales order, same phone, same amount, same link type.

## What was wrong

When a link was asked for twice with the same details, Stripe was sent the same request label both times. Stripe keeps the answer to a labelled request for at least 24 hours and gives that same answer back, so the "new" link was the first link again. That was harmless while the first link was unpaid. Once the first link had been paid or deactivated it was a dead link: the page said "Payment link created", the client got the "completed" message, and the dashboard gained a second row stuck on *sent* that pointed at the same used link.

The same thing made a failed create stick: if Stripe had a problem on the first try, every identical retry got that saved failure back.

## What happens now

| The earlier matching link is… | Asking again gives you |
|---|---|
| paid | a new link |
| deactivated | a new link |
| still unpaid, made in the last 24 hours | that same link, with a message saying so. Nothing new is made, and no second row appears. |
| still unpaid, older than 24 hours | a new link, with a warning that the old one is still open |

Every link that is made is a fresh Stripe link. Agility never hands back one that can't be paid.

## Two links for the same amount on purpose

After a link is created, the result box has **Create a second link**. Use it for two equal payments on one order (a deposit and a balance of the same amount), or one order split over two cards. It makes a new, separate link even while the first is still unpaid, and says so:

> Second link created for S00065174. It is separate from the one made 12 minutes ago, which is still open — if the client pays both, they pay twice. Deactivate the earlier one on the dashboard if it isn't needed.

Changing the description alone does not make a different request. A "Balance" link for the same amount as an unpaid "Deposit" link still counts as a repeat, and the message names the earlier link's description. Press **Create a second link** for that one. A different amount, a different order, a different phone or an ACH-only link is always its own link.

Card-capture links (save a card, charge nothing) don't offer a second link.

## For developers

- `server.js`, `POST /api/create-payment-link`. The double-create guard looks for an open twin (status `sent` or `viewed`, `active`, same type + order + phone + amount + pay method) and hands it back when it is under 24 hours old, unless the page sent `allowDuplicate: true`. The answer carries `duplicate` and `canCreateSeparate`, or `separate` with a warning when a new link was made alongside an open twin.
- The three Stripe idempotency keys (product, price, payment link) now hash a per-request id together with the request, so a retry inside one request is still safe and no later request can be answered with an earlier one's link.
- Identical requests are queued one at a time in memory (`paymentLinkCreateQueue`), so several at the same instant make one link and the rest are answered by the guard.
- Not changed: card-reader charges, saved-card charges and refunds build their Stripe keys the same content-only way, so an identical second request inside 24 hours gets the first one's result back from Stripe instead of a new charge or refund. They move money, so they were left alone here pending a decision.
