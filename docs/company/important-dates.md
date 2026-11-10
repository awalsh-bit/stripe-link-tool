# Important Dates

*Added 11/6. A small company calendar — holidays, early closings, all-store meetings, potlucks — that every dashboard shows for the next 60 days, with an optional sign-up sheet per date.*

## Where it shows

**Dashboard → "Upcoming Important Dates"** sits directly above My Notifications and is hidden when nothing is coming up in the window. One line per date: when (with time if given), a colored kind pill, the title, details, and how far out it is. Multi-day dates ("Thu, Nov 26 – Fri, Nov 27") stay listed until their last day has passed.

A date with a sign-up sheet shows an underlined link under the title — by default *What's everyone bringing? (7)* — that opens a small sheet right on the dashboard: everyone's lines, a box to add your own, and a Remove link on your own lines. Nobody is pushed a notification; it's on the dashboard every day until the date passes.

## The builder

**Company Tools → HR → Important Dates** (`important-dates.html`, grant it on the Users page; it's in the HR page group with Christmas Party Planning).

Fields: title, kind (Company event · Paid holiday · Closing / early close · All-store meeting · Deadline · Other), date, optional "through" date, optional time text ("noon", "closing at 3"), optional details, the sign-up sheet tick, and optional link text for the sheet. Every date is listed below the form with an "on dashboards" tag when it's inside the 60-day window; Edit refills the form, Archive takes it off dashboards (restorable; "Show archived" lists them). The sign-up column shows the count with a *view* link; whoever holds this page can remove anyone's line.

## Data

Tables `important_dates` and `important_date_signups` (created on first use). Routes: `/api/important-dates/upcoming` and `/api/important-dates/:id/signups` (GET/POST/DELETE) for every signed-in user; `/api/important-dates` (GET/POST), `/api/important-dates/:id` (PUT) and `/api/important-dates/:id/archive` (POST) behind the page grant. The window is `UPCOMING_WINDOW_DAYS` in `lib/important-dates-postgres.js` (60), measured in Central time.

Audit actions: `important_date_created / updated / archived / restored`, `important_date_signup_added / removed`.

## RSVP mode (11/10)

A date's sign-up is one of two kinds, chosen in the builder's **Sign-up** menu:

- **Sign-up sheet — what are you bringing?** Free lines; a person can add several ("Smoked turkey", "Pecan pie"). The original potluck sheet.
- **RSVP — coming or not, with guests.** One answer per person: *I'll be there* or *Can't make it*, how many guests (Just me … +5), and an optional note (dietary needs, arriving late). Answering again replaces the earlier answer; *Clear* removes it. The sheet shows the tally — "4 coming (9 people with guests) · 1 can't make it" — and each person's line; the dashboard link reads "RSVP — are you coming? (4 coming)" unless the link text is overridden. The builder's table shows the same counts and the list.

Storage: `important_dates.signup_mode` (`bring` | `rsvp`); `important_date_signups.response` (`yes` | `no`) and `guests`, with the note in `item`. Existing sheets are `bring` and behave exactly as before.
