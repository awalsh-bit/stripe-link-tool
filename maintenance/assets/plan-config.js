(function () {
  const config = {
    version: "0.6",
    currency: "USD",
    assumptions: {
      imucRecommendedVisits: 2,
      imucGuidance: "Manufacturer guidance generally recommends cleaning and maintenance twice per year.",
      estateAutoSwitchRule: "Automatically select the lowest-cost appropriate starting plan for the exact appliance mix, including recommended second IMUC visits.",
      estatePricingStatus: "Draft base-plus proposal for review",
      paymentTiming: "The card is placed on file at enrollment and charged when a scheduled maintenance interval is ready to proceed.",
      renewal: "Plans renew annually until canceled by the customer.",
      hvacAnnualVisits: 2,
      hvacVisitTiming: "Spring and fall, weather permitting.",
      serviceOrderTarget: "NetSuite - integration pending",
      applianceScopeExclusions: ["BBQ / grill cleaning", "Disassembly unless separately approved"]
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
          "Manufacturer-recommended second IMUC visit available",
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
      pricing: {
        pricingStatus: "Placeholder pricing - awaiting Wilson filter sales-price list",
        currency: "USD",
        billingBasis: "annual",
        kinds: {
          water: {
            id: "water",
            label: "Water filter service",
            shortLabel: "Water filters",
            unitPrice: 70,
            defaultQuantity: 1,
            description: "Track and replace the appliance's water filter(s) at scheduled maintenance.",
            customerNote: "Priced per water filter. Wilson verifies the exact count and part numbers on the first visit."
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
      { id: "cooktop", label: "Cooktop / Rangetop", shortLabel: "Cooktop / Rangetop", icon: "cooktop.svg", group: "standard", checkpointSet: "cooking", filterTypes: [], help: "Gas, electric, or induction cooking surface" },
      { id: "range", label: "Range", shortLabel: "Range", icon: "range.svg", group: "standard", checkpointSet: "cooking", filterTypes: [], help: "Freestanding, slide-in, or professional range" },
      { id: "dishwasher", label: "Dishwasher", shortLabel: "Dishwasher", icon: "dishwasher.svg", group: "standard", checkpointSet: "dishwasher", filterTypes: [], help: "Built-in top-control dishwasher" },
      { id: "ventilation", label: "Ventilation", shortLabel: "Ventilation", icon: "ventilation.svg", group: "standard", checkpointSet: "ventilation", filterTypes: [], help: "Hood, liner, insert, or downdraft" },
      { id: "microwave", label: "Microwave", shortLabel: "Microwave", icon: "microwave.svg", group: "standard", checkpointSet: "microwave", filterTypes: [], help: "Built-in, over-the-range, drawer, countertop, or speed oven" },
      { id: "ovens", label: "Ovens", shortLabel: "Ovens", icon: "ovens.svg", group: "standard", checkpointSet: "cooking", filterTypes: [], help: "Single, double, steam, or combination wall oven" },
      { id: "warming_drawer", label: "Warming Drawer", shortLabel: "Warming Drawer", icon: "warming_drawer.svg", group: "standard", checkpointSet: "cooking", filterTypes: [], help: "Built-in warming or proofing drawer" },
      { id: "coffee", label: "Built-In Coffee", shortLabel: "Built-In Coffee", icon: "coffee.svg", group: "standard", checkpointSet: "generic", filterTypes: [], help: "Plumbed or reservoir built-in coffee system" },
      { id: "washer", label: "Washer", shortLabel: "Washer", icon: "washer.svg", group: "standard", checkpointSet: "washer", filterTypes: [], help: "Front-load or top-load washer" },
      { id: "dryer", label: "Dryer", shortLabel: "Dryer", icon: "dryer.svg", group: "standard", checkpointSet: "dryer", filterTypes: [], help: "Electric, gas, heat-pump, or ventless dryer" }
    ],
    applianceTypes: [
      { id: "refrigerator", label: "Refrigerator", group: "standard", checkpointSet: "refrigerator", filterTypes: ["Refrigerator water filter", "Refrigerator air / food-preservation filter"] },
      { id: "freezer", label: "Freezer", group: "standard", checkpointSet: "refrigerator", filterTypes: ["Freezer water filter"] },
      { id: "wine_beverage", label: "Wine / Beverage Center", group: "standard", checkpointSet: "refrigerator", filterTypes: [] },
      { id: "ice_maker", label: "Icemaker (IMUC)", group: "imuc", checkpointSet: "icemaker", filterTypes: ["Icemaker water filter"] },
      { id: "dishwasher", label: "Dishwasher", group: "standard", checkpointSet: "dishwasher", filterTypes: [] },
      { id: "range", label: "Range", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "cooktop", label: "Cooktop / Rangetop", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "wall_oven", label: "Wall Oven", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "speed_oven", label: "Microwave / Speed Oven", group: "standard", checkpointSet: "microwave", filterTypes: [] },
      { id: "washer", label: "Washer", group: "standard", checkpointSet: "washer", filterTypes: [] },
      { id: "dryer", label: "Dryer", group: "standard", checkpointSet: "dryer", filterTypes: [] },
      { id: "hood", label: "Vent Hood", group: "standard", checkpointSet: "ventilation", filterTypes: [] },
      { id: "hood_insert", label: "Hood Insert / Liner", group: "standard", checkpointSet: "ventilation", filterTypes: [] },
      { id: "warming_drawer", label: "Warming Drawer", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "coffee_maker", label: "Built-In Coffee Maker", group: "standard", checkpointSet: "generic", filterTypes: [] },
      // RESOLVED 2026-08-24 (context §34 item 13, decided by Wilson): a combined
      // WashTower / laundry center counts as ONE maintained asset, priced as one
      // appliance and inspected with the combined `laundry` checkpoint set. The
      // invoice importer no longer expands it into washer + dryer records.
      { id: "laundry_center", label: "Laundry Center / WashTower", group: "standard", checkpointSet: "laundry", filterTypes: [] },
      { id: "commercial_refrigeration", label: "Commercial / Specialty Refrigeration", group: "standard", checkpointSet: "refrigerator", filterTypes: [] },
      { id: "outdoor", label: "Outdoor Appliance", group: "standard", checkpointSet: "generic", filterTypes: [] },
      { id: "other", label: "Other Appliance", group: "standard", checkpointSet: "generic", filterTypes: [] }
    ],
    hvacSystemTypes: [
      "Split System",
      "Heat Pump",
      "Mini-Split",
      "Packaged Unit",
      "Other"
    ],
    checkpointSets: {
      generic: [
        { id: "condition", name: "Overall condition & operation", prompt: "Run the unit and confirm normal operation, controls, and visible condition.", readingLabel: "Reading / result", photoPrompt: "Serial tag or condition photo" },
        { id: "connections", name: "Connections & safety", prompt: "Inspect visible utility connections and note any safety concern.", readingLabel: "Observation", photoPrompt: "Photo if any issue is found" },
        { id: "cleanliness", name: "Maintenance condition", prompt: "Check accessible filters, screens, vents, and serviceable buildup.", readingLabel: "Condition", photoPrompt: "Before / after photo when cleaned" }
      ],
      refrigerator: [
        {
          id: "temp",
          name: "Compartment temperature performance",
          prompt: "Measure each active refrigerated compartment and compare the actual temperature with its set point. Confirm normal ice production when the appliance makes ice.",
          guidance: "Typical targets: fresh-food compartments about 35–38°F; freezer compartments close to 0°F. Specialty refrigeration should be compared with its actual set point and intended use.",
          readingFields: [
            { key: "primaryActual", label: "Primary compartment actual", unit: "°F", required: true, placeholder: "Actual temp" },
            { key: "primarySetpoint", label: "Primary set point", unit: "°F", required: true, placeholder: "Set point" },
            { key: "secondaryActual", label: "Second compartment actual", unit: "°F", required: false, placeholder: "If applicable" },
            { key: "secondarySetpoint", label: "Second set point", unit: "°F", required: false, placeholder: "If applicable" }
          ],
          photoPrompt: "Add a display / temperature photo if useful"
        },
        {
          id: "frost_pattern",
          name: "Evaporator frost pattern",
          prompt: "Inspect the accessible evaporator pattern. Rate how evenly the active coil is frosting and look for an isolated ice ball, oil residue, or another visible leak indicator.",
          guidance: "A healthy evaporator should show a consistent frost pattern across the active coil with no isolated ice ball or obvious oil / leak indicator.",
          readingLabel: "Pattern / observation",
          photoPrompt: "Add a frost-pattern photo if useful"
        },
        {
          id: "condenser_temp",
          name: "Condenser temperature & coil service",
          prompt: "Measure room ambient and condenser-coil surface temperature with an infrared thermometer. Vacuum the accessible condenser coil, then rate heat rejection / coil condition after service.",
          guidance: "Normal reference: condenser surface temperature is commonly about 15–30°F above room ambient. The coil should feel warm or hot, but surface temperature is typically below roughly 110–120°F. Use manufacturer guidance when available.",
          readingFields: [
            { key: "ambient", label: "Room ambient", unit: "°F", required: true, placeholder: "Ambient temp" },
            { key: "coilSurface", label: "Condenser coil surface", unit: "°F", required: true, placeholder: "IR temp" }
          ],
          derivedReading: "condenserTd",
          photoPrompt: "Add condenser / coil photo if useful"
        },
        {
          id: "components",
          name: "Components & operating sound",
          prompt: "Force accessible operating components to run as appropriate—compressor, fans, dampers and ice-making components—and listen for abnormal noise, vibration, or cycling.",
          readingLabel: "Component test result",
          photoPrompt: "Add a component photo only if useful"
        },
        {
          id: "air_filter",
          name: "Airflow & filter status",
          prompt: "Confirm fans are running and airflow supports the observed frost pattern. Inspect applicable water / air filters. Replace and reset filters when Wilson Filter Service is selected or included by the plan.",
          guidance: "Airflow is interpreted together with fan operation and frost pattern. If filter service is not enrolled, inspect and document the filter condition and recommend replacement when needed.",
          readingLabel: "Airflow / filter result",
          photoPrompt: "Add a filter or airflow photo if useful"
        }
      ],
      dishwasher: [
        { id: "leak", name: "Seals & leak check", prompt: "Inspect door seals, visible connections, and the base area for leakage.", readingLabel: "Leak result", photoPrompt: "Seal / leak area if abnormal" },
        { id: "filter", name: "Filter & sump condition", prompt: "Inspect and clean the accessible filter/sump area.", readingLabel: "Condition after cleaning", photoPrompt: "Filter / sump after cleaning" },
        { id: "codes", name: "Stored codes & controls", prompt: "Check stored faults or service indicators when available.", readingLabel: "Codes / result", photoPrompt: "Display if a code is present" },
        { id: "test", name: "Test cycle & operating sound", prompt: "Run a test cycle and note fill, wash, drain, heat, and unusual sound.", readingLabel: "Cycle result", photoPrompt: "Photo if an issue is visible" },
        { id: "clean", name: "Maintenance clean cycle", prompt: "Complete or initiate the approved maintenance-cleaning process.", readingLabel: "Completed / product used", photoPrompt: "Interior after cleaning" }
      ],
      cooking: [
        { id: "seal", name: "Door seals & condition", prompt: "Inspect oven door seals, hinges, and visible cooking surfaces.", readingLabel: "Seal condition", photoPrompt: "Seal / cavity photo if abnormal" },
        { id: "heat", name: "Burner / element / flame test", prompt: "Verify ignition, element operation, or flame pattern as applicable.", readingLabel: "Test result", photoPrompt: "Flame or element photo when useful" },
        { id: "accuracy", name: "Temperature accuracy", prompt: "For ovens, compare measured temperature with the set point after stabilization.", readingLabel: "Actual temp / set point", unit: "°F", photoPrompt: "Temperature reading" },
        { id: "controls", name: "Controls & safety operation", prompt: "Verify controls, fans, lights, and obvious safety functions.", readingLabel: "Operation result", photoPrompt: "Photo if an issue is present" }
      ],
      icemaker: [
        { id: "pattern", name: "Ice pattern & production", prompt: "Inspect cube/slab/nugget formation and note abnormal pattern or production.", readingLabel: "Pattern / production", photoPrompt: "Fresh ice pattern" },
        { id: "bin", name: "Bin condition & cleaning", prompt: "Clean and document the bin and accessible food-contact surfaces.", readingLabel: "Condition after cleaning", photoPrompt: "Bin after cleaning" },
        { id: "clean_cycle", name: "Cleaning / descale cycle", prompt: "Run the manufacturer-approved cleaning or descale cycle.", readingLabel: "Cycle completed / product", photoPrompt: "Display or interior after cycle" },
        { id: "condenser", name: "Condenser & airflow", prompt: "Inspect and vacuum the accessible condenser; note abnormal fan/compressor sound.", readingLabel: "Condition / sound", photoPrompt: "Condenser after vacuuming" },
        { id: "water_drain", name: "Water, drain & filter", prompt: "Inspect water connection, drain/pump operation, and filter status.", readingLabel: "Flow / drain / filter result", photoPrompt: "Water connection, drain, or filter" }
      ],
      washer: [
        { id: "water", name: "Hoses, fill & leak check", prompt: "Inspect visible hoses/connections and verify normal fill with no leaks.", readingLabel: "Fill / leak result", photoPrompt: "Connections if abnormal" },
        { id: "drain", name: "Drain performance", prompt: "Verify drain/pump operation and note restriction or abnormal pump sound.", readingLabel: "Drain result", photoPrompt: "Pump/filter area when applicable" },
        { id: "mechanical", name: "Wash / spin & vibration", prompt: "Run a functional cycle and rate agitation/tumble, spin, balance, and noise.", readingLabel: "Cycle / vibration result", photoPrompt: "Photo if movement or damage is visible" },
        { id: "clean", name: "Gasket, filter & cleaning condition", prompt: "Inspect door boot/gasket, accessible filter, dispenser, and maintenance-cleaning condition.", readingLabel: "Condition after service", photoPrompt: "Gasket/filter after cleaning" },
        { id: "codes", name: "Stored codes & controls", prompt: "Check stored faults/service indicators and verify control operation.", readingLabel: "Codes / result", photoPrompt: "Display if a code is present" }
      ],
      laundry: [
        { id: "water_air", name: "Utility / airflow performance", prompt: "Verify normal fill/drain or exhaust airflow as applicable.", readingLabel: "Result / reading", photoPrompt: "Connection or vent if abnormal" },
        { id: "cycle", name: "Cycle operation", prompt: "Run a functional cycle and note abnormal sound, vibration, heat, or movement.", readingLabel: "Cycle result", photoPrompt: "Photo if issue is visible" },
        { id: "clean", name: "Accessible cleaning condition", prompt: "Inspect accessible filters, lint areas, gasket, dispenser, or service points.", readingLabel: "Condition after service", photoPrompt: "After-cleaning photo" },
        { id: "connections", name: "Connections & leak / safety check", prompt: "Inspect visible water, vent, gas, or electrical connections.", readingLabel: "Connection result", photoPrompt: "Connection if abnormal" },
        { id: "codes", name: "Controls & stored codes", prompt: "Verify controls and note stored faults/service indicators when available.", readingLabel: "Codes / result", photoPrompt: "Display if a code is present" }
      ],
      dryer: [
        { id: "airflow", name: "Exhaust airflow & temperature", prompt: "Verify exhaust airflow and record outlet temperature or observed heat performance.", readingLabel: "Temp / airflow", unit: "°F", photoPrompt: "Vent connection or reading" },
        { id: "lint", name: "Lint system & accessible cleaning", prompt: "Inspect and clean the lint screen, housing, and accessible lint buildup.", readingLabel: "Condition after cleaning", photoPrompt: "Lint area after cleaning" },
        { id: "mechanical", name: "Drum, rollers & operating sound", prompt: "Run the dryer and note abnormal drum, roller, blower, or motor sound.", readingLabel: "Operating result", photoPrompt: "Photo if wear/damage is visible" },
        { id: "sensor", name: "Cycle / moisture-sensor operation", prompt: "Verify controls and a timed or sensor cycle as applicable.", readingLabel: "Cycle result", photoPrompt: "Display if abnormal" },
        { id: "connection", name: "Vent & utility connection", prompt: "Inspect visible venting and gas/electrical connection condition.", readingLabel: "Connection condition", photoPrompt: "Vent / connection if abnormal" }
      ],
      ventilation: [
        { id: "capture", name: "Blower & capture performance", prompt: "Run each speed and verify normal airflow/capture.", readingLabel: "Airflow / speed result", photoPrompt: "Operating hood / capture area" },
        { id: "filters", name: "Filters / baffles", prompt: "Inspect and clean accessible filters or baffles.", readingLabel: "Condition after cleaning", photoPrompt: "Filters after cleaning" },
        { id: "noise", name: "Blower sound & vibration", prompt: "Listen for abnormal blower noise, vibration, or bearing sound.", readingLabel: "Sound / vibration result", photoPrompt: "Blower area if issue visible" },
        { id: "controls", name: "Controls, lights & heat sensor", prompt: "Verify controls, lighting, and automatic heat response when equipped.", readingLabel: "Control result", photoPrompt: "Control panel if abnormal" },
        { id: "grease", name: "Grease / duct-entry condition", prompt: "Inspect accessible grease accumulation and the visible duct-entry area.", readingLabel: "Condition", photoPrompt: "Baffle / duct-entry condition" }
      ],
      microwave: [
        { id: "door", name: "Door, seal & interlock", prompt: "Inspect the door/seal and verify interlock operation.", readingLabel: "Door / interlock result", photoPrompt: "Door/seal if abnormal" },
        { id: "heat", name: "Heating performance", prompt: "Run a controlled heating test and record the result or temperature rise.", readingLabel: "Heating result / temp rise", unit: "°F", photoPrompt: "Test reading if used" },
        { id: "air", name: "Turntable, fan & airflow", prompt: "Verify turntable/stirrer, cooling fan, and ventilation operation as applicable.", readingLabel: "Operation result", photoPrompt: "Photo if abnormal" },
        { id: "controls", name: "Controls & stored faults", prompt: "Verify keypad/display operation and note any stored error or service indication.", readingLabel: "Codes / result", photoPrompt: "Display if a code is present" },
        { id: "cavity", name: "Interior / arcing condition", prompt: "Inspect the cavity, waveguide cover, rack, and signs of arcing or damage.", readingLabel: "Cavity condition", photoPrompt: "Interior if abnormal" }
      ]
    },
    measurementSets: {
      generic: [{ label: "Primary operating reading", target: "Technician / manufacturer check", unit: "" }],
      refrigerator: [
        { label: "Primary compartment temperature", target: "Compare with set point; typical fresh-food 35–38°F", unit: "°F" },
        { label: "Secondary compartment temperature", target: "Compare with set point; typical freezer near 0°F", unit: "°F" },
        { label: "Condenser coil surface temperature", target: "Typically about 15–30°F above ambient", unit: "°F" },
        { label: "Room ambient temperature", target: "Record with condenser reading", unit: "°F" }
      ],
      icemaker: [{ label: "Ice production / pattern", target: "Normal", unit: "" }],
      dishwasher: [{ label: "Test cycle result", target: "Normal", unit: "" }],
      cooking: [{ label: "Temperature accuracy", target: "Compare with set point", unit: "°F" }],
      laundry: [{ label: "Functional cycle result", target: "Normal", unit: "" }],
      washer: [{ label: "Fill / drain result", target: "Normal", unit: "" }],
      dryer: [{ label: "Exhaust temperature / airflow", target: "Normal", unit: "°F" }],
      ventilation: [{ label: "Blower / capture result", target: "Normal", unit: "" }],
      microwave: [{ label: "Heating test", target: "Normal", unit: "°F" }]
    },
    maintenanceTasks: [
      "Vacuum accessible condenser coil",
      "Run manufacturer-approved clean / descale cycle",
      "Clean accessible filter, screen, baffle, or sump",
      "Replace plan-covered filter and reset indicator",
      "Inspect visible water / utility connections",
      "Run functional or diagnostic cycle",
      "Record required temperatures / readings",
      "Capture required serial-tag and condition photos"
    ],
    lifecycleTiers: {
      luxury: { id: "luxury", label: "Luxury", defaultYears: 15, examples: "Sub-Zero, Wolf, Cove, Miele, Thermador, True" },
      premium: { id: "premium", label: "Mass premium", defaultYears: 10, examples: "Bosch, KitchenAid, Monogram, Café, Fisher & Paykel, JennAir" },
      mass: { id: "mass", label: "Mass", defaultYears: 8, examples: "Whirlpool, Maytag, LG mainstream, GE mainstream, Samsung" }
    },
    lifecycleMatrix: {
      refrigerator: { luxury: 20, premium: 14, mass: 10 },
      dishwasher: { luxury: 15, premium: 10, mass: 8 },
      cooking: { luxury: 20, premium: 15, mass: 12 },
      icemaker: { luxury: 12, premium: 10, mass: 8 },
      washer: { luxury: 15, premium: 11, mass: 8 },
      dryer: { luxury: 15, premium: 11, mass: 8 },
      // Combined laundry center / WashTower. Previously absent, so any asset on the
      // `laundry` set silently used the generic 15/10/8 curve instead of a laundry one.
      laundry: { luxury: 15, premium: 11, mass: 8 },
      ventilation: { luxury: 18, premium: 14, mass: 10 },
      microwave: { luxury: 10, premium: 8, mass: 7 },
      generic: { luxury: 15, premium: 10, mass: 8 }
    },
    lifecycleStages: [
      { maxRatio: 0.40, label: "Early Life" },
      { maxRatio: 0.70, label: "Mid Life" },
      { maxRatio: 0.90, label: "Mature" },
      { maxRatio: 999, label: "Replacement Planning" }
    ],
    brandTierDefaults: {
      "sub-zero": "luxury", "subzero": "luxury", "wolf": "luxury", "cove": "luxury", "miele": "luxury", "thermador": "luxury", "true": "luxury", "scotsman": "luxury", "hestan": "luxury", "kalamazoo": "luxury",
      "bosch": "premium", "kitchenaid": "premium", "monogram": "premium", "cafe": "premium", "café": "premium", "fisher & paykel": "premium", "jennair": "premium", "jenn-air": "premium", "speed queen": "premium",
      "whirlpool": "mass", "maytag": "mass", "ge": "mass", "lg": "mass", "samsung": "mass", "frigidaire": "mass", "hotpoint": "mass"
    },
    reportScoring: {
      vitalWeight: 0.75,
      ageWeight: 0.25,
      gradeBands: [
        { min: 90, grade: "A", label: "Excellent" },
        { min: 80, grade: "B", label: "Good" },
        { min: 70, grade: "C", label: "Monitor" },
        { min: 60, grade: "D", label: "Plan ahead" },
        { min: 0, grade: "F", label: "Action recommended" }
      ],
      explanation: "Draft scoring: 75% current-condition vitals and 25% lifecycle age. Expected life comes from the appliance category and product tier, and can be overridden by Wilson as brand-specific data is refined."
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
    if (group === "hvac") return "generic";

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
    return config.customerApplianceCategories.find((c) => norm(c.id) === wanted) || null;
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

  window.WILSON_CONFIG = config;
  window.WILSON_PROTOCOL = { resolveCheckpointSet: resolveCheckpointSet };
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
