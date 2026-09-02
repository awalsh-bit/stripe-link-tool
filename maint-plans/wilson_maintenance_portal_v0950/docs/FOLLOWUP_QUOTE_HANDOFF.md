# Follow-up → quote → estimate: the handoff contract (v0.9.41)

Cayden, describing the pipeline this document pins down:

> "passthrough from cause for concern > anytime tech flags return visit needed >
> flag populates in customer facing report, but also triggers a backend
> notification to the techs dashboard to build quotes on follow up services...
> tech builds quote for recommended service, and then hits a quote complete
> button on the notification to remove it from their queue. once tech hits
> quote complete, this moves into the backend command center to flag the office
> admins to find the quote in epass and send it over to the customer. we
> already have a dashboard tool running for service quotes, which this will now
> merge into... this part is already built, so we just need to make a
> notification handoff to link to maint calls."

The prototype models every STATE in that sentence; the dashboard merge supplies
the two pieces that already exist over there (My Notifications, Service
Estimate Approvals). Nothing in this contract asks the estimate tool to change.

## The life of a flag

| # | State (`followUps[].status`) | Who owes work | Where it shows |
|---|------------------------------|---------------|----------------|
| 1 | `open`   | The technician (build the quote in ePass) | Prototype: command center, stage **Follow-up quote to build**. Merged: a **My Notifications** row on the flagging technician's dashboard. Both: the flag is already on the customer-facing health report. |
| 2 | `quoted` | The office (import the quote) | Prototype: command center, stage **Estimate to send**. Merged: a command-center flag for office admins. |
| 3 | `handed` | Nobody here — Service Estimate Approvals owns it | The estimate tool emails the customer, tracks Sent / Viewed / Shopping, and distributes the decision to applicable staff. This tool's pipeline ends. |

`dismissed` remains the exit for a flag the office decides not to pursue.

The transitions are `WilsonStore.markFollowUpQuoted(id, {ref})` (1 → 2, fired
by the **Quote complete** button; `ref` is the ePass SV number, optional) and
`WilsonStore.handFollowUpToApprovals(id)` (2 → 3, fired by **Imported to
Estimate Approvals**). Both write household activity, so a customer file reads
the whole story in order.

## What the merged dashboard must wire (and only this)

1. **Notification out (state 1).** When a report lands with `followUp` flags
   (`syncFollowUpsFromInspection` creates the rows), create one My
   Notifications entry per flag on the flagging technician's dashboard.
   Payload the row already carries: `id`, `householdId`, `assetId`,
   `applianceLabel`, `checkName`, `verdict`, `note`, `technician`, `reportId`,
   `createdAt`. TYPE: "Follow-up quote to build"; ACTIONS: open report, and
   **Quote complete** → `markFollowUpQuoted`.
2. **Quote complete (1 → 2).** The button on the notification calls
   `markFollowUpQuoted` with the SV number the tech just created in ePass, and
   removes the notification from the tech's queue. Nothing else — no email is
   sent by this step.
3. **Admin flag (state 2).** The command center (this tool's page, merged) is
   already the surface: the row tells the admin to pull the SV's Work Order
   print out of ePass and run **Scan a service quote PDF** in Service Estimate
   Approvals — the exact flow the office uses today.
4. **Handoff (2 → 3).** When the import succeeds, call
   `handFollowUpToApprovals`. If the estimate tool exposes a created-estimate
   event, wire it to this call so the button presses itself; until then the
   admin presses it.
5. **Decisions come back through the estimate tool, not through here.**
   Approve / Shopping / Viewed notifications already distribute from Service
   Estimate Approvals. This pipeline deliberately does not duplicate them.
   The one optional read-back worth adding at merge time: stamp the estimate's
   final status onto the followUp row (`estimateOutcome`) so the household
   record can answer "what happened to that dryer" without a second lookup.

## What the prototype deliberately does not build

- Tech-facing notifications ("notifications to techs dont need to be built in
  the prototype" — the command-center row stands in, and says so on its face).
- Any email. Sending belongs to Service Estimate Approvals.
- Any second estimate tracker. The moment a quote is imported over there, this
  tool's queue lets go — one owner per stage, no mirrored state to drift.
