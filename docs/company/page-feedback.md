# Page feedback

*Added 11/26. Andrew: "I need a page feedback form that goes to all executives. It should be in the shell and be able to have the team send a notification with 100 characters or less feedback about how an internal page functions."*

## What the team sees

Every internal page that carries the Agility header has **Page feedback** in two places:

- the personal menu at the top right (the circle with your initials), under Edit my profile;
- the footer, next to Sign Out.

Either one opens a short form. It is always about the page it was opened on, and says so: "About **Cosmetic Damage Form**, the page you're on." There is one box, "How is this page working for you?", that takes up to **100 characters** and counts down as you type. **Send**, or the Enter key, sends it. The form says "Sent to the executives. Thank you." and closes itself.

The form says before sending that it goes with the sender's name. It is not anonymous.

## What executives get

Each active executive gets it on **My Notifications** on their dashboard, as a grey **Page feedback** row: the page's name, the words, the date and "From Sam Sales". Each executive has their own copy and closes their own; closing one doesn't close anyone else's.

- An executive who sends feedback doesn't get their own; the other executives do.
- An executive whose sign-in is switched off gets nothing.
- Nothing is emailed or texted. It is a dashboard notification only.

## Limits

- **100 characters, one line.** A line break becomes a space.
- **One person: 5 in ten minutes and 25 in a day.** Past that the form says so and keeps the words so they can be sent later. One person's limit doesn't affect anyone else.
- **Sending the same words about the same page twice within two minutes** (a second tap on Send) makes one notification.

## What is kept, and what isn't

Every piece of feedback is kept in its own table with the page, the words, who sent it and when, so it outlives the notifications being closed. Each send is also in the Activity Audit as `page_feedback_sent`.

Only the page's **path** is kept, for example `/install-damage.html`. Whatever follows a `?` or `#` in the address is dropped before it is stored or shown, because an address can carry a client's name, an invoice number or a sign-in token.

There is no screen yet that lists all feedback in one place. Executives can read it at `/api/page-feedback` (newest first), and a list page can be built on that when it's wanted.

## For developers

- **`internal-shell.js`:** `buildPersonalSettings` and `buildFooterLinks` add the two controls (`data-open-feedback`), only once someone is signed in. "Page feedback (modal)" holds `ensureFeedbackModal`, `openFeedbackModal`, `sendFeedback`. `window.openPageFeedback()` opens the same form from any page that wants its own button.
- **`internal-shell.css`:** the dialog borrows the profile dialog's frame; its own rules are under "Page feedback (11/26)". The dark scheme's close button and heading rule were fixed for both dialogs.
- **`POST /api/page-feedback`** `{ message, page, label }`: anyone signed in. The page's name comes from `PAGE_LABELS`; `label` (the shell's name for the page) is used only for a path Agility has no name for. One `pushed_notifications` row per active executive but the sender: type "Page feedback", severity neutral, `ref_id` `pagefb:<id>`.
- **`GET /api/page-feedback`:** executives only.
- **`lib/page-feedback-postgres.js`:** table `page_feedback`; `cleanPageFeedback`, `cleanPagePath`, `recentPageFeedback`, `savePageFeedback`, `listPageFeedback`; the limits are constants at the top.

## Checked before delivery

The real `server.js` against a local test database with made-up users, two of them executives. 37 of 37 checks passed.

- **Server (20):** signed out refused; both executives notified and nobody else; the address's query never stored or shown; empty, 101 and exactly 100 characters; a page with no name of its own; an address that isn't a page; the same send twice; the sixth in ten minutes; an executive's own feedback; closing one copy; the executives' list; the audit log.
- **Pages (17):** the form from the personal menu on a phone and from the footer; the page named; the count and the 100 stop; Enter and Shift+Enter; the thank-you and self-close; an error shown with the words kept; Esc; the row on an executive's My Notifications; no page errors. One script the dashboard's notification list waits for isn't in the test copy of the site, so a stand-in with no order rules was used for that one check.
