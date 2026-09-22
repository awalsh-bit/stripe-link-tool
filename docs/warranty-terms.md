# Wilson warranty terms — reference data

Snapshot 2026-09-22, from Jack's Warranty Terms tool (`docs/wilson-warranty-terms-reference.html`). The same data drives **Client Care → Warranty Terms Reference** in Agility (`warranty-terms.html`), served from `data/warranty-terms.json` by `lib/warranty-terms.js`; edit the JSON to change the terms, the page and this file are derived from it. Internal reference — not for customer distribution.

## How to read it

One row per **coverage tier**. A brand usually has a standard parts-and-labor tier plus longer, narrower tiers (sealed system, compressor, magnetron, tub…) that may be parts-only. Coverage runs from the purchase (or install) date: `ends = purchase date + months`. `Applies to` limits a tier to product types (blank = every product of the brand). `Registration` means the tier only applies if the unit was registered within that window. **Confidence** `verified` = checked against the manufacturer's published terms (source link); `estimate` = to confirm before relying on it. **Model / family exceptions** replace the brand's standard tiers for matching models (`*` = any characters). **Pre-auth** brands need the manufacturer's authorization before Wilson starts warranty work. **Installer bonus**: Wilson is a Sub-Zero/Wolf/Cove Factory Certified Installer — units Wilson sold and installed before 2026-05-01 may carry an extra year (registration-dependent, not automatic).

Lookup rule for a WTY ticket (what `GET /api/warranty-terms/lookup?brand=&model=&purchased=&product=` does): match the brand (case- and punctuation-insensitive: `SUBZERO` = `Sub-Zero`, `Fisher and Paykel` = `Fisher & Paykel`), then a model/family exception for that brand (exact model first, then pattern), else the brand's tiers; drop tiers whose `Applies to` doesn't include the product type; a tier is in force when `purchase date + months >= today`; note pre-auth and the installer bonus.

## Summary

52 brands, 155 tiers, 7 model/family exceptions, 41 verified, 11 estimates, 8 pre-auth brands.

## Brands

| Brand | Categories | Confidence | Pre-auth | Installer bonus | Unit lookup | Source | Notes |
|---|---|---|---|---|---|---|---|
| AGA (only if we sold the unit) | kitchen | verified | yes |  |  | https://www.agarangeusa.com/resources/product-warranty-registration | Verified from AGA's product registration page — coverage differs by range line: Classic Cast Iron is 1yr full + 4 more years parts-only; Elise and Mercury are 2yr full. Wilson only services AGA units it sold directly — confirm eligibility before quoting a warranty status. |
| Alfresco | outdoor, refrigeration | verified |  |  |  | https://alfrescogrills.com/customer-care/warranty-services/ | Verified from Alfresco's published warranty page: grills get 2yr full, then 5yr parts-only on trays/grates/drip pans, then lifetime parts-only on stainless burners and body. Alfresco also makes outdoor refrigerators (1yr full + 5yr parts-only structural stainless + 1yr sealed system, all shorter than the grill terms). Alfresco's separate Artisan grill line runs longer (15yr burners, 10yr stainless, 3yr trays, 1yr full) — not modeled here, check the specific line if it says Artisan. |
| Amana | kitchen, refrigeration | verified |  |  |  | https://www.amana.com/content/dam/global/documents/201803/warranty-page-w11105281-w.pdf | Verified from Amana's published Major Appliance Limited Warranty (Jack has the current PDF on file, W11105281A): a single 1yr full (parts & labor) tier — no longer component-specific coverage found in the current published warranty, unlike sibling Whirlpool-family brands. Wilson does not work on Amana HVAC. |
| American Standard | hvac | estimate |  |  |  |  | HVAC estimate modeled on the verified Trane pattern (same parent company, Trane Technologies) — confirm current American Standard terms and registration window. OPERATIONAL: Wilson is not an American Standard dealer and cannot perform warranty repairs for this brand — explain that to the customer and refer them to American Standard directly. |
| ASKO | kitchen | verified | yes |  |  | https://us.asko.com/customer-care-support/warranty | Verified from ASKO's published US warranty page: 2yr full standard for residential use. ASKO is currently (2025-2026) running a dishwasher promotion extending to 5yr full if registered within 90 days of purchase at us.asko.com — confirm the promo is still live before quoting it. |
| Best | ventilation | verified |  |  |  | https://bestrangehoods.com/warranty | Verified from Best's (Broan-NuTone) published warranty page: parts are covered for 5yr from purchase; labor is covered for 2yr from the date of any given service visit. Modeled here as a straightforward 2yr full / 5yr parts-only pair — check the source for the exact labor-window wording on an older unit. |
| BlueStar | kitchen | verified |  |  |  | https://www.bluestarcooking.com/wp-content/uploads/2016/02/BlueStar-Warranty-4.1.19.pdf | Verified from BlueStar's published warranty PDF: 2yr full if the product is registered within 90 days of install; 1yr full if it isn't registered. Registration also affects which remedies are available, not just length. |
| Bosch | kitchen, refrigeration | verified |  |  |  | https://www.bosch-home.com/us/owner-support/cleaners-accessories/warranty-information | Verified from Bosch's published US warranty page: 1yr full across the line; dishwashers get 5yr parts-only on electronics and racks; built-in refrigerators get parts-only coverage on the whole unit through year 2 and electronics through year 5. |
| Broan | ventilation | verified |  |  |  | https://broan-nutone.com/en-us/home/customer-service/warranty | Verified from Broan-NuTone's published warranty page: 1yr limited warranty on range hoods. |
| Café | kitchen, refrigeration | estimate |  |  |  | https://www.consumeraffairs.com/homeowners/ge-appliance-warranty.html | Sourced from a third-party GE-appliance-warranty summary (consumeraffairs.com), not GE's own warranty page directly — still flagged for confirmation. Café is GE's premium line: 1yr full across the line; Café/Profile refrigerator models add a 5yr parts-only warranty on the sealed refrigerating system, and some Profile models may add a lifetime warranty on full-extension slides (not modeled). |
| Carrier | hvac | verified |  |  |  | https://www.carrier.com/us/en/residential/homeowner-resources/warranty/ | Verified from Carrier's published homeowner warranty page: 5yr base parts warranty with no registration; 10yr parts if registered within 90 days of install (Carrier also offers a 5yr-parts + 3yr-labor alternative under its Consumer Choice program if the installing dealer participates — not modeled here, ask about it directly). OPERATIONAL: Wilson is not a Carrier dealer, but will attempt warranty repairs and submit for parts reimbursement through Insco. |
| Cove | kitchen | verified |  | +1 yr before 2026-05-01 | https://service.subzero.com/Tools/UnitHistory | https://haven.subzero.com/AssetLink/t7v1tx47i2bb7246u6p3d3263d0j7ex0.pdf | Cove is Sub-Zero/Wolf's dishwasher-only brand — corrected from an earlier draft that used generic refrigeration terms. Verified from Cove's published Residential Limited Warranty: 2yr full; control board/diverter valve/pump/racks 5yr parts-only; stainless tub and door liner rust-through is lifetime, parts only. "Lifetime" is modeled here as 100 years so it never shows as expired. |
| Coyote | outdoor | verified |  |  |  | https://coyoteoutdoor.com/warranty | Verified from Coyote Outdoor's published warranty page: this is a parts-only warranty across every component — labor is never covered. Terms vary sharply by component, from 1yr on ignition/valves up to lifetime on stainless burners and frame/housing. |
| DCS Appliances | kitchen, outdoor | verified |  |  |  | https://www.dcsappliances.com/us/help-and-support/warranty-information | Verified from DCS's published warranty page (outdoor product table): 2yr full is the base across grills, carts, storage, refrigeration, warming drawers, side burners and patio heaters; most product lines then add a 5yr parts-only tier on stainless assemblies, and grills specifically add a lifetime parts-only tier on burners/cover/burner box/grates/racks. Fisher & Paykel's premium cooking/outdoor line — indoor cooking/dishwasher terms aren't covered by this source, treated as the 2yr full default until confirmed. |
| Faber | ventilation | verified |  |  |  | https://faberonline.com/pages/product-warranty | Verified from Faber's (Franke) published warranty page: 2yr full on range hoods for standard residential indoor use. |
| Fisher & Paykel | refrigeration, kitchen | verified |  |  |  | https://www.fisherpaykel.com/us/help-and-support/warranty-information/#LimitedWarranty | Verified from Fisher & Paykel's published US warranty page: 2yr full across the whole line; refrigeration product specifically gets an additional 3yr (5yr total) full parts & labor on the sealed system (compressor, evaporator, condenser, filter dryer, connecting tubing) — no separate parts-only tail beyond that per this source. |
| Fulgor Milano | kitchen, refrigeration, ventilation | verified |  |  |  | https://www.fulgor-milano.com/sites/default/files/2021-01/Fulgor%20Milano%20Comprehensive%20Warranty%20Statement%202021-rev20210125.pdf | Verified from Fulgor Milano's published Comprehensive Warranty Statement (warranty-class table): most cooking, the 600-series dishwasher, and ventilation are 2yr full; microwaves and the 400-series dishwasher are 1yr full. Refrigeration is 2yr full across the board, with the 700 series adding 5yr full + 12yr parts-only on the sealed system (600 series gets a shorter parts-only sealed-system add-on, 400 series gets none — not separately modeled, check the series if it matters). |
| Gaggenau | refrigeration, kitchen | verified |  |  |  | https://media3.gaggenau.com/Documents/18216668_Gaggenau_US_Warranty.pdf | Verified from Gaggenau's published US warranty PDF: a single 5yr full (parts & labor) warranty applies across the line — Gaggenau doesn't split cooking vs. refrigeration terms the way some siblings do. There's also a 60-day cosmetic-defect warranty (scratches, finish, etc.) not modeled as a separate tier here. |
| GE | kitchen, refrigeration | estimate |  |  |  | https://www.consumeraffairs.com/homeowners/ge-appliance-warranty.html | Sourced from a third-party GE-appliance-warranty summary (consumeraffairs.com), not GE's own warranty page directly — still flagged for confirmation. 1yr full across washers/dryers/refrigerators/dishwashers/microwaves/ranges/ovens; refrigerator sealed system adds up to 5yr parts-only; Wi-Fi-enabled ranges/ovens may add ~90 days on connectivity components (not modeled). |
| GE Profile | kitchen, refrigeration | estimate |  |  |  | https://www.consumeraffairs.com/homeowners/ge-appliance-warranty.html | Sourced from a third-party GE-appliance-warranty summary (consumeraffairs.com), not GE's own warranty page directly — still flagged for confirmation. Same base structure as GE: 1yr full, refrigerator sealed system adds up to 5yr parts-only. GE Profile occasionally runs promotions with longer terms and some Profile models add a lifetime warranty on full-extension slides — confirm by model/purchase date. |
| Haier | kitchen, refrigeration | estimate |  |  |  | https://images.thdstatic.com/catalog/pdfImages/d8/d8d08a60-a039-4118-9b73-291bbc327617.pdf | Source is a Home Depot-hosted Haier warranty card stating a flat 1yr parts & labor warranty with no further detail on component extensions — worth cross-checking against Haier's own site for the specific model/category before relying on it. |
| Janitrol / Goodman | hvac | verified |  |  |  | https://www.goodmanmfg.com/resources/hvac-learning-center/warranty/the-air-conditioner-limited-warranty---the-why-when-how | Verified from Goodman's published warranty page: 5yr base parts; 10yr parts if registered within 60 days (lasts as long as the original registered owner/spouse owns and lives in the home). Select higher-efficiency models add a lifetime compressor warranty to the original registered owner — modeled here as 100 years; confirm the specific model qualifies before relying on this tier. OPERATIONAL: Wilson is not a Janitrol/Goodman dealer and cannot perform warranty repairs for this brand — explain that to the customer. |
| JennAir | kitchen, refrigeration | verified |  |  |  | https://www.jennair.com/content/dam/global/documents/201710/WarrantyPage-W11170798A-W.pdf | Verified from two JennAir warranty PDFs (cooking and refrigeration): 2yr full across the line. Cooking gets a 3rd-5th year parts-only tier on named components. Refrigeration gets the cavity liner + sealed system covered full (parts & labor) through year 5, then sealed-system parts-only through year 10. |
| Kalamazoo Outdoor Gourmet | outdoor | verified |  |  |  | https://kalamazoogourmet.com/pages/warranty-information | Verified from Kalamazoo's published warranty page: 2yr full on grills, pizza ovens and cooktops; 5yr parts-only on burners/valves/manifolds/control boards; 25yr parts-only on the Dragon Burners, cooking grates and fabricated stainless structure. |
| Kenmore | kitchen, refrigeration | estimate |  |  |  |  | OPERATIONAL: Wilson does not work on Kenmore under warranty — this is a hard stop regardless of term, explain that to the customer before quoting anything. Term estimate left as-is only for reference; Kenmore units are manufactured by various OEMs (Whirlpool, LG, etc.), so actual coverage would depend on who made the specific unit even if Wilson did take the work. |
| KitchenAid | refrigeration, kitchen | verified |  |  |  | https://www.kitchenaid.com/content/dam/global/documents/201606/warranty-W10790750-W.pdf | Verified against KitchenAid's current Major Appliance Limited Warranty PDF (Jack has W11655295A on file): 1yr full across the line; commercial-style ranges, built-in refrigerators and built-in icemakers get a 2nd year fully covered (parts & labor, whole unit); the sealed refrigeration system (compressor, evaporator, condenser, dryer, connecting tubing) on refrigerators and built-in icemakers is covered full parts & labor through year 5 — this specific document doesn't show a further parts-only tail past year 5, unlike an older revision previously on file, so the old 10yr parts-only tier was dropped. Built-in refrigeration model numbers typically start with "KB", icemakers with "KUI". |
| La Cornue | kitchen | estimate | yes |  |  | https://www.lacornueappliance.support/guides/la-cornue-warranty-5-year-explained/ | Sourced from a third-party La Cornue support/reseller site describing a 5yr full parts & labor warranty — broader than most range warranties. Not La Cornue's own published page, so still flagged for confirmation; French import, high-end range specialist, confirm exact terms and US service network for the specific model. |
| LG | refrigeration, kitchen | verified |  |  |  | https://www.lg.com/us/support/warranty-information | Verified from LG's published US warranty-information page: 1yr full across every category. Refrigeration adds a 5yr full sealed-system and compressor tier (compressor parts-only through year 10). Laundry adds a 3yr parts-only stainless tub (washer) and a notable 10yr parts-only direct-drive motor (washer & dryer). Dishwashers add 2yr parts-only on control board/racks/liner/tub and 10yr parts-only on the direct-drive motor. Microwaves add 10yr parts-only on the magnetron. LG Studio WashTowers get a 2yr full standard warranty instead of 1yr — not modeled as a separate LG Studio-only tier here since it's brand-specific, see the LG Studio entry. |
| LG Studio | kitchen, refrigeration | estimate |  |  |  | https://www.lgproductguide.ca/resources/warranties | Sourced from LG's Canadian product-guide page (lgproductguide.ca), not the US warranty page — still flagged for confirmation on the US side. States 2yr parts & labor for LG Studio, LG's premium built-in line. |
| Liebherr | refrigeration | verified | yes |  |  | https://www.liebherr.com/en-us/refrigerators-freezers/guarantee-7150900 | German refrigeration specialist — estimate; confirm against current published US warranty. |
| Marvel | refrigeration | verified | yes |  |  | https://www.marvelrefrigeration.com/pub/media/marvel/warranty_compliance/MARVEL-WARRANTY.PDF | Verified from Marvel's published warranty PDF: 1yr full on standard residential Marvel; Marvel Professional products get 2yr full instead, plus an optional registered 3rd year (register within 60 days at marvelrefrigeration.com) — not modeled as separate tiers since our schema doesn't distinguish Marvel's product lines, check which line this is. Sealed system (compressor, condenser, evaporator, drier, connecting tubing) is 5yr parts-only, labor not included, across all Marvel lines. |
| Maytag | kitchen, refrigeration | verified |  |  |  | https://www.maytag.com/services/limited-10-year-warranty.html | Verified from Maytag's published 10-Year Limited Warranty page: 1yr full across the line, plus a 10yr parts-only tier on named components by category (laundry: drive motor/wash basket/dryer drum; dishwashers: stainless tub/nylon racks/chopper; cooking: burners/elements/ceramic top/cavity; refrigerators: compressor; microwaves: magnetron/cavity). Two bonus tiers exist for specific commercial-grade laundry pairs, not modeled as brand-wide tiers — log any matching model as its own override: MVW6230RH/MED6230RH/MGD6230RH add labor coverage for the first 5yr on top of the 10yr parts; MVWP586GW/MEDP586KW/MGDP586KW add full parts+labor for the first 5yr. NOTE: the model already logged as a 5yr-full override is MVWP575GW, not MVWP586GW named in this source — worth double-checking with Jack whether that's the same commercial-technology pair under an older model number or a different unit before relying on it. |
| Miele | refrigeration, kitchen | verified | yes |  |  | https://www.mieleusa.com/cs/legal/miele-warranties-131 | Verified from Miele USA's published Limited Warranty for Domestic Appliances: 2yr full warranty on major residential appliances; sealed refrigeration system gets 5yr full + an additional 5yr parts-only (10yr total). |
| Mitsubishi | hvac | verified |  |  | https://registermehvac.com/WarrantyLookup_88973.aspx | https://dunckleeinc.com/mitsubishi-warranty/ | Verified: ductless mini-split systems get a 5yr base parts warranty, 7yr on the compressor specifically, extending to 10yr parts if registered within 90 days (single-family residential). Registering through a Diamond Contractor can push this to 12yr — not modeled as a separate tier since it depends on installer status; note it when relevant. |
| Monogram | kitchen, refrigeration | verified |  |  |  | https://products.geappliances.com/appliance/gea-support-search-content?contentId=38462 | Verified from GE Appliances' published Monogram warranty page: 2yr full across the line (refrigerators, wine/beverage/bar units, icemakers, cooking, dishwashers/compactors). Integrated and column refrigerators additionally get the sealed system covered full through year 5, then parts-only through year 12. |
| Perlick | refrigeration | verified |  |  |  | https://cdn.prod.website-files.com/65b96d44a15b3d7627ae6487/67da58496051a4818b4f32d5_Residential%20Warranty%20April%202025.pdf | Verified from Perlick's published Residential Warranty PDF: coverage varies significantly by product line — undercounter refrigeration (2021+) 6yr full; ice makers 2yr full; column refrigeration 3yr full on the cabinet plus a separate 6yr full / 12yr parts-only sealed-system tier; beverage/bar dispensing equipment is 1yr full (not modeled, uncommon for residential intake). Registration at perlick.com is required to validate. |
| Rheem | hvac | estimate |  |  |  |  | HVAC estimate modeled on the verified Trane pattern — confirm current Rheem terms and registration window. OPERATIONAL: Wilson is not a Rheem dealer and cannot perform warranty repairs for this brand — explain that to the customer. |
| Ruud | hvac | estimate |  |  |  |  | Rheem-family HVAC brand — estimate modeled on the verified Trane pattern. Confirm current terms. OPERATIONAL: same as Rheem — Wilson is not a Ruud dealer and cannot perform warranty repairs for this brand; explain that to the customer. |
| Scotsman | refrigeration | verified |  |  | https://www.smartlink.scotsman-ice.com/wssctguestp_sw.html | https://scotsmanhomeice.com/warranty/ | Verified from Scotsman's own published residential warranty page: coverage depends on model family — DRC/SRC/DCE/SCC get 1yr full + an additional 4yr parts-only on the compressor (5yr total); SRN/SCN get 2yr full + an additional 3yr parts-only on the compressor (5yr total). Confirm which model family this unit is before quoting — Scotsman also publishes its own serial-number warranty lookup tool, worth cross-checking (smartlink.scotsman-ice.com). |
| Signature Kitchen Suite | kitchen, refrigeration | verified |  |  |  | https://www.sksappliances.com/en-us/customer-care/ | Verified from Signature Kitchen Suite's published customer-care page: a comprehensive 3yr full (parts & labor) warranty across the line, with a 5-business-day repair commitment. LG's luxury built-in brand. |
| Speed Queen | kitchen | verified |  |  |  | https://speedqueen.com/wp-content/uploads/2020/02/ConsumerWarrantyBond.2.19.20.pdf | Verified from Speed Queen's published Consumer Warranty Bond PDF, which breaks residential coverage out by exact model line: 3000-series (TR3/DR3/FR3) is 3yr full + 5yr parts-only on cabinet rust + 5yr parts-only on the washer motor + lifetime parts-only on the stainless tub/cylinder — modeled here as the brand-level default. 5000-series TC5/DC5 and TR5/DR5, and 7000-series TR7/DR7/FF7/DF7/SF7, all run longer (5-7yr full) and are already logged as separate model families that override this default — log any other Speed Queen model the same way rather than trusting the 3yr fallback for it. |
| Sub-Zero | refrigeration | verified |  | +1 yr before 2026-05-01 | https://service.subzero.com/Tools/UnitHistory | https://haven.subzero.com/AssetLink/a77c3xbbh73i33od17n43r0mo07l0537.pdf | Verified from Sub-Zero's published warranty PDFs (indoor and outdoor): 2yr full coverage; sealed system 5yr full + 12yr limited parts-only. |
| Sunstone Metal Products | outdoor | verified |  |  |  | https://images.webfronts.com/cache/frakafihhshn.pdf | Verified from Sunstone's published warranty PDF: burners (stainless & brass) and cooking grids/housings are covered for the lifetime of the original purchaser (parts only, against burn-through/defects — not surface corrosion or discoloration); side burners and cabinet components (doors, drawers, cocktail station, ice chest) get 3yr; all other grill components (igniters, knobs, valves, tubing, rotisserie motor, light, covers) get 1yr. |
| Thermador | kitchen, refrigeration | verified |  |  |  | https://www.thermador.com/us/support/warranties | Verified from Thermador's published warranty page: 2yr full on all categories; refrigeration sealed system adds parts+labor through year 6 and parts-only through year 12. |
| Trane | hvac | verified |  |  |  | https://www.trane.com/residential/en/resources/warranty-and-registration/ | Verified from Trane's published residential warranty page: 5yr base parts warranty with no registration required; extends to 10yr parts if registered within 60 days of install (10yr overall; some components run to 12yr — confirm by part). Labor is never included by Trane — only through a separately purchased extended plan. OPERATIONAL: Wilson can cover the labor if the customer purchased a JB warranty from us — check for one before telling a customer labor isn't covered. |
| True Manufacturing | refrigeration | verified |  |  |  | https://true-caliber.com/wp-content/uploads/2020/01/2016_True_Residential_Warranty_Updated_12-5-16.pdf | Verified against True's published Residential Warranty PDF: 3yr full across the line; sealed system (compressor, evaporator, condenser, drier, connecting tubing) gets 6yr full parts & labor. True's commercial-grade units can carry different, shorter, or parts-only terms — confirm against the unit's specific warranty card if it looks like a commercial model. |
| U-Line | refrigeration | verified | yes |  |  | https://www.u-line.com/media/u-line/warranty_compliance/30379.PDF | Verified from U-Line's published warranty PDF: 1yr full standard, 2yr full on 5-Class product; either can be extended by 1 more year (register at u-line.com within 60 days of purchase) — modeled here as a combined registered-extension tier up to 3yr total, confirm exactly which base tier applies before relying on the extended figure. Sealed system is 5yr parts-only, labor not included, across all U-Line lines. |
| Viking | kitchen, refrigeration | verified | yes |  |  | https://vikingrange.com/support-and-documentation/warranty | Verified from Viking's published warranty page: 2yr full on all indoor categories; select components (burners, elements, dishwasher parts) parts-only through year 5; refrigeration sealed system 6yr full then parts-only through year 12. Viking also sells outdoor appliances (1yr full, different limited-parts schedule) — not modeled here since Wilson's intake form doesn't distinguish indoor/outdoor Viking units; flag it if one comes up. |
| Whirlpool | kitchen, refrigeration | verified |  |  |  | https://theproperkitchen.com/does-whirlpool-have-10-year-warranty/ | Verified from Whirlpool's published warranty materials: 1yr full warranty across the line; laundry gets a notable 10yr parts-only warranty on the direct-drive motor and stainless drum. Other categories' extended component terms vary by product — the parts-only tier shown for those is an estimate, confirm by model. |
| Wolf | kitchen | verified |  | +1 yr before 2026-05-01 | https://service.subzero.com/Tools/UnitHistory | https://haven.subzero.com/AssetLink/a40gaq4v8seh8o36k5mrh6hmxuuj1m24.pdf | Verified from Sub-Zero/Wolf's published warranty PDFs (indoor and outdoor): 2yr full coverage; 5yr limited parts-only on named components (gas burners, electric elements, blower motors, control boards, magnetron tubes, induction generators). |
| York | hvac | estimate |  |  |  |  | HVAC estimate modeled on the verified Trane pattern — confirm current York terms and registration window. OPERATIONAL: Wilson is not a York dealer and cannot perform warranty repairs for this brand — explain that to the customer. |
| Zephyr | ventilation, refrigeration, kitchen | verified |  |  |  | https://s1.img-b.com/build.com/mediabase/specifications/zephyr/1846321/zephyr-zsl-e42c-warranty.pdf | Verified from several of Zephyr's own published product manuals: Zephyr is not ventilation-only — it also sells refrigeration (Brisas/Preserv lines), icemakers, cooktops and microwave drawers, so it's now filed under Ventilation, Refrigeration & Ice, and Cooking/Dishwashers/Laundry. Ventilation hoods get 1yr full + 3yr parts-only. Refrigeration gets 2yr full + 5yr parts-only compressor. Icemakers get 1yr full. Cooktops get 2yr full + 3yr parts-only. Microwave drawers get 1yr full + 5yr parts-only magnetron. Each line has its own manual — the primary hood warranty PDF is linked here, ask Jack for the others (Brisas/Preserv/icemaker/cooktop/microwave manuals) if a non-hood Zephyr product comes up. |

## Coverage tiers (one row per tier)

| Brand | Coverage | Months | Length | Parts only | Applies to | Registration required | Registration window (days) |
|---|---|---:|---|---|---|---|---:|
| AGA (only if we sold the unit) | AGA Classic Cast Iron — standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| AGA (only if we sold the unit) | AGA Classic Cast Iron — extended component coverage (parts only) | 60 | 5 yr | yes |  |  |  |
| AGA (only if we sold the unit) | AGA Elise (parts & labor) | 24 | 2 yr |  |  |  |  |
| AGA (only if we sold the unit) | AGA Mercury (parts & labor, excl. cosmetic) | 24 | 2 yr |  |  |  |  |
| Alfresco | Standard warranty — grills & grill components (parts & labor) | 24 | 2 yr |  | Range, Cooktop, Other |  |  |
| Alfresco | Structural stainless — briquette trays, grill grates, drip pans (parts only) | 60 | 5 yr | yes | Range, Cooktop, Other |  |  |
| Alfresco | Stainless grill burners & body (parts only, lifetime) | 1200 | lifetime | yes | Range, Cooktop, Other |  |  |
| Alfresco | Standard warranty — outdoor refrigerators (parts & labor) | 12 | 1 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Alfresco | Structural stainless — outdoor refrigerators (parts only) | 60 | 5 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Amana | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| American Standard | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| American Standard | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 60 |
| ASKO | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| ASKO | Promotional extended warranty — dishwashers registered under the 2025-2026 warranty promotion (parts & labor) | 60 | 5 yr |  | Dishwasher | yes | 90 |
| Best | Standard warranty (parts & labor) | 24 | 2 yr |  | Ventilation |  |  |
| Best | Extended parts coverage (parts only) | 60 | 5 yr | yes | Ventilation |  |  |
| BlueStar | Standard warranty, registered within 90 days of install (parts & labor) | 24 | 2 yr |  |  | yes | 90 |
| BlueStar | Standard warranty, not registered (parts & labor) | 12 | 1 yr |  |  |  |  |
| Bosch | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Bosch | Electronics — microprocessor/circuit board (parts only) | 60 | 5 yr | yes | Dishwasher |  |  |
| Bosch | Racks (parts only) | 60 | 5 yr | yes | Dishwasher |  |  |
| Bosch | Built-in refrigerator, entire appliance year 2 (parts only) | 24 | 2 yr | yes | Refrigerator (Built-in) |  |  |
| Bosch | Built-in refrigerator electronics (parts only) | 60 | 5 yr | yes | Refrigerator (Built-in) |  |  |
| Broan | Standard warranty — range hoods (parts & labor) | 12 | 1 yr |  | Ventilation |  |  |
| Café | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Café | Refrigerating system (parts only) | 60 | 5 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Carrier | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| Carrier | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 90 |
| Cove | Standard warranty (parts & labor) | 24 | 2 yr |  | Dishwasher |  |  |
| Cove | Control board, diverter valve, pump, racks (parts only) | 60 | 5 yr | yes | Dishwasher |  |  |
| Cove | Stainless tub and door liner — rust-through (parts only, lifetime) | 1200 | lifetime | yes | Dishwasher |  |  |
| Coyote | Ignition systems / valves (parts only, no labor) | 12 | 1 yr | yes | Range, Cooktop, Other |  |  |
| Coyote | Electric / plastic components (parts only, no labor) | 24 | 2 yr | yes | Range, Cooktop, Other |  |  |
| Coyote | Heat control grid (parts only, no labor) | 24 | 2 yr | yes | Range, Cooktop, Other |  |  |
| Coyote | Cooking grids (parts only, no labor) | 60 | 5 yr | yes | Range, Cooktop, Other |  |  |
| Coyote | Stainless steel burners & frame/housing (parts only, no labor, lifetime) | 1200 | lifetime | yes | Range, Cooktop, Other |  |  |
| DCS Appliances | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| DCS Appliances | Stainless steel components — grills, carts, storage, warming drawers, side burners, patio heaters (parts only) | 60 | 5 yr | yes | Range, Cooktop, Other |  |  |
| DCS Appliances | Stainless burners, cover, burner box, grates, racks — grills (parts only, lifetime) | 1200 | lifetime | yes | Range, Cooktop, Other |  |  |
| DCS Appliances | Outdoor refrigeration — sealed system (parts only) | 60 | 5 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Faber | Standard warranty (parts & labor) | 24 | 2 yr |  | Ventilation |  |  |
| Fisher & Paykel | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Fisher & Paykel | Refrigeration sealed system (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Fulgor Milano | Standard warranty — cooking, dishwashers (600 series), ventilation (parts & labor) | 24 | 2 yr |  | Range, Cooktop, Dishwasher, Ventilation |  |  |
| Fulgor Milano | Standard warranty — microwaves, dishwashers (400 series) (parts & labor) | 12 | 1 yr |  | Microwave, Dishwasher |  |  |
| Fulgor Milano | Refrigeration standard warranty (parts & labor) | 24 | 2 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Fulgor Milano | Refrigeration sealed system, 700 series (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Fulgor Milano | Refrigeration sealed system, 700 series, years 6-12 (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Gaggenau | Standard warranty (parts & labor) | 60 | 5 yr |  |  |  |  |
| GE | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| GE | Refrigerating system (parts only) | 60 | 5 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| GE Profile | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| GE Profile | Refrigerating system (parts only) | 60 | 5 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Haier | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Janitrol / Goodman | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| Janitrol / Goodman | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 60 |
| Janitrol / Goodman | Compressor, select high-efficiency models only (parts only, lifetime to original registered owner) | 1200 | lifetime | yes | HVAC | yes | 60 |
| JennAir | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| JennAir | Named cooking components — element, touchpad/microprocessor, glass ceramic cooktop (thermal breakage), electronic controls, magnetron, sealed gas burners (parts only) | 60 | 5 yr | yes | Range, Cooktop, Microwave |  |  |
| JennAir | Refrigerator/freezer cavity liner crack & sealed refrigeration system (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| JennAir | Sealed refrigeration system, years 6-10 (parts only) | 120 | 10 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Kalamazoo Outdoor Gourmet | Standard warranty (parts & labor) | 24 | 2 yr |  | Range, Cooktop, Other |  |  |
| Kalamazoo Outdoor Gourmet | Burners, valves, manifold pipes, electronic control boards (parts only) | 60 | 5 yr | yes | Range, Cooktop, Other |  |  |
| Kalamazoo Outdoor Gourmet | Dragon Burners, cooking grates, fabricated stainless structure (parts only) | 300 | 25 yr | yes | Range, Cooktop, Other |  |  |
| Kenmore | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Kenmore | Extended component coverage — sealed system, control board, or drive component (parts only) | 84 | 7 yr | yes |  |  |  |
| KitchenAid | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| KitchenAid | Commercial-style range, built-in refrigerator, built-in icemaker — year 2 (parts & labor) | 24 | 2 yr |  | Range, Refrigerator (Built-in), Icemaker |  |  |
| KitchenAid | Sealed refrigeration system — refrigerator, built-in icemaker, specialty/undercounter refrigerator, years 2-5 (parts & labor) | 60 | 5 yr |  | Refrigerator (Built-in), Refrigerator (Free Standing), Icemaker |  |  |
| La Cornue | Standard warranty (parts & labor) | 60 | 5 yr |  |  |  |  |
| LG | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| LG | Refrigeration sealed system — condenser, dryer, tube, evaporator (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| LG | Refrigeration linear/inverter compressor (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| LG | Refrigeration linear/inverter compressor, years 6-10 (parts only) | 120 | 10 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| LG | Laundry — stainless steel washer tub (parts only) | 36 | 3 yr | yes | Washer |  |  |
| LG | Laundry — direct drive motor, washer & dryer (parts only) | 120 | 10 yr | yes | Washer, Dryer |  |  |
| LG | Dishwasher — main control board, racks, stainless door liner, tub (parts only) | 24 | 2 yr | yes | Dishwasher |  |  |
| LG | Dishwasher — direct drive motor (parts only) | 120 | 10 yr | yes | Dishwasher |  |  |
| LG | Microwave — magnetron (parts only) | 120 | 10 yr | yes | Microwave |  |  |
| LG Studio | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Liebherr | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Liebherr | Sealed system (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Liebherr | Sealed system (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Marvel | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Marvel | Sealed system — compressor, condenser, evaporator, drier, connecting tubing (parts only) | 60 | 5 yr | yes |  |  |  |
| Maytag | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Maytag | Drive motor, wash basket, dryer drum — laundry (parts only) | 120 | 10 yr | yes | Washer, Dryer |  |  |
| Maytag | Stainless tub, nylon racks, chopper — dishwashers (parts only) | 120 | 10 yr | yes | Dishwasher |  |  |
| Maytag | Cooktop burners/elements, ceramic top & grates, bake/broil elements, cavity — cooking (parts only) | 120 | 10 yr | yes | Range, Cooktop |  |  |
| Maytag | Compressor — refrigerators (parts only) | 120 | 10 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in) |  |  |
| Maytag | Magnetron, cavity — microwaves (parts only) | 120 | 10 yr | yes | Microwave |  |  |
| Miele | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Miele | Sealed refrigeration system (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Miele | Sealed refrigeration system (parts only) | 120 | 10 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Mitsubishi | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| Mitsubishi | Compressor (parts only, no labor) | 84 | 7 yr | yes | HVAC |  |  |
| Mitsubishi | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 90 |
| Monogram | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Monogram | Sealed refrigeration system, integrated/column units (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Monogram | Sealed refrigeration system, integrated/column units, years 6-12 (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Perlick | Standard warranty — undercounter refrigeration, produced 1/4/21 or later (parts & labor) | 72 | 6 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Perlick | Standard warranty — ice makers (parts & labor) | 24 | 2 yr |  | Icemaker |  |  |
| Perlick | Standard warranty — column refrigeration (parts & labor) | 36 | 3 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Perlick | Sealed system — column refrigeration (parts & labor) | 72 | 6 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Perlick | Sealed system — column refrigeration, years 7-12 (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Rheem | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| Rheem | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 60 |
| Ruud | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| Ruud | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 60 |
| Scotsman | Standard warranty — DRC/SRC/DCE/SCC models (parts & labor) | 12 | 1 yr |  | Icemaker |  |  |
| Scotsman | Compressor — DRC/SRC/DCE/SCC models, years 2-5 (parts only, labor not included) | 60 | 5 yr | yes | Icemaker |  |  |
| Scotsman | Standard warranty — SRN/SCN models (parts & labor) | 24 | 2 yr |  | Icemaker |  |  |
| Scotsman | Compressor — SRN/SCN models, years 3-5 (parts only, labor not included) | 60 | 5 yr | yes | Icemaker |  |  |
| Signature Kitchen Suite | Standard warranty (parts & labor) | 36 | 3 yr |  |  |  |  |
| Speed Queen | Standard warranty — 3000-series TR3/DR3/FR3 (parts & labor) | 36 | 3 yr |  | Washer, Dryer |  |  |
| Speed Queen | Cabinet assembly rust — 3000-series (parts only) | 60 | 5 yr | yes | Washer, Dryer |  |  |
| Speed Queen | Motor — 3000-series washer (parts only) | 60 | 5 yr | yes | Washer |  |  |
| Speed Queen | Stainless tub/basket/cylinder rust or corrosion — 3000-series (parts only, lifetime) | 1200 | lifetime | yes | Washer, Dryer |  |  |
| Sub-Zero | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Sub-Zero | Sealed system (parts & labor) | 60 | 5 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Sub-Zero | Sealed system (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Sunstone Metal Products | Standard warranty — general grill components (parts & labor) | 12 | 1 yr |  | Range, Cooktop, Other |  |  |
| Sunstone Metal Products | Side burners, doors, drawers, cocktail station, ice chest (parts & labor) | 36 | 3 yr |  | Range, Cooktop, Other |  |  |
| Sunstone Metal Products | Stainless burners & brass burners, cooking grids, stainless housings (parts only, lifetime) | 1200 | lifetime | yes | Range, Cooktop, Other |  |  |
| Thermador | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Thermador | Refrigeration sealed system (parts & labor) | 72 | 6 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Thermador | Refrigeration sealed system (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Trane | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| Trane | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 60 |
| True Manufacturing | Standard warranty (parts & labor) | 36 | 3 yr |  |  |  |  |
| True Manufacturing | Sealed system (parts & labor) | 72 | 6 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| U-Line | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| U-Line | Standard warranty — 5-Class product (parts & labor) | 24 | 2 yr |  |  |  |  |
| U-Line | Registered extension, up to 2 more years with on-time registration (parts & labor) | 36 | 3 yr |  |  | yes | 60 |
| U-Line | Sealed system — compressor, condenser, evaporator, drier, connecting tubing (parts only) | 60 | 5 yr | yes |  |  |  |
| Viking | Standard warranty — indoor cooking/ventilation/refrigeration/dishwashing (parts & labor) | 24 | 2 yr |  |  |  |  |
| Viking | Select components — burners, elements, dishwasher parts (parts only, through year 5) | 60 | 5 yr | yes |  |  |  |
| Viking | Refrigeration sealed system (parts & labor) | 72 | 6 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Viking | Refrigeration sealed system, years 7-12 (parts only) | 144 | 12 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Whirlpool | Standard warranty (parts & labor) | 12 | 1 yr |  |  |  |  |
| Whirlpool | Select components — e.g. washer/dryer direct-drive motor, stainless drum (parts only) | 120 | 10 yr | yes | Washer, Dryer |  |  |
| Whirlpool | Extended component coverage on other categories, incl. refrigeration sealed system (parts only, varies by product) | 84 | 7 yr | yes |  |  |  |
| Wolf | Standard warranty (parts & labor) | 24 | 2 yr |  |  |  |  |
| Wolf | Select components — burners, elements, blower motors, control boards (parts only) | 60 | 5 yr | yes |  |  |  |
| York | Base warranty (parts only, no labor) | 60 | 5 yr | yes | HVAC |  |  |
| York | Registered extended warranty (parts only, no labor) | 120 | 10 yr | yes | HVAC | yes | 60 |
| Zephyr | Standard warranty — range hoods (parts & labor) | 12 | 1 yr |  | Ventilation |  |  |
| Zephyr | Extended parts coverage — range hoods (parts only) | 36 | 3 yr | yes | Ventilation |  |  |
| Zephyr | Standard warranty — Brisas/Preserv refrigeration (parts & labor) | 24 | 2 yr |  | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Zephyr | Compressor — Brisas/Preserv refrigeration (parts only) | 60 | 5 yr | yes | Refrigerator (Free Standing), Refrigerator (Built-in), Icemaker |  |  |
| Zephyr | Standard warranty — icemakers (parts & labor) | 12 | 1 yr |  | Icemaker |  |  |
| Zephyr | Standard warranty — cooktops (parts & labor) | 24 | 2 yr |  | Cooktop |  |  |
| Zephyr | Extended parts coverage — cooktops (parts only) | 36 | 3 yr | yes | Cooktop |  |  |
| Zephyr | Standard warranty — microwave drawers (parts & labor) | 12 | 1 yr |  | Microwave |  |  |
| Zephyr | Magnetron — microwave drawers (parts only) | 60 | 5 yr | yes | Microwave |  |  |

## Model and family exceptions

| Brand | Kind | Model | Pattern | Label | Coverage | Months | Parts only | Verified | Source | Notes |
|---|---|---|---|---|---|---:|---|---|---|---|
| Maytag | single | MVWP575GW |  |  | Standard warranty (parts & labor) | 60 |  | 2026-09-15 · Jack | https://www.maytag.com/content/dam/global/documents/201809/warranty-w11123642-revC.pdf | Confirmed by Jack: this model specifically carries a 5-year full (parts & labor) warranty. This matches Maytag's verified laundry-line warranty tier, logged here as a named example so it's never second-guessed against a shorter default. |
| Speed Queen | family |  | DR5***** | DR5 Series | Standard warranty (parts & labor) | 60 |  | 2026-09-15 · Wilson team |  | DR5 series comes with 5 year warranty. |
| Speed Queen | family |  | TR7***** | TR7 Series | Standard warranty (parts & labor) | 84 |  | 2026-09-15 · Wilson team |  | TR7 and DR7 models come with a default 7 year parts and labor warranty |
| Speed Queen | family |  | DR7***** | DR7 Series | Standard warranty (parts & labor) | 84 |  | 2026-09-15 · Wilson team |  |  |
| Speed Queen | family |  | DC5*W* | DC5 series dryers (companion to TC5 washers) | Standard warranty (parts & labor) | 60 |  | 2026-09-15 · Wilson team |  | Confirmed by Jack: the companion DC5 dryer series carries the same 5-year full parts & labor warranty as the TC5 washers. Pattern assumes the same "WN" suffix convention as TC5 — adjust the pattern here if an actual DC5 model number doesn't match. |
| Speed Queen | family |  | TR5***** | TR5 Series | Standard warranty (parts & labor) | 60 |  | 2026-09-15 · Wilson team |  | TR5s and DR5s all come with a 5 year warranty |
| Speed Queen | family |  | TC5*WN | TC5 series washers (TC5000WN–TC5004WN) | Standard warranty (parts & labor) | 60 |  | 2026-09-15 · Jack |  | Confirmed by Jack: the entire TC5 washer line (TC5000WN through the current TC5004WN) carries a 5-year full parts & labor warranty — supersedes the conservative brand-level entry-tier estimate for any model matching this pattern. |

## Pre-authorization rules

| Brand | Rule |
|---|---|
| AGA (only if we sold the unit) | AGA is a Composition Brands product — requires manufacturer pre-authorization before Wilson can begin warranty work. Contact Composition Brands for authorization first, then schedule service. |
| ASKO | ASKO requires manufacturer pre-authorization before Wilson can begin warranty work — contact ASKO for authorization first, then schedule service. |
| La Cornue | La Cornue is a Composition Brands product — requires manufacturer pre-authorization before Wilson can begin warranty work. Contact Composition Brands for authorization first, then schedule service. |
| Liebherr | Liebherr requires manufacturer pre-authorization before Wilson can begin warranty work — contact Liebherr for authorization first, then schedule service. |
| Marvel | Marvel is a Composition Brands product — requires manufacturer pre-authorization before Wilson can begin warranty work. Contact Composition Brands for authorization first, then schedule service. |
| Miele | Miele requires manufacturer pre-authorization before Wilson can begin warranty work — contact Miele for authorization first, then schedule service. |
| U-Line | U-Line is a Composition Brands product — requires manufacturer pre-authorization before Wilson can begin warranty work. Contact Composition Brands for authorization first, then schedule service. |
| Viking | Viking is a Composition Brands product — requires manufacturer pre-authorization before Wilson can begin warranty work. Contact Composition Brands for authorization first, then schedule service. |

## Installer bonus

| Brand | Extra | Sold & installed before | Requires Wilson install | Note |
|---|---|---|---|---|
| Cove | +1 yr | 2026-05-01 | yes | Wilson is a Sub-Zero/Wolf/Cove Factory Certified Installer. Units Wilson sold AND installed before May 2026 may qualify for an extra year added to the standard warranty through that program (registration-dependent, not automatic) — confirm the unit was registered under the program before relying on this. |
| Sub-Zero | +1 yr | 2026-05-01 | yes | Wilson is a Sub-Zero/Wolf/Cove Factory Certified Installer. Units Wilson sold AND installed before May 2026 may qualify for an extra year added to the standard warranty through that program (registration-dependent, not automatic) — confirm the unit was registered under the program before relying on this. |
| Wolf | +1 yr | 2026-05-01 | yes | Wilson is a Sub-Zero/Wolf/Cove Factory Certified Installer. Units Wilson sold AND installed before May 2026 may qualify for an extra year added to the standard warranty through that program (registration-dependent, not automatic) — confirm the unit was registered under the program before relying on this. |

## JSON shape (`data/warranty-terms.json`)

```
{ "meta": { "snapshotDate", "source", "notes" },
  "brands": [ { "id", "brand", "categories": [..], "confidence": "verified|estimate",
                "tiers": [ { "label", "months", "partsOnly", "appliesTo": [..]|null, "requiresRegistration", "registrationWindowDays" } ],
                "preAuth": { "note" }|null, "installerBonus": { "months", "beforeDate", "requiresFromUs", "note" }|null,
                "externalLookupUrl", "sourceUrl", "notes" } ],
  "models": [ { "id", "brand", "kind": "single|family", "model", "pattern", "label", "tiers": [..], "confidence", "verifiedAt", "verifiedBy", "sourceUrl", "notes" } ] }
```
