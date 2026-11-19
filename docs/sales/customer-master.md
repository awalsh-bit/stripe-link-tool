# Customer Master

*Added 11/20. Andrew: "I need a Customer Master to build an email list for the Event RSVP tool. We need to see all ePASS customers today - I'll tie them to their NetSuite ID later." Asked how to build it, he chose **lifetime totals from ePASS**, **its own page grant**, and **Add to an event + CSV**.*

**Customer Master** (`customer-master.html`, under Company Tools) lists every ePASS customer:

- **Who they are:** name, customer #, account type and salesperson.
- **How to reach them:** every email and phone in ePASS, and their address.
- **What they've bought:** lifetime sales (pre-tax) and number of orders, first and last purchase, service visits, and the brands they've bought.

Filter the list, then **Add to event…** to put the customers on an event's guest list, or **Export CSV**.

## Who can open it

The page has its own grant, **Customer Master**, in the Sales group of the permission editor. Executives have it automatically. It isn't in any job preset, because the page shows every customer's phone, email and address, so grant it by hand.

Adding to an event also needs **Events & RSVPs**. Someone with only Customer Master can see and export the list, but the Add to event button isn't shown to them.

Every export and every add is written to the audit log (`customer_master_export`, `customer_master_add_to_event`), with the filters used and how many rows.

## Filters

| Filter | What it does |
|---|---|
| **Search** | Name, customer #, email, phone (any format) or street. |
| **ZIP codes** | One or more, separated by commas. A 3-digit prefix such as `786` takes every ZIP that starts with it. |
| **City** | Exact match. |
| **Bought these brands** | Any of the ticked brands. The count beside each is how many customers bought it. |
| **Customers who** | Bought appliances, had service only, or have nothing on file. |
| **Last purchase between** | The date of the last finished sales order. |
| **Lifetime sales** | The minimum and maximum, before tax. |
| **Salesperson / Account type** | As ePASS has them on the customer. |
| **Only customers we can email** | Leaves out everyone without a usable address (see below). |

Sort by name, last purchase, lifetime sales, newest customers or customer #. The list shows 100 at a time (**Show more**), with the totals for the whole filtered list at the top: customers, how many can be emailed, and their lifetime sales.

Tap a customer for everything on file: all emails and phones, address, account and salesperson, preferred contact, customer since, last activity in ePASS, sales, service, brands, and their recent orders in Agility.

## Who can be emailed

A customer can be emailed when all three are true:

- They have an email address in ePASS.
- ePASS doesn't mark them **Do Not Email** or **Declined Email**.
- The address hasn't **unsubscribed** from Wilson's event emails (the link at the bottom of every event email).

The address used is the first usable one in ePASS's order: Email, then Billing Email, then Mailing Email. An unsubscribed address is skipped for the next one. On the list, a customer who can't be emailed shows their address struck through, tagged *Do Not Email* or *Unsubscribed*.

## Add to event…

1. Filter the list. Optionally, tick particular customers.
2. Press **Add to event…**. The button reads *Add N ticked to event…* when some are ticked.
3. Pick the event (any that isn't archived) and, optionally, a guest type.

What happens:

- **Who is added.** With customers ticked, only those are added. With none ticked, everyone on the filtered list who can be emailed is added. Customers who can't be emailed are never added, and the result says how many were left out and why.
- **Most 500 at a time.** When more than 500 could be emailed, the page asks to narrow the filters or tick the ones to add.
- **How they appear on the guest list.** Each goes on as **Planned**, with:
  - their name in ordinary case (ePASS stores capitals)
  - for a company account (no first name in ePASS), the company name as the company
  - the email and phone
  - their ePASS salesperson as *invited by*
  - the note *From Customer Master · ePASS #…*
- **People already there are left alone.** Anyone already on that guest list with the same email isn't added twice or changed.
- **Nobody is emailed.** Sending stays on **Events & RSVPs → Email guests**: 100 people per send, PDFs attached, unsubscribes honoured.

**Sending a long list.** Event emails go through Resend. On Resend's free plan that is **100 emails a day** for all of Agility's email, so a guest list of several hundred takes several days of sends. A paid Resend plan removes the daily limit.

## Export CSV

The CSV holds the whole filtered list (not just the 100 shown), one line per customer:

- **Customer:** number, name and account details.
- **Email:** the email to use, its status (*OK*, *No email*, *Do Not Email (ePASS)*, *Unsubscribed*), and every email on file.
- **Phones and address.**
- **Dates:** customer since, last activity and preferred contact.
- **Purchases:** sales and service totals, first and last purchase, and brands bought.

It opens directly in Excel. A cell that starts with `=`, `+`, `-` or `@` is prefixed so Excel can't run it as a formula. Check the *Email status* column before using the CSV for any mailing outside Agility.

**NetSuite IDs** aren't on the page yet. When the NetSuite customer IDs are ready, they can be tied to the ePASS customer #.

## Where the numbers come from

**The customer list.** Every ePASS customer comes from ePASS's Customer master, contact and address columns only (never credit, ID or employer fields). It is refreshed daily by the new **epass-customers** bundle. The Cash Ops (finance) bundle also still carries the master.

**Lifetime totals and brands.** Once a day, the ePASS pull totals every finished sales invoice ever (R, S, AC, CAB and MOD, finished or not posted, not void) and every customer-pay service ticket (SV), per customer:

- **Sales:** number of orders, pre-tax revenue (serial + item + labor + misc + warranty totals), first and last finish date.
- **Service:** number of visits, revenue, last visit.
- **Brands:** every brand on the model lines of those sales orders, and when it was last bought.

An invoice is credited to its **bill-to** customer, or its **sold-to** when there's no bill-to, as everywhere else in Agility. ePASS's sales history reaches back to about 2006.

**Until the first lifetime bundle arrives**, the page uses the order history already in Agility (finished orders and the units on them). The line under the title then says those figures only reach back as far as that history does (it gives the date). It switches to *Lifetime sales and service from ePASS* by itself once the bundle lands.

## What Andrew needs to do on the ePASS server

The pull script and the agent each changed. Both run on the showroom server.

1. **Copy both scripts.** Copy `scripts/epass-odbc-pull.ps1` and `scripts/epass-agent.ps1` from the repo to `\\WILSON-FS02\SharedDrive\Agility\`, replacing the old ones. The agent reads its key from `epass-agent.key` beside it, so a straight copy is fine.
2. **Run it once now (optional).** Run the pull once with `-Customers` to send the first bundle without waiting for tomorrow:

   ```
   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "W:\Agility\epass-odbc-pull.ps1" -Customers
   ```

   Every query is a read-only SELECT. The brands query reads every model line since 2006, so the run can take a few minutes; run it outside the busiest hours.
3. **From then on, it's automatic.** The pull sends the bundle once a day, on its first run after 5 AM. It keeps the date in `W:\Agility\epass\customers-last-pull.txt`. The agent picks up the new `outbox\epass-customers` folder by itself.

**Checking it:**

- `W:\Agility\agent.log` should show three `OK [epass-customers]` lines a day: master, totals and brands.
- The line under the Customer Master title changes to *Lifetime sales and service from ePASS*.
- If a query fails, `W:\Agility\odbc.log` says which. That part of the page keeps its last good data, and the other parts still arrive.

**Something to confirm:** *Last activity* and *Preferred contact* come from ePASS's `LastActivityDate` and `PreferredContact`. These are listed in the ePASS field guide but haven't been pulled before. If ePASS doesn't have them, that one small query fails and logs it, and everything else still arrives.

## Checked before delivery

The real `server.js` ran on a local test database, with 300 made-up customers sent through the same agent upload the ePASS server uses.

- **Before the lifetime bundle:** totals, last purchase, service and brands came from Agility's own order history, and the page said so, with the date.
- **Lifetime bundle:**
  - Each part arrived and replaced only its own data.
  - A customer billed under two sold-to codes added up.
  - Service with no bill-to went to the sold-to.
  - First and last dates took the earliest and latest of both ePASS date fields.
- **Who can be emailed:** Do Not Email, Declined Email and an unsubscribed address were all excluded, and the next address on file was used when the first one couldn't be.
- **Filters:** every filter and sort, paging, and search by email or by phone as typed. Odd input (quotes, SQL) was treated as plain text.
- **CSV:** the whole filtered list, with brands and email status, ready for Excel.
- **Add to event:**
  - By filters and by ticked customers, as Planned with the guest type.
  - Names in ordinary case, and the company name kept for company accounts.
  - Adding the same list again added nobody.
  - Ticking someone with no email or Do Not Email added only the ones who could be emailed.
  - 501 at once and an unknown event were refused.
- **Who can do what:**
  - No grant: everything was refused.
  - Events & RSVPs alone: no Customer Master.
  - Customer Master alone: list and export, but no Add to event.
- **Audit:** exports, adds and the incoming bundles were all logged.
- **Browser, desktop and phone:** the list, Show more, the brand picker, the details panel, ticking, the Add dialog, the CSV download, and one card per customer on a phone with no sideways scroll.
- **Speed:** with 120,000 made-up customers, a page of the list took 0.05–0.4 s and a CSV of all 120,000 took about 1 s.
- **Earlier suites:** the event email tool still passes.

## For developers

- `lib/customer-master-postgres.js`:
  - **Schema:** `epass_customers.last_activity` / `preferred_contact`, `epass_customer_totals`, `epass_customer_brands`, `customer_master_meta`.
  - **Ingest:** `ingestCustomerBundle` handles the parts `customers`, `customer-extras`, `customer-sales`, `customer-service` and `customer-brands`. A missing dataset leaves its data as it was.
  - **Reading:** `listCustomerMaster` (filters, paging, totals, each row's brands), `exportCustomerMaster` with `customerMasterCsv`, and `addCustomersToEvent`, which allows at most 500 at a time and adds emailable customers only.
  - **Sources:** `totalsSql` / `brandsSql` read the lifetime tables when they have arrived, otherwise `sales_order_detail` and `epass_sold_serials`.
- `server.js`:
  - **Routes:** `GET /api/customer-master/meta`; `POST /api/customer-master/list`; `POST /api/customer-master/export.csv`; `GET /api/customer-master/:code/history`; `POST /api/customer-master/add-to-event`.
  - **Why POST:** filters travel in the body, not the address, because a search can be a phone number or an email.
  - **Agent kind:** `epass-customers` on `/api/epass-agent/upload`.
- `scripts/epass-odbc-pull.ps1`: the seventh bundle (`-Customers`; `customers-last-pull.txt`), written as three files `epass-customers-<stamp>-<part>.json`.
- `scripts/epass-agent.ps1`: the `epass-customers` kind. It isn't a snapshot kind, so all three files go up.
