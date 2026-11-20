# Inventory Lookup: "Send request to the GM" for a display unit

*Fixed 11/20. Andrew, on JMHF930RSS's display unit (TRE1510103): the button answered "No email on file for employee code E80 — ask Andrew to check the directory." He said: "I'm definitely in job code E80, not sure what the issue is."*

## What it does

A free DISPLAY unit is never *available to sell* on Inventory Lookup, because the GM decides whether it leaves the floor. Instead the salesperson types a note and presses **Send request to the GM**.

Every GM gets two things:

- a yellow flag on their dashboard;
- an email naming the salesperson, the model, the serial, where it is, and how long it's been on hand.

The request never moves the unit in ePASS. Asking about the same unit again within 10 minutes is held back.

## Who "the GM" is

The GM is everyone still on the team who holds **job code E80** in the employee directory. A person holds a job code in one of two ways:

- the code is set on their own directory row;
- their job title carries the code (User Admin → Job titles & codes).

If several people hold E80, each gets the flag and the email. A former employee (archived) isn't asked. A different code can be set with `INVENTORY_DISPLAY_APPROVER_CODE` in Render.

## What was wrong

The request looked up **E80** as an *employee* code: the short code a person's directory entry is filed under, such as AMW or SPR. E80 is a *job* code, the one that belongs to the GM's title. No directory entry is filed under E80, so the lookup found nobody, whoever held the job code.

The request now finds the GM by job code. A directory entry whose own code is E80 still counts, as before.

## When it still can't send

- **Nobody holds E80:** "Nobody in the employee directory holds job code E80 — set it on the GM's title in User Admin."
- **The holder has no email in the directory:** "*Name* holds job code E80 but the directory has no email for them — add it in User Admin → Employee directory."

## Checked before delivery

The real `server.js` ran on a local test database with a stand-in display unit and made-up directory entries.

- **Old code:** with a GM holding job code E80, it gave the same error Andrew saw.
- **New code, before any GM existed:**
  - Nobody holding E80: the page said so.
  - A holder without an email: the page named them.
- **New code, with two GMs:** two holders, one through the title and one stamped on the row, were each sent the dashboard flag and the email. An archived holder wasn't.
- **Double-send guard:** a second request within 10 minutes was held back, as before.

## For developers

- `server.js`: `listEmployeesByJobCode(code)` covers non-archived rows. It reads `job_title_code`, or the title's code through `job_titles` when the row was never stamped, the same rule as Quote Follow-Up's `getQuoteSalesCodes`.
- `POST /api/inventory-lookup/display-request` flags and emails every holder that has an email. `approver.name` lists them for the page's "Request sent to …" line.
