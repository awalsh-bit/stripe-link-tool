# Draft Estate Base-Plus Pricing Rationale

## Recommendation

Keep the public Estate prices simple and generous, but add a modest portfolio adjustment only for unusually large homes:

| Plan | Published base | Appliances included | Additional appliance | Internal review |
|---|---:|---:|---:|---:|
| Estate Annual | $1,195/year | First 15 | $60 each above 15 | 26+ appliances |
| Estate Preferred | $1,995/year | First 15 | $100 each above 15 | 26+ appliances |
| Estate Concierge | $2,995/year | First 15 | $150 each above 15 | 26+ appliances |

There is no minimum appliance count. The customer form automatically uses Estate Annual as soon as it becomes a better comparable value than per-appliance pricing.

## Why this structure works

### It preserves the clean whole-home pitch

Most larger homes stay on one published price. Customers do not see a complicated per-appliance matrix after they have already chosen a whole-home plan.

### It protects Wilson on the largest portfolios

A 25-appliance property can require materially more technician time, documentation, filter administration, and office follow-up than a 10- to 15-appliance property. The adjustment keeps the effective revenue per appliance from falling too sharply at the top end.

### It scales with service level

The additional charge is lowest for one annual visit and highest for Concierge, where Wilson carries two visits, filters, detailed reports, priority handling, and more administrative ownership.

### It avoids an arbitrary hard cap

A cap can force a good estate client into an awkward exception process. Base-plus pricing keeps the program available while still flagging 26+ appliance homes for management review.

## Example totals

### Estate Annual - 12 appliances, including two IMUC icemakers

- Estate Annual base: $1,195.00.
- First annual visit for the whole appliance inventory: included.
- Recommended second IMUC visit selected for two icemakers: 2 x $249.95 = $499.90.
- Estimated annual total: **$1,694.90**.

### Estate Concierge - 20 appliances

- Estate Concierge base through 15 appliances: $2,995.00.
- Five additional appliances x $150: $750.00.
- Two coordinated visits, twice-yearly IMUC maintenance, standard refrigerator/freezer/IMUC filters, reports, and priority handling: included within plan scope.
- Estimated annual total: **$3,745.00**.

### Published plan totals at 25 appliances

| Plan | Calculation | Annual total |
|---|---|---:|
| Estate Annual | $1,195 + 10 x $60 | $1,795 |
| Estate Preferred | $1,995 + 10 x $100 | $2,995 |
| Estate Concierge | $2,995 + 10 x $150 | $4,495 |

## Internal quote workflow

1. Ask the house manager for a complete appliance list.
2. Enter grouped rows with quantities in the Custom Maintenance Quote Builder.
3. Select Annual, Preferred, or Concierge.
4. The tool calculates base price, overage, IMUC add-ons, and any labeled manual adjustment.
5. At 26+ appliances, management confirms labor and scope before the proposal is sent.
6. Send or print the branded proposal.
7. Once accepted, convert the quoted inventory into the household onboarding record.

## What to validate before making this permanent

Review the largest completed residences and estimate:

- technician hours per visit,
- number of technicians needed,
- drive and access time,
- filter cost and handling time,
- report/documentation time,
- average repair opportunity created by maintenance,
- repeat-visit and scheduling overhead.

The rates should be adjusted in `assets/plan-config.js` after that review. The application and SQL schema keep these values configurable rather than hard-coding them into page markup.
