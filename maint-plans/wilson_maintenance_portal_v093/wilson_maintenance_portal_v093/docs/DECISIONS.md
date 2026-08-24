# Maintenance Portal Decision Log

_Last updated: 2026-08-21_

## Confirmed business rules

### Household appliances

- Standard single appliance: **$149.95 per appliance per year** for one visit.
- IMUC icemaker: **$249.95 per visit**.
- Twice-yearly IMUC cleaning and maintenance is the recommended enrollment choice and is selected by default.
- A customer may reduce an IMUC to one annual visit where the selected plan only includes one visit.
- Estate eligibility has no minimum appliance count.
- The customer form automatically switches from per-appliance pricing to Estate Annual when Estate Annual becomes the lower comparable total.
- Estate Annual: **$1,195/year**, one coordinated whole-home visit.
- Estate Preferred: **$1,995/year**, two coordinated visits.
- Estate Concierge: **$2,995/year**, two visits, scoped cleaning, priority service, standard refrigerator/freezer/IMUC filters, and detailed appliance health reports.
- BBQ / grill cleaning is excluded.
- Disassembly is excluded unless separately approved.

### HVAC

- HVAC enrollment remains separate from household appliances on the customer side.
- Appliance and HVAC enrollments merge into the same internal household and payment workspace.
- Wilson AC Maintenance: **$200 per system per year**, including two visits.
- Wilson AC Maintenance + Filters: **$400 per system per year**, including two visits plus filter inventory, sourcing, and replacement management.
- Wilson contacts the household in spring and fall, weather permitting.

### Payments, scheduling, and renewal

- The customer saves a reusable payment method during enrollment.
- Wilson does not charge the annual amount at signup.
- The office charges the card when a scheduled maintenance interval is ready to proceed.
- Plans renew annually until canceled by the customer.
- NetSuite is the likely future service-order destination. The current button remains a visible integration placeholder.

### Filters

Track these filter categories:

- Refrigerator water filter.
- Refrigerator air / food-preservation filter.
- Freezer water filter.
- IMUC water filter.
- HVAC media filter.

Estate Concierge includes standard refrigerator, freezer, and IMUC filters within plan scope.

## Current design assumptions that remain configurable

### Estate base-plus pricing

- Published base covers the first **15 appliances**.
- Appliance 16 through 25 adds:
  - Estate Annual: **$60 each**.
  - Estate Preferred: **$100 each**.
  - Estate Concierge: **$150 each**.
- A portfolio with **26 or more appliances** remains calculable but requires management review before the proposal is sent.

This is a pricing recommendation pending review of Wilson's largest completed residences.

### HVAC filter material

The $400 HVAC tier currently includes filter management, sourcing, schedule tracking, and replacement coordination. Filter material is modeled as billed separately. This was chosen because filter management was confirmed, but included material was only explicitly confirmed for appliance Concierge.

### Appliance health scoring

The starter report gives equal weight to every applicable checkpoint. Appliance-specific weights and thresholds will replace this after Wilson finalizes the checklist for each appliance type. Report templates should be versioned so historical scores do not change later.

## Next decisions to lock down

- Exact cleaning scope by appliance type.
- Whether common low-cost HVAC filters should be included in the $400 tier or always billed separately.
- Customer cancellation workflow and effective date.
- Renewal reminder timing.
- Filter replacement cadence defaults by part and equipment type.
- Appliance-specific report checkpoints, measurements, and score weights.
- Whether report photos appear inline in the customer PDF or through a secure gallery link.
