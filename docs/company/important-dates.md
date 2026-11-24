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

**Export.** On the builder page each date with a sign-up has **export CSV** beside *view*. RSVP: one row per person — Name, Email, Response, Guests, Party size (the person plus guests; 0 when not coming, so the column sums to the head count), Note, Answered — with those coming first. Bring-list: Item, Name, Email, Added. The file is built in the browser from the same list the page shows (`<title>-rsvp-<date>.csv`), opens cleanly in Excel, and a note that starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe so it can't run as a formula.

**Guest limit (11/11).** An RSVP date has **Guests allowed** in the builder: None — staff only, or up to 1 (a plus-one) through 5. A new RSVP starts at a plus-one; dates made before the setting existed keep 5 until edited. The dashboard's guest picker offers only what the date allows (it disappears for staff-only) and the server refuses anything higher. Lowering the limit does not change answers already given: the builder shows "N over the limit" on the date and marks those lines, so you can ask the person to update or remove the line. Stored as `important_dates.signup_guest_max`.

## Who has and hasn't answered (11/16)

On the builder page, an RSVP date's line now ends with how many people it is still waiting on: *RSVP · 14 coming (19 people) · 3 no · **9 no answer***. **view names** opens the list under the date in three groups:

- **Coming**, with each person's guests and note, and the head count with guests.
- **Can't make it**, with any note.
- **No answer yet**: everyone with an active Agility sign-in who hasn't answered. This is the same roster the Christmas party menu survey uses for "hasn't answered", because those are the people who see the RSVP on their dashboard and can answer it. Someone with no sign-in can't answer and isn't listed; a shared sign-in (a showroom kiosk, say) will sit in this group.

Click **view names** again to close it. Removing someone's answer puts them back under No answer yet. A line left over from before a date was switched to RSVP is shown apart and is not counted as an answer.

**export CSV** on an RSVP date now lists the people with no answer after the answers, with Response = *No answer* and a party size of 0, so the file is the whole roster and the Party size column still sums to the head count.

On a phone the dates now stack as blocks instead of a sideways-scrolling table, and the tally and both links sit under the title (the Sign-up column used to be hidden there).

Only the builder page shows who hasn't answered. The sheet everyone opens from the dashboard is unchanged: it lists answers, never who is missing. Nobody is sent a reminder.

`GET /api/important-dates/:id/signups` adds `notAnswered` (`[{ name, email }]`, or `null` if the roster couldn't be read) for people who hold the builder page, on RSVP dates only; `GET /api/important-dates` adds `rsvp.waiting` to each RSVP date. `listRsvpAnswerEmails()` in `lib/important-dates-postgres.js`. No new tables or columns.

## Closing an RSVP or sign-up (11/24)

*Andrew: "I need a close RSVP on important dates".* A head count is only final once people can no longer change it. There are two ways to close a date's RSVP or bring-list, and a date can use either or both.

- **Last day to answer.** An optional date in the builder, shown once a sign-up is chosen. People can answer through that day; from the next morning it is closed. It can't be later than the event.
- **close RSVP** (or **close sign-up**), a link on the date's row beside *view names* and *export CSV*. It closes at once, after a confirmation, and the row shows a red **Closed** tag with who closed it and when.

While it is closed:

- Nobody can answer, change an answer, add a line, or take their own off. The server refuses it; the pages only keep in step.
- Everyone can still open the list from the dashboard and see who is coming. The link reads **RSVPs closed (14 coming)**, and the sheet says it is closed. Someone who never answered sees "you: no answer".
- Whoever holds the Important Dates page can still remove a line, export the CSV and see who hasn't answered.

**reopen** on the row lets people answer again. If the last day to answer has already passed, reopening clears it (and says so), because otherwise the sheet would close again at once. Edit the date to set a new last day.

Before it closes, a date with a last day shows it: the dashboard link reads "RSVP — are you coming? (14 coming · answer by Sat, Dec 5)" and the sheet has a line above the buttons. On the day itself both say it is the last day. The builder row shows **open through Sat, Dec 5**.

Nothing is sent to anyone when a sheet closes or reopens, and nobody is reminded that a last day is coming.

Storage: `important_dates.signup_close_date` (the last day), `signup_closed_at` and `signup_closed_by` (the close by hand). Each date now carries `signupCloseDate`, `signupClosed`, `signupClosedHow` (`hand` | `date` | empty), `signupClosedAt` and `signupClosedBy`. The last day is judged in store time. `POST /api/important-dates/:id/signup-close` with `{ closed: true | false }` closes or reopens (the builder page's grant); the last day is saved with the date. Saving a date from a page that doesn't send the last day leaves it as it was. Switching a date's sign-up off clears both. Audit actions: `important_date_signup_closed`, `important_date_signup_reopened`. Dates made before this are open with no last day.
