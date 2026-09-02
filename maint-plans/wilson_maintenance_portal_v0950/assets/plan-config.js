(function () {
  const config = {
    version: "0.6",
    currency: "USD",
    assumptions: {
      imucRecommendedVisits: 2,
      imucGuidance: "Manufacturer guidance generally recommends cleaning and maintenance twice per year.",
      estateAutoSwitchRule: "Automatically select the lowest-cost appropriate starting plan for the exact appliance mix, including recommended second IMUC visits.",
      estatePricingStatus: "Draft base-plus proposal for review",
      paymentTiming: "The card is placed on file at enrollment. Nothing is charged at signup — each maintenance visit carries its own amount and is charged against that visit.",
      renewal: "Plans renew annually until canceled by the customer.",
      /* How long a sent price stands. Config rather than a literal in the
         builder, because it is a commercial decision and Wilson will want to
         change it without anyone opening a screen file. */
      quoteValidDays: 30,
      hvacAnnualVisits: 2,
      hvacVisitTiming: "Spring and fall, weather permitting.",
      serviceOrderTarget: "NetSuite - integration pending",
      applianceScopeExclusions: ["BBQ / grill cleaning", "Disassembly unless separately approved"],
      grillScopeRule: "Outdoor grills are inspected for function and safety only. Wilson does not clean grills on any visit, including unrelated service calls. Condition is rated and reported because it affects the health score, but it is never remediated. This exclusion applies to every plan, Estate Concierge included."
    },
    estatePricing: {
      includedAppliances: 15,
      customReviewStartsAt: 26,
      additionalPerAppliance: {
        estate_annual: 60,
        estate_preferred: 100,
        estate_concierge: 150
      },
      rationale: "The first 15 appliances are covered by the published price. A modest per-appliance adjustment above 15 protects labor on the largest estates without making ordinary larger homes feel custom-priced. Homes with 26 or more appliances receive an internal review."
    },

    /*
     * HOW A PLAN YEAR IS DISTRIBUTED ACROSS ITS VISITS.  (v0.9.26)
     *
     * Two-visit plans used to bill the WHOLE year at the first visit and $0 at
     * the second. Nothing was wrong with the total, but it made "per year" a
     * misleading way to describe it -- a Concierge customer saw "$2,995 / year"
     * and had $2,995 taken in one go before the second visit had happened.
     *
     * Cayden's call: split the year across the visits first, then charging when
     * a visit is scheduled is an ordinary thing to do rather than a large charge
     * for work not yet done.
     *
     * Weights, not amounts, so the same rule holds at every price point. They
     * must sum to 1: the plan year is being divided, not discounted, and that is
     * asserted in the QA suite. Any rounding remainder lands on the first visit
     * so the legs always add back to the annual figure exactly.
     */
    /*
     * THE OFFICE'S THRESHOLDS.  (v0.9.28)
     *
     * Every number that decides whether something lands in the work queue. These
     * were literals scattered through admin.js -- a 14 here, a 30 there -- which
     * meant the operating policy could not be read without reading a screen's
     * source, and two screens could disagree about what "due soon" meant.
     */
    operations: {
      /* How close to its target date a visit must be before its charge is
         offered. Symmetrical: 10 days overdue is as chargeable as 10 days out. */
      chargeWindowDays: 14,
      /* filterDueSoonDays retired in v0.9.49: "filters due" is no longer
         office work — the filter is always replaced at the maintenance
         visit. The office's filter job is VERIFICATION (is the part number
         on file right?), which is a boolean on the record, not a window. */
      /* A quote marked Sent and then silent this long is worth chasing. Not a
         blocker -- the softest item in the queue, and last in it. */
      quoteStaleAfterDays: 7,
      /* How many upcoming intervals to show as context below the queue. */
      upcomingPreviewCount: 8,
      /*
       * How far ahead of a visit an equipment gap becomes today's work.
       *
       * A household enrolled with no brand on anything is a real gap the day it
       * signs up, but chasing it eight months before the first visit is how a
       * queue teaches people to skim. 45 days is enough to find an invoice, key
       * it by hand, or decide the technician will capture it on site.
       */
      equipmentLeadDays: 45
    },

    /*
     * WHEN A VISIT CAN HAPPEN, AND WHAT IT TAKES TO GET IN.  (v0.9.27)
     *
     * This replaces a free-text "Preferred timing" box that customers filled in
     * with things like "March / September". Useful, but not something the office
     * can act on without reading and interpreting it, and it captured none of
     * the facts that actually make a visit fail on arrival: nobody home, a gate
     * with no code, a dog in the yard, the family in Europe for July.
     *
     * DELIBERATELY NOT A CALENDAR. ePass owns the schedule and has no open API,
     * so a date picked here is a date Wilson cannot honour without re-entering
     * it by hand -- and the customer would believe it was booked. A promise the
     * software cannot keep is worse than no promise. These are PREFERENCES and
     * CONSTRAINTS; the office still places the ticket in ePass.
     *
     * DELIBERATELY NO ENTRY CODES. See accessConstraints below.
     */
    schedulingPreference: {
      months: [
        { id: "jan", label: "Jan" }, { id: "feb", label: "Feb" },
        { id: "mar", label: "Mar" }, { id: "apr", label: "Apr" },
        { id: "may", label: "May" }, { id: "jun", label: "Jun" },
        { id: "jul", label: "Jul" }, { id: "aug", label: "Aug" },
        { id: "sep", label: "Sep" }, { id: "oct", label: "Oct" },
        { id: "nov", label: "Nov" }, { id: "dec", label: "Dec" }
      ],
      days: [
        { id: "mon", label: "Mon" }, { id: "tue", label: "Tue" },
        { id: "wed", label: "Wed" }, { id: "thu", label: "Thu" },
        { id: "fri", label: "Fri" }, { id: "sat", label: "Sat" }
      ],
      timesOfDay: [
        { id: "any", label: "Any time" },
        { id: "morning", label: "Mornings" },
        { id: "afternoon", label: "Afternoons" }
      ],
      /*
       * What stands between a technician and the equipment. Flags, not codes.
       *
       * A gate code or alarm code typed into a web form lands in this
       * prototype's browser storage, and would land in a database in
       * production -- and a customer-facing page is the wrong place to collect
       * either. So the customer tells Wilson that a code EXISTS and Wilson
       * collects it by phone before the visit. The office still learns what it
       * needs to plan the trip; nobody's alarm code travels through a form.
       */
      accessConstraints: [
        { id: "occupant_required", label: "Someone needs to be home",
          office: "Confirm a person will be on site" },
        { id: "gate", label: "Gated entry",
          office: "Gate access needed — Wilson to collect the code by phone" },
        { id: "alarm", label: "Alarm system",
          office: "Alarm on site — Wilson to arrange disarming by phone" },
        { id: "dog", label: "Dog on the property",
          office: "Dog on site — confirm containment before arrival" },
        { id: "key_on_file", label: "Wilson holds a key or code already",
          office: "Entry already on file" },
        { id: "notice_required", label: "Needs advance notice",
          office: "Call ahead before dispatching" }
      ],
      /* How far ahead a blackout is worth recording. Beyond this it is a plan,
         not a date, and the customer will have changed it by then. */
      blackoutHorizonDays: 400
    },

    visitChargeSplit: {
      twoVisit: [0.5, 0.5],
      rationale: "A two-visit plan bills half the year at each visit. The customer's cost is "
               + "spread the way the service is, and neither charge is large enough to need "
               + "explaining away."
    },
    appliancePlans: {
      per_appliance: {
        id: "per_appliance",
        name: "Per Appliance",
        shortName: "Per Appliance",
        annualPrice: null,
        visitsPerYear: 1,
        description: "Choose only the individual appliances Wilson will maintain.",
        features: [
          "$149.95 per standard appliance per year",
          "$249.95 per IMUC visit",
          "One standard-appliance visit per year",
          /* Was "Manufacturer-recommended second IMUC visit available". It
             named no manufacturer and cited no source, and it is the one
             default-on charge on the proposal -- a Wilson judgement wearing
             someone else's authority. The hedge in `imucGuidance` above is the
             accurate version, and it is now what the proposal prints. */
          "Second IMUC visit available — manufacturer guidance generally recommends twice a year",
          "Refrigeration and icemaker filter service available per appliance",
          "Disassembly is not included"
        ]
      },
      estate_annual: {
        id: "estate_annual",
        name: "Estate Annual",
        shortName: "Estate Annual",
        annualPrice: 1195,
        visitsPerYear: 1,
        description: "One coordinated whole-home appliance maintenance visit each year.",
        features: [
          "First 15 appliances included in draft pricing",
          "One coordinated visit per year",
          "Optional second IMUC visit",
          "Refrigeration and icemaker filter service available per appliance"
        ]
      },
      estate_preferred: {
        id: "estate_preferred",
        name: "Estate Preferred",
        shortName: "Estate Preferred",
        annualPrice: 1995,
        visitsPerYear: 2,
        description: "Two coordinated whole-home maintenance visits each year.",
        features: [
          "First 15 appliances included in draft pricing",
          "Two visits per year",
          "Twice-yearly IMUC maintenance included",
          "Refrigeration and icemaker filter service available per appliance"
        ]
      },
      estate_concierge: {
        id: "estate_concierge",
        name: "Estate Concierge",
        shortName: "Estate Concierge",
        annualPrice: 2995,
        visitsPerYear: 2,
        description: "Hands-off appliance portfolio management for larger homes.",
        features: [
          "Two visits per year",
          "Cleaning included within plan scope; BBQ / grill cleaning excluded",
          "Priority service",
          "Water and air / food-preservation filters included at no extra charge",
          "Detailed appliance health reports"
        ]
      }
    },
    hvacPlans: {
      hvac_maintenance: {
        id: "hvac_maintenance",
        name: "Wilson AC Maintenance",
        pricePerSystemAnnual: 200,
        visitsPerYear: 2,
        filterManagement: false,
        standardFiltersIncluded: false,
        description: "Two maintenance visits per system each year, planned for spring and fall."
      },
      hvac_filter_management: {
        id: "hvac_filter_management",
        name: "Wilson AC Maintenance + Filters",
        pricePerSystemAnnual: 400,
        visitsPerYear: 2,
        filterManagement: true,
        standardFiltersIncluded: false,
        description: "Two maintenance visits plus filter tracking, sourcing, and replacement coordination. Filter materials are billed separately."
      }
    },
    pricing: {
      standardApplianceAnnual: 149.95,
      imucPerVisit: 249.95,
      imucBaseVisitsPerYear: 1,
      imucRecommendedVisitsPerYear: 2
    },
    /* =====================================================================
       WILSON TEMP WATCH                                          (v0.9.39)
       =====================================================================

       Cayden: "i want to partner with ubibot and build out a temp monitoring
       service for refrigerators... 150 per year per sensor for 24/7 response
       and rapid tech priority dispatch if a flag occurs."

       Sold ALONGSIDE refrigerator maintenance at registration -- the add-on
       card offers it whenever a refrigeration appliance is enrolled -- and
       priced through the same one engine as everything else. The standalone
       (monitoring-without-maintenance) sale exists but is an office workflow,
       not a registration path; see docs/TEMP_MONITORING_UBIBOT_NOTES.md for
       the architecture, the UbiBot API facts, and why the backend listens for
       pushed readings rather than polling (UbiBot's public API allows 1 read
       per channel per MINUTE -- polling hundreds of sensors is impossible,
       data forwarding is not).

       PRICING IS APPROVED as of v0.9.44 (the tiered table below); the flag
       thresholds are researched and sourced (docs/GUARDIAN_THRESHOLDS.md).
       Both remain config, because both are commercial promises as much as
       engineering numbers.
       --------------------------------------------------------------------- */
    tempMonitoring: {
      enabled: true,
      /*
       * THE NAME LIVES HERE AND NOWHERE ELSE.                   (v0.9.40)
       *
       * Cayden: "wilson refrigeration guardian or whatever i end up calling
       * it. open to suggestions on that btw." Working name below; every
       * surface -- the hub, the nav, the registration card, the quote, the
       * report -- reads these two fields, so his final call is a one-line
       * change here.
       */
      serviceName: "Wilson Refrigeration Guardian",
      serviceShortName: "Guardian",
      customerLabel: "Add Refrigeration Guardian — 24/7 temperature monitoring",
      shortLabel: "Guardian monitoring",
      description: "A Wilson wireless sensor lives in this appliance and reports its temperature around the clock. If it drifts out of the safe band, Wilson sees it -- usually before the food does -- and dispatches a technician on priority.",
      /*
       * APPROVED PRICING.                                        (v0.9.44)
       *
       * Cayden: "I'm good with your pricing. I want this to be a high end
       * service, so let's charge that way." Two axes, his framing: the
       * relationship (on a Wilson maintenance plan or not) and the count
       * (the first sensor carries the fixed costs; additional sensors in
       * the same home get the break).
       *
       * Registration always rides a maintenance plan, so the engine prices
       * the member tier. The standalone tier is an office sale -- the hub
       * states it, the office quotes it by hand until that path is built.
       */
      pricingStatus: "Approved pricing — Sep 2026",
      pricing: {
        member:     { firstAnnual: 199, additionalAnnual: 99 },
        standalone: { firstAnnual: 299, additionalAnnual: 149, installFee: 99,
                      installCreditNote: "Install fee credited toward a Wilson maintenance plan started within 90 days." }
      },
      /*
       * COMPARTMENTS.                                            (v0.9.47)
       *
       * Cayden: "We need to make registration for guardian make sense if a
       * customer wants to add multiple sensors for the same fridge... Some
       * will want a sensor in freezer and refrigerator compartments on same
       * unit." So a sensor is a COMPARTMENT WATCHED, not an appliance
       * flag: each enrolled appliance carries tempMonitoringCompartments
       * (an array of the keys below), every entry is one sensor on the
       * household's first/additional price ladder, and each compartment is
       * judged by its own flag rule. sensorsPerAsset survives only as the
       * fallback for a record that predates compartments.
       */
      compartments: {
        fresh_food: { label: "Fresh food compartment", short: "Fresh food" },
        freezer:    { label: "Freezer compartment",    short: "Freezer" },
        wine:       { label: "Wine storage",           short: "Wine" }
      },
      sensorsPerAsset: 1,
      /* Which enrolled appliances the add-on is OFFERED on. */
      eligibleCategories: ["refrigeration"],
      includedPlanIds: [],
      /*
       * FLAG RULES, RESEARCHED.                                  (v0.9.42)
       *
       * Cayden: "im thinking for standard fridge or freezer we are looking
       * for temp falling outside of a set range and failing to recover to
       * set point within a threshold. Like if we are seeing 48 degrees in a
       * fridge that should be 37 and that condition persists for over an
       * hour its probably the start of a no cool situation." His instinct is
       * the industry's: Sub-Zero's own service literature says a box at 48°F
       * set at 38 is past the point a condenser cleaning saves it.
       *
       * So each band carries THREE rules, and the whole basis is written up
       * with sources in docs/GUARDIAN_THRESHOLDS.md:
       *
       *   WARNING   sustained past the food-safety line (FDA cold holding is
       *             41°F; CDC's vaccine band tops at 46°F; a healthy defrost
       *             or door event recovers inside 30-80 min, so 45-60 min of
       *             sustained breach is not a door).      maxF / holdMinutes
       *   DISPATCH  the no-cool signature -- sustained well past the line,
       *             where nothing normal ever lives.      dispatchF / dispatchHoldMinutes
       *   RECOVERY  Cayden's rule directly: breached the warning line and
       *             never re-crossed it within the window. Catches the slow
       *             1°F/hr sealed-system decline that would take half a day
       *             to reach the dispatch line.           recoverWithinMinutes
       *
       * Numbers assume a buffered probe (glycol jar / water bottle on the
       * sensor, the CDC vaccine-storage method) so the sensor reads like the
       * FOOD rather than the air; a bare air probe needs looser numbers --
       * the doc has both columns. Wine gets long windows because its damage
       * clock runs in hours (real risk starts near 70°F), and rate-of-change
       * matters more than the line -- a v2 note, in the doc.
       */
      flagRules: {
        fresh_food: {
          setpointF: 37,
          maxF: 41, holdMinutes: 45,
          dispatchF: 45, dispatchHoldMinutes: 60,
          recoverWithinMinutes: 120,
          label: "Fresh food above 41°F for 45 minutes",
          dispatchLabel: "Fresh food above 45°F for an hour, or not recovering below 41°F within 2 hours"
        },
        freezer: {
          setpointF: 0,
          maxF: 10, holdMinutes: 60,
          dispatchF: 20, dispatchHoldMinutes: 90,
          recoverWithinMinutes: 120,
          label: "Freezer above 10°F for an hour",
          dispatchLabel: "Freezer above 20°F for 90 minutes, or not recovering below 10°F within 2 hours"
        },
        wine: {
          setpointF: 55,
          maxF: 62, holdMinutes: 180,
          dispatchF: 68, dispatchHoldMinutes: 240,
          recoverWithinMinutes: 480,
          label: "Wine storage above 62°F for 3 hours",
          dispatchLabel: "Wine storage above 68°F for 4 hours, or not recovering below 62°F within 8 hours"
        },
        /* Tightened from 4h: a closed unpowered fridge only holds safe temp
           for about 4 hours total (FoodSafety.gov), so the decision has to
           come before hour four -- and a dead sensor is indistinguishable
           from a dead circuit. */
        offline: { holdMinutes: 180, label: "Sensor silent for 3 hours" }
      },
      responseCopy: "Monitored around the clock. A sustained flag opens a priority dispatch: Wilson calls, and a technician is routed the same or next business day.",
      /* The demo's one failing unit -- the Reynolds estate's declining
         Sub-Zero, the same appliance whose four-visit condenser story the
         seeded history already tells. Simulation only; ignored in production. */
      demoFailingModels: ["BI-48S"]
    },

    refrigerationFilterService: {
      enabled: true,
      customerLabel: "Add Wilson Filter Service",
      shortLabel: "Filter service",
      description: "Wilson will track and replace applicable refrigeration water and air filters during scheduled maintenance. Exact filter types and part numbers are verified by Wilson.",
      materialBilling: "Filter materials are priced into the annual plan when filter service is selected, and are included outright on Estate Concierge.",
      includedPlanIds: ["estate_concierge"],

      /*
       * Filter service is now PRICED rather than merely flagged. Selecting it on
       * an individual refrigeration or icemaker asset raises the annual plan
       * price by Wilson's sales price for the filters that asset takes.
       *
       * PLACEHOLDER PRICING. Every unit price below is a stand-in until Wilson's
       * filter sales-price list is loaded. `pricingStatus` is surfaced in the
       * enrollment summary so nobody mistakes these for approved numbers.
       * When the real list arrives, prices should move to the server
       * (MaintenanceFilterPrices) and be keyed by part number rather than kind
       * -- see context section 34 item 11.
       */
      /*
       * PRICED AS AN ESTIMATE, ON PURPOSE (Cayden, v0.9.49): "I really want
       * to keep the registration as is now. Adding more hurdles for the
       * customer to register is counter productive." So the customer is
       * never asked for a model number. The unit price below is Wilson's
       * standard per-filter rate; the office's Filter verification queue
       * confirms the exact part BEFORE the first charge and the price is
       * trued up then if the real filter differs. `estimateNote` is the one
       * sentence that promise lives in — the builder and the quote both
       * print it, so the customer reads the same words twice.
       */
      pricing: {
        pricingStatus: "Placeholder pricing - awaiting Wilson filter sales-price list",
        currency: "USD",
        billingBasis: "annual",
        estimateNote: "Filter pricing is an estimate at our standard per-filter rate. We verify your exact filter type before your first charge and adjust the price if it differs — no model number needed to register.",
        kinds: {
          water: {
            id: "water",
            label: "Water filter service",
            shortLabel: "Water filters",
            unitPrice: 70,
            defaultQuantity: 1,
            description: "Track and replace the appliance's water filter(s) at scheduled maintenance.",
            customerNote: "Priced per water filter at our standard rate. We verify the exact filter type before your first charge and adjust if it differs."
          },
          air: {
            id: "air",
            label: "Air / food-preservation filter service",
            shortLabel: "Air filters",
            unitPrice: 70,
            defaultQuantity: 1,
            description: "Bring and replace the appliance's air / food-preservation filter(s) as well.",
            customerNote: "Optional. Common on Sub-Zero and similar premium refrigeration."
          }
        }
      }
    },
    customerApplianceCategories: [
      /* filterServiceKinds drives which paid filter options the customer is offered.
         Icemakers take a water filter only; refrigeration may also take an
         air / food-preservation filter, which is a separate customer choice. */
      { id: "refrigeration", label: "Refrigeration", shortLabel: "Refrigeration", icon: "refrigeration.svg", group: "standard", checkpointSet: "refrigerator", filterTypes: [], filterServiceAvailable: true, filterServiceKinds: ["water", "air"], help: "Refrigerator, freezer, wine, beverage, column, or undercounter refrigeration" },
      { id: "ice_maker", label: "Icemaker", shortLabel: "Icemaker", icon: "ice_maker.svg", group: "imuc", checkpointSet: "icemaker", filterTypes: ["Icemaker water filter"], filterServiceAvailable: true, filterServiceKinds: ["water"], help: "Dedicated clear-ice or nugget icemaker" },
      { id: "cooktop", label: "Cooktop / Rangetop", shortLabel: "Cooktop / Rangetop", icon: "cooktop.svg", group: "standard", checkpointSet: "cooktop", filterTypes: [], help: "Gas, electric, or induction cooking surface" },
      { id: "range", label: "Range", shortLabel: "Range", icon: "range.svg", group: "standard", checkpointSet: "cooking", filterTypes: [], help: "Freestanding, slide-in, or professional range" },
      { id: "dishwasher", label: "Dishwasher", shortLabel: "Dishwasher", icon: "dishwasher.svg", group: "standard", checkpointSet: "dishwasher", filterTypes: [], help: "Built-in top-control dishwasher" },
      /* Same rule as the grill, stated at signup for the same reason: a hood full
         of grease is a cleaning job Wilson quotes separately, and the customer
         should learn that at enrollment rather than at the visit. Accessible
         baffles and filters ARE cleaned as maintenance; the ductwork, blower
         housing and anything beyond the filters are inspected only. */
      { id: "ventilation", label: "Ventilation", shortLabel: "Ventilation", icon: "ventilation.svg", group: "standard", checkpointSet: "ventilation", filterTypes: [], help: "Hood, liner, insert, or downdraft", scopeNote: "Functional inspection, plus cleaning of the accessible baffles and filters only. Duct and blower cleaning is never included and is quoted separately. Condition still affects the health score.", scopeNoteShort: "Function only \u00b7 no duct cleaning" },
      { id: "microwave", label: "Microwave", shortLabel: "Microwave", icon: "microwave.svg", group: "standard", checkpointSet: "microwave", filterTypes: [], help: "Built-in, over-the-range, drawer, countertop, or speed oven" },
      { id: "ovens", label: "Ovens", shortLabel: "Ovens", icon: "ovens.svg", group: "standard", checkpointSet: "oven", filterTypes: [], help: "Single, double, steam, or combination wall oven" },
      { id: "warming_drawer", label: "Warming Drawer", shortLabel: "Warming Drawer", icon: "warming_drawer.svg", group: "standard", checkpointSet: "warming_drawer", filterTypes: [], help: "Built-in warming or proofing drawer" },
      { id: "coffee", label: "Built-In Coffee", shortLabel: "Built-In Coffee", icon: "coffee.svg", group: "standard", checkpointSet: "coffee", filterTypes: [], help: "Plumbed or reservoir built-in coffee system" },
      { id: "washer", label: "Washer", shortLabel: "Washer", icon: "washer.svg", group: "standard", checkpointSet: "washer", filterTypes: [], help: "Front-load or top-load washer" },
      { id: "dryer", label: "Dryer", shortLabel: "Dryer", icon: "dryer.svg", group: "standard", checkpointSet: "dryer", filterTypes: [], help: "Electric, gas, heat-pump, or ventless dryer" },

      /*
       * A WashTower / laundry center is ONE product but TWO maintained
       * appliances. `expandsTo` makes the enrollment picker create the same
       * labelled washer + dryer pair that invoice import already produces, so
       * both entry paths land on identical assets, protocols and pricing.
       * `countsAs` drives the customer-facing disclosure -- nothing about the
       * two-appliance billing may be hidden behind the click.
       *
       * checkpointSet is inert: this category always expands, so no asset is
       * ever created carrying it. It is set to `laundry` only so it agrees with
       * the applianceTypes entry of the same id -- the two indexes share the key
       * and the type index wins resolution, so a disagreement here would be a
       * trap for whoever reads it next.
       */
      { id: "laundry_center", label: "Laundry Center / WashTower", shortLabel: "WashTower", icon: "laundry_center.svg", group: "standard", checkpointSet: "laundry", filterTypes: [], expandsTo: ["washer", "dryer"], countsAs: 2, countsAsNote: "Counts as 2 appliances", help: "Stacked single-unit washer and dryer, such as an LG WashTower", scopeNote: "Maintained and priced as two appliances: the washer and the dryer are inspected on their own protocols." },

      /*
       * Outdoor grills are maintained on FUNCTION ONLY. Wilson never cleans a
       * grill -- not at maintenance, not on an unrelated service call. Condition
       * is rated because it feeds the health score, but it is documented and
       * reported rather than remediated. `scopeNote` is shown on the picker tile
       * before the customer adds one and again in the enrollment summary.
       */
      { id: "outdoor_grill", label: "Outdoor Grill", shortLabel: "Outdoor Grill", icon: "outdoor_grill.svg", group: "standard", checkpointSet: "outdoor_grill", filterTypes: [], help: "Built-in or cart gas grill, kamado, or outdoor cooker", scopeNote: "Functional inspection only. Cleaning is never included — not at maintenance and not on any other visit. Condition still affects the health score.", scopeNoteShort: "Function only · no cleaning" }
    ],

    /*
     * APPLIANCE TYPE -> CUSTOMER CATEGORY.   (v0.9.34)
     *
     * The mapping existed in one direction only. A customer category knows which
     * types it expands to; a type could not say which category it belongs to,
     * and every consumer that needed the reverse had to guess.
     *
     * Matching an invoice onto enrolled appliances is where that finally bit. A
     * seeded slot carries `type: "hood"` while the parser classifies the same
     * product as `ventilation`, so a Wolf hood on the invoice and a Wolf hood on
     * the plan looked like two different categories and never matched. Declared
     * here so both sides normalise through one table.
     */
    applianceTypes: [
      { id: "refrigerator", customerCategory: "refrigeration", label: "Refrigerator", group: "standard", checkpointSet: "refrigerator", filterTypes: ["Refrigerator water filter", "Refrigerator air / food-preservation filter"] },
      { id: "freezer", customerCategory: "refrigeration", label: "Freezer", group: "standard", checkpointSet: "refrigerator", filterTypes: ["Freezer water filter"] },
      { id: "wine_beverage", customerCategory: "refrigeration", label: "Wine / Beverage Center", group: "standard", checkpointSet: "refrigerator", filterTypes: [] },
      { id: "ice_maker", customerCategory: "ice_maker", label: "Icemaker (IMUC)", group: "imuc", checkpointSet: "icemaker", filterTypes: ["Icemaker water filter"] },
      { id: "dishwasher", customerCategory: "dishwasher", label: "Dishwasher", group: "standard", checkpointSet: "dishwasher", filterTypes: [] },
      { id: "range", customerCategory: "range", label: "Range", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "cooktop", customerCategory: "cooktop", label: "Cooktop / Rangetop", group: "standard", checkpointSet: "cooktop", filterTypes: [] },
      { id: "wall_oven", customerCategory: "ovens", label: "Wall Oven", group: "standard", checkpointSet: "oven", filterTypes: [] },
      { id: "speed_oven", customerCategory: "microwave", label: "Microwave / Speed Oven", group: "standard", checkpointSet: "microwave", filterTypes: [] },
      { id: "washer", customerCategory: "washer", label: "Washer", group: "standard", checkpointSet: "washer", filterTypes: [] },
      { id: "dryer", customerCategory: "dryer", label: "Dryer", group: "standard", checkpointSet: "dryer", filterTypes: [] },
      { id: "hood", customerCategory: "ventilation", label: "Vent Hood", group: "standard", checkpointSet: "ventilation", filterTypes: [] },
      { id: "hood_insert", customerCategory: "ventilation", label: "Hood Insert / Liner", group: "standard", checkpointSet: "ventilation", filterTypes: [] },
      { id: "warming_drawer", customerCategory: "warming_drawer", label: "Warming Drawer", group: "standard", checkpointSet: "warming_drawer", filterTypes: [] },
      { id: "coffee_maker", customerCategory: "coffee", label: "Built-In Coffee Maker", group: "standard", checkpointSet: "coffee", filterTypes: [] },
      // WashTower / laundry center. The shipped behaviour is TWO maintained assets:
      // invoice import splits one into a washer plus a dryer (invoice_parser.py sets
      // expandTo, invoice-import.js creates both), each priced, scheduled and -- since
      // v0.9.4 -- protocol-resolved independently. This entry survives only as the
      // catalogue label for the product as printed on an invoice; no asset is created
      // with it as an exact type. `laundry` is therefore an orphan checkpoint set kept
      // for older stored data. Context §34 item 13 is now a confirmation, not a
      // decision: if Wilson intends a WashTower to bill as ONE appliance, the change is
      // in invoice-import.js, not here.
      { id: "laundry_center", customerCategory: "laundry_center", label: "Laundry Center / WashTower", group: "standard", checkpointSet: "laundry", filterTypes: [] },
      { id: "commercial_refrigeration", customerCategory: "refrigeration", label: "Commercial / Specialty Refrigeration", group: "standard", checkpointSet: "refrigerator", filterTypes: [] },
      { id: "outdoor_grill", customerCategory: "outdoor_grill", label: "Outdoor Grill", group: "standard", checkpointSet: "outdoor_grill", filterTypes: [] },
      { id: "outdoor", customerCategory: "outdoor_grill", label: "Outdoor Appliance", group: "standard", checkpointSet: "generic", filterTypes: [] },
      { id: "other", customerCategory: null, label: "Other Appliance", group: "standard", checkpointSet: "generic", filterTypes: [] }
    ],
    /* The resolver maps each of these to a protocol set. "Gas Furnace" is new:
       a furnace was previously enrolled as a Split System and inspected on a
       cooling protocol, which asks for a refrigerant circuit it does not have. */
    hvacSystemTypes: [
      "Split System",
      "Heat Pump",
      "Gas Furnace",
      "Mini-Split",
      "Packaged Unit",
      "Other"
    ],

    /*
     * SUBSYSTEMS -- WHAT THE REPORT ALREADY PROMISED AND COULD NOT DELIVER.
     *
     * The report has always carried this sentence: "Subsystem categories group
     * related components and functions, such as temperature performance, water
     * systems, filtration, controls, airflow, drainage, connections, and
     * safety." It described a document nobody was holding: every field-generated
     * checkpoint was stamped `category: "Health vital"`, so the Subsystem review
     * was one section with that heading, and the score breakdown collapsed to a
     * single line reading "Health vital -- Checkpoint ratings in this category".
     *
     * Every one of the 77 checkpoints now names its subsystem. A customer
     * reading "3 points came off Airflow" can go and look at the airflow checks;
     * "3 points came off Health vital" told them nothing.
     */
    subsystems: {
      temperature: { label: "Temperature performance", blurb: "How well the appliance reaches and holds the temperatures it is meant to." },
      airflow:     { label: "Airflow",                 blurb: "Air moving where it should, at the rate it should." },
      water:       { label: "Water systems",           blurb: "Fill, supply, seals and anywhere water is meant to go." },
      drainage:    { label: "Drainage",                blurb: "Water leaving the appliance the way it was designed to." },
      filtration:  { label: "Filtration",              blurb: "Filters, baffles, lint and sumps." },
      controls:    { label: "Controls",                blurb: "Boards, sensors, stored fault codes and what the appliance reports about itself." },
      electrical:  { label: "Electrical",              blurb: "Current draw and electrical performance against the nameplate." },
      mechanical:  { label: "Mechanical operation",    blurb: "Motors, pumps, burners, drums and moving parts under load." },
      connections: { label: "Connections",             blurb: "Utility, vent and supply connections where the appliance meets the house." },
      safety:      { label: "Safety",                  blurb: "Interlocks, safeties, combustion and gas integrity." },
      condition:   { label: "Condition",               blurb: "Seals, surfaces and physical condition of serviceable parts. Never scored for cosmetic wear." }
    },

    checkpointSets: {
      /* =====================================================================
         THE FIELD TEAM'S PROTOCOLS                              (v0.9.39)
         =====================================================================

         Rewritten from the health-check lists Cayden brought back from the
         field team, appliance by appliance, in their order and mostly their
         words. Three rules arrived with them and govern everything below:

         1. ONE SCORING STANDARD. Every health check is answered pass / cause
            for concern / fail, worth 5 / 3 / 1, and choosing anything but pass
            demands the reason. No more per-check vocabularies with their own
            point values -- the anchored option lists that used to BE the
            answers survive as the tap-to-pick reasons, so two technicians
            flagging the same condition still file the same words.

         2. STANDARDIZED STATIC TESTS. Where a number is taken, it is taken the
            same way on the same appliance every visit -- 500 ml from the kit
            beaker for the microwave delta-T, 1,000 ml in the kit's 10-inch
            skillet for time-to-boil, 350°F bake with the logging probe for the
            oven. Cayden: "we are trying less to compare measured data to mfg
            spec and more to providing a consistent measurement over time using
            the same static tests on the same appliance year after year." The
            readings ride on the check and trend against their own history;
            the verdict is the technician's judgement beside them.

         3. THE KIT IS THE INSTRUMENT. Checks that name a tool (IR camera,
            manometer, fogger, leakage tester, logging probe, splitter) assume
            the specialty kit. The IR evaporator scan REQUIRES its photograph:
            the tech saves the IR image to the camera roll and attaches it
            here, and that image is the year-over-year baseline.

         `photoRequired` gates completion the same way a required reading does.
         `unit` on a check is advisory; readings carry their own units.
         ------------------------------------------------------------------- */
      generic: [
        { id: "condition", subsystem: "mechanical", name: "Overall condition & operation", prompt: "Run the unit and confirm normal operation, controls, and visible condition.", photoPrompt: "Serial tag or condition photo" },
        { id: "connections", subsystem: "connections", name: "Connections & safety", prompt: "Inspect visible utility connections and note any safety concern.", photoPrompt: "Photo if any issue is found" },
        { id: "cleanliness", subsystem: "condition", name: "Serviceable condition", prompt: "Record the condition of the accessible filters, screens, vents and serviceable areas as found.", photoPrompt: "Serviceable area as found" }
      ],

      refrigerator: [
        { id: "seal", subsystem: "condition", name: "Door seal check", prompt: "Inspect the seals all round on every compartment: pliable, sealing, no tears or trapped debris. Check door alignment and self-close.", photoPrompt: "Seal if abnormal" },
        {
          id: "evap_ir", subsystem: "temperature",
          name: "Evaporator & air path — IR camera",
          prompt: "Scan the evaporator panel and air path with the kit's IR camera: the cold pattern should be even. Cold bridging, a warm return, or an iced panel is a finding. Save the IR image to your camera roll, then attach it here — it is required, and it is this appliance's baseline for next year.",
          photoPrompt: "The IR image — required",
          photoRequired: true
        },
        {
          /* v0.9.41, Cayden: "still asking for condenser temps. eliminate
             those, we will just do pass fail or cause for concern and rely on
             tech to notate issues like a bad condenser fan or extreme
             blockages." The id stays so last year's condenser check is still
             this year's trend line. Compartment temperatures left the
             protocol the same day: Guardian-enrolled units stream them to the
             report from the sensor (see tech-maintenance's passthrough card),
             and a spot readout on an unenrolled unit was never the field
             team's list to begin with. */
          id: "condenser_temp", subsystem: "airflow",
          name: "Condenser health — before cleaning",
          prompt: "Inspect the condenser BEFORE vacuuming: debris load, fan operation, sound. Judge it pass / concern / fail and notate what you found — a bad condenser fan or extreme blockage belongs in the note.",
          photoPrompt: "Condenser as found"
        },
        { id: "icemaker_int", subsystem: "mechanical", name: "Built-in icemaker (if fitted)", prompt: "Harvest, fill, and ice condition on the built-in icemaker. Mark not applicable if this unit has none.", photoPrompt: "Ice or icemaker if abnormal" },
        { id: "drain_tube", subsystem: "drainage", name: "Defrost drain tube (if accessible)", prompt: "Confirm the defrost drain is clear and draining to the pan. Mark not applicable where it is not accessible on this model.", photoPrompt: "Drain area if a concern is found" }
      ],

      icemaker: [
        { id: "bin", subsystem: "condition", name: "Bin cleanliness — before cleaning", prompt: "Record the bin as found, before any cleaning: liner condition, scale, staining, any mould line.", photoPrompt: "Bin as found — take it before you clean" },
        { id: "internals", subsystem: "condition", name: "Internal components — scale / growth", prompt: "Inspect the evaporator plate, distributor, curtain and accessible internals for scale, slime or growth, as found.", photoPrompt: "Internals as found" },
        { id: "condenser", subsystem: "airflow", name: "Condenser coil", prompt: "Inspect the condenser: debris load, fan operation, abnormal sound.", photoPrompt: "Condenser if fouled" },
        /* One gallon, not 500 ml (Cayden, v0.9.49): an icemaker drain moves a
           real melt volume, and half a litre clears even a half-blocked line.
           A gallon is what actually finds a slowing drain. */
        { id: "drain_test", subsystem: "drainage", name: "Drain performance — standardized pour", prompt: "Pour 1 gallon from the kit jug into the drain path. It should clear promptly with no backup — the same pour every visit is what makes a slowing drain visible.", photoPrompt: "Drain area if it backs up" },
        { id: "ice_test", subsystem: "mechanical", name: "Ice performance test", prompt: "Watch a harvest if the visit allows: pattern, fill, cube quality, production rate.", photoPrompt: "Fresh ice" }
      ],

      dishwasher: [
        { id: "leak", subsystem: "water", name: "Seals & leak check", prompt: "Inspect door seals, visible connections, and the base area for leakage.", photoPrompt: "Seal / leak area if abnormal" },
        { id: "filter", subsystem: "filtration", name: "Filter & sump condition", prompt: "Inspect the filter and sump BEFORE cleaning: debris load, damage, glass or foreign objects.", photoPrompt: "Filter / sump as found" },
        { id: "spray_arms", subsystem: "mechanical", name: "Spray arm condition", prompt: "Check the arms for blockages and free rotation. Note each arm's position before the test cycle, then confirm it moved during the cycle.", photoPrompt: "Arm or blockage if found" },
        {
          /* v0.9.41, Cayden: "lets remove the amp draw thing from dishwasher
             check. just make section 4 on dish controls codes and test
             cycle." The id keeps the old records trending. */
          id: "controls_amp", subsystem: "controls",
          name: "Controls, codes & test cycle",
          prompt: "Check stored codes, then run a test cycle far enough to see fill, wash and heat behave.",
          photoPrompt: "Display if a code is present"
        },
        { id: "drain", subsystem: "drainage", name: "Drain test", prompt: "Verify the drain: high loop present, non-return working, disposal connection clear, no backup at the air gap where fitted.", photoPrompt: "Drain routing if a concern is found" },
        { id: "install", subsystem: "connections", name: "Installation — high loop & hot water", prompt: "Confirm the drain hose is high looped and the machine is connected to hot water.", photoPrompt: "Routing if wrong" }
      ],

      washer: [
        { id: "leaks", subsystem: "water", name: "External leak test", prompt: "Inspect hoses, valves, connections and the base for any leakage during fill and drain.", photoPrompt: "Connection if abnormal" },
        { id: "tub", subsystem: "mechanical", name: "Tub & bearing health", prompt: "Spin the drum by hand and under power: bearing rumble, play at the drum, shaft noise.", photoPrompt: "Photo if damage is visible" },
        { id: "suspension", subsystem: "mechanical", name: "Suspension test", prompt: "Check travel and rebound: press the drum, watch a spin ramp for excessive movement or banging.", photoPrompt: "Photo if movement is visible" },
        { id: "boot", subsystem: "condition", name: "Dispenser & door boot cleanliness", prompt: "Pull the boot back and record it as found: tears, perforations, trapped debris, mould. Include the dispenser.", photoPrompt: "Boot as found — before cleaning" },
        { id: "controls", subsystem: "controls", name: "Controls test", prompt: "Verify the controls and check stored codes.", photoPrompt: "Display if a code is present" },
        { id: "cycle", subsystem: "mechanical", name: "Fill / spin / drain test", prompt: "Run a cycle far enough to verify fill, agitation or tumble, spin up to speed, and a clean drain.", photoPrompt: "Photo if an issue is visible" }
      ],

      /* A WashTower or laundry centre still expands to washer + dryer; this
         set exists only for a legacy record that stored the combined key. */
      laundry: [
        { id: "clean", subsystem: "condition", name: "Accessible filter, lint path & gasket", prompt: "Record the condition of the accessible filter, lint path and gasket as found.", photoPrompt: "As found" },
        { id: "codes", subsystem: "controls", name: "Stored codes & controls", prompt: "Check stored faults and verify control operation.", photoPrompt: "Display if a code is present" }
      ],

      dryer: [
        /* v0.9.41, Cayden: "there are many instances of bad installs where we
           cant get to the vent during maint. give an option for i cant
           access. same thing with cycling temp." Both readings keep their
           requiredness on a normal install; the can't-access tick waives them
           and goes on the record as its own finding about the install. The
           separate restriction test is gone -- "eliminate restriction test
           #4" -- the lint check and the static number carry that job. */
        {
          id: "static", subsystem: "airflow",
          name: "Vent static — manometer readout",
          prompt: "Measure the vent static with the kit manometer at the exhaust, unit running on high. Record the reading; it trends against this same duct run every visit. If the install blocks access to the vent, tick the box and say so in the note.",
          unit: "in wc",
          photoPrompt: "Manometer reading"
        },
        {
          id: "exhaust_temp", subsystem: "temperature",
          name: "Cycling temp at exhaust — high heat",
          prompt: "On high heat, record the exhaust temperature through a cycle-up and the room ambient with it. Confirm the burner or element cycles rather than running away. If access is bad, tick the box.",
          unit: "°F",
          photoPrompt: "Reading if out of the ordinary"
        },
        { id: "lint", subsystem: "safety", name: "Lint in unit and duct run", prompt: "Record lint load inside the unit and in the accessible duct run, as found. Check the run itself while you are there: flapper opening, kinks, crushed transition. A packed housing is a fire risk, not housekeeping.", photoPrompt: "Lint as found — before cleaning" },
        { id: "overall", subsystem: "mechanical", name: "Visual & audible test", prompt: "Run the unit and listen: drum rollers, belt, blower. Inspect visible condition.", photoPrompt: "Photo if an issue is visible" }
      ],

      ventilation: [
        { id: "filters", subsystem: "filtration", name: "Filters, grease & beyond", prompt: "Record the baffles and filters as found, and what is visible of the unit BEYOND the filters: grease in the plenum or on the blower is the finding the filters hide.", photoPrompt: "Filters and plenum as found" },
        { id: "capture", subsystem: "airflow", name: "Airflow / capture test — fogger", prompt: "Run the kit fogger at the cooking surface with the hood at its working speed and watch the capture: smoke should draw cleanly with no rollout at the edges.", photoPrompt: "Capture during the test if it fails" },
        { id: "blower", subsystem: "mechanical", name: "Blower health", prompt: "Run every speed: bearing noise, vibration, a blower wheel that has gone out of balance from grease load.", photoPrompt: "Photo if an issue is visible" },
        { id: "controls", subsystem: "controls", name: "Lights & controls", prompt: "Verify every speed, every light, and any filter-reminder or delay function.", photoPrompt: "Photo if an issue is present" }
      ],

      cooking: [
        { id: "seal", subsystem: "condition", name: "Oven seals & hinges", prompt: "Inspect the oven door seals, hinges and door close on every cavity.", photoPrompt: "Seal / hinge if abnormal" },
        {
          id: "oven_temp", subsystem: "temperature",
          name: "Oven temp test — 350°F bake, 30-minute average",
          prompt: "Bake only — never convection. Set 350°F, let it preheat, then log 30 minutes with the kit probe and record the average against the set point. Same test, same cavity, every visit.",
          unit: "°F",
          photoPrompt: "Probe or logger reading"
        },
        { id: "oven_element", subsystem: "temperature", name: "Oven element / bake burner test", prompt: "Verify bake and broil reach temperature and cycle. On gas, watch the bake burner light and hold.", photoPrompt: "Element or flame when useful" },
        {
          id: "burners", subsystem: "temperature",
          name: "Surface burner test",
          prompt: "Every burner or element to full output. Electric: confirm cycling on low. Induction: every zone detects and holds. Gas: tick the gas box and record the manometer reading.",
          unit: "in wc",
          photoPrompt: "Flame or element photo when useful"
        },
        {
          id: "boil", subsystem: "temperature",
          name: "Time to boil — 1,000 ml, 10-inch pan",
          prompt: "1,000 ml from the kit beaker in the kit's 10-inch skillet, largest burner, high, lid off. Record minutes to a rolling boil. The number only means something against this same appliance's last one — that is the point.",
          unit: "min",
          photoPrompt: "Setup if anything is unusual"
        },
        { id: "fans", subsystem: "airflow", name: "Fan operations", prompt: "Verify convection and cooling fans run, reverse where the model does, and stop when they should.", photoPrompt: "Photo if an issue is visible" }
      ],

      cooktop: [
        {
          id: "burners", subsystem: "temperature",
          name: "Burner / element test",
          prompt: "Every burner or element to full output. Electric: confirm cycling on low. Induction: every zone detects and holds a load. Gas: tick the gas box and record the manometer reading.",
          unit: "in wc",
          photoPrompt: "Flame or element photo when useful"
        },
        {
          id: "boil", subsystem: "temperature",
          name: "Time to boil — 1,000 ml, 10-inch pan",
          prompt: "1,000 ml from the kit beaker in the kit's 10-inch skillet, largest burner, high, lid off. Record minutes to a rolling boil — the standard works for gas, electric and induction because it is the same pan and the same water every year.",
          unit: "min",
          photoPrompt: "Setup if anything is unusual"
        }
      ],

      oven: [
        { id: "fans", subsystem: "airflow", name: "Fan operations", prompt: "Verify convection and cooling fans run, reverse where the model does, and stop when they should.", photoPrompt: "Photo if an issue is visible" },
        { id: "seal", subsystem: "condition", name: "Seals & hinges", prompt: "Inspect the door seal all round, hinge travel, and the door close.", photoPrompt: "Seal / hinge if abnormal" },
        {
          id: "oven_temp", subsystem: "temperature",
          name: "Oven temp test — 350°F bake, 30-minute average",
          prompt: "Bake only — never convection. Set 350°F, preheat, log 30 minutes with the kit probe and record the average against the set point. On a double oven, run the primary cavity and note the second.",
          unit: "°F",
          photoPrompt: "Probe or logger reading"
        },
        { id: "element", subsystem: "temperature", name: "Element test", prompt: "Verify bake, broil and convection elements or burners operate and cycle.", photoPrompt: "Element photo if abnormal" }
      ],

      warming_drawer: [
        { id: "slides", subsystem: "mechanical", name: "Slide and rail test", prompt: "Run the drawer through full travel: smooth, level, no binding, stops intact.", photoPrompt: "Slide or rail if abnormal" },
        {
          id: "element", subsystem: "temperature",
          name: "Element test",
          prompt: "Verify the element heats. If you record the temperature, note the setting exactly as marked and measure at the centre after 20 minutes — there is no cross-brand standard, so the reading only trends against this same drawer.",
          unit: "°F",
          photoPrompt: "The control as set, and the reading"
        },
        { id: "fan", subsystem: "airflow", name: "Fan test (if fitted)", prompt: "Verify the fan runs where the model has one. Mark not applicable where it does not.", photoPrompt: "Photo if an issue is visible" },
        { id: "seal", subsystem: "condition", name: "Seal test (if applicable)", prompt: "Inspect the gasket all round where the model has one. Mark not applicable where it does not.", photoPrompt: "Gasket if abnormal" }
      ],

      microwave: [
        { id: "leakage", subsystem: "safety", name: "Leakage test", prompt: "Run the kit's leakage tester around the door perimeter and window while the unit heats a water load. Any reading over the threshold on the tester is a fail, full stop.", photoPrompt: "Tester reading if over" },
        {
          id: "delta_t", subsystem: "temperature",
          name: "Delta-T water test — 500 ml, standard time",
          prompt: "500 ml from the kit beaker, straight from the tap. Record the water temperature before, run the standard time on high, record it after. Same beaker, same time, every visit.",
          unit: "°F",
          photoPrompt: "Reading if out of the ordinary"
        },
        { id: "keypad", subsystem: "controls", name: "Keypad test", prompt: "Verify every key registers and the display is intact.", photoPrompt: "Display if faulty" },
        { id: "fan", subsystem: "airflow", name: "Fan test", prompt: "Verify the cooling fan, and the vent fan and lights on an over-the-range unit.", photoPrompt: "Photo if abnormal" }
      ],

      coffee: [
        { id: "grounds", subsystem: "condition", name: "Condition of grounds", prompt: "Inspect the grounds container and the spent pucks: a wet, crumbling or channelled puck is the machine talking about its grind and dose.", photoPrompt: "Grounds or puck if abnormal" },
        { id: "flow", subsystem: "water", name: "Overall flow test", prompt: "Run a brew and watch the flow: steady, no sputtering, no stalling, normal volume in normal time.", photoPrompt: "Photo if abnormal" },
        { id: "milk", subsystem: "condition", name: "Milk pipe condition", prompt: "Inspect the milk lines, frother and connector — inside the line, not just at it. Film, souring smell or visible growth is a finding on a food-contact path.", photoPrompt: "Milk line or frother as found" },
        { id: "interior", subsystem: "condition", name: "Interior cleanliness", prompt: "Record the interior as found: brew chamber, drip tray area, spouts.", photoPrompt: "Interior as found" },
        { id: "grinder", subsystem: "mechanical", name: "Grinder test", prompt: "Run a grind: burrs cutting cleanly, no metal-on-metal, chute clear, dose consistent.", photoPrompt: "Chute or hopper if fouled" },
        { id: "brew", subsystem: "mechanical", name: "Brew unit test", prompt: "Removable units: pull the brew group and inspect seals, screen and travel. Fixed units: run the machine's own clean cycle and inspect what is reachable.", photoPrompt: "Brew group as found" }
      ],

      outdoor_grill: [
        { id: "gauge", subsystem: "controls", name: "Temp gauge operation", prompt: "Confirm the lid gauge responds and roughly agrees with a measured temperature.", photoPrompt: "Gauge if failed" },
        { id: "burners", subsystem: "temperature", name: "Burner and valve test", prompt: "Light every burner: reliable ignition, stable flame, full range on the valve, no lifting or uneven flame.", photoPrompt: "Flame pattern if abnormal" },
        { id: "grates", subsystem: "condition", name: "Grate condition", prompt: "Record the grates as found: cracking, heavy corrosion, flaking that reaches food contact.", photoPrompt: "Grates as found" },
        { id: "ignitor", subsystem: "mechanical", name: "Ignitor condition", prompt: "Test every ignitor: spark at every port, no repeated attempts needed.", photoPrompt: "Ignitor if failed" },
        { id: "rust", subsystem: "condition", name: "Rust condition", prompt: "Record structural rust as found: firebox, burners, frame, fasteners. Surface discolouration is free; perforation and flaking are findings.", photoPrompt: "Rust as found" },
        { id: "grease", subsystem: "safety", name: "Grease condition", prompt: "Record grease load in the firebox, tray and drip path as found. Heavy accumulation is a fire risk, and cleaning is never included — it is documented and quoted.", photoPrompt: "Grease as found" },
        { id: "extras", subsystem: "controls", name: "Lights, controls, rotisserie (if fitted)", prompt: "Verify lights, knobs and any rotisserie or side burner. Mark not applicable where not fitted.", photoPrompt: "Any failed hardware" }
      ],
      /*
       * =================================================================
       * HVAC PROTOCOLS
       * =================================================================
       *
       * THE NINE READINGS
       * -----------------
       * measureQuick's doctrine is nine probes every time, and the nine are the
       * right nine -- they are what the physics of a refrigerant circuit and an
       * air system require, not a product decision. Wilson takes the same nine:
       *
       *   1-2  suction and liquid pressures, as saturation temperature
       *   3-4  suction and liquid line temperatures
       *   5    outdoor air temperature
       *   6-7  return and supply air temperature
       *   8-9  return and supply static pressure
       *
       * WHY SATURATION TEMPERATURE RATHER THAN PRESSURE
       * ----------------------------------------------
       * Converting pressure to saturation temperature needs refrigerant property
       * tables, per refrigerant, using dew point for superheat and bubble point
       * for subcooling. Those tables are published physical data -- and writing
       * them from memory into this file would put an unverifiable number
       * underneath every derived value on the page. A wrong saturation
       * temperature makes superheat, subcooling and the charge score all wrong,
       * silently and confidently.
       *
       * So the technician enters the saturation temperature, which every digital
       * gauge set and probe displays directly for the selected refrigerant, and
       * which is printed on the dial of an analog set. It is a normal field
       * workflow, not a workaround, and everything downstream is then honest
       * arithmetic on entered readings.
       *
       * When Wilson wants pressure-in / saturation-out, the tables belong on the
       * server, sourced from the refrigerant manufacturer and verified -- not
       * typed into a config file.
       *
       * TARGETS COME OFF THE PLATE
       * -------------------------
       * `targetFrom` names the design-profile field a reading is judged against.
       * That is what makes a 13-SEER system able to score 100.
       */
      hvac_cooling: [
        {
          id: "hvac_airside",
          subsystem: "airflow",
          name: "Airside performance",
          prompt: "Measure return and supply air temperature at the equipment, and total external static across the air handler. Record the filter condition you found before changing it.",
          guidance: "Total external static is judged against the maximum on this blower's nameplate, not against a rule of thumb. Temperature split is recorded and trended; its acceptable band depends on return humidity and is set by Wilson.",
          readingFields: [
            { key: "returnDb",     label: "Return air temperature",  unit: "\u00b0F",  required: true,  placeholder: "Dry bulb" },
            { key: "supplyDb",     label: "Supply air temperature",  unit: "\u00b0F",  required: true,  placeholder: "Dry bulb" },
            { key: "returnStatic", label: "Return static pressure",  unit: " in wc", required: true,  placeholder: "e.g. 0.22" },
            { key: "supplyStatic", label: "Supply static pressure",  unit: " in wc", required: true,  placeholder: "e.g. 0.28" }
          ],
          derivedReading: "deltaT,totalStatic",
          targetFrom: "maxEsp",
          photoPrompt: "Filter and static test port photo"
        },
        {
          id: "hvac_refrigerant",
          subsystem: "temperature",
          name: "Refrigerant circuit",
          prompt: "Read saturation temperature for this refrigerant off the gauge set on both sides, and take line temperatures at the same points. Superheat and subcooling are calculated from what you enter.",
          guidance: "Enter saturation temperature as the gauge reads it for the refrigerant on the plate -- dew point on the suction side, bubble point on the liquid side. Target bands depend on the metering device and are set by Wilson.",
          readingFields: [
            { key: "suctionSat",  label: "Suction saturation temp", unit: "\u00b0F", required: true, placeholder: "From gauge" },
            { key: "suctionLine", label: "Suction line temp",       unit: "\u00b0F", required: true, placeholder: "Clamp" },
            { key: "liquidSat",   label: "Liquid saturation temp",  unit: "\u00b0F", required: true, placeholder: "From gauge" },
            { key: "liquidLine",  label: "Liquid line temp",        unit: "\u00b0F", required: true, placeholder: "Clamp" }
          ],
          derivedReading: "superheat,subcooling",
          photoPrompt: "Gauge set reading"
        },
        {
          id: "hvac_condenser",
          subsystem: "temperature",
          name: "Condenser & heat rejection",
          prompt: "Take outdoor ambient and liquid line temperature. Clean the accessible condenser coil, then rate heat rejection and coil condition after service.",
          guidance: "Approach is the liquid line temperature above outdoor ambient. It is the clearest single indicator of a loaded coil or a charge problem, and it is trended across visits.",
          readingFields: [
            { key: "outdoorAir", label: "Outdoor air temperature", unit: "\u00b0F", required: true, placeholder: "Shaded" }
          ],
          derivedReading: "approach",
          photoPrompt: "Coil before and after cleaning"
        },
        {
          id: "hvac_electrical",
          subsystem: "electrical",
          name: "Electrical performance",
          prompt: "Measure running amps on the condenser and the blower, and compare each with the nameplate rating. Inspect contactors, capacitors and connections.",
          guidance: "Judged as a percentage of the nameplate rated load amps for this equipment. Over 100% of RLA is drawing more than it was built to draw.",
          readingFields: [
            { key: "condenserAmps", label: "Condenser running amps", unit: "A", required: true, placeholder: "Clamp" },
            { key: "blowerAmps",    label: "Blower running amps",    unit: "A", required: false, placeholder: "If accessible" }
          ],
          derivedReading: "ampsOfRla",
          targetFrom: "condenserRla",
          photoPrompt: "Nameplate and any component found failing"
        },
        {
          id: "hvac_condensate",
          subsystem: "drainage",
          name: "Condensate & drainage",
          prompt: "Confirm the primary drain flows, the trap is primed, the secondary path and float switch work, and there is no standing water or staining in the pan.",
          photoPrompt: "Pan and drain, especially any staining"
        },
        {
          id: "hvac_safety",
          subsystem: "safety",
          name: "Controls, safeties & condition",
          prompt: "Test the thermostat sequence, verify safeties operate, and record the visible condition of cabinet, insulation, line set and disconnect.",
          photoPrompt: "Any safety concern"
        }
      ],

      /*
       * Heat pumps run the cooling protocol plus a heating-mode verification.
       * Charge and airflow do not change; what changes is that the system has a
       * second job and a defrost cycle, and both need to be seen working.
       */
      hvac_heatpump: [
        {
          id: "hvac_airside",
          subsystem: "airflow",
          name: "Airside performance",
          prompt: "Measure return and supply air temperature at the equipment, and total external static across the air handler.",
          guidance: "Total external static is judged against this blower's nameplate maximum.",
          readingFields: [
            { key: "returnDb",     label: "Return air temperature",  unit: "\u00b0F",  required: true,  placeholder: "Dry bulb" },
            { key: "supplyDb",     label: "Supply air temperature",  unit: "\u00b0F",  required: true,  placeholder: "Dry bulb" },
            { key: "returnStatic", label: "Return static pressure",  unit: " in wc", required: true,  placeholder: "e.g. 0.22" },
            { key: "supplyStatic", label: "Supply static pressure",  unit: " in wc", required: true,  placeholder: "e.g. 0.28" }
          ],
          derivedReading: "deltaT,totalStatic",
          targetFrom: "maxEsp",
          photoPrompt: "Filter and static test port photo"
        },
        {
          id: "hvac_refrigerant",
          subsystem: "temperature",
          name: "Refrigerant circuit",
          prompt: "Saturation temperature both sides from the gauge set, line temperatures at the same points.",
          guidance: "Enter saturation temperature as the gauge reads it for the refrigerant on the plate. Bands depend on metering device and operating mode.",
          readingFields: [
            { key: "suctionSat",  label: "Suction saturation temp", unit: "\u00b0F", required: true, placeholder: "From gauge" },
            { key: "suctionLine", label: "Suction line temp",       unit: "\u00b0F", required: true, placeholder: "Clamp" },
            { key: "liquidSat",   label: "Liquid saturation temp",  unit: "\u00b0F", required: true, placeholder: "From gauge" },
            { key: "liquidLine",  label: "Liquid line temp",        unit: "\u00b0F", required: true, placeholder: "Clamp" }
          ],
          derivedReading: "superheat,subcooling",
          photoPrompt: "Gauge set reading"
        },
        {
          id: "hvac_condenser",
          subsystem: "temperature",
          name: "Outdoor coil & heat transfer",
          prompt: "Outdoor ambient and liquid line temperature. Clean the accessible coil, then rate heat transfer and condition after service.",
          readingFields: [
            { key: "outdoorAir", label: "Outdoor air temperature", unit: "\u00b0F", required: true, placeholder: "Shaded" }
          ],
          derivedReading: "approach",
          photoPrompt: "Coil before and after cleaning"
        },
        {
          id: "hvac_reversing",
          subsystem: "mechanical",
          name: "Heating mode & defrost",
          prompt: "Change over to heating, confirm the reversing valve shifts and the system delivers heat, and verify the defrost cycle initiates and terminates. Record supply air temperature in heating.",
          guidance: "A heat pump that has only ever been checked in cooling has had half of it checked. Where outdoor conditions make a heating test impossible, mark it not applicable and say so on the report rather than passing it.",
          readingFields: [
            { key: "heatingSupply", label: "Supply air, heating mode", unit: "\u00b0F", required: false, placeholder: "If testable" }
          ],
          photoPrompt: "Defrost board or any fault code"
        },
        {
          id: "hvac_backup",
          subsystem: "temperature",
          name: "Backup heat & balance point",
          prompt: "Verify auxiliary or emergency heat operates and staging is correct. Confirm the balance point setting matches what the house needs.",
          photoPrompt: "Heat kit or control settings"
        },
        {
          id: "hvac_electrical",
          subsystem: "electrical",
          name: "Electrical performance",
          prompt: "Running amps on the condenser and blower against nameplate ratings. Inspect contactors, capacitors and connections.",
          readingFields: [
            { key: "condenserAmps", label: "Condenser running amps", unit: "A", required: true, placeholder: "Clamp" },
            { key: "blowerAmps",    label: "Blower running amps",    unit: "A", required: false, placeholder: "If accessible" }
          ],
          derivedReading: "ampsOfRla",
          targetFrom: "condenserRla",
          photoPrompt: "Nameplate and any component found failing"
        },
        {
          id: "hvac_condensate",
          subsystem: "drainage",
          name: "Condensate & drainage",
          prompt: "Primary drain flows, trap primed, secondary path and float switch work, no standing water or staining.",
          photoPrompt: "Pan and drain"
        },
        {
          id: "hvac_safety",
          subsystem: "safety",
          name: "Controls, safeties & condition",
          prompt: "Thermostat sequence in both modes, safeties operate, visible condition of cabinet, insulation, line set and disconnect.",
          photoPrompt: "Any safety concern"
        }
      ],

      /*
       * Gas heating. Temperature rise is the capacity measurement and the plate
       * states its own acceptable range, which is the cleanest example in the
       * whole product of a target that is a design spec rather than an opinion.
       *
       * Combustion analysis is deliberately NOT in this draft: it needs an
       * analyzer, it is the one HVAC reading with a genuine safety consequence
       * if misread, and whether Wilson runs it on a maintenance visit is a
       * decision for the tech team rather than a default I should set.
       */
      hvac_furnace: [
        {
          id: "hvac_rise",
          subsystem: "temperature",
          name: "Temperature rise",
          prompt: "With the furnace at steady state, measure return and supply air temperature and compare the rise against the range on the nameplate.",
          guidance: "The plate states the acceptable rise range for this furnace. Outside it in either direction means an airflow or firing-rate problem, and which direction tells you which.",
          readingFields: [
            { key: "returnDb", label: "Return air temperature", unit: "\u00b0F", required: true, placeholder: "Dry bulb" },
            { key: "supplyDb", label: "Supply air temperature", unit: "\u00b0F", required: true, placeholder: "At steady state" }
          ],
          derivedReading: "temperatureRise",
          targetFrom: "riseRange",
          photoPrompt: "Nameplate rise range"
        },
        {
          id: "hvac_airside",
          subsystem: "airflow",
          name: "Airflow & static",
          prompt: "Total external static across the air handler, and the filter condition as found.",
          readingFields: [
            { key: "returnStatic", label: "Return static pressure", unit: " in wc", required: true, placeholder: "e.g. 0.22" },
            { key: "supplyStatic", label: "Supply static pressure", unit: " in wc", required: true, placeholder: "e.g. 0.28" }
          ],
          derivedReading: "totalStatic",
          targetFrom: "maxEsp",
          photoPrompt: "Filter and static test ports"
        },
        {
          id: "hvac_burner",
          subsystem: "mechanical",
          name: "Burners, ignition & flame",
          prompt: "Inspect and clean burners as accessible, verify ignition and flame appearance, and check flame sensor microamps where the control provides them.",
          photoPrompt: "Burner and flame"
        },
        {
          id: "hvac_heatex",
          subsystem: "safety",
          name: "Heat exchanger condition",
          prompt: "Inspect the accessible heat exchanger for cracking, scaling, rust or flame disturbance. Document what you can see.",
          guidance: "Visual inspection of accessible surfaces only. This is not a certified heat-exchanger evaluation and the report says so.",
          photoPrompt: "Heat exchanger, required where anything is noted"
        },
        {
          id: "hvac_venting",
          subsystem: "safety",
          name: "Venting & combustion air",
          prompt: "Verify the vent is intact, correctly sloped and terminated, and that combustion air is adequate and unobstructed.",
          photoPrompt: "Vent run and termination"
        },
        {
          id: "hvac_electrical",
          subsystem: "electrical",
          name: "Electrical & blower",
          prompt: "Blower running amps against the nameplate rating, plus controls, limits and connections.",
          readingFields: [
            { key: "blowerAmps", label: "Blower running amps", unit: "A", required: true, placeholder: "Clamp" }
          ],
          derivedReading: "ampsOfRla",
          targetFrom: "blowerFla",
          photoPrompt: "Nameplate and any component found failing"
        },
        {
          id: "hvac_safety",
          subsystem: "safety",
          name: "Safeties, controls & condition",
          prompt: "Test limit and rollout switches, pressure switch, thermostat sequence, and record visible cabinet and duct condition.",
          photoPrompt: "Any safety concern"
        }
      ],

      /*
       * Mini-splits: no accessible static pressure and often no service ports,
       * so the airside and refrigerant checks change shape rather than being
       * skipped. Kept deliberately short -- a protocol that asks for readings a
       * technician cannot take is how "not applicable" becomes a habit.
       */
      hvac_minisplit: [
        {
          id: "hvac_airside",
          subsystem: "airflow",
          name: "Airside performance",
          prompt: "Return and supply air temperature at the indoor head. Clean the filters and the blower wheel as accessible.",
          guidance: "No duct static to measure on most mini-splits. Temperature split and the condition of the wheel and filters are what airflow means here.",
          readingFields: [
            { key: "returnDb", label: "Return air temperature", unit: "\u00b0F", required: true, placeholder: "At the head" },
            { key: "supplyDb", label: "Supply air temperature", unit: "\u00b0F", required: true, placeholder: "At the head" }
          ],
          derivedReading: "deltaT",
          photoPrompt: "Blower wheel and filters"
        },
        {
          id: "hvac_condenser",
          subsystem: "temperature",
          name: "Outdoor unit & heat transfer",
          prompt: "Outdoor ambient and liquid line temperature where a port or clamp point exists. Clean the accessible coil.",
          readingFields: [
            { key: "outdoorAir", label: "Outdoor air temperature", unit: "\u00b0F", required: true, placeholder: "Shaded" }
          ],
          derivedReading: "approach",
          photoPrompt: "Coil before and after cleaning"
        },
        {
          id: "hvac_electrical",
          subsystem: "electrical",
          name: "Electrical performance",
          prompt: "Running amps against the nameplate rating, plus connections and control board condition.",
          readingFields: [
            { key: "condenserAmps", label: "Running amps", unit: "A", required: true, placeholder: "Clamp" }
          ],
          derivedReading: "ampsOfRla",
          targetFrom: "condenserRla",
          photoPrompt: "Nameplate"
        },
        {
          id: "hvac_condensate",
          subsystem: "drainage",
          name: "Condensate & drainage",
          prompt: "Confirm the drain runs clear and any condensate pump operates. Check the line set penetration and insulation.",
          photoPrompt: "Drain and line set"
        },
        {
          id: "hvac_safety",
          subsystem: "safety",
          name: "Controls, modes & condition",
          prompt: "Verify heating and cooling modes, remote or control operation, and record visible condition of the head, line set and outdoor unit.",
          photoPrompt: "Any concern"
        }
      ],

    },
    /*
     * `measurementSets` and `maintenanceTasks` are GONE.          (v0.9.37)
     *
     * Both were defined here and read by nothing -- no screen, no test, no SQL
     * generator. They are the remains of the pre-v0.9.17 protocol design, when
     * a set of readings and a set of maintenance chips were declared per
     * category rather than per checkpoint.
     *
     * What replaced them:
     *   readings          `readingFields` on the checkpoint in `checkpointAnswers`,
     *                     so a reading belongs to the check it was taken on and
     *                     carries its own label, unit and required flag.
     *   maintenance work  `kind: "maintenance"` answers, which cannot move a
     *                     score -- the distinction that stopped "condenser
     *                     cleaned" appearing as a health vital.
     *
     * Deleting them matters beyond tidiness: `measurementSets.cooking` stated a
     * target of "Compare with set point" for oven accuracy, and the live
     * protocol has taken two numbers and trended the difference since v0.9.17.
     * A second, staler copy of a rule is how this project has produced most of
     * its real bugs, and this one was one edit away from being wired back up.
     */
    lifecycleTiers: {
      luxury: { id: "luxury", label: "Luxury", defaultYears: 15, examples: "Sub-Zero, Wolf, Cove, Miele, Thermador, True" },
      premium: { id: "premium", label: "Mass premium", defaultYears: 10, examples: "Bosch, KitchenAid, Monogram, Café, Fisher & Paykel, JennAir" },
      mass: { id: "mass", label: "Mass", defaultYears: 8, examples: "Whirlpool, Maytag, LG mainstream, GE mainstream, Samsung" }
    },
    /* =====================================================================
       EXPECTED SERVICE LIFE -- now sourced, not invented  (v0.9.17)
       =====================================================================

       These figures carry 25% of every health score, so where they came from
       matters as much as what they are. Until v0.9.17 every number in this
       table was mine: plausible, internally consistent, and evidence-free.
       They are now anchored to the published surveys, with the source recorded
       per row in `lifecycleSources` below so a customer question has an answer
       that is not "we thought so".

       WHAT THE COMPARISON FOUND, AND WHY IT MATTERED
       ----------------------------------------------
       My drafts skewed SHORT against the only large published survey -- by two
       to five years on dryers, hoods, washers and refrigeration. That is not a
       harmless error in this direction: a short expected life inflates "life
       used", which lowers the age score, which lowers the customer's number.
       The invented figures were quietly pessimistic about their equipment,
       which is the opposite of what this product is for.

       THE TIER RATIO IS SUPPORTED
       ---------------------------
       Published medians are all-comers -- they include equipment nobody ever
       maintained. Wilson's population is the opposite: serviced twice a year,
       mostly sold by Wilson. Carrier puts that difference at 15-20 years with
       annual maintenance against 10-12 without, which is roughly the spread
       between this table's mass and luxury columns. Sub-Zero states about 20
       years for its own refrigeration, which is exactly what the luxury
       refrigeration row says.

       THREE ROWS ARE STILL GUESSES, AND ARE MARKED AS SUCH
       ---------------------------------------------------
       Undercounter icemakers, built-in grills and mini-splits have no
       published service-life figure in any of these sources. They keep my
       estimates and `sourced: false`, which the report and the worksheets can
       surface as an open question. Wilson's own service history is what will
       eventually answer them -- every visit's readings and findings are already
       stored per appliance, so after two or three seasons this table can be
       rebuilt from Wilson's own equipment rather than from anybody's survey.
       ------------------------------------------------------------------ */
    /* ---------------------------------------------------------------------
       WATER HARDNESS -- A PROPERTY OF THE HOUSE, NOT OF AN APPLIANCE

       Cayden: "houses with hard water or heavy scale are going to have
       appliances fail faster if they have water... i think this is likely way
       more indicative of appliance life than a lot of smaller checks. house
       water is a MAJOR factor."

       He is right, and the shape of the fix follows from WHY he is right: scale
       does not tell you the dishwasher is unhealthy TODAY, it tells you the
       dishwasher will not last as long HERE. That is a statement about expected
       life, so that is where it goes -- never a condition deduction.

       WHY EXPECTED LIFE RATHER THAN A MULTIPLIER ON AGE
       -------------------------------------------------
       The two are arithmetically identical -- only the ratio reaches the score:

           (age x f) / expected   ==   age / (expected / f)

       So the choice is entirely about what the report SAYS, and three things
       decide it:

         1. Age stays a fact. It is on an invoice. Reporting a six-year-old
            dishwasher as "effectively nine" puts a number on the page that
            contradicts the paperwork in the customer's own file.
         2. It is a claim about the house and the equipment class, which is what
            it actually is -- not a claim about this unit's condition.
         3. It is REVERSIBLE. "A softener puts this back to 12 years" is an
            honest conversation that ends in the customer's favour. "Your
            appliance is aging faster" is a scare with nothing to do about it.

       WHERE THE NUMBERS COME FROM, AND WHAT THEY ARE NOT
       --------------------------------------------------
       The Battelle work for the Water Quality Research Foundation (2009) is the
       best evidence available and it does NOT publish a lifespan multiplier.
       What it measured, at 26 gpg against softened water:

         - gas storage water heater efficiency fell 21.3% over a 15-year life
         - scale accumulated ~75x faster (528 g/yr against 7 g/yr)
         - the electric heating element's life "is expected to be shortened"
           -- stated, not quantified
         - dishwashers and clothes washers showed visible scale on every
           interior surface after 30 days

       The factors below take the one hard number -- 21.3% over a service life at
       the study's hardness -- as a proxy for accelerated wear, and deliberately
       do not extrapolate past it. That makes them AN INFERENCE, flagged
       `sourced: false` exactly like the lifecycle rows nobody has published a
       figure for. Wilson's own service history will beat them: every visit
       already records hardness, scale observations and failures per appliance,
       so after a few seasons this table can be rebuilt from Wilson's houses.

       WHY IT IS WORTH MEASURING AT ALL IN THIS MARKET
       -----------------------------------------------
       It is not a constant across Wilson's customers. Austin city water runs
       about 4.9 gpg (moderately hard); Cedar Park is 10.2 and Round Rock 14.1,
       and Hill Country wells in that limestone go far higher. The strip is doing
       real work rather than applying a flat penalty to everybody.
       ------------------------------------------------------------------ */
    waterHardness: {
      /* Wilson's own note, printed wherever the adjustment is explained. */
      basis: "Adjustment inferred from the Battelle / Water Quality Research Foundation " +
             "softened-water study (2009), which measured a 21.3% water-heater efficiency loss " +
             "over a 15-year life and roughly 75x faster scale accumulation at 26 gpg. That study " +
             "does not publish an appliance lifespan multiplier; these factors are Wilson's " +
             "inference from it and are labelled as such on the report.",
      sourced: false,
      /*
       * ONE INPUT: THE NUMBER ON THE STRIP.
       *
       * Cayden, v0.9.22: "it should be a number we input off of test strips. And
       * then our algorithm should determine the multiplier. It shouldn't be
       * something the tech can select."
       *
       * He is right, and the version before this got it backwards. It had the
       * technician TAP A BAND, which meant tapping a multiplier -- the same
       * judgement call the rest of this tool works hard to take off the
       * technician's plate. A strip gives a number. The number is the input, the
       * factor is derived, and two technicians reading the same strip can no
       * longer produce two different expected lives.
       *
       * The softener question went with it, and it was double-counting anyway:
       * the strip is read at a tap, DOWNSTREAM of any softener, so a working
       * softener already shows up as a soft reading. Asking about the equipment
       * on top of that was asking the same question twice and then letting the
       * answers disagree.
       */

      /* DESCRIPTION ONLY -- these name a reading for the customer ("your water
         is hard"). They carry no arithmetic; nothing scores off a band. This is
         the Water Quality Association classification, which is also what a
         strip's colour chart is printed against. */
      bands: [
        { id: "soft",      max: 3.5,  label: "Soft / slightly hard",
          plain: "No scale adjustment" },
        { id: "moderate",  max: 7,    label: "Moderately hard",
          plain: "A small scale adjustment" },
        { id: "hard",      max: 10.5, label: "Hard",
          plain: "A noticeable scale adjustment" },
        { id: "very_hard", max: 15,   label: "Very hard",
          plain: "A significant scale adjustment" },
        { id: "extreme",   max: null, label: "Extremely hard",
          plain: "The largest scale adjustment Wilson applies" }
      ],

      /*
       * THE ALGORITHM. Piecewise linear between these anchors, flat outside them.
       *
       * Interpolated rather than stepped, and that changed with the input. While
       * the technician tapped a band, a step function was all the data
       * supported. Now that a real number arrives, a step would put a cliff in
       * the middle of the street: 10.5 gpg and 10.6 gpg are the same water, and
       * a band table would hand the second house 1.2 fewer years on a 15-year
       * dishwasher. Neighbours would get different answers off the same main.
       *
       * The two ends are where the honesty lives:
       *
       *   3.5 gpg and below -> 1.00. Soft water costs nothing at all.
       *   26 gpg and above  -> 0.72, FLAT. 26 is the hardness Battelle actually
       *                        measured. Past the evidence the curve stops
       *                        rather than continuing on confidence alone -- a
       *                        60 gpg well is reported as extremely hard and
       *                        adjusted no further than the study supports.
       */
      lifeFactorAnchors: [
        { gpg: 3.5,  factor: 1.00 },
        { gpg: 7,    factor: 0.95 },
        { gpg: 10.5, factor: 0.88 },
        { gpg: 15,   factor: 0.80 },
        { gpg: 26,   factor: 0.72 }
      ],
      /* At or above this band the customer's report carries a hardness flag.
         Below it the water is worth stating but not worth flagging. */
      customerFlagBand: "hard",
      /* Nothing potable reads this high. A number above it is a mis-key, and a
         mis-keyed reading is refused rather than banded -- a stray digit must
         not quietly become a finding about somebody's house. */
      maxPlausibleGpg: 100,
      /* Only equipment that runs water is adjusted. A dryer does not care how
         hard the water is, and quietly shortening its life would be inventing a
         mechanism. Keyed by checkpoint set. */
      waterBearingSets: ["refrigerator", "dishwasher", "icemaker", "washer", "laundry"],
      /* Never assumed from an address. No reading means no adjustment, and the
         report says the water has not been tested. */
      untestedFactor: 1.00
    },

    lifecycleMatrix: {
      /* NAHB standard refrigerator 13; Sub-Zero states ~20 for its own. */
      refrigerator: { luxury: 20, premium: 16, mass: 13 },
      /* NAHB dishwasher 9. */
      dishwasher: { luxury: 15, premium: 12, mass: 9 },
      /* NAHB gas range 15, electric range 13. */
      cooking: { luxury: 20, premium: 17, mass: 14 },
      /* No published figure -- Wilson estimate, unchanged and flagged. */
      icemaker: { luxury: 12, premium: 10, mass: 8 },
      /* NAHB washer 10. */
      washer: { luxury: 16, premium: 13, mass: 10 },
      /* NAHB dryer 13, gas and electric alike. */
      dryer: { luxury: 18, premium: 15, mass: 13 },
      // Combined laundry center / WashTower. Priced and inspected as two
      // appliances, so this row is a fallback rather than the usual path.
      laundry: { luxury: 16, premium: 14, mass: 11 },
      /* NAHB range/oven hood 14. */
      ventilation: { luxury: 18, premium: 16, mass: 14 },
      /* NAHB microwave oven 9. */
      microwave: { luxury: 12, premium: 10, mass: 9 },
      /* No published figure -- Wilson estimate, unchanged and flagged. */
      outdoor_grill: { luxury: 15, premium: 10, mass: 7 },
      /*
       * Built-in coffee. Added in v0.9.30 because it had no row and was falling
       * through to `generic`, which means "unclassified" rather than "an
       * estimate for coffee machines" -- and a coffee system was silently
       * getting the generic 15/12/9.
       *
       * There is no published service life for plumbed built-in coffee anywhere
       * in NAHB, ASHRAE or the DOE/AHRI consensus, and no Wilson field figure
       * beyond Miele's own row in `brandLifespans`. These columns are drafted
       * from that single data point and flagged unsourced.
       */
      coffee: { luxury: 10, premium: 9, mass: 7 },
      generic: { luxury: 15, premium: 12, mass: 9 },
      /* ASHRAE median 15 for a residential split system; DOE/AHRI 15; Carrier
         15-20 maintained against 10-12 unmaintained. Premium sits on the
         published median and the columns straddle it. */
      hvac_cooling: { luxury: 18, premium: 15, mass: 12 },
      /* ASHRAE residential air-to-air 15; DOE/AHRI 14. */
      hvac_heatpump: { luxury: 17, premium: 14, mass: 11 },
      /* ASHRAE gas/oil-fired furnace 18; DOE/AHRI 18. The old luxury figure
         here was 25, which is above every published number for any furnace --
         corrected down rather than defended. */
      hvac_furnace: { luxury: 22, premium: 18, mass: 15 },
      /* No published figure in ASHRAE, NAHB or the DOE/AHRI consensus -- none
         of them cover ductless. Wilson estimate, flagged. */
      hvac_minisplit: { luxury: 15, premium: 12, mass: 10 }
    },

    /* ---------------------------------------------------------------------
       WHERE EACH ROW CAME FROM

       Recorded so provenance travels with the number. `sourced: false` is the
       honest flag for a row that is still a Wilson estimate, and the worksheet
       and the report can both say so rather than presenting all fifteen rows
       with the same authority.
       ------------------------------------------------------------------ */
    /*
     * v0.9.30: THIS TABLE IS NOW THE FALLBACK, NOT THE ANSWER.
     *
     * `brandLifespans` wins wherever it has a brand-and-line row -- 86 of them,
     * covering everything Wilson sells. What is left below is what an appliance
     * gets when its brand is unknown, or when its category has no brand rows at
     * all (microwave, laundry centre, generic). The provenance still matters for
     * exactly that reason: an unrecognised brand should land on a published
     * median, not on a guess, and the report should be able to say which.
     */
    lifecycleSources: {
      refrigerator:   { sourced: true,  basis: "NAHB standard refrigerator 13 yr; Sub-Zero states about 20 yr for its own refrigeration", anchor: "mass" },
      dishwasher:     { sourced: true,  basis: "NAHB dishwasher 9 yr; mass column sits on the published median", anchor: "mass" },
      cooking:        { sourced: true,  basis: "NAHB gas range 15 yr, electric range 13 yr", anchor: "mass" },
      icemaker:       { sourced: false, basis: "No published service-life figure for undercounter icemakers -- Wilson estimate" },
      washer:         { sourced: true,  basis: "NAHB washer 10 yr; mass column sits on the published median", anchor: "mass" },
      dryer:          { sourced: true,  basis: "NAHB dryer 13 yr (gas and electric)", anchor: "mass" },
      laundry:        { sourced: false, basis: "Derived from the washer and dryer rows; a stacked unit is priced and inspected as two appliances" },
      ventilation:    { sourced: true,  basis: "NAHB range/oven hood 14 yr", anchor: "mass" },
      microwave:      { sourced: true,  basis: "NAHB microwave oven 9 yr; mass column sits on the published median", anchor: "mass" },
      outdoor_grill:  { sourced: false, basis: "No published figure for built-in outdoor grills -- Wilson estimate. Wilson's own figures assume a maintained grill, which the owner puts at about 5% of the field, so the customer-facing number is the field average rather than the cared-for one" },
      coffee:         { sourced: false, basis: "No published service-life figure for plumbed built-in coffee in NAHB, ASHRAE or DOE/AHRI. Drafted from the single Miele row in brandLifespans" },
      generic:        { sourced: false, basis: "Fallback only; an appliance landing here should be classified instead" },
      hvac_cooling:   { sourced: true,  basis: "ASHRAE median 15 yr residential split system; DOE/AHRI 15 yr; Carrier 15-20 yr maintained vs 10-12 yr unmaintained", anchor: "premium" },
      hvac_heatpump:  { sourced: true,  basis: "ASHRAE residential air-to-air 15 yr; DOE/AHRI 14 yr", anchor: "premium" },
      hvac_furnace:   { sourced: true,  basis: "ASHRAE gas/oil-fired furnace 18 yr; DOE/AHRI 18 yr", anchor: "premium" },
      hvac_minisplit: { sourced: false, basis: "Ductless equipment is absent from ASHRAE, NAHB and the DOE/AHRI consensus -- Wilson estimate" }
    },

    /*
     * These labels are printed on a customer's report as "Lifecycle stage",
     * and they are computed from AGE ALONE against a draft expected-life
     * figure. The last band used to read "Replacement Planning", which put a
     * replacement posture on a customer's report because an appliance had a
     * birthday -- no reading, no fault, no technician judgement, and no hint
     * that the life figure behind it is a draft. Every label now says what it
     * actually knows: where this appliance sits against a draft estimate.
     */
    lifecycleStages: [
      { maxRatio: 0.40, label: "Early life" },
      { maxRatio: 0.70, label: "Mid life" },
      { maxRatio: 0.90, label: "Late life" },
      { maxRatio: 999, label: "Past draft expected life" }
    ],
    brandTierDefaults: {
      "sub-zero": "luxury", "wolf": "luxury", "cove": "luxury", "miele": "luxury", "thermador": "luxury", "true": "luxury", "scotsman": "luxury", "hestan": "luxury", "kalamazoo": "luxury",
      /* v0.9.30: "subzero", "café" and "jenn-air" are gone from this table. They
         were spellings of keys already here, and a spelling belongs in
         `brandAliases` where normalizeBrand resolves it -- carrying them in two
         places is how the two copies drift. */
      "bosch": "premium", "kitchenaid": "premium", "monogram": "premium", "cafe": "premium", "fisher & paykel": "premium", "jennair": "premium", "speed queen": "premium",
      "whirlpool": "mass", "maytag": "mass", "ge": "mass", "lg": "mass", "hotpoint": "mass",
      "gladiator": "mass", "haier": "mass", "marvel": "mass", "u-line": "mass",

      /*
       * v0.9.30: SAMSUNG AND FRIGIDAIRE ARE GONE FROM THIS TABLE.
       *
       * Wilson does not sell or service either, nor Dacor or Electrolux. A tier
       * row is a statement that an appliance is inside the plan, so leaving them
       * here implied coverage that does not exist. They now live in
       * `notServicedBrands` below, where the tool can say so out loud instead of
       * quietly pricing a visit nobody can perform.
       *
       * The thirty brands added here and above were never mapped at all, so every
       * one of them fell to the "premium" default and inherited a lifecycle figure
       * nobody chose -- Gaggenau and U-Line both came back as 16 years.
       */
      "aga": "luxury", "alfresco": "luxury", "asko": "luxury", "bluestar": "luxury", "dcs": "luxury",
      "gaggenau": "luxury", "la cornue": "luxury", "liebherr": "luxury", "lynx": "luxury",
      "perlick": "luxury", "sks": "luxury", "viking": "luxury",
      "bertazzoni": "premium", "best": "premium", "blaze": "premium", "coyote": "premium",
      "elica": "premium", "evo": "premium", "faber": "premium", "fulgor": "premium",
      "trade wind": "premium", "zephyr": "premium",

      /*
       * v0.9.32. Brands Cayden confirmed Wilson sells that the original table
       * never listed. Tiers here are MINE -- see `tierDrafted` on the rows.
       */
      "twin eagles": "luxury", "fire magic": "luxury", "solaire": "luxury",
      "american outdoor grill": "premium", "summerset": "premium", "delta heat": "premium",
      "bull": "premium", "napoleon": "premium", "sharp": "premium", "broan": "mass",
      /*
       * v0.9.33. Cayden: "VAH 12 YEARS", then "PREMIUM".
       *
       * I had put it in luxury -- Texas-made, proprietary blower, alongside Wolf
       * and Thermador -- and he corrected it. His call, so this row is NOT in the
       * drafted-tier set. Worth one year: luxury would have turned his 12 into 15
       * rather than 14, which is exactly why whose call a tier is gets recorded.
       */
      "vent-a-hood": "premium",
      /*
       * Cayden: "WE ARE PICKING UP SMEG SOON BUT I DONT KNOW MUCH ABOUT IT YET.
       * GO WITH STANDARD FOR SMEG. ITS LIKE A PREMIUM LINE ID SAY."
       *
       * A tier and NOTHING ELSE. Smeg deliberately has no row in
       * `brandLifespans`, so it resolves to the published category median and the
       * report says the figure is a category median. Wilson has no field
       * experience with Smeg yet, and a fabricated field figure would be the one
       * kind of number this table exists to keep out.
       */
      "smeg": "premium",

      /*
       * HVAC brands. None were mapped, so every system silently fell to the
       * premium default and inherited a lifecycle figure nobody chose.
       *
       * DRAFT TIERING, and the most arguable table in this file. HVAC brand
       * ranking is contested among contractors, several of these names share a
       * parent company and a factory, and Wilson installs and services some of
       * them and not others. Whoever knows which of these actually last in
       * Hill Country service should overwrite this wholesale -- the point of
       * having it here is that the default is visible and editable rather than
       * hidden behind a fallback.
       */
      "trane": "luxury", "american standard": "luxury", "carrier": "luxury", "bryant": "premium",
      "lennox": "luxury", "daikin": "premium", "mitsubishi": "luxury", "mitsubishi electric": "luxury",
      "fujitsu": "premium", "bosch thermotechnology": "premium",
      "rheem": "premium", "ruud": "premium", "york": "premium", "coleman": "mass",
      "amana": "premium", "goodman": "mass", "payne": "mass", "tempstar": "mass",
      "heil": "mass", "ducane": "mass"
    },
    /*
     * =====================================================================
     * BRAND TIER IS NOT THE SAME THING AS BRAND LIFESPAN   (v0.9.30)
     * =====================================================================
     *
     * Until now one lookup did both jobs: brand picked a tier, and the tier
     * picked a column out of `lifecycleMatrix`. Cayden's own table shows why
     * that cannot hold.
     *
     *   - It is brand AND PRODUCT LINE specific. Miele is 15 on dish, 12 on
     *     refrigeration, 15 on cooking and 10 on coffee. One tier cannot say
     *     four different things.
     *   - Years and tier do not track each other. Speed Queen resolves to 17
     *     and True commercial to 23 without either being a luxury brand.
     *   - Amana is premium on the HVAC side and mass on the appliance side.
     *     A single brand->tier row has to be wrong about one of them.
     *
     * So there are now two lookups. `brandTierDefaults` still answers "what
     * kind of equipment is this", which drives protocol depth. `brandLifespans`
     * below answers "how long does this actually last", and where it has a row
     * it wins outright -- no tier indirection.
     *
     * WHERE THE NUMBERS CAME FROM
     * ---------------------------
     * Each row is the midpoint of two figures, rounded to the whole year:
     *
     *   `field`    -- Cayden's, from servicing this equipment in Hill Country
     *                 homes. He knows what fails early; he also asked that the
     *                 tool not rate on that alone.
     *   `anchored` -- `lifecycleMatrix[line][correct tier]`. One column per
     *                 category is anchored to the published survey (NAHB /
     *                 ASHRAE); the other two were offset from it here.
     *
     * Halves round UP, toward the longer life. A short expected life inflates
     * "life used", which lowers the age score, which lowers the customer's
     * number -- so the rounding error belongs on the side that does not cost
     * somebody points for arithmetic.
     *
     * Both inputs are kept on every row. A number whose two parents are visible
     * can be argued with; a single number cannot.
     *
     * THIS STILL MOVES THE SCORE, AND THAT IS NOT FULLY SOLVED.
     * -------------------------------------------------------
     * Expected life carries 25% of an appliance score through the age term, so
     * a brand row moves a customer's number even though `reportedNotScored`
     * promises brand never does. Averaging halved the effect rather than
     * removing it: two seven-year-old refrigerators measuring perfectly on
     * every check still differ by 5 points on the badge alone, down from 9 on
     * the raw field table. The mitigation in place is that no surface prints
     * the blend alone -- condition and life used are always beside it.
     * =====================================================================
     */
    /*
     * `sets` is how an APPLIANCE is recognised as belonging to this line.
     * `matrixSet` is which `lifecycleMatrix` row supplies the anchored figure.
     * They are usually the same key and are separate because coffee is not one:
     * a built-in coffee system runs the `generic` protocol, so it cannot be
     * recognised from its checkpoint set, but it does have its own matrix row.
     */
    applianceLines: {
      refrigeration:  { label: "Refrigeration", prose: "refrigeration",   sets: ["refrigerator"],   matrixSet: "refrigerator" },
      cooking:        { label: "Cooking", prose: "cooking appliances",         sets: ["cooking", "cooktop", "oven", "warming_drawer"], matrixSet: "cooking" },
      dishwashing:    { label: "Dish", prose: "dishwashers",            sets: ["dishwasher"],     matrixSet: "dishwasher" },
      laundry_washer: { label: "Washer", prose: "washers",          sets: ["washer"],         matrixSet: "washer" },
      laundry_dryer:  { label: "Dryer", prose: "dryers",           sets: ["dryer"],          matrixSet: "dryer" },
      ventilation:    { label: "Ventilation", prose: "vent hoods",     sets: ["ventilation"],    matrixSet: "ventilation" },
      ice:            { label: "Ice", prose: "icemakers",             sets: ["icemaker"],       matrixSet: "icemaker" },
      /*
       * This line began as MY inference: Cayden's original table never mentioned
       * microwaves, and it existed only so that "thermador 15y across all
       * product" could reach a speed oven. It is his now -- v0.9.32 added his
       * figures for Sharp, Viking, Monogram and LG, which is what turns an
       * inference into data.
       */
      microwave:      { label: "Microwave / speed oven", prose: "microwaves and speed ovens", sets: ["microwave"], matrixSet: "microwave" },
      grill:          { label: "Outdoor grill", prose: "outdoor grills",   sets: ["outdoor_grill"],  matrixSet: "outdoor_grill" },
      /* `generic` deliberately maps to NO line: it means "unclassified", and
         averaging a real figure against a fallback is averaging against
         nothing. Coffee is matched on the customer category and type instead. */
      coffee:         { label: "Built-in coffee", prose: "built-in coffee systems", sets: ["coffee"], categories: ["coffee"],
                        types: ["coffee_maker"], matrixSet: "coffee" }
    },

    /*
     * Aliases, because a brand arrives as whatever somebody typed or whatever
     * the invoice printed. Resolution is exact match, then alias, then
     * WHOLE-WORD containment -- never plain substring.
     *
     * Substring matching is what the old `tierForBrand` did, and it was wrong
     * in production: "gaggenau" contains "ge", so a EUR 25k range was being
     * scored as mass-market, and "fulgor" contains "lg", so Fulgor was too.
     * Neither would ever have shown up as an error -- just a quietly wrong
     * expected life on somebody's report.
     */
    brandAliases: {
      "subzero": "sub-zero", "sub zero": "sub-zero",
      "uline": "u-line", "u line": "u-line",
      "speedqueen": "speed queen",
      "cafe": "cafe", "caf\u00e9": "cafe", "ge cafe": "cafe",
      "jenn-air": "jennair", "jenn air": "jennair",
      "tradewind": "trade wind",
      "fisher and paykel": "fisher & paykel", "fisher paykel": "fisher & paykel", "f&p": "fisher & paykel",
      "ge appliances": "ge", "general electric": "ge",
      "lacornue": "la cornue",
      "bluestar": "bluestar", "blue star": "bluestar",
      "signature kitchen suite": "sks",
      "big green egg": "big green egg", "biggreenegg": "big green egg",
      "aog": "american outdoor grill", "american outdoor grills": "american outdoor grill",
      "twin eagle": "twin eagles", "firemagic": "fire magic", "fire-magic": "fire magic",
      "zline": "z-line", "thor kitchen": "thor", "iceomatic": "ice-o-matic",
      "green mountain grills": "green mountain", "gmg": "green mountain",
      "broan-nutone": "broan", "vent a hood": "vent-a-hood", "venta hood": "vent-a-hood",
      "ventahood": "vent-a-hood", "vah": "vent-a-hood"
    },

    /*
     * Tier overrides that depend on the product line.
     *
     * `"*"` means "any line", which for a brand that also appears in the HVAC
     * block reads as "every appliance line" -- an HVAC asset never passes a line
     * (they have no `applianceLines` entry), so it keeps the plain tier.
     */
    brandTierByLine: {
      amana: { "*": "mass" }
    },

    /*
* Expected service life, one row per line of Cayden's table.
     *
     * `field` is his figure. For a row naming a real line, `anchored` is the
     * lifecycleMatrix column it is averaged against and `years` is the resolved
     * midpoint, precomputed so the QA suite can recheck the arithmetic.
     *
     * `line: "*"` IS A BRAND-WIDE FIGURE and carries neither.
     * -----------------------------------------------------
     * Cayden wrote "thermador 15y across all product", "wolf 25y", "bosch 12".
     * The first version of this table expanded each of those into rows for the
     * lines I guessed the brand sells, which left holes -- a Thermador vent hood
     * fell straight through to the category median despite "across all product".
     * A wildcard row now says exactly what he said, and the line-specific
     * midpoint is computed at lookup against that line's own column. The same
     * brand-wide 15 therefore lands differently on a hood and on a range,
     * because the published figure behind each is different.
     *
     * A brand-wide row carries `covers`: the lines it is allowed to answer for.
     * Without it a wildcard answered on every line, which produced a figure for
     * an Asko outdoor grill and a Bertazzoni coffee system. Cayden: "ASKO DOESNT
     * HAVE GRILLS AND BERT DOESNT DO COFFEE." Unreachable in the tool -- no such
     * appliance will exist on a plan -- but this is a table of claims about what
     * Wilson sells, and a claim nobody would stand behind does not belong in it.
     * `coversDrafted: true` marks a coverage list I drafted from public
     * catalogues rather than one Cayden gave, so it can be corrected as data.
     * `tierDrafted: true` says the same about the row's tier, which moves the
     * anchored half of the average -- whose judgement a number rests on belongs
     * in the data, not in a comment.
     *
     * `noAnchorReason` marks a row whose field figure STANDS ALONE because no
     * published figure covers that equipment. Two cases:
     *
     *   Outdoor undercounter refrigeration and ice. NAHB's refrigerator row is
     *   indoor equipment. Averaging Cayden's 8 years for an outdoor fridge in
     *   Hill Country heat against the indoor luxury column produces 14 -- a
     *   number nobody who services them would defend, on a customer's report.
     *
     *   Miele coffee. The coffee columns here were drafted FROM that row, so
     *   averaging it against them is averaging a number against itself and
     *   calling the agreement corroboration.
     *
     * A `series` row is checked before its brand's plain row and matches on text
     * found in the model number or description. `tier` lives on the ROW rather
     * than the brand because GE Profile is a premium series of a mass brand.
     *
     * La Cornue has ONLY series rows: a Ch\u00e2teau is 23 and a Cornuf\u00e9 18, and a
     * La Cornue whose model nobody recorded falls back to the luxury cooking
     * column rather than being assigned one of the two. Guessing which range is
     * in somebody's kitchen is not better than saying the category figure.
     */
    brandLifespans: [
      { brand: "aga", line: "cooking", tier: "luxury", field: 20, tierDrafted: true, anchored: 20, years: 20 },
      { brand: "alfresco", line: "grill", tier: "luxury", field: 10, tierDrafted: true, anchored: 15, years: 13 },
      { brand: "alfresco", line: "ice", tier: "luxury", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "alfresco", line: "refrigeration", tier: "luxury", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "amana", line: "*", tier: "mass", field: 8, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "microwave"], coversDrafted: true, tierDrafted: true },
      { brand: "american outdoor grill", line: "grill", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "asko", line: "*", tier: "luxury", field: 15, covers: ["dishwashing", "laundry_washer", "laundry_dryer"], coversDrafted: true },
      { brand: "bertazzoni", line: "*", tier: "premium", field: 10, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave"], coversDrafted: true, tierDrafted: true },
      { brand: "best", line: "ventilation", tier: "premium", field: 15, tierDrafted: true, anchored: 16, years: 16 },
      { brand: "blaze", line: "grill", tier: "premium", field: 15, tierDrafted: true, anchored: 10, years: 13 },
      { brand: "blaze", line: "ice", tier: "premium", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "blaze", line: "refrigeration", tier: "premium", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "bluestar", line: "cooking", tier: "luxury", field: 20, tierDrafted: true, anchored: 20, years: 20 },
      { brand: "bluestar", line: "refrigeration", tier: "luxury", field: 12, tierDrafted: true, anchored: 20, years: 16 },
      { brand: "bluestar", line: "ventilation", tier: "luxury", field: 15, tierDrafted: true, anchored: 18, years: 17 },
      { brand: "bosch", line: "*", tier: "premium", field: 12, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "ventilation", "microwave", "coffee"], coversDrafted: true },
      { brand: "broan", line: "ventilation", tier: "mass", field: 12, tierDrafted: true, anchored: 14, years: 13 },
      { brand: "bull", line: "grill", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "cafe", line: "*", tier: "premium", field: 10, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "ventilation", "microwave", "ice", "coffee"], coversDrafted: true },
      { brand: "cove", line: "dishwashing", tier: "luxury", field: 15, anchored: 15, years: 15 },
      { brand: "coyote", line: "grill", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "coyote", line: "ice", tier: "premium", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "coyote", line: "refrigeration", tier: "premium", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "dcs", line: "grill", tier: "luxury", field: 15, tierDrafted: true, anchored: 15, years: 15 },
      { brand: "dcs", line: "ice", tier: "luxury", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "dcs", line: "refrigeration", tier: "luxury", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "delta heat", line: "grill", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "elica", line: "ventilation", tier: "premium", field: 10, tierDrafted: true, anchored: 16, years: 13 },
      { brand: "evo", line: "grill", tier: "premium", field: 15, tierDrafted: true, anchored: 10, years: 13 },
      { brand: "faber", line: "ventilation", tier: "premium", field: 10, tierDrafted: true, anchored: 16, years: 13 },
      { brand: "fire magic", line: "grill", tier: "luxury", field: 10, tierDrafted: true, anchored: 15, years: 13 },
      { brand: "fisher & paykel", line: "*", tier: "premium", field: 15, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "ventilation", "microwave"], coversDrafted: true },
      { brand: "fulgor", line: "*", tier: "premium", field: 15, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave"], coversDrafted: true, tierDrafted: true },
      { brand: "gaggenau", line: "*", tier: "luxury", field: 25, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave", "coffee"], coversDrafted: true, tierDrafted: true },
      { brand: "ge", line: "*", tier: "mass", field: 8, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "ventilation", "microwave", "ice"], coversDrafted: true },
      { brand: "ge", line: "*", series: { id: "profile", label: "Profile", match: ["profile"] }, tier: "premium", field: 10, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "ventilation", "microwave", "ice"], coversDrafted: true },
      { brand: "gladiator", line: "refrigeration", tier: "mass", field: 10, tierDrafted: true, anchored: 13, years: 12 },
      { brand: "haier", line: "*", tier: "mass", field: 8, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "microwave", "ice"], coversDrafted: true, tierDrafted: true },
      { brand: "hestan", line: "cooking", tier: "luxury", field: 12, anchored: 20, years: 16 },
      { brand: "hestan", line: "grill", tier: "luxury", field: 15, anchored: 15, years: 15 },
      { brand: "hestan", line: "refrigeration", tier: "luxury", field: 10, anchored: 20, years: 15 },
      { brand: "hestan", line: "ventilation", tier: "luxury", field: 12, anchored: 18, years: 15 },
      { brand: "hotpoint", line: "*", tier: "mass", field: 8, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "microwave"], coversDrafted: true },
      { brand: "jennair", line: "*", tier: "premium", field: 15, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave"], coversDrafted: true },
      { brand: "kalamazoo", line: "grill", tier: "luxury", field: 20, anchored: 15, years: 18 },
      { brand: "kalamazoo", line: "refrigeration", tier: "luxury", field: 12, environment: "outdoor", anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 12 },
      { brand: "kitchenaid", line: "*", tier: "premium", field: 12, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave", "ice"], coversDrafted: true },
      { brand: "kitchenaid", line: "refrigeration", series: { id: "builtin_refrigeration", label: "Built-in refrigeration", match: ["kbsn", "kbfn", "krbl", "krbr", "built-in", "built in"] }, tier: "premium", field: 15, anchored: 16, years: 16 },
      { brand: "la cornue", line: "cooking", series: { id: "chateau", label: "Château", match: ["chateau", "château"] }, tier: "luxury", field: 25, tierDrafted: true, anchored: 20, years: 23 },
      { brand: "la cornue", line: "cooking", series: { id: "cornufe", label: "Cornufé", match: ["cornufe", "cornufé"] }, tier: "luxury", field: 15, tierDrafted: true, anchored: 20, years: 18 },
      { brand: "lg", line: "cooking", tier: "mass", field: 10, anchored: 14, years: 12 },
      { brand: "lg", line: "dishwashing", tier: "mass", field: 8, anchored: 9, years: 9 },
      { brand: "lg", line: "laundry_dryer", tier: "mass", field: 10, anchored: 13, years: 12 },
      { brand: "lg", line: "laundry_washer", tier: "mass", field: 10, anchored: 10, years: 10 },
      { brand: "lg", line: "microwave", tier: "mass", field: 8, anchored: 9, years: 9 },
      { brand: "lg", line: "refrigeration", tier: "mass", field: 8, anchored: 13, years: 11 },
      { brand: "liebherr", line: "refrigeration", tier: "luxury", field: 12, tierDrafted: true, anchored: 20, years: 16 },
      { brand: "liebherr", line: "refrigeration", series: { id: "monolith", label: "Monolith", match: ["monolith", "mf ", "mrb", "mt "] }, tier: "luxury", field: 15, tierDrafted: true, anchored: 20, years: 18 },
      { brand: "lynx", line: "grill", tier: "luxury", field: 10, tierDrafted: true, anchored: 15, years: 13 },
      { brand: "lynx", line: "ice", tier: "luxury", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "lynx", line: "refrigeration", tier: "luxury", field: 8, environment: "outdoor", tierDrafted: true, anchored: null, noAnchorReason: "No published service-life figure covers outdoor undercounter equipment -- NAHB's refrigerator and icemaker rows are indoor machines. Wilson's field figure stands alone.", years: 8 },
      { brand: "marvel", line: "ice", tier: "mass", field: 8, anchored: 8, years: 8 },
      { brand: "marvel", line: "refrigeration", tier: "mass", field: 8, anchored: 13, years: 11 },
      { brand: "maytag", line: "*", tier: "mass", field: 8, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "microwave"], coversDrafted: true },
      { brand: "maytag", line: "laundry_washer", series: { id: "mtw8305", label: "MTW8305 commercial", match: ["mtw8305"] }, tier: "mass", field: 12, anchored: 10, years: 11 },
      { brand: "miele", line: "coffee", tier: "luxury", field: 10, anchored: null, noAnchorReason: "The coffee columns in lifecycleMatrix were drafted from this very row. Averaging a number against itself is not corroboration.", years: 10 },
      { brand: "miele", line: "cooking", tier: "luxury", field: 15, anchored: 20, years: 18 },
      { brand: "miele", line: "dishwashing", tier: "luxury", field: 15, anchored: 15, years: 15 },
      { brand: "miele", line: "laundry_dryer", tier: "luxury", field: 15, anchored: 18, years: 17 },
      { brand: "miele", line: "laundry_washer", tier: "luxury", field: 15, anchored: 16, years: 16 },
      { brand: "miele", line: "refrigeration", tier: "luxury", field: 12, anchored: 20, years: 16 },
      { brand: "miele", line: "ventilation", tier: "luxury", field: 15, anchored: 18, years: 17 },
      { brand: "monogram", line: "cooking", tier: "premium", field: 15, anchored: 17, years: 16 },
      { brand: "monogram", line: "dishwashing", tier: "premium", field: 10, anchored: 12, years: 11 },
      { brand: "monogram", line: "ice", tier: "premium", field: 10, anchored: 10, years: 10 },
      { brand: "monogram", line: "microwave", tier: "premium", field: 10, anchored: 10, years: 10 },
      { brand: "monogram", line: "refrigeration", tier: "premium", field: 10, anchored: 16, years: 13 },
      { brand: "monogram", line: "ventilation", tier: "premium", field: 10, anchored: 16, years: 13 },
      { brand: "napoleon", line: "grill", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "perlick", line: "ice", tier: "luxury", field: 12, tierDrafted: true, anchored: 12, years: 12 },
      { brand: "perlick", line: "refrigeration", tier: "luxury", field: 15, tierDrafted: true, anchored: 20, years: 18 },
      { brand: "scotsman", line: "ice", tier: "luxury", field: 10, anchored: 12, years: 11 },
      { brand: "sharp", line: "microwave", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "sks", line: "*", tier: "luxury", field: 15, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave", "ice"], coversDrafted: true, tierDrafted: true },
      { brand: "solaire", line: "grill", tier: "luxury", field: 10, tierDrafted: true, anchored: 15, years: 13 },
      { brand: "speed queen", line: "*", tier: "premium", field: 20, covers: ["laundry_washer", "laundry_dryer"], coversDrafted: true },
      { brand: "sub-zero", line: "ice", tier: "luxury", field: 10, anchored: 12, years: 11 },
      { brand: "sub-zero", line: "refrigeration", tier: "luxury", field: 25, anchored: 20, years: 23 },
      { brand: "summerset", line: "grill", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "thermador", line: "*", tier: "luxury", field: 15, covers: ["refrigeration", "cooking", "dishwashing", "ventilation", "microwave", "ice", "coffee"], coversDrafted: true },
      { brand: "trade wind", line: "ventilation", tier: "premium", field: 15, tierDrafted: true, anchored: 16, years: 16 },
      { brand: "true", line: "ice", tier: "luxury", field: 15, anchored: 12, years: 14 },
      { brand: "true", line: "refrigeration", tier: "luxury", field: 20, anchored: 20, years: 20 },
      { brand: "true", line: "refrigeration", series: { id: "commercial", label: "Commercial", match: ["commercial", "tuc-", "t-19", "t-23", "gdm-"] }, tier: "luxury", field: 25, anchored: 20, years: 23 },
      { brand: "twin eagles", line: "grill", tier: "luxury", field: 10, tierDrafted: true, anchored: 15, years: 13 },
      { brand: "u-line", line: "ice", tier: "mass", field: 8, anchored: 8, years: 8 },
      { brand: "u-line", line: "refrigeration", tier: "mass", field: 8, anchored: 13, years: 11 },
      { brand: "vent-a-hood", line: "ventilation", tier: "premium", field: 12, anchored: 16, years: 14 },
      { brand: "viking", line: "cooking", tier: "luxury", field: 15, tierDrafted: true, anchored: 20, years: 18 },
      { brand: "viking", line: "dishwashing", tier: "luxury", field: 10, tierDrafted: true, anchored: 15, years: 13 },
      { brand: "viking", line: "ice", tier: "luxury", field: 10, tierDrafted: true, anchored: 12, years: 11 },
      { brand: "viking", line: "microwave", tier: "luxury", field: 10, tierDrafted: true, anchored: 12, years: 11 },
      { brand: "viking", line: "refrigeration", tier: "luxury", field: 12, tierDrafted: true, anchored: 20, years: 16 },
      { brand: "viking", line: "ventilation", tier: "luxury", field: 10, tierDrafted: true, anchored: 18, years: 14 },
      { brand: "whirlpool", line: "*", tier: "mass", field: 8, covers: ["refrigeration", "cooking", "dishwashing", "laundry_washer", "laundry_dryer", "microwave", "ice"], coversDrafted: true },
      { brand: "wolf", line: "*", tier: "luxury", field: 25, covers: ["cooking", "ventilation", "microwave", "coffee", "grill"], coversDrafted: true },
      { brand: "zephyr", line: "ice", tier: "premium", field: 10, tierDrafted: true, anchored: 10, years: 10 },
      { brand: "zephyr", line: "refrigeration", tier: "premium", field: 10, tierDrafted: true, anchored: 16, years: 13 },
      { brand: "zephyr", line: "ventilation", tier: "premium", field: 15, tierDrafted: true, anchored: 16, years: 16 }
    ],

    /*
     * =====================================================================
     * TWO DIFFERENT REASONS AN APPLIANCE CANNOT GO ON A PLAN   (v0.9.30)
     * =====================================================================
     *
     * They are not the same and they must not share a sentence.
     *
     * `notServicedBrands` -- Wilson neither sells nor services it. There is
     *     nothing to offer and no protocol to run.
     *
     * `notMaintainable` -- Wilson sells it and would service it, but there is
     *     no maintenance to perform. A ceramic charcoal grill is the case:
     *     charging for a visit that does nothing is exactly what this product
     *     exists not to do. That is a better thing to tell a customer than a
     *     refusal, so it gets its own wording.
     *
     * Each carries the sentence every surface uses -- customer report, office
     * queue card, technician appliance card -- because "a guardrail all parties
     * can understand" means one string, not three explanations that agree.
     *
     * HVAC IS EXEMPT. Wilson services any HVAC brand, so nothing here is ever
     * consulted for a system. The HVAC rows in `brandTierDefaults` are a
     * lifecycle input and nothing more.
     */
    notServicedBrands: [
      { brand: "samsung",     label: "Samsung" },
      { brand: "dacor",       label: "Dacor" },
      { brand: "frigidaire",  label: "Frigidaire" },
      { brand: "electrolux",  label: "Electrolux" },

      /*
       * v0.9.32. Every name below was ruled out by Cayden by name. The list is
       * still an ALLOWLIST underneath -- a brand nobody has heard of resolves to
       * "unknown" and becomes an office question, not a silent acceptance. These
       * are here because they are the brands a customer is actually likely to
       * own and ask about, so the tool can answer straight away instead of
       * queueing a question whose answer is already known.
       */
      /* Wine cabinets. */
      { brand: "vinotemp",    label: "Vinotemp" },
      { brand: "eurocave",    label: "EuroCave" },
      { brand: "allavino",    label: "Allavino" },
      /* Commercial ice. */
      { brand: "hoshizaki",   label: "Hoshizaki" },
      { brand: "ice-o-matic", label: "Ice-O-Matic" },
      /* Cayden: "WE DONT SERVICE. FAKE LUXURY." Smeg is the one exception and is
         tiered above rather than listed here. */
      { brand: "ilve",        label: "ILVE" },
      { brand: "verona",      label: "Verona" },
      { brand: "lacanche",    label: "Lacanche" },
      { brand: "hallman",     label: "Hallman" },
      { brand: "z-line",      label: "Z-Line" },
      { brand: "thor",        label: "Thor Kitchen" },
      /*
       * Kamado and pellet. Cayden: "SKIP OTHER KAMODOS AND PELLET GRILLS AS
       * WELL. WE DONT SELL OR SERVICE THOSE BRANDS YOU LISTED."
       *
       * NOT the same bucket as Big Green Egg. BGE is `notMaintainable` -- Wilson
       * sells it and would service it, but a ceramic charcoal grill has no
       * maintenance to perform. These Wilson does not sell or service at all,
       * which is a different fact and gets the other sentence.
       */
      { brand: "kamado joe",  label: "Kamado Joe" },
      { brand: "primo",       label: "Primo" },
      { brand: "traeger",     label: "Traeger" },
      { brand: "memphis",     label: "Memphis Grills" },
      { brand: "green mountain", label: "Green Mountain Grills" }
    ],
    notMaintainable: [
      {
        brand: "big green egg", label: "Big Green Egg",
        /* Brand-level today because it is the only pure-charcoal line Wilson
           carries. The moment a second kamado shows up this wants to key on
           fuel type instead of a name. */
        because: "charcoal"
      }
    ],
    serviceabilityCopy: {
      not_serviced: {
        customer: "Not covered \u2014 we don't service this brand.",
        office:   "Not serviced. Take the appliance off the plan and adjust what was charged.",
        tech:     "Not serviced \u2014 no checks to run. Leave it and note anything you saw."
      },
      not_maintainable: {
        customer: "Not covered \u2014 there's no maintenance work to do on a charcoal grill, and we're not going to charge you for a visit that does nothing.",
        office:   "Nothing to maintain. Take it off the plan \u2014 this one is worth a call, not an email.",
        tech:     "Nothing to maintain on this one \u2014 no checks to run."
      },
      unknown_brand: {
        customer: "",
        office:   "Brand not on the serviced list. Confirm we cover it, then either add the brand or take the appliance off the plan.",
        tech:     "Brand not on our list. Run what you can and flag it \u2014 the office will confirm coverage."
      }
    },

    /*
     * =====================================================================
     * HVAC SCORING - THE PRINCIPLE
     * =====================================================================
     *
     * A health score answers ONE question: is this system delivering what it
     * was built to deliver? Not "is this the best equipment available", which
     * is a different question the customer already answered when they bought
     * it, and not one a maintenance visit gets to re-open.
     *
     * WHY THIS IS WRITTEN DOWN RATHER THAN ASSUMED
     * -------------------------------------------
     * measureQuick's score folds in efficiency and an age adjustment, so a
     * 13-SEER system in perfect condition grades below a 20-SEER system in
     * perfect condition. Both are doing exactly what they were designed to do.
     * Presenting that gap as a health deficit tells a customer their equipment
     * is unhealthy when what it actually is, is older -- and it converts a
     * maintenance report into a replacement quote.
     *
     * That is the opposite of what this business runs on. Wilson's replacement
     * pipeline comes from being the outfit that told people the truth for ten
     * years, including the years when the truth was "this is fine, leave it
     * alone". A tool that shaves points off a healthy system to create urgency
     * spends that reputation for a sale it would have got anyway, later, at
     * the right time.
     *
     * HOW THE PRINCIPLE IS MADE OPERATIONAL
     * ------------------------------------
     * Every target comes off the equipment's own nameplate, captured once into
     * the system's design profile: rated capacity, rated airflow, maximum
     * external static, rated load amps, temperature-rise range. The score is
     * then delivered-versus-plate, which is a measurement rather than a
     * comparison against the market.
     *
     * A system with no design profile on record is NOT scored against a
     * default. Its readings are recorded and reported, and the report says the
     * plate data is missing -- the same rule as an appliance with no
     * established age.
     *
     * WHERE EFFICIENCY GOES
     * --------------------
     * It is reported, because a customer paying the bill is entitled to know
     * what the system costs to run. It is reported as a FACT and against the
     * system's own rating -- "performing like a 13.6 SEER system against a
     * 14 SEER rating" is useful and true. It never enters the health grade.
     */
    hvacScoring: {
      /* Weights across the scored dimensions. Deliberately no efficiency term
         and no age term: age belongs in the planning horizon, where it is
         stated as age, and efficiency belongs in running cost. */
      dimensions: {
        capacity:  { id: "capacity",  label: "Capacity delivery",   weight: 0.30, note: "Heat actually moved, against the plate rating corrected for the day's conditions." },
        airflow:   { id: "airflow",   label: "Airflow",             weight: 0.20, note: "Against the equipment's rated airflow, not a rule of thumb." },
        charge:    { id: "charge",    label: "Refrigerant charge",  weight: 0.20, note: "Superheat and subcooling in the band for this metering device." },
        static:    { id: "static",    label: "Static pressure",     weight: 0.15, note: "Total external static against the plate maximum." },
        electrical:{ id: "electrical",label: "Electrical",          weight: 0.15, note: "Amp draw against nameplate rated load amps." }
      },

      /*
       * NOT scored. Kept explicit so nobody adds them back by accident.
       *
       * `reason` is the sentence the report uses when it explains why the
       * number is shown but did not move the grade.
       */
      reportedNotScored: {
        efficiency: {
          label: "Operating efficiency",
          reason: "Shown against this system's own rating so you can see what it costs to run. A system meeting its rating is healthy at any rating."
        },
        age: {
          label: "System age",
          reason: "Shown in the planning section. Age tells you what to expect and when; it is not a fault and does not reduce the health score."
        }
      },

      /*
       * Targets that are genuinely universal design values rather than market
       * comparisons. Everything else comes off the plate.
       *
       * Marked as drafts because the tech team has not signed them off. The
       * airflow scorer reads this flag and says "against a draft 350-450
       * band" wherever it reports its basis -- the flag used to be read by
       * nothing at all, so the comment below was describing an intention
       * rather than the code. Anything added here needs the same treatment.
       *
       * Historically: marked as drafts because the tech team has not signed them off, and
       * every surface that uses a draft target says so.
       */
      designDefaults: {
        cfmPerTonMin:   { value: 350, unit: "CFM/ton", draft: true, note: "Standard residential cooling design range is 350-450 CFM per ton, nominal 400." },
        cfmPerTonMax:   { value: 450, unit: "CFM/ton", draft: true },
        ampsOfRlaMax:   { value: 100, unit: "% of RLA", draft: false, note: "Definitional: nameplate rated load amps is the rated maximum." },
        staticOfRatedMax: { value: 100, unit: "% of rated ESP", draft: false, note: "Definitional: the plate states the maximum external static the blower is rated for." }
      },

      /*
       * The health grade needs no separate band table -- it shares the
       * appliance grade bands so one score means one thing across the whole
       * property. What HVAC adds is the planning horizon below.
       */
      sharesApplianceGradeBands: true
    },

    /*
     * THE DESIGN PROFILE - what the nameplate says this system is supposed to do.
     *
     * This is the whole mechanism behind "measured against its own design". Each
     * field is read off the equipment plate once and photographed, and every
     * scored target is derived from it. A 13-SEER three-ton unit is judged
     * against three tons and its own rated airflow and static, so meeting its
     * design is a full score at any rating.
     *
     * `scores` marks the fields a health score depends on. If any of them is
     * missing, that dimension is NOT scored and the report says the plate data
     * is missing -- it is never scored against a category default, which would
     * be the market comparison this design exists to avoid.
     */
    hvacDesignProfile: [
      { key: "ratedTons",      label: "Rated capacity",          unit: "tons",       scores: "capacity",   plate: true,  note: "From the model number or plate. The basis for every capacity figure." },
      { key: "ratedCfm",       label: "Rated airflow",           unit: "CFM",        scores: "airflow",    plate: true,  note: "Where the plate states it. Otherwise airflow is scored on CFM per ton against the design range." },
      { key: "maxEsp",         label: "Maximum external static", unit: "in wc",      scores: "static",     plate: true,  note: "The blower's rated maximum. Commonly 0.5 in wc on residential equipment, but read the plate." },
      { key: "condenserRla",   label: "Condenser rated load amps", unit: "A",        scores: "electrical", plate: true },
      { key: "blowerFla",      label: "Blower full load amps",   unit: "A",          scores: "electrical", plate: true },
      { key: "riseRangeLow",   label: "Temperature rise, low",   unit: "\u00b0F",     scores: "capacity",   plate: true,  note: "Gas furnaces only. The plate states the acceptable rise range; it is the design spec." },
      { key: "riseRangeHigh",  label: "Temperature rise, high",  unit: "\u00b0F",     scores: "capacity",   plate: true },
      { key: "refrigerant",    label: "Refrigerant",             unit: "",           scores: null,         plate: true,  note: "Needed to read saturation temperature off the gauge set. Not itself scored." },
      /* `scores` is deliberately empty. This field WILL gate the charge score once
         the superheat/subcooling bands are set -- the band depends on the metering
         device -- but scoreHealth does not read it today, and listing it as a
         blocker told technicians a score was waiting on something it was not. */
      { key: "meteringDevice", label: "Metering device",         unit: "",           scores: "",            plate: false, note: "TXV or fixed orifice. Will set which superheat band applies once those bands are agreed." },
      { key: "ratedSeer",      label: "Rated SEER / SEER2",      unit: "",           scores: null,         plate: true,  note: "Reported, never scored. It is what this system was sold as, and the efficiency figure is compared against it rather than against the market." },
      { key: "ratedAfue",      label: "Rated AFUE",              unit: "%",          scores: null,         plate: true,  note: "Gas furnaces. Reported, never scored." }
    ],

    /*
     * WHERE AN APPLIANCE'S AGE CAME FROM.
     *
     * Age drives a quarter of every health score, and until v0.9.12 nothing in
     * the product recorded where it came from -- `installYear` was never
     * populated by anything, so the technician typed a number from memory or
     * from what the customer remembered, and the score treated that guess
     * exactly as it would treat a dated invoice.
     *
     * Wilson sold most of these appliances to these customers. The invoice has
     * the date on it. So the age can usually be sourced, and where it cannot,
     * the report should say so rather than let a guess pass as a measurement.
     *
     * `documented` is the honesty flag: false means the number is somebody's
     * recollection, and every surface that shows a score built on it is expected
     * to say as much.
     */
    ageSources: {
      invoice: {
        id: "invoice", label: "Wilson sales invoice", short: "Wilson invoice",
        documented: true, rank: 1,
        note: "Install date taken from the Wilson invoice that sold this appliance."
      },
      customer: {
        id: "customer", label: "Customer stated", short: "Customer stated",
        documented: false, rank: 2,
        note: "Install year as given by the customer. Not verified against a document."
      },
      estimate: {
        id: "estimate", label: "Technician estimate", short: "Tech estimate",
        documented: false, rank: 3,
        note: "Age estimated in the field from the appliance itself. Not verified against a document."
      },
      unknown: {
        id: "unknown", label: "Not established", short: "Not established",
        documented: false, rank: 4,
        note: "No install date on record. Lifecycle figures are not calculated without one."
      }
    },
    /* =====================================================================
       ANSWER KINDS -- what a check produces, and whether it may touch a score
       =====================================================================

       Until v0.9.17 every checkpoint was one thing: a 1-5 rating, optionally
       with a reading beside it. That single shape caused three separate
       problems, and this block is the fix for all three.

       1. WORK PERFORMED WAS SCORED AS HEALTH. "Maintenance clean cycle" and
          "Bin condition & cleaning" are things Wilson DID, not measurements of
          how the appliance is doing -- and a 5/5 on them lifted the customer's
          health score. Cleaning a condenser cannot make a compressor healthier.
          The useful health metric is what the appliance does AFTER the
          condenser is clean.

       2. A JUDGEMENT WORE A NUMBER'S CLOTHES. One technician's 4/5 on an
          evaporator frost pattern is another's 3/5, and the customer cannot
          tell which. A frost pattern has categories -- even, partial, iced,
          none-while-cooling -- and naming the category is both more honest and
          faster to tap than choosing between five numbers that mean nothing.

       3. A READING WITH NO AGREED BAND HAD NOWHERE TO GO. It was either
          published as a judgement or left as a number nobody could interpret.
          "Recorded -- building this appliance's baseline" is the truthful third
          answer, and it is what makes the second and third visit worth buying.

       The rule that matters: ONLY `scores: true` kinds may contribute to a
       health score. Everything else is reported, and reported separately.
       ------------------------------------------------------------------ */
    answerKinds: {
      scored: {
        id: "scored", label: "Measured", scores: true,
        blurb: "A reading or a count with a stated target. This is what the health score is made of."
      },
      trend: {
        id: "trend", label: "Recorded", scores: false,
        blurb: "A real measurement with no agreed band yet. Recorded and compared with this appliance's own history, never scored against a number nobody has signed off."
      },
      /*
       * v0.9.19: a condition SCORES -- through an anchored option.
       *
       * It did not, and the reason was inter-technician variance: one tech's
       * 4/5 frost pattern is another's 3/5. Cayden's counter, from the field:
       * "if i note that the ice pattern is cloudy or incomplete, that usually
       * means theres an issue. it should probably effect the health score."
       *
       * He is right, and refusing to score was the wrong answer to the right
       * objection. Cloudy ice is not an aesthetic opinion -- it is scale, water
       * quality, or a refrigeration problem, and a report that shrugs at it is
       * the "pencil-whipped service report" this product exists not to be.
       *
       * What actually fixes the variance is anchoring: every option names
       * observable evidence and carries its own published score, shown on the
       * button. The judgement moves out of the technician's head and into a
       * config file anyone can review. See observationSets.
       */
      observed: {
        id: "observed", label: "Condition", scores: true,
        blurb: "A named condition with a published score. You can see what each answer is worth before you tap it, and dirt is never a deduction."
      },
      maintenance: {
        id: "maintenance", label: "Maintenance performed", scores: false,
        blurb: "Work Wilson did. It tells the customer what their money bought and it cannot move a health score."
      }
    },

    /* ---------------------------------------------------------------------
       CONTROLS -- how a technician answers, and why almost none of it is typing

       A technician is holding a phone one-handed, in front of an appliance,
       often in bad light. Every control here is a tap except `keypad`, which is
       three taps for "37.4" on an in-app number pad rather than a fight with
       the OS keyboard.

       Deliberately NOT a slider anywhere. A 390px slider across a 15-degree
       band is about 11px per degree with a thumb error of two, and -- the part
       that matters -- a slider always has a value, so there is no difference
       between "I measured 37" and "I dragged it to the middle". For a product
       whose whole claim is a reading you can defend, an unanswered reading has
       to be able to look unanswered.
       ------------------------------------------------------------------ */
    answerControls: {
      keypad:   { id: "keypad",   label: "Number pad",   typing: false },
      stepper:  { id: "stepper",  label: "Plus / minus", typing: false },
      category: { id: "category", label: "Pick one",     typing: false },
      count:    { id: "count",    label: "X of Y",       typing: false },
      passfail: { id: "passfail", label: "Pass / fail",  typing: false },
      /* v0.9.39, the field team's standard: three buttons, one vocabulary,
         scores on their faces. Concern and fail demand the reason. */
      verdict:  { id: "verdict",  label: "Pass / concern / fail", typing: false },
      rating:   { id: "rating",   label: "1-5 rating",   typing: false },
      chips:    { id: "chips",    label: "Tap what you did", typing: false }
    },

    /* ---------------------------------------------------------------------
       CONDITION VOCABULARIES -- ANCHORED, AND SCORED.

       These were "observations": recorded, printed, and deliberately kept out
       of the health score, because one technician's 4/5 frost pattern is
       another's 3/5 and the customer cannot tell which.

       Cayden pushed back after using the tool on an icemaker: "if i note that
       the ice pattern is cloudy or incomplete, that usually means theres an
       issue. it should probably effect the health score." He is right, and the
       fix he proposed is the one that resolves the original objection --
       "predefined scores for observables, where its clear to the tech what to
       click so we get mostly consistent results."

       So the variance problem is not solved by refusing to score. It is solved
       by removing the judgement from the SCALE and putting it in the OPTION:

         - Every option below names OBSERVABLE EVIDENCE, not a quality. "Cloudy
           or incomplete cubes" is a thing two people can agree they are looking
           at. "Ice quality: 3/5" is not.
         - Every option carries an explicit `score`. It is written here, in one
           place, reviewable -- not derived from a regex over its result text,
           and not decided in the technician's head.
         - The score is SHOWN on the button in the field tool, so a technician
           can see what their answer is worth before they tap it.
         - `score: null` means this answer scores nothing. "Not accessible" is
           an honest answer, never a failure.

       There is one generic set left (`accessible_condition`) and it is used only
       where the appliance has no protocol of its own. The old three-way "Good /
       Wear noted / Needs attention" is gone from everywhere else: it was the
       same unanchored judgement the 1-5 scale was, with fewer choices.

       WHAT DOES NOT COST A CUSTOMER ANYTHING
       --------------------------------------
       Dirt is not a defect. Every "cleaned at this visit" and "cosmetic marks
       only" option below scores 5 -- the same as pristine -- because Wilson does
       not dock a customer for the state their appliance was in before the
       technician arrived. That rule is now visible on the button rather than
       buried in a config comment, which is the point.

       ONE MORE THING THAT MAKES THIS DEFENSIBLE
       -----------------------------------------
       Wilson runs geographical zones, so the same technician usually returns to
       the same house. The comparison that matters most is this appliance against
       its own history, read by the same pair of eyes -- and that is the
       comparison anchored options make reliable. When a zone changes hands, the
       anchors are what stop the score stepping.
       ------------------------------------------------------------------ */
    observationSets: {
      /* =================================================================
         THE VERDICT                                             (v0.9.39)
         =================================================================
         One vocabulary for every appliance health check, from the field
         team: pass 5, cause for concern 3, fail 1. `noteRequired` is what
         makes "prompts for a note as to why" a rule of the data rather than
         a habit of the technician -- a concern or fail without its reason
         is an unfinished check, and the tool will not complete the
         appliance around it. "Not applicable" is not here: it is the
         per-check N/A affordance, which never scores. */
      verdict: [
        { code: "pass",    label: "Pass",              result: "Pass",              score: 5 },
        { code: "concern", label: "Cause for concern", result: "Cause for concern", score: 3, attention: true, noteRequired: true },
        { code: "fail",    label: "Fail",              result: "Fail",              score: 1, attention: true, noteRequired: true }
      ],

      /* --- refrigeration: the evaporator tells you about airflow and charge - */
      /*
       * Cayden, on what a frost pattern actually tells you: "Any indications on
       * the frost pattern that there is a leak mean major failure. If there is
       * oily refrigerant residue, bad, if there is an iceball scenario at a
       * certain point on the evap, also bad, theres a hole there."
       *
       * So the leak indicators score 1, not 3 -- they are not "abnormal", they
       * are a sealed-system failure. Heavy frost all over went the other way, to
       * a 3, because that is a defrost or airflow problem rather than a hole.
       * The oily-residue option is new; it is the clearest leak sign there is
       * and the sheet had nowhere to record it.
       */
      frost: [
        { code: "even",      label: "Even frost across the active coil",     result: "Normal",                  score: 5 },
        { code: "partial",   label: "Patchy frost, or an ice ball at one spot", result: "Sealed system leak likely", score: 1, attention: true },
        { code: "oily",      label: "Oily residue on the coil or lines",     result: "Sealed system leak likely", score: 1, attention: true },
        { code: "iced",      label: "Heavy frost or ice build-up",           result: "Restricted airflow",      score: 3, attention: true },
        { code: "none",      label: "No frost while the compressor runs",    result: "Abnormal pattern",        score: 1, attention: true },
        { code: "no_access", label: "Evaporator not accessible",             result: "Not inspected",           score: null }
      ],

      /*
       * EVAPORATOR / COLD PLATE. Cayden: "this is why we inspect the evap on
       * icemakers during maint. anything with an evaporator should have its evap
       * or cold plate inspected during maint."
       *
       * Scored on the same logic as the refrigeration frost pattern, because it
       * is the same physics: scale is the mechanism behind cloudy ice, and
       * uneven freezing or oily residue means a hole.
       */
      plate_condition: [
        { code: "even",      label: "Even freeze across the plate, no residue", result: "Normal",               score: 5 },
        { code: "scale",     label: "Scale or mineral build-up on the plate", result: "Scale present",          score: 3, attention: true },
        { code: "uneven",    label: "Uneven freezing, or ice ball at one spot", result: "Sealed system leak likely", score: 1, attention: true },
        { code: "oily",      label: "Oily residue on the plate, coil or lines", result: "Sealed system leak likely", score: 1, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /*
       * EVAPORATOR AIRFLOW. Cayden: "This should be changed to just airflow.
       * Filter status doesn't matter. No good way to measure airflow. If the
       * fans are running they are running. The only restriction would come from
       * a frozen up damper or evaporator."
       *
       * So the check stopped pretending to grade airflow and asks the two things
       * a technician can actually establish. The filters moved to where they
       * belong: the maintenance chips.
       */
      airflow_condition: [
        { code: "running",   label: "Fans running, no restriction found",    result: "Normal",                  score: 5 },
        { code: "restricted",label: "Running but restricted -- iced damper or evaporator", result: "Restricted airflow", score: 2, attention: true },
        { code: "stopped",   label: "A fan is not running",                  result: "Fail",                    score: 1, attention: true },
        { code: "no_access", label: "Could not verify",                      result: "Not tested",              score: null }
      ],

      /*
       * COMPONENTS AND OPERATING SOUND. Cayden: "sound should be flagged,
       * notated and customer made aware if they arent already. Probably a
       * failing component that needs a service call outside of the maint check."
       *
       * It was a bare 1-5 rating -- the last unanchored judgement in the
       * refrigeration protocol -- so two technicians hearing the same compressor
       * could file different numbers. Named answers instead, and an abnormal
       * sound raises a finding rather than only lowering a score.
       */
      sound_components: [
        { code: "normal",    label: "All components run, no abnormal sound", result: "Normal",                  score: 5 },
        { code: "minor",     label: "Running, minor noise, no change since last visit", result: "Normal",       score: 4 },
        { code: "abnormal",  label: "Abnormal sound -- likely a failing component", result: "Needs attention",   score: 2, attention: true },
        { code: "notrun",    label: "A component would not run",             result: "Fail",                    score: 1, attention: true },
        { code: "no_access", label: "Could not run them",                    result: "Not tested",              score: null }
      ],

      /* --- icemakers: the ice IS the diagnostic ---------------------------- */
      ice_pattern: [
        { code: "normal",    label: "Full, clear cubes at normal rate",      result: "Normal",                  score: 5 },
        { code: "partial",   label: "Cloudy or incomplete cubes",            result: "Abnormal",                score: 3, attention: true },
        { code: "slow",      label: "Hollow, small, or very slow",           result: "Below normal production", score: 2, attention: true },
        { code: "none",      label: "Not producing ice",                     result: "Not producing",           score: 1, attention: true },
        { code: "not_seen",  label: "No freeze cycle seen this visit",       result: "Not observed",            score: null }
      ],
      bin_condition: [
        { code: "sound",     label: "Liner sound, surfaces clean",           result: "Normal",                  score: 5 },
        { code: "cleaned",   label: "Cleaned at this visit, liner sound",    result: "Normal",                  score: 5 },
        { code: "damaged",   label: "Liner cracked, or mould in the seams",  result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- microwave: cosmetic marks are free, arcing is not --------------- */
      cavity: [
        { code: "clean",     label: "Clean, no damage",                      result: "Normal",                  score: 5 },
        { code: "wear",      label: "Cosmetic marks only",                   result: "Normal, cosmetic",        score: 5 },
        { code: "arcing",    label: "Arcing marks, burns, or damaged cover", result: "Needs attention",         score: 1, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- ovens: a seal either seals or it does not ----------------------- */
      seal_condition: [
        { code: "good",      label: "Pliable and sealing all round",         result: "Normal",                  score: 5 },
        { code: "hardened",  label: "Hardened or flattened, still sealing",  result: "Wear noted",              score: 3, attention: true },
        { code: "failed",    label: "Torn, gapped, or missing sections",     result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- dishwasher sump: debris is free, damage is not ------------------ */
      sump_condition: [
        { code: "clear",     label: "Clear, filter intact",                  result: "Normal",                  score: 5 },
        { code: "debris",    label: "Debris only -- cleaned at this visit",  result: "Normal",                  score: 5 },
        { code: "damaged",   label: "Filter torn, or objects in the sump",   result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- washer door boot: the most common real finding on a front loader */
      boot_condition: [
        { code: "good",      label: "Boot intact, no damage",                result: "Normal",                  score: 5 },
        { code: "residue",   label: "Residue only -- cleaned at this visit", result: "Normal",                  score: 5 },
        { code: "damaged",   label: "Perforated, torn, or mould in folds",   result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- dryer lint path: a restricted transition is a fire risk -------- */
      lint_condition: [
        { code: "clear",     label: "Screen, housing and transition clear",  result: "Normal",                  score: 5 },
        { code: "buildup",   label: "Build-up only -- cleaned at this visit",result: "Normal",                  score: 5 },
        { code: "restricted",label: "Transition crushed, kinked, or off",    result: "Needs attention",         score: 1, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- cooktop surface: cracked glass is not cosmetic (v0.9.37) --------
         Marks and discolouration on a cooking surface are free -- this product
         never scores an appliance down for looking used. A crack in ceramic
         glass is a different thing: it is a route for spills into the element
         bay and the reason these get replaced. */
      cooktop_surface_condition: [
        { code: "good",      label: "Surface, grates and igniters sound",    result: "Normal",                  score: 5 },
        { code: "wear",      label: "Cosmetic marks or discolouration only", result: "Normal, cosmetic",        score: 5 },
        { code: "cleaned",   label: "Igniter ports fouled -- cleared at this visit", result: "Normal",          score: 5 },
        { code: "worn",      label: "Grates or burner caps corroded or damaged", result: "Wear noted",          score: 3, attention: true },
        { code: "cracked",   label: "Glass cracked, or a zone will not detect", result: "Needs attention",      score: 1, attention: true },
        { code: "no_access", label: "Could not inspect",                     result: "Not inspected",           score: null }
      ],

      /* --- built-in coffee (v0.9.37, DRAFT) --------------------------------
         Four sets, one per subsystem that can actually fail. Wilson's cleaning
         is folded into the "normal" states the same way it is on the sump, the
         boot and the lint path: an appliance that was dirty and is now clean is
         a normal appliance, and nothing here is scored down for how it looked
         before the technician arrived. */
      grinder_condition: [
        { code: "clean",     label: "Grinds cleanly, dose consistent",       result: "Normal",                  score: 5 },
        { code: "cleared",   label: "Chute fouled -- cleared at this visit", result: "Normal",                  score: 5 },
        { code: "worn",      label: "Grind coarse or inconsistent, burrs worn", result: "Wear noted",           score: 3, attention: true },
        { code: "noise",     label: "Metal-on-metal or will not complete a grind", result: "Needs attention",   score: 1, attention: true },
        { code: "no_access", label: "Could not run it",                      result: "Not tested",              score: null }
      ],
      brew_group_condition: [
        { code: "good",      label: "Seals pliable, moves freely, screen clear", result: "Normal",              score: 5 },
        { code: "cleaned",   label: "Grounds packed in -- cleaned at this visit", result: "Normal",             score: 5 },
        { code: "hardened",  label: "Seals hardened or stiff travel",        result: "Wear noted",              score: 3, attention: true },
        { code: "leaking",   label: "Leaking past the seals, or will not seat", result: "Needs attention",      score: 1, attention: true },
        { code: "no_access", label: "Fixed unit, not reachable",             result: "Not inspected",           score: null }
      ],
      milk_circuit_condition: [
        { code: "clean",     label: "Lines and frother clear, no odour",     result: "Normal",                  score: 5 },
        { code: "rinsed",    label: "Film present -- rinsed at this visit",  result: "Normal",                  score: 5 },
        { code: "soured",    label: "Souring smell or film that did not rinse out", result: "Needs attention",  score: 2, attention: true },
        /* Deliberately the harshest state in the coffee protocol. This is a
           food-contact path and visible growth is not a maintenance note. */
        { code: "growth",    label: "Visible growth inside the line or frother", result: "Needs attention",     score: 1, attention: true },
        { code: "none",      label: "No milk system on this machine",        result: "Not applicable",          score: null }
      ],
      scale_condition: [
        { code: "clear",     label: "No visible scale, counter not due",     result: "Normal",                  score: 5 },
        { code: "descaled",  label: "Descale run at this visit",             result: "Normal",                  score: 5 },
        { code: "due",       label: "Descale indicated or counter due",      result: "Due",                     score: 3, attention: true },
        { code: "heavy",     label: "Heavy scale on the visible water path", result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "No indicator and nothing visible",      result: "Not inspected",           score: null }
      ],

      /* --- vent hood ------------------------------------------------------- */
      baffle_condition: [
        { code: "clean",     label: "Clean and undamaged",                   result: "Normal",                  score: 5 },
        { code: "saturated", label: "Grease-laden -- cleaned at this visit", result: "Normal",                  score: 5 },
        { code: "damaged",   label: "Deformed, split, or missing",           result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],
      sound_condition: [
        { code: "quiet",     label: "Quiet and steady at every speed",       result: "Normal",                  score: 5 },
        { code: "audible",   label: "Audible but steady",                    result: "Normal",                  score: 4 },
        { code: "abnormal",  label: "Bearing whine, rattle, or vibration",   result: "Needs attention",         score: 2, attention: true },
        { code: "not_run",   label: "Not run at this visit",                 result: "Not observed",            score: null }
      ],
      grease_condition: [
        { code: "clean",     label: "Duct entry clean",                      result: "Normal",                  score: 5 },
        { code: "removed",   label: "Accumulation removed at this visit",    result: "Normal",                  score: 5 },
        { code: "beyond",    label: "Heavy build-up beyond reach",           result: "Duct cleaning recommended", score: 3, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ],

      /* --- outdoor grill: documented, never cleaned by Wilson. There is no
             "dirty" option on purpose -- a used grill is a dirty grill, and it
             is not a finding. Burn-through is. -------------------------------- */
      grill_condition: [
        { code: "serviceable", label: "Grates, burners and firebox sound",   result: "Normal",                  score: 5 },
        { code: "worn",        label: "Heavy corrosion, still functional",   result: "Wear noted",              score: 3, attention: true },
        { code: "failed",      label: "Burn-through, cracked box, or failed grates", result: "Needs attention",  score: 1, attention: true },
        { code: "no_access",   label: "Not accessible",                      result: "Not inspected",           score: null }
      ],

      /* --- furnace -------------------------------------------------------- */
      flame_condition: [
        { code: "clean",     label: "Immediate ignition, clean blue flame",  result: "Normal",                  score: 5 },
        { code: "lazy",      label: "Delayed ignition or lazy yellow flame", result: "Needs attention",         score: 2, attention: true },
        { code: "fail",      label: "Rollout, sooting, or failure to light", result: "Needs attention",         score: 1, attention: true },
        { code: "not_obs",   label: "Not observed",                          result: "Not observed",            score: null }
      ],
      heatex: [
        { code: "clean",     label: "No cracks or scaling seen",             result: "Nothing seen",            score: 5 },
        { code: "scale",     label: "Surface scaling or rust, no crack",     result: "Wear noted",              score: 3, attention: true },
        { code: "suspect",   label: "Suspect -- diagnostic recommended",     result: "Diagnostic recommended",  score: 1, attention: true },
        { code: "no_access", label: "Not visible without teardown",          result: "Not inspected",           score: null }
      ],

      /* --- the generic one, for an appliance with no protocol of its own --- */
      accessible_condition: [
        { code: "good",      label: "Clear and undamaged",                   result: "Normal",                  score: 5 },
        { code: "serviced",  label: "Build-up only -- cleaned at this visit",result: "Normal",                  score: 5 },
        { code: "damaged",   label: "Damage or a functional defect found",   result: "Needs attention",         score: 2, attention: true },
        { code: "no_access", label: "Not accessible",                        result: "Not inspected",           score: null }
      ]
    },

    /* ---------------------------------------------------------------------
       PASS / FAIL vocabularies. Binary and repeatable, which is the whole
       point: "6 of 6 burners ignite" cannot be argued with, and "burner
       performance 4/5" cannot be defended.
       ------------------------------------------------------------------ */
    /*
     * EVERY OPTION LIST CARRIES ITS OWN WAY OUT.
     *
     * These were two-option lists -- Dry / Leak found, All operate / Fault
     * found -- and a base panel that will not come off left a technician with
     * a guess or a blank check. The separate N/A button is not the same answer:
     * "this unit does not have one" and "it has one and I could not get to it"
     * are different facts, and the second one is the one a customer needs to
     * hear, because it is the reason the check is not on their report.
     *
     * "Not tested" scores nothing -- see RESULT_SCORE in tech-answers.js. It is
     * deliberately not a failure.
     */
    passFailSets: {
      /*
       * Anchored, exactly like the condition sets above.
       *
       * These scores used to be derived by running a regex over each option's
       * `result` text -- /^pass$/ was 5, /^(slow|codes stored|wear)/ was 3. It
       * worked, and it meant the score of an answer depended on how its label
       * was WORDED: rename "Slow" to "Sluggish" and it silently stops being a 3
       * and starts being unscored. The number lives on the option now.
       */
      leak:      [{ code: "dry", label: "Dry", result: "Pass", score: 5 },
                  { code: "wet", label: "Leak found", result: "Fail", score: 1, attention: true },
                  { code: "no_access", label: "Could not see the area", result: "Not tested", score: null }],
      codes:     [{ code: "none", label: "No stored codes", result: "Pass", score: 5 },
                  /* requiresDetail: the code itself is the only part of this
                     anybody can act on. Announcing "codes present" and
                     throwing away the code is worse than not checking. */
                  { code: "codes", label: "Codes present", result: "Codes stored", score: 3, attention: true, requiresDetail: "code" },
                  { code: "no_access", label: "Not accessible on this model", result: "Not tested", score: null }],
      operating: [{ code: "yes", label: "Operating", result: "Pass", score: 5 },
                  { code: "no", label: "Not operating", result: "Fail", score: 1, attention: true },
                  { code: "no_access", label: "Could not test it", result: "Not tested", score: null }],
      drain:     [{ code: "full", label: "Drains fully", result: "Pass", score: 5 },
                  { code: "slow", label: "Slow", result: "Slow", score: 3, attention: true },
                  { code: "none", label: "Does not drain", result: "Fail", score: 1, attention: true },
                  { code: "no_access", label: "Could not test it", result: "Not tested", score: null }],
      safety:    [{ code: "pass", label: "All operate", result: "Pass", score: 5 },
                  { code: "fail", label: "Fault found", result: "Fail", score: 1, attention: true },
                  { code: "no_access", label: "Could not test it", result: "Not tested", score: null }],
      /* Kept for the record: no checkpoint uses this any more. Work performed
         is collected on the maintenance chips, which cannot score at all -- see
         v0.9.18. Unscored on purpose, so re-attaching it to a checkpoint fails
         the audit rather than quietly scoring Wilson's own work. */
      done:      [{ code: "done", label: "Completed at this visit", result: "Completed", score: null },
                  { code: "partial", label: "Partly done", result: "Partly completed", score: null },
                  { code: "skipped", label: "Not done this visit", result: "Not done", score: null },
                  { code: "na", label: "Not applicable to this unit", result: "Not applicable", score: null }]
    },

    /* ---------------------------------------------------------------------
       WHAT EACH CHECK ACTUALLY PRODUCES

       Keyed "<protocol>.<checkId>". Anything not listed here keeps the default
       -- a scored 1-5 rating -- so this map is only the checks whose honest
       answer is something else.

       Three kinds of entry, and the reasoning is per check rather than per
       protocol on purpose:

         maintenance  work Wilson did. Cannot move a score.
         observed     a category and a photo. Cannot move a score.
         trend        a real measurement with no agreed band yet. Recorded and
                      compared against this appliance's own history.

       Where a check is still `scored`, the control may still change: a burner
       test is a COUNT (6 of 6), a leak check is PASS/FAIL, and neither of those
       should ever have been a five-point opinion.

       The bands marked "awaiting the protocol meeting" are the questions on the
       worksheets that went out to the crew. Until they come back, the reading is
       taken and trended and nothing pretends to judge it.
       ------------------------------------------------------------------ */
    checkpointAnswers: {
      /* =====================================================================
         ONE ANSWER STANDARD                                     (v0.9.39)
         =====================================================================

         Cayden, from the field team: "we are going to go with the following
         scoring system for all health checks so its super standard. each check
         is pass, fail, or cause for concern. pass= 5 cause for concern = 3 and
         fail = 1. if a tech selects cause for concern or fail, it prompts for
         a note as to why."

         So every appliance health check below is `control: "verdict"` -- three
         buttons, scores published on their faces, and choosing anything but
         pass demands the reason before the check counts as done. The anchored
         option vocabularies this replaced (v0.9.19's condition lists) survive
         as `reasons`: tap-to-pick phrases that fill the required note, so two
         technicians flagging the same condition still file the same words and
         the trend machinery still gets comparable text. A reason list is a
         menu, never a limit -- the technician can always write their own.

         Readings ride ON the verdict check (`readingFields`), which is the
         field team's philosophy in structure: the standardized measurement
         trends against its own history; the verdict is the judgement made
         standing in front of the machine. `toggle` reveals fuel-specific
         readings -- tick "Gas appliance" and the manometer field appears and
         becomes required.

         HVAC is untouched: its readings are judged against the nameplate by
         WILSON_HVAC and that machinery predates and outranks this standard.
         ------------------------------------------------------------------- */

      /* ---- generic fallback ---- */
      "generic.condition":    { kind: "scored", control: "verdict", options: "verdict" },
      "generic.connections":  { kind: "scored", control: "verdict", options: "verdict" },
      "generic.cleanliness":  { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Damage or a functional defect found", "Heavy build-up beyond reach", "Not accessible"] },

      /* ---- refrigeration ---- */
      "refrigerator.seal": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Seal hardened or flattened", "Seal torn, gapped or missing sections", "Door out of alignment / not self-closing", "Debris in the seal path"] },
      "refrigerator.evap_ir": {
        kind: "scored", control: "verdict", options: "verdict", photo: true, photoRequired: true,
        reasons: ["Uneven cold pattern on the panel", "Panel iced over", "Warm return air", "Airflow restricted", "No clear view of the panel"],
        why: "The IR image is required because it is the baseline: next year's scan against this year's picture is the trend. The camera cannot see through the panel -- what it reads is the panel surface and air path, which is exactly what gets photographed."
      },
      "refrigerator.condenser_temp": {
        /* v0.9.41: the coil/ambient readings are gone on Cayden's ruling --
           pass / concern / fail, and the tech notates the bad fan or the
           extreme blockage. */
        kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Heavy debris load / extreme blockage", "Condenser fan not running or noisy", "Abnormal compressor sound", "No clearance / enclosure heat"]
      },
      "refrigerator.icemaker_int": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Not producing", "Slow, hollow or small ice", "Fill or harvest fault"] },
      "refrigerator.drain_tube": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Drain blocked / standing water", "Ice in the drain path"] },

      /* ---- icemaker ---- */
      "icemaker.bin": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Liner cracked", "Scale or staining", "Mould line in the seams"] },
      "icemaker.internals": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Scale on the plate or internals", "Slime or growth present", "Oily residue on the plate"] },
      "icemaker.condenser": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Heavy debris load", "Fan not running or noisy", "Abnormal compressor sound"] },
      "icemaker.drain_test": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Slow to clear the standard pour", "Backed up or overflowed"] },
      "icemaker.ice_test": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Cloudy or incomplete cubes", "Hollow, small, or very slow", "Not producing ice", "Uneven freeze across the plate"] },

      /* ---- dishwasher ---- */
      "dishwasher.leak": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Leak at the door", "Leak at a connection", "Water in the base pan"] },
      "dishwasher.filter": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Filter torn or damaged", "Objects or glass in the sump", "Heavy debris beyond normal use"] },
      "dishwasher.spray_arms": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Ports blocked", "Arm did not rotate during the cycle", "Arm cracked or hub worn"] },
      "dishwasher.controls_amp": {
        /* v0.9.41: amp draw removed on Cayden's ruling -- controls, codes and
           a test cycle, judged by the technician. */
        kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Stored fault codes", "No heat during the cycle", "Control or key fault", "Cycle would not complete"]
      },
      "dishwasher.drain": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["No high loop", "Backflow / non-return failing", "Disposal connection blocked", "Slow drain"] },
      "dishwasher.install": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["No high loop", "Connected to cold water"] },

      /* ---- washer ---- */
      "washer.leaks": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Leak at a fill hose or valve", "Leak at the pump or drain", "Moisture under the machine"] },
      "washer.tub": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Bearing rumble under power", "Play at the drum", "Shaft or spider noise"] },
      "washer.suspension": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Excessive travel or banging in spin", "Weak rebound", "Machine walks"] },
      "washer.boot": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Boot perforated or torn", "Mould in the folds", "Dispenser fouled"] },
      "washer.controls": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Stored fault codes", "Key or display fault"] },
      "washer.cycle": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Fill slow or incomplete", "Did not reach full spin", "Drain slow or incomplete", "Abnormal noise in cycle"] },

      /* ---- dryer ---- */
      "dryer.static": {
        /* v0.9.41: `toggleOff` -- the reading is required until the tech
           ticks that the install blocks access, and the tick itself is kept
           on the record. Opting out is a statement about the INSTALL, so the
           reason list carries it. */
        kind: "scored", control: "verdict", options: "verdict",
        toggle: { key: "no_access", label: "Can't access the vent on this install" },
        readingFields: [
          { key: "vent_static", label: "Vent static at exhaust", unit: "in wc", required: true, toggleOff: "no_access" }
        ],
        reasons: ["Static high for this run", "Reading has climbed since last visit", "Vent not accessible — bad install"],
        why: "The same duct run measured the same way every visit. The number that matters is the difference from last year's, which is why it is recorded even when it passes. A bad install that hides the vent waives the number, never the judgement."
      },
      "dryer.exhaust_temp": {
        kind: "scored", control: "verdict", options: "verdict",
        toggle: { key: "no_access", label: "Can't take the readings — access is bad" },
        readingFields: [
          { key: "outlet_temp", label: "Exhaust outlet temperature", unit: "°F", required: true, toggleOff: "no_access" },
          { key: "ambient",     label: "Room ambient", unit: "°F", required: true, toggleOff: "no_access" }
        ],
        derived: { key: "dryer_rise", label: "Temperature rise", unit: "°F",
                   from: ["outlet_temp", "ambient"], op: "subtract" },
        reasons: ["Not cycling — temperature runs away", "Rise low — weak heat", "Thermostat suspect", "No access — bad install"]
      },
      "dryer.lint": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Housing packed with lint", "Lint in the duct run", "Transition crushed, kinked or detached", "Flapper not opening fully", "Run kinked or crushed"] },
      "dryer.overall": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Roller or belt noise", "Blower noise", "Visible damage"] },

      /* ---- laundry centre (legacy records only) ---- */
      "laundry.clean": { kind: "scored", control: "verdict", options: "verdict" },
      "laundry.codes": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Stored fault codes", "Control fault"] },

      /* ---- ventilation ---- */
      "ventilation.filters": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Filters grease-laden", "Grease beyond the filters — plenum or blower", "Baffle deformed, split or missing"] },
      "ventilation.capture": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Rollout at the edges", "Weak draw at working speed", "Smoke not clearing"],
        why: "The fogger makes capture visible instead of arguable. Same test point, same speed, every visit." },
      "ventilation.blower": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Bearing noise", "Vibration / wheel out of balance", "Speed missing"] },
      "ventilation.controls": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Speed not working", "Light out", "Control fault"] },

      /* ---- range ---- */
      "cooking.seal": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Seal hardened or flattened", "Seal torn or gapped", "Hinge stiff or door misaligned"] },
      "cooking.oven_temp": {
        kind: "scored", control: "verdict", options: "verdict",
        readingFields: [
          /* v0.9.41, Cayden: "it should default to 350. we expect the tech to
             set to 350" -- prefilled, still editable for the odd cavity that
             cannot hold it. */
          { key: "set_point",  label: "Set point used", unit: "°F", required: true, defaultValue: 350 },
          { key: "avg_30min",  label: "30-minute average", unit: "°F", required: true }
        ],
        derived: { key: "oven_delta", label: "Average vs set point", unit: "°F",
                   from: ["avg_30min", "set_point"], op: "subtract" },
        reasons: ["Average well off the set point", "Wide swings during the log", "Slow to preheat"],
        why: "Bake only, 350, thirty logged minutes with the kit probe. No tolerance band is agreed yet, so the verdict is the technician's and the average trends against this same cavity's history."
      },
      "cooking.oven_element": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Bake element or burner weak", "Broil not reaching", "Not cycling"] },
      "cooking.burners": {
        kind: "scored", control: "verdict", options: "verdict",
        toggle: { key: "gas", label: "Gas — record manometer reading" },
        readingFields: [
          { key: "gas_pressure", label: "Gas pressure at manifold", unit: "in wc", required: true, toggle: "gas" }
        ],
        reasons: ["Burner or element not reaching full output", "Electric not cycling on low", "Induction zone not detecting", "Gas pressure off spec", "Uneven or lifting flame"]
      },
      "cooking.boil": {
        kind: "scored", control: "verdict", options: "verdict",
        readingFields: [
          { key: "minutes_to_boil", label: "Minutes to a rolling boil", unit: "min", required: true }
        ],
        reasons: ["Noticeably slower than last visit", "Burner cut out during the test"],
        why: "1,000 ml, the kit's 10-inch skillet, largest burner, high. Works for gas, electric and induction because the standard is the pan and the water, not the fuel -- the number is an over-time metric for the customer, not a spec comparison."
      },
      "cooking.fans": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Convection fan not running or noisy", "Cooling fan not running", "Fan runs on after cool-down abnormally"] },

      /* ---- cooktop / rangetop ---- */
      "cooktop.burners": {
        kind: "scored", control: "verdict", options: "verdict",
        toggle: { key: "gas", label: "Gas — record manometer reading" },
        readingFields: [
          { key: "gas_pressure", label: "Gas pressure at manifold", unit: "in wc", required: true, toggle: "gas" }
        ],
        reasons: ["Burner or element not reaching full output", "Electric not cycling on low", "Induction zone not detecting", "Gas pressure off spec", "Uneven or lifting flame"]
      },
      "cooktop.boil": {
        kind: "scored", control: "verdict", options: "verdict",
        readingFields: [
          { key: "minutes_to_boil", label: "Minutes to a rolling boil", unit: "min", required: true }
        ],
        reasons: ["Noticeably slower than last visit", "Burner cut out during the test"]
      },

      /* ---- wall oven ---- */
      "oven.fans": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Convection fan not running or noisy", "Cooling fan not running"] },
      "oven.seal": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Seal hardened or flattened", "Seal torn or gapped", "Hinge stiff or door misaligned"] },
      "oven.oven_temp": {
        kind: "scored", control: "verdict", options: "verdict",
        readingFields: [
          { key: "set_point",  label: "Set point used", unit: "°F", required: true, defaultValue: 350 },
          { key: "avg_30min",  label: "30-minute average", unit: "°F", required: true }
        ],
        derived: { key: "oven_delta", label: "Average vs set point", unit: "°F",
                   from: ["avg_30min", "set_point"], op: "subtract" },
        reasons: ["Average well off the set point", "Wide swings during the log", "Slow to preheat"]
      },
      "oven.element": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Bake element or burner weak", "Broil not reaching", "Not cycling"] },

      /* ---- warming drawer ---- */
      "warming_drawer.slides": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Binding or uneven travel", "Stop or catch damaged", "Rail bent"] },
      "warming_drawer.element": {
        kind: "scored", control: "verdict", options: "verdict",
        readingFields: [
          { key: "measured_center", label: "Measured at centre after 20 min", unit: "°F", required: false }
        ],
        reasons: ["Not heating", "Heat weak or uneven"],
        why: "No cross-brand temperature standard exists -- twelve brands' manuals disagree by 65 degrees on what 'High' means -- so the optional reading trends against this drawer's own history and nothing pretends to judge it."
      },
      "warming_drawer.fan": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Fan not running", "Fan noisy"] },
      "warming_drawer.seal": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Gasket hardened or torn", "Not sealing all round"] },

      /* ---- microwave ---- */
      "microwave.leakage": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Reading over threshold at the door", "Reading over threshold at the window", "Door or hinge damage found"],
        why: "The kit tester around the perimeter during a water run. Over the threshold is a fail with no judgement call in it -- this is the one check on the protocol where the instrument outranks the technician." },
      "microwave.delta_t": {
        kind: "scored", control: "verdict", options: "verdict",
        readingFields: [
          { key: "start_temp", label: "Water temperature before", unit: "°F", required: true },
          { key: "end_temp",   label: "Water temperature after", unit: "°F", required: true }
        ],
        derived: { key: "mw_rise", label: "Rise", unit: "°F",
                   from: ["end_temp", "start_temp"], op: "subtract" },
        reasons: ["Rise well below this unit's history", "Cut out during the run"],
        why: "500 ml from the kit beaker, the standard time on high, every visit. The standard load is what makes this year's rise comparable to last year's."
      },
      "microwave.keypad": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Key not registering", "Display segments out"] },
      "microwave.fan": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Cooling fan not running", "Vent fan weak or noisy", "Light out"] },

      /* ---- coffee ---- */
      "coffee.grounds": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Pucks wet or crumbling", "Channelling visible", "Container fouled"] },
      "coffee.flow": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Flow sputtering or stalling", "Volume low", "Brew time well off normal"] },
      "coffee.milk": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Film inside the line", "Souring smell", "Visible growth in line or frother"],
        why: "A food-contact path. Growth is the harshest finding on this protocol and the customer is told in those words." },
      "coffee.interior": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Brew chamber fouled", "Mould or residue present"] },
      "coffee.grinder": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Grind coarse or inconsistent — burrs worn", "Metal-on-metal", "Chute packed"] },
      "coffee.brew": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Seals hardened or leaking past", "Stiff travel / will not seat", "Grounds packed in the unit"] },

      /* ---- outdoor grill: documented, never cleaned ---- */
      "outdoor_grill.gauge": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Gauge dead", "Reads far from measured temperature"] },
      "outdoor_grill.burners": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Burner will not light or hold", "Valve range limited", "Uneven or lifting flame"] },
      "outdoor_grill.grates": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Cracked or broken grate", "Corrosion reaching food contact", "Flaking coating"] },
      "outdoor_grill.ignitor": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["No spark at a port", "Repeated attempts needed", "Module dead"] },
      "outdoor_grill.rust": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Firebox perforated or flaking", "Burners heavily corroded", "Frame or fasteners failing"] },
      "outdoor_grill.grease": { kind: "scored", control: "verdict", options: "verdict", photo: true,
        reasons: ["Heavy accumulation — fire risk", "Drip path blocked", "Tray overflowing"],
        why: "Documented and quoted, never cleaned at maintenance -- the registration says so and the protocol keeps the promise." },
      "outdoor_grill.extras": { kind: "scored", control: "verdict", options: "verdict",
        reasons: ["Light out", "Control damaged", "Rotisserie not turning"] },

      /* ---- HVAC: the readings are scored, the eyeballed items are not ---- */
      "hvac_cooling.hvac_condensate":   { kind: "scored", control: "passfail", options: "drain" },
      "hvac_cooling.hvac_safety":       { kind: "scored", control: "passfail", options: "safety" },
      "hvac_heatpump.hvac_condensate":  { kind: "scored", control: "passfail", options: "drain" },
      "hvac_heatpump.hvac_safety":      { kind: "scored", control: "passfail", options: "safety" },
      "hvac_heatpump.hvac_backup":      { kind: "scored", control: "passfail", options: "operating" },
      "hvac_minisplit.hvac_condensate": { kind: "scored", control: "passfail", options: "drain" },
      "hvac_minisplit.hvac_safety":     { kind: "scored", control: "passfail", options: "safety" },
      "hvac_furnace.hvac_safety":       { kind: "scored", control: "passfail", options: "safety" },
      "hvac_furnace.hvac_burner":       { kind: "observed", control: "category", options: "flame_condition", photo: true },
      "hvac_furnace.hvac_venting":      { kind: "scored", control: "passfail", options: "safety" },
      "hvac_furnace.hvac_heatex": {
        kind: "observed", control: "category", options: "heatex", photo: true,
        why: "A heat-exchanger finding is what triggers a diagnostic, not a number on a maintenance report. Maintenance detects; diagnosis explains."
      }
    },

    /* ---------------------------------------------------------------------
       MAINTENANCE PERFORMED -- tapped, not typed, and never scored

       This is the section that tells a customer what their money bought, and
       it is the reason a technician no longer has to type. Each chip is one
       tap and produces the same words on every report, in Wilson's voice
       rather than in each technician's.

       Two rules hold it honest:
         1. A chip is a claim about WILSON'S work, not about the appliance's
            condition, so no combination of chips can lift a health score.
         2. `photo: true` chips are the ones worth proving. The tool asks for
            the before/after rather than taking the tap as evidence.
       ------------------------------------------------------------------ */
    /*
     * The before-you-move-on reminders.                          (v0.9.39)
     *
     * Cayden: run the cleaning or descale cycle before leaving the appliance
     * -- "dishwasher, icemaker, washing machine for starters". Each names the
     * maintenance chip that satisfies it, so a reminder a technician has
     * already acted on turns into a confirmation instead of a nag.
     */
    cycleReminders: {
      dishwasher: {
        chip: "clean_cycle",
        title: "Before you move on: run the machine clean cycle",
        detail: "Start it before packing up — it runs while you work the next appliance. Tick the chip above when you have.",
        doneLabel: "Clean cycle run — ticked above"
      },
      icemaker: {
        chip: "descale",
        title: "Before you move on: run the descale / clean cycle",
        detail: "This house's water hardness is on the visit record; the descale is the work that answers it. Tick the chip above when it is running.",
        doneLabel: "Descale / clean cycle run — ticked above"
      },
      washer: {
        chip: "clean_cycle",
        title: "Before you move on: run the tub clean cycle",
        detail: "Start it before packing up. Tick the chip above when you have.",
        doneLabel: "Tub clean cycle run — ticked above"
      },
      coffee: {
        chip: "descale",
        title: "Before you move on: run the descale cycle",
        detail: "Wilson runs the descale at maintenance — Cayden's rule. Tick the chip above when it is running.",
        doneLabel: "Descale cycle run — ticked above"
      }
    },

    maintenanceActions: {
      refrigerator: [
        { id: "condenser_vac",  label: "Condenser coil vacuumed", photo: true },
        { id: "water_filter",   label: "Water filter replaced" },
        { id: "air_filter",     label: "Air filter replaced" },
        { id: "drain_cleared",  label: "Defrost drain cleared" },
        { id: "gaskets",        label: "Door gaskets cleaned" },
        { id: "interior",       label: "Interior cleaned / sanitized" },
        /* v0.9.39, from the field team's list. Both are work performed, so
           they are chips -- they can never move a score. */
        { id: "peroxide",       label: "Hydrogen peroxide treatment" },
        { id: "ice_dump",       label: "Clumped ice dumped from bin" }
      ],
      icemaker: [
        { id: "descale",       label: "Descale / clean cycle run" },
        { id: "bin_sanitize",  label: "Bin cleaned and sanitized" },
        { id: "water_filter",  label: "Water filter replaced" },
        { id: "condenser_vac", label: "Condenser coil vacuumed", photo: true },
        { id: "drain_flush",   label: "Drain flushed" },
        { id: "scoop",         label: "Scoop and holder cleaned" }
      ],
      dishwasher: [
        { id: "filter_clean",  label: "Filter and sump cleaned" },
        { id: "spray_arms",    label: "Spray arms cleared" },
        { id: "clean_cycle",   label: "Machine clean cycle run" },
        { id: "gasket",        label: "Door gasket cleaned" },
        { id: "strainer",      label: "Inlet strainer checked" }
      ],
      /* Range: both halves, because a range is both halves. */
      cooking: [
        { id: "burner_clean",  label: "Burner caps and ports cleaned" },
        { id: "igniters",      label: "Ignition components cleaned" },
        { id: "grates",        label: "Grates cleaned" },
        { id: "door_seal",     label: "Oven door seal cleaned" },
        { id: "vent_clear",    label: "Oven vent cleared" },
        { id: "calibrated",    label: "Oven calibrated" }
      ],
      /* v0.9.37: the three sets `cooking` was split into. Each takes the chips
         for the work that appliance can actually have done to it -- a warming
         drawer has no burner caps and a cooktop has no oven vent. */
      cooktop: [
        { id: "burner_clean",  label: "Burner caps and ports cleaned" },
        { id: "igniters",      label: "Ignition components cleaned" },
        { id: "grates",        label: "Grates cleaned" },
        { id: "surface_clean", label: "Cooking surface cleaned" }
      ],
      oven: [
        { id: "door_seal",     label: "Oven door seal cleaned" },
        { id: "vent_clear",    label: "Oven vent cleared" },
        { id: "cavity_clean",  label: "Accessible cavity cleaned" },
        { id: "racks",         label: "Racks and guides cleaned" },
        /* Cayden listed calibration under the range only; the same cavity in a
           wall oven can be calibrated the same way, so it is offered here too.
           His call to remove it. */
        { id: "calibrated",    label: "Oven calibrated" }
      ],
      warming_drawer: [
        { id: "gasket_clean",  label: "Drawer gasket cleaned" },
        { id: "pan_clean",     label: "Pan and liner cleaned" },
        { id: "slides",        label: "Drawer slides checked" }
      ],
      /* Built-in coffee (v0.9.37, DRAFT). WHICH OF THESE WILSON ACTUALLY DOES
         AT A MAINTENANCE VISIT IS THE OPEN QUESTION -- particularly the descale
         cycle, which on a scaled machine can take the better part of an hour
         and needs the owner's descaler. Listed so the question is concrete. */
      /* Built-in coffee. Cayden's rulings, v0.9.37: Wilson RUNS the descale, and
         cleaning the milk pipework is in scope at a maintenance visit -- it is
         the owner's job day to day, but the technician can do it. Both are
         therefore work Wilson performs, which is what a chip is for. */
      coffee: [
        { id: "brew_group",    label: "Brew group removed and cleaned", photo: true },
        { id: "milk_rinse",    label: "Milk pipework cleaned" },
        { id: "descale",       label: "Descale cycle run" },
        { id: "water_filter",  label: "Machine water filter replaced" },
        { id: "grinder_clear", label: "Grinder chute and hopper cleared" },
        { id: "drip_tray",     label: "Drip tray and grounds container cleaned" }
      ],
      washer: [
        { id: "gasket_clean",  label: "Door gasket cleaned" },
        { id: "filter_clean",  label: "Drain filter cleaned" },
        /* v0.9.39: the kit carries a shop-vac funnel for exactly this. */
        { id: "drain_trap",    label: "Drain trap cleaned" },
        { id: "clean_cycle",   label: "Tub clean cycle run" },
        { id: "hoses",         label: "Fill hoses inspected" },
        { id: "level",         label: "Levelling checked" }
      ],
      dryer: [
        { id: "lint_full",     label: "Lint cleaned from unit", photo: true },
        /* Cayden's list names the screen separately from the unit, because a
           customer reads "lint screen cleaned" and knows what it means. */
        { id: "lint_screen",   label: "Lint screen cleaned" },
        { id: "vent_clear",    label: "Accessible vent cleared" },
        { id: "drum_seals",    label: "Drum seals checked" },
        { id: "sensor_clean",  label: "Moisture sensor cleaned" }
      ],
      ventilation: [
        { id: "baffles",       label: "Baffles / filters cleaned", photo: true },
        { id: "blower_clean",  label: "Blower wheel cleaned" },
        { id: "grease_clean",  label: "Accessible grease removed" },
        { id: "lamps",         label: "Lamps replaced" }
      ],
      microwave: [
        { id: "cavity_clean",  label: "Cavity cleaned" },
        { id: "filter_clean",  label: "Grease / charcoal filter serviced" },
        { id: "turntable",     label: "Turntable and roller cleaned" }
      ],
      outdoor_grill: [
        { id: "documented",    label: "Condition documented (no cleaning performed)", photo: true },
        { id: "gas_leak",      label: "Gas connections leak-checked" },
        { id: "igniter",       label: "Igniters tested" }
      ],
      laundry: [
        { id: "lint_full",     label: "Lint system cleaned" },
        { id: "gasket_clean",  label: "Gasket cleaned" }
      ],
      generic: [
        { id: "cleaned",       label: "Accessible surfaces cleaned" },
        { id: "checked",       label: "Connections checked" }
      ],
      hvac_cooling: [
        { id: "coil_wash",     label: "Condenser coil washed", photo: true },
        { id: "filter",        label: "Air filter replaced" },
        { id: "drain_flush",   label: "Condensate drain flushed" },
        { id: "pan_tab",       label: "Pan treatment tablet placed" },
        { id: "blower_clean",  label: "Blower wheel cleaned" },
        { id: "connections",   label: "Electrical connections tightened" }
      ],
      hvac_heatpump: [
        { id: "coil_wash",     label: "Outdoor coil washed", photo: true },
        { id: "filter",        label: "Air filter replaced" },
        { id: "drain_flush",   label: "Condensate drain flushed" },
        { id: "defrost_test",  label: "Defrost cycle verified" },
        { id: "connections",   label: "Electrical connections tightened" }
      ],
      hvac_furnace: [
        { id: "burner_clean",  label: "Burners cleaned", photo: true },
        { id: "filter",        label: "Air filter replaced" },
        { id: "flame_sensor",  label: "Flame sensor cleaned" },
        { id: "vent_check",    label: "Venting inspected" },
        { id: "connections",   label: "Electrical connections tightened" }
      ],
      hvac_minisplit: [
        { id: "blower_clean",  label: "Blower wheel cleaned", photo: true },
        { id: "coil_clean",    label: "Indoor coil cleaned" },
        { id: "filters_wash",  label: "Filters washed" },
        { id: "drain_flush",   label: "Condensate drain flushed" }
      ]
    },

    /* =====================================================================
       AGE STAYS IN THE APPLIANCE SCORE AT 25%, AND NEVER HIDES  (v0.9.17)
       =====================================================================

       Owner's decision, and the reasoning is sound: age genuinely does predict
       failure on appliances, and a customer planning a kitchen is entitled to
       have that in the number. 25% is the weight.

       The danger was never the weight. It was that a BLEND DESTROYS
       INFORMATION: a score of 78 could be a well-kept fifteen-year-old
       refrigerator measuring perfectly, or a three-year-old one measuring
       badly, and the customer cannot tell which from one number. Those two
       appliances need opposite conversations.

       So the blend stays and the components are never hidden. Every surface
       that prints the overall also prints, beside it:

           Condition 100   ·   Life used 74%   ·   Overall 88

       A well-maintained fourteen-year-old refrigerator scores 100 on the checks
       it passed -- visibly, on the same line -- and its age is a stated fact
       rather than a silent subtraction. That satisfies both things at once: age
       counts, and nobody has to wonder what pulled the number down.

       Still true, and still enforced elsewhere: nothing about cosmetic wear,
       how dirty an appliance was before the visit, or its brand touches the
       score at all.
       ------------------------------------------------------------------ */
    reportScoring: {
      /* THE ONE KNOB for the condition/age split. Every scorer — field tool,
         HVAC path, seeded history — reads these two numbers; change them here
         and the whole product moves together (they should sum to 1).
         Cayden asked (v0.9.49) whether age should be 33% instead of 25%.
         Held at 25% deliberately: age already compounds through expected-life
         (water hardness, environment, tier), so raising the weight
         double-counts years — and a service company whose score leans harder
         on age than on what the technician measured starts to look like a
         replacement-sales tool, which this product is explicitly not. If real
         field data later shows old-but-perfect units failing early, raise it
         then, with the data in hand. */
      vitalWeight: 0.75,
      ageWeight: 0.25,
      /* Age is deliberately NOT in this list -- it is scored, at 25%, and shown
         alongside the condition number rather than folded silently into it. */
      reportedNotScored: {
        cosmetic: {
          label: "Cosmetic wear",
          reason: "Recorded as an observation where a technician sees it. A scratch does not change how an appliance runs."
        },
        condition_before: {
          label: "How dirty it was before service",
          reason: "That is what the maintenance visit is for. The health score is measured after the work, not before it."
        },
        /*
         * v0.9.30: THIS WORDING WAS A LIE AND HAS BEEN CORRECTED.
         *
         * It read "It never adjusts a score up or down", which was not true even
         * when it was written: brand picks a tier, the tier picks expected life,
         * and expected life is 25% of the appliance score through the age term.
         * Making the lifespan table brand-and-line specific made the effect
         * bigger, and averaging Cayden's field figures against the anchored ones
         * halved it again -- 5 points of spread on a perfect-measuring
         * seven-year-old refrigerator, down from 9 on the raw field table.
         *
         * The honest statement is that brand never scores CONDITION. A number
         * this file is going to print to a customer should not be defended by a
         * sentence that is only nearly true.
         */
        brand: {
          label: "Brand and product tier",
          reason: "Never scores condition. A brand cannot add or remove a point for how an appliance is running. It does set the draft expected service life this appliance is measured against, which the age term uses -- so the age line on the report always shows the years it was compared to."
        }
      },
      gradeBands: [
        { min: 90, grade: "A", label: "Excellent" },
        { min: 80, grade: "B", label: "Good" },
        { min: 70, grade: "C", label: "Monitor" },
        { min: 60, grade: "D", label: "Plan ahead" },
        { min: 0, grade: "F", label: "Action recommended" }
      ],
      explanation: "Three-quarters of this score is the condition measured at this visit; one quarter is the appliance's age against a draft expected service life. Both numbers are printed beside the total, so a well-maintained older appliance can be seen scoring full marks on the checks it passed. Cosmetic wear, how dirty the appliance was before service, and brand never change the score."
    },
    filterTypes: [
      "Refrigerator water filter",
      "Refrigerator air / food-preservation filter",
      "Freezer water filter",
      "Icemaker water filter",
      "HVAC media filter"
    ],
  };

  // ---------------------------------------------------------------------------
  // Protocol resolution -- single source of truth.
  //
  // Which checkpoint set (inspection protocol) applies to an asset is decided
  // here and nowhere else. Before v0.9.1 this was decided twice: by the
  // `checkpointSet` field on the two taxonomies above (which was wrong for
  // ventilation, microwave, washer and dryer) and again by a hardcoded if-chain
  // in tech-maintenance.js `templateKey()`. The field tool happened to show the
  // right protocol because the if-chain won, so the defect was invisible while
  // persisting wrong values on every asset ever created.
  //
  // Resolution order is deliberate:
  //   1. IMUC group / icemaker -- group membership always wins.
  //   2. applianceTypes match on the asset's exact type (most specific).
  //   3. customerApplianceCategories match on the customer-facing category.
  //   4. The asset's own stored checkpointSet, if it names a real set.
  //   5. generic.
  //
  // Config is consulted BEFORE the stored value so that assets already
  // persisted with a wrong checkpointSet (all of them, pre-fix) resolve
  // correctly without a data migration. When MERGE_GUIDE §22 moves protocol
  // config into versioned SQL, steps 2-3 become table lookups and this function
  // is the only thing that changes.
  // ---------------------------------------------------------------------------
  const norm = (value) => String(value == null ? "" : value).trim().toLowerCase();
  const isRealSet = (key) => Boolean(key && Object.prototype.hasOwnProperty.call(config.checkpointSets, key));

  function buildIndex(list) {
    const index = {};
    (list || []).forEach((entry) => {
      if (!entry || !entry.checkpointSet) return;
      index[norm(entry.id)] = entry.checkpointSet;
      if (entry.label) index[norm(entry.label)] = entry.checkpointSet;
    });
    return index;
  }

  const typeIndex = buildIndex(config.applianceTypes);
  const categoryIndex = buildIndex(config.customerApplianceCategories);

  function resolveCheckpointSet(asset) {
    if (!asset) return "generic";

    const group = norm(asset.group);
    if (group === "imuc") return "icemaker";

    /*
     * HVAC used to return "generic" here -- three subjective ratings, which is
     * what a technician opening an HVAC visit actually got. It now resolves by
     * system type, because a heat pump and a gas furnace do not share a
     * protocol and pretending they do is the same error as scoring a dishwasher
     * on a refrigerator's checks.
     *
     * "Other" deliberately falls through to generic and is meant to be visible
     * as a gap: an unrecognised system should prompt someone to classify it,
     * not quietly get three ratings.
     */
    if (group === "hvac") {
      const systemType = norm(asset.exactType) || norm(asset.type) || norm(asset.systemType);
      if (/heat pump|heatpump/.test(systemType)) return "hvac_heatpump";
      if (/mini.?split|ductless/.test(systemType)) return "hvac_minisplit";
      if (/furnace|gas heat/.test(systemType)) return "hvac_furnace";
      if (/split|packaged|package|air handler|condenser/.test(systemType)) return "hvac_cooling";
      return "generic";
    }

    const candidates = [asset.exactType, asset.exactTypeLabel, asset.type, asset.typeLabel];
    for (let i = 0; i < candidates.length; i += 1) {
      const hit = typeIndex[norm(candidates[i])];
      if (isRealSet(hit)) return hit;
    }

    const categoryHit = categoryIndex[norm(asset.customerCategory)] || categoryIndex[norm(asset.type)];
    if (isRealSet(categoryHit)) return categoryHit;

    if (isRealSet(asset.checkpointSet)) return asset.checkpointSet;
    return "generic";
  }

  // ---------------------------------------------------------------------------
  // Filter service pricing -- single source of truth.
  //
  // Selecting filter service on an individual refrigeration or icemaker asset
  // raises the annual plan price. Estate Concierge includes filters outright, so
  // the same selection costs nothing there. Every caller -- the enrollment
  // builder, the summary, the quote builder, the demo backend -- must price
  // through filterServiceForAsset() rather than reimplementing the arithmetic.
  //
  // PLACEHOLDER PRICING: see config.refrigerationFilterService.pricing.
  // ---------------------------------------------------------------------------
  const filterKinds = () => (config.refrigerationFilterService.pricing || {}).kinds || {};

  function categoryFor(asset) {
    if (!asset) return null;
    const wanted = norm(asset.customerCategory) || norm(asset.type);
    const direct = config.customerApplianceCategories.find((c) => norm(c.id) === wanted);
    if (direct) return direct;
    /* v0.9.41: a stored asset can carry the exact TYPE ("refrigerator",
       "freezer", "wine_beverage") where the builder carries the customer
       category ("refrigeration"). Resolving through the same type table
       protocol resolution uses keeps this the one category resolver --
       before this, a seeded Sub-Zero was Guardian-enrolled on the hub and
       priced at zero sensors by this very engine. */
    const viaType = categoryForAsset(asset);
    if (!viaType) return null;
    return config.customerApplianceCategories.find((c) => c.id === viaType) || null;
  }

  /* Which paid filter kinds this asset can be offered, in config order. */
  function filterServiceKindsFor(asset) {
    const category = categoryFor(asset);
    if (!category || !category.filterServiceAvailable) return [];
    return (category.filterServiceKinds || ["water"]).filter((k) => filterKinds()[k]);
  }

  function filterServiceEligible(asset) {
    return filterServiceKindsFor(asset).length > 0;
  }

  function planIncludesFilters(planId) {
    return (config.refrigerationFilterService.includedPlanIds || []).indexOf(planId) !== -1;
  }

  /*
   * Selected quantity for one kind. Defaults to the config quantity when the
   * asset has opted in without an explicit count.
   *
   * `assumeSelected` is set when the plan covers filters outright: Estate
   * Concierge includes both water and air, so every eligible kind counts as
   * selected whether or not the customer ticked it. Without this the enrollment
   * summary undercounted covered filters on Concierge -- it listed only the
   * assets that happened to carry an opt-in flag, even though the checkboxes
   * render as checked and disabled for all of them.
   */
  function filterQuantity(asset, kindId, assumeSelected) {
    const kind = filterKinds()[kindId];
    if (!kind || !asset) return 0;
    const selected = assumeSelected || (kindId === "water"
      ? Boolean(asset.filterServiceOptIn)
      : Boolean(asset.airFilterServiceOptIn));
    if (!selected) return 0;
    const explicit = Number(
      kindId === "water" ? asset.waterFilterQuantity : asset.airFilterQuantity
    );
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    return Number(kind.defaultQuantity) || 1;
  }

  /*
   * Priced breakdown of one asset's filter selections.
   * Returns { eligible, included, lines: [{kindId,label,quantity,unitPrice,amount}], total }
   * `included` is true when the plan covers filters, in which case total is 0
   * but the lines still describe what is covered.
   */
  function filterServiceForAsset(asset, planId) {
    const kinds = filterServiceKindsFor(asset);
    const included = planIncludesFilters(planId);
    const lines = [];
    kinds.forEach((kindId) => {
      const quantity = filterQuantity(asset, kindId, included);
      if (!quantity) return;
      const kind = filterKinds()[kindId];
      const unitPrice = Number(kind.unitPrice) || 0;
      lines.push({
        kindId: kindId,
        label: kind.label,
        shortLabel: kind.shortLabel || kind.label,
        quantity: quantity,
        unitPrice: unitPrice,
        amount: included ? 0 : quantity * unitPrice
      });
    });
    return {
      eligible: kinds.length > 0,
      included: included,
      lines: lines,
      total: lines.reduce((sum, line) => sum + line.amount, 0)
    };
  }

  /* Household-level total across a set of assets. */
  function filterServiceTotal(assets, planId) {
    return (assets || []).reduce(
      (sum, asset) => sum + filterServiceForAsset(asset, planId).total, 0
    );
  }

  /* Per-kind rollup for summaries and stored subscription detail. */
  function filterServiceSummary(assets, planId) {
    const summary = { included: planIncludesFilters(planId), total: 0, kinds: {} };
    (assets || []).forEach((asset) => {
      filterServiceForAsset(asset, planId).lines.forEach((line) => {
        const bucket = summary.kinds[line.kindId] || {
          kindId: line.kindId,
          label: line.label,
          shortLabel: line.shortLabel,
          unitPrice: line.unitPrice,
          assetCount: 0,
          quantity: 0,
          amount: 0
        };
        bucket.assetCount += 1;
        bucket.quantity += line.quantity;
        bucket.amount += line.amount;
        summary.kinds[line.kindId] = bucket;
        summary.total += line.amount;
      });
    });
    return summary;
  }

  /*
   * ONE resolver for "how old is it, and who says so".
   *
   * Every surface that shows an age or a lifecycle figure goes through here, so
   * the provenance rules cannot drift between the field tool, the report and the
   * compiled review the way protocol resolution drifted before v0.9.1.
   *
   * Takes an asset, plus an optional field-entered age and the source the
   * technician selected. Returns the age to use, the source that produced it,
   * and whether that source is a document.
   */
  function resolveAge(asset, fieldAge, fieldSource, asOfYear) {
    const sources = config.ageSources;
    const year = Number(asOfYear) || new Date().getFullYear();

    /* An explicit field entry wins -- the technician is standing at the
       appliance -- but it carries its own source, never the invoice's.
       Note the null/"" guard: Number(null) is 0, which is a finite number and
       a legitimate age, so a missing entry would otherwise resolve to
       "brand new, technician estimate" on every appliance in the portfolio. */
    const supplied = fieldAge !== null && fieldAge !== undefined && String(fieldAge).trim() !== "";
    const entered = Number(fieldAge);
    if (supplied && Number.isFinite(entered) && entered >= 0) {
      const source = sources[fieldSource] || sources.estimate;
      return { age: entered, source: source, documented: source.documented, installYear: null };
    }

    const installYear = Number((asset || {}).installYear);
    if (Number.isFinite(installYear) && installYear > 1900 && installYear <= year) {
      const source = sources[(asset || {}).ageSource] || sources.customer;
      return { age: year - installYear, source: source, documented: source.documented, installYear: installYear };
    }

    /* No age at all. This is NOT age zero, and it is not an average: a
       lifecycle figure invented from nothing is the thing this whole change
       exists to prevent. */
    return { age: null, source: sources.unknown, documented: false, installYear: null };
  }

  window.WILSON_CONFIG = config;
  /* =====================================================================
     THE ANSWER RESOLVER

     One function decides what a check produces and how it is answered, so the
     field tool, the score, the report and the database cannot disagree about
     it. That mattered enough to be worth a module: the last three defects of
     this class were all two copies of one rule.

     `scores` is the load-bearing field. A check that is not scored can be
     answered any way at all and still cannot move a customer's number.
     ================================================================== */
  function answerFor(setKey, checkId) {
    const key = String(setKey || "") + "." + String(checkId || "");
    const entry = (config.checkpointAnswers || {})[key] || {};
    const kind = config.answerKinds[entry.kind] || config.answerKinds.scored;
    /*
     * v0.9.39: the DEFAULT for an appliance check with no declared answer is
     * the verdict, not the 1-5 rating. The field team's standard is the
     * standard precisely so that a new check added in a hurry cannot arrive
     * with its own scoring idea. HVAC keeps its rating default -- its checks
     * are judged against the nameplate by machinery this standard does not
     * touch.
     */
    const isHvac = String(setKey || "").indexOf("hvac_") === 0;
    const control = entry.control || (kind.id === "maintenance" ? "passfail" : (isHvac ? "rating" : "verdict"));
    let options = null;
    if (entry.options) {
      options = (config.observationSets || {})[entry.options]
             || (config.passFailSets || {})[entry.options]
             || null;
    }
    /* A verdict control always answers from the one shared set, even when the
       entry forgot to say so -- two verdict vocabularies would be two scoring
       systems again. */
    if (control === "verdict") options = (config.observationSets || {}).verdict || options;
    /*
     * The reading fields are resolved HERE, from either place they can be
     * written, because "what numbers does this check take" is part of the
     * answer's shape and the field tool, the completion gate, the report and
     * the SQL seed all have to agree about it. They used to live only on the
     * checkpoint, so an answer that needed a second number had nowhere to say
     * so -- which is how the wall oven ended up with one box labelled "actual
     * temp / set point" and no way to record both.
     */
    const checkpoint = ((config.checkpointSets || {})[setKey] || []).find(function (c) {
      return c.id === checkId;
    }) || {};
    const readingFields = (entry.readingFields && entry.readingFields.length)
      ? entry.readingFields
      : (checkpoint.readingFields || []);
    return {
      key: key,
      kind: kind.id,
      scores: Boolean(kind.scores),
      kindLabel: kind.label,
      kindBlurb: kind.blurb,
      control: control,
      options: options,
      optionSet: entry.options || "",
      countLabel: entry.countLabel || "",
      label: entry.label || "",
      photo: Boolean(entry.photo),
      readingFields: readingFields,
      /* A value the tool computes from two readings and never asks for: the
         oven's error, the dryer's rise. Shown live, so a transposed number is
         caught while the technician is still at the appliance. */
      derived: entry.derived || null,
      /* v0.9.39: the reason menu for a non-pass verdict, the fuel toggle that
         reveals extra readings, and whether the check demands its photograph.
         photoRequired can be declared on the answer or on the checkpoint. */
      reasons: entry.reasons || [],
      toggle: entry.toggle || null,
      photoRequired: Boolean(entry.photoRequired || checkpoint.photoRequired),
      unit: checkpoint.unit || "",
      why: entry.why || ""
    };
  }

  /* Every checkpoint in a protocol, already resolved. The field tool renders
     from this rather than re-deriving per card. */
  function answersForSet(setKey) {
    const set = (config.checkpointSets || {})[setKey] || [];
    return set.map(function (check) {
      return Object.assign({}, answerFor(setKey, check.id), { checkId: check.id, name: check.name });
    });
  }

  /* The maintenance chips for a protocol. Empty array rather than null: a
     caller iterating this must not have to guard. */
  function maintenanceFor(setKey) {
    return ((config.maintenanceActions || {})[setKey] || []).slice();
  }

  /*
   * WHICH CHECKS MAY BE SCORED.
   *
   * This is the guarantee, in one place: pass in a protocol's checks and get
   * back only the ones whose answers are allowed to reach a health score.
   * "Not applicable" drops out here too, for the same reason -- an appliance
   * cannot be marked down for a check that does not apply to it.
   */
  function scorableChecks(setKey, checks) {
    return (checks || []).filter(function (check) {
      if (!check || check.notApplicable) return false;
      return answerFor(setKey, check.id).scores;
    });
  }

  window.WILSON_ANSWERS = {
    kinds: function () { return config.answerKinds; },
    controls: function () { return config.answerControls; },
    for: answerFor,
    forSet: answersForSet,
    maintenance: maintenanceFor,
    scorable: scorableChecks,
    observationSet: function (name) { return (config.observationSets || {})[name] || null; },
    passFailSet: function (name) { return (config.passFailSets || {})[name] || null; }
  };

  window.WILSON_PROTOCOL = { resolveCheckpointSet: resolveCheckpointSet };

  /*
   * Brands: tier, lifespan, and whether Wilson can put this on a plan at all.
   * Exposed as its own global because three different screens ask three
   * different questions of the same table, and none of them should be reaching
   * into `config.brandLifespans` directly.
   */
  /* =====================================================================
     WHERE THE APPLIANCE LIVES                                  (v0.9.37)
     =====================================================================

     Cayden: "i dont think i want outdoor v indoor as a flag on the customer
     side, but our tech or office should be able to flag it as outdoor. it
     should default to outdoor if the customer sets up an outdoor area and adds
     it there during registration."

     So: never a question on the signup form. Derived from the area the customer
     already named, overridable by the two people who have actually seen the
     installation.

     This matters because Texas summers are the difference between an eight-year
     appliance and a twenty-year one, and until now the product could not tell
     them apart. The demo estate's outdoor True undercounter was being given
     True's INDOOR figure of twenty years while sitting in an enclosure with no
     rear clearance, declining visibly across four visits.

     Resolution order, most authoritative first:
       flagged   somebody who was standing in front of it said so
       type      the appliance type is outdoor by definition (a built-in grill)
       area      the customer put it in an area whose name means outside
       default   indoor

     WHOLE-WORD MATCHING, and a deliberately short word list. Substring
     matching is what once scored a Gaggenau as mass-market because "gaggenau"
     contains "ge"; the same trap here is "Pool House", which is a BUILDING and
     whose contents are indoors. "pool" is therefore not an outdoor word and
     "poolside" is. Anything genuinely ambiguous -- porch, which is screened as
     often as not in Texas, and garden, as in garden room -- is left out
     entirely and left to the technician's flag.
     --------------------------------------------------------------------- */
  const OUTDOOR_AREA_WORDS = [
    "outdoor", "outdoors", "patio", "lanai", "terrace", "deck", "cabana",
    "courtyard", "veranda", "poolside", "grill", "bbq", "barbecue",
    "pergola", "palapa", "loggia", "alfresco", "summerkitchen"
  ];
  /* Named so the reason a phrase does NOT count is written down rather than
     rediscovered. Each of these contains or resembles an outdoor word and is
     an indoor space. */
  const NOT_OUTDOOR_PHRASES = [
    "pool house", "poolhouse", "guest house", "casita", "garden room",
    "sunroom", "sun room", "garage", "mud room", "mudroom"
  ];

  function environmentFor(asset) {
    const a = asset || {};
    const flagged = norm(a.installEnvironment);
    if (flagged === "outdoor" || flagged === "indoor") {
      return { id: flagged, source: "flagged", label: flagged === "outdoor" ? "Outdoor" : "Indoor",
               why: "Recorded against this appliance by " +
                    (a.installEnvironmentSource === "tech" ? "the technician at a visit" : "the office") + "." };
    }

    /*
     * TYPE, and only a type that has nowhere else to be. A built-in grill is
     * outdoor by definition and there is nothing for anyone to correct.
     *
     * A typeLabel of "Outdoor Refrigerator" is NOT this. That is a label
     * somebody typed, no stronger than the area name, and treating it as
     * definitional locked the technician out of the override on the exact
     * appliance most likely to be mislabelled -- which is what the demo
     * estate's True undercounter did on the first run of this code.
     */
    if (norm(a.customerCategory) === "outdoor_grill" ||
        norm(a.exactType) === "outdoor_grill" || norm(a.type) === "outdoor_grill") {
      return { id: "outdoor", source: "type", label: "Outdoor",
               why: "A built-in grill has nowhere else to be." };
    }

    /* A label that says outdoor. Overridable, and it says who wrote it. */
    const labelText = norm([a.typeLabel, a.exactTypeLabel, a.description].filter(Boolean).join(" "));
    if (/\boutdoor\b/.test(labelText)) {
      return { id: "outdoor", source: "label", label: "Outdoor",
               why: "The appliance is recorded as “" + (a.typeLabel || a.exactTypeLabel || a.description) +
                    "”. Nobody has confirmed it on site." };
    }

    const area = norm([a.location, a.areaName, a.area].filter(Boolean).join(" "));
    if (area) {
      const blocked = NOT_OUTDOOR_PHRASES.find(function (phrase) { return area.indexOf(phrase) !== -1; });
      if (!blocked) {
        const words = area.split(/[^a-z0-9]+/).filter(Boolean);
        const hit = OUTDOOR_AREA_WORDS.find(function (word) { return words.indexOf(word) !== -1; });
        if (hit) {
          return { id: "outdoor", source: "area", label: "Outdoor",
                   why: "The customer put this appliance in “" + (a.location || a.areaName || a.area) +
                        "” at registration. Nobody has confirmed it on site." };
        }
      }
    }

    return { id: "indoor", source: "default", label: "Indoor",
             why: "Nothing says otherwise. Indoor is the assumption, not an observation." };
  }

  window.WILSON_ENVIRONMENT = {
    for: environmentFor,
    outdoorWords: function () { return OUTDOOR_AREA_WORDS.slice(); },
    notOutdoorPhrases: function () { return NOT_OUTDOOR_PHRASES.slice(); },
    /* Whether an outdoor install changes anything about how long this kind of
       appliance lasts. Only refrigeration and ice so far: a built-in grill is
       already an outdoor figure, and there is no outdoor dishwasher. */
    lifeSensitive: function (line) { return line === "refrigeration" || line === "ice"; }
  };

  window.WILSON_BRANDS = {
    normalize: normalizeBrand,
    tierFor: tierForBrand,
    lineForAsset: lineForAsset,
    categoryForAsset: categoryForAsset,
    lineForSet: lineForSet,
    lines: function () { return JSON.parse(JSON.stringify(config.applianceLines || {})); },
    lifespanFor: brandLifespanFor,
    /* One sentence saying where a draft expected life came from. The report,
       the office screen and the field card all call this. */
    basisSentence: lifeBasisSentence,
    label: titleBrand,
    rows: function () { return JSON.parse(JSON.stringify(config.brandLifespans || [])); },
    serviceability: serviceabilityFor,
    notServiced: function () { return JSON.parse(JSON.stringify(config.notServicedBrands || [])); },
    notMaintainable: function () { return JSON.parse(JSON.stringify(config.notMaintainable || [])); },
    copy: function () { return JSON.parse(JSON.stringify(config.serviceabilityCopy || {})); }
  };
  window.WILSON_AGE = {
    sources: function () { return config.ageSources; },
    resolve: resolveAge,
    source: function (key) { return config.ageSources[key] || config.ageSources.unknown; }
  };
  /* ---------------------------------------------------------------------
     WATER HARDNESS -- THE ONE PLACE THAT ANSWERS "WHAT IS THIS HOUSE'S WATER
     WORTH TO THIS APPLIANCE".

     Every caller goes through here: the field tool's live score, the generated
     report, the household page and the SQL seed. A second implementation of
     this arithmetic is how the quote builder ended up quoting a different price
     from the enrolment screen, and it is not happening to the health score.
     ------------------------------------------------------------------ */
  function hardnessBand(gpg) {
    const value = Number(gpg);
    if (!Number.isFinite(value) || value < 0) return null;
    const bands = config.waterHardness.bands;
    for (let i = 0; i < bands.length; i += 1) {
      if (bands[i].max === null || value <= bands[i].max) return bands[i];
    }
    return bands[bands.length - 1];
  }

  function hardnessBandById(id) {
    return config.waterHardness.bands.find(function (b) { return b.id === id; }) || null;
  }

  /*
   * THE ALGORITHM: grains per gallon in, life multiplier out.
   *
   * Piecewise linear between the published anchors, flat outside them. Nobody
   * selects this and nothing else computes it -- it is the single function
   * standing between a strip reading and every water-bearing appliance in the
   * house.
   *
   * Returns null for anything that is not a usable reading, so a caller cannot
   * mistake "we could not read that" for "no adjustment needed". Those are
   * different sentences on a customer's report.
   */
  function lifeFactorForGpg(gpg) {
    const value = Number(gpg);
    const cfg = config.waterHardness;
    if (!Number.isFinite(value) || value < 0 || value > cfg.maxPlausibleGpg) return null;
    const anchors = cfg.lifeFactorAnchors;
    if (value <= anchors[0].gpg) return Number(anchors[0].factor);
    const last = anchors[anchors.length - 1];
    if (value >= last.gpg) return Number(last.factor);
    for (let i = 1; i < anchors.length; i += 1) {
      const lo = anchors[i - 1];
      const hi = anchors[i];
      if (value <= hi.gpg) {
        const t = (value - lo.gpg) / (hi.gpg - lo.gpg);
        /* Three decimals: enough that a 0.1 gpg difference is not rounded into
           nothing, few enough that the number on the report is readable. */
        return Math.round((lo.factor + t * (hi.factor - lo.factor)) * 1000) / 1000;
      }
    }
    return Number(last.factor);
  }

  /* Does this equipment run water at all? */
  function usesWater(setKey) {
    return config.waterHardness.waterBearingSets.indexOf(String(setKey || "")) >= 0;
  }

  /*
   * Resolve a household's water test into the thing the score needs.
   *
   * Returns `tested: false` and a factor of 1.00 when nobody has run a strip.
   * That is the honest default and the report says so -- an untested house is
   * never assumed hard, and never assumed soft either.
   */
  function resolveWater(test) {
    const cfg = config.waterHardness;
    /*
     * IDEMPOTENT ON PURPOSE.
     *
     * store.waterFor() hands back a RESOLVED reading, not the raw row, so it is
     * an easy and completely silent mistake to resolve one twice -- the second
     * pass reads `.softener` expecting an id and finds an object, matches
     * nothing, falls back to "unknown", and reports a house with a failed
     * softener as a house with no softener. It cost me a confusing screenshot
     * to find; it would cost the dashboard dev rather more. So a reading that
     * has already been resolved comes straight back out.
     */
    if (test && test.resolved === true) return test;
    /* One shape for every "we do not know" case, so callers never have to ask
       WHY it is untested before they can read it. */
    function untested(reason) {
      return { resolved: true, tested: false, gpg: null, band: null,
               lifeFactor: cfg.untestedFactor, flagged: false, reason: reason };
    }
    if (!test || (test.gpg === null || test.gpg === undefined || String(test.gpg).trim() === "")) {
      return untested("The water at this address has not been tested.");
    }
    const gpg = Number(test.gpg);
    const lifeFactor = lifeFactorForGpg(gpg);
    /* A reading the algorithm will not accept is a reading we do not have.
       Falling through here used to throw, which took the whole report down with
       it -- a fat-fingered keypad entry must never cost a customer their report,
       and must never be quietly rounded into a finding about their house
       either. */
    if (lifeFactor === null) {
      return untested("The water reading on file could not be read, so no adjustment is applied.");
    }
    const band = hardnessBand(gpg);
    /* The flag the customer sees. Soft and moderately hard water are worth
       stating on the report; from "hard" upward they are worth flagging, because
       that is the point at which there is something the customer could actually
       do about it. */
    const flagBand = hardnessBandById(cfg.customerFlagBand);
    const flagged = flagBand !== null && band !== null
      && cfg.bands.indexOf(band) >= cfg.bands.indexOf(flagBand);
    return {
      resolved: true,
      tested: true,
      gpg: gpg,
      band: band,
      lifeFactor: lifeFactor,
      flagged: flagged,
      reason: "Tested " + gpg + " gpg (" + band.label.toLowerCase() + ")."
    };
  }

  /*
   * Expected service life, adjusted for the water this appliance actually runs.
   *
   * THE single expected-life resolver. It used to live in tech-maintenance.js,
   * which meant the report, the household page and any future dashboard each had
   * to remember to apply the same adjustment -- and one of them would not have.
   */
  /* =====================================================================
     BRAND, RESOLVED ONCE                                        (v0.9.30)
     =====================================================================

     Every brand question -- what tier, how long does it last, do we even
     service it -- goes through `normalizeBrand` first. One matcher, so a fix
     to it fixes every caller, and a brand that resolves for the tier lookup
     cannot fail to resolve for the serviceability check.
     ================================================================== */

  /* A brand key matches as a WHOLE WORD, never as a substring. See the note on
     `brandAliases` for the two bugs substring matching was causing. */
  function brandTokenTest(haystack, key) {
    if (!key) return false;
    const esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)", "i").test(haystack);
  }

  function knownBrandKeys() {
    const keys = new Set();
    Object.keys(config.brandTierDefaults || {}).forEach((k) => keys.add(k));
    (config.brandLifespans || []).forEach((r) => keys.add(r.brand));
    (config.notServicedBrands || []).forEach((r) => keys.add(r.brand));
    (config.notMaintainable || []).forEach((r) => keys.add(r.brand));
    /* Longest first, so "bosch thermotechnology" is never shadowed by "bosch". */
    return Array.from(keys).sort((a, b) => b.length - a.length);
  }

  function normalizeBrand(brand) {
    const raw = String(brand == null ? "" : brand).trim().toLowerCase().replace(/\s+/g, " ");
    if (!raw) return "";
    const alias = config.brandAliases || {};
    if (alias[raw]) return alias[raw];
    const keys = knownBrandKeys();
    /* Exact first -- a brand that IS a key never needs the word test. */
    if (keys.indexOf(raw) > -1) return raw;
    /* Then an alias appearing as a whole word inside a longer string, so
       "GE Cafe CVE28DP2NS1" resolves to cafe rather than ge. */
    const aliasHit = Object.keys(alias)
      .sort((a, b) => b.length - a.length)
      .find((a) => brandTokenTest(raw, a));
    if (aliasHit) return alias[aliasHit];
    const hit = keys.find((k) => brandTokenTest(raw, k));
    return hit || "";
  }

  /*
   * Tier. THE one implementation -- tech-maintenance.js used to carry its own
   * substring version, which is where the Gaggenau and Fulgor bugs lived.
   *
   * `line` is optional and exists for one real case: Amana is a premium HVAC
   * brand and a mass appliance brand. A single brand->tier row has to be wrong
   * about one of them, and it was wrong about the appliance side -- giving an
   * Amana refrigerator the same 16-year expectation as a Bosch.
   */
  function tierForBrand(brand, line) {
    const key = normalizeBrand(brand);
    if (!key) return "premium";
    const byLine = (config.brandTierByLine || {})[key];
    if (byLine && line && byLine[line]) return byLine[line];
    if (byLine && byLine["*"] && line) return byLine["*"];
    return (config.brandTierDefaults || {})[key] || "premium";
  }

  /* The product line an asset belongs to, or "" when it has none. `generic` and
     `microwave` and `laundry` deliberately resolve to nothing: a fallback
     protocol is not a product line. */
  function lineForAsset(asset) {
    if (!asset) return "";
    const lines = config.applianceLines || {};
    const cat = String(asset.customerCategory || "").toLowerCase();
    const type = String(asset.type || asset.exactType || "").toLowerCase();
    let found = Object.keys(lines).find((id) =>
      (lines[id].categories || []).indexOf(cat) > -1 || (lines[id].types || []).indexOf(type) > -1);
    if (found) return found;
    const setKey = resolveCheckpointSet(asset);
    found = Object.keys(lines).find((id) => (lines[id].sets || []).indexOf(setKey) > -1);
    return found || "";
  }

  /*
   * The customer category an appliance belongs to, from whatever it happens to
   * carry. A record may hold a customer category already, an appliance TYPE
   * (`hood`), or neither -- seeded and imported records differ, and matching an
   * invoice needs both sides normalised through one table rather than each
   * consumer guessing.
   */
  function categoryForAsset(asset) {
    if (!asset) return "";
    const raw = String(asset.customerCategory || "").trim();
    if (raw && (config.customerApplianceCategories || []).some(function (c) { return c.id === raw; })) {
      return raw;
    }
    const typeId = raw || String(asset.exactType || asset.type || "").trim();
    const type = (config.applianceTypes || []).find(function (t) { return t.id === typeId; });
    if (type && type.customerCategory) return type.customerCategory;
    return raw;
  }

  function lineForSet(setKey) {
    const lines = config.applianceLines || {};
    return Object.keys(lines).find((id) => (lines[id].sets || []).indexOf(setKey) > -1) || "";
  }

  /*
   * The brand-and-line lifespan row for this appliance, or null.
   *
   * Resolution order, most specific first:
   *   1. brand + line + series   (matched against model text)
   *   2. brand + line
   *   3. nothing -- the caller falls back to lifecycleMatrix[set][tier]
   *
   * There is no brand-only step. Cayden's brand-wide figures were expanded into
   * one row per line when they were averaged, because the anchored half of the
   * average differs by line: Bosch is 12 everywhere in the field but the
   * published dishwasher and range figures are not the same number.
   */
  function brandLifespanFor(ident, setKey) {
    if (!ident) return null;
    const key = normalizeBrand(ident.brand);
    if (!key) return null;
    const line = ident.line || lineForSet(setKey);
    if (!line) return null;
    const rows = (config.brandLifespans || []).filter(function (r) {
      if (r.brand !== key) return false;
      if (r.line === line) return true;
      /* A brand-wide row only answers for the lines that brand actually sells.
         An absent `covers` list would silently mean "all lines" again, so it is
         treated as covering nothing and the category median answers instead. */
      return r.line === "*" && (r.covers || []).indexOf(line) > -1;
    });
    if (!rows.length) return null;
    const text = [ident.model, ident.description, ident.series]
      .filter(Boolean).join(" ").toLowerCase();
    function seriesHit(r) {
      return r.series && (r.series.match || [])
        .some(function (m) { return text.indexOf(String(m).toLowerCase()) > -1; });
    }
    /*
     * Most specific wins, and a named line always beats a brand-wide figure:
     *   1. this line's series row, if the model text matches
     *   2. this line's plain row
     *   3. a brand-wide series row, if the model text matches
     *   4. the brand-wide plain row
     * A series row never wins by existing -- with no model text there is nothing
     * to match, and the plain row is the honest answer.
     */
    const row =
      rows.find(function (r) { return r.line === line && seriesHit(r); }) ||
      rows.find(function (r) { return r.line === line && !r.series; }) ||
      rows.find(function (r) { return r.line === "*" && seriesHit(r); }) ||
      rows.find(function (r) { return r.line === "*" && !r.series; }) ||
      null;
    if (!row) return null;
    /*
     * A precomputed row carries its own midpoint. A brand-wide row does not --
     * the anchored half depends on which line it landed on, so it is resolved
     * here against that line's column. Halves round UP either way: a short
     * expected life inflates "life used", which lowers the age score, and the
     * rounding error belongs on the side that does not cost somebody points.
     */
    let years = row.years, anchored = row.anchored == null ? null : Number(row.anchored);
    if (years == null) {
      const matrixSet = (config.applianceLines[line] || {}).matrixSet;
      const column = Number((config.lifecycleMatrix[matrixSet] || {})[row.tier]);
      anchored = isFinite(column) && column > 0 ? column : null;
      years = anchored == null ? Number(row.field) : Math.round((Number(row.field) + anchored) / 2);
    }
    return {
      years: Number(years),
      brand: key,
      line: line,
      tier: row.tier,
      brandWide: row.line === "*",
      series: row.series ? row.series.label : null,
      field: row.field == null ? null : Number(row.field),
      anchored: anchored,
      /* Whether this row is an OUTDOOR figure. Only the outdoor-only brands
         carry one -- Alfresco, Blaze, Coyote, DCS, Kalamazoo, Lynx. Everything
         else in the table is an indoor figure, which is what makes the gap
         below worth naming rather than papering over. */
      environment: row.environment || "indoor",
      label: row.series ? row.series.label : null
    };
  }

  /*
   * Can this appliance go on a plan at all?
   *
   * Returns one of four states with the wording every surface shares. HVAC is
   * never gated -- Wilson services any system -- so an HVAC asset always comes
   * back serviceable regardless of brand.
   */
  function serviceabilityFor(ident) {
    const isHvac = Boolean(ident && (ident.group === "hvac" ||
      String(ident.checkpointSet || "").indexOf("hvac_") === 0));
    const copy = config.serviceabilityCopy || {};
    const ok = { state: "ok", serviceable: true, maintainable: true, brand: "", customer: "", office: "", tech: "" };
    if (isHvac) return Object.assign({}, ok, { reason: "hvac_exempt" });
    const raw = String((ident && ident.brand) || "").trim();
    /* No brand yet is not a problem -- registration deliberately does not ask
       for one. It is only unknown once somebody has typed something. */
    if (!raw) return Object.assign({}, ok, { state: "unstated", reason: "no_brand_yet" });
    const key = normalizeBrand(raw);
    const blocked = (config.notServicedBrands || []).find((r) => r.brand === key);
    if (blocked) return {
      state: "not_serviced", serviceable: false, maintainable: false, brand: blocked.label,
      customer: (copy.not_serviced || {}).customer || "", office: (copy.not_serviced || {}).office || "",
      tech: (copy.not_serviced || {}).tech || ""
    };
    const inert = (config.notMaintainable || []).find((r) => r.brand === key);
    if (inert) return {
      state: "not_maintainable", serviceable: true, maintainable: false, brand: inert.label,
      because: inert.because || "",
      customer: (copy.not_maintainable || {}).customer || "", office: (copy.not_maintainable || {}).office || "",
      tech: (copy.not_maintainable || {}).tech || ""
    };
    if (!key) return {
      state: "unknown", serviceable: true, maintainable: true, brand: raw,
      customer: (copy.unknown_brand || {}).customer || "", office: (copy.unknown_brand || {}).office || "",
      tech: (copy.unknown_brand || {}).tech || ""
    };
    return Object.assign({}, ok, { brand: raw });
  }

  /*
   * `ident` is optional and carries {brand, model, line, description}. Passing
   * it is what lets the brand-and-line table win over the tier column; omitting
   * it gives the pre-v0.9.30 behaviour exactly, which is why every existing
   * caller kept working while they were converted one at a time.
   */
  /*
   * A PROTOCOL SET IS NOT ALWAYS A LIFECYCLE CATEGORY.           (v0.9.37)
   *
   * Splitting `cooking` into cooktop / oven / range / warming drawer created
   * four protocol sets where the lifecycle table has one category, and
   * `lifecycleMatrix[setKey]` returned undefined for three of them -- so a wall
   * oven with no brand row would have silently fallen through to the GENERIC
   * fallback and been given the ten-year figure meant for an appliance nobody
   * has classified.
   *
   * The appliance-line table already knows the answer: every line declares its
   * `matrixSet`. Resolved through it, so splitting a protocol never again
   * quietly changes an expected life. Copying the cooking row three times would
   * have been the other fix, and a duplicated row is what this project keeps
   * getting wrong.
   */
  function matrixSetFor(setKey) {
    if (config.lifecycleMatrix[setKey]) return setKey;
    const lineKey = lineForSet(setKey);
    const viaLine = ((config.applianceLines || {})[lineKey] || {}).matrixSet;
    if (viaLine && config.lifecycleMatrix[viaLine]) return viaLine;
    return "generic";
  }

  function expectedLife(setKey, tier, water, ident) {
    const matrixKey = matrixSetFor(setKey);
    const matrix = config.lifecycleMatrix[matrixKey] || config.lifecycleMatrix.generic;
    const brandRow = brandLifespanFor(ident, setKey);
    const base = brandRow
      ? brandRow.years
      : Number(matrix[tier] || (config.lifecycleTiers[tier] || {}).defaultYears || 10);
    /* Where the figure came from travels with it. A surface that prints a
       draft expected life should be able to say whether it is specific to this
       brand and line or a category median, without re-deriving it. */
    const basis = brandRow
      ? { kind: "brand", brand: brandRow.brand, line: brandRow.line, series: brandRow.series,
          field: brandRow.field, anchored: brandRow.anchored, environment: brandRow.environment }
      /* `set` is the LIFECYCLE category the figure actually came from, which is
         what the sentence and the sources table need -- not the protocol set,
         which may be one of several sharing it. */
      : { kind: "category", set: matrixKey, tier: tier, brand: null, line: null, series: null,
          environment: "indoor" };

    /*
     * AN OUTDOOR INSTALL WITH AN INDOOR FIGURE.                 (v0.9.37)
     *
     * Wilson's outdoor figures exist only for the brands that make nothing
     * else -- Alfresco, Blaze, Coyote, DCS, Kalamazoo, Lynx. But True,
     * Sub-Zero, Perlick, Hestan and Marvel all sell BOTH, and the table has one
     * figure per brand and line. So an outdoor True undercounter, sitting in a
     * Texas enclosure with no rear clearance, was being handed True's indoor
     * twenty years.
     *
     * What this does NOT do is quietly swap in the eight-year outdoor class
     * figure. Cayden gave that figure for six specific brands; applying it to a
     * brand he did not rate would be inventing a number and hiding it inside a
     * resolver -- the exact move this product exists not to make. An outdoor
     * Sub-Zero may well outlast an outdoor Blaze by a decade and only Cayden
     * knows.
     *
     * So the figure stands, the gap is FLAGGED, and every surface that prints
     * the number says the install is outdoors and that Wilson has no outdoor
     * figure for this brand yet. `_qa/verify-outdoor-install.js` prints the
     * list of brand-and-line pairs that need one.
     */
    const env = ident && ident.environment ? String(ident.environment) : null;
    if (env === "outdoor") {
      basis.installedOutdoors = true;
      basis.environmentGap = basis.environment !== "outdoor";
    }
    if (!water || !water.tested || !usesWater(setKey) || Number(water.lifeFactor) >= 1) {
      return { base: base, adjusted: base, factor: 1, applied: false,
               waterBearing: usesWater(setKey), basis: basis };
    }
    const factor = Number(water.lifeFactor);
    return {
      base: base,
      adjusted: Math.round(base * factor * 10) / 10,
      factor: factor,
      applied: true,
      waterBearing: true,
      basis: basis
    };
  }

  /* ---------------------------------------------------------------------
     WHERE A DRAFT EXPECTED LIFE CAME FROM, IN A SENTENCE.        (v0.9.37)

     `expectedLife` already returns the basis. Until now only the field card
     printed it, and it printed it in its own words -- so an icemaker's 11
     years and a dishwasher's 15 arrived on a customer's report with identical
     authority and no way to tell that one is Wilson's own field figure with no
     published corroboration and the other is the midpoint of two agreeing
     numbers.

     One builder, three audiences, so the customer's report, the office screen
     and the technician's card cannot describe the same figure differently.
     `audience` is "customer" | "office" | "tech".
     --------------------------------------------------------------------- */
  function lifeBasisSentence(basis, years, audience) {
    if (!basis) return "";
    const who = audience || "customer";
    const yrs = Number(years);
    const n = isFinite(yrs) && yrs > 0 ? yrs + " year" + (yrs === 1 ? "" : "s") : "This figure";
    const lead = isFinite(yrs) && yrs > 0 ? n + " is " : "This figure is ";

    if (basis.kind !== "brand") {
      const tierLabel = ((config.lifecycleTiers || {})[basis.tier] || {}).label || basis.tier || "";
      const setSource = (config.lifecycleSources || {})[basis.set] || {};
      if (who === "tech") {
        return "Category median (" + (basis.set || "generic") + " / " + (basis.tier || "premium") +
          "). No Wilson brand row for this brand and line." +
          (setSource.basis ? " " + setSource.basis + "." : "") + outdoorCaveat(basis, who);
      }
      if (who === "office") {
        return lead + "the category figure for appliances of this type in the " +
          (tierLabel || "premium") + " tier. Wilson's brand table has no row for this brand and " +
          "product line yet" +
          (setSource.sourced ? "" : ", and the category figure is a Wilson estimate rather than a published one") + "." +
          outdoorCaveat(basis, who);
      }
      return lead + "the general figure we use for appliances of this type and quality. " +
        "We do not yet have a Wilson-specific figure for this brand." + outdoorCaveat(basis, who);
    }

    const lines = config.applianceLines || {};
    const lineEntry = lines[basis.line] || {};
    /* `label` is a table heading ("Dish", "Washer"); `prose` is the noun a
       sentence needs ("dishwashers"). Printing the heading gave a customer
       "Wilson's own figure for Bosch dish". */
    const lineLabel = (who === "tech"
      ? (lineEntry.label || basis.line || "")
      : (lineEntry.prose || lineEntry.label || basis.line || "")).toLowerCase();
    const brandLabel = titleBrand(basis.brand) + (basis.series ? " " + basis.series : "");
    const subject = (brandLabel + " " + lineLabel).trim();
    const hasField = basis.field !== null && basis.field !== undefined;
    const hasAnchor = basis.anchored !== null && basis.anchored !== undefined;

    if (who === "tech") {
      if (hasField && hasAnchor) return subject + " · midpoint of Wilson's " + basis.field + " yr and the published " + basis.anchored + " yr" + outdoorCaveat(basis, who);
      if (hasField) return subject + " · Wilson's " + basis.field + " yr, no published figure for this category" + outdoorCaveat(basis, who);
      return subject + " · Wilson brand row" + outdoorCaveat(basis, who);
    }
    if (hasField && hasAnchor) {
      const same = Number(basis.field) === Number(basis.anchored);
      return lead + "Wilson's own figure for " + subject + " — " +
        (same
          ? "what we see in the field, and the published industry figure agrees."
          : "the midpoint of the " + basis.field + " years we see in the field and the " +
            basis.anchored + " years published for this class of appliance.") +
        outdoorCaveat(basis, who);
    }
    if (hasField) {
      return lead + "Wilson's own figure for " + subject + ", from what we see in the field. " +
        "No published service-life figure covers this kind of appliance, so it stands on our experience alone." +
        outdoorCaveat(basis, who);
    }
    return lead + "Wilson's own figure for " + subject + "." + outdoorCaveat(basis, who);
  }

  /*
   * The sentence that has to follow an outdoor install with an indoor figure.
   *
   * Appended rather than woven in, because it is a caveat ON the figure and not
   * part of how the figure was derived -- and because every branch above needs
   * it and none of them should be able to forget it.
   */
  function outdoorCaveat(basis, who) {
    if (!basis || !basis.installedOutdoors) return "";
    if (!basis.environmentGap) {
      return who === "tech"
        ? " · outdoor figure"
        : " This is our outdoor figure for this brand.";
    }
    if (who === "tech") return " · OUTDOOR INSTALL, indoor figure — no outdoor row for this brand";
    if (who === "office") {
      return " This unit is installed outdoors and Wilson has no outdoor figure for this brand and line yet, " +
        "so the indoor figure is shown. Treat it as the optimistic end.";
    }
    return " This appliance is installed outdoors, where equipment works harder and tends not to last as long. " +
      "We do not yet have a separate outdoor figure for this brand, so the figure above is the indoor one \u2014 " +
      "treat it as the longer end of what to expect.";
  }

  /* "sub-zero" is how the table keys a brand; it is not how a customer's
     report should spell it. */
  function titleBrand(key) {
    const raw = String(key || "").trim();
    if (!raw) return "this brand";
    const exact = { "sub-zero": "Sub-Zero", "lg": "LG", "ge": "GE", "dcs": "DCS", "u-line": "U-Line",
                    "aga": "AGA", "bertazzoni": "Bertazzoni", "american outdoor grill": "American Outdoor Grill",
                    "jenn-air": "Jenn-Air", "kitchenaid": "KitchenAid", "bluestar": "BlueStar",
                    "eurocave": "EuroCave", "vent-a-hood": "Vent-A-Hood", "zephyr": "Zephyr" };
    if (exact[raw]) return exact[raw];
    return raw.split(/([ -])/).map(function (part) {
      return /^[ -]$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1);
    }).join("");
  }

  window.WILSON_WATER = {
    bands: function () { return config.waterHardness.bands.slice(); },
    band: hardnessBand,
    bandById: hardnessBandById,
    /* The multiplier, from the number and nothing else. Exposed so a test can
       reach it directly rather than only through a resolved reading. */
    lifeFactorForGpg: lifeFactorForGpg,
    anchors: function () { return config.waterHardness.lifeFactorAnchors.slice(); },
    maxPlausibleGpg: function () { return config.waterHardness.maxPlausibleGpg; },
    usesWater: usesWater,
    resolve: resolveWater,
    expectedLife: expectedLife,
    /* Kept on WILSON_WATER as well, so the one resolver stays the one resolver
       even for a caller that only has a set key and a tier. */
    basis: function () { return config.waterHardness.basis; },
    sourced: function () { return Boolean(config.waterHardness.sourced); }
  };

  /* ---------------------------------------------------------------------
     WHAT AN APPLIANCE PLAN COSTS -- THE ONE PLACE THAT ANSWERS IT.

     This arithmetic used to live inside appliance-builder.js, which is a SCREEN
     file, and that is precisely why quote-builder.js could not reuse it: a
     second screen needing a price had no way to ask for one, so it wrote its
     own. Its version had no concept of filter service, and an 18-appliance
     house was quoted $1,874.90 on Estate Annual and enrolled at $2,224.90.

     Pricing is a business rule, so it lives with the business rules. Both
     enrollment exits, the quote document, the seed data and any future
     dashboard call THIS.

     `assets` is the per-unit list -- one entry per physical appliance, the same
     shape createEnrollment stores. Not a type-with-quantity list; that was the
     old quote builder's shape and it is how an icemaker's second visit went
     uncounted.
     ------------------------------------------------------------------ */
  function planById(planId) {
    return config.appliancePlans[planId] || config.appliancePlans.per_appliance;
  }

  function planVisitsPerYear(planId) {
    return Number(planById(planId).visitsPerYear || 1);
  }

  function imucAssets(assets) {
    return (assets || []).filter(function (a) { return a.group === "imuc"; });
  }

  /* Second icemaker visits are only an extra charge on a plan that does not
     already send somebody twice. */
  function imucSecondVisitCount(assets, planId) {
    if (planVisitsPerYear(planId) >= 2) return 0;
    return imucAssets(assets).filter(function (a) {
      return Number(a.imucVisitsPerYear) >= 2;
    }).length;
  }

  function estateAdjustment(assets, planId) {
    const extraCount = Math.max(0, (assets || []).length - config.estatePricing.includedAppliances);
    const rate = config.estatePricing.additionalPerAppliance[planId] || 0;
    return { extraCount: extraCount, rate: rate, amount: extraCount * rate };
  }

  /* Per-appliance pricing, FIRST visits only: every standard appliance once,
     every icemaker once. The recommended second icemaker visit is a separate
     line on every plan, and folding it in here as well is how the stored
     breakdown came to double-count it -- the total was right, so nothing
     surfaced it until the quote document started printing the line items. */
  function perApplianceFirstVisits(assets) {
    const standardCount = (assets || []).filter(function (a) { return a.group !== "imuc"; }).length;
    const imucCount = imucAssets(assets).length;
    return (standardCount * config.pricing.standardApplianceAnnual)
      + (imucCount * config.pricing.imucPerVisit);
  }

  function perApplianceCost(assets) {
    return perApplianceFirstVisits(assets)
      + (imucSecondVisitCount(assets, "per_appliance") * config.pricing.imucPerVisit);
  }

  /* ---------------------------------------------------------------------
     WILSON TEMP WATCH pricing -- the same single-engine rule as filters.
     Every caller prices monitoring through these two functions; a screen
     that multiplies 150 by a count on its own is the two-pricing-engines
     bug waiting to happen again.
     ------------------------------------------------------------------- */
  function tempMonitoringEligible(asset) {
    const tm = config.tempMonitoring || {};
    if (!tm.enabled) return false;
    const category = categoryFor(asset);
    return Boolean(category && (tm.eligibleCategories || []).indexOf(category.id) > -1);
  }

  /*
   * WHICH COMPARTMENTS AN APPLIANCE CAN CARRY A SENSOR IN, and which it
   * watches by default the moment Guardian is added. Wine units are wine
   * only; a freezer is freezer only; everything else in the refrigeration
   * family offers fresh food AND freezer (the Sub-Zero column case), with
   * fresh food as the default single sensor. (v0.9.47)
   */
  function tempMonitoringCompartmentsFor(asset) {
    if (!tempMonitoringEligible(asset)) return { allowed: [], defaults: [] };
    const hint = (norm(asset.exactType) + " " + norm(asset.type) + " " + norm(asset.typeLabel || ""));
    if (hint.indexOf("wine") > -1) return { allowed: ["wine"], defaults: ["wine"] };
    if (hint.indexOf("freezer") > -1 && hint.indexOf("refrigerator") === -1) {
      return { allowed: ["freezer"], defaults: ["freezer"] };
    }
    return { allowed: ["fresh_food", "freezer"], defaults: ["fresh_food"] };
  }

  /* The compartments an enrolled asset actually watches: its stored choice,
     else the defaults for its shape, else one sensor's worth (legacy
     records enrolled before compartments existed). */
  function tempMonitoringWatched(asset) {
    if (!tempMonitoringEligible(asset) || !asset.tempMonitoringOptIn) return [];
    const chosen = Array.isArray(asset.tempMonitoringCompartments)
      ? asset.tempMonitoringCompartments.filter(function (k) { return (config.tempMonitoring.compartments || {})[k]; })
      : [];
    if (chosen.length) return chosen;
    return tempMonitoringCompartmentsFor(asset).defaults;
  }

  /* Selection and sensor count only. Since v0.9.44 no single asset has a
     price of its own -- the household does (first sensor $199, each
     additional $99 on the member tier), so the money lives exclusively in
     tempMonitoringTotal and every "what does adding THIS one cost" answer is
     total(with) minus total(without). A sensor is a compartment watched. */
  function tempMonitoringForAsset(asset) {
    const watched = tempMonitoringWatched(asset);
    if (!watched.length) return { selected: false, sensors: 0, compartments: [] };
    return { selected: true, sensors: watched.length, compartments: watched };
  }

  function tempMonitoringTiers() {
    const tm = config.tempMonitoring || {};
    return JSON.parse(JSON.stringify(tm.pricing || {}));
  }

  function tempMonitoringTotal(assets, tier) {
    const pricing = ((config.tempMonitoring || {}).pricing || {})[tier || "member"];
    if (!pricing) return 0;
    const sensors = (assets || []).reduce(function (n, asset) {
      return n + tempMonitoringForAsset(asset).sensors;
    }, 0);
    if (!sensors) return 0;
    return Number(pricing.firstAnnual || 0) + (sensors - 1) * Number(pricing.additionalAnnual || 0);
  }

  /* Selected filter service raises the annual plan price on every plan except
     Estate Concierge, which includes filters outright. Temp monitoring is
     priced on every plan -- nothing includes it yet. */
  function applianceAnnualCost(assets, planId) {
    /* CENTS here too (v0.9.48): chargeSchedule already rounded, but this --
       the figure that gets PERSISTED on subscriptions and exported -- could
       leak 449.84999999999997 into the record. Same rule, one line. */
    const cents = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    const filterCost = filterServiceTotal(assets, planId);
    const monitoringCost = tempMonitoringTotal(assets);
    if (planId === "per_appliance") return cents(perApplianceCost(assets) + filterCost + monitoringCost);
    return cents(planById(planId).annualPrice
      + estateAdjustment(assets, planId).amount
      + (imucSecondVisitCount(assets, planId) * config.pricing.imucPerVisit)
      + filterCost
      + monitoringCost);
  }

  /*
   * The line items behind that total, in one object.
   *
   * Returned rather than recomputed by each caller, because a summary panel
   * that adds up its own lines and a total computed separately are two numbers
   * that can disagree on screen at the same time.
   */
  function appliancePricingBreakdown(assets, planId) {
    const list = assets || [];
    const cents = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    return {
      /* First visits only -- the second-icemaker line below carries the rest,
         so these lines sum to the total instead of overshooting it. */
      basePlanAmount: cents(planId === "per_appliance"
        ? perApplianceFirstVisits(list) : planById(planId).annualPrice),
      largeEstateAdjustment: planId === "per_appliance"
        ? 0 : estateAdjustment(list, planId).amount,
      imucSecondVisitCount: imucSecondVisitCount(list, planId),
      imucSecondVisitAmount: imucSecondVisitCount(list, planId) * config.pricing.imucPerVisit,
      applianceCount: list.length,
      refrigerationFilterServiceCount: list.filter(function (a) {
        return filterServiceForAsset(a, planId).lines.length;
      }).length,
      filterServiceDetail: filterServiceSummary(list, planId),
      filterServiceAmount: cents(filterServiceTotal(list, planId)),
      tempMonitoringCount: list.filter(function (a) { return tempMonitoringForAsset(a).selected; }).length,
      tempMonitoringSensors: list.reduce(function (n, a) { return n + tempMonitoringForAsset(a).sensors; }, 0),
      tempMonitoringAmount: tempMonitoringTotal(list),
      customReviewRequired: list.length >= config.estatePricing.customReviewStartsAt
    };
  }

  /*
   * WHAT HITS THE CARD, AND WHEN.
   *
   * The annual figure is not what the customer's card sees. A 12-appliance
   * house with two icemakers on Estate Annual is quoted $1,694.90 "per year"
   * and is actually charged $1,195.00 at the first visit and $499.90 about five
   * months later. On Preferred and Concierge the ENTIRE annual amount lands on
   * the first visit and the second is $0. Neither of those is what "per year"
   * sounds like, and until v0.9.25 neither was shown anywhere.
   *
   * This split used to live inside createEnrollment, where the signup screen
   * could not reach it -- so previewing it would have meant a second copy of
   * the rule, which is exactly how the quote screen came to under-quote by
   * $350. It lives here now, and store.js builds its visits FROM this.
   *
   * Returns one entry per visit that a charge is attached to, in order. Amounts
   * always sum to the annual total; that is asserted in the QA suite.
   */
  function applianceChargeSchedule(assets, planId) {
    /* CENTS, EVERYWHERE. These figures are charged, not just displayed, and
       floating-point multiplication leaks: 3 x $249.95 evaluates to
       749.8499999999999, which was reaching a customer's charge schedule as a
       stored amount. Rounding at this boundary keeps every leg a real price. */
    const cents = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    const annual = cents(applianceAnnualCost(assets, planId));
    const visits = planVisitsPerYear(planId);
    const secondImuc = imucSecondVisitCount(assets, planId);
    const secondImucAmount = cents(secondImuc * config.pricing.imucPerVisit);
    /* Two-visit plans divide the year between their visits (v0.9.26). They used
       to bill all of it at the first visit and $0 at the second, which made
       "per year" misleading and put a large charge before the second visit had
       happened. */
    if (visits >= 2) {
      /* Split by the configured weights rather than billing the year up front.
         The remainder lands on the first leg via subtraction, so the two always
         add back to `annual` exactly however the weights round. */
      const weights = config.visitChargeSplit.twoVisit;
      const second = cents(annual * weights[1]);
      const first = cents(annual - second);
      return [
        { key: "initial", label: "First visit", dayOffset: 30, amount: first,
          note: "Half of the plan year" },
        { key: "second", label: "Second visit", dayOffset: 210, amount: second,
          note: "The balance of the plan year, at the second visit" }
      ];
    }
    /* One-visit plans: the plan itself at the first visit, and the recommended
       second icemaker visit later, if there is one. */
    const initial = Math.max(0, cents(annual - secondImucAmount));
    const schedule = [
      { key: "initial", label: "First visit", dayOffset: 30, amount: initial,
        note: "The annual plan" }
    ];
    if (secondImucAmount > 0) {
      schedule.push({
        key: "imuc_second", label: "Second icemaker visit", dayOffset: 210,
        amount: secondImucAmount,
        note: secondImuc + " icemaker" + (secondImuc === 1 ? "" : "s") + ", second visit of the year"
      });
    }
    return schedule;
  }

  /* ---------------------------------------------------------------------
     SCHEDULING PREFERENCES -- THE ONE PLACE THAT READS THEM.

     A preference is stored as ids, never as prose, so that every screen renders
     the same constraint the same way and the office is never interpreting a
     sentence somebody typed. `summary` is the one-line version for a table;
     `lines` is the version for a screen where somebody is about to place a
     ticket in ePass.
     ------------------------------------------------------------------ */
  function schedulingOptions() { return config.schedulingPreference; }

  function labelsFor(kind, ids) {
    const list = config.schedulingPreference[kind] || [];
    return (ids || []).map(function (id) {
      const found = list.find(function (o) { return o.id === id; });
      return found ? found.label : null;
    }).filter(Boolean);
  }

  /* Contiguous months collapse into a range: "Mar–May" reads faster than
     "Mar, Apr, May", and an office scanning twenty households is scanning. */
  function monthPhrase(ids) {
    const order = config.schedulingPreference.months.map(function (m) { return m.id; });
    const picked = order.filter(function (id) { return (ids || []).indexOf(id) >= 0; });
    if (!picked.length) return "";
    const runs = [];
    picked.forEach(function (id) {
      const index = order.indexOf(id);
      const last = runs[runs.length - 1];
      if (last && index === last.end + 1) { last.end = index; return; }
      runs.push({ start: index, end: index });
    });
    return runs.map(function (run) {
      const from = labelsFor("months", [order[run.start]])[0];
      const to = labelsFor("months", [order[run.end]])[0];
      return run.start === run.end ? from : from + "–" + to;
    }).join(", ");
  }

  function dayPhrase(ids) {
    const all = config.schedulingPreference.days.map(function (d) { return d.id; });
    const picked = (ids || []).filter(function (id) { return all.indexOf(id) >= 0; });
    if (!picked.length || picked.length === all.length) return "";
    const weekdays = ["mon", "tue", "wed", "thu", "fri"];
    const isWeekdays = picked.length === weekdays.length
      && weekdays.every(function (d) { return picked.indexOf(d) >= 0; });
    if (isWeekdays) return "Weekdays";
    return labelsFor("days", all.filter(function (d) { return picked.indexOf(d) >= 0; })).join(", ");
  }

  function blackoutList(pref) {
    return ((pref && pref.blackouts) || []).filter(function (b) { return b && b.from; });
  }

  function schedulingIsEmpty(pref) {
    if (!pref) return true;
    return !(pref.months || []).length && !(pref.days || []).length
      && (!pref.timeOfDay || pref.timeOfDay === "any")
      && !blackoutList(pref).length && !(pref.access || []).length
      && !String(pref.note || "").trim();
  }

  function schedulingSummary(pref) {
    if (schedulingIsEmpty(pref)) return "No timing preference";
    const parts = [];
    const months = monthPhrase(pref.months);
    if (months) parts.push(months);
    const days = dayPhrase(pref.days);
    if (days) parts.push(days);
    if (pref.timeOfDay && pref.timeOfDay !== "any") {
      parts.push(labelsFor("timesOfDay", [pref.timeOfDay])[0]);
    }
    const outs = blackoutList(pref).length;
    if (outs) parts.push(outs + " blackout" + (outs === 1 ? "" : "s"));
    const access = (pref.access || []).length;
    if (access) parts.push(access + " access note" + (access === 1 ? "" : "s"));
    return parts.join(" · ") || "No timing preference";
  }

  /* The version for somebody about to place a ticket. Access constraints carry
     the OFFICE wording, not the customer's -- "Gate access needed, Wilson to
     collect the code by phone" is an instruction; "Gated entry" is a label. */
  function schedulingLines(pref) {
    if (schedulingIsEmpty(pref)) return [];
    const lines = [];
    const months = monthPhrase(pref.months);
    if (months) lines.push({ kind: "months", label: "Preferred months", value: months });
    const days = dayPhrase(pref.days);
    if (days) lines.push({ kind: "days", label: "Days", value: days });
    if (pref.timeOfDay && pref.timeOfDay !== "any") {
      lines.push({ kind: "time", label: "Time of day", value: labelsFor("timesOfDay", [pref.timeOfDay])[0] });
    }
    /* `from`/`to` are carried raw so the VIEW formats the dates. plan-config has
       no business knowing how Wilson writes a date, and it cannot reach ui.js
       anyway -- the office panel was rendering "2027-01-24 to 2027-02-14"
       because this returned a pre-joined ISO string as its display value. */
    blackoutList(pref).forEach(function (b) {
      lines.push({
        kind: "blackout", label: "Not available",
        from: b.from, to: b.to && b.to !== b.from ? b.to : "",
        value: b.to && b.to !== b.from ? b.from + " to " + b.to : b.from,
        detail: b.note || ""
      });
    });
    (pref.access || []).forEach(function (id) {
      const found = config.schedulingPreference.accessConstraints
        .find(function (a) { return a.id === id; });
      if (found) lines.push({ kind: "access", label: "Access", value: found.office, attention: true });
    });
    if (String(pref.note || "").trim()) {
      lines.push({ kind: "note", label: "Customer note", value: String(pref.note).trim() });
    }
    return lines;
  }

  window.WILSON_SCHEDULING = {
    options: schedulingOptions,
    isEmpty: schedulingIsEmpty,
    summary: schedulingSummary,
    lines: schedulingLines,
    monthPhrase: monthPhrase,
    dayPhrase: dayPhrase
  };

  /*
   * PRORATION, in one place.                                     (v0.9.43)
   *
   * Cayden: "if its a multi per year visit setup, it should prorate and fall
   * into the normal billing schedule on the following interval." So a
   * mid-cycle amendment bills TODAY only for the part of the plan year still
   * ahead, and the renewal simply bills the new annual -- the normal
   * schedule absorbs the change from the next interval on.
   *
   * The rule is arithmetic and lives here so the approval screen, the store
   * record and the office queue can never disagree about the figure the
   * customer signed: billedNow = difference × (days until renewal / 365),
   * clamped to [0, 1]. A missing renewal date falls back to the full
   * difference -- the honest default, since it never under-charges silently.
   */
  function prorateDifference(difference, renewalOn, asOf) {
    const diff = Number(difference) || 0;
    if (!renewalOn) return { amount: Math.round(diff * 100) / 100, factor: 1, daysRemaining: null, renewalPassed: false };
    const now = asOf ? new Date(asOf) : new Date();
    const renewal = new Date(String(renewalOn).slice(0, 10) + "T00:00:00");
    const daysRemaining = Math.round((renewal - now) / 86400000);
    /*
     * v0.9.48, from the audit: a renewal date on or before today used to
     * clamp the factor to ZERO -- the customer signed for a real increase and
     * the office was told to charge nothing, with no renewal machinery to
     * ever collect it. A passed renewal means the next plan year has
     * effectively begun, so the honest charge is the FULL difference, and
     * the record says why.
     */
    if (daysRemaining <= 0) {
      return { amount: Math.round(diff * 100) / 100, factor: 1, daysRemaining: 0, renewalPassed: true };
    }
    const factor = Math.min(1, daysRemaining / 365);
    return {
      amount: Math.round(diff * factor * 100) / 100,
      factor: Math.round(factor * 1000) / 1000,
      daysRemaining: daysRemaining,
      renewalPassed: false
    };
  }

  /*
   * WHAT AN AMENDMENT BILLS TODAY.                               (v0.9.49)
   *
   * Cayden's correction: "the tech is going to perform the maintenance while
   * hes there. so we should charge full price for it. i thought about this
   * wrong." An ADDED appliance is serviced at this visit -- the customer
   * gets the full year's service starting now, so the increase bills at
   * full price, not prorated to the days left on the plan year.
   *
   * Everything else keeps the v0.9.43 proration: removals, plan changes and
   * add-on tweaks are coverage changes, not service delivered today. One
   * implementation, called by both the approval screen and the store, so the
   * number the customer signs is the number the office charges.
   */
  function amendmentBilling(difference, renewalOn, options) {
    const opts = options || {};
    const diff = Number(difference) || 0;
    if (opts.hasAdditions && diff > 0) {
      return {
        amount: Math.round(diff * 100) / 100,
        factor: 1,
        daysRemaining: null,
        renewalPassed: false,
        servicedNow: true
      };
    }
    return prorateDifference(diff, renewalOn, opts.asOf);
  }

  window.WILSON_PRICING = {
    plan: planById,
    visitsPerYear: planVisitsPerYear,
    annual: applianceAnnualCost,
    breakdown: appliancePricingBreakdown,
    chargeSchedule: applianceChargeSchedule,
    estateAdjustment: estateAdjustment,
    perAppliance: perApplianceCost,
    imucSecondVisitCount: imucSecondVisitCount,
    prorateDifference: prorateDifference,
    amendmentBilling: amendmentBilling
  };

  window.WILSON_TEMPWATCH = {
    config: function () { return JSON.parse(JSON.stringify(config.tempMonitoring || {})); },
    eligible: tempMonitoringEligible,
    forAsset: tempMonitoringForAsset,
    compartmentsFor: tempMonitoringCompartmentsFor,
    watched: tempMonitoringWatched,
    tiers: tempMonitoringTiers,
    total: tempMonitoringTotal
  };

  window.WILSON_FILTERS = {
    kinds: filterKinds,
    kindsFor: filterServiceKindsFor,
    eligible: filterServiceEligible,
    planIncludesFilters: planIncludesFilters,
    quantity: filterQuantity,
    forAsset: filterServiceForAsset,
    total: filterServiceTotal,
    summary: filterServiceSummary
  };
})();
