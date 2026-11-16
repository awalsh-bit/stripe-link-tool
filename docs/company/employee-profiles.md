# Employee Profiles, Time Off and Counseling Records

*Added 11/15. One place in HR to look a person up and keep their record: details, regular schedule, HR documents, time off, and (behind its own permission) performance counseling. Time off is asked for, approved and tracked here; Kronos is still keyed by hand.*

## Who can open what

| Page | Who | What it's for |
|---|---|---|
| **HR → Time Off** (`time-off.html`) | Everyone signed in. No grant needed. | Ask for time off, see your requests, see who's out. Managers approve their reports here; HR works the Kronos list here. |
| **HR → Employee Profiles** (`employee-profiles.html`) | Whoever is granted it on the Users page. Executives always. | Search people, edit their details and schedule, keep HR documents, see their time off. Holding this page is what makes someone "HR" for time off. |
| **HR → Counseling Records** (`employee-counseling.html`) | Whoever is granted it **and** Employee Profiles. Executives always. | The Counseling tab on each profile, plus a page listing follow-ups that are due and records written in the last 90 days. |

Granting Employee Profiles does **not** open counseling. That is a second, separate tick on the Users page, and it does nothing without the first.

## Employee Profiles

The list on the left searches name, title, department, code, email and manager as you type (several words narrow it: `pat appliance`). Filter by department; tick **Former** to include archived people. Small tags flag a time-off request that's waiting, the next approved day out, and a counseling follow-up that's due (that last one only if you hold Counseling Records).

Opening a person shows four tabs, five with counseling.

**Profile.** Name, department, employment type (Full-time, Part-time, Seasonal, Contract), who they report to, hire date, birthday, work and mobile phone, commute miles, emergency contact, shirt and shoe size, and an HR note. Three things are deliberately *not* editable here:

- **Email** is shown but changed only in User Admin. Changing it moves the person's sign-in to the new address, so it stays with executives.
- **Job title** is a dropdown only for executives, because the title sets the pay plan. Executives also see the pay plan the title maps to; nobody else does.
- **Adding and archiving people** stays in User Admin.

Saving a new name also renames the person's sign-in, the same as User Admin does. Everything else already on the directory row (title, email, archive state) is carried through untouched.

**Reports to** is what routes time off. Since 11/16 it is filled in by the **Org Chart** (see `org-chart.md`): the box shows who the chart worked out and says so underneath. Choosing someone else is an override, marked *Set by hand*, until **Put back to automatic** is pressed; when the job above is shared by two or more people the box says *Needs a pick* and HR chooses. For people who aren't on the chart it's still set here by hand. It lists current employees only, won't let a person report to themselves, and refuses a loop. A manager shown as "(no sign-in)" can be chosen, but since they can't approve in Agility their reports' requests go to HR.

**Schedule.** Start and end time for each day, or **Off**. *Copy Monday to Tuesday through Friday* fills the week. Tick **Takes an unpaid hour for lunch** and an hour comes off every day scheduled for more than 5 hours, so 8 to 5 counts as 8 hours. The total for the week shows as you type. A free-text schedule note covers what a grid can't ("every other Saturday"). The schedule is what time off uses to count working days and hours, and each person sees their own on the Time Off page. It changes nothing in Kronos.

**Documents.** Category (Onboarding & offer, Policy acknowledgment, Certification & training, Performance review, Pay & status change, Other), an optional title, and the file: PDF, picture (PNG, JPG, WEBP, HEIC), Word, Excel, text or CSV, up to 15 MB. The file type is decided by the extension against that list and a ".pdf" has to actually be a PDF. PDFs and pictures open in a new tab; everything else downloads. **Remove** asks for a reason and then moves the document under "removed", crossed out with who and why. Nothing is erased.

The yellow box on that tab is the rule: **no medical records or doctor's notes, no I-9s, nothing showing a Social Security or driver's license number.** There is no medical category on purpose. Federal law wants medical information in its own confidential file, and Agility's standing rule is that it never stores SSNs or license numbers.

**Time off.** The person's requests with status and whether each is in Kronos, and a link to enter time off for them if they don't use Agility.

## Time off

### Asking

Kind (Vacation, Sick, Personal, Bereavement, Jury duty, Unpaid, Other), first and last day, or **Only part of one day** with the hours. An optional note is seen only by the approver and HR. Before sending, the page says who it goes to and how many working days and hours it covers on the person's regular schedule (Monday to Friday is assumed when HR hasn't entered one).

Limits: up to 60 days per request, start no more than 60 days back or 18 months out, and no overlap with another of the person's pending or approved requests.

### Who decides

The request is stamped with an approver the moment it's sent: the person on the profile's **Reports to** (kept current by the Org Chart and re-checked as the request is sent), if that manager is current and has a sign-in. Otherwise it goes to HR. The approver gets a dashboard notice; when nobody is the approver, everyone holding Employee Profiles gets it (executives, if nobody holds that page yet).

- The named manager can approve or decline. Declining requires a short reason, which the employee sees.
- Anyone holding Employee Profiles can decide **any** request, and sees all of them under "Waiting on a decision", so a manager being out never blocks one.
- **Nobody decides their own request**, HR included. Executives are the one exception.
- Each card shows who else is already approved out on those days.

The employee gets a dashboard notice either way. If the person's job has dotted lines on the Org Chart, the people on the other end are told the name and dates once it's approved (and again if it's cancelled); they don't approve anything. Nothing is emailed or texted to anyone.

### Kronos

Agility does not talk to Kronos. When a request is approved, HR gets an **Enter in Kronos** notice and the request appears in the Enter in Kronos box on the Time Off page with the dates, kind, working days and scheduled hours. Key it into Kronos, press **Entered in Kronos**, and it leaves the list with your name and the time. If it was ticked by mistake, *Not entered after all* under "Decided in the last 45 days" puts it back.

If approved time off is cancelled **after** it was entered, it comes back onto the same list marked *Cancelled, take it out*, with a **Removed from Kronos** button. So the list is always exactly what Kronos and Agility disagree about.

### Cancelling

The employee can cancel a pending request, or an approved one that hasn't finished yet (the Cancel link asks for a second tap). HR can cancel any approved request from the recent list. The approver is told when something they approved is cancelled.

### Who's out

A month calendar at the bottom of the Time Off page, open to everyone. It shows **approved** time off as a name on each day, and "(part day)" for a partial day. It never shows the kind of time off or the note; those go only to the approver and HR. On a phone it becomes a list of just the days someone is out.

### HR entering time off for someone

Anyone holding Employee Profiles gets a **Who is it for** menu on the request form (the profile's Time off tab links straight to it). The request still goes to that person's manager and is marked "entered by".

## Counseling records

The Counseling tab on a profile holds dated records: Coaching conversation, Verbal warning, Written warning, Final written warning, Performance improvement plan, Suspension, Recognition. Each has the date of the conversation, who held it, what happened and what was said, what's expected going forward, how the employee acknowledged it (signed, declined to sign, discussed), and an optional follow-up date.

How it's protected:

- **Its own permission**, on top of Employee Profiles. Someone with Employee Profiles alone can't see the tab, the counts, the records or their attachments, and nothing about counseling is in what their browser receives.
- **Every view is logged**: opening a person's Counseling tab, opening the Counseling Records page, opening an attachment, and every change, each with the person's name, in the Audit Log. The log records *that* a record was touched, never its text.
- **A named account is required.** The emergency executive login can't open counseling, because a view has to be logged against a person.
- **Never edited.** Once saved, a record reads as it was written. A correction or later note is an **addendum** with its own author and time.
- **Never deleted.** A record entered by mistake is **voided** with a reason; it stays on file, crossed out, and can't be changed further.
- **Kept after someone leaves.** Archiving an employee removes nothing here.
- Attachments (the signed form, a supporting document) hang off the record and follow its permission, not the general Documents tab.

Follow-ups: a record with a follow-up date shows a tag until someone presses **Mark followed up**. The Counseling Records page lists every open follow-up, overdue ones in red.

Guidance printed on the page, worth repeating: write plainly and factually, as if it will be read aloud to the employee and possibly to a lawyer; no medical details.

**One limit to know about.** These controls are about who can see records *inside Agility*. Anyone with direct access to the database or the hosting account (today, the people with the Render login) can read the tables. If counseling records ever need to be closed even to those people, that takes field-level encryption, which isn't built.

## Data

`lib/employee-profiles-postgres.js` creates four tables on first use, all keyed on `employee_directory.code`:

- `employee_profile_details`: reports-to, employment type, phones, emergency contact, `schedule` (JSON: a `{start, end}` or `{off: true}` per weekday plus `lunch` minutes, 60 when the lunch box is ticked), schedule note, HR note.
- `employee_documents`: the file bytes and metadata; `counseling_id` set when it's a counseling attachment; `removed_at / removed_by_email / removed_reason` for soft removal.
- `employee_counseling_records`: the record, `addenda` (JSON list), follow-up fields, `voided_at / voided_by / void_reason`.
- `pto_requests`: the request, the approver stamped at request time, decision, `kronos_entered_at / _by`, cancel fields, `kronos_removed_at / _by`, plus `work_days` and `scheduled_hours` as counted when it was sent.

Routes: `/api/employee-profiles` (list), `/api/employee-profiles/:code` (GET, PUT), `/api/employee-profiles/:code/documents` (POST), `/api/employee-documents/:id` (GET) and `/remove` (POST) behind Employee Profiles. `/api/employee-profiles/:code/counseling` (GET, POST), `/api/employee-counseling/overview`, `/api/employee-counseling/:id/addendum | follow-up | void | attachments` behind both grants. `/api/pto/mine`, `/api/pto/requests` (POST), `/api/pto/requests/:id/decide | cancel`, `/api/pto/approvals` and `/api/pto/calendar` for every signed-in user, each checking who is asking; `/api/pto/requests/:id/kronos` behind Employee Profiles.

Dashboard notices use the refs `pto:<id>` (waiting on a decision; retired when decided or cancelled), `ptodecision:<id>`, `ptokronos:<id>` (retired when ticked off), `ptocancel:<id>`, and `ptofyi:<id>` / `ptofyicancel:<id>` for dotted-line managers.

Audit actions: `employee_profile_saved`, `employee_document_uploaded / opened / removed`, `employee_counseling_viewed / overview_viewed / added / addendum / follow_up / voided / attachment_added / attachment_opened`, `pto_requested / approved / denied / cancelled / kronos_marked`.

## Not built

Leave balances and accruals (Kronos keeps those), a company holiday overlay on the who's-out calendar, a "who's out today" card on the dashboard, and emailing anyone about a request.
