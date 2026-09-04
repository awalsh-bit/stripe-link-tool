# Wilson AC & Appliance — company context for Claude

Written 2026-09-03 by the Cowork session that built Agility (Wilson's internal dashboard). This is what another Claude instance needs to know to help Andrew Walsh with business work — a project quote in particular — without re-learning the company from scratch. Everything here comes from the Agility codebase, its customer-facing pages and terms, the maintenance-program specification, and Andrew's own instructions in that session. Where a number is a placeholder or a demo value it says so. **Nothing here is a secret; do not add credentials, keys, or customer data to this file.**

## 1. The company in one paragraph

Wilson AC & Appliance (legal entity **WACA, Inc.**) is a family-owned premium appliance dealer, factory-authorized service provider, and HVAC contractor in **Dripping Springs, Texas**, serving the Austin area and the Hill Country. Founded **1949** ("Trusted since 1949"). Showroom and offices at **4205 E Hwy 290, Dripping Springs, TX 78620**, twenty minutes from Austin; hours Mon–Fri 10–6, Sat 10–4, closed Sunday. Main phone **512-894-0907**; web wilsonappliance.com; accounting@wilsonappliance.com. Texas Air Conditioning License #008513E; Texas Residential Appliance Installer License #297. The pitch to the trade is "one local team from selection to install" — in-house sales, delivery, installation, and repair rather than third-party crews.

## 2. Lines of business

| Line | What it is | Notes |
|---|---|---|
| **Appliance sales (retail + trade)** | Premium and luxury kitchen and laundry appliances, sold to homeowners, builders, designers, architects, and estate house managers. | Core revenue. Authorized Sub-Zero / Wolf / Cove dealer with a working showroom of live displays. |
| **Delivery & installation** | In-house crews ("our crews, not a third party"), haul-off, hookup. Runs are built in Agility's dispatch tool; drivers use a phone run sheet; customers get texted tracking links. | Trucks are identified by route codes D01, D02, … Delivery pricing to trade/retail is quoted in ePASS, not in Agility — the only price Agility knows is the online-clearance offer (below). |
| **Repair service** | Factory-authorized warranty and out-of-warranty repair. Public request form at service.wilsonappliance.com. | Diagnostic fee $169.95 first appliance, $92.01 each additional; quotes valid 14 days; one no-charge recall trip within 30 days; $100 credit toward a replacement over $1,000 if the customer chooses to replace rather than repair. Warranty region "typically a 25-mile radius". |
| **HVAC** | Sales, installation, and service; Trane dealer. | Separate department ("HVAC Sales"); HVAC maintenance plans below. |
| **Kitchen Design** | A department of its own; works with designers/architects on specs, panel details, ventilation. | Spec packages (cut sheets) are compiled through Steel Cod from an ePASS quote. |
| **Online clearance shop** | shop.wilsonappliance.com — open-box, display, and outlet inventory at MAP-compliant prices, delivery-zip restricted to the local area. | Online offer: "White Glove Delivery + Haul Away" $49.95 (regular $89.95) or free customer pickup; 8.25% sales tax; blind day-only scheduling with a 4-hour window two business days out; clearance/outlet must be picked up within 30 days. |
| **Maintenance plans (launching)** | Annual appliance and HVAC maintenance program with field health reports, filter service, and "Refrigeration Guardian" temperature monitoring. Built as a module in Agility; pricing approved Sep 2026 (section 6). | Program lead is Cayden. |
| **EPIC Protect** | Extended-protection plans sold with appliances ("Protect (Wty) lines"). | Commissioned on attachment rate. |
| **Events** | e.g. "Fire & Flavor" outdoor-living showcase (May 2026) with supplier-exclusive event packages. | RSVP pages are built in Agility. |

## 3. Brands

Warranty-service brands named in Wilson's signed terms: **Sub-Zero, Wolf, Cove, La Cornue, Monogram, GE, GE Profile, Café, Thermador, Bosch, Miele, Kalamazoo Outdoor Gourmet, Speed Queen, Alfresco, Whirlpool, Maytag, KitchenAid, JennAir, Trane, Evo.** Other brands that show up in sales data and the maintenance brand-tier tables: Scotsman (icemakers), Fisher & Paykel, LG, Asko, Hestan, Lynx, Vent-A-Hood, Liebherr, SKS (Signature Kitchen Suite), Amana, Dacor. The showroom identity is Sub-Zero/Wolf/Cove first ("Wolf red knobs, front and center"); the product mix skews to pro ranges and rangetops, built-in and column refrigeration, hood liners, top-control dishwashers, premium front-load laundry, built-in coffee, outdoor grills.

The maintenance program groups brands into lifecycle tiers that are a fair proxy for how Wilson thinks about price bands: **Luxury / Long-Life** (Sub-Zero, Wolf, Cove, Miele, La Cornue, Thermador, Kalamazoo, Hestan, Lynx), **Premium / Mass-Premium** (Monogram, Café, JennAir, Bosch, KitchenAid, Fisher & Paykel, Speed Queen), **Mass-Market** (GE, Whirlpool, Maytag, LG, Amana).

A "WashTower / laundry center" is treated as **two appliances** (washer + dryer) for maintenance and service — Andrew's decision, 2026-09-02.

## 4. Who's who

- **Andrew Walsh** — owner/executive, the person Claude works for. Executive login on Agility. Makes final calls on pricing, policy, and product. Standing rules he has set are in section 9.
- **Cayden** — leads the maintenance-plan program (pricing, protocols, Guardian monitoring); supplied the field-protocol worksheets and brand tables.
- **Jack Ort** (jort@wilsonappliance.com) — sales; built the Filter Finder tool and the install-damage form that were folded into Agility.
- Departments in the employee directory: **Appliance, Client Care, Repair Service, Kitchen Design, HVAC Sales.** Client Care is the office/dispatch/queue team (service requests, leads, estimates, payments). Delivery/installation crews report through dispatch.
- Appliance/service technician names seen in the maintenance spec (given as real staff during prototype development): Mark Perks, Andrew Horst, Diogo Assis, Kyle Bisson, Josh Chappell, Trevor Pate, Connor Montgomery, Chris Turner, Brady Langley, John Merz.
- Sales reps are identified by short **employee codes** (e.g. "JD", "VWJ"); a split sale is coded "JD+VWJ" and commission is allocated equally.

## 5. Systems and where the numbers live

| System | Role | What Claude should know |
|---|---|---|
| **ePASS** | The point-of-sale / order system. Quotes, sales orders, service orders, invoices all originate here. Invoice numbers look like `S00063887` (split invoices `S00063887-1`); service orders `SV00122934` (dash-one variants exist). | Product pricing, delivery/install charges, and quotes are made in ePASS. Agility only reads exports from it. |
| **NetSuite** | ERP/accounting and the clean item catalog (model → brand → description). | The NetSuite item export is the authoritative brand/model map. |
| **Agility** (dashboards.wilsonappliance.com) | Wilson's internal web app (Node/Express + Postgres on Render), ~70 tools: payments (Stripe links/terminal/saved cards), service request queue, service estimate approvals, quote follow-up, lead routing/DIBS, sales-order health & detail, brand sales, commissions, bonus tracker, HR (phone screens, candidates, uniforms), dispatch/driver/tracking, install damage, shop orders, credit applications, terms signatures, spec packages, Sub-Zero appointments, and the maintenance module. | Public forms live on service.wilsonappliance.com; the shop on shop.wilsonappliance.com. |
| **Stripe** | Card payments, payment links, terminal readers, card-on-file (SetupIntent) for service and estimates. | Never handle card numbers in plain text — Stripe Payment Element only. |
| **Podium** | Customer texting and review invites; leads and lead claims post internal notes there. | Any Agility→Podium activity must leave the conversation open. |
| **DispatchTrack** | Delivery/service routing (being piloted for replacement by Agility's own dispatch + Samsara geofences). | "Finish job" in DT currently triggers the Podium review invite. |
| **Samsara** | Truck telematics/geofencing. | |
| **Resend** | Transactional email. Client-facing sender "Wilson AC & Appliance <no-reply@wilsonappliance.com>"; internal alerts "Agility Alerts". | |
| **RetailDeck** | Warehouse inventory & price workbook (~108k rows) that feeds MAP/UMRP floor prices for the clearance shop. | The MAP price URL is a secret. |
| **Steel Cod** | Spec-sheet package compiler (cut sheets by model, grouped by room) for sales quotes. | |
| **Crystal / Sales Order Detail** | Monthly warehouse export of sales-order lines (serial type ALL/OPEN/DISPLAY/RTV/SVC, list, cost, GM%, department, salesperson) — the basis for commissions, brand sales, and order health. | Serial type ALL = new product; OPEN/DISPLAY = closeout; RTV/SVC = exchange/service units. |

## 6. Prices and policies that are fixed and public

**Sales terms (signed by every customer, `terms-sign.html`)**
- Installation follows manufacturer guidelines; Wilson does not modify framing, cabinetry, electrical, water, drain, gas, dryer venting, or hood ducting — those are the contractor's/customer's responsibility and must meet code before install.
- Gas/water connections are tested at install only if supply is present; otherwise the customer assumes leak liability.
- Clear, hard-packed access path required; stairs must be communicated to dispatch; difficult access can incur additional fees. Basic floor protection is included; plywood/Masonite is extra.
- Remote/in-line ventilators and primary hood ducting are installed by other trades; Wilson supplies minor connecting duct only.
- **Special-order sales are final.** 25% restocking fee on returns after delivery/pickup and on expanded-assortment cancellations after Wilson has received the product. Open-box sold as-is cosmetically.
- Pricing can change under manufacturer dealer agreements or significant fulfillment delays; long customer delays after receipt can mean repricing or a monthly storage fee.
- **Payment in full before Wilson accepts receipt from the vendor**; credit accounts per agreement. Pickup orders must be collected within five days of the scheduled date.

**Trade / builder credit accounts (`builder-credit.html`)**
- Net 30 from invoice; 1.5%/month (18%/yr) service charge past 45 days; suspension of deliveries/scheduling when past due or over limit; venue Hays County, Texas.
- Damage/shortage/defect claims in writing within 3 business days of delivery. Special-order returns subject to manufacturer approval; standard-assortment returns 25% restocking.
- Tax-exempt trade buyers must send a Texas resale certificate to accounting@wilsonappliance.com. Applications ask for annual purchase volume, PO requirement, two trade references, and a bank reference.

**Repair service (`terms.html`)** — diagnostic $169.95 first / $92.01 additional (after tax); 14-day quote validity; $100 off a replacement purchase over $1,000; 30-day recall trip; cosmetic warranty generally 30 days from delivery; warranty excludes cleaning, maintenance, education, misuse, installation issues.

**Maintenance plans (approved pricing, Sep 2026)**
- Standard appliance **$149.95 per appliance per year** (one visit). Icemaker (IMUC) **$249.95 per visit**, two visits per year by default.
- Estate plans: **Estate Annual $1,195/yr** (1 visit, first 15 appliances included, $60 each above 15), **Estate Preferred $1,995/yr** (2 visits, $100 each above 15), **Estate Concierge $2,995/yr** (2 visits, $150 each above 15). The customer flow switches to Estate automatically when it becomes cheaper than per-appliance pricing; 26+ appliances flags management review.
- Refrigeration filter service priced per filter at the standard rate, quoted as an estimate verified before first charge.
- HVAC: **Wilson AC Maintenance $200/system/yr** (spring + fall visits) or **AC Maintenance + Filters $400/system/yr** (filter tracking/sourcing; filter materials billed separately).
- Refrigeration Guardian (24/7 temperature sensor, priority dispatch on a sustained flag): with a plan **$199/yr first sensor, $99 each additional**; standalone **$299 first, $149 additional, plus $99 install** (install fee credited toward a plan started within 90 days).
- Charged by the office at the visit window (14 days either side of the planned interval), card-on-file or AR/Net-30 for account households; plans auto-renew annually. Adding appliances mid-term bills the full-year difference; removals/plan changes are prorated.
- Outdoor grills are maintained on function only — Wilson never cleans a grill.

**Compensation model (for understanding margin expectations, not for sharing with customers)**
- Field Sales Consultant: tiered % of list on new serial inventory by line gross margin — 18–20.99% GM → 2%, 21–24.99% → 3%, 25–30.99% → 4%, 31%+ → 5%, under 18% pays nothing and is flagged. Closeout (OPEN/DISPLAY) flat 5%. EPIC Protect by attachment rate (<1% → 5%, 1–4.99% → 10%, 5%+ → 15%) plus $500 when Protect sells ≥ $5,000 in a month. Eligibility gate: $500k delivered serial revenue in any rolling six months.
- Showroom Consultant: 5% on display/open lines; Protect as above. HVAC Selling Technician: per-order net-margin payout.
- Implication for quoting: **the house target on new product is ≥ 21% line GM; below 18% is a problem.** Bonus tracker pays department and company tiers on MTD attainment vs. prorated monthly targets (targets are entered by Andrew; the shipped defaults are placeholders).

## 7. How a sale moves through the company

1. **Lead** — website/showroom/Sub-Zero landing page/design consultation booking/service "prefer to replace" → Agility notification → a rep **DIBS** (claims) it; if the customer already has an open ePASS quote or sales order, the lead is routed to that rep as "Your Client" instead of fanned out. Podium gets an internal note; the customer is contacted only by a human.
2. **Quote** — built in ePASS by the rep; spec package (cut sheets) compiled through Steel Cod; the Quote Follow-Up tool tracks open ePASS quotes by customer number and nudges reps.
3. **Sale** — deposit/payment in full before vendor receipt (or Net-30 trade account); terms signed electronically; Protect offered; special orders final.
4. **Fulfillment** — Sales Order Health tracks open orders, routing (D01/D02…), written/delivered units by serial; delivery runs built in dispatch, texted tracking links, install by Wilson crews; install-damage reports go to the service queue with photos.
5. **After** — Podium review invite on job completion; service requests through the public form (photos optional, card-on-file for out-of-warranty); service estimates emailed for approval with a "prefer to shop for a replacement" path that creates a sales lead; maintenance enrollment.

## 8. What a "project quote" typically needs from Wilson's side

Because Agility does not price product, a project quote (a builder/remodel/estate appliance package) is built from these inputs, and Claude should ask for or assume them explicitly:

- **Model list by room/area** (the maintenance and spec tools both organize by Main House / Casita / Guest House / Pool House / Outdoor Kitchen — Wilson's customers are often multi-structure properties).
- **Sell prices** from ePASS or the RetailDeck/MAP floor — Claude will not have these; Sub-Zero/Wolf/Cove and most luxury brands are MAP/UMRP-governed, so discounting shows up as delivery/install/Protect bundling and event or manufacturer promotions (e.g. "Save up to $1,500 on Sub-Zero Classic and Pro Series refrigeration through Sept 30, 2026"), not list-price cuts.
- **Line GM** — keep new product at or above ~21% GM; flag anything under 18%.
- **Delivery & installation** as separate lines, per the sales terms (access, floor protection, ducting exclusions, gas/water presence). Standard install pricing lives in ePASS; ask Andrew for the current schedule.
- **Protect (extended protection)** as an attach line; **maintenance plan** as an optional year-one add (Estate Annual is the natural fit for 8+ appliances: $1,195 covers 15).
- **Terms**: payment in full before vendor receipt (retail) or Net-30 (approved trade); special orders final; 25% restocking; 8.25% sales tax in Dripping Springs (verify jurisdiction for the job address); Texas resale certificate for tax-exempt trade.
- **Timeline** language: Wilson accepts vendor receipt only against paid orders; storage fees or repricing can apply if the site is not ready; pickup orders within five days.

## 9. Andrew's standing rules (apply to anything Claude builds or drafts)

- **No surprise automated customer contact.** Any text/email to a customer comes from an explicit human click or an explicitly enabled toggle. Internal alerts are fine.
- **No plain-text card handling**, ever; Stripe elements only. Agility must not store SSNs or driver's-license numbers (HR onboarding stays with the PEO/Adobe Sign).
- Secrets (Stripe, Podium client secret, MAP price URL, snapshot/agent keys, Gmail app password) live only in Render env vars and the on-prem agent config — never in files or chat.
- The W: drive is sensitive: the cloud never reaches in; an on-prem agent pushes outward.
- Agility→Podium activity must never leave a conversation closed.
- Andrew prefers doing things in-product over env vars when a setting is operational; he reviews screenshots and wants the three colour schemes (green default, red, purple) and phone layouts respected.
- He works interactively and decisively: give him the recommendation and the decision points, then build.

## 10. Things this file cannot tell you (ask Andrew)

Current product prices and cost; delivery/installation price schedule; current promotions beyond the Sub-Zero offer above; credit limits for a given trade account; staffing counts; HVAC equipment pricing; whether the maintenance program is selling yet (as of 2026-09-03 the module is a demo inside Agility with approved pricing, pending the backend).
