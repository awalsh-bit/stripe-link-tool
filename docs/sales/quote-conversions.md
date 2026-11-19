# Quote Follow-Up: when a quote counts as converted

*Added 11/20. Andrew sent Bruno Debbie's opportunity card (quotes Q00085465 and Q00085548, salesperson SPR) and ePASS showing sales order R00016163, written 11/13 for $4,276.90 and still Open, delivering 11/20: "Can you double check conversion logic and why this conversion from quote to sale wasn't identified?"*

## Why it was missed

The board only looked at **finished** sales orders, the ones in the OE-23 warehouse (`sales_order_detail`, from the hourly finished-orders feed). A sale counted only once it was delivered and finished in ePASS. R00016163 is still open until its 11/20 delivery, so both of Debbie's quotes stayed on the board as if nothing had been bought.

Nothing else was wrong with the match. The customer number (4325599854), the salesperson (SPR) and the dates all agree.

## The rule now

A quote converts when ePASS has a sales order that meets all three:

- **Customer:** the same customer number as the quote. For an open order, either its sold-to or its bill-to code counts.
- **Salesperson:** the same salesperson (Salesperson 1).
- **Date:** dated on or after the quote. A finished order uses its finish date; an open order uses the date it was written.

The new part is the open order. Any sales order still open in ePASS counts (R, S, AC, CAB and MOD, not void, not finished). It comes from the 15-minute open-orders feed, so a sale shows on the board within 15 minutes of being written, without waiting for delivery.

**One order still closes every earlier quote (Andrew's call, 11/20).** Asked whether an order should close only the quote it came from, Andrew kept the rule as it was. R00016163 therefore converts both of Debbie's quotes, the $4,276.90 Bosch quote and the $20,508.62 Sub-Zero quote from 11/09. An automatic match has no Reopen button, so a quote the customer is still shopping stays under Converted.

**Unchanged:**

- A sale by another salesperson to the same customer doesn't convert. The card shows "this customer bought from …" instead, and that note now includes open orders too.
- **The three buttons** work as before. Missing Conversion and Opportunity Lost still win over an automatic match. A quote moved to Follow-Up Required converts when a matching order appears, as it always has.
- Service leads and website quotes still match by name within 30 days, on finished orders only.

## On the page

In **Converted**, a quote matched on an open order reads, for example, *R00016163 · written 11/13/26*, and *AUTO-MATCHED · open order*. Once the order finishes and the hourly finished-orders feed brings it in, the line shows the finish date and the "open order" note goes away.

## When an open order leaves the feed

An order drops out of the open-orders feed when it is finished or cancelled. A finished order arrives with the next hourly finished-orders run. So that the quote doesn't flicker back onto the board in between, its match is **held for 24 hours**. If no finished order has matched by then (the order was cancelled or voided), the quote goes back on the board.

If the finished-orders feed is ever switched off (`feed.finished_orders_enabled`), a delivered order comes back only with the next OE-23 upload. Until then its quotes would return to the board after those 24 hours.

## Checked before delivery

The real code was run on a local test database with made-up rows shaped like Debbie's card. All 14 checks passed:

- **Before the change:** with no open order, Q00085548 sat on the board, as Andrew saw.
- **The open order:** R00016163 converts Q00085548, marked open, written 11/13, at the order's pre-tax total. The 11/09 quote converts too.
- **What doesn't convert:** a quote written after the order, another salesperson's quote (it gets the "bought from SPR" note) and another customer's quote.
- **Bill-to match:** the order matches on its bill-to code when the sold-to code differs.
- **Order leaves the feed:** the match is held; 24 hours later with nothing finished, the quote is back on the board.
- **Finished order:** it takes over the match with its finish date and clears the open flags.
- **Older environment:** with no open-orders table, the finished-order match still runs.
- **Speed:** the full re-match of 12,000 quotes against 2,500 open orders and 60,000 finished orders took 0.7–0.9 s, against 0.65 s before. It runs after every 15-minute pull.
- **The page:** the Converted list shows "written 11/13/26" and "open order" with no page errors.

## For developers

- **`lib/quote-followup-postgres.js`:**
  - `refreshQuoteConversions` adds two laterals on `epass_open_orders`, `co` (same salesperson) and `oo` (another salesperson). They use the row's `Salesperson1Code` from `raw`, because the table's own `salesperson` column isn't the code.
  - The order of preference is finished, then open, then the name match for leads.
  - New columns: `conv_open` and `conv_seen_at`. The `keep_open` hold uses `OPEN_MATCH_GRACE`, which is 24 hours.
  - The open laterals are left out when the table doesn't exist.
  - New index: `epass_open_orders_bill_to`.
- **Board data:** the board sends `orderOpen` on automatic conversions.
- **`server.js`:** the sales-bundle post-processing re-runs `refreshQuoteConversions("open")` even when the open quotes are unchanged, because the open orders were just replaced. `replaceOpenQuotes` already did this when the quotes changed.
- **`quote-follow-up.html`:** the Converted list says "written" and "open order" for these matches.
