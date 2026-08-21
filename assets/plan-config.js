(function () {
  const config = {
    version: "0.2",
    currency: "USD",
    assumptions: {
      imucRecommendedVisits: 2,
      imucGuidance: "Manufacturer guidance generally recommends cleaning and maintenance twice per year.",
      estateAutoSwitchRule: "Automatically move a per-appliance enrollment to Estate Annual when the comparable Estate Annual total is lower.",
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
          "Filters and disassembly are not included"
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
          "Filters are not included"
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
          "Filters are not included"
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
          "Standard refrigerator, freezer, and IMUC filters included",
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
    applianceTypes: [
      { id: "refrigerator", label: "Refrigerator", group: "standard", checkpointSet: "refrigerator", filterTypes: ["Refrigerator water filter", "Refrigerator air / food-preservation filter"] },
      { id: "freezer", label: "Freezer", group: "standard", checkpointSet: "refrigerator", filterTypes: ["Freezer water filter"] },
      { id: "wine_beverage", label: "Wine / Beverage Center", group: "standard", checkpointSet: "refrigerator", filterTypes: [] },
      { id: "ice_maker", label: "Icemaker (IMUC)", group: "imuc", checkpointSet: "icemaker", filterTypes: ["Icemaker water filter"] },
      { id: "dishwasher", label: "Dishwasher", group: "standard", checkpointSet: "dishwasher", filterTypes: [] },
      { id: "range", label: "Range", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "cooktop", label: "Cooktop / Rangetop", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "wall_oven", label: "Wall Oven", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "speed_oven", label: "Microwave / Speed Oven", group: "standard", checkpointSet: "cooking", filterTypes: [] },
      { id: "washer", label: "Washer", group: "standard", checkpointSet: "laundry", filterTypes: [] },
      { id: "dryer", label: "Dryer", group: "standard", checkpointSet: "laundry", filterTypes: [] },
      { id: "hood", label: "Vent Hood", group: "standard", checkpointSet: "generic", filterTypes: [] },
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
        { category: "Condition & Installation", name: "Exterior condition and installation" },
        { category: "Controls & Operation", name: "Controls and display" },
        { category: "Controls & Operation", name: "Functional operation" },
        { category: "Connections & Safety", name: "Connections and visible components" },
        { category: "Condition & Installation", name: "Cleanliness and maintenance condition" },
        { category: "Connections & Safety", name: "Safety observations" }
      ],
      refrigerator: [
        { category: "Cabinet & Sealing", name: "Cabinet, doors and gaskets" },
        { category: "Temperature Performance", name: "Temperature performance" },
        { category: "Airflow & Heat Transfer", name: "Condenser coil and airflow" },
        { category: "Mechanical Operation", name: "Fans, compressor and operating noise" },
        { category: "Water & Ice", name: "Water and ice functions" },
        { category: "Filtration", name: "Filter status" },
        { category: "Controls & Electrical", name: "Controls and display" },
        { category: "Connections & Safety", name: "Visible connections and safety" }
      ],
      icemaker: [
        { category: "Condition & Sanitation", name: "Bin and interior condition" },
        { category: "Water System", name: "Water supply connections" },
        { category: "Drain System", name: "Drain or pump condition" },
        { category: "Freeze Performance", name: "Freeze cycle performance" },
        { category: "Harvest Performance", name: "Harvest cycle performance" },
        { category: "Water Quality", name: "Scale and water-quality condition" },
        { category: "Airflow & Heat Transfer", name: "Condenser coil and airflow" },
        { category: "Filtration", name: "Filter status" }
      ],
      dishwasher: [
        { category: "Condition & Loading", name: "Tub, racks and door condition" },
        { category: "Water System", name: "Fill and water-level performance" },
        { category: "Wash Performance", name: "Spray arms and wash performance" },
        { category: "Drain System", name: "Drain performance" },
        { category: "Heating & Drying", name: "Heating and drying performance" },
        { category: "Filtration", name: "Filter and sump condition" },
        { category: "Leak & Safety", name: "Leak inspection" },
        { category: "Controls & Connections", name: "Controls, connections and safety" }
      ],
      laundry: [
        { category: "Condition", name: "Cabinet, drum or tub condition" },
        { category: "Controls & Cycles", name: "Cycle and control operation" },
        { category: "Utilities", name: "Water hoses or dryer venting" },
        { category: "Drain or Exhaust", name: "Drain or exhaust performance" },
        { category: "Mechanical Operation", name: "Noise, vibration and leveling" },
        { category: "Filtration & Cleanliness", name: "Lint, filter and cleanliness condition" },
        { category: "Connections", name: "Visible connections" },
        { category: "Safety", name: "Safety observations" }
      ],
      cooking: [
        { category: "Condition & Sealing", name: "Exterior, doors and seals" },
        { category: "Heating System", name: "Burners, elements or ignition" },
        { category: "Temperature Performance", name: "Temperature performance" },
        { category: "Airflow", name: "Convection and fan operation" },
        { category: "Controls & Electrical", name: "Controls and display" },
        { category: "Condition & Cleanliness", name: "Interior cleanliness and condition" },
        { category: "Connections", name: "Visible utility connections" },
        { category: "Safety", name: "Safety observations" }
      ]
    },
    measurementSets: {
      generic: [
        { label: "Primary operating reading", target: "Technician-defined range", unit: "" },
        { label: "Cycle or response time", target: "Manufacturer guidance", unit: "" },
        { label: "Visible leak / safety check", target: "No issue observed", unit: "" }
      ],
      refrigerator: [
        { label: "Fresh-food compartment temperature", target: "Enter target used", unit: "°F" },
        { label: "Freezer compartment temperature", target: "Enter target used", unit: "°F" },
        { label: "Door / gasket sealing check", target: "Full contact", unit: "" },
        { label: "Condenser airflow / condition", target: "Clear and operating", unit: "" }
      ],
      icemaker: [
        { label: "Freeze cycle time", target: "Enter manufacturer target", unit: "min" },
        { label: "Harvest cycle time", target: "Enter manufacturer target", unit: "min" },
        { label: "Bin control operation", target: "Pass", unit: "" },
        { label: "Water / drain flow check", target: "Normal", unit: "" }
      ],
      dishwasher: [
        { label: "Incoming water temperature", target: "Enter target used", unit: "°F" },
        { label: "Drain time", target: "Enter model guidance", unit: "sec" },
        { label: "Wash / spray observation", target: "Normal", unit: "" },
        { label: "Leak check", target: "No leak observed", unit: "" }
      ],
      laundry: [
        { label: "Fill / drain or exhaust observation", target: "Normal", unit: "" },
        { label: "Cycle completion", target: "Pass", unit: "" },
        { label: "Noise / vibration observation", target: "Normal", unit: "" },
        { label: "Connection / vent condition", target: "No issue observed", unit: "" }
      ],
      cooking: [
        { label: "Temperature or burner response", target: "Enter target used", unit: "" },
        { label: "Ignition / element operation", target: "Pass", unit: "" },
        { label: "Door / seal condition", target: "Full contact", unit: "" },
        { label: "Safety check", target: "No issue observed", unit: "" }
      ]
    },
    maintenanceTasks: [
      "Vacuum condenser coil",
      "Descale per manufacturer guidance",
      "Clean accessible filters or screens",
      "Replace plan-covered filter",
      "Inspect visible water connections",
      "Inspect drain or pump",
      "Verify temperatures or cycle performance",
      "Photograph key components",
      "No maintenance performed - inspection only"
    ],
    filterTypes: [
      "Refrigerator water filter",
      "Refrigerator air / food-preservation filter",
      "Freezer water filter",
      "Icemaker water filter",
      "HVAC media filter"
    ],
    reportScoring: {
      gradeBands: [
        { min: 90, grade: "A", label: "Excellent" },
        { min: 80, grade: "B", label: "Good" },
        { min: 70, grade: "C", label: "Monitor" },
        { min: 60, grade: "D", label: "Action recommended" },
        { min: 0, grade: "F", label: "Significant action needed" }
      ],
      explanation: "The starter score converts the average applicable checkpoint rating to 100 points. Category losses show where points were deducted. Appliance-specific weights can replace this rule later."
    }
  };

  window.WILSON_CONFIG = config;
})();
