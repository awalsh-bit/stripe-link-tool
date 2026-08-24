(function () {
  const STORAGE_KEY = "wilson-maintenance-demo-v07";
  const INVOICE_DRAFT_KEY = "wilson-maintenance-invoice-draft-v07";
  const VERSION = 7;

  function isoDate(offsetDays) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + (offsetDays || 0));
    return date.toISOString().slice(0, 10);
  }

  function isoTime(offsetMinutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + (offsetMinutes || 0));
    return date.toISOString();
  }

  function id(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);
  }

  function addMonths(dateString, months) {
    const date = new Date(dateString + "T12:00:00");
    date.setMonth(date.getMonth() + months);
    return date.toISOString().slice(0, 10);
  }

  function planForPayload(payload) {
    if (payload.category === "hvac") return window.WILSON_CONFIG.hvacPlans[payload.planId] || null;
    return window.WILSON_CONFIG.appliancePlans[payload.planId] || null;
  }

  function createAssets(householdId, definitions) {
    return (definitions || []).map(function (item, index) {
      return {
        id: id("asset"),
        householdId,
        type: item.type,
        typeLabel: item.typeLabel || item.type || "Equipment",
        customerCategory: item.customerCategory || item.type || "other",
        exactType: item.exactType || item.type || "",
        exactTypeLabel: item.exactTypeLabel || item.typeLabel || "",
        group: item.group || "standard",
        brand: item.brand || "",
        model: item.model || "",
        serial: item.serial || "",
        description: item.description || "",
        sourceInvoice: item.sourceInvoice || "",
        sourceGroupId: item.sourceGroupId || "",
        source: item.source || "customer",
        needsReview: Boolean(item.needsReview),
        areaId: item.areaId || "",
        location: item.location || "",
        installYear: item.installYear || "",
        checkpointSet: item.checkpointSet || "generic",
        filterTypes: item.filterTypes || [],
        filterServiceOptIn: Boolean(item.filterServiceOptIn),
        airFilterServiceOptIn: Boolean(item.airFilterServiceOptIn),
        waterFilterQuantity: Number(item.waterFilterQuantity) || null,
        airFilterQuantity: Number(item.airFilterQuantity) || null,
        imucVisitsPerYear: Number(item.imucVisitsPerYear || 1),
        filterSize: item.filterSize || "",
        filterQuantity: Number(item.filterQuantity || 1),
        filterLocation: item.filterLocation || "",
        status: item.status || "Active",
        sortOrder: index + 1
      };
    });
  }

  function appliance(type, label, brand, model, location, checkpointSet, extra) {
    return Object.assign({
      type,
      typeLabel: label,
      brand,
      model,
      location,
      checkpointSet,
      group: type === "ice_maker" ? "imuc" : "standard",
      imucVisitsPerYear: type === "ice_maker" ? 2 : 1,
      filterTypes: []
    }, extra || {});
  }

  function createFilterRecords(householdId, assets, subscription, coverage) {
    const records = [];
    assets.forEach(function (asset) {
      let types = (asset.filterTypes || []).slice();
      const conciergeIncluded = subscription.standardFiltersIncluded;
      /* Water and air filter service are separate paid selections. Either one
         puts the asset under Wilson filter management. */
      const priced = window.WILSON_FILTERS.forAsset(asset, subscription.planId);
      const selectedFilterService = Boolean(asset.filterServiceOptIn || asset.airFilterServiceOptIn);
      const assetManaged = Boolean(selectedFilterService || conciergeIncluded || asset.group === "hvac" && subscription.filterManagement);
      if (selectedFilterService && !types.length) {
        types = priced.lines.map(function (line) {
          return line.kindId === "air"
            ? "Refrigeration air / food-preservation filter - exact type to verify"
            : "Refrigeration water filter - exact type to verify";
        });
        if (!types.length) types = ["Refrigeration filter(s) - exact type to verify"];
      }
      /* Selected filter service is priced into the annual plan, so the material
         is no longer billed separately at service. */
      const assetCoverage = conciergeIncluded
        ? "Included"
        : (selectedFilterService
            ? "Included - priced into plan"
            : (assetManaged ? "Managed - material billed separately" : coverage));
      types.forEach(function (filterType) {
        records.push({
          id: id("filter"),
          householdId,
          assetId: asset.id,
          subscriptionId: subscription.id,
          filterType,
          partNumber: asset.filterSize || "To verify",
          quantity: Number(asset.filterQuantity || 1),
          intervalMonths: filterType.toLowerCase().includes("hvac") ? 6 : 6,
          lastChangedOn: "",
          nextDueOn: isoDate(180),
          status: "Setup needed",
          source: assetCoverage.indexOf("Included") === 0
            ? "Wilson supplied"
            : (assetCoverage.indexOf("Managed") === 0 ? "Wilson sourced / billed separately" : "Customer / billed separately"),
          planCoverage: assetCoverage,
          notes: asset.filterLocation || ""
        });
      });
    });
    return records;
  }

  function seedState() {
    const households = [
      {
        id: "hh_reynolds",
        name: "Reynolds Estate",
        firstName: "Ellen",
        lastName: "Reynolds",
        email: "ellen@example.com",
        phone: "512-555-0148",
        preferredContact: "Text",
        address1: "1840 Ridgeview Trail",
        address2: "",
        city: "Austin",
        state: "TX",
        zip: "78738",
        notes: "House manager coordinates access. Gate code stored in the service system.",
        billingType: "Card on File", accountTerms: "", createdAt: isoTime(-6000)
      },
      {
        id: "hh_davenport",
        name: "Davenport Residence",
        firstName: "Mark",
        lastName: "Davenport",
        email: "mark@example.com",
        phone: "512-555-0164",
        preferredContact: "Email",
        address1: "415 Creek Bend",
        address2: "",
        city: "Dripping Springs",
        state: "TX",
        zip: "78620",
        notes: "Preferred appointment window is Tuesday or Thursday morning.",
        billingType: "Card on File", accountTerms: "", createdAt: isoTime(-5000)
      },
      {
        id: "hh_torres",
        name: "Torres Home",
        firstName: "Ana",
        lastName: "Torres",
        email: "ana@example.com",
        phone: "512-555-0112",
        preferredContact: "Phone",
        address1: "902 Bell Springs Road",
        address2: "",
        city: "Dripping Springs",
        state: "TX",
        zip: "78620",
        notes: "Standalone IMUC plan with twice-yearly service.",
        billingType: "Card on File", accountTerms: "", createdAt: isoTime(-4000)
      },
      {
        id: "hh_mercer",
        name: "Mercer Ranch",
        firstName: "David",
        lastName: "Mercer",
        email: "david@example.com",
        phone: "512-555-0170",
        preferredContact: "Email",
        address1: "1280 Ranch Road 165",
        address2: "",
        city: "Blanco",
        state: "TX",
        zip: "78606",
        notes: "Appliance and HVAC programs managed in one household record.",
        billingType: "AR Account", accountTerms: "Net 30", createdAt: isoTime(-2000)
      }
    ];

    let assets = [];
    assets = assets.concat(createAssets("hh_reynolds", [
      appliance("refrigerator", "Refrigerator", "Sub-Zero", "BI-48S", "Main Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter", "Refrigerator air / food-preservation filter"] }),
      appliance("freezer", "Freezer", "Sub-Zero", "BI-36F", "Main Kitchen", "refrigerator", { filterTypes: ["Freezer water filter"] }),
      appliance("dishwasher", "Dishwasher", "Cove", "DW2450", "Main Kitchen - Left", "dishwasher"),
      appliance("dishwasher", "Dishwasher", "Cove", "DW2450", "Main Kitchen - Right", "dishwasher"),
      appliance("range", "Range", "Wolf", "GR486G", "Main Kitchen", "cooking"),
      appliance("hood", "Vent Hood", "Wolf", "PI543418", "Main Kitchen", "ventilation"),
      appliance("wall_oven", "Wall Oven", "Wolf", "SO3050CM", "Catering Kitchen", "cooking"),
      appliance("refrigerator", "Refrigerator", "Sub-Zero", "CL3650R", "Catering Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter"] }),
      appliance("ice_maker", "Icemaker (IMUC)", "Scotsman", "DCE33", "Wet Bar", "icemaker", { filterTypes: ["Icemaker water filter"] }),
      appliance("wine_beverage", "Wine Storage", "Sub-Zero", "UW-24", "Wine Room", "refrigerator"),
      appliance("washer", "Washer", "Miele", "WXF660", "Primary Laundry", "washer"),
      appliance("dryer", "Dryer", "Miele", "TXI680", "Primary Laundry", "dryer"),
      appliance("washer", "Washer", "Speed Queen", "FF7009", "Guest Laundry", "washer"),
      appliance("dryer", "Dryer", "Speed Queen", "DF7004", "Guest Laundry", "dryer"),
      appliance("outdoor", "Outdoor Grill", "Hestan", "GMBR36", "Outdoor Kitchen", "cooking"),
      appliance("refrigerator", "Outdoor Refrigerator", "True", "TUR-24", "Outdoor Kitchen", "refrigerator")
    ]));

    assets = assets.concat(createAssets("hh_davenport", [
      appliance("refrigerator", "Refrigerator", "Thermador", "T36BT925NS", "Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter"] }),
      appliance("freezer", "Freezer", "Thermador", "T24IF905SP", "Kitchen", "refrigerator"),
      appliance("dishwasher", "Dishwasher", "Thermador", "DWHD770WPR", "Kitchen", "dishwasher"),
      appliance("range", "Range", "Thermador", "PRD486WDHU", "Kitchen", "cooking"),
      appliance("hood", "Vent Hood", "Thermador", "VCIN48GWS", "Kitchen", "ventilation"),
      appliance("speed_oven", "Speed Oven", "Thermador", "MC30WP", "Kitchen", "microwave"),
      appliance("wine_beverage", "Wine Column", "Thermador", "T24IW905SP", "Bar", "refrigerator"),
      appliance("ice_maker", "Icemaker (IMUC)", "Scotsman", "CU50", "Bar", "icemaker", { filterTypes: ["Icemaker water filter"] }),
      appliance("washer", "Washer", "LG", "WM6700", "Laundry", "washer"),
      appliance("dryer", "Dryer", "LG", "DLEX6700", "Laundry", "dryer")
    ]));

    assets = assets.concat(createAssets("hh_torres", [
      appliance("ice_maker", "Icemaker (IMUC)", "KitchenAid", "KUIX535HPS", "Kitchen", "icemaker", { filterTypes: ["Icemaker water filter"] })
    ]));

    assets = assets.concat(createAssets("hh_mercer", [
      appliance("refrigerator", "Refrigerator", "Sub-Zero", "BI-42S", "Main House", "refrigerator", { filterTypes: ["Refrigerator water filter"] }),
      appliance("dishwasher", "Dishwasher", "Cove", "DW2450", "Main House", "dishwasher"),
      appliance("range", "Range", "Wolf", "GR366", "Main House", "cooking"),
      appliance("ice_maker", "Icemaker (IMUC)", "Scotsman", "DCE33", "Game Room", "icemaker", { filterTypes: ["Icemaker water filter"] }),
      { type: "Split System", typeLabel: "HVAC System", group: "hvac", brand: "Trane", model: "4TWR6042H1000AB", location: "Main House - 3.5 ton", checkpointSet: "generic", filterTypes: ["HVAC media filter"], filterSize: "20x25x4 MERV 11", filterQuantity: 1, filterLocation: "Air handler" },
      { type: "Split System", typeLabel: "HVAC System", group: "hvac", brand: "Trane", model: "4TWR6036", location: "Guest House - 3 ton", checkpointSet: "generic", filterTypes: ["HVAC media filter"], filterSize: "20x20x4 MERV 11", filterQuantity: 1, filterLocation: "Return grille" }
    ]));

    const paymentProfiles = [
      { id: "pay_reynolds", householdId: "hh_reynolds", status: "Ready", provider: "Stripe", brand: "Visa", last4: "4288", expMonth: 8, expYear: 2029, stripeCustomerId: "cus_demo_reynolds", stripePaymentMethodId: "pm_demo_reynolds" },
      { id: "pay_davenport", householdId: "hh_davenport", status: "Needs update", provider: "Stripe", brand: "Amex", last4: "1005", expMonth: 4, expYear: 2026, stripeCustomerId: "cus_demo_davenport", stripePaymentMethodId: "pm_demo_davenport" },
      { id: "pay_torres", householdId: "hh_torres", status: "Ready", provider: "Stripe", brand: "Mastercard", last4: "5454", expMonth: 12, expYear: 2028, stripeCustomerId: "cus_demo_torres", stripePaymentMethodId: "pm_demo_torres" },
      { id: "pay_mercer", householdId: "hh_mercer", status: "Ready", provider: "Stripe", brand: "Visa", last4: "9011", expMonth: 10, expYear: 2030, stripeCustomerId: "cus_demo_mercer", stripePaymentMethodId: "pm_demo_mercer" }
    ];

    const subscriptions = [
      { id: "sub_reynolds", householdId: "hh_reynolds", category: "appliance", planId: "estate_concierge", planName: "Estate Concierge", annualAmount: 3145, status: "Active", paymentProfileId: "pay_reynolds", startedOn: isoDate(-190), renewalOn: isoDate(175), preferredMonths: "March / September", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: true, pricingBreakdown: { basePlanAmount: 2995, largeEstateAdjustment: 150 } },
      { id: "sub_davenport", householdId: "hh_davenport", category: "appliance", planId: "estate_preferred", planName: "Estate Preferred", annualAmount: 1995, status: "Active", paymentProfileId: "pay_davenport", startedOn: isoDate(-120), renewalOn: isoDate(245), preferredMonths: "April / October", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_torres", householdId: "hh_torres", category: "appliance", planId: "per_appliance", planName: "IMUC - Per Appliance", annualAmount: 499.9, status: "Active", paymentProfileId: "pay_torres", startedOn: isoDate(-360), renewalOn: isoDate(5), preferredMonths: "February / August", lastChargeStatus: "Charge due", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_mercer_app", householdId: "hh_mercer", category: "appliance", planId: "estate_annual", planName: "Estate Annual", annualAmount: 1444.95, status: "Active", paymentProfileId: "pay_mercer", startedOn: isoDate(-220), renewalOn: isoDate(145), preferredMonths: "March", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_mercer_hvac", householdId: "hh_mercer", category: "hvac", planId: "hvac_filter_management", planName: "Wilson AC Maintenance + Filters", annualAmount: 800, status: "Active", paymentProfileId: "pay_mercer", startedOn: isoDate(-210), renewalOn: isoDate(155), preferredMonths: "Spring / Fall", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: true, standardFiltersIncluded: false, systemCount: 2 }
    ];

    const visits = [
      { id: "visit_reynolds_spring", subscriptionId: "sub_reynolds", householdId: "hh_reynolds", category: "appliance", dueDate: isoDate(12), season: "Spring portfolio visit", status: "Due soon", paymentStatus: "Charged - $3145.00", amountToCharge: 3145, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: true, assetScope: "All appliances" },
      { id: "visit_reynolds_fall", subscriptionId: "sub_reynolds", householdId: "hh_reynolds", category: "appliance", dueDate: isoDate(194), season: "Fall portfolio visit", status: "Upcoming", paymentStatus: "Included - no additional charge", amountToCharge: 0, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: true, assetScope: "All appliances" },
      { id: "visit_davenport", subscriptionId: "sub_davenport", householdId: "hh_davenport", category: "appliance", dueDate: isoDate(24), season: "Fall portfolio visit", status: "Due soon", paymentStatus: "Ready to charge", amountToCharge: 1995, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "All appliances" },
      { id: "visit_torres", subscriptionId: "sub_torres", householdId: "hh_torres", category: "appliance", dueDate: isoDate(-3), season: "Second IMUC visit", status: "Overdue", paymentStatus: "Charge due", amountToCharge: 249.95, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "IMUC only" },
      { id: "visit_mercer_app", subscriptionId: "sub_mercer_app", householdId: "hh_mercer", category: "appliance", dueDate: isoDate(48), season: "Annual whole-home visit", status: "Upcoming", paymentStatus: "Ready to charge", amountToCharge: 1195, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "Appliances" },
      { id: "visit_mercer_imuc", subscriptionId: "sub_mercer_app", householdId: "hh_mercer", category: "appliance", dueDate: isoDate(205), season: "Second IMUC visit", status: "Upcoming", paymentStatus: "Charge due at visit", amountToCharge: 249.95, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "IMUC only" },
      { id: "visit_mercer_hvac", subscriptionId: "sub_mercer_hvac", householdId: "hh_mercer", category: "hvac", dueDate: isoDate(9), season: "Fall HVAC maintenance", status: "Due soon", paymentStatus: "Ready to charge", amountToCharge: 800, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "2 HVAC systems" },
      { id: "visit_davenport_completed", subscriptionId: "sub_davenport", householdId: "hh_davenport", category: "appliance", dueDate: isoDate(-95), completedOn: isoDate(-93), season: "Spring portfolio visit", status: "Completed", paymentStatus: "Paid", amountToCharge: 0, serviceOrderStatus: "Matched - SV0012844", serviceOrderSystem: "EPASS", reportRequired: false, assetScope: "All appliances" }
    ];

    const filters = [
      { id: "filter_1", householdId: "hh_reynolds", assetId: assets.find((a) => a.householdId === "hh_reynolds" && a.type === "refrigerator").id, subscriptionId: "sub_reynolds", filterType: "Refrigerator water filter", partNumber: "4204490", quantity: 1, intervalMonths: 12, lastChangedOn: isoDate(-350), nextDueOn: isoDate(15), status: "Due soon", source: "Wilson supplied", planCoverage: "Included", notes: "Main Kitchen" },
      { id: "filter_2", householdId: "hh_reynolds", assetId: assets.find((a) => a.householdId === "hh_reynolds" && a.type === "ice_maker").id, subscriptionId: "sub_reynolds", filterType: "Icemaker water filter", partNumber: "SCCP5", quantity: 1, intervalMonths: 6, lastChangedOn: isoDate(-190), nextDueOn: isoDate(-8), status: "Overdue", source: "Wilson supplied", planCoverage: "Included", notes: "Wet Bar" },
      { id: "filter_3", householdId: "hh_davenport", assetId: assets.find((a) => a.householdId === "hh_davenport" && a.type === "ice_maker").id, subscriptionId: "sub_davenport", filterType: "Icemaker water filter", partNumber: "SCCP5", quantity: 1, intervalMonths: 6, lastChangedOn: isoDate(-165), nextDueOn: isoDate(18), status: "Due soon", source: "Customer / billed separately", planCoverage: "Track only", notes: "Bar" },
      { id: "filter_4", householdId: "hh_mercer", assetId: assets.find((a) => a.householdId === "hh_mercer" && a.group === "hvac").id, subscriptionId: "sub_mercer_hvac", filterType: "HVAC media filter", partNumber: "20x25x4 MERV 11", quantity: 1, intervalMonths: 6, lastChangedOn: isoDate(-140), nextDueOn: isoDate(42), status: "Upcoming", source: "Wilson sourced / billed separately", planCoverage: "Managed - material billed separately", notes: "Main House air handler" }
    ];

    const reports = [
      {
        id: "report_reynolds_1",
        householdId: "hh_reynolds",
        assetId: assets.find((a) => a.householdId === "hh_reynolds" && a.type === "ice_maker").id,
        reportType: "Appliance Health Report",
        applianceLabel: "Scotsman DCE33 Icemaker",
        technician: "Trevor",
        inspectionDate: isoDate(-175),
        score: 84,
        grade: "B",
        condition: "Good - monitor",
        summary: "The icemaker is producing and harvesting normally. Moderate scale was removed during service. The drain pump is operating, but its sound should be compared again at the next visit.",
        recommendations: "Replace the water filter at the upcoming visit and re-check drain-pump noise.",
        correctiveMeasures: ["Replace water filter at next visit", "Monitor drain-pump sound"],
        nextDueOn: isoDate(6),
        measurements: [
          { label: "Freeze cycle time", observed: "24", unit: "min", target: "Model guidance", result: "In range" },
          { label: "Harvest cycle", observed: "Normal", unit: "", target: "Complete harvest", result: "In range" },
          { label: "Bin control", observed: "Pass", unit: "", target: "Pass", result: "In range" }
        ],
        checkpoints: [
          { category: "Condition & Sanitation", name: "Bin and interior condition", rating: 4, status: "Pass", notes: "Clean after service." },
          { category: "Water System", name: "Water supply connections", rating: 5, status: "Pass", notes: "No visible leaks." },
          { category: "Drain System", name: "Drain or pump condition", rating: 3, status: "Watch", notes: "Slight operating noise; monitor." },
          { category: "Freeze Performance", name: "Freeze cycle performance", rating: 4, status: "Pass", notes: "Normal freeze time." },
          { category: "Harvest Performance", name: "Harvest cycle performance", rating: 4, status: "Pass", notes: "Normal harvest." },
          { category: "Water Quality", name: "Scale and water-quality condition", rating: 4, status: "Pass", notes: "Descaled during visit." },
          { category: "Airflow & Heat Transfer", name: "Condenser coil and airflow", rating: 4, status: "Pass", notes: "Coil vacuumed." },
          { category: "Filtration", name: "Filter status", rating: 3, status: "Watch", notes: "Replacement due next visit." }
        ],
        categoryLosses: [
          { category: "Drain System", loss: 5, explanation: "Pump sound should be monitored." },
          { category: "Filtration", loss: 5, explanation: "Filter is approaching replacement." },
          { category: "Other checkpoints", loss: 6, explanation: "Minor normal-condition deductions." }
        ],
        tasks: ["Vacuum condenser coil", "Descale per manufacturer guidance", "Inspect visible water connections", "Inspect drain or pump", "Photograph key components"],
        filterPart: "SCCP5",
        filterAction: "Replacement recommended",
        photoCount: 3,
        serviceSummary: "Routine cleaning and maintenance completed. No immediate repair was required.",
        createdAt: isoTime(-175 * 1440)
      }
    ];

    const quotes = [
      {
        id: "quote_demo_1",
        quoteNumber: "MP-260821-001",
        status: "Draft",
        propertyName: "Hamilton Family Estate",
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
        contactPhone: "512-555-0188",
        address: "2901 Lake Ridge Drive, Austin, TX 78734",
        planId: "estate_concierge",
        planName: "Estate Concierge",
        baseAmount: 2995,
        additionalApplianceAmount: 750,
        additionalApplianceCount: 5,
        additionalApplianceRate: 150,
        imucAddOnAmount: 0,
        imucSecondVisitCount: 0,
        manualAdjustment: 0,
        annualAmount: 3745,
        applianceCount: 20,
        includedCount: 15,
        assets: [
          { typeLabel: "Refrigerator", brand: "Sub-Zero", model: "BI-48S", location: "Main Kitchen", quantity: 1, imucVisitsPerYear: 1 },
          { typeLabel: "Icemaker (IMUC)", brand: "Scotsman", model: "DCE33", location: "Wet Bar", quantity: 2, imucVisitsPerYear: 2 },
          { typeLabel: "Dishwasher", brand: "Cove", model: "DW2450", location: "Main / Catering Kitchen", quantity: 3, imucVisitsPerYear: 1 },
          { typeLabel: "Other appliance portfolio", brand: "Mixed", model: "See final inventory", location: "Residence", quantity: 14, imucVisitsPerYear: 1 }
        ],
        notes: "Final model and filter inventory to be confirmed during onboarding.",
        validUntil: isoDate(30),
        createdAt: isoTime(-350),
        updatedAt: isoTime(-350)
      }
    ];

    const activity = [
      { id: id("act"), householdId: "hh_reynolds", type: "Report", text: "Appliance health report completed for Scotsman icemaker.", createdAt: isoTime(-1400) },
      { id: id("act"), householdId: "hh_davenport", type: "Plan", text: "Estate Preferred renewal confirmed.", createdAt: isoTime(-900) },
      { id: id("act"), householdId: "hh_torres", type: "Due", text: "Second IMUC maintenance moved to the overdue queue.", createdAt: isoTime(-500) },
      { id: id("act"), householdId: null, type: "Quote", text: "Custom Estate Concierge quote drafted for Hamilton Family Estate.", createdAt: isoTime(-350) }
    ];

    return {
      version: VERSION,
      households,
      assets,
      subscriptions,
      paymentProfiles,
      visits,
      filters,
      reports,
      quotes,
      invoiceImports: [],
      activity,
      lastEnrollmentHouseholdId: null,
      lastQuoteId: "quote_demo_1"
    };
  }

  function load() {
    let current = null;
    try {
      current = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      current = null;
    }
    if (!current || current.version !== VERSION) {
      current = seedState();
      save(current);
    }
    return current;
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  function reset() {
    const state = seedState();
    save(state);
    return state;
  }

  function getHousehold(householdId) {
    return load().households.find((item) => item.id === householdId) || null;
  }

  function getHouseholdBundle(householdId) {
    const state = load();
    const household = state.households.find((item) => item.id === householdId);
    if (!household) return null;
    return {
      household,
      assets: state.assets.filter((item) => item.householdId === householdId),
      subscriptions: state.subscriptions.filter((item) => item.householdId === householdId),
      paymentProfiles: state.paymentProfiles.filter((item) => item.householdId === householdId),
      visits: state.visits.filter((item) => item.householdId === householdId),
      filters: state.filters.filter((item) => item.householdId === householdId),
      reports: state.reports.filter((item) => item.householdId === householdId),
      activity: state.activity.filter((item) => item.householdId === householdId)
    };
  }

  function createVisit(state, subscription, householdId, category, definition) {
    const visit = {
      id: id("visit"),
      subscriptionId: subscription.id,
      householdId,
      category,
      dueDate: definition.dueDate,
      season: definition.season,
      status: definition.status || "Upcoming",
      paymentStatus: definition.paymentStatus || (definition.amountToCharge > 0 ? "Ready to charge" : "Included - no additional charge"),
      amountToCharge: Number(definition.amountToCharge || 0),
      serviceOrderStatus: "Not created",
      serviceOrderSystem: "NetSuite",
      reportRequired: Boolean(definition.reportRequired),
      assetScope: definition.assetScope || "All enrolled equipment",
      serviceOrderMatch: definition.serviceOrderMatch || "Not checked",
      completedOn: definition.completedOn || ""
    };
    state.visits.push(visit);
    return visit;
  }

  function createEnrollment(payload) {
    const state = load();
    const householdId = id("hh");
    const plan = planForPayload(payload);
    const household = {
      id: householdId,
      name: payload.householdLabel ? payload.householdLabel : (payload.firstName + " " + payload.lastName).trim(),
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      preferredContact: payload.preferredContact,
      address1: payload.address1,
      address2: payload.address2 || "",
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      notes: payload.notes || "",
      areas: payload.areas || [],
      billingType: payload.billingType || "Card on File",
      accountTerms: payload.accountTerms || "",
      createdAt: isoTime(0)
    };
    state.households.push(household);

    const newAssets = createAssets(householdId, payload.assets || []);
    state.assets.push.apply(state.assets, newAssets);

    const paymentProfileId = id("pay");
    state.paymentProfiles.push({
      id: paymentProfileId,
      householdId,
      status: payload.paymentReady ? "Ready" : "Pending setup",
      provider: "Stripe",
      brand: payload.paymentReady ? "Demo card" : "",
      last4: payload.paymentReady ? "4242" : "",
      expMonth: payload.paymentReady ? 12 : null,
      expYear: payload.paymentReady ? new Date().getFullYear() + 3 : null,
      stripeCustomerId: payload.paymentReady ? "cus_integration_pending" : "",
      stripePaymentMethodId: payload.paymentReady ? "pm_integration_pending" : ""
    });

    const subscription = {
      id: id("sub"),
      householdId,
      category: payload.category,
      planId: payload.planId,
      planName: plan ? plan.name : payload.planName,
      annualAmount: Number(payload.annualAmount || 0),
      status: "Pending review",
      paymentProfileId,
      startedOn: isoDate(0),
      renewalOn: isoDate(365),
      preferredMonths: payload.preferredMonths || "Office to confirm",
      lastChargeStatus: "Not charged",
      autoRenew: Boolean(payload.autoRenew),
      acceptedTermsAt: payload.acceptedTermsAt || null,
      chargeTiming: "At scheduled maintenance",
      filterServiceAmount: Number(payload.filterServiceAmount || 0),
      filterServiceDetail: payload.filterServiceDetail || null,
      systemCount: payload.systemCount || null,
      filterManagement: Boolean(payload.filterManagement || payload.planId === "estate_concierge"),
      standardFiltersIncluded: Boolean(payload.standardFiltersIncluded || payload.planId === "estate_concierge"),
      pricingBreakdown: payload.pricingBreakdown || null
    };
    state.subscriptions.push(subscription);

    if (payload.category === "hvac") {
      createVisit(state, subscription, householdId, "hvac", {
        dueDate: isoDate(30),
        season: "Initial / spring-fall visit",
        status: "Enrollment review",
        amountToCharge: subscription.annualAmount,
        reportRequired: false,
        assetScope: newAssets.length + " HVAC system" + (newAssets.length === 1 ? "" : "s")
      });
      createVisit(state, subscription, householdId, "hvac", {
        dueDate: isoDate(210),
        season: "Second seasonal visit",
        amountToCharge: 0,
        reportRequired: false,
        assetScope: newAssets.length + " HVAC system" + (newAssets.length === 1 ? "" : "s")
      });
    } else {
      const planVisits = plan ? plan.visitsPerYear : 1;
      const secondImucAssets = newAssets.filter((asset) => asset.group === "imuc" && Number(asset.imucVisitsPerYear) >= 2);
      const imucSecondAmount = secondImucAssets.length * window.WILSON_CONFIG.pricing.imucPerVisit;
      const initialAmount = planVisits >= 2 ? subscription.annualAmount : Math.max(0, subscription.annualAmount - imucSecondAmount);
      createVisit(state, subscription, householdId, "appliance", {
        dueDate: isoDate(30),
        season: "Initial appliance maintenance",
        status: "Enrollment review",
        amountToCharge: initialAmount,
        reportRequired: payload.planId === "estate_concierge",
        assetScope: "All enrolled appliances"
      });
      if (planVisits >= 2) {
        createVisit(state, subscription, householdId, "appliance", {
          dueDate: isoDate(210),
          season: "Second whole-home visit",
          amountToCharge: 0,
          reportRequired: payload.planId === "estate_concierge",
          assetScope: "All enrolled appliances"
        });
      } else if (secondImucAssets.length) {
        createVisit(state, subscription, householdId, "appliance", {
          dueDate: isoDate(210),
          season: "Second IMUC visit",
          amountToCharge: imucSecondAmount,
          reportRequired: payload.planId === "estate_concierge",
          assetScope: secondImucAssets.length + " IMUC icemaker" + (secondImucAssets.length === 1 ? "" : "s")
        });
      }
    }

    const coverage = subscription.standardFiltersIncluded
      ? "Included"
      : (subscription.filterManagement ? "Managed - material billed separately" : "Track only");
    if (subscription.filterManagement || payload.category === "appliance") {
      const filterRecords = createFilterRecords(householdId, newAssets, subscription, coverage);
      state.filters.push.apply(state.filters, filterRecords);
    }

    state.activity.unshift({
      id: id("act"),
      householdId,
      type: "Enrollment",
      text: "New " + subscription.planName + " enrollment submitted from the website.",
      createdAt: isoTime(0)
    });
    state.lastEnrollmentHouseholdId = householdId;
    save(state);
    return getHouseholdBundle(householdId);
  }

  function queueServiceOrder(visitId) {
    const state = load();
    const visit = state.visits.find((item) => item.id === visitId);
    if (!visit) return null;
    visit.serviceOrderStatus = "Queued - NetSuite integration pending";
    visit.status = "Ready for dispatch";
    state.activity.unshift({
      id: id("act"),
      householdId: visit.householdId,
      type: "Service order",
      text: "NetSuite service-order generation queued. External integration is not yet connected.",
      createdAt: isoTime(0)
    });
    save(state);
    return visit;
  }

  function mockCharge(visitOrSubscriptionId) {
    const state = load();
    let visit = state.visits.find((item) => item.id === visitOrSubscriptionId);
    if (!visit) visit = state.visits.find((item) => item.subscriptionId === visitOrSubscriptionId && Number(item.amountToCharge || 0) > 0);
    if (!visit) return { ok: false, message: "No chargeable maintenance interval was found." };
    const subscription = state.subscriptions.find((item) => item.id === visit.subscriptionId);
    const household = state.households.find((item) => item.id === visit.householdId);
    const payment = state.paymentProfiles.find((item) => item.id === subscription.paymentProfileId);
    const isAR = household && household.billingType === "AR Account";
    if (!isAR && (!payment || payment.status !== "Ready")) return { ok: false, message: "No ready payment method is on file." };
    if (Number(visit.amountToCharge || 0) <= 0) return { ok: false, message: "This visit is included and has no additional charge." };
    visit.paymentStatus = isAR ? "Posted to AR - $" + Number(visit.amountToCharge).toFixed(2) : "Charged - $" + Number(visit.amountToCharge).toFixed(2);
    visit.chargedAt = isoTime(0);
    visit.serviceOrderMatch = "Pending verification";
    subscription.lastChargeStatus = isAR ? "Posted to AR" : "Charged";
    state.activity.unshift({
      id: id("act"),
      householdId: subscription.householdId,
      type: "Payment",
      text: (isAR ? "Scheduled maintenance posted to AR for $" : "Scheduled-maintenance card charge completed for $") + Number(visit.amountToCharge).toFixed(2) + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, message: (isAR ? "Posted to AR for $" : "Demo card charged $") + Number(visit.amountToCharge).toFixed(2) + "." };
  }

  function connectPayment(householdId) {
    const state = load();
    const profile = state.paymentProfiles.find((item) => item.householdId === householdId);
    if (!profile) return null;
    profile.status = "Ready";
    profile.brand = "Demo card";
    profile.last4 = "4242";
    profile.expMonth = 12;
    profile.expYear = new Date().getFullYear() + 3;
    profile.stripeCustomerId = "cus_integration_pending";
    profile.stripePaymentMethodId = "pm_integration_pending";
    state.visits.filter((item) => item.householdId === householdId && Number(item.amountToCharge || 0) > 0).forEach((visit) => {
      visit.paymentStatus = "Ready to charge";
    });
    save(state);
    return profile;
  }


  function setHouseholdBilling(householdId, billingType, accountTerms) {
    const state = load();
    const household = state.households.find((item) => item.id === householdId);
    if (!household) return null;
    household.billingType = billingType || "Card on File";
    household.accountTerms = household.billingType === "AR Account" ? (accountTerms || "Net 30") : "";
    state.activity.unshift({ id: id("act"), householdId, type: "Plan", text: "Billing method updated to " + household.billingType + (household.accountTerms ? " (" + household.accountTerms + ")" : "") + ".", createdAt: isoTime(0) });
    save(state);
    return household;
  }

  function markVisitCompleted(visitId) {
    const state = load();
    const visit = state.visits.find((item) => item.id === visitId);
    if (!visit) return null;
    visit.status = "Completed";
    visit.completedOn = isoDate(0);
    state.activity.unshift({ id: id("act"), householdId: visit.householdId, type: "Due", text: "Maintenance visit marked complete.", createdAt: isoTime(0) });
    save(state);
    return visit;
  }

  function saveTechInspection(payload) {
    const state = load();
    if (!Array.isArray(state.techInspections)) state.techInspections = [];
    const existing = state.techInspections.find((item) => item.visitId === payload.visitId && item.assetId === payload.assetId);
    const record = Object.assign({}, existing || {}, payload, { id: existing ? existing.id : id("inspect"), updatedAt: isoTime(0) });
    if (existing) Object.assign(existing, record); else state.techInspections.push(record);
    save(state);
    return record;
  }

  function getTechInspection(visitId, assetId) {
    const state = load();
    return (state.techInspections || []).find((item) => item.visitId === visitId && item.assetId === assetId) || null;
  }

  function scopedAssetsForVisit(state, visit) {
    if (!visit) return [];
    let rows = state.assets.filter((item) => item.householdId === visit.householdId && item.group !== "hvac" && item.status !== "Inactive");
    const scope = String(visit.assetScope || "").toLowerCase();
    if (scope.includes("imuc only") || scope.includes("icemaker only")) rows = rows.filter((item) => item.group === "imuc" || String(item.type || "").toLowerCase().includes("ice"));
    return rows;
  }

  function measurementRowsFromInspection(inspection) {
    const rows = [];
    (inspection.checks || []).forEach(function (check) {
      if (Array.isArray(check.readingFields) && check.readingFields.length) {
        check.readingFields.forEach(function (field) {
          const observed = check.readings && check.readings[field.key];
          if (String(observed == null ? "" : observed).trim() === "") return;
          rows.push({
            label: check.name + " — " + field.label,
            observed: String(observed),
            unit: field.unit || "",
            target: check.guidance || "Technician / manufacturer check",
            result: Number(check.rating) >= 4 ? "Normal" : Number(check.rating) === 3 ? "Monitor" : "Action",
            notes: check.note || ""
          });
        });
        if (check.id === "condenser_temp") {
          const ambient = parseFloat(check.readings && check.readings.ambient);
          const coil = parseFloat(check.readings && check.readings.coilSurface);
          if (Number.isFinite(ambient) && Number.isFinite(coil)) {
            const td = coil - ambient;
            rows.push({
              label: "Condenser temperature differential",
              observed: td.toFixed(1),
              unit: "°F",
              target: "About 15–30°F above ambient",
              result: td >= 15 && td <= 30 && coil < 120 ? "Normal" : "Monitor",
              notes: check.note || ""
            });
          }
        }
      } else if (String(check.reading || "").trim() !== "") {
        rows.push({
          label: check.name,
          observed: check.reading,
          unit: check.unit || "",
          target: check.guidance || "Technician / manufacturer check",
          result: Number(check.rating) >= 4 ? "Normal" : Number(check.rating) === 3 ? "Monitor" : "Action",
          notes: check.note || ""
        });
      }
    });
    return rows;
  }

  function refreshVisitReportStatusInState(state, visitId) {
    const visit = state.visits.find((item) => item.id === visitId);
    if (!visit || visit.category !== "appliance") return null;
    const scoped = scopedAssetsForVisit(state, visit);
    if (!scoped.length) return visit;
    const inspections = state.techInspections || [];
    const allComplete = scoped.every((asset) => inspections.some((inspection) => inspection.visitId === visitId && inspection.assetId === asset.id && inspection.complete));
    const reportCount = state.reports.filter((report) => report.visitId === visitId).length;
    visit.fieldProgress = { completed: scoped.filter((asset) => inspections.some((inspection) => inspection.visitId === visitId && inspection.assetId === asset.id && inspection.complete)).length, total: scoped.length };
    visit.reportCount = reportCount;
    if (allComplete && reportCount >= scoped.length) {
      const wasComplete = visit.status === "Completed";
      visit.status = "Completed";
      visit.completedOn = visit.completedOn || isoDate(0);
      if (!visit.reportDeliveryStatus || visit.reportDeliveryStatus === "Not ready") {
        visit.reportDeliveryStatus = "Ready to email";
        visit.reportReadyAt = isoTime(0);
      }
      if (!wasComplete) {
        state.activity.unshift({ id: id("act"), householdId: visit.householdId, type: "Report", text: reportCount + " field health report" + (reportCount === 1 ? " is" : "s are") + " ready for customer review and email.", createdAt: isoTime(0) });
      }
    }
    return visit;
  }

  function refreshVisitReportStatus(visitId) {
    const state = load();
    const visit = refreshVisitReportStatusInState(state, visitId);
    save(state);
    return visit;
  }

  function generateReportFromTechInspection(visitId, assetId) {
    const state = load();
    const inspection = (state.techInspections || []).find((item) => item.visitId === visitId && item.assetId === assetId);
    if (!inspection || !inspection.complete) return { ok: false, message: "Complete the field protocol before generating a report." };
    const existing = state.reports.find((item) => item.visitId === visitId && item.assetId === assetId);
    const asset = state.assets.find((item) => item.id === assetId);
    const visit = state.visits.find((item) => item.id === visitId);
    const subscription = visit ? state.subscriptions.find((item) => item.id === visit.subscriptionId) : null;
    if (!asset || !visit) return { ok: false, message: "Field inspection is missing its appliance or maintenance visit." };
    const low = (inspection.checks || []).filter((check) => Number(check.rating) <= 2);
    const watch = (inspection.checks || []).filter((check) => Number(check.rating) === 3);
    const isRefrigeration = String(asset.customerCategory || "").toLowerCase() === "refrigeration" || /refrig|freezer|wine/i.test(String(asset.type || ""));
    const concierge = subscription && subscription.planId === "estate_concierge";
    const filterActive = isRefrigeration && (asset.filterServiceOptIn || asset.airFilterServiceOptIn || concierge);
    const reportId = existing ? existing.id : id("report");
    const report = {
      id: reportId,
      householdId: inspection.householdId || visit.householdId,
      assetId: assetId,
      visitId: visitId,
      source: "Field technician",
      reportType: "Appliance Health Report",
      applianceLabel: [asset.brand, asset.model, asset.typeLabel].filter(Boolean).join(" "),
      technician: inspection.technician || "Wilson technician",
      inspectionDate: inspection.inspectionDate || isoDate(0),
      nextDueOn: addMonths(inspection.inspectionDate || isoDate(0), visit.season && String(visit.season).toLowerCase().includes("annual") ? 12 : 6),
      reference: visitId,
      score: Number(inspection.score || 0),
      grade: inspection.grade || "–",
      condition: inspection.condition || "Not graded",
      summary: low.length ? "Maintenance completed. One or more health checkpoints need follow-up." : watch.length ? "Maintenance completed. Appliance is operating with one or more items to monitor." : "Maintenance completed. Appliance is operating normally at this visit.",
      recommendations: low.map((check) => check.note || check.name).join("; "),
      correctiveMeasures: low.map((check) => check.note || check.name),
      serviceSummary: "Required health checks and maintenance steps were completed in the field workflow.",
      filterPart: filterActive ? "Exact filter(s) verified in field / filter record" : "",
      filterAction: filterActive ? (concierge ? "Filter service included" : "Filter service selected") : (isRefrigeration ? "Inspected - replacement not enrolled" : ""),
      measurements: measurementRowsFromInspection(inspection),
      checkpoints: (inspection.checks || []).map((check) => ({ category: "Health vital", name: check.name, rating: Number(check.rating), status: Number(check.rating) >= 4 ? "Pass" : Number(check.rating) === 3 ? "Watch" : "Action", notes: check.note || "" })),
      categoryLosses: [],
      tasks: (inspection.checks || []).filter((check) => check.performed).map((check) => check.name),
      photoCount: (inspection.checks || []).filter((check) => check.photo).length + (inspection.serialPhoto ? 1 : 0),
      lifecycle: { age: Number(inspection.age || 0), tier: inspection.tier || "premium", expectedYears: Number(inspection.expectedYears || 0), ageScore: Number(inspection.ageScore || 0), vitalScore: Number(inspection.vitalScore || 0), stage: inspection.lifeStage || "", lifeRatio: Number(inspection.lifeRatio || 0) },
      createdAt: isoTime(0)
    };
    if (existing) Object.assign(existing, report); else state.reports.unshift(report);
    inspection.reportId = reportId;
    state.activity.unshift({ id: id("act"), householdId: visit.householdId, type: "Report", text: (existing ? "Field-generated appliance health report refreshed for " : "Field-generated appliance health report completed for ") + report.applianceLabel + ".", createdAt: isoTime(0) });
    refreshVisitReportStatusInState(state, visitId);
    save(state);
    return { ok: true, report: existing || report, existing: Boolean(existing) };
  }

  function queueReportEmail(visitId) {
    const state = load();
    const visit = state.visits.find((item) => item.id === visitId);
    if (!visit) return { ok: false, message: "Maintenance visit not found." };
    const reports = state.reports.filter((item) => item.visitId === visitId);
    if (!reports.length) return { ok: false, message: "No field-generated reports are ready for this visit." };
    const household = state.households.find((item) => item.id === visit.householdId);
    visit.reportDeliveryStatus = "Queued for email";
    visit.reportEmail = household && household.email ? household.email : "";
    visit.reportEmailQueuedAt = isoTime(0);
    state.activity.unshift({ id: id("act"), householdId: visit.householdId, type: "Report", text: "Health report email queued for " + (visit.reportEmail || "customer contact") + ". Email integration is still a production handoff.", createdAt: isoTime(0) });
    save(state);
    return { ok: true, message: "Report package queued for " + (visit.reportEmail || "the customer") + "." };
  }

  function saveReport(payload) {
    const state = load();
    const reportId = id("report");
    const report = Object.assign({}, payload, { id: reportId, createdAt: isoTime(0) });
    state.reports.unshift(report);
    state.activity.unshift({
      id: id("act"),
      householdId: payload.householdId,
      type: "Report",
      text: "Appliance health report saved for " + payload.applianceLabel + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return report;
  }

  function getReport(reportId) {
    return load().reports.find((item) => item.id === reportId) || null;
  }

  function saveQuote(payload) {
    const state = load();
    const quoteId = id("quote");
    const sequence = String(state.quotes.length + 1).padStart(3, "0");
    const dateStamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const quote = Object.assign({}, payload, {
      id: quoteId,
      quoteNumber: payload.quoteNumber || "MP-" + dateStamp + "-" + sequence,
      status: payload.status || "Draft",
      createdAt: isoTime(0),
      updatedAt: isoTime(0)
    });
    state.quotes.unshift(quote);
    state.lastQuoteId = quoteId;
    state.activity.unshift({
      id: id("act"),
      householdId: null,
      type: "Quote",
      text: "Custom maintenance quote drafted for " + quote.propertyName + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return quote;
  }

  function getQuote(quoteId) {
    return load().quotes.find((item) => item.id === quoteId) || null;
  }

  function updateQuoteStatus(quoteId, status) {
    const state = load();
    const quote = state.quotes.find((item) => item.id === quoteId);
    if (!quote) return null;
    quote.status = status;
    quote.updatedAt = isoTime(0);
    state.activity.unshift({ id: id("act"), householdId: null, type: "Quote", text: quote.quoteNumber + " marked " + status + ".", createdAt: isoTime(0) });
    save(state);
    return quote;
  }

  function saveInvoiceDraft(draft) {
    localStorage.setItem(INVOICE_DRAFT_KEY, JSON.stringify(draft || null));
    return draft;
  }

  function loadInvoiceDraft() {
    try {
      return JSON.parse(localStorage.getItem(INVOICE_DRAFT_KEY));
    } catch (error) {
      return null;
    }
  }

  function clearInvoiceDraft() {
    localStorage.removeItem(INVOICE_DRAFT_KEY);
  }

  function recordInvoiceImport(payload) {
    const state = load();
    if (!Array.isArray(state.invoiceImports)) state.invoiceImports = [];
    const record = Object.assign({}, payload, {
      id: id("import"),
      importedAt: isoTime(0)
    });
    state.invoiceImports.unshift(record);
    state.activity.unshift({
      id: id("act"),
      householdId: null,
      type: "Invoice",
      text: "Sales invoice " + ((record.invoiceNumbers || []).join(", ") || "file") + " imported for maintenance-plan review.",
      createdAt: isoTime(0)
    });
    save(state);
    return record;
  }

  function lastEnrollment() {
    const state = load();
    return state.lastEnrollmentHouseholdId ? getHouseholdBundle(state.lastEnrollmentHouseholdId) : null;
  }

  function lastQuote() {
    const state = load();
    return state.lastQuoteId ? getQuote(state.lastQuoteId) : null;
  }

  window.WilsonStore = {
    load,
    save,
    reset,
    getHousehold,
    getHouseholdBundle,
    createEnrollment,
    queueServiceOrder,
    mockCharge,
    connectPayment,
    setHouseholdBilling,
    markVisitCompleted,
    saveTechInspection,
    getTechInspection,
    generateReportFromTechInspection,
    refreshVisitReportStatus,
    queueReportEmail,
    saveReport,
    getReport,
    saveQuote,
    getQuote,
    updateQuoteStatus,
    saveInvoiceDraft,
    loadInvoiceDraft,
    clearInvoiceDraft,
    recordInvoiceImport,
    lastEnrollment,
    lastQuote,
    isoDate,
    addMonths
  };
})();
