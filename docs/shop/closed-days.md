# Closed days on the shop

*Added 11/23. Andrew: "Do I have anywhere today to turn off delivery on holidays? Right now users can 'schedule' for thanksgiving day." There was nowhere: the shop skipped Sundays and nothing else.*

## What a closed day does

On a closed day the shop offers **no delivery day, no pickup day and no showroom visit**. The day also doesn't count as a working day, so "three working days out" steps over it. With Thanksgiving on Thursday 11/26, a shopper on Monday 11/23 is offered Friday 11/27, Saturday 11/28 and Monday 11/30 for standard delivery.

Same-day installs are not offered on a closed day either.

The server refuses a closed day at checkout too, so a cart page that was open before the day was closed can't book it. The shopper is asked to pick another day.

Orders already filed for a day are not touched. If a day is closed after someone booked it, the order still shows on Online Shop Orders with its date; reach the client the way they asked to be contacted.

## Two sources

| Source | Where it is set | Who |
| --- | --- | --- |
| **Company holidays** | The paid holidays in the Time Off policy. Standard list: New Year's Day, Independence Day, Thanksgiving, Christmas Day. Day after Thanksgiving, Christmas Eve and the others can be ticked there. | Executives |
| **Extra closed days** | Online Shop Orders, **Closed days**: pick the day, give a reason (internal, never shown to shoppers), Add closed day. Remove opens it again. | Anyone with Online Shop Orders |

Nothing has to be entered for a holiday: ticking it in the Time Off policy closes it on the shop, this year and next. The Closed days card lists both kinds, soonest first, and shows the next three delivery days and the next pickup days a shopper would be offered right now, so a change can be checked on the spot.

Changes apply to the live shop immediately. A date that is already a company holiday can't be added a second time, and a past date is refused.

## Where it lives

- `lib/shop-closed-days.js`: table `shop_closed_days` (day, label, added by, added at).
- `server.js`: `shopClosedMap` (holidays for this year and next from `holidayDates`, plus the extra days), refreshed on every change, on a Time Off policy save, and every five minutes; `shopDayClosed(date)` is used by `shopDeliveryDateChoices`, `shopExpressDateChoices`, `shopPickupDateChoices` and `subzeroSlotTimesForDate`. Routes: `GET` / `POST /api/shop/closed-days`, `DELETE /api/shop/closed-days/:date` (Online Shop Orders permission; audit `shop_closed_day_added`, `shop_closed_day_removed`).
- `shop-orders.html`: the Closed days card.

## Not covered

- Half days (closing early on Christmas Eve). Close the whole day, or leave it open.
- The service team's calendar and the delivery board: this only governs what the shop offers online.
