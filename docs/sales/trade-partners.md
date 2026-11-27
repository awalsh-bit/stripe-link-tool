# Trade Partners

*Added 11/27. Andrew, on the Trade Partner Rebate Program flyer: "this flyer would not be available to the public for download, this would be in the Agility user side as a builder sales tool with a public registration process and approval process on our side." His choices: build all three pieces; tier lines at $25,000 / $100,000 / $200,000; the registration form at an unlisted address only; nothing sent to the builder automatically.*

## The three pieces

| Piece | Where | Who |
| --- | --- | --- |
| **The flyer** | Agility, **Trade Partners** (Sales Tools) | Anyone granted the page; executives always |
| **The registration form** | `shop.wilsonappliance.com/trade-partner` | A builder who has been sent the link. No login. |
| **The review** | The same Trade Partners page, under Registrations | Reading and notes: anyone with the page. Approve / decline: executives. |

Trade Partners is in the **Sales** job preset in User Admin, so a new salesperson set up from the preset gets it. People who already have a login need it ticked for them.

## The flyer

The page draws the flyer as one letter sheet, from the program's terms file (below). **Print or save as PDF** prints the flyer alone: the rest of the page is left out, however printing is started. To email it, choose *Save as PDF* as the printer and attach the file.

The flyer is only inside Agility. It is not on the website, and the registration page does not show the rates.

## The registration link

Each person's Trade Partners page shows **their own link** (`…/trade-partner?rep=` and a ten-character code). A registration that comes through it is marked "link from *name*", and that person's notification says "They registered with your link." The code is the first ten characters of the person's Agility account id; it means nothing outside Agility and carries no name or email.

The address is **unlisted**:

- no page links to it, and it is not in the sitemap or named in `robots.txt`;
- the page is sent `noindex` (in the response and in the page), so a search engine that does find it will not list it;
- it carries no Google or Meta tags.

Unlisted is not secret. Anyone who is forwarded the link can open the form. What they see is the program's rules and a form; the rates are on the flyer.

## What the builder is asked

Required: company name, type of business, city, state, ZIP, first and last name, email, phone, and a tick agreeing to the program terms shown above the tick.

Optional: street address, website, title, best way to reach them, appliance purchases in a typical year, homes or projects a year, years in business, whether they buy from Wilson today, their Wilson consultant, and a note.

**Never asked for and nowhere to store it:** a tax ID, Social Security number, driver's licence, bank details or a card. If a W-9 is wanted before a rebate is paid, collect it the way accounting does today, not through this form.

The terms the builder agreed to are stored with the registration, word for word, so a later change to the terms does not change what they agreed to.

After sending, the page thanks them by name, shows a reference (`TP-` and six characters) and says a Wilson consultant will be in touch. **Nothing is emailed or texted to the builder**, then or later.

## What happens at Wilson

1. Everyone who holds Trade Partners, and every executive, gets a **Trade partner registration** notification on My Notifications: the company, the contact, the kind of business and the town. The builder's email and phone are not in the notification; they are on the page.
2. On Trade Partners, **Waiting** lists them, oldest first. Opening one shows everything the builder answered, with tap-to-call and tap-to-email.
3. An executive chooses **Approve** or **Decline**.
   - Approve asks for the builder's **ePASS account** (search by name or number in Agility's copy of the customer list). It can be left for later: a new builder may not have an account yet. The rebate is worked out on that account, so set it before year end.
   - Decline takes an optional reason, kept for us.
   - **Put back to waiting** undoes either one.
4. The notifications clear for everyone once it is decided.
5. Someone calls or emails the builder. The page says so after every decision: "Nothing was sent to Lee: call or email to let them know."

Anyone with the page can add **notes**. Notes and decisions are listed together, newest first, with who and when.

A second registration from the same company or the same email in the same program year is kept and tagged **Possible duplicate**, naming the first. A second tap on Send within ten minutes is not a second registration.

An address ending in a reference opens that registration: `trade-partners.html#TP-ABC123`.

## The program's terms

`data/trade-program.json` is the one place the program is written down. The flyer and the registration page are both drawn from it.

| Setting | Now | What it does |
| --- | --- | --- |
| `programYear` | 2027 | The year on the flyer, the form and each registration. |
| `tiers` | Partner $25,000 at 1.0%, Preferred $100,000 at 1.5%, Premier $200,000 at 2.0% | The tier table. Ranges ("$25,000 – $99,999"), "with bonuses" and "up to 4%" are worked out from these. |
| `selectBrands` | +1%: Bosch, Thermador, Monogram, Signature Kitchen Suite, Fisher & Paykel | The brand bonus. |
| `payment` | +1%, Check or ACH | The payment bonus. |
| `example` | $150,000 in purchases, $40,000 of it select brands | The flyer's "What it looks like". The arithmetic is done from the tiers ($2,250 + $400 + $1,500 = $4,150), so it cannot disagree with the table. |
| `terms` | Three paragraphs | Printed on the flyer and shown above the tick on the form. Appliance invoices only (cabinetry and HVAC are not part of it); an invoice counts once it is paid in full and posted by December 31. |
| `registrationOpen` | true | false: the form is replaced by "Registration for 2027 is closed" and the phone number, and a form sent anyway is refused. |
| `showRatesOnRegistration` | false | true: the registration page also shows the tier table and the two bonuses. Off because the flyer is not public. |
| `contact` | 512-894-0907, wilsonappliance.com, 4205 E Hwy 290 | The flyer's footer and the phone number on the form. |

A change to the file takes effect when it is deployed. If the file has a slip in it (a rate that is not a number, two tiers starting at the same amount), the flyer is hidden, Trade Partners says the terms file can't be read, the registration page asks people to call, and the server log says what is wrong ("The Preferred tier needs a rate between 0 and 25"). Nothing half-right is printed.

For a new program year: change `programYear`, the dates in `terms` and `payout`. Earlier years' registrations stay as they are, each marked with its year.

## Limits

- One address makes at most 12 tries an hour at the form.
- A hidden box catches programs that fill in every field: they are thanked and nothing is kept.
- Approving is recorded once. Two executives deciding at the same moment: the second is told someone already did.

## Not covered

- **Working out the rebate.** This keeps who is in the program and which ePASS account is theirs. The year-end figures come from ePASS invoices (appliance invoice types, finished, paid and posted by December 31).
- **Telling the builder.** By choice. No approval email, no decline email.
- **Opening a house account.** Registration is not a credit application.
- **A QR code or the link on the printed flyer.** The flyer says "Your Wilson consultant sends your registration link."

## Where it lives

- `data/trade-program.json`: the terms.
- `lib/trade-program.js`: reading and checking the file; `tradeProgramFull` (flyer), `tradeProgramPublic` (registration page, no rates), `tradeRebateFor` (the arithmetic).
- `lib/trade-partners-postgres.js`: table `trade_partner_registrations`; `cleanTradeRegistration`, `createTradeRegistration`, `listTradeRegistrations`, `decideTradeRegistration`, `setTradeRegistrationAccount`, `addTradeRegistrationNote`.
- `server.js`: `GET /trade-partner`, `GET /api/trade-partner/program`, `POST /api/trade-partner/register` (public on the shop host); `GET /api/trade-partners`, `POST /api/trade-partners/:id/note`, `/decision`, `/account`, `GET /api/trade-partners/epass-search` (page grant; the last three executive-only). The page is registered in `INTERNAL_PAGE_PATHS`, `PAGE_LABELS`, the Sales category and the Sales preset.
- `trade-partner.html`: the registration page. `trade-partners.html`: the Agility page. `internal-shell.js`: the menu entry.
- `fonts/archivo-latin-wdth-normal.woff2`, `fonts/inter-latin-wght-normal.woff2`: the flyer's typefaces (SIL Open Font License), used only inside the flyer.

Audit log: `trade_partner_registered`, `trade_partner_approved`, `trade_partner_declined`, `trade_partner_reopened`, `trade_partner_note`, `trade_partner_account_set`.
