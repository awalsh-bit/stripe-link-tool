# v0.7 Decisions — Field-Generated Health Reports

## Report workflow

- The separate office-side Appliance Health Report Builder is retired.
- Appliance health reports originate only from completed technician field inspections.
- Completing an appliance in the mobile technician tool automatically generates its customer report.
- If a completed field record exists but report generation is missing, the household page may expose a recovery **Generate health report** action. No report-generation action is shown without completed field data.
- When every appliance in the maintenance visit scope is complete and has a report, the visit is automatically marked **Completed** and the report package becomes **Ready to email**.
- The Command Center surfaces report packages that are ready for customer delivery.
- **Email to client** is an integration boundary in the prototype: it records the package as queued for email, but does not transmit external email yet.

## Locked customer report design

The customer-facing Appliance Health Report layout is now treated as the locked presentation template for every appliance type. Appliance-specific checks and readings change, but the visual report structure does not:

1. Cover / appliance score
2. Appliance Vitals
3. Score Breakdown
4. Inspection Details
5. Corrective Measures
6. Report Information
7. Service Summary / photo record

## Technician mobile UX

- Number entry no longer rebuilds the page while the technician types.
- Age, temperature readings, notes, and sliders update their local state/live calculations without resetting scroll position or keyboard focus.
- Refrigeration condenser TD updates live from ambient and condenser surface readings.
- Serial-tag photo remains mandatory for every appliance.
- Checkpoint photos remain optional and are attached only when useful.

## Product lifecycle tiers

Internal tier IDs stay `luxury`, `premium`, and `mass`, but the technician-facing labels are:

- **Luxury**
- **Mass premium**
- **Mass**

Starter brand defaults include:

- Thermador -> Luxury
- Sub-Zero / Wolf / Cove / Miele / True -> Luxury
- Bosch -> Mass premium
- KitchenAid -> Mass premium
- Monogram / Cafe / Fisher & Paykel / JennAir -> Mass premium
- Whirlpool -> Mass
- Maytag / mainstream GE / mainstream LG / Samsung / Frigidaire -> Mass

The technician may override the default tier when the specific product warrants it.
