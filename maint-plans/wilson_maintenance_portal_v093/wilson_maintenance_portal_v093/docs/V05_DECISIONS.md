# v0.5 design decisions

## Operations landing page
The dashboard landing view is now an action board rather than a master table. Household and plan records remain available in the Households section.

Priority order:
1. Action Required — payment problems and charged intervals without a service-order match.
2. Ready to Charge — planned date is between -14 and +14 days and billing is ready (card or AR).
3. Schedule / Ticket — paid / posted intervals that still need a service order or export match.
4. Completed & Health — recent completed work and technician/report access.

The future EPASS matcher is intentionally a placeholder. The production matcher should consume the existing daily/recurring export and compare household/address, service interval, order status, and maintenance-related ticket data before clearing a paid-without-ticket exception.

## Estate pricing logic
The customer is no longer forced into Estate Annual simply because it first crosses below per-appliance pricing. The calculator compares:
- Per Appliance
- Estate Annual, including second-IMUC visit add-ons
- Estate Preferred, where two annual visits already cover twice-yearly IMUC maintenance

The lower-cost Estate tier becomes the automatic starting selection. Concierge remains an elective upgrade.

## Field health workflow
Age is required separately from the 3-5 current-condition health checkpoints. All checkpoints and a serial-tag photo are required before an appliance can be completed. The prototype stores photo names/counts only; production should upload image files to secure object storage.

Draft scoring = 75% current vitals + 25% lifecycle age.

Lifecycle assumptions are intentionally configurable and provisional. Current draft category/tier years are in `assets/plan-config.js` and should be refined with Wilson service-history data.
