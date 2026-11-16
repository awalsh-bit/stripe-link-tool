# Employee Profiles, Time Off and Counseling Records

*Added 11/15. One place in HR to look a person up and keep their record: details, regular schedule, HR documents, time off, and (behind its own permission) performance counseling. Time off is asked for, approved and tracked here; Kronos is still keyed by hand.*

## Who can open what

| Page | Who | What it's for |
|---|---|---|
| **HR → Time Off** (`time-off.html`) | Everyone signed in. No grant needed. | Ask for time off, see your requests, see who's out. Managers approve their reports here; HR works the Kronos list here. |
| **HR → Employee Profiles** (`employee-profiles.html`) | Whoever is granted it on the Users page. Executives always. | Search people, edit their details and schedule, keep HR documents, see their time off. |
| **HR → Counseling Records** (`employee-counseling.html`) | Whoever is granted it **and** Employee Profiles. Executives always. | The Counseling tab on each profile, plus a page listing follow-ups that are due and records written in the last 90 days. |

**Who counts as HR.** HR is set on the job, not the person: in User Admin → Job titles & codes, open a title and tick **HR**. Everyone holding a title with that box ticked (and every executive) is HR, which means three things: they work the Enter in Kronos list, they can decide or enter anyone's time off, and they can change anyone's work schedule, not only their direct reports'. The box takes effect the moment someone is given the title and ends when they leave it. It opens no pages: Employee Profiles, Counseling Records and Org Chart are still granted on the Users page.

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

**Schedule.** The week this person works, and where it comes from: the standard week for their job code, or one set just for them (see *Work schedules* below). Only their direct supervisor, HR or an executive can change it; anyone else with Employee Profiles sees it read-only, with the name of who can. Start and end time for each day, or **Off**. *Copy Monday to Tuesday through Friday* fills the week. Tick **Takes an unpaid hour for lunch** and an hour comes off every day scheduled for more than 5 hours, so 8 to 5 counts as 8 hours. The total for the week shows as you type. A free-text schedule note covers what a grid can't ("every other Saturday"). The schedule is what time off uses to count working days and hours. It changes nothing in Kronos.

**Documents.** Category (Onboarding & offer, Policy acknowledgment, Certification & training, Performance review, Pay & status change, Other), an optional title, and the file: PDF, picture (PNG, JPG, WEBP, HEIC), Word, Excel, text or CSV, up to 15 MB. The file type is decided by the extension against that list and a ".pdf" has to actually be a PDF. PDFs and pictures open in a new tab; everything else downloads. **Remove** asks for a reason and then moves the document under "removed", crossed out with who and why. Nothing is erased.

The yellow box on that tab is the rule: **no medical records or doctor's notes, no I-9s, nothing showing a Social Security or driver's license number.** There is no medical category on purpose. Federal law wants medical information in its own confidential file, and Agility's standing rule is that it never stores SSNs or license numbers.

**Time off.** The person's requests with status and whether each is in Kronos, and a link to enter time off for them if they don't use Agility.

## Work schedules

**HR → Work Schedules** (`work-schedules.html`) is open to everyone signed in, and shows different things to different people.

- **Everyone** sees their own week, whether it's the standard one for their job or set just for them, and who to ask if it's wrong.
- **A supervisor** (anyone with people reporting to them, per Reports to and the Org Chart) also sees *Your team*: each direct report's week with an Edit button.
- **HR** sees everyone but themself, each with an Edit button.
- **Executives** see everyone, and a third section, *Standard week for each job*.

**The standard week** is set once per job code, by an executive. Everyone holding that job code follows it. Changing it changes the week for everyone who follows it, straight away, and leaves custom schedules alone; the job's row says how many people follow it and how many are custom. Removing it leaves its followers with no schedule.

**A custom schedule** is one set for a single person by their direct supervisor, by HR, or by an executive. Nobody else can, and nobody but an executive can change their own. The editor opens on the week they have now. Saving a week identical to the job's standard week isn't treated as custom; they simply keep following the job. *Back to the standard week* drops the custom schedule (and its note).

A job title with no job code can't have a standard week, so its people can only have custom ones.

Whichever applies is the schedule everything else uses: the Schedule tab on the profile, the "Your regular schedule" line on Time Off, and the working days and hours counted on a time-off request. With no schedule at all, time off counts Monday to Friday and leaves the hours blank.

## Time off

### Asking

Kind, first and last day, or **Only part of one day** with the hours. Ticking that box takes the last-day field away and the one date reads *Day out* (11/16), since part of a day has a single date. An optional note is seen only by the approver and HR. Before sending, the page says who it goes to and how many working days and hours it covers on the person's regular schedule (Monday to Friday is assumed when HR hasn't entered one).

The Kind menu is in three groups:

- **PTO**: Vacation, Sick, Personal.
- **Parental leave**: *Parental leave (paid)* is the company-paid time, up to 10 working days on top of a person's PTO. A single request can't be longer than that, and whoever decides it sees how many paid parental days that person has already had approved in the previous 12 months (shown in red if this one would take them past 10; it is a warning, not a block). *Parental leave (unpaid)* is for the rest of the time away (in practice this is FMLA leave; the menu uses the neutral name) and can run up to 26 weeks in one request. Someone taking both sends two requests, back to back.
- **Other leave (not PTO)**: Bereavement, Jury duty, Unpaid, Other.

**Part of one day asks which hours (11/16).** Ticking the box asks *Off from* and *Until* instead of a count of hours, so everyone knows when to expect the person. For PTO, picking the start fills in the end one block later (four hours by default). The hours off come out of the person's regular day, which moves their start back, their finish forward, or splits the day:

- off 8 AM to 12 PM on an 8-to-5 day: *in at 12 PM*, working 12 PM to 5 PM;
- off 1 PM to 5 PM: *leaves at 1 PM*;
- off 10 AM to 2 PM: working 8 to 10 and 2 to 5.

The request, the approver's card, the Enter in Kronos list and the audit all show the hours and what is left of the day, and the who's-out calendar shows *Pat Example · in at 12 PM* (never the kind or the note). The regular day is stored with the request as it stood that day, so it still reads right if the schedule changes later. The hours have to fall inside the regular day on file, and can't be the whole of it (that is a day off, not part of one). A stretch longer than five hours loses the unpaid lunch, the same rule a whole day uses. Nothing is written into the person's weekly schedule; the changed day is worked out from the request, which is also what the capacity engine will read.

The line under the form is now worked out by the server as the form is filled in, so it says exactly what sending would do, and a refusal shows before Send is pressed.

All of them are asked for, approved and tracked the same way. Unpaid parental leave and the other-leave kinds are tagged "not PTO" on the approver's card and on the Enter in Kronos list.

Limits: up to 60 days per request (26 weeks for unpaid parental leave), start no more than 60 days back or 18 months out, and no overlap with another of the person's pending or approved requests. The rest of the limits come from the Time Off policy, below.

### The Time Off policy (11/16)

The company's written Time Off policy is in Agility as numbers, taken from the policy document. Everyone can read it in the **Time off policy** section at the bottom of the Time Off page. **Executives** have an *Edit policy* button there; nobody else can change it (HR alone cannot). A change applies to requests made from then on, and is recorded in the audit log with the before and after.

| Rule | As written | What Agility does with it |
|---|---|---|
| Full workday | 8 hours | A whole day off draws up to 8 hours of PTO |
| PTO blocks | 4 hours | A part-day PTO request has to be a multiple of 4 hours; anything else is refused with the reason |
| PTO a year | 120 / 160 / 200 hours full time; 60 / 80 / 100 part time; under 2 years, 2 to under 5, 5 or more | Shown as the person's PTO for the year on the form and on the approver's card |
| January 1 | Reset and deposited, on the tenure reached in the calendar year before | The year's amount follows that rule |
| New hires | Builds from the hire date to December 31; usable after 90 days | First-year amount is the share of the year left at hire; a PTO request inside the 90 days is flagged |
| Part time | Must average 20 hours a week | Shown in the policy; not checked (Agility doesn't hold hours worked) |
| Paid holidays | New Year's Day, Independence Day, Thanksgiving, Christmas | Not counted as days off; marked *Closed* on the who's-out calendar; a request for only that day is refused |
| Parental leave | 80 extra paid hours, within 4 weeks, applied for 90 days ahead, approved by the General Manager | Up to 10 working days and 4 weeks per request (more is refused); short notice is flagged to the approver |
| Jury duty | Hourly staff paid 6 hours a day for up to 14 days; court paperwork to HR | More than 14 working days is refused; the card reminds about paperwork |
| Unpaid leave of absence | Up to 30 days | An *Unpaid* request over 30 days is refused |
| Sick time, the flexible unpaid day, payout on leaving | In words | Shown under *Also*; an executive can reword it |

**Refused or only flagged.** Anything about the shape of a request is refused outright: blocks, the day's hours, the day and week limits. Anything about a person's balance or timing is only flagged, to the person before they send and to whoever decides: asking for more PTO than is left, asking inside the first 90 days, short notice for parental leave. Those are judgment calls, and Agility's picture of a balance can be incomplete.

**What a request draws from PTO.** For each day off: the hours that person is scheduled, rounded up to the block, never more than a full day. An 8-to-5 day is 8 hours and a half-day Friday is 4, so a Monday-to-Friday week on that schedule is 36. With no schedule on file each weekday is a full 8. Leave that isn't PTO (parental, bereavement, jury duty, unpaid) draws nothing.

**Where a person's PTO stands.** The form shows *PTO for 2027: 160 hours. 16 hours used, 8 hours waiting on a decision, 136 hours left.* It needs the hire date and full-time or part-time on the profile; with no hire date it says so, and with no employment type it assumes full time and says so. Seasonal and contract staff are outside the policy. Agility began recording time off on November 15, 2026, so **for 2026 it does not give a "left" figure**: it shows the year's amount and what it has counted since that date, and says anything earlier is in Kronos. From January 1, 2027 the figures are complete, provided time off goes through Agility.

Two things in the document don't agree with its own table, and Agility follows the table: the example of a July 1 hire having 52 hours (the table gives 60, half of 120), and the example of a two-year anniversary in March earning 144 hours the next January (the table gives 160). Both look like leftovers from an earlier table of 104 and 144.

### Who decides

The request is stamped with an approver the moment it's sent: the person on the profile's **Reports to** (kept current by the Org Chart and re-checked as the request is sent), if that manager is current and has a sign-in. Otherwise it goes to HR. The approver gets a dashboard notice; when nobody is the approver, everyone in an HR job gets it (executives, if no job title has the HR box ticked yet).

- The named manager can approve or decline. Declining requires a short reason, which the employee sees.
- HR can decide **any** request, and sees all of them under "Waiting on a decision", so a manager being out never blocks one.
- **Nobody decides their own request**, HR included. Executives are the one exception.
- Each card shows who else is already approved out on those days.

The employee gets a dashboard notice either way. If the person's job has dotted lines on the Org Chart, the people on the other end are told the name and dates once it's approved (and again if it's cancelled); they don't approve anything. Nothing is emailed or texted to anyone.

### Kronos

Agility does not talk to Kronos. When a request is approved, HR gets an **Enter in Kronos** notice and the request appears in the Enter in Kronos box on the Time Off page with the dates, kind, working days and scheduled hours. Key it into Kronos, press **Entered in Kronos**, and it leaves the list with your name and the time. If it was ticked by mistake, *Not entered after all* under "Decided in the last 45 days" puts it back.

HR and executives always see the Enter in Kronos box on the Time Off page (11/16). When there is nothing to key in it says *Nothing waiting* instead of disappearing, so it is always where you expect it. Nobody else sees it.

If approved time off is cancelled **after** it was entered, it comes back onto the same list marked *Cancelled, take it out*, with a **Removed from Kronos** button. So the list is always exactly what Kronos and Agility disagree about.

### Cancelling

The employee can cancel a pending request, or an approved one that hasn't finished yet (the Cancel link asks for a second tap). HR can cancel any approved request from the request audit. The approver is told when something they approved is cancelled.

### Request audit (11/16)

The **Request audit** section of the Time Off page replaced *Decided in the last 45 days*. It lists every request and what became of it: who, the dates out, how long, the kind, when it was asked and by whom, the outcome with who decided and when, and where it stands in Kronos. Search by **employee** (any part of the name), by the **dates they were out** (on or after, on or before, or both), or all three. With nothing typed it shows the 25 nearest the top by date out.

HR and executives search everyone's requests and keep the two buttons the old list had (*Not entered after all* and *Cancel*). A manager sees the box once a request has been routed to them, and only ever their own reports' requests. Nobody else has it.

**Archive.** A request whose last day out is more than 365 days ago is moved out of the working table into an archive, so the table every Time Off page reads stays small. Nothing is deleted and every field is kept. Tick **Include archived requests** to search them too; they are marked *Archived* and can't be cancelled or un-ticked. A request that is still waiting on someone is never archived however old it is: one still waiting on a decision, one approved but not yet ticked off in Kronos, or one cancelled but not yet taken back out. The move is checked at most twice a day, when someone opens the audit, and each move is in the audit log. The paid-parental count still sees archived requests.

### Who's out

A calendar at the bottom of the Time Off page, open to everyone. It shows **approved** time off as a name on each day, and "(part day)" for a partial day. It never shows the kind of time off or the note; those go only to the approver and HR.

- **Month or Week.** Month is the usual grid. Week shows one Monday-to-Sunday week with room for every name; the arrows move a week at a time and *This week* comes back to today. Switching to Week from the current month lands on this week; from any other month, on that month's first week.
- **Department filter.** Pick a department to see only its people. The choice stays as you move between weeks and months.

On a phone either view becomes a list of just the days someone is out.

### HR entering time off for someone

HR gets a **Who is it for** menu on the request form (the profile's Time off tab links straight to it). The request still goes to that person's manager and is marked "entered by".

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

- `job_code_schedules`: the standard week per job code (`schedule` JSON in the same shape as a person's). A person's own `employee_profile_details.schedule` wins when it has any days in it; empty means "follow the job".
- `employee_profile_details`: reports-to, employment type, phones, emergency contact, `schedule` (JSON: a `{start, end}` or `{off: true}` per weekday plus `lunch` minutes, 60 when the lunch box is ticked), schedule note, HR note.
- `employee_documents`: the file bytes and metadata; `counseling_id` set when it's a counseling attachment; `removed_at / removed_by_email / removed_reason` for soft removal.
- `employee_counseling_records`: the record, `addenda` (JSON list), follow-up fields, `voided_at / voided_by / void_reason`.
- `pto_requests`: the request, the approver stamped at request time, decision, `kronos_entered_at / _by`, cancel fields, `kronos_removed_at / _by`, plus `work_days` and `scheduled_hours` as counted when it was sent. Since 11/16 also `start_time`, `end_time` (which hours, for part of a day), `day_start`, `day_end` (the regular day they come out of, as it stood then) and `pto_hours` (what it draws from PTO; null for leave that isn't PTO).
- `pto_requests_archive`: requests moved out of `pto_requests` once their last day out is more than a year past. The whole original row is kept as JSON in `request`; `employee_code`, `employee_name`, `approver_email`, `start_date`, `end_date` are copied out only to search on.
- `pto_policy`: one row, the Time Off policy as JSON. Empty until an executive changes something; until then the defaults in the code (the policy document's numbers) apply.

Routes: `/api/employee-profiles` (list), `/api/employee-profiles/:code` (GET, PUT), `/api/employee-profiles/:code/documents` (POST), `/api/employee-documents/:id` (GET) and `/remove` (POST) behind Employee Profiles. `/api/employee-profiles/:code/counseling` (GET, POST), `/api/employee-counseling/overview`, `/api/employee-counseling/:id/addendum | follow-up | void | attachments` behind both grants. `/api/pto/mine`, `/api/pto/requests` (POST), `/api/pto/requests/:id/decide | cancel`, `/api/pto/approvals` and `/api/pto/calendar` for every signed-in user, each checking who is asking; `/api/pto/requests/:id/kronos` for HR only.

Work schedules: `GET /api/work-schedules` (everyone; returns your own row, your direct reports, and for executives everyone plus the job codes), `PUT /api/work-schedules/people/:code` with `{ schedule, scheduleNote }` or `{ useJobDefault: true }` (their supervisor or an executive), `PUT /api/work-schedules/jobs/:code` with `{ schedule }` (executives; an empty week removes it). Saving a schedule through `PUT /api/employee-profiles/:code` follows the same supervisor-or-executive rule.

Time off (11/16): `POST /api/pto/preview` is a dry run of a request (same checks, nothing saved) and returns `{ ok, summary, notes, balance }` or `{ ok: false, error }`. `GET /api/pto/audit?q=&from=&to=&archived=1` is the request audit. `PUT /api/pto/policy` saves the policy (executives). `/api/pto/mine` also returns `policy`, `holidayChoices`, `canEditPolicy` and `profile.balance`; `/api/pto/calendar` also returns `holidays`; `/api/pto/approvals` no longer returns `recent`, and each waiting request carries `notes` and `balance`. A request is sent with `startTime` / `endTime` ("HH:MM") for part of a day; a bare `hours` from a page loaded before the change is refused with a message to reload. In `lib/employee-profiles-postgres.js`: `PTO_POLICY_DEFAULTS`, `normalizePtoPolicy`, `getPtoPolicy`, `savePtoPolicy`, `holidayDates`, `ptoAllowance`, `ptoBalance`, `planPtoRequest`, `ptoPolicyNotes`, `partDayPlan`, `searchPtoRequests`, `archiveOldPtoRequests`.

Dashboard notices use the refs `pto:<id>` (waiting on a decision; retired when decided or cancelled), `ptodecision:<id>`, `ptokronos:<id>` (retired when ticked off), `ptocancel:<id>`, and `ptofyi:<id>` / `ptofyicancel:<id>` for dotted-line managers.

Audit actions: `employee_profile_saved`, `employee_document_uploaded / opened / removed`, `employee_counseling_viewed / overview_viewed / added / addendum / follow_up / voided / attachment_added / attachment_opened`, `pto_requested / approved / denied / cancelled / kronos_marked`, `pto_policy_saved`, `pto_requests_archived`, `employee_schedule_saved`, `job_schedule_saved / removed`.

## Not built

A PTO balance for 2026 (Agility only has time off since November 15; Kronos has the rest), carrying a person's opening balance in from Kronos, routing paid parental leave to the General Manager for approval (it is flagged, and goes to the usual approver), a check on the part-time 20-hour average, showing a changed day on the Work Schedules page (that page shows the standing week, not dates), a "who's out today" card on the dashboard, and emailing anyone about a request.
