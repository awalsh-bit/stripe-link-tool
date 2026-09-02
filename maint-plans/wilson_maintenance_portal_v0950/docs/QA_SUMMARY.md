# v0.8 QA Summary

## Static checks completed

- `assets/tech-maintenance.js` passes `node --check`.
- `assets/store.js` passes `node --check`.
- All 59 local `href` / `src` targets referenced by the remaining HTML pages resolve to files in the package.
- The retired `report-builder.html` page was removed; no UI routes to the old manual report builder.
- All stale `var(--green)` references were replaced with the defined Wilson variable `var(--wilson-green)`.
- `tech-maintenance.html` uses cache-busting query parameters for the v0.8 field CSS/JS during prototype testing.

## Behavior reviewed in code

- Residence/visit banner is `position: relative`, not sticky/fixed.
- Typing in age, readings, and notes performs targeted DOM updates only; it does not rerender the page.
- Field data is debounced and autosaved.
- Completion remains blocked until age, serial-tag photo, required readings, and all required checkpoints are present.
- Monitor and follow-up states are derived only from checkpoints explicitly marked performed.
- Completing a previously reported appliance refreshes its existing field-generated report rather than creating a duplicate.
- HVAC visits are explicitly blocked from the appliance health workflow.

## Visual QA note

The container's installed Chromium process did not complete even for `about:blank` during this pass, so automated headless screenshots were not available. The prior user screenshots were used to target the header defect, and the resulting CSS/DOM behavior was verified statically.
