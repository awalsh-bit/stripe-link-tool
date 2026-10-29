# Christmas party menu survey

Added 2026-10-29 (Andrew 10/28: "push a one-time survey to everyone's notifications — top 3 meats, top 3 sides, one dessert — and put the results on a Christmas party planning page").

## For the team

A green notification lands on every dashboard: **Christmas party menu — pick your favorites**, with a **Pick my menu** button. It opens a card on the dashboard itself (the same card also shows on its own while the survey is open and you haven't answered): tick 3 meats, 3 sides, one dessert, optionally a note (allergies, a plus-one), **Save my picks**. The card won't let a fourth meat or side be ticked. Saving closes the notification. You can reopen the card from the notification (or it reappears if you clear your answer) and change your picks until the survey closes.

The menu is the caterer's buffet: six craft meats (Smoked Tofu counts as a pick but the caterer doesn't count it toward the protein minimum), seven scratch-made sides, two desserts; v / v+ / gf tags shown beside the sides.

## For whoever is planning

HR → **Christmas Party Planning** (`party-planning.html`, grant under HR).

- **Send the survey to everyone** — one notification to every dashboard (blank audience). Goes once; the button greys out after.
- **Remind the people who haven't answered** — one yellow notification per non-responder (active Agility logins without an answer).
- **Close the survey / Reopen** — closed means answers are no longer accepted; the card tells the person so.
- Tiles: answered / people with a login / response rate / open-closed. Bars per meat, side and dessert with votes and share of respondents; the top 3 / top 3 / top 1 are tagged **ordering**. A tie across the cut line is tagged **tie — you decide** instead, so the choice is yours, not alphabetical.
- **Haven't answered yet** chips; **Every answer** table with notes; **Download responses (CSV)**.

## Plumbing

`lib/party-survey-postgres.js` — `PARTY_MENU` (edit here to change the menu or pick counts), tables `party_survey_responses` (one row per survey key + email, upsert) and `party_survey_meta` (sent / reminded / closed). Routes: `GET/POST /api/party-survey/me` (any signed-in user), `GET /api/party-survey/results`, `GET /api/party-survey/results.csv`, `POST /api/party-survey/send` (`mode: send | remind | close | reopen`) behind the page grant. Notification action key `party_survey` (registered on `NOTIFICATION_ACTIONS` at boot); saving calls `closeActionNotificationsForUser("party_survey", email)`. Audit: `party_survey_sent / reminded / closed / reopened / answered`.

For next year: change `PARTY_SURVEY_KEY` and `PARTY_MENU`; the old answers stay under the old key.
