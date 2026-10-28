# Payment links — ACH only

Home page → Create Payment Link. Added 2026-10-28 (Andrew: "allow Agility users to disable credit card and force clients to pay with ACH").

## What it does

An **ACH Only Link** toggle on the form (under Amount), shown for **One-Time Payment Link** only:

- **Off** (default) — nothing changes: the link offers whatever the Stripe dashboard has enabled (card + US bank account), exactly as before.
- **On** — the Stripe Payment Link is created with `payment_method_types: ["us_bank_account"]`, so the client sees only the bank-account option on the Stripe checkout page. No card fields at all. The toggle resets to off whenever the link type changes.

Stored on the link record as `paymentMethods: "ach" | "any"` and in the Stripe metadata as `payment_methods`, so the choice is visible on the Stripe payment and in Agility's data. The 10-minute duplicate guard treats an ACH-only link and a card-or-ACH link for the same order as different links.

## What to tell the client

ACH payments clear in 3–5 business days. The link flips to *processing* when the client submits the bank details and to *paid* when the bank settles — the same pending-ACH handling the dashboard already has for bank payments on ordinary links. A failed ACH (insufficient funds, closed account) comes back as a failed payment on the dashboard days later, not instantly like a card decline — don't release goods on *processing*.

## Why not on the other two link types

- **Deposit Agreement Link** saves the payment method for the balance charge later; that balance charge (Charge Saved Card) is card-only today. Allowing ACH there means also teaching the balance charge to debit a saved bank account with its mandate — say the word and it can be done, it's a contained change.
- **SetupIntent Capture** exists to save a card, so there is nothing to restrict.

The form hides the toggle for those two types and the server ignores the value for them regardless of what a client sends.
