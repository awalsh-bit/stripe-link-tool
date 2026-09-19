# Flat-rate book analysis (2025.6.21 ePASS import)

Source: `reference/2025.6.21_Service_Flat_Rates_ePASS_Ready.xlsx`, sheet "Service Flat Rates - 2025.6.21". Analyzed 9/11/2026. Draft catalog: `reference/task_catalog_draft.csv` (743 family × task rows, before de-duplication).

## Findings

- 13,646 labor lines = ~460 distinct task names × 64 brand suffixes (about 750 task-family combinations).
- **Price = Time Allowance × Hourly Rate** in 13,621 of 13,646 rows. $130/hr appliance, $150/hr HVAC (AC family, 595 rows). No independent price data.
- **Rate Type (Premium / Standard)** is a brand label. Both are $130/hr. 41 brands Premium, 8 Standard, 10 brands appear under both.
- **Time varies by brand for only 46 of ~750 combinations**, almost always one brand as an outlier (e.g. 28 brands at 0.75 h, one at 1.0 h). Looks like drift, not intent. Difficulty is already encoded in task names: Hidden/Exposed, Pro/Standard, Front/Rear service, Built-in/Freestanding, Two Technicians.
- **Tax 2 column = labor taxable flag** (7,057 Y / 6,589 N). Whole families N: DW, VH, IM, CF, SO, WD, CO, AC, DI. Whole families Y: WA, DR, ID, OD. Mixed families (RE, CE, CG, MW, GR) flip to N by *brand*: BlueStar, Gaggenau, Monogram, Miele, Sub-Zero, Thermador, True. Brand is a proxy for "built-in". Rule as stated by Cayden: labor taxed unless the unit is part of the home (built-in appliances, HVAC); parts, diag and zone fees always taxed.
- Duplicates by wording/typo: two "Belt Replacement", two "LP/Nat Gas Conversion", four near-identical sealed-system compressor rows, two door-gasket wording variants, "Door  Replacement" (double space).
- Brand code `TRUE` has been converted to boolean `True` by Excel on 115 rows — check how ePASS imports it.
- 3 EMER and 2 JB rows have no time allowance.

## Proposed structure (blueprint §5.6)

1. Task catalog (~450 after de-dup): family, task, base hours, tags, customer-facing description.
2. Modifiers as separate lines: difficult access 0.5 h, stacked/built-in access 0.35 h, additional tech 0.5 h, additional component 0.5 h.
3. Rate table per department; optional brand factor (brand × family → multiplier, default 1.0).
4. Labor taxable flag from the **unit's install type** (built-in / freestanding) + family default, not from brand.
5. Learned times from field tool arrive/complete taps → actual vs allowed per task per tech.
6. ePASS/NetSuite import sheet generated from the catalog on demand.

## Draft CSV columns

`family_code, family, task, base_hours, hourly_rate, price, labor_taxable_default, tax_mixed_by_brand, hours_vary_by_brand, brand_count, epass_code_stems, flags`

`tax_mixed_by_brand = yes` marks the rows where the flag must come from install type. `hours_vary_by_brand = yes` marks the 46 combinations to eyeball before deciding on a brand factor. Family names with `?` are guesses (ID, OD, DI, VA, JB) — confirm.

## Clean seed files (built 9/11, in `reference/`)

- `catalog_tasks.csv` — **502 rows**: 478 family-specific tasks (task_id like `RE-017`) plus 24 generic tasks moved to a `GEN` family (noise complaint, cabinet/cosmetic repair major/minor, level unit, light bulb, power cord, could-not-reproduce, burnt wire, breaker reset, WiFi card, control/timer replacement, etc.) that the old book repeated in every family. Columns: hours, department, rate, price, labor tax default, family tax rule, tags (pro/standard/hidden/exposed/built-in/rear-service/sealed-system/unit-removal/two-tech), the ePASS code stems it replaces, and a `review_flag` for the rows a human should look at: 46 where hours varied by brand, the unidentified family codes (ID, OD, DI, VA, JB), and the pro/standard pairs that could become one task plus a `pro` tag.
- `catalog_modifiers.csv` — 7 modifiers pulled out of the task list: difficult access 0.5 h, stacked/built-in access 0.35 h, additional technician ×1/×2/×3 (0.5/0.75/1.0 h), additional component same visit 0.5 h, refrigerant recovery 0.5 h.
- `catalog_rates.csv` — appliance 130, HVAC 150, in-shop 130, diagnostic fee 169.95.
- `catalog_family_tax.csv` — per family: `Y` (labor always taxed: WA, DR), `N` (never: DW, VH, IM, CF, SO, WD, CO, AC), or `by_install_type` (RE, CE, CG, MW, GR — the ones the old book split by brand). The engine reads the unit's `install_type` first and falls back to this.

Igniter/ignitor spelling unified; gasket and sealed-system wording variants collapsed. Whitespace duplicates were already merged in the draft. Generating the ePASS import from these files: for each task × brand emit `<stem>-<BRAND>`, description, hours × rate, tax flag per §5.2 of the spec — the shape ePASS imports today.
