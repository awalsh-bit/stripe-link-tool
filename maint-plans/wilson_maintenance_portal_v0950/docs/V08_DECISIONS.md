# v0.8 Field Technician UX Decisions

## Purpose

This pass focuses on the technician-facing appliance-maintenance workflow. The field tool is meant to behave like a guided mobile application rather than an office form.

## Visit header

- The residence/visit banner is no longer sticky.
- The banner uses the Wilson dark-green/green gradient with high-contrast white text.
- The earlier transparency bug came from references to an undefined CSS variable (`--green`). v0.8 standardizes those references to `--wilson-green`.
- The field banner shows the household, visit interval, service address, signed-in technician, completed count, remaining count, attention count, and visit progress.

## Technician identity

Production should receive the current technician identity from the authenticated Wilson internal dashboard/session. The field page should not have a second technician login or technician-name picker.

For prototype testing only, a name can be passed in the URL:

`tech-maintenance.html?visit=visit_davenport&technician=Trevor%20Pate`

If the host application does not supply a user yet, the prototype displays `Wilson technician`.

## Guided home screen

The visit landing screen now prioritizes:

1. A single Suggested Next Step card.
2. Any appliances already marked Monitor or Needs Follow-up.
3. Appliance groups by area with per-area completion percentages.
4. A status on every appliance: Not started, In progress, Complete, Monitor, or Needs follow-up.

In-progress appliances are suggested before untouched appliances so the tech can resume work without hunting for the last record.

## Field entry

- Field entries autosave after a short debounce.
- Manual Save Now remains available.
- The technician stays at the current scroll position while typing or entering readings.
- Checkpoint status updates in place; the page is not rebuilt on each keystroke.
- Each checkpoint includes large touch-friendly quick ratings for 1/Poor, 3/Monitor, and 5/Good plus the full 1–5 slider for 2 or 4.
- The Performed control remains explicit.
- Required serial-tag photo remains mandatory.
- Checkpoint photos remain optional.

## Completion guidance

A readiness strip immediately above the completion buttons tells the technician exactly what is still missing, for example:

- enter age
- capture serial tag
- 2 checks remaining
- 1 required reading

`Complete & generate report` is enabled only when all required items are present.

## Reports

Completing an appliance still generates its customer-facing health report directly from field data. If a tech reopens a completed appliance to correct field data and completes it again, v0.8 refreshes the existing report rather than leaving the old report content unchanged.

When the last scoped appliance is completed, the visit landing page changes to a completion card and directs the office to review the generated report package.

## HVAC guardrail

The appliance field tool will not display household appliances for an HVAC maintenance visit. HVAC visits are explicitly redirected to Wilson's existing HVAC maintenance workflow. This prevents an HVAC visit from incorrectly showing the property's appliance inventory.
