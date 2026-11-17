# Payment links: one payment showing on two rows

*Written 11/17, after S00065174 showed one $9,831.00 link payment twice in Paid History.*

## What happened

Before the 11/16 fix, asking for the same link twice (same order, phone, amount and type) filed a second row that pointed at the first row's Stripe link. The first row was paid at 4:28 PM. The second row sat in the queue on *Sent*.

**Sync** asks Stripe whether a row's link has been paid. For the second row Stripe said yes, because the 4:28 PM payment was made on that same link. Sync marked the second row paid as well, with the first payment's intent (`pi_…`), and dated it the moment the button was pressed (5:08 PM). Paid History then showed three $9,831.00 rows for the order: the link payment, its copy, and the separate card-reader payment at 5:45 PM. Only two payments were taken.

Sync also sends the salesperson's "paid" email the first time a row is marked paid, so one went out for the copy too.

## What happens now

**One Stripe payment sits on one row.**

- **Sync on a stuck second row** closes it as a *Duplicate*: no money, no payment intent, and a reason that names the row holding the payment. Nothing is sent to anyone and nothing changes in Stripe.
- **A duplicate can't be reactivated.** Reactivating would switch a paid Stripe link back on. If the client owes another payment, make a new link on Create Link.
- **If Stripe sends an event again**, it goes to the row that already carries the payment, not to a newer row that only shares the link.
- **A card payment synced by hand is dated when the card was charged.** It used to be dated the moment Sync was pressed whenever the link offered both card and bank transfer. A real bank transfer synced by hand is still dated at the sync.

New links don't share a Stripe link any more (11/16), so new duplicates of this kind can't be made. The rows above cover the second rows already on file.

## Removing a duplicate that is already marked paid

Paid History flags any link row that carries the same payment intent as an earlier-paid row:

- A notice above the table lists every flagged row, whatever the date filter is set to.
- In the table the row is tinted, marked **Duplicate**, its amount is struck through, and it says which row holds the payment.
- **View Summary** leaves flagged rows out of the day's totals.

Executives see **Remove duplicate** on the row and in the notice. It asks first, then closes the row as a Duplicate. The original row is not touched, nothing is refunded and nothing changes in Stripe. The row stays on file under *Deactivated only* in the queue, and the removal is in the audit log (`payment_link_duplicate_removed`: who, which row, which payment, both dates).

The row the payment was first recorded on can't be removed, and neither can a paid row with no copy.

## For developers

- `server.js`, beside the Sync route: `findLinkRowHoldingPayment`, `closeLinkRecordAsDuplicate`, `pickOriginalPaidLinkRow`, `flagDuplicatePaidLinkRows`. A closed duplicate has `status: deactivated`, no `paidAmount`/`paidDate`/`paymentIntentId`/`checkoutSessionId`, and `paymentStatusDetail: "duplicate_record"`. No new columns.
- `POST /api/payment-links/:id/sync-from-stripe` picks a paid session no other row holds; if every paid session is held, the row is closed as a duplicate (or left alone with a message when it is already marked paid).
- `POST /api/payment-links/:id/remove-duplicate` is behind `requireExecutiveApi`.
- `PATCH /api/payment-links/:id/status` refuses `sent` for a duplicate, or for any row whose Stripe link another row was paid through.
- `processCheckoutSessionWebhookEvent` matches on session or intent first, then on the Stripe link, skipping closed duplicates.
- `GET /api/payment-link-status` adds `duplicateOfId` / `duplicateOfPaidDate` to flagged rows and `canRemoveDuplicates` to the response.
- Stripe-based reports (sales, bank balancing) are built from Stripe charges, one row per charge, so they never counted the copy.
