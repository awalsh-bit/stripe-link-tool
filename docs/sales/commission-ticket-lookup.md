# Sales Commissions: "Where is a ticket?"

Andrew, 11/18: "the -1 ticket carrying the B36CD80SNS that was delivered and
stayed in the client's home wasn't on the sales commission report."

## What it is

A box on Sales Commissions, under the month picker. Type a ticket number
(R00015948 or R00015948-1, either works) and it lists every unit on that
ticket and on its suffix tickets, oldest ticket first, with:

- the ticket's finish date, the statement month that puts it in, and the salesperson
- for each unit: model, serial, what it sold for, whether ePASS flags it Returned, its serial type
- where it is on the statements, in a sentence: pays (rate and dollars), held
  for an unpaid invoice, on the statement at 0% and why, in the folded
  "excluded lines" and why, or not on a statement and why
- if that rep's statement for the month has been posted, the date it was posted

"Run Oct 2026" on a ticket opens that month. The lookup only reads. It shows
no cost and no margin. Anyone who can open Sales Commissions can use it.

## Why a unit can be "missing"

Statements are built one month at a time from the units on that month's
finished tickets. The statement itself cannot show any of these:

1. The ticket finished in another month. A -1 has its own finish date.
2. The unit is listed, but in the folded excluded lines (RTV, SVC, or omitted by an executive).
3. The unit is listed but held (invoice unpaid), or pays 0% (margin floor, no cost in ePASS, Showroom line not marked Select).
4. The month runs from an uploaded Crystal report, which wins over the feed.
5. The ticket has no salesperson, or its department is not on the unit plans.

## What an exchange does today (found 11/18, not changed)

A unit comes back and the same model goes out on a -1. The serial type on
every line is the type ePASS holds for that serial today, read from the
Serial master on each pull, not the type it had the day it sold. So what the
first sale pays depends on what the warehouse does with the returned unit
afterwards. Tested with a stand-in feed (sale 10/30, -1 on 11/3):

| Returned unit is typed | Original ticket's month | The -1's month | Result |
|---|---|---|---|
| RTV | line moves to excluded, stops paying | kept unit pays | paid once, a month late |
| left as ALL | keeps paying | kept unit pays | paid twice |
| OPEN | pays the 5% closeout rate instead | kept unit pays | paid twice, first one at the wrong rate |

The returned unit's own line on the -1 is always excluded at $0, so nothing
is charged back. A month already posted to a rep keeps the rep's copy as
posted; the live page keeps following the feed.

Open decision for Andrew: make an even exchange pay exactly once, and say in
which month (the original ticket's, or the -1's).

## Files

- `lib/commission-ticket-trace.js` the lookup (pure; no database)
- `lib/epass-sold-serials-postgres.js` `listSoldUnitsForTicket`
- `server.js` `GET /api/field-commissions/ticket?ticket=`
- `commissions.html` the box and its result
