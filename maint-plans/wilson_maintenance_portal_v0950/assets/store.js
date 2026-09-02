(function () {
  const STORAGE_KEY = "wilson-maintenance-demo-v07";
  const INVOICE_DRAFT_KEY = "wilson-maintenance-invoice-draft-v07";
  /* v0.9.34 bumps this: assets gained `detailProvenance` and the state gained
     `parkedEquipment`. A stored state from an older version is reseeded rather
     than migrated -- this is a prototype with demo data, and a half-migrated
     record is a worse thing to debug than a fresh one. */
  const VERSION = 8;

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

  /*
   * Existing records predate per-field provenance and carry one `source` for the
   * whole row. Backfilling from it beats leaving three fields reading "unknown"
   * on data that plainly came from somewhere -- and it is only applied to fields
   * that actually have a value.
   */
  function seedProvenance(item) {
    /*
     * An appliance whose install year came off a Wilson invoice had its brand
     * and model come off the same line. Reading only `source` here labelled
     * every seeded appliance "as the customer stated", including a Sub-Zero
     * transcribed from invoice SV0009120 -- which is a worse lie than saying
     * nothing, because a technician reads that line to decide how hard to look.
     */
    const ref = item.sourceInvoice || (item.ageSource === "invoice" ? item.ageSourceRef : "") || "";
    const source = (item.source === "invoice" || item.sourceInvoice || item.ageSource === "invoice")
      ? "invoice" : (item.source || "customer");
    const out = {};
    ["brand", "model", "serial"].forEach(function (field) {
      if (String(item[field] || "").trim()) out[field] = { source: source, ref: ref, at: "" };
    });
    return out;
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
        /* HVAC nameplate data. Empty for everything else, and empty for an HVAC
           system nobody has read the plate on yet -- which is a state the
           report handles rather than papers over. */
        design: item.design || {},
        /* Where the install year came from, and the document behind it. Age
           moves a quarter of the health score, so an undated appliance says
           "unknown" rather than quietly defaulting to something usable. */
        installDate: item.installDate || "",
        ageSource: item.ageSource || (item.installYear ? "customer" : "unknown"),
        ageSourceRef: item.ageSourceRef || "",
        /*
         * WHERE BRAND, MODEL AND SERIAL CAME FROM.   (v0.9.34)
         *
         * Registration deliberately collects none of them, so every one of these
         * arrives later -- off an invoice, keyed by the office, or corrected by
         * the technician standing in front of the machine. A pre-filled field on
         * a field card that cannot say where it came from tells a technician
         * nothing about how hard to look, and a report cannot describe a figure
         * it cannot trace.
         *
         * Shape: { brand: { source, ref, at }, model: {...}, serial: {...} }.
         * Seeded from `source` for existing records so nothing reads as unknown
         * that was in fact imported.
         */
        detailProvenance: item.detailProvenance || seedProvenance(item),
        /* Set when a technician finds a DIFFERENT machine in this slot. Trend
           analysis ignores every report before it -- see trend-analysis.js. */
        lineageStartedAt: item.lineageStartedAt || "",
        /* The machines that were here before. Kept, not overwritten: that
           Wilson sold the original and somebody else replaced it is a fact
           about the customer worth having. */
        replacedMachines: item.replacedMachines || [],
        checkpointSet: item.checkpointSet || "generic",
        filterTypes: item.filterTypes || [],
        filterServiceOptIn: Boolean(item.filterServiceOptIn),
        airFilterServiceOptIn: Boolean(item.airFilterServiceOptIn),
        /* v0.9.39: Wilson Temp Watch, chosen at registration on the add-on
           card. The sensor install itself is scheduled with the first visit. */
        tempMonitoringOptIn: Boolean(item.tempMonitoringOptIn),
        /* v0.9.47: which compartments the Guardian sensors watch -- each one
           is a sensor on the household's price ladder. */
        tempMonitoringCompartments: Array.isArray(item.tempMonitoringCompartments)
          ? item.tempMonitoringCompartments.slice() : [],
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
          notes: asset.filterLocation || "",
          /* Nobody at registration confirms part numbers — the customer is
             never asked for one (a model-number hurdle would cost sign-ups),
             and even a typed filterSize is the customer's memory, not a
             lookup. Every new record therefore lands in the office's Filter
             verification queue until someone confirms it in Filter Finder. */
          verified: false
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
        notes: "House manager coordinates access.",
        /* Was prose: "Gate code stored in the service system." Structured at
           v0.9.27 so the office sees an instruction rather than a sentence. The
           code itself stays out of here by design. */
        schedulingPreference: {
          months: ["mar", "apr", "sep", "oct"], days: ["mon", "tue", "wed", "thu", "fri"],
          timeOfDay: "any", access: ["gate", "occupant_required", "dog"],
          blackouts: [{ from: isoDate(150), to: isoDate(171), note: "Family away" }],
          note: "Reach the house manager before dispatching."
        },
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
        notes: "",
        /* Was prose: "Preferred appointment window is Tuesday or Thursday
           morning." The same fact, now filterable. */
        schedulingPreference: {
          months: [], days: ["tue", "thu"], timeOfDay: "morning",
          access: ["notice_required"], blackouts: [], note: ""
        },
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
      /*
       * v0.9.34. THE CASE EVERY NEW CUSTOMER ACTUALLY IS.
       *
       * Registration deliberately does not ask for a brand, so a household that
       * signed up last week has appliance types, areas and nothing else. Until
       * this record existed, every seeded household already had brands on
       * everything -- which made the whole enrichment loop invisible in the demo
       * and the "needs equipment info" queue stage permanently read zero.
       *
       * A prototype whose demo data only shows the finished state is a prototype
       * nobody can evaluate the unfinished state in.
       */
      {
        id: "hh_okafor",
        name: "Okafor Residence",
        firstName: "Ngozi",
        lastName: "Okafor",
        email: "ngozi@example.com",
        phone: "512-555-0193",
        preferredContact: "Text",
        address1: "1177 Cielo Ranch Road",
        address2: "",
        city: "Austin",
        state: "TX",
        zip: "78733",
        notes: "Signed up online. No sales invoice on file yet -- equipment details still to collect.",
        billingType: "Card on File", accountTerms: "", createdAt: isoTime(-14 * 24 * 60)
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
        billingType: "Card on File", accountTerms: "", createdAt: isoTime(-2000)
      }
    ];

    let assets = [];
    assets = assets.concat(createAssets("hh_reynolds", [
      appliance("refrigerator", "Refrigerator", "Sub-Zero", "BI-48S", "Main Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter", "Refrigerator air / food-preservation filter"], installYear: 2014, ageSource: "invoice", ageSourceRef: "SV0009120", tempMonitoringOptIn: true }),
      appliance("freezer", "Freezer", "Sub-Zero", "BI-36F", "Main Kitchen", "refrigerator", { filterTypes: ["Freezer water filter"], installYear: 2014, ageSource: "invoice", ageSourceRef: "SV0009120", tempMonitoringOptIn: true }),
      appliance("dishwasher", "Dishwasher", "Cove", "DW2450", "Main Kitchen - Left", "dishwasher", { installYear: 2019, ageSource: "invoice", ageSourceRef: "SV0010884" }),
      appliance("dishwasher", "Dishwasher", "Cove", "DW2450", "Main Kitchen - Right", "dishwasher", { installYear: 2019, ageSource: "invoice", ageSourceRef: "SV0010884" }),
      appliance("range", "Range", "Wolf", "GR486G", "Main Kitchen", "cooking", { installYear: 2014, ageSource: "invoice", ageSourceRef: "SV0009120" }),
      appliance("hood", "Vent Hood", "Wolf", "PI543418", "Main Kitchen", "ventilation", { installYear: 2014, ageSource: "invoice", ageSourceRef: "SV0009120" }),
      appliance("wall_oven", "Wall Oven", "Wolf", "SO3050CM", "Catering Kitchen", "cooking", { installYear: 2016, ageSource: "invoice", ageSourceRef: "SV0009903" }),
      appliance("refrigerator", "Refrigerator", "Sub-Zero", "CL3650R", "Catering Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter"], installYear: 2016, ageSource: "invoice", ageSourceRef: "SV0009903", tempMonitoringOptIn: true }),
      appliance("ice_maker", "Icemaker (IMUC)", "Scotsman", "DCE33", "Wet Bar", "icemaker", { filterTypes: ["Icemaker water filter"], installYear: 2017, ageSource: "invoice", ageSourceRef: "SV0010211" }),
      appliance("wine_beverage", "Wine Storage", "Sub-Zero", "UW-24", "Wine Room", "refrigerator", { installYear: 2018, ageSource: "invoice", ageSourceRef: "SV0010502", tempMonitoringOptIn: true }),
      appliance("washer", "Washer", "Miele", "WXF660", "Primary Laundry", "washer", { installYear: 2019, ageSource: "invoice", ageSourceRef: "SV0010884" }),
      appliance("dryer", "Dryer", "Miele", "TXI680", "Primary Laundry", "dryer", { installYear: 2019, ageSource: "invoice", ageSourceRef: "SV0010884" }),
      appliance("washer", "Washer", "Speed Queen", "FF7009", "Guest Laundry", "washer", { installYear: null, ageSource: "unknown", ageSourceRef: "" }),
      appliance("dryer", "Dryer", "Speed Queen", "DF7004", "Guest Laundry", "dryer", { installYear: null, ageSource: "unknown", ageSourceRef: "" }),
      appliance("outdoor_grill", "Outdoor Grill", "Hestan", "GMBR36", "Outdoor Kitchen", "outdoor_grill", { installYear: 2019, ageSource: "customer", ageSourceRef: "" }),
      appliance("refrigerator", "Outdoor Refrigerator", "True", "TUR-24", "Outdoor Kitchen", "refrigerator", { installYear: 2019, ageSource: "invoice", ageSourceRef: "SV0010884" })
    ]));

    assets = assets.concat(createAssets("hh_davenport", [
      /* The two-probe demo (v0.9.47): one appliance, fresh-food AND freezer
         compartments each carrying a Guardian sensor -- Cayden: "Some will
         want a sensor in freezer and refrigerator compartments on same
         unit." Two fleet rows, two rules, one appliance card. */
      appliance("refrigerator", "Refrigerator", "Thermador", "T36BT925NS", "Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter"], installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101", tempMonitoringOptIn: true, tempMonitoringCompartments: ["fresh_food", "freezer"] }),
      appliance("freezer", "Freezer", "Thermador", "T24IF905SP", "Kitchen", "refrigerator", { installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101", tempMonitoringOptIn: true }),
      appliance("dishwasher", "Dishwasher", "Thermador", "DWHD770WPR", "Kitchen", "dishwasher", { installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101" }),
      appliance("range", "Range", "Thermador", "PRD486WDHU", "Kitchen", "cooking", { installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101" }),
      appliance("hood", "Vent Hood", "Thermador", "VCIN48GWS", "Kitchen", "ventilation", { installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101" }),
      appliance("speed_oven", "Speed Oven", "Thermador", "MC30WP", "Kitchen", "microwave", { installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101" }),
      appliance("wine_beverage", "Wine Column", "Thermador", "T24IW905SP", "Bar", "refrigerator", { installYear: 2021, ageSource: "invoice", ageSourceRef: "SV0012101", tempMonitoringOptIn: true }),
      appliance("ice_maker", "Icemaker (IMUC)", "Scotsman", "CU50", "Bar", "icemaker", { filterTypes: ["Icemaker water filter"], installYear: 2022, ageSource: "invoice", ageSourceRef: "SV0012440" }),
      appliance("washer", "Washer", "LG", "WM6700", "Laundry", "washer", { installYear: 2022, ageSource: "customer", ageSourceRef: "" }),
      appliance("dryer", "Dryer", "LG", "DLEX6700", "Laundry", "dryer", { installYear: 2022, ageSource: "customer", ageSourceRef: "" })
    ]));

    /*
     * Slots, not appliances. This is what `createEnrollment` produces from the
     * customer-facing form: a type, an area, and a plan. Brand, model, serial
     * and install year are all blank, and `source: "customer"` says who put the
     * record there.
     */
    assets = assets.concat(createAssets("hh_okafor", [
      appliance("refrigerator", "Refrigerator", "", "", "Kitchen", "refrigerator", { filterTypes: ["Refrigerator water filter"], source: "customer" }),
      appliance("dishwasher", "Dishwasher", "", "", "Kitchen", "dishwasher", { source: "customer" }),
      appliance("range", "Range", "", "", "Kitchen", "cooking", { source: "customer" }),
      appliance("hood", "Vent Hood", "", "", "Kitchen", "ventilation", { source: "customer" }),
      appliance("washer", "Washer", "", "", "Laundry", "washer", { source: "customer" }),
      appliance("dryer", "Dryer", "", "", "Laundry", "dryer", { source: "customer" }),
      appliance("wine_beverage", "Wine Storage", "", "", "Bar", "refrigerator", { source: "customer" })
    ]));

    assets = assets.concat(createAssets("hh_torres", [
      appliance("ice_maker", "Icemaker (IMUC)", "KitchenAid", "KUIX535HPS", "Kitchen", "icemaker", { filterTypes: ["Icemaker water filter"] })
    ]));

    assets = assets.concat(createAssets("hh_mercer", [
      appliance("refrigerator", "Refrigerator", "Sub-Zero", "BI-42S", "Main House", "refrigerator", { filterTypes: ["Refrigerator water filter"] }),
      appliance("dishwasher", "Dishwasher", "Cove", "DW2450", "Main House", "dishwasher"),
      appliance("range", "Range", "Wolf", "GR366", "Main House", "cooking"),
      appliance("ice_maker", "Icemaker (IMUC)", "Scotsman", "DCE33", "Game Room", "icemaker", { filterTypes: ["Icemaker water filter"] }),
      /*
       * HVAC systems now carry a DESIGN PROFILE -- the nameplate data every
       * scored target is measured against. This is what makes "judged against
       * its own design" work: the main-house system is a 14-SEER unit and it
       * can score 100 by delivering what a 14-SEER unit is supposed to deliver.
       *
       * The guest-house system deliberately has NO design profile. It is the
       * demo case for the coverage floor: readings are taken and reported, no
       * health score is published, and the report asks for the plate data by
       * name. Half of Wilson's existing HVAC customers will look like this on
       * the first visit.
       */
      { type: "Split System", typeLabel: "HVAC System", group: "hvac", brand: "Trane", model: "4TWR6042H1000AB",
        location: "Main House", checkpointSet: "generic",
        filterTypes: ["HVAC media filter"], filterSize: "20x25x4 MERV 11", filterQuantity: 1, filterLocation: "Air handler",
        installYear: 2013, ageSource: "invoice", ageSourceRef: "SV0008640",
        design: { ratedTons: 3.5, ratedCfm: 1400, maxEsp: 0.5, condenserRla: 21.3, blowerFla: 7.5,
                  refrigerant: "R-410A", meteringDevice: "TXV", ratedSeer: 14 } },

      { type: "Split System", typeLabel: "HVAC System", group: "hvac", brand: "Trane", model: "4TWR6036",
        location: "Guest House", checkpointSet: "generic",
        filterTypes: ["HVAC media filter"], filterSize: "20x20x4 MERV 11", filterQuantity: 1, filterLocation: "Return grille",
        installYear: null, ageSource: "unknown", ageSourceRef: "",
        design: {} },

      /* A gas furnace, enrolled as its own system type rather than as a split
         system. Before v0.9.14 there was no furnace type, so a furnace was
         enrolled as a Split System and inspected on a cooling protocol that
         asks for a refrigerant circuit it does not have. Its plate rise range
         is the cleanest design-spec target in the product. */
      { type: "Gas Furnace", typeLabel: "Gas Furnace", group: "hvac", brand: "Trane", model: "S9V2B080U3PSAA",
        location: "Main House - Attic", checkpointSet: "generic",
        filterTypes: ["HVAC media filter"], filterSize: "20x25x4 MERV 11", filterQuantity: 1, filterLocation: "Air handler",
        installYear: 2013, ageSource: "invoice", ageSourceRef: "SV0008640",
        design: { maxEsp: 0.5, blowerFla: 7.5, riseRangeLow: 35, riseRangeHigh: 65, ratedAfue: 96 } }
    ]));

    const paymentProfiles = [
      { id: "pay_reynolds", householdId: "hh_reynolds", status: "Ready", provider: "Stripe", brand: "Visa", last4: "4288", expMonth: 8, expYear: 2029, stripeCustomerId: "cus_demo_reynolds", stripePaymentMethodId: "pm_demo_reynolds" },
      { id: "pay_davenport", householdId: "hh_davenport", status: "Needs update", provider: "Stripe", brand: "Amex", last4: "1005", expMonth: 4, expYear: 2026, stripeCustomerId: "cus_demo_davenport", stripePaymentMethodId: "pm_demo_davenport" },
      { id: "pay_torres", householdId: "hh_torres", status: "Ready", provider: "Stripe", brand: "Mastercard", last4: "5454", expMonth: 12, expYear: 2028, stripeCustomerId: "cus_demo_torres", stripePaymentMethodId: "pm_demo_torres" },
      { id: "pay_okafor", householdId: "hh_okafor", status: "Ready", provider: "Stripe", brand: "Visa", last4: "3312", expMonth: 6, expYear: 2029, stripeCustomerId: "cus_demo_okafor", stripePaymentMethodId: "pm_demo_okafor" },
      { id: "pay_mercer", householdId: "hh_mercer", status: "Ready", provider: "Stripe", brand: "Visa", last4: "9011", expMonth: 10, expYear: 2030, stripeCustomerId: "cus_demo_mercer", stripePaymentMethodId: "pm_demo_mercer" }
    ];

    /*
     * SEEDED PLAN PRICES COME FROM THE ENGINE.                   (v0.9.41)
     *
     * Every one of these annuals used to be a hand-typed number, and two had
     * quietly drifted from what WILSON_PRICING computes for the same house on
     * the same plan -- Reynolds and Davenport enrolled Guardian sensors in
     * v0.9.40 and their seeded annuals never heard about it, which the new
     * amendment screen exposed on arrival as a phantom "difference" before
     * anything was added. The amendment work is exactly why this cannot be a
     * literal: the difference the customer signs for is new-total minus
     * on-file, so on-file must be the engine's number or the difference lies.
     */
    const seededApplianceAnnual = function (householdId, planId) {
      return window.WILSON_PRICING.annual(
        assets.filter(function (a) { return a.householdId === householdId && a.group !== "hvac"; }),
        planId
      );
    };
    const REYNOLDS_ANNUAL = seededApplianceAnnual("hh_reynolds", "estate_concierge");
    const DAVENPORT_ANNUAL = seededApplianceAnnual("hh_davenport", "estate_preferred");
    const OKAFOR_ANNUAL = seededApplianceAnnual("hh_okafor", "per_appliance");
    const TORRES_ANNUAL = seededApplianceAnnual("hh_torres", "per_appliance");
    const MERCER_APP_ANNUAL = seededApplianceAnnual("hh_mercer", "estate_annual");

    const subscriptions = [
      { id: "sub_reynolds", householdId: "hh_reynolds", category: "appliance", planId: "estate_concierge", planName: "Estate Concierge", annualAmount: REYNOLDS_ANNUAL, status: "Active", paymentProfileId: "pay_reynolds", startedOn: isoDate(-190), renewalOn: isoDate(175), preferredMonths: "March / September", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: true, pricingBreakdown: window.WILSON_PRICING.breakdown(assets.filter(function (a) { return a.householdId === "hh_reynolds" && a.group !== "hvac"; }), "estate_concierge") },
      { id: "sub_davenport", householdId: "hh_davenport", category: "appliance", planId: "estate_preferred", planName: "Estate Preferred", annualAmount: DAVENPORT_ANNUAL, status: "Active", paymentProfileId: "pay_davenport", startedOn: isoDate(-120), renewalOn: isoDate(245), preferredMonths: "April / October", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_okafor", householdId: "hh_okafor", category: "appliance", planId: "per_appliance", planName: "Per Appliance", annualAmount: OKAFOR_ANNUAL, status: "Active", paymentProfileId: "pay_okafor", startedOn: isoDate(-14), renewalOn: isoDate(351), preferredMonths: "Any", lastChargeStatus: "Charged", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_torres", householdId: "hh_torres", category: "appliance", planId: "per_appliance", planName: "IMUC - Per Appliance", annualAmount: TORRES_ANNUAL, status: "Active", paymentProfileId: "pay_torres", startedOn: isoDate(-360), renewalOn: isoDate(5), preferredMonths: "February / August", lastChargeStatus: "Charge due", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_mercer_app", householdId: "hh_mercer", category: "appliance", planId: "estate_annual", planName: "Estate Annual", annualAmount: MERCER_APP_ANNUAL, status: "Active", paymentProfileId: "pay_mercer", startedOn: isoDate(-220), renewalOn: isoDate(145), preferredMonths: "March", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: false },
      { id: "sub_mercer_hvac", householdId: "hh_mercer", category: "hvac", planId: "hvac_filter_management", planName: "Wilson AC Maintenance + Filters", annualAmount: 800, status: "Active", paymentProfileId: "pay_mercer", startedOn: isoDate(-210), renewalOn: isoDate(155), preferredMonths: "Spring / Fall", lastChargeStatus: "Paid", autoRenew: true, chargeTiming: "At scheduled maintenance", filterManagement: true, standardFiltersIncluded: false, systemCount: 2 }
    ];

    const visits = [
      /* v0.9.48, from the audit: two-visit plans bill HALF at each visit --
         that is what chargeSchedule computes and what the customer's
         confirmation prints -- so the seeded rows read the engine's legs
         instead of hand-writing the whole year onto visit one. */
      { id: "visit_reynolds_spring", subscriptionId: "sub_reynolds", householdId: "hh_reynolds", category: "appliance", dueDate: isoDate(12), season: "Spring portfolio visit", status: "Due soon", paymentStatus: "Charged - $" + window.WILSON_PRICING.chargeSchedule(assets.filter(function (a) { return a.householdId === "hh_reynolds" && a.group !== "hvac"; }), "estate_concierge")[0].amount.toFixed(2), amountToCharge: window.WILSON_PRICING.chargeSchedule(assets.filter(function (a) { return a.householdId === "hh_reynolds" && a.group !== "hvac"; }), "estate_concierge")[0].amount, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: true, assetScope: "All appliances" },
      { id: "visit_reynolds_fall", subscriptionId: "sub_reynolds", householdId: "hh_reynolds", category: "appliance", dueDate: isoDate(194), season: "Fall portfolio visit", status: "Upcoming", paymentStatus: "Charge due at visit", amountToCharge: window.WILSON_PRICING.chargeSchedule(assets.filter(function (a) { return a.householdId === "hh_reynolds" && a.group !== "hvac"; }), "estate_concierge")[1].amount, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: true, assetScope: "All appliances" },
      { id: "visit_davenport", subscriptionId: "sub_davenport", householdId: "hh_davenport", category: "appliance", dueDate: isoDate(24), season: "Fall portfolio visit", status: "Due soon", paymentStatus: "Ready to charge", amountToCharge: window.WILSON_PRICING.chargeSchedule(assets.filter(function (a) { return a.householdId === "hh_davenport" && a.group !== "hvac"; }), "estate_preferred")[0].amount, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "All appliances" },
      /* Inside the 45-day equipment lead window, so the gap is today's work. */
      { id: "visit_okafor", subscriptionId: "sub_okafor", householdId: "hh_okafor", category: "appliance", dueDate: isoDate(21), season: "First maintenance visit", status: "Due soon", paymentStatus: "Ready to charge", amountToCharge: window.WILSON_PRICING.chargeSchedule(assets.filter(function (a) { return a.householdId === "hh_okafor" && a.group !== "hvac"; }), "per_appliance")[0].amount, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: true, assetScope: "All appliances" },
      { id: "visit_torres", subscriptionId: "sub_torres", householdId: "hh_torres", category: "appliance", dueDate: isoDate(-3), season: "Second icemaker visit", status: "Overdue", paymentStatus: "Charge due", amountToCharge: 249.95, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "Icemakers only" },
      { id: "visit_mercer_app", subscriptionId: "sub_mercer_app", householdId: "hh_mercer", category: "appliance", dueDate: isoDate(48), season: "Annual whole-home visit", status: "Upcoming", paymentStatus: "Ready to charge", amountToCharge: 1195, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "Appliances" },
      { id: "visit_mercer_imuc", subscriptionId: "sub_mercer_app", householdId: "hh_mercer", category: "appliance", dueDate: isoDate(205), season: "Second icemaker visit", status: "Upcoming", paymentStatus: "Charge due at visit", amountToCharge: 249.95, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "Icemakers only" },
      { id: "visit_mercer_hvac", subscriptionId: "sub_mercer_hvac", householdId: "hh_mercer", category: "hvac", dueDate: isoDate(9), season: "Fall HVAC maintenance", status: "Due soon", paymentStatus: "Ready to charge", amountToCharge: 800, serviceOrderStatus: "Not created", serviceOrderSystem: "NetSuite", reportRequired: false, assetScope: "2 HVAC systems" },
      { id: "visit_davenport_completed", subscriptionId: "sub_davenport", householdId: "hh_davenport", category: "appliance", dueDate: isoDate(-95), completedOn: isoDate(-93), season: "Spring portfolio visit", status: "Completed", paymentStatus: "Paid", amountToCharge: 0, serviceOrderStatus: "Matched - SV0012844", serviceOrderSystem: "EPASS", reportRequired: false, assetScope: "All appliances" }
    ];

    /* `verified` is what the office's Filter verification queue works from:
       true means someone confirmed the part number against the actual unit
       (Filter Finder or the manufacturer's own lookup); false means the
       number on file is a best guess. Two seeds stay unverified so the
       queue demonstrates itself. */
    const filters = [
      { id: "filter_1", householdId: "hh_reynolds", assetId: assets.find((a) => a.householdId === "hh_reynolds" && a.type === "refrigerator").id, subscriptionId: "sub_reynolds", filterType: "Refrigerator water filter", partNumber: "4204490", quantity: 1, intervalMonths: 12, lastChangedOn: isoDate(-350), nextDueOn: isoDate(15), status: "Due soon", source: "Wilson supplied", planCoverage: "Included", notes: "Main Kitchen", verified: true, verifiedOn: isoDate(-350) },
      { id: "filter_2", householdId: "hh_reynolds", assetId: assets.find((a) => a.householdId === "hh_reynolds" && a.type === "ice_maker").id, subscriptionId: "sub_reynolds", filterType: "Icemaker water filter", partNumber: "SCCP5", quantity: 1, intervalMonths: 6, lastChangedOn: isoDate(-190), nextDueOn: isoDate(-8), status: "Overdue", source: "Wilson supplied", planCoverage: "Included", notes: "Wet Bar", verified: false },
      { id: "filter_3", householdId: "hh_davenport", assetId: assets.find((a) => a.householdId === "hh_davenport" && a.type === "ice_maker").id, subscriptionId: "sub_davenport", filterType: "Icemaker water filter", partNumber: "SCCP5", quantity: 1, intervalMonths: 6, lastChangedOn: isoDate(-165), nextDueOn: isoDate(18), status: "Due soon", source: "Customer / billed separately", planCoverage: "Track only", notes: "Bar", verified: false },
      { id: "filter_4", householdId: "hh_mercer", assetId: assets.find((a) => a.householdId === "hh_mercer" && a.group === "hvac").id, subscriptionId: "sub_mercer_hvac", filterType: "HVAC media filter", partNumber: "20x25x4 MERV 11", quantity: 1, intervalMonths: 6, lastChangedOn: isoDate(-140), nextDueOn: isoDate(42), status: "Upcoming", source: "Wilson sourced / billed separately", planCoverage: "Managed - material billed separately", notes: "Main House air handler", verified: true, verifiedOn: isoDate(-140) }
    ];

    /*
     * Multi-year portfolio history.
     *
     * A single visit produces a score. Several visits produce a curve, and the
     * curve is the point: a condenser TD that has climbed 8°F over three years
     * is a recommendation that writes itself, where one reading is only ever an
     * opinion about a number. Nothing in the product demonstrates that until
     * some history exists, so the demo seeds it.
     *
     * WHY THE WHOLE PORTFOLIO AND NOT TWO APPLIANCES
     * ----------------------------------------------
     * Until v0.9.11 only the refrigerator and one dishwasher carried history,
     * and no seeded report carried a visitId at all. That left the whole-visit
     * maintenance review with nothing to compile -- the feature existed and had
     * no data to render. A stop is a stop: the technician works the whole house
     * and every appliance in scope gets a report on the same visit. So the seed
     * now models four completed stops, each covering all sixteen appliances.
     *
     * HOW THE NUMBERS ARE PRODUCED
     * ----------------------------
     * Each profile below states the VITAL score -- what the technician's own
     * ratings produce. Everything downstream is derived with the field tool's
     * real formulas (ratings -> vital, age -> ageScore, 75/25 -> overall), so
     * the history is a plausible record rather than a set of numbers chosen to
     * look good. Specifying the overall score directly, as an earlier version
     * did, produced vitals above 100, which no inspection can generate.
     *
     * Most of the portfolio holds steady, because most of a well-kept estate
     * does. Four appliances move, each for a different and specific reason, so
     * the drift reads as signal rather than as something every line does.
     */
    const REYNOLDS_STOPS = [
      { id: "visit_reynolds_h1", days: -1105, season: "Annual portfolio visit", tech: "Trevor", system: "EPASS", order: "SV0011902" },
      { id: "visit_reynolds_h2", days: -740,  season: "Annual portfolio visit", tech: "Trevor", system: "EPASS", order: "SV0012214" },
      { id: "visit_reynolds_h3", days: -375,  season: "Annual portfolio visit", tech: "Marcus", system: "EPASS", order: "SV0012588" },
      /* The Estate Concierge plan started 190 days ago (see sub_reynolds), so
         this is the first stop under the semiannual agreement. The next one is
         visit_reynolds_spring, already on the board. */
      { id: "visit_reynolds_h4", days: -186,  season: "Spring portfolio visit", tech: "Marcus", system: "NetSuite", order: "SO-10441" }
    ];

    /*
     * One profile per appliance, keyed by where it sits and what it is.
     *
     * `vitals` is one entry per stop. `readings` are the measured values the
     * technician recorded, one per stop, with the target the protocol prints --
     * decline detection parses those targets, so they are written the way the
     * field tool writes them rather than in prose.
     */
    const REYNOLDS_PROFILES = [
      {
        key: "Main Kitchen|BI-48S",
        idPrefix: "report_hist_fridge",
        /* The estate's main refrigerator, and the one thing on the property
           that is actually drifting: the condenser loads up, the compressor
           works harder, and the fresh-food compartment slowly loses its set
           point. Serviceable, mid-life, with real time left -- which is the
           whole reason it is a service call and not a replacement pitch. */
        vitals: [100, 96, 88, 80],
        weak: ["Condenser health — before cleaning", "Evaporator & air path — IR camera"],
        notes: {
          "Condenser health — before cleaning": "Coil vacuumed at this visit. Fan running warmer and louder than last year — the condenser is working harder than it should.",
          "Evaporator & air path — IR camera": "Filter replaced. Airflow adequate; condenser is the limiting factor."
        },
        /* These series predate v0.9.41: visits used to spot-read the
           compartments and take the condenser TD, so the HISTORY keeps both
           -- the trend engine still reads a climbing curve off them -- but
           they ride no checkpoint, because the protocol no longer takes
           either number. This unit is Guardian enrolled; its temps stream to
           the report from the sensor now. */
        readings: [
          { label: "Fresh-food compartment", unit: "°F", target: "Set point 37°F", values: [37, 37, 38, 40] },
          { label: "Fresh-food set point", unit: "°F", target: "Customer setting", values: [37, 37, 37, 37] },
          { label: "Freezer compartment", unit: "°F", target: "Near 0°F", values: [0, 0, 1, 1] },
          { label: "Condenser split (TD)", unit: "°F", target: "15-30°F above ambient", values: [18, 20, 23, 26] }
        ]
      },
      {
        key: "Main Kitchen|BI-36F", idPrefix: "report_rey_freezer",
        vitals: [96, 96, 92, 92], weak: ["Evaporator & air path — IR camera"],
        readings: [
          { label: "Freezer compartment", unit: "°F", target: "Near 0°F", values: [-1, 0, 0, 1] },
          { label: "Freezer set point", unit: "°F", target: "Customer setting", values: [0, 0, 0, 0] },
          { label: "Condenser split (TD)", unit: "°F", target: "15-30°F above ambient", values: [19, 20, 21, 22] }
        ]
      },
      {
        key: "Main Kitchen - Left|DW2450",
        idPrefix: "report_hist_dw",
        /* Flat on purpose. Without something that does not move, the drift
           above reads as noise rather than as a finding. */
        vitals: [96, 96, 96, 96], weak: [],
        readings: [
          { label: "Inlet water temperature", unit: "°F", target: "120-150°F", values: [128, 127, 129, 128] }
        ]
      },
      {
        key: "Main Kitchen - Right|DW2450", idPrefix: "report_rey_dw_right",
        vitals: [96, 92, 92, 88], weak: ["Filter & sump condition"],
        notes: { "Filter & sump condition": "Sump cleaned at each visit; the right machine takes the heavier load of the pair." },
        readings: [
          { label: "Inlet water temperature", unit: "°F", target: "120-150°F", values: [126, 125, 124, 123] }
        ]
      },
      {
        key: "Main Kitchen|GR486G", idPrefix: "report_rey_range",
        vitals: [96, 96, 92, 92], weak: ["Oven seals & hinges"],
        notes: { "Oven seals & hinges": "Oven door gasket showing normal compression set for its age. Not affecting temperature yet." },
        readings: [
          { label: "Oven temp test — 350°F bake, 30-minute average", unit: "°F", target: "335-365°F", values: [352, 348, 346, 344] }
        ]
      },
      {
        key: "Main Kitchen|PI543418", idPrefix: "report_rey_hood",
        vitals: [96, 96, 92, 92], weak: ["Filters / baffles"],
        notes: { "Filters / baffles": "Baffles degreased at this visit. Customer runs the range hard; interval is appropriate." },
        readings: [
          { label: "Blower current draw", unit: "A", target: "2.0-3.2A", values: [2.4, 2.5, 2.5, 2.6] },
          { label: "Capture at rear burner", unit: "", target: "Normal", values: ["Normal", "Normal", "Normal", "Normal"] }
        ]
      },
      {
        key: "Catering Kitchen|SO3050CM", idPrefix: "report_rey_walloven",
        vitals: [100, 96, 96, 96], weak: [],
        readings: [
          { label: "Oven temp test — 350°F bake, 30-minute average", unit: "°F", target: "335-365°F", values: [349, 351, 347, 352] }
        ]
      },
      {
        key: "Catering Kitchen|CL3650R", idPrefix: "report_rey_fridge2",
        vitals: [96, 96, 96, 92], weak: [],
        readings: [
          { label: "Fresh-food compartment", unit: "°F", target: "Set point 37°F", values: [36, 36, 37, 37] },
          { label: "Fresh-food set point", unit: "°F", target: "Customer setting", values: [37, 37, 37, 37] },
          { label: "Condenser split (TD)", unit: "°F", target: "15-30°F above ambient", values: [17, 18, 18, 19] }
        ]
      },
      {
        key: "Wet Bar|DCE33",
        /* The icemaker's most recent report keeps its original id: it is the
           one the report-view smoke test opens. */
        idPrefix: "report_rey_imuc", lastStopId: "report_reynolds_1",
        vitals: [92, 88, 88, 84], weak: ["Drain performance — standardized pour", "Cleaning / descale cycle"],
        notes: {
          "Drain performance — standardized pour": "Drain pump operating with a slight noise; compare again next visit. Filter replacement due.",
          "Cleaning / descale cycle": "Descaled during service. Water hardness keeps reloading the evaporator between visits; the interval is right for this house."
        },
        readings: [
          { label: "Freeze cycle time", unit: "min", target: "Model guidance", values: [22, 23, 23, 24] },
          { label: "Harvest cycle", unit: "", target: "Complete harvest", values: ["Normal", "Normal", "Normal", "Normal"] },
          { label: "Bin control", unit: "", target: "Pass", values: ["Pass", "Pass", "Pass", "Pass"] }
        ]
      },
      {
        key: "Wine Room|UW-24", idPrefix: "report_rey_wine",
        vitals: [100, 100, 96, 96], weak: [],
        readings: [
          { label: "Wine compartment", unit: "°F", target: "Set point 55°F", values: [55, 55, 56, 55] },
          { label: "Wine compartment set point", unit: "°F", target: "Customer setting", values: [55, 55, 55, 55] },
          { label: "Condenser split (TD)", unit: "°F", target: "15-30°F above ambient", values: [20, 20, 21, 21] }
        ]
      },
      {
        key: "Primary Laundry|WXF660", idPrefix: "report_rey_washer",
        vitals: [96, 96, 96, 92], weak: ["Dispenser & door boot cleanliness"],
        notes: { "Dispenser & door boot cleanliness": "Door gasket cleaned; light residue at the lower fold. Customer advised on the leave-door-ajar habit." },
        readings: [
          { label: "Hot fill temperature", unit: "°F", target: "110-140°F", values: [122, 121, 120, 119] }
        ]
      },
      {
        key: "Primary Laundry|TXI680", idPrefix: "report_rey_dryer",
        /* Heat-pump dryer: no vent, so there is no exhaust temperature to take.
           The condenser and lint stack are what matter on this machine. */
        vitals: [96, 96, 92, 92], weak: ["Lint in unit and duct run"],
        notes: { "Lint in unit and duct run": "Heat-pump condenser rinsed and the secondary lint filter cleaned. No vent on this machine." },
        readings: [
          { label: "Cycle moisture-sensor result", unit: "", target: "Normal", values: ["Normal", "Normal", "Normal", "Normal"] },
          { label: "Condenser coil", unit: "", target: "Clear", values: ["Clear", "Clear", "Clear", "Clear"] }
        ]
      },
      {
        key: "Guest Laundry|FF7009", idPrefix: "report_rey_gwasher",
        vitals: [96, 96, 96, 96], weak: [],
        readings: [
          { label: "Hot fill temperature", unit: "°F", target: "110-140°F", values: [126, 127, 126, 127] }
        ]
      },
      {
        key: "Guest Laundry|DF7004", idPrefix: "report_rey_gdryer",
        /* The catch worth having. Exhaust temperature and vent static pressure
           climb together across four visits -- a restricting duct run, which is
           a fire risk long before it is a dryer complaint. This is the case for
           taking a measurement instead of writing "operates normally". */
        vitals: [96, 92, 84, 72],
        weak: ["Cycling temp at exhaust — high heat", "Vent static — manometer readout"],
        notes: {
          "Cycling temp at exhaust — high heat": "Exhaust temperature above the normal band and still climbing. Duct run needs inspection past the accessible section.",
          "Vent static — manometer readout": "Static pressure has doubled since the first visit. Accessible section is clear, so the restriction is downstream."
        },
        readings: [
          { label: "Exhaust temperature", unit: "°F", target: "120-160°F", checkpoint: "Cycling temp at exhaust — high heat", values: [138, 148, 158, 168] },
          { label: "Vent static pressure", unit: " in wc", target: "0.0-0.6 in wc", checkpoint: "Vent static — manometer readout", values: [0.3, 0.5, 0.7, 0.9] }
        ]
      },
      {
        key: "Outdoor Kitchen|GMBR36", idPrefix: "report_rey_grill",
        /* Grills are enrolled for FUNCTION only. Wilson does not clean grills,
           at maintenance or on any other call. Condition is documented because
           it genuinely affects how long the firebox lasts -- and the notes say
           plainly that documenting is all we do. */
        vitals: [92, 88, 84, 76],
        weak: ["Grease condition", "Lights, controls, rotisserie (if fitted)"],
        notes: {
          "Grease condition": "Documented only — Wilson does not perform grill cleaning. Grease and carbon build-up in the firebox is advancing and will shorten burner and firebox life if left.",
          "Lights, controls, rotisserie (if fitted)": "Cart hardware and rotisserie motor operate. Surface corrosion noted at the hinge, consistent with a coastal-facing outdoor install."
        },
        readings: [
          { label: "Measured grill temperature", unit: "°F", target: "Compare with the lid gauge", values: [545, 540, 530, 520] },
          { label: "Lid gauge reading", unit: "°F", target: "Note any disagreement with the measured value", values: [550, 545, 545, 545] }
        ]
      },
      {
        key: "Outdoor Kitchen|TUR-24", idPrefix: "report_rey_outfridge",
        /* This profile used to override expected life by hand, with a comment
           saying the category table had no figure for an outdoor undercounter
           living in Texas summers. It does now -- Wilson's outdoor refrigeration
           rows, which stand alone rather than being averaged against the indoor
           NAHB anchor -- so the override is gone and the config answers. */
        vitals: [92, 88, 80, 68],
        weak: ["Condenser health — before cleaning", "Evaporator & air path — IR camera"],
        notes: {
          "Condenser health — before cleaning": "Coil vacuumed. Heavy debris load returns between visits — the outdoor install pulls debris continuously and the enclosure has no rear clearance. Running 6°F above its set point; not holding safe temperature for food storage in current condition.",
          "Evaporator & air path — IR camera": "Fans operate. The enclosure, not the appliance, is limiting heat rejection."
        },
        readings: [
          { label: "Fresh-food compartment", unit: "°F", target: "Set point 38°F", values: [40, 41, 43, 44] },
          { label: "Fresh-food set point", unit: "°F", target: "Customer setting", values: [38, 38, 38, 38] }
        ]
      }
    ];

    /*
     * The Davenport stop.
     *
     * A visit that is finished in the field but not yet sent to the customer --
     * which is the state the operations queue exists to clear. It attaches to
     * the completed visit already on the board rather than creating a second
     * one, so its service order and history stay intact.
     *
     * One stop, so there is no curve here: this household exercises the review
     * with a first visit, where every finding has to stand on the reading taken
     * that day and nothing can lean on a trend. That is the harder case, and
     * the one most real customers are in.
     */
    const DAVENPORT_STOPS = [
      { attachTo: "visit_davenport_completed", days: -93, tech: "Trevor", deliveryStatus: "Ready to email" }
    ];

    const DAVENPORT_PROFILES = [
      {
        key: "Kitchen|T36BT925NS", idPrefix: "report_dav_fridge",
        vitals: [92], weak: ["Evaporator & air path — IR camera"],
        notes: { "Evaporator & air path — IR camera": "Water filter replaced at this visit. Airflow normal." },
        readings: [
          { label: "Fresh-food compartment", unit: "°F", target: "Set point 37°F", values: [38] },
          { label: "Fresh-food set point", unit: "°F", target: "Customer setting", values: [37] },
          { label: "Condenser split (TD)", unit: "°F", target: "15-30°F above ambient", values: [22] }
        ]
      },
      {
        key: "Kitchen|T24IF905SP", idPrefix: "report_dav_freezer",
        vitals: [96], weak: [],
        readings: [
          { label: "Freezer compartment", unit: "°F", target: "Near 0°F", values: [1] },
          { label: "Freezer set point", unit: "°F", target: "Customer setting", values: [0] },
          { label: "Condenser split (TD)", unit: "°F", target: "15-30°F above ambient", values: [21] }
        ]
      },
      {
        key: "Kitchen|DWHD770WPR", idPrefix: "report_dav_dishwasher",
        /* The finding on this visit, and it is a first-visit finding: inlet
           temperature is below the range the detergent needs, with no history
           to lean on. A reading, not a trend, is what catches it. */
        vitals: [76], weak: ["Controls, codes & test cycle", "Filter & sump condition"],
        notes: {
          "Controls, codes & test cycle": "Inlet water reaching the machine at 112°F, below the 120°F the cycle needs. Recirculation and drain are normal — the supply is the limit, not the dishwasher.",
          "Filter & sump condition": "Sump cleaned. Film on the filter is consistent with the low inlet temperature."
        },
        readings: [
          { label: "Inlet water temperature", unit: "°F", target: "120-150°F", checkpoint: "Controls, codes & test cycle", values: [112] }
        ]
      },
      {
        key: "Kitchen|PRD486WDHU", idPrefix: "report_dav_range",
        vitals: [92], weak: ["Oven seals & hinges"],
        notes: { "Oven seals & hinges": "Left oven door gasket has a small set at the lower corner. Not affecting temperature; note it for the next visit." },
        readings: [
          { label: "Oven temp test — 350°F bake, 30-minute average", unit: "°F", target: "335-365°F", values: [347] }
        ]
      },
      {
        key: "Kitchen|VCIN48GWS", idPrefix: "report_dav_hood",
        vitals: [96], weak: [],
        readings: [
          { label: "Blower current draw", unit: "A", target: "2.0-3.2A", values: [2.3] },
          { label: "Capture at rear burner", unit: "", target: "Normal", values: ["Normal"] }
        ]
      },
      {
        key: "Kitchen|MC30WP", idPrefix: "report_dav_speedoven",
        vitals: [88], weak: ["Leakage test"],
        notes: { "Leakage test": "Cavity clean, no arcing marks. Waveguide cover shows normal wear for its age." },
        readings: [
          { label: "Delta-T water test — 500 ml, standard time", unit: "°F", target: "Normal", values: ["Normal"] }
        ]
      },
      {
        key: "Bar|T24IW905SP", idPrefix: "report_dav_wine",
        vitals: [96], weak: [],
        readings: [
          { label: "Wine compartment", unit: "°F", target: "Set point 55°F", values: [55] },
          { label: "Wine compartment set point", unit: "°F", target: "Customer setting", values: [55] }
        ]
      },
      {
        key: "Bar|CU50", idPrefix: "report_dav_imuc",
        vitals: [88], weak: ["Drain performance — standardized pour"],
        notes: { "Drain performance — standardized pour": "Filter is customer-supplied on this household and is past its interval. Replacement recommended; not covered by the current plan." },
        readings: [
          { label: "Freeze cycle time", unit: "min", target: "Model guidance", values: [21] },
          { label: "Harvest cycle", unit: "", target: "Complete harvest", values: ["Normal"] }
        ]
      },
      {
        key: "Laundry|WM6700", idPrefix: "report_dav_washer",
        vitals: [92], weak: ["Dispenser & door boot cleanliness"],
        notes: { "Dispenser & door boot cleanliness": "Door gasket cleaned; light residue at the lower fold, which is normal for a front-loader used daily." },
        readings: [
          { label: "Hot fill temperature", unit: "°F", target: "110-140°F", values: [118] }
        ]
      },
      {
        key: "Laundry|DLEX6700", idPrefix: "report_dav_dryer",
        vitals: [92], weak: ["Lint in unit and duct run"],
        notes: { "Lint in unit and duct run": "Lint stack and accessible duct cleared. Exhaust temperature and static pressure both normal after cleaning." },
        readings: [
          { label: "Exhaust temperature", unit: "°F", target: "120-160°F", values: [141] },
          { label: "Vent static pressure", unit: " in wc", target: "0.0-0.6 in wc", values: [0.3] }
        ]
      }
    ];

    /*
     * Distribute checkpoint ratings so their mean reproduces the profile's
     * stated vital score, taking the deduction out of the checks the profile
     * named as weak before touching anything else. The vital is then RECOMPUTED
     * from the ratings that came out, so what the report displays is what its
     * own checkpoints add up to -- never a number sitting beside them.
     */
    /*
     * v0.9.39: ratings come in exactly three values -- 5, 3, 1 -- because that
     * is the field team's scale (pass / cause for concern / fail) and a seeded
     * report carrying a 4 would be a rating no technician can now produce. The
     * drain still spreads worst-first, it just moves in whole verdict steps:
     * a weak check drops 5 -> 3 -> 1, an ordinary check at most 5 -> 3.
     */
    function ratingsForVital(names, vital, weak) {
      const ratings = names.map(function () { return 5; });
      let deficit = Math.round(names.length * 5 - (vital / 20) * names.length);
      /* Deficit is spent in 2-point steps (5->3->1). Round it to the nearest
         even so the loop can always land exactly. */
      deficit = Math.round(deficit / 2) * 2;
      const floors = names.map(function (name) { return weak.indexOf(name) >= 0 ? 1 : 3; });
      /*
       * Weak checks drain in the order the profile LISTS them, not in protocol
       * order. The profile lists them worst-first on purpose, and sorting on the
       * floor alone left the deduction on whichever weak check the protocol
       * happened to print first -- which put "descaled during service" in front
       * of the customer as the finding instead of the noisy drain pump.
       */
      const rank = names.map(function (name) {
        const i = weak.indexOf(name);
        return i >= 0 ? i : weak.length + 1;
      });
      const order = names.map(function (name, i) { return i; })
        .sort(function (a, b) { return rank[a] - rank[b]; });
      for (let pass = 0; pass < 4 && deficit > 0; pass += 1) {
        const floor = pass === 0 ? null : 1;
        for (let k = 0; k < order.length && deficit > 0; k += 1) {
          const i = order[k];
          const limit = floor === null ? floors[i] : floor;
          while (ratings[i] - 2 >= limit && deficit > 0) { ratings[i] -= 2; deficit -= 2; }
        }
      }
      return ratings;
    }

    function parseTargetBand(text) {
      const match = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
      if (!match) return null;
      const min = parseFloat(match[1]), max = parseFloat(match[2]);
      return max > min ? { min: min, max: max } : null;
    }

    function readingResult(reading, value) {
      if (/set ?point/i.test(reading.label)) return "Recorded";
      if (typeof value !== "number") return "Recorded";
      const band = parseTargetBand(reading.target);
      if (!band) return "Recorded";
      if (value > band.max) return "Above range";
      if (value < band.min) return "Below range";
      return value >= band.max - (band.max - band.min) * 0.15 ? "High side of range" : "In range";
    }

    /*
     * `plan` is { householdId, subscriptionId, stops, profiles }. Nothing in the
     * body is specific to one household -- a second estate seeds by handing in
     * its own stops and profiles, and an existing completed visit is reused by
     * giving a stop a `useExistingVisit` id instead of letting it create one.
     */
    function portfolioHistory(allAssets, plan) {
      const checkpointSets = window.WILSON_CONFIG.checkpointSets;
      const gradeBands = (window.WILSON_CONFIG.reportScoring || {}).gradeBands || [];
      const reports = [];
      const stopVisits = [];

      function gradeFor(score) {
        const band = gradeBands.find(function (b) { return score >= b.min; }) || gradeBands[gradeBands.length - 1];
        return band || { grade: "–", label: "Not graded" };
      }

      plan.stops.forEach(function (stop, stopIndex) {
        const visitKey = stop.attachTo || stop.id;
        let stopReports = 0;

        plan.profiles.forEach(function (profile) {
          const parts = profile.key.split("|");
          const asset = (allAssets || []).find(function (a) {
            return a.householdId === plan.householdId && a.location === parts[0] && a.model === parts[1];
          });
          if (!asset) return;

          const setKey = window.WILSON_PROTOCOL.resolveCheckpointSet(asset);
          const names = (checkpointSets[setKey] || checkpointSets.generic).map(function (c) { return c.name; });
          const weak = profile.weak || [];
          const ratings = ratingsForVital(names, profile.vitals[stopIndex], weak);

          /* Vital, age score and overall come out of the same three formulas
             the field tool uses. Nothing here is asserted. */
          const vital = Math.round((ratings.reduce(function (a, b) { return a + b; }, 0) / ratings.length) * 20);

          /*
           * Age comes from the appliance's install year -- the one the invoice
           * gave us -- not from a number typed into the profile. The profiles
           * used to carry their own `ageAtFirstStop`, which meant two places
           * could disagree about how old the same machine was.
           *
           * An appliance with no install year on record has NO age score. Not
           * zero, not an average, not a guess -- the age term drops out and the
           * overall is the measured condition alone, which the report then says
           * out loud. Inventing a lifecycle for an undated appliance is exactly
           * what this is here to stop.
           */
          /*
           * TIER AND EXPECTED LIFE COME FROM THE CONFIG, NOT FROM THE PROFILE.
           *
           * Every profile used to carry its own `tier` and `expectedYears`, and
           * those were a second expected-life table. When the brand-and-line
           * figures landed in v0.9.30 this one did not move: 23 of the 25
           * seeded appliances disagreed with what the field tool would compute
           * for the same machine on the same day, by as much as eight years --
           * the Thermador speed oven was 8 here and 14 there, the True outdoor
           * refrigerator 12 here and 20 there. The demo history was scoring
           * against numbers the product does not use.
           *
           * Same resolvers as the field tool, same identity, one answer.
           */
          const lifeIdent = {
            brand: asset.brand || "", model: asset.model || "",
            description: asset.typeLabel || asset.description || "",
            line: window.WILSON_BRANDS
              ? (window.WILSON_BRANDS.lineForAsset(asset) || window.WILSON_BRANDS.lineForSet(setKey))
              : "",
            group: asset.group || "", checkpointSet: setKey,
            /* v0.9.37: where the appliance lives. Resolved from the flag, the
               type, or the area the customer named -- never asked of the
               customer directly. */
            environment: window.WILSON_ENVIRONMENT ? window.WILSON_ENVIRONMENT.for(asset).id : "indoor"
          };
          const tier = window.WILSON_BRANDS
            ? window.WILSON_BRANDS.tierFor(asset.brand || "", lifeIdent.line)
            : "premium";
          const life = window.WILSON_WATER.expectedLife(setKey, tier, null, lifeIdent);
          const expectedYears = life.adjusted;

          const ageInfo = window.WILSON_AGE.resolve(asset, null, null, new Date(isoDate(stop.days)).getUTCFullYear());
          const age = ageInfo.age;
          const dated = age !== null;
          const lifeRatio = dated ? age / expectedYears : null;
          const ageScore = dated ? Math.round(100 - 60 * Math.min(lifeRatio, 1.4)) : null;
          /* The same weights the field tool scores with — reportScoring is
             the knob (0.75/0.25 today), and seeded history must move with it
             or a weight change would make the demo's past disagree with its
             present. */
          const vw = Number(window.WILSON_CONFIG.reportScoring.vitalWeight ?? 0.75);
          const aw = Number(window.WILSON_CONFIG.reportScoring.ageWeight ?? 0.25);
          const score = dated ? Math.round(vital * vw + ageScore * aw) : vital;
          const band = gradeFor(score);

          const checkpointsDraft = names.map(function (name, i) {
            const rating = ratings[i];
            /* The real subsystem off the protocol definition, exactly as the
               field path stamps it. "Health vital" here was the last of the
               v0.9.37 leftovers, and it collapsed the seeded reports' subsystem
               review into one unsplittable block -- which is how the
               Inspection Details sheet ended up 26px past the page. */
            const definition = (checkpointSets[setKey] || []).find(function (t) { return t.name === name; }) || {};
            const subsystem = (definition.subsystem) || "condition";
            const subsystemLabel = ((window.WILSON_CONFIG.subsystems || {})[subsystem] || {}).label || "Condition";
            return {
              subsystem: subsystem,
              category: subsystemLabel,
              name: name,
              rating: rating,
              status: rating >= 4 ? "Pass" : rating === 3 ? "Cause for concern" : "Fail",
              notes: (profile.notes || {})[name] ||
                (rating >= 4 ? "Checked; normal for this appliance." : rating === 3 ? "Acceptable, monitor at the next visit." : "Needs follow-up.")
            };
          });

          /* A reading belongs to the checkpoint it was taken on, so the note
             travels with it. Guessing the association from shared words got the
             wrong note onto the wrong number more than once. */
          const noteByCheck = {};
          checkpointsDraft.forEach(function (c) { noteByCheck[c.name] = c.notes; });
          const measurements = (profile.readings || []).map(function (reading) {
            const value = reading.values[stopIndex];
            return {
              label: reading.label,
              observed: String(value),
              unit: reading.unit || "",
              target: reading.target,
              result: readingResult(reading, value),
              checkpoint: reading.checkpoint || "",
              notes: reading.checkpoint ? (noteByCheck[reading.checkpoint] || "") : ""
            };
          });

          const checkpoints = checkpointsDraft;
          const flagged = checkpoints.filter(function (c) { return c.rating <= 3; });
          const outOfRange = measurements.filter(function (m) { return m.result === "Above range" || m.result === "Below range"; });

          const filterManaged = (asset.filterTypes || []).length > 0;
          const inspectionDate = isoDate(stop.days);

          reports.push({
            id: profile.lastStopId && stopIndex === plan.stops.length - 1
              ? profile.lastStopId
              : (profile.idPrefix || "report_" + asset.id) + "_" + stopIndex,
            householdId: plan.householdId,
            assetId: asset.id,
            visitId: visitKey,
            reference: visitKey,
            reportType: "Appliance Health Report",
            applianceLabel: [asset.brand, asset.model, asset.typeLabel].filter(Boolean).join(" "),
            technician: stop.tech,
            inspectionDate: inspectionDate,
            source: "Field technician",
            score: score,
            grade: band.grade,
            condition: band.label,
            summary: outOfRange.length
              ? "Maintenance completed. " + outOfRange[0].label + " measured " + outOfRange[0].observed + outOfRange[0].unit +
                ", outside the target of " + outOfRange[0].target + ". The reading and the history behind it are below."
              : flagged.length
                ? "Maintenance completed. The appliance is operating, with " + flagged.length + " item" + (flagged.length === 1 ? "" : "s") + " to monitor at the next interval."
                : "Maintenance completed. Every health check measured in the normal band for this appliance at this visit.",
            recommendations: flagged.length
              ? flagged.map(function (c) { return c.name + " — " + c.notes; }).join(" ")
              : "Continue the scheduled interval.",
            correctiveMeasures: flagged.map(function (c) { return c.name + ": " + c.notes; }),
            /*
             * The seeded history's own version. Built from the checkpoints this
             * demo report actually carries, so it says something true about
             * THIS report rather than the one hardcoded sentence that used to
             * appear on every report in the product.
             */
            serviceSummary: checkpoints.length
              ? "All " + checkpoints.length + " health checks on this protocol were completed." +
                (flagged.length ? " " + flagged.length + " item" + (flagged.length === 1 ? "" : "s") +
                  " were flagged for the next interval." : "")
              : "",
            nextDueOn: isoDate(stop.days + (asset.group === "imuc" ? 182 : 365)),
            lifecycle: {
              age: age, tier: tier, expectedYears: expectedYears,
              /* Where that figure came from, carried the same way the field
                 report carries it. */
              lifeBasis: life.basis,
              /* Read from config rather than restated here. This line used to
                 band at 0.35/0.75 with a label ("Late Life") that exists
                 nowhere else in the product, so a seeded report printed a
                 lifecycle stage the tool does not define, and an appliance at
                 0.38 of life was "Mid Life" here and "Early life" in the field
                 tool. */
              stage: !dated ? "" : ((window.WILSON_CONFIG.lifecycleStages || []).find(function (b) { return lifeRatio < Number(b.maxRatio); })
                                    || { label: "Late life" }).label,
              lifeRatio: lifeRatio, ageScore: ageScore, vitalScore: vital,
              /* Carried onto the report so a customer reading a score months
                 later can still see whether its age came from a document. */
              ageSource: ageInfo.source.id,
              ageSourceLabel: ageInfo.source.label,
              ageDocumented: ageInfo.documented,
              installYear: ageInfo.installYear,
              ageSourceRef: asset.ageSourceRef || ""
            },
            measurements: measurements,
            checkpoints: checkpoints,
            categoryLosses: checkpoints.filter(function (c) { return c.rating < 5; }).map(function (c) {
              return { category: c.name, loss: Math.round((5 - c.rating) * 20 / names.length), explanation: c.notes };
            }),
            tasks: names,
            /*
             * No photographs, and no invented count of them.
             *
             * The seed used to state a plausible photo count for images that
             * had never existed -- inventing evidence in the one place the
             * product is meant to prove it has some. Seeded history is scores
             * and readings; photographs only come from a real field capture, so
             * these reports say they have none.
             */
            photos: [],
            filterPart: filterManaged ? (asset.filterSize || "Verified against the filter record") : "",
            filterAction: filterManaged ? "Filter service included" : "",
            createdAt: isoTime(stop.days * 1440)
          });
          stopReports += 1;
        });

        /* A stop can attach to a visit that is already on the board -- that is
           how the Davenport stop keeps its existing id, service order and place
           in the operations queue instead of quietly gaining a duplicate. */
        const existing = stop.attachTo
          ? visits.find(function (v) { return v.id === stop.attachTo; })
          : null;
        if (existing) {
          existing.fieldProgress = { completed: stopReports, total: stopReports };
          existing.reportCount = stopReports;
          existing.reportRequired = true;
          existing.reportDeliveryStatus = stop.deliveryStatus || existing.reportDeliveryStatus || "Ready to email";
          existing.reportReadyAt = isoTime(stop.days * 1440);
          return;
        }

        stopVisits.push({
          id: stop.id,
          subscriptionId: plan.subscriptionId,
          householdId: plan.householdId,
          category: "appliance",
          dueDate: isoDate(stop.days - 2),
          completedOn: isoDate(stop.days),
          season: stop.season,
          status: "Completed",
          paymentStatus: "Paid",
          amountToCharge: 0,
          serviceOrderStatus: "Matched - " + stop.order,
          serviceOrderSystem: stop.system,
          reportRequired: true,
          assetScope: "All appliances",
          fieldProgress: { completed: stopReports, total: stopReports },
          reportCount: stopReports,
          reportDeliveryStatus: stop.deliveryStatus || "Sent to customer",
          reportReadyAt: isoTime(stop.days * 1440)
        });
      });

      return { visits: stopVisits, reports: reports };
    }

    /*
     * Every seeded appliance report now comes from a maintenance visit, the way
     * a real one does. The generator produces the four completed stops and the
     * sixteen reports each of them carried, so the whole-visit review has
     * something to compile and each appliance has a curve to plot.
     */
    const reynolds = portfolioHistory(assets, {
      householdId: "hh_reynolds", subscriptionId: "sub_reynolds",
      stops: REYNOLDS_STOPS, profiles: REYNOLDS_PROFILES
    });
    const davenport = portfolioHistory(assets, {
      householdId: "hh_davenport", subscriptionId: "sub_davenport",
      stops: DAVENPORT_STOPS, profiles: DAVENPORT_PROFILES
    });
    const reports = reynolds.reports.concat(davenport.reports);
    visits.push(...reynolds.visits, ...davenport.visits);

    /*
     * The demo quote's enrollment payload, priced by the real engine.
     *
     * The figures that used to sit in this seed were hand-typed -- a base, an
     * adjustment, a total -- and the appliance list was types with quantities
     * rather than individual units. Both were artifacts of the retired quote
     * builder, and both could drift from the config without anything noticing.
     */
    const demoQuoteAreas = [
      { id: "area_main", name: "Main House", locked: true },
      { id: "area_bar", name: "Wet Bar", locked: false },
      { id: "area_catering", name: "Catering Kitchen", locked: false }
    ];
    const demoQuoteAssets = [];
    [
      ["refrigeration", "refrigerator", "Refrigerator", "Sub-Zero", "BI-48S", "area_main", 2, { filterServiceOptIn: true, waterFilterQuantity: 1 }],
      ["ice_maker", "ice_maker", "Icemaker (IMUC)", "Scotsman", "DCE33", "area_bar", 2, { filterServiceOptIn: true, waterFilterQuantity: 1, imucVisitsPerYear: 2 }],
      ["dishwasher", "dishwasher", "Dishwasher", "Cove", "DW2450", "area_catering", 3, {}],
      ["range", "range", "Range", "Wolf", "GR486G", "area_main", 1, {}],
      ["ovens", "wall_oven", "Wall oven", "Wolf", "SO3050CM", "area_catering", 3, {}],
      ["washer", "washer", "Washer", "Miele", "WXF660", "area_main", 2, {}],
      ["dryer", "dryer", "Dryer", "Miele", "TXI680", "area_main", 2, {}],
      ["microwave", "microwave", "Microwave", "Wolf", "MDD24", "area_main", 2, {}],
      ["ventilation", "vent_hood", "Vent hood", "Wolf", "PW482418", "area_main", 3, {}]
    ].forEach(function (row) {
      for (let i = 0; i < row[6]; i += 1) {
        const area = demoQuoteAreas.find(function (a) { return a.id === row[5]; });
        demoQuoteAssets.push(Object.assign({
          id: "quote_asset_" + demoQuoteAssets.length,
          customerCategory: row[0], type: row[1], typeLabel: row[2],
          brand: row[3], model: row[4],
          areaId: area.id, location: area.name,
          group: row[1] === "ice_maker" ? "imuc" : "standard",
          imucVisitsPerYear: 1
        }, row[7]));
      }
    });
    const demoQuotePlan = "estate_concierge";
    const demoQuoteEnrollment = {
      category: "appliance",
      planId: demoQuotePlan,
      planName: window.WILSON_PRICING.plan(demoQuotePlan).name,
      annualAmount: window.WILSON_PRICING.annual(demoQuoteAssets, demoQuotePlan),
      assets: demoQuoteAssets,
      areas: demoQuoteAreas,
      paymentReady: false,
      autoRenew: true,
      filterManagement: true,
      standardFiltersIncluded: demoQuotePlan === "estate_concierge",
      /* Null, because nobody has accepted it. That is what makes it a quote. */
      acceptedTermsAt: null,
      pricingBreakdown: Object.assign(
        window.WILSON_PRICING.breakdown(demoQuoteAssets, demoQuotePlan),
        { areaCount: demoQuoteAreas.length }
      ),
      firstName: "Jordan", lastName: "Lee",
      householdLabel: "Hamilton Family Estate",
      preferredContact: "Email",
      phone: "512-555-0188", email: "jordan@example.com",
      address1: "2901 Lake Ridge Drive", address2: "",
      city: "Austin", state: "TX", zip: "78734",
      preferredMonths: "Office to confirm",
      notes: "Final model and filter inventory to be confirmed during onboarding."
    };

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
        planId: demoQuoteEnrollment.planId,
        planName: demoQuoteEnrollment.planName,
        annualAmount: demoQuoteEnrollment.annualAmount,
        applianceCount: demoQuoteEnrollment.assets.length,
        householdId: null,
        /* The payload the quote would convert into. Priced by WILSON_PRICING at
           seed time rather than typed out, so the demo cannot drift from the
           rules the way the figures that used to sit here did. */
        enrollment: demoQuoteEnrollment,
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
      activity: state.activity.filter((item) => item.householdId === householdId),
      /* Appliances Wilson sold this household that are NOT on a plan. Cayden:
         "park the extras". They are kept because an appliance you sold them and
         do not cover is the most natural conversation there is -- and because
         losing it silently is the one outcome nobody asked for. */
      parked: (state.parkedEquipment || []).filter((item) => item.householdId === householdId)
    };
  }

  function createVisit(state, subscription, householdId, category, definition) {
    /*
     * "READY TO CHARGE" HAS TO MEAN IT.  (v0.9.24)
     *
     * This said "Ready to charge" on every chargeable visit the moment it was
     * created, which was harmless only for as long as every enrollment came
     * through the signup form -- that form will not submit without a connected
     * payment method, so the card was always there.
     *
     * An accepted quote is not like that. Wilson's Stripe flow is: create the
     * customer, send them a link, they add a payment method, and only then can
     * the card be charged. So a converted quote sits with no card on file by
     * design -- and the office would have opened the household, read "Ready to
     * charge" against $3,745, pressed it, and been told no ready payment method
     * is on file. mockCharge was right and the label was wrong.
     *
     * The label now reports the payment profile rather than assuming it. AR
     * accounts are chargeable without a card, mirroring the rule mockCharge
     * actually applies, so the two cannot disagree.
     */
    const household = (state.households || []).find(function (h) { return h.id === householdId; });
    const payment = (state.paymentProfiles || []).find(function (p) {
      return p.id === subscription.paymentProfileId;
    });
    const chargeable = (household && household.billingType === "AR Account")
      || Boolean(payment && payment.status === "Ready");
    const visit = {
      id: id("visit"),
      subscriptionId: subscription.id,
      householdId,
      category,
      dueDate: definition.dueDate,
      season: definition.season,
      status: definition.status || "Upcoming",
      paymentStatus: definition.paymentStatus || (definition.amountToCharge > 0
        ? (chargeable ? "Ready to charge" : "Awaiting payment method")
        : "Included - no additional charge"),
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
      /*
       * WHEN THE HOUSE CAN BE VISITED, on the HOUSEHOLD rather than the plan.
       *
       * One house has one gate, one dog and one travel calendar, however many
       * subscriptions it carries -- putting this on the subscription would make
       * a household with an appliance plan and an HVAC plan capable of
       * disagreeing with itself about whether anyone is home.
       */
      schedulingPreference: payload.schedulingPreference || null,
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
      /*
       * BUILT FROM THE SAME SCHEDULE THE CUSTOMER WAS SHOWN.  (v0.9.25)
       *
       * This block used to work the split out for itself -- annual minus the
       * second icemaker visits, or the whole year on visit one -- which meant
       * the signup screen had no way to preview it without writing the rule a
       * second time. That is precisely how the retired quote screen came to
       * under-quote by $350. WILSON_PRICING.chargeSchedule is now the only
       * copy, and these visits are made from it.
       */
      const secondImucAssets = newAssets.filter((asset) => asset.group === "imuc" && Number(asset.imucVisitsPerYear) >= 2);
      const schedule = window.WILSON_PRICING.chargeSchedule(newAssets, payload.planId);
      const SEASONS = {
        initial: "Initial appliance maintenance",
        second: "Second whole-home visit",
        /* Plain words: this season name is printed on the customer's
           confirmation page, and "IMUC" is an internal abbreviation. */
        imuc_second: "Second icemaker visit"
      };
      schedule.forEach(function (leg, index) {
        createVisit(state, subscription, householdId, "appliance", {
          dueDate: isoDate(leg.dayOffset),
          season: SEASONS[leg.key] || leg.label,
          status: index === 0 ? "Enrollment review" : undefined,
          amountToCharge: leg.amount,
          reportRequired: payload.planId === "estate_concierge",
          assetScope: leg.key === "imuc_second"
            ? secondImucAssets.length + " icemaker" + (secondImucAssets.length === 1 ? "" : "s")
            : "All enrolled appliances"
        });
      });
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

  /*
   * `markVisitCompleted` IS GONE.                                (v0.9.37)
   *
   * There were two ways to complete a visit. Real completion happens inside
   * `refreshVisitReportStatusInState`, as a consequence of the last appliance
   * report landing -- which is the correct rule, because a visit is finished
   * when the work is finished, not when somebody presses a button. This
   * function was the other way: it set `status` and `completedOn` and nothing
   * else, skipping the report-status refresh, the delivery banner and the
   * next-interval logic that the real path runs.
   *
   * It was exported on the store API and called by nothing, which is the only
   * reason the two never diverged. That is exactly the shape of the bugs this
   * project keeps producing -- two pricing engines $350 apart, two water
   * resolvers disagreeing, two badge rules mislabelling paid charges -- caught
   * this time while half of it was still dead.
   */

  /*
   * The nameplate belongs to the appliance, not to one visit.
   *
   * Merge rather than replace, and never overwrite a stored value with a blank
   * one: a technician who could not reach the plate this time must not erase
   * what the last one read off it.
   */
  function saveAssetDesign(assetId, design) {
    if (!assetId || !design) return { ok: false, message: "No appliance or nameplate given." };
    const state = load();
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset) return { ok: false, message: "That appliance is not on file." };
    asset.design = asset.design || {};
    let changed = 0;
    Object.keys(design).forEach(function (key) {
      const value = design[key];
      if (value === null || value === undefined || String(value).trim() === "") return;
      if (String(asset.design[key] ?? "") === String(value)) return;
      asset.design[key] = value;
      changed += 1;
    });
    if (changed) {
      asset.designUpdatedAt = isoTime(0);
      save(state);
    }
    return { ok: true, changed: changed };
  }

  /*
   * AN AGE A TECHNICIAN ESTABLISHES HAS TO STAY ESTABLISHED.
   *
   * saveTechInspection stored the age on the INSPECTION and never on the
   * ASSET. So every field visit that pinned down an install year threw it away
   * the moment it saved: the household page went on warning "no install date on
   * record", went on advising an invoice import, and the next visit asked the
   * technician the same question again. Cayden hit it repeatedly -- "ive filled
   * out several field reports that include age on an appliance and it is still
   * flagging in the customer area".
   *
   * The rules, in order, because this writes to the customer's record:
   *
   *   1. A DOCUMENT BEATS A JUDGEMENT. An invoice-sourced install year is never
   *      overwritten by a technician's estimate. It can only be replaced by a
   *      technician who explicitly corrected it, and then the source becomes the
   *      technician's estimate -- the record stops claiming a document it no
   *      longer matches.
   *   2. AN ESTABLISHED AGE STICKS. Estimate or customer-stated, it lands on the
   *      asset with its source intact, so the report keeps saying where it came
   *      from and the next visit starts pre-filled.
   *   3. "CANNOT BE ESTABLISHED" IS ALSO AN ANSWER. It is recorded on the asset
   *      too, which is what stops the invoice prompt: there is no document to
   *      import for an appliance Wilson did not sell.
   */
  function applyFieldAge(state, inspection) {
    const asset = state.assets.find(function (a) { return a.id === inspection.assetId; });
    if (!asset) return null;
    const source = String(inspection.ageSource || "");
    const acked = Boolean(inspection.ageUnknownAck);
    const resolved = inspection.ageResolved;
    const hasAge = resolved !== null && resolved !== undefined && String(resolved).trim() !== "";

    if (acked && !hasAge) {
      /* No document exists to chase. Recorded so the household page stops
         advising an import that cannot succeed. */
      if (!asset.ageUnknownAck) {
        asset.ageUnknownAck = true;
        asset.ageUnknownAckAt = isoTime(0);
        asset.ageUnknownAckBy = inspection.technician || "Field technician";
        return "unknown-acknowledged";
      }
      return null;
    }
    if (!hasAge) return null;

    const year = new Date().getFullYear() - Number(resolved);
    const wasDocumented = String(asset.ageSource || "") === "invoice" && asset.installYear;
    /* A technician who did not touch the age carries the asset's own source
       back in; that is not a correction and must not relabel the record. */
    const corrected = wasDocumented && Number(asset.installYear) !== year;
    if (wasDocumented && !corrected) return null;
    if (wasDocumented && corrected && source === "invoice") return null;

    const before = asset.installYear;
    asset.installYear = year;
    asset.ageSource = source === "invoice" ? "invoice" : (source || "estimate");
    if (asset.ageSource !== "invoice") asset.ageSourceRef = "";
    asset.ageUnknownAck = false;
    asset.ageEstablishedBy = inspection.technician || "Field technician";
    asset.ageEstablishedAt = isoTime(0);
    asset.ageEstablishedVisitId = inspection.visitId || "";
    if (corrected) {
      asset.ageCorrectedFrom = before;
      asset.ageCorrectionNote = "Install year corrected in the field from " + before + " to " + year + ".";
    }
    return corrected ? "corrected" : "established";
  }

  /*
   * THE HOUSE'S WATER.
   *
   * Recorded once per visit at the RESIDENCE, not per appliance -- measuring the
   * same supply five times in one kitchen is five chances to disagree with
   * yourself, and the number is a property of the house either way.
   *
   * ONE FIELD: the number off the strip. v0.9.22 removed the softener question
   * with the band picker -- the strip is read at a tap, downstream of whatever
   * equipment the house has, so the reading already accounts for it. Asking as
   * well was asking twice and then letting the two answers disagree.
   *
   * Every reading is kept, not just the latest. That is the point Cayden's zone
   * structure makes valuable: the same technician returns to the same house, so
   * a jump from 3 gpg to 14 between visits is a softener that has failed or been
   * bypassed -- a real finding, for the price of one test strip, and one nobody
   * has to be asked about.
   */
  function saveWaterTest(householdId, payload) {
    if (!householdId) return { ok: false, message: "No residence given." };
    const state = load();
    const household = state.households.find(function (h) { return h.id === householdId; });
    if (!household) return { ok: false, message: "That residence is not on file." };
    const raw = payload && payload.gpg !== null && payload.gpg !== undefined &&
                String(payload.gpg).trim() !== "" ? Number(payload.gpg) : null;
    /* ONE DECIMAL, because that is what the instrument resolves.
       A stray keypress made this store 12.8999 gpg in testing, which the report
       would have printed verbatim -- four decimal places of confidence from a
       strip that reads against a printed colour chart. Rounding here rather
       than at display time means the stored record and the printed one are the
       same number, and the next visit's comparison is against something real. */
    const gpg = raw === null || !Number.isFinite(raw) ? raw : Math.round(raw * 10) / 10;
    /* The ceiling is the config's, not a second number invented here. A reading
       the algorithm would refuse must not be storable -- otherwise the row sits
       on the household reading as "untested" forever with no way to tell it from
       a house nobody tested. */
    const ceiling = window.WILSON_WATER ? window.WILSON_WATER.maxPlausibleGpg() : 100;
    if (gpg !== null && (!Number.isFinite(gpg) || gpg < 0 || gpg > ceiling)) {
      return { ok: false,
               message: "That reading is outside the range of a water test strip. "
                        + "Check the number and enter it again." };
    }
    if (!Array.isArray(state.waterTests)) state.waterTests = [];
    if (!Array.isArray(state.followUps)) state.followUps = [];
    const record = {
      id: id("water"),
      householdId: householdId,
      gpg: gpg,
      testedOn: payload.testedOn || isoDate(0),
      testedBy: payload.testedBy || "Field technician",
      visitId: payload.visitId || "",
      method: payload.method || "Test strip",
      note: payload.note || "",
      createdAt: isoTime(0)
    };
    state.waterTests.unshift(record);
    /* The latest reading is denormalised onto the household so every read path
       does not have to sort the history. The history remains the record. */
    household.waterTest = {
      gpg: record.gpg, testedOn: record.testedOn,
      testedBy: record.testedBy, method: record.method
    };
    save(state);
    return { ok: true, record: record };
  }

  function waterTestsFor(householdId) {
    const state = load();
    return (state.waterTests || []).filter(function (t) { return t.householdId === householdId; });
  }

  /* The resolved water for a household -- what the score actually consumes. */
  function waterFor(householdId) {
    const state = load();
    const household = state.households.find(function (h) { return h.id === householdId; });
    const test = household ? household.waterTest : null;
    return window.WILSON_WATER
      ? window.WILSON_WATER.resolve(test)
      : { tested: false, lifeFactor: 1 };
  }

  function saveTechInspection(payload) {
    const state = load();
    if (!Array.isArray(state.techInspections)) state.techInspections = [];
    const existing = state.techInspections.find((item) => item.visitId === payload.visitId && item.assetId === payload.assetId);
    const record = Object.assign({}, existing || {}, payload, { id: existing ? existing.id : id("inspect"), updatedAt: isoTime(0) });
    if (existing) Object.assign(existing, record); else state.techInspections.push(record);
    /* Write the age through to the appliance on every save, not only on
       completion: a technician who establishes an age and then leaves the visit
       half-finished has still established it. */
    const ageOutcome = applyFieldAge(state, record);
    save(state);
    if (ageOutcome) record.ageOutcome = ageOutcome;
    return record;
  }

  function getTechInspection(visitId, assetId) {
    const state = load();
    return (state.techInspections || []).find((item) => item.visitId === visitId && item.assetId === assetId) || null;
  }

  /*
   * What equipment a visit covers.
   *
   * This used to filter out `group === "hvac"` unconditionally, for every visit
   * of every kind. The consequence was not a degraded HVAC workflow -- it was
   * NO HVAC workflow: an HVAC visit opened in the field tool with zero systems
   * in scope, so there was nothing to inspect and nothing to complete, and the
   * three-check generic protocol nobody wanted was never even reachable.
   *
   * Scope now follows the visit's own category, which is the field that was
   * always there for it.
   */
  function scopedAssetsForVisit(state, visit) {
    if (!visit) return [];
    const category = String(visit.category || "appliance").toLowerCase();
    let rows = state.assets.filter(function (item) {
      /* "Removed" joined "Inactive" in v0.9.42: an appliance taken off the
         plan by a field amendment must not appear on the next visit's list. */
      if (item.householdId !== visit.householdId || item.status === "Inactive" || item.status === "Removed") return false;
      return category === "hvac" ? item.group === "hvac" : item.group !== "hvac";
    });
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
    /*
     * A checkpoint marked NOT APPLICABLE carries rating 0, and rating 0 is
     * <= 2, so it used to land in `low` -- which put "One or more health
     * checkpoints need follow-up" on the customer's report, listed the check
     * under Corrective measures, and printed it as status "Action". A heat-pump
     * dryer with no vent to inspect generated a finding about its vent.
     *
     * The field tool's own status logic already excluded notApplicable
     * (tech-maintenance.js statusFor), so this was two copies of one rule
     * disagreeing, with the customer-facing copy being the wrong one.
     */
    const applicable = (inspection.checks || []).filter((check) => !check.notApplicable);

    /*
     * THE THREE SECTIONS  (v0.9.17)
     *
     * A report used to be one undifferentiated list of 1-5 ratings, which is
     * how "condenser cleaned" -- work Wilson performed -- ended up printed as
     * a health vital and counted toward a health score. The answer kind on each
     * check now decides which section it belongs to:
     *
     *   scored   measured performance. The only thing the score is made of.
     *   trend    a real reading with no agreed band yet. Recorded, compared
     *            against this appliance's own history, never judged.
     *   observed a named category and a photo. A technician's observation,
     *            transparent about being one.
     *   maintenance  what Wilson did. What the money bought.
     *
     * Only the first can reduce a customer's number, and only the first two
     * can produce a finding.
     */
    const setKey = inspection.checkpointSet || "";
    const answerOf = function (check) {
      return window.WILSON_ANSWERS
        ? window.WILSON_ANSWERS.for(setKey, check.id)
        : { kind: "scored", scores: true };
    };
    const scoredChecks = applicable.filter(function (c) { return answerOf(c).scores; });
    const low = scoredChecks.filter((check) => Number(check.rating) <= 2 && Number(check.rating) > 0);
    const watch = scoredChecks.filter((check) => Number(check.rating) === 3);
    /* A condition flagged as needing attention is reported as a finding as well
       as scored. The two are separate: "heavy build-up beyond reach" scores a 3
       AND needs saying out loud, and a full-marks answer never raises one. */
    const observedAttention = applicable.filter(function (c) {
      if (answerOf(c).kind !== "observed") return false;
      /* The flag the field tool set when the option was chosen, OR the result
         wording. Both, because the flag is the reliable one and the wording
         catches records written before the flag existed. */
      return Boolean(c.observedAttention) ||
        /attention|abnormal|restricted|diagnostic|not producing/i.test(String(c.selectionResult || ""));
    });
    const isRefrigeration = String(asset.customerCategory || "").toLowerCase() === "refrigeration" || /refrig|freezer|wine/i.test(String(asset.type || ""));
    const concierge = subscription && subscription.planId === "estate_concierge";
    const filterActive = isRefrigeration && (asset.filterServiceOptIn || asset.airFilterServiceOptIn || concierge);
    const reportId = existing ? existing.id : id("report");
    /*
     * WHERE THE EXPECTED LIFE CAME FROM -- resolved once, here.
     *
     * This used to be computed inside the `water` block on the lifecycle, which
     * meant the provenance of the number only existed if a water reading did.
     * The report then had no way to say whether 15 years was Wilson's own
     * figure for a Miele washer or the category median for "washer", so an
     * icemaker's 11 years and a dishwasher's 15 printed with identical
     * authority. Resolved up here it travels with every report.
     */
    const lifeResolved = (function () {
      if (!window.WILSON_WATER) return { water: null, life: null };
      const w = window.WILSON_WATER.resolve(
        (state.households.find(function (h) { return h.id === (inspection.householdId || visit.householdId); }) || {}).waterTest
      );
      const setKey = inspection.checkpointSet || "";
      /* The appliance lives on the inspection as `asset`, not as loose
         brand/model fields -- reading them off the inspection itself would
         have silently passed empty strings and fallen back to the category
         median for every report. */
      const insAsset = inspection.asset || asset || {};
      const life = window.WILSON_WATER.expectedLife(setKey, inspection.tier || "premium", w, {
        brand: insAsset.brand || "",
        model: insAsset.model || "",
        description: insAsset.description || "",
        line: window.WILSON_BRANDS
          ? (window.WILSON_BRANDS.lineForAsset(insAsset) || window.WILSON_BRANDS.lineForSet(setKey))
          : "",
        group: insAsset.group || "",
        checkpointSet: setKey,
        environment: window.WILSON_ENVIRONMENT
          ? window.WILSON_ENVIRONMENT.for(insAsset).id : "indoor"
      });
      return { water: w, life: life };
    })();
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
      /*
       * null, not 0. `scoreHealth` refuses a number when under 60% of an HVAC
       * system's readings could be taken, and `Number(null || 0)` turned that
       * refusal into a score of zero: the cover read "Your appliance score 0%",
       * and the whole-house review then banded it "Needs attention" and made it
       * the worst equipment in the house. A system nobody could evaluate is not
       * a failing system.
       */
      score: inspection.score === null || inspection.score === undefined ? null : Number(inspection.score),
      scoreUnavailableReason: inspection.score === null || inspection.score === undefined
        ? (inspection.scoreReason || "Not enough of this system could be measured against its design to publish a score.")
        : "",
      grade: inspection.grade || "–",
      condition: inspection.condition || "Not graded",
      summary: low.length ? "Maintenance completed. One or more health checkpoints need follow-up." : watch.length ? "Maintenance completed. Appliance is operating with one or more items to monitor." : "Maintenance completed. Appliance is operating normally at this visit.",
      recommendations: low.map((check) => check.note || check.name).join("; "),
      correctiveMeasures: low.map((check) => check.note || check.name),
      /*
       * Maintenance performed, from the chips a technician tapped. Standard
       * wording, in Wilson's voice on every report rather than in each
       * technician's, and structurally incapable of moving the score -- it is
       * not in `scoredChecks` and never was.
       */
      maintenancePerformed: (function () {
        const ids = inspection.maintenanceDone || [];
        const actions = window.WILSON_ANSWERS ? window.WILSON_ANSWERS.maintenance(setKey) : [];
        return ids.map(function (id) {
          const hit = actions.find(function (a) { return a.id === id; });
          return hit ? hit.label : id;
        }).filter(Boolean);
      })(),
      /* Observations: a category and, where one was taken, a photograph. */
      observations: applicable.filter(function (c) { return answerOf(c).kind === "observed" && c.selection; })
        .map(function (c) {
          return { name: c.name, selection: c.selectionLabel || "", result: c.selectionResult || "",
                   note: c.note || "",
                   /* What the chosen condition was worth. Printed on the report
                      so a customer can add the column up rather than take the
                      total on trust. Null where the answer was "could not get
                      to it", which scores nothing. */
                   score: (c.rating === null || c.rating === undefined || Number(c.rating) === 0)
                     ? null : Number(c.rating),
                   /* So the report can mark the one the technician flagged. A
                      torn door boot is not cosmetic, and burying it in a list
                      of conditions reads as though nobody minded. */
                   attention: Boolean(c.observedAttention) ||
                     /attention|abnormal|restricted|diagnostic|not producing/i.test(String(c.selectionResult || "")) };
        }),
      /*
       * The stored fault codes, with the check that found them.
       *
       * "Codes present" used to be the whole record. The code is the part the
       * next technician can act on, so it travels to the report.
       */
      storedCodes: applicable.filter(function (c) { return String(c.detail || "").trim() !== ""; })
        .map(function (c) {
          return { name: c.name, code: String(c.detail).trim(),
                   label: c.detailLabel || "Code shown on the display" };
        }),
      /*
       * Readings taken with no agreed band: recorded, trended, not judged.
       *
       * This mapped `c.reading` only -- the single-box value -- so the moment a
       * measurement became NAMED FIELDS (the oven's set point and measured
       * temperature) it produced no row at all and vanished from the customer's
       * report. Both shapes are carried, and the value the tool derives from a
       * pair travels with them.
       */
      trendReadings: applicable.filter(function (c) { return answerOf(c).kind === "trend"; })
        .map(function (c) {
          const answer = answerOf(c);
          const fields = (answer.readingFields || c.readingFields || []);
          const values = fields.map(function (f) {
            return { label: f.label, value: String((c.readings || {})[f.key] ?? "").trim(),
                     unit: f.unit || "" };
          }).filter(function (v) { return v.value !== ""; });
          const derived = (window.WILSON_INPUT && window.WILSON_INPUT.derivedValue)
            ? window.WILSON_INPUT.derivedValue(c, answer) : null;
          return { name: c.name, value: c.reading || "", unit: c.unit || "", note: c.note || "",
                   values: values, derived: derived };
        }).filter(function (r) {
          return String(r.value).trim() !== "" || r.values.length > 0;
        }),
      /*
       * The count a customer can check for themselves: how many of the MEASURED
       * checks were inside target. More defensible than the percentage.
       *
       * Counted on kind, not on `scoredChecks`. As of v0.9.19 conditions score
       * too, so `scoredChecks` includes them -- and a door boot is not "inside
       * the target used at this visit". Sliding conditions into a sentence about
       * instrument readings would have overstated exactly the thing this
       * sentence exists to make checkable.
       */
      measuredCount: (function () {
        const measured = scoredChecks.filter(function (c) { return answerOf(c).kind === "scored"; });
        return { inside: measured.filter(function (c) { return Number(c.rating) >= 4; }).length,
                 total: measured.length };
      })(),
      /* Conditions, counted separately and on the same rule. */
      conditionCount: (function () {
        const seen = scoredChecks.filter(function (c) { return answerOf(c).kind === "observed"; });
        return { normal: seen.filter(function (c) { return Number(c.rating) >= 4; }).length,
                 total: seen.length };
      })(),
      observedAttention: observedAttention.map(function (c) {
        return { name: c.name, result: c.selectionResult || "", note: c.note || "" };
      }),
      /*
       * WHAT ACTUALLY HAPPENED, OR NOTHING.   (v0.9.37)
       *
       * This was one hardcoded sentence on every report the product has ever
       * generated: "Required health checks and maintenance steps were completed
       * in the field workflow." It asserted that required steps were completed
       * with nothing behind the claim, and said it in language no customer uses.
       *
       * It is built from what the technician actually recorded now -- the checks
       * they answered and the maintenance chips they ticked. When they recorded
       * nothing it is EMPTY, and the report says the technician did not record a
       * summary. A blank is a truthful answer; boilerplate is not.
       */
      serviceSummary: (function () {
        const answered = (inspection.checks || []).filter(function (c) {
          return c.rating || c.selection || c.notApplicable;
        }).length;
        const total = (inspection.checks || []).length;
        const performed = (inspection.maintenanceDone || []).slice();
        if (!answered && !performed.length) return "";
        const parts = [];
        if (total) {
          parts.push(answered === total
            ? "All " + total + " health checks on this appliance's protocol were completed."
            : answered + " of " + total + " health checks were completed.");
        }
        if (performed.length) parts.push("Maintenance performed: " + performed.join(", ") + ".");
        return parts.join(" ");
      })(),
      filterPart: filterActive ? "Exact filter(s) verified in field / filter record" : "",
      filterAction: filterActive ? (concierge ? "Filter service included" : "Filter service selected") : (isRefrigeration ? "Inspected - replacement not enrolled" : ""),
      /* v0.9.39: the one note. Replaces the per-check free notes on Cayden's
         call; reasons on flagged checks still travel per checkpoint. */
      technicianNote: String(inspection.generalNote || "").trim(),
      measurements: measurementRowsFromInspection(inspection),
      /*
       * Every check, carrying WHAT KIND of answer it is.
       *
       * The report needs this to print three sections rather than one list:
       * measured performance, maintenance performed, and technician
       * observations. Before v0.9.17 they were one undifferentiated set of
       * 1-5 ratings, which is how "condenser cleaned" ended up as a health
       * vital on a customer's report.
       */
      checkpoints: (inspection.checks || []).map((check) => Object.assign({
        answerKind: (window.WILSON_ANSWERS
          ? window.WILSON_ANSWERS.for(inspection.checkpointSet || "", check.id).kind
          : "scored"),
        scores: (window.WILSON_ANSWERS
          ? window.WILSON_ANSWERS.for(inspection.checkpointSet || "", check.id).scores
          : true),
        selection: check.selection || "",
        selectionLabel: check.selectionLabel || "",
        selectionResult: check.selectionResult || "",
        count: check.count === undefined ? null : check.count,
        countOf: check.countOf === undefined ? null : check.countOf,
        /* The stored fault code. Announcing "codes present" and printing no
           code tells a customer a fault exists and withholds the only part of
           it their next technician can use. */
        detail: check.detail || "",
        detailLabel: check.detailLabel || "",
        observedAttention: Boolean(check.observedAttention),
        /* v0.9.39: the technician flagged this for a return visit. The report
           says so, because "we saw it and we are coming back for it" is a
           commitment the customer should read in writing. */
        followUp: Boolean(check.followUp)
      }, (function () {
        /*
         * STATUS ON A CUSTOMER'S REPORT.
         *
         * This was `Number(check.rating) >= 4 ? "Pass" : ... : "Action"`, and an
         * observation has no rating -- so `Number(null)` was 0, 0 fell through
         * every branch, and EVERY observation printed to the customer as
         * "Action". A door seal a technician had just called Good arrived on the
         * report as an action item.
         *
         * An observation is now reported as what it is: the condition that was
         * seen, flagged only when the technician flagged it.
         */
        const rated = check.rating !== null && check.rating !== undefined && Number(check.rating) > 0;
        const flagged = Boolean(check.observedAttention) ||
          /attention|abnormal|restricted|diagnostic|not producing/i.test(String(check.selectionResult || ""));
        let status;
        if (check.notApplicable) status = "Not applicable";
        else if (rated) {
          /* v0.9.39: the customer reads the same three words the technician
             tapped. "Watch" and "Action" were this product's own paraphrase of
             a vocabulary that now officially exists. */
          status = Number(check.rating) >= 4 ? "Pass" : Number(check.rating) === 3 ? "Cause for concern" : "Fail";
        } else if (check.selection) {
          status = flagged ? "Needs attention" : "Recorded";
        } else {
          status = "Recorded";
        }
        /*
         * THE SUBSYSTEM, NOT "HEALTH VITAL".   (v0.9.37)
         *
         * Every field checkpoint used to be stamped `category: "Health vital"`,
         * which collapsed the report's Subsystem review to one section and its
         * score breakdown to one line -- "Health vital, -12" -- while the page
         * above it promised categories like temperature, airflow and filtration.
         * The report described a document nobody was holding.
         */
        const definition = (window.WILSON_CONFIG.checkpointSets[inspection.checkpointSet] || [])
          .find(function (c) { return c.id === check.id; });
        const subsystem = (definition && definition.subsystem) || "condition";
        const subsystemLabel = ((window.WILSON_CONFIG.subsystems || {})[subsystem] || {}).label || "Condition";
        return {
          subsystem: subsystem,
          category: subsystemLabel,
          name: check.name,
          rating: rated ? Number(check.rating) : null,
          notApplicable: Boolean(check.notApplicable),
          status: status,
          notes: check.note || ""
        };
      })())),
      categoryLosses: [],
      tasks: (inspection.checks || []).filter((check) => check.performed).map((check) => check.name),
      /*
       * The photographs themselves, not a tally of them.
       *
       * `photoCount` alone was a number the report printed with nothing behind
       * it -- the images were discarded at capture. Each entry now names a
       * stored photograph so the report can render it and say which checkpoint
       * it is evidence for. The count is derived from the list rather than
       * carried separately, so the two can never disagree.
       */
      photos: (function () {
        const rows = [];
        if (inspection.serialPhoto) {
          rows.push({ id: inspection.serialPhoto, kind: "serial", checkName: "Serial tag",
                      caption: "Serial tag, photographed at the appliance" });
        }
        (inspection.checks || []).forEach((check) => {
          if (!check.photo) return;
          rows.push({ id: check.photo, kind: "condition", checkName: check.name || "",
                      caption: check.note || "" });
        });
        /* v0.9.41: general photographs -- taken from the worth-noting section,
           tied to the appliance rather than to any one health check. They ride
           the report next to the technician's note they illustrate. */
        (inspection.generalPhotos || []).forEach((p) => {
          if (!p || !p.id) return;
          rows.push({ id: p.id, kind: "general", checkName: "General",
                      caption: String(inspection.generalNote || "").trim() ? "With the technician's note" : "General photo from the visit" });
        });
        return rows;
      })(),
      /*
       * THE GUARDIAN SHEET IS A SNAPSHOT, LIKE THE PHOTOS.       (v0.9.48)
       *
       * The audit's case: the sheet used to render from LIVE enrollment state,
       * so a six-month-old report reprinted with today's chart captioned as
       * its own 48 hours, and a removed appliance's already-delivered report
       * lost the page entirely. What the sensor saw at report time is part of
       * the record, so it is captured here, once, at generation.
       */
      guardian: (function () {
        const SIM = window.WILSON_TEMPWATCH_SIM;
        if (!SIM || !SIM.forAssetSensors || !asset || !asset.tempMonitoringOptIn) return null;
        try {
          return SIM.forAssetSensors(asset, null).map(function (row) {
            return {
              compartment: row.compartment,
              compartmentLabel: row.compartmentLabel,
              points: row.points,
              flag: { flagged: row.flag.flagged, tier: row.flag.tier, reason: row.flag.reason,
                      overForMinutes: row.flag.overForMinutes,
                      rule: row.flag.rule ? JSON.parse(JSON.stringify(row.flag.rule)) : null },
              stats: row.stats,
              simulated: true,
              capturedAt: isoTime(0)
            };
          });
        } catch (e) { return null; }
      })(),
      /* `age: Number(inspection.age || 0)` used to turn an unestablished age
         into age zero -- a brand-new appliance -- and an ageScore of 0 into a
         real-looking number. An unknown age is now carried as null all the way
         to the report, which states it. */
      lifecycle: {
        age: inspection.ageResolved === null || inspection.ageResolved === undefined ? null : Number(inspection.ageResolved),
        tier: inspection.tier || "premium",
        expectedYears: Number(inspection.expectedYears || 0),
        ageScore: inspection.ageScore === null || inspection.ageScore === undefined ? null : Number(inspection.ageScore),
        /* Carried as null when nothing scorable was measured, for the same
           reason the age is: `Number(null || 0)` publishes a refusal as a
           zero, and a zero here reads as an appliance that failed every
           check rather than one that was never measured. */
        vitalScore: inspection.vitalScore === null || inspection.vitalScore === undefined
          ? null : Number(inspection.vitalScore),
        stage: inspection.lifeStage || "",
        lifeRatio: inspection.lifeRatio === null || inspection.lifeRatio === undefined ? null : Number(inspection.lifeRatio),
        ageSource: inspection.ageSource || "unknown",
        ageSourceLabel: inspection.ageSourceLabel || "",
        ageDocumented: Boolean(inspection.ageDocumented),
        installYear: Number((asset || {}).installYear) || null,
        ageSourceRef: (asset || {}).ageSourceRef || "",
        /*
         * THE HOUSE'S WATER, on the report.
         *
         * A shortened expected life with no stated reason is an unexplained
         * number on a customer's report, which is the thing this product exists
         * not to produce. Carried with the raw reading, the band, the factor and
         * the basis, so the paragraph can be written from facts rather than from
         * an adjective.
         */
        /* v0.9.37: the basis for the expected life, on every report whether or
           not the house has a water reading. `kind` is "brand" when Wilson's
           own table named this brand and line, "category" when the figure is
           the tier median for the appliance category. */
        lifeBasis: lifeResolved.life ? lifeResolved.life.basis : null,
        water: (function () {
          const w = lifeResolved.water;
          const life = lifeResolved.life;
          if (!w || !life) return null;
          return {
            tested: w.tested, gpg: w.gpg,
            band: w.band ? w.band.label : null,
            /* Whether this house's water is worth flagging to the customer, as
               opposed to merely stating. Resolved once, here, so the report and
               any future dashboard cannot draw the line in different places. */
            flagged: Boolean(w.flagged),
            factor: w.lifeFactor,
            applied: life.applied,
            waterBearing: life.waterBearing,
            baseYears: life.base,
            adjustedYears: life.adjusted,
            basis: window.WILSON_WATER.basis(),
            sourced: window.WILSON_WATER.sourced()
          };
        })()
      },
      createdAt: isoTime(0)
    };
    if (existing) Object.assign(existing, report); else state.reports.unshift(report);
    inspection.reportId = reportId;
    /*
     * THE RETURN-VISIT QUEUE.                                   (v0.9.39)
     *
     * Cayden: a flagged concern or fail the technician marks "needs a return
     * visit" becomes work for the office -- quote it, get the customer's
     * approval, schedule a separate visit. The flags are synced, not appended:
     * re-completing the same appliance replaces ITS open flags rather than
     * duplicating them, and a flag the technician removed is withdrawn here
     * too, unless the office already acted on it -- a service order somebody
     * created does not evaporate because a checkbox changed.
     */
    syncFollowUpsFromInspection(state, inspection, visit, asset, report);
    state.activity.unshift({ id: id("act"), householdId: visit.householdId, type: "Report", text: (existing ? "Field-generated appliance health report refreshed for " : "Field-generated appliance health report completed for ") + report.applianceLabel + ".", createdAt: isoTime(0) });
    refreshVisitReportStatusInState(state, visitId);
    save(state);
    return { ok: true, report: existing || report, existing: Boolean(existing) };
  }

  function syncFollowUpsFromInspection(state, inspection, visit, asset, report) {
    if (!Array.isArray(state.followUps)) state.followUps = [];
    const flagged = (inspection.checks || []).filter(function (c) { return c.followUp && !c.notApplicable; });
    const keyFor = function (checkId) { return visit.id + "|" + (asset ? asset.id : "") + "|" + checkId; };
    const wanted = {};
    flagged.forEach(function (c) { wanted[keyFor(c.id)] = c; });
    /* Withdraw un-acted-on flags this inspection no longer carries. */
    state.followUps = state.followUps.filter(function (f) {
      if (f.visitId !== visit.id || f.assetId !== (asset ? asset.id : "")) return true;
      if (f.status !== "open") return true;
      return Boolean(wanted[f.key]);
    });
    flagged.forEach(function (c) {
      const key = keyFor(c.id);
      const held = state.followUps.find(function (f) { return f.key === key; });
      if (held) {
        /* The reason can sharpen between saves; the identity cannot. */
        if (held.status === "open") { held.note = c.note || ""; held.verdict = c.selectionResult || ""; }
        return;
      }
      state.followUps.unshift({
        id: id("fup"), key: key,
        householdId: visit.householdId, assetId: asset ? asset.id : "",
        visitId: visit.id, reportId: report.id,
        applianceLabel: report.applianceLabel,
        checkId: c.id, checkName: c.name,
        verdict: c.selectionResult || "",
        note: c.note || "",
        technician: inspection.technician || "Wilson technician",
        createdAt: isoTime(0),
        status: "open"
      });
      state.activity.unshift({
        id: id("act"), householdId: visit.householdId, type: "Follow-up",
        text: "Return visit flagged by the technician: " + report.applianceLabel + " — " + c.name +
              (c.note ? " (" + c.note + ")" : "") + ". The office quotes it, gets approval, and schedules a separate visit.",
        createdAt: isoTime(0)
      });
    });
  }

  /* The office's side of the flag. Resolving records WHAT was done with it --
     a service order reference or a reason it went nowhere -- because a queue
     that only deletes things cannot answer "what happened to that dryer". */
  function resolveFollowUp(followUpId, outcome) {
    const state = load();
    const item = (state.followUps || []).find(function (f) { return f.id === followUpId; });
    if (!item) return { ok: false, message: "That follow-up is not on file." };
    if (item.status !== "open") return { ok: false, message: "Already handled." };
    item.status = outcome && outcome.dismissed ? "dismissed" : "ordered";
    item.resolvedAt = isoTime(0);
    item.serviceOrderRef = (outcome && outcome.ref) || "";
    item.resolution = (outcome && outcome.note) || "";
    state.activity.unshift({
      id: id("act"), householdId: item.householdId, type: "Follow-up",
      text: (item.status === "ordered"
        ? "Return service order " + (item.serviceOrderRef ? item.serviceOrderRef + " " : "") + "created for "
        : "Return-visit flag closed without an order for ") + item.applianceLabel + " — " + item.checkName + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, followUp: item };
  }

  /*
   * THE QUOTE PIPELINE.                                          (v0.9.41)
   *
   * Cayden drew the whole path: "tech builds quote for recommended service,
   * and then hits a quote complete button on the notification to remove it
   * from their queue. once tech hits quote complete, this moves into the
   * backend command center to flag the office admins to find the quote in
   * epass and send it over to the customer" -- through the Service Estimate
   * Approvals dashboard that already exists and already emails, tracks
   * Viewed / Shopping, and distributes the customer's decision.
   *
   * So a follow-up now walks: open (tech owes a quote; in the merged
   * dashboard this row IS the My Notifications entry) -> quoted (tech hit
   * Quote complete; the office owes the ePass import) -> handed (it lives in
   * Service Estimate Approvals now, and this tool's job is done). The
   * prototype does not build tech notifications -- Cayden: "notifications to
   * techs dont need to be built in the prototype" -- it builds the states
   * they will pin to. See docs/FOLLOWUP_QUOTE_HANDOFF.md for the merge
   * contract.
   */
  function markFollowUpQuoted(followUpId, outcome) {
    const state = load();
    const item = (state.followUps || []).find(function (f) { return f.id === followUpId; });
    if (!item) return { ok: false, message: "That follow-up is not on file." };
    if (item.status !== "open") return { ok: false, message: "Already handled." };
    item.status = "quoted";
    item.quotedAt = isoTime(0);
    item.serviceOrderRef = (outcome && outcome.ref) || "";
    state.activity.unshift({
      id: id("act"), householdId: item.householdId, type: "Follow-up",
      text: "Quote built for " + item.applianceLabel + " — " + item.checkName +
            (item.serviceOrderRef ? " (" + item.serviceOrderRef + ")" : "") +
            ". Office: pull it from ePass and import it into Service Estimate Approvals.",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, followUp: item };
  }

  function handFollowUpToApprovals(followUpId) {
    const state = load();
    const item = (state.followUps || []).find(function (f) { return f.id === followUpId; });
    if (!item) return { ok: false, message: "That follow-up is not on file." };
    if (item.status !== "quoted") return { ok: false, message: "Not waiting on the office." };
    item.status = "handed";
    item.handedAt = isoTime(0);
    state.activity.unshift({
      id: id("act"), householdId: item.householdId, type: "Follow-up",
      text: "Estimate for " + item.applianceLabel + " — " + item.checkName +
            (item.serviceOrderRef ? " (" + item.serviceOrderRef + ")" : "") +
            " imported into Service Estimate Approvals. It emails the customer and routes their decision from there.",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, followUp: item };
  }

  function openFollowUps(householdId) {
    const state = load();
    return (state.followUps || []).filter(function (f) {
      return f.status === "open" && (!householdId || f.householdId === householdId);
    });
  }

  function quotedFollowUps(householdId) {
    const state = load();
    return (state.followUps || []).filter(function (f) {
      return f.status === "quoted" && (!householdId || f.householdId === householdId);
    });
  }

  /*
   * A PLAN AMENDMENT, APPROVED IN THE FIELD.                     (v0.9.41)
   *
   * Cayden: "build a way for tech in field to add appliances to an existing
   * plan, cleanly show customer updated pricing, get approval in field and
   * trigger office to bill the new approved total / difference. this way the
   * tech can proceed to make more money on site and not interrupt the work
   * flow."
   *
   * The builder does the arithmetic with the SAME pricing engine registration
   * uses -- nothing here re-prices anything. This function records what the
   * customer approved: the new appliances join the household, the
   * subscription's annual moves to the new total, and ONE amendment row
   * carries the difference for the office to bill -- previous annual, new
   * annual, the customer's signature, and a charge status the command center
   * works from. The card is charged by a person, never by this prototype.
   */
  /* Currency for activity text, matching the store's existing "$" +
     toFixed(2) convention (mockCharge writes the same shape). */
  function amendMoney(value) { return "$" + Number(value || 0).toFixed(2); }

  function amendEnrollment(payload) {
    const state = load();
    const household = state.households.find(function (h) { return h.id === payload.householdId; });
    if (!household) return { ok: false, message: "That household is not on file." };
    const subscription = state.subscriptions.find(function (s) {
      return payload.subscriptionId ? s.id === payload.subscriptionId
        : (s.householdId === payload.householdId && s.category === "appliance");
    });
    if (!subscription) return { ok: false, message: "No appliance plan on file to amend." };

    const previousAnnual = Number(subscription.annualAmount || 0);
    const newAnnual = Number(payload.newAnnual || 0);
    const difference = Math.round((newAnnual - previousAnnual) * 100) / 100;
    /* v0.9.43: bill today only the part of the plan year still ahead; the
       renewal bills the new annual and the normal schedule takes over.
       v0.9.49, Cayden's correction: an ADDED appliance is serviced at this
       visit, so its increase bills at FULL price — the customer gets the
       whole year of service starting today. One implementation --
       WILSON_PRICING.amendmentBilling -- shared with the approval screen, so
       the office charges the number the customer signed. */
    const proration = window.WILSON_PRICING.amendmentBilling(difference, subscription.renewalOn, {
      hasAdditions: (payload.addedAssets || []).length > 0
    });

    const added = createAssets(payload.householdId, payload.addedAssets || []);
    state.assets.push.apply(state.assets, added);

    /* Add-on choices changed on appliances ALREADY on the plan (a Guardian
       sensor sold at the kitchen counter) travel with the same approval. */
    (payload.optInSync || []).forEach(function (row) {
      const asset = state.assets.find(function (a) { return a.id === row.assetId; });
      if (!asset) return;
      ["tempMonitoringOptIn", "tempMonitoringCompartments", "filterServiceOptIn", "airFilterServiceOptIn", "imucVisitsPerYear"].forEach(function (key) {
        if (row[key] !== undefined) asset[key] = row[key];
      });
    });

    /*
     * REMOVALS. Cayden: "Removing appliances from a plan should be fine in
     * the field, office confirms changes." The record survives -- reports and
     * history still name this machine -- but it leaves every active surface:
     * `status: "Removed"` is the vocabulary equipment.js and equipmentGaps
     * already speak, the visit list and the Guardian fleet skip it, and its
     * filter-tracking rows go because there is nothing left to track.
     */
    const removed = [];
    (payload.removedAssetIds || []).forEach(function (assetId) {
      const asset = state.assets.find(function (a) { return a.id === assetId && a.householdId === payload.householdId; });
      if (!asset || asset.status === "Removed") return;
      asset.status = "Removed";
      asset.removedFromPlanAt = isoTime(0);
      asset.tempMonitoringOptIn = false;
      asset.tempMonitoringCompartments = [];
      asset.filterServiceOptIn = false;
      asset.airFilterServiceOptIn = false;
      removed.push(asset);
    });
    if (removed.length) {
      const removedIds = removed.map(function (a) { return a.id; });
      state.filters = (state.filters || []).filter(function (f) { return removedIds.indexOf(f.assetId) === -1; });
    }

    if (Array.isArray(payload.areas) && payload.areas.length) household.areas = payload.areas;

    subscription.annualAmount = newAnnual;
    let planChangedFrom = null;
    if (payload.planId && window.WILSON_CONFIG.appliancePlans[payload.planId]) {
      if (subscription.planId !== payload.planId) planChangedFrom = subscription.planId;
      subscription.planId = payload.planId;
      subscription.planName = window.WILSON_CONFIG.appliancePlans[payload.planId].name;
    }
    if (payload.pricingBreakdown) subscription.pricingBreakdown = payload.pricingBreakdown;

    /*
     * A PLAN CHANGE RESYNCS FILTER COVERAGE.                     (v0.9.48)
     *
     * The audit's case: amend a household onto Estate Concierge and the new
     * appliances' filters were written "Track only" although the plan now
     * includes them; amend off Concierge and filters kept being given away.
     * The flags follow the PLAN, so they move when the plan moves.
     */
    if (payload.planId) {
      subscription.standardFiltersIncluded = payload.planId === "estate_concierge";
      subscription.filterManagement = subscription.standardFiltersIncluded
        || (state.assets || []).some(function (a) {
          return a.householdId === payload.householdId && a.status !== "Removed" &&
            (a.filterServiceOptIn || a.airFilterServiceOptIn);
        });
      (state.filters || []).forEach(function (f) {
        if (f.householdId !== payload.householdId || f.subscriptionId !== subscription.id) return;
        if (subscription.standardFiltersIncluded) f.planCoverage = "Included";
        else if (f.planCoverage === "Included") f.planCoverage = "Managed - material billed separately";
      });
    }

    /* New appliances get filter tracking exactly the way enrollment gives it. */
    const coverage = subscription.standardFiltersIncluded
      ? "Included"
      : (subscription.filterManagement ? "Managed - material billed separately" : "Track only");
    const filterRecords = createFilterRecords(payload.householdId, added, subscription, coverage);
    state.filters.push.apply(state.filters, filterRecords);

    /*
     * THE VISIT ROWS HEAR ABOUT THE CHANGE.                      (v0.9.48)
     *
     * The audit's worst finding: the annual moved but the already-scheduled
     * visit kept its old amountToCharge, so the office's charge button and
     * the plan card three inches above it disagreed. The billing MODEL is:
     * this cycle's visit rows keep collecting the pre-change annual, and the
     * signed amendment's prorated row settles the difference -- the two sum
     * to what the customer owes. So the fix is not to re-price the rows (that
     * would double-collect) but to make them SAY what they are, refresh their
     * scope, and schedule any service the change added:
     *
     *   - every uncharged future visit gets a note naming the arrangement,
     *     so no screen shows an old number beside a new annual unexplained;
     *   - assetScope counts refresh, so a visit does not promise appliances
     *     that left the plan;
     *   - an icemaker newly on two visits gets its second visit CREATED, at
     *     $0 with the note, because its money is already inside the signed
     *     difference -- a customer must never pay for a visit that is not
     *     on the schedule.
     */
    const uncharged = (state.visits || []).filter(function (v) {
      return v.subscriptionId === subscription.id && v.status !== "Completed" &&
        !/^(Charged|Posted to AR|Paid)/.test(String(v.paymentStatus || ""));
    });
    const activeAppliances = (state.assets || []).filter(function (a) {
      return a.householdId === payload.householdId && a.group !== "hvac" &&
        a.status !== "Removed" && a.status !== "Inactive";
    });
    const amendmentNote = "Billed at the pre-change annual; the signed amendment settles the difference separately. The new annual applies from renewal.";
    uncharged.forEach(function (v) {
      v.amendedNote = amendmentNote;
      if (!/icemaker/i.test(String(v.assetScope || ""))) {
        v.assetScope = activeAppliances.length + " enrolled appliance" + (activeAppliances.length === 1 ? "" : "s");
      }
    });
    const secondVisitImuc = activeAppliances.filter(function (a) {
      return a.group === "imuc" && Number(a.imucVisitsPerYear) >= 2;
    });
    const hasImucSecond = (state.visits || []).some(function (v) {
      return v.subscriptionId === subscription.id && v.status !== "Completed" &&
        /icemaker/i.test(String(v.assetScope || "")) ;
    });
    if (secondVisitImuc.length && !hasImucSecond) {
      createVisit(state, subscription, payload.householdId, "appliance", {
        dueDate: isoDate(182),
        season: "Second icemaker visit",
        amountToCharge: 0,
        paymentStatus: "Included - priced into the approved plan change",
        reportRequired: false,
        assetScope: secondVisitImuc.length + " icemaker" + (secondVisitImuc.length === 1 ? "" : "s")
      });
    }

    const amendment = {
      id: id("amend"),
      householdId: payload.householdId,
      subscriptionId: subscription.id,
      previousAnnual: previousAnnual,
      newAnnual: newAnnual,
      difference: difference,
      addedAssetIds: added.map(function (a) { return a.id; }),
      addedLabels: added.map(function (a) { return a.typeLabel || a.type; }),
      removedAssetIds: removed.map(function (a) { return a.id; }),
      removedLabels: removed.map(function (a) { return a.typeLabel || a.type; }),
      /* What the office actually settles TODAY, and the arithmetic behind
         it, kept on the record beside the annual difference. */
      proratedDifference: proration.amount,
      prorationFactor: proration.factor,
      prorationDaysRemaining: proration.daysRemaining,
      renewalPassed: Boolean(proration.renewalPassed),
      servicedNow: Boolean(proration.servicedNow),
      planChange: planChangedFrom ? { from: planChangedFrom, to: subscription.planId } : null,
      renewalOn: subscription.renewalOn || "",
      optInChanges: (payload.optInSync || []).length,
      approvedAt: isoTime(0),
      approvedBy: payload.approvedBy || "Customer, in the field",
      /* The signature image, as drawn on the technician's phone. Evidence of
         the agreement, stored with it rather than beside it. */
      signature: payload.signatureDataUrl || "",
      /* v0.9.42: the office confirms every change that moved money or scope.
         v0.9.43: keyed on the PRORATED figure -- that is what moves today; a
         change whose money only shows up at renewal still gets confirmed. */
      chargeStatus: proration.amount > 0 ? "Pending charge"
        : proration.amount < 0 ? "Pending credit"
        : (removed.length || difference !== 0) ? "Pending confirmation"
        : "No charge due",
      status: "approved"
    };
    if (!Array.isArray(state.amendments)) state.amendments = [];
    state.amendments.unshift(amendment);

    const changeBits = [];
    if (amendment.addedLabels.length) changeBits.push("added " + amendment.addedLabels.join(", "));
    if (amendment.removedLabels.length) changeBits.push("removed " + amendment.removedLabels.join(", "));
    if (amendment.planChange) changeBits.push("plan moves " +
      (window.WILSON_CONFIG.appliancePlans[amendment.planChange.from] || { name: amendment.planChange.from }).name +
      " → " + subscription.planName);
    if (!changeBits.length) changeBits.push("add-on changes");
    state.activity.unshift({
      id: id("act"), householdId: payload.householdId, type: "Amendment",
      text: "Plan change approved in the field: " + changeBits.join("; ") +
            ". Annual moves " + amendMoney(previousAnnual) + " → " + amendMoney(newAnnual) +
            (proration.amount > 0
              ? "; office to charge " + amendMoney(proration.amount) + " today " +
                (proration.servicedNow
                  ? "(full-year price — the added appliances are serviced at this visit)"
                  : proration.renewalPassed
                  ? "(the renewal date has passed, so the full difference is due)"
                  : "(prorated to the " + (proration.daysRemaining === null ? "remaining term" : proration.daysRemaining + " days left this plan year") + ")") +
                "; the new annual bills from renewal" + (subscription.renewalOn ? " on " + subscription.renewalOn : "") + "."
              : proration.amount < 0
                ? "; office to settle " + amendMoney(Math.abs(proration.amount)) + " prorated reduction; the new annual bills from renewal."
                : difference !== 0
                  ? "; nothing to bill today — the new annual bills from renewal" + (subscription.renewalOn ? " on " + subscription.renewalOn : "") + "."
                  : "."),
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, amendment: amendment, addedAssets: added };
  }

  function pendingAmendments() {
    const state = load();
    return (state.amendments || []).filter(function (a) { return String(a.chargeStatus || "").indexOf("Pending") === 0; });
  }

  /* The office's confirmation, whatever shape the money took: a charge for a
     positive difference, a credit decision for a negative one, a plain
     confirmation for an even-money removal. One press, once. */
  function markAmendmentCharged(amendmentId) {
    const state = load();
    const item = (state.amendments || []).find(function (a) { return a.id === amendmentId; });
    if (!item) return { ok: false, message: "That amendment is not on file." };
    if (String(item.chargeStatus || "").indexOf("Pending") !== 0) return { ok: false, message: "Nothing left to charge." };
    const wasCredit = item.chargeStatus === "Pending credit";
    const wasConfirm = item.chargeStatus === "Pending confirmation";
    item.chargeStatus = wasCredit ? "Credited" : wasConfirm ? "Confirmed" : "Charged";
    item.chargedAt = isoTime(0);
    /* Old records predate proration and carry only the annual difference. */
    const settledAmount = item.proratedDifference !== undefined ? item.proratedDifference : item.difference;
    state.activity.unshift({
      id: id("act"), householdId: item.householdId, type: "Amendment",
      text: wasCredit
        ? "Office settled the " + amendMoney(Math.abs(settledAmount)) + " prorated reduction from the approved plan change."
        : wasConfirm
          ? "Office confirmed the approved plan change."
          : "Card on file charged " + amendMoney(settledAmount) + " (prorated) for the approved plan change.",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, amendment: item };
  }

  /*
   * A TEMP WATCH DISPATCH.                                      (v0.9.39)
   *
   * A sustained flag becomes a priority service call: recorded, on the
   * household activity, idempotent per asset per day so a hub left open does
   * not file the same dispatch twice. This is a SERVICE CALL, not a
   * return-visit quote -- it deliberately does not join the followUps queue,
   * because the promise attached to it is speed, not paperwork.
   */
  function recordTempDispatch(payload) {
    const state = load();
    if (!Array.isArray(state.tempDispatches)) state.tempDispatches = [];
    const asset = assetById(state, payload && payload.assetId);
    if (!asset) return { ok: false, message: "That appliance is not on file." };
    const day = isoDate(0);
    const key = asset.id + "|" + day;
    const held = state.tempDispatches.find(function (d) { return d.key === key; });
    if (held) return { ok: true, dispatch: held, existing: true };
    const dispatch = {
      id: id("disp"), key: key,
      householdId: asset.householdId, assetId: asset.id,
      applianceLabel: [asset.brand, asset.model, asset.typeLabel].filter(Boolean).join(" "),
      flagLabel: (payload && payload.flagLabel) || "Temperature flag",
      reading: (payload && payload.reading) || null,
      createdAt: isoTime(0), status: "open"
    };
    state.tempDispatches.unshift(dispatch);
    state.activity.unshift({
      id: id("act"), householdId: asset.householdId, type: "Guardian",
      text: "Priority dispatch opened by " + (((window.WILSON_CONFIG || {}).tempMonitoring || {}).serviceName || "Refrigeration Guardian") + ": " + dispatch.applianceLabel + " — " + dispatch.flagLabel + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, dispatch: dispatch, existing: false };
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

  /*
   * A QUOTE IS AN UNACCEPTED ENROLLMENT.  (v0.9.23)
   *
   * It used to be its own document with its own appliance picker and its own
   * pricing arithmetic, and the two disagreed: quote-builder.js had no concept
   * of filter service, so an 18-appliance house was quoted $1,874.90 on Estate
   * Annual and enrolled at $2,224.90. Wilson could send a customer one number
   * and bill another, with nothing in the system to say which was right.
   *
   * So the quote now CARRIES the enrollment payload -- the same object
   * createEnrollment consumes, built by the same screen, priced by the same
   * code. `enrollment` is that payload; everything beside it is paperwork
   * (number, status, validity, who prepared it).
   *
   * Accepting one does not re-derive anything. See acceptQuote.
   */
  function saveQuote(payload) {
    const state = load();
    const quoteId = id("quote");
    const sequence = String(state.quotes.length + 1).padStart(3, "0");
    const dateStamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const enrollment = payload.enrollment || null;
    const quote = Object.assign({}, payload, {
      id: quoteId,
      quoteNumber: payload.quoteNumber || "MP-" + dateStamp + "-" + sequence,
      status: payload.status || "Draft",
      /* Denormalised for the quotes list and the proposal header, so neither
         has to reach into the payload -- but DERIVED from it, never entered
         alongside it, because a second copy of the price is how the last two
         screens drifted apart. */
      annualAmount: enrollment ? Number(enrollment.annualAmount || 0) : Number(payload.annualAmount || 0),
      applianceCount: enrollment ? (enrollment.assets || []).length : Number(payload.applianceCount || 0),
      planId: enrollment ? enrollment.planId : payload.planId,
      planName: enrollment ? enrollment.planName : payload.planName,
      householdId: null,
      createdAt: isoTime(0),
      updatedAt: isoTime(0)
    });
    state.quotes.unshift(quote);
    state.lastQuoteId = quoteId;
    state.activity.unshift({
      id: id("act"),
      householdId: null,
      type: "Quote",
      text: "Maintenance quote drafted for " + quote.propertyName + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return quote;
  }

  /*
   * Accept a quote: turn it into the enrollment it always was.
   *
   * ONE CREATION PATH. This calls createEnrollment with the payload the quote
   * stored -- it does not build a household itself, and it does not re-price
   * anything. That is deliberate: a second way to create a household is a
   * second thing to keep in step with the first, and this codebase has already
   * paid for that mistake once with the two pricing engines this replaces.
   *
   * WHAT THE CUSTOMER HAS NOT DONE YET. A quote is sent without a card on file
   * and without the renewal authorization the enrolment form requires, because
   * demanding both to find out a price is absurd. So the converted household
   * lands with its payment profile "Pending setup" and acceptedTermsAt null --
   * which createEnrollment already models -- and this returns `needsPayment` so
   * the screen can say so rather than implying a signed, funded account.
   */
  function acceptQuote(quoteId) {
    const state = load();
    const quote = state.quotes.find(function (item) { return item.id === quoteId; });
    if (!quote) return { ok: false, message: "That quote is not on file." };
    /* Idempotent: a double-tap on Accept must not enroll the house twice. */
    if (quote.householdId) {
      return { ok: false, alreadyAccepted: true, householdId: quote.householdId,
               message: "This quote has already been converted to an enrollment." };
    }
    if (!quote.enrollment) {
      /* Quotes drafted before v0.9.23 hold a hand-built summary rather than an
         enrollment payload. Re-deriving one here would be inventing the second
         pricing engine this change exists to delete, so it refuses and says
         what to do instead. */
      return { ok: false, message: "This quote predates the current builder and has no enrollment "
                                 + "behind it. Rebuild it from the registration screen to convert it." };
    }
    const bundle = createEnrollment(quote.enrollment);
    if (!bundle || !bundle.household) {
      return { ok: false, message: "The enrollment could not be created from this quote." };
    }
    /* createEnrollment saved its own state, so re-read before touching ours. */
    const after = load();
    const stored = after.quotes.find(function (item) { return item.id === quoteId; });
    if (stored) {
      stored.status = "Accepted";
      stored.householdId = bundle.household.id;
      stored.acceptedAt = isoTime(0);
      stored.updatedAt = isoTime(0);
    }
    after.activity.unshift({
      id: id("act"),
      householdId: bundle.household.id,
      type: "Quote",
      text: quote.quoteNumber + " accepted and converted to an enrollment.",
      createdAt: isoTime(0)
    });
    save(after);
    const payment = (after.paymentProfiles || []).find(function (p) {
      return p.householdId === bundle.household.id;
    });
    return {
      ok: true,
      householdId: bundle.household.id,
      quote: stored || quote,
      needsPayment: !payment || payment.status !== "Ready",
      needsTerms: !quote.enrollment.acceptedTermsAt
    };
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

  /* =====================================================================
     EQUIPMENT DETAILS: WHAT IS MISSING, AND WRITING IN WHAT IS FOUND
     =====================================================================

     Cayden's workflow: a household enrolls with no brand on anything, the
     office is prompted to upload a sales invoice or key it manually, and by the
     time a technician opens the appliance the brand, model, serial and age are
     already there.

     `equipmentGaps` is the first half -- what the command center needs to ask
     for. `applyEquipmentDetails` is the second -- what a confirmed match writes.
     ================================================================== */

  /*
   * What this household still needs, and when it starts mattering.
   *
   * NOT a blocker, by Cayden's own call: "Nothing is blocked; it's a queue item
   * with a due date." Charging, scheduling and dispatch all proceed. The date is
   * the first uncompleted visit, because that is when not knowing starts costing
   * somebody something.
   */
  function equipmentGaps(state, householdId) {
    const assets = state.assets.filter(function (a) {
      return a.householdId === householdId && a.status !== "Removed";
    });
    /* HVAC systems carry a nameplate profile of their own and are read on site;
       they are not part of the invoice-enrichment loop. */
    const inScope = assets.filter(function (a) { return a.group !== "hvac"; });
    const missing = inScope.filter(function (a) {
      return !String(a.brand || "").trim() || !String(a.model || "").trim();
    });
    const undated = inScope.filter(function (a) { return !a.installYear; });
    /*
     * ON THE PLAN, AND WILSON CANNOT COVER IT.
     *
     * The guardrail's second surface, and the one that closes the loop. The
     * import screen warns while the office is looking at it; this is what keeps
     * asking after they clicked save. Cayden's call on the money was "Flag it,
     * no money math" -- so this names the appliance and the reason, and a person
     * works out the credit.
     *
     * It only counts appliances whose brand is actually KNOWN. An anonymous slot
     * is a missing-details problem, not a coverage problem.
     */
    const B = window.WILSON_BRANDS;
    const blocked = !B ? [] : inScope.filter(function (a) {
      if (!String(a.brand || "").trim()) return false;
      const s = B.serviceability(a);
      return s && (s.state === "not_serviced" || s.state === "not_maintainable");
    }).map(function (a) {
      return { asset: a, serviceability: B.serviceability(a) };
    });
    const nextVisit = state.visits
      .filter(function (v) { return v.householdId === householdId && v.status !== "Completed"; })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); })[0] || null;
    return {
      householdId: householdId,
      total: inScope.length,
      missing: missing.length,
      missingAssets: missing,
      undated: undated.length,
      blocked: blocked,
      blockedCount: blocked.length,
      complete: inScope.length > 0 && missing.length === 0 && blocked.length === 0,
      dueDate: nextVisit ? nextVisit.dueDate : "",
      visitId: nextVisit ? nextVisit.id : ""
    };
  }

  /*
   * Write a confirmed set of matches onto the household's appliances, park the
   * extras, and record the invoice that supplied it.
   *
   * `payload` is what the confirmation screen produced, not what the matcher
   * proposed -- the office may have unpicked, re-pointed or skipped any of it,
   * and this function deliberately has no opinion about that. It writes what a
   * person confirmed.
   *
   *   { householdId, invoiceRefs: [],
   *     confirm: [{ slotId, details: { brand: {value, source, ref, at}, ... } }],
   *     park:    [{ line, reason }] }
   *
   * Idempotent on the parked side by invoice number and model, so re-confirming
   * the same import does not park the same range four times.
   */
  function applyEquipmentDetails(payload) {
    const state = load();
    const householdId = payload && payload.householdId;
    const household = state.households.find(function (h) { return h.id === householdId; });
    if (!household) return { ok: false, message: "That household is not in the system." };
    if (!Array.isArray(state.parkedEquipment)) state.parkedEquipment = [];

    const at = isoTime(0);
    let written = 0;
    (payload.confirm || []).forEach(function (entry) {
      const asset = state.assets.find(function (a) {
        return a.id === entry.slotId && a.householdId === householdId;
      });
      if (!asset || !entry.details) return;
      if (!asset.detailProvenance) asset.detailProvenance = {};
      ["brand", "model", "serial"].forEach(function (field) {
        const d = entry.details[field];
        if (!d || !String(d.value || "").trim()) return;
        asset[field] = String(d.value).trim();
        asset.detailProvenance[field] = { source: d.source || "invoice", ref: d.ref || "", at: d.at || at };
        written += 1;
      });
      /* Age has its own provenance fields, older than this feature and used by
         the report and the score. It keeps them rather than gaining a second
         set that could disagree. */
      const year = entry.details.installYear;
      if (year && Number(year.value)) {
        asset.installYear = Number(year.value);
        asset.ageSource = year.source || "invoice";
        asset.ageSourceRef = year.ref || "";
        written += 1;
      }
      if (entry.sourceInvoice) asset.sourceInvoice = entry.sourceInvoice;
    });

    let parked = 0;
    (payload.park || []).forEach(function (entry) {
      const line = entry && entry.line;
      if (!line) return;
      const key = [householdId, line.invoiceNumber || "", line.model || "", line.description || ""].join("|");
      if (state.parkedEquipment.some(function (p) { return p.key === key; })) return;
      state.parkedEquipment.push({
        id: id("parked"),
        key: key,
        householdId: householdId,
        brand: line.brand || "",
        model: line.model || "",
        description: line.description || "",
        typeLabel: line.exactTypeLabel || line.customerCategory || "",
        customerCategory: line.customerCategory || "",
        area: line.area || "",
        installYear: line.installYear || null,
        invoiceNumber: line.invoiceNumber || "",
        reason: entry.reason || "",
        /* Whether Wilson could cover it if the customer asked -- so the office
           is never invited to sell a plan on a brand nobody services. */
        serviceable: entry.serviceable !== false,
        parkedAt: at
      });
      parked += 1;
    });

    (payload.invoiceRefs || []).forEach(function (ref) {
      if (!ref) return;
      if (!Array.isArray(household.invoiceRefs)) household.invoiceRefs = [];
      if (household.invoiceRefs.indexOf(ref) === -1) household.invoiceRefs.push(ref);
    });

    state.activity.unshift({
      id: id("act"),
      householdId: householdId,
      at: at,
      kind: "equipment",
      summary: "Equipment details updated" +
        (written ? " \u2014 " + written + " field" + (written === 1 ? "" : "s") + " written" : "") +
        (parked ? ", " + parked + " appliance" + (parked === 1 ? "" : "s") + " parked" : "")
    });
    save(state);
    return { ok: true, written: written, parked: parked, gaps: equipmentGaps(state, householdId) };
  }

  /* =====================================================================
     THE TECHNICIAN, STANDING IN FRONT OF THE MACHINE          (v0.9.35)
     =====================================================================

     Cayden: "the tech needs to be able to easily edit the pre filled info just
     in case its wrong. it wouldn't be surprising to me if i got sent to do
     maintenance on appliances the customer bought 6 years ago from us, but maybe
     they replaced the dishwasher in between with someone else. if the tech walks
     up to the dw in this instance and its different than what the tech tool is
     showing, they should be able to switch the details easily in the field."

     TWO ACTIONS, NOT ONE, AND THE DIFFERENCE IS NOT COSMETIC.

     A CORRECTION says the record was wrong about a machine that has been there
     all along. The history is this machine's history and stays.

     A REPLACEMENT says the machine itself is different. Its age resets, its
     expected life is recomputed from a different brand, and -- the part that
     matters -- its trend history CLOSES. Readings from the Bosch that left are
     not readings from the Miele that arrived, and comparing them produces a
     confident decline that never happened, on the one screen that turns a
     reading into a call to a customer.

     Offering one button for both is how that bug gets shipped: an "edit brand"
     affordance that quietly keeps the history is the natural thing to build and
     the wrong thing to have.
     ================================================================== */

  function assetById(state, assetId) {
    return state.assets.find(function (a) { return a.id === assetId; }) || null;
  }

  /* Shared writer. `source` is what makes a field's provenance honest later --
     a technician's correction outranks an invoice because they were looking at
     the machine. */
  function writeDetails(asset, details, source, ref, at) {
    let written = 0;
    if (!asset.detailProvenance) asset.detailProvenance = {};
    ["brand", "model", "serial"].forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(details, field)) return;
      const value = String(details[field] == null ? "" : details[field]).trim();
      /* A blank from the field means "leave it" for a correction. Clearing a
         value is what a replacement is for. */
      if (!value) return;
      if (value === String(asset[field] || "").trim()) return;
      asset[field] = value;
      asset.detailProvenance[field] = { source: source, ref: ref || "", at: at };
      written += 1;
    });
    return written;
  }

  /*
   * SAME MACHINE, WRONG RECORD.
   *
   * History is untouched: this is the appliance it always was, described better.
   */
  /*
   * WHERE THE APPLIANCE LIVES, SET BY SOMEBODY WHO HAS SEEN IT.  (v0.9.37)
   *
   * Cayden: "i dont think i want outdoor v indoor as a flag on the customer
   * side, but our tech or office should be able to flag it as outdoor."
   *
   * The default comes off the area name the customer typed at registration --
   * "Outdoor Kitchen" is outdoor, "Pool House" is not -- and that default is a
   * guess made from a label. This is how the guess gets corrected by the office
   * or by the technician standing in front of it, and the difference between
   * the two is recorded, because an outdoor install is worth years of expected
   * life and a customer is entitled to know who decided it.
   *
   * Passing `environment: null` CLEARS the flag and hands the appliance back to
   * the area-name default, which is the right way to undo a mistake -- pinning
   * "indoor" onto an appliance in the Outdoor Kitchen would be a second wrong
   * answer rather than no answer.
   */
  function setAssetEnvironment(payload) {
    const state = load();
    const asset = assetById(state, payload && payload.assetId);
    if (!asset) return { ok: false, message: "That appliance is not on this household." };
    const wanted = payload.environment === null || payload.environment === undefined || payload.environment === ""
      ? null : String(payload.environment).toLowerCase();
    if (wanted !== null && wanted !== "indoor" && wanted !== "outdoor") {
      return { ok: false, message: "An appliance is installed indoors or outdoors; nothing else." };
    }
    const source = payload.source === "tech" ? "tech" : "office";
    const before = window.WILSON_ENVIRONMENT ? window.WILSON_ENVIRONMENT.for(asset) : { id: "indoor", source: "default" };
    if ((asset.installEnvironment || null) === wanted) {
      return { ok: true, changed: false, environment: before };
    }
    if (wanted === null) {
      delete asset.installEnvironment;
      delete asset.installEnvironmentSource;
      delete asset.installEnvironmentAt;
      delete asset.installEnvironmentBy;
    } else {
      asset.installEnvironment = wanted;
      asset.installEnvironmentSource = source;
      asset.installEnvironmentAt = isoTime(0);
      asset.installEnvironmentBy = payload.by || (source === "tech" ? "Wilson technician" : "Wilson office");
    }
    const after = window.WILSON_ENVIRONMENT ? window.WILSON_ENVIRONMENT.for(asset) : { id: wanted || "indoor" };
    state.activity.unshift({
      id: id("act"), householdId: asset.householdId, type: "Equipment",
      text: [asset.brand, asset.model, asset.typeLabel].filter(Boolean).join(" ") +
            " recorded as installed " + after.id +
            (wanted === null ? " (flag cleared; back to the area default)" : "") +
            " by the " + (source === "tech" ? "technician" : "office") + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, changed: true, was: before, environment: after };
  }

  function correctAssetDetails(payload) {
    const state = load();
    const asset = assetById(state, payload && payload.assetId);
    if (!asset) return { ok: false, message: "That appliance is not on this household." };
    const at = isoTime(0);
    const who = payload.technician || "Wilson technician";
    const before = [asset.brand, asset.model, asset.serial].filter(Boolean).join(" · ");
    const written = writeDetails(asset, payload.details || {}, "tech", who, at);
    const year = Number((payload.details || {}).installYear);
    let ageChanged = false;
    if (year && year !== Number(asset.installYear)) {
      asset.installYear = year;
      asset.ageSource = "tech";
      asset.ageSourceRef = who;
      ageChanged = true;
    }
    if (!written && !ageChanged) return { ok: true, written: 0, message: "Nothing changed." };
    state.activity.unshift({
      id: id("act"), householdId: asset.householdId, at: at, kind: "equipment",
      summary: "Equipment details corrected in the field by " + who + " \u2014 " +
        asset.typeLabel + " (" + (asset.location || "no area") + ") was " + (before || "blank") +
        ", now " + [asset.brand, asset.model, asset.serial].filter(Boolean).join(" \u00b7 ")
    });
    save(state);
    return { ok: true, written: written + (ageChanged ? 1 : 0), asset: asset };
  }

  /*
   * A DIFFERENT MACHINE IN THE SAME PLACE.
   *
   * The appliance record survives -- it is the SLOT on the plan, and the
   * customer is paying for that slot -- but everything about the machine in it
   * is replaced, and its trend history is closed at today.
   *
   * The machine that left is kept on the record rather than overwritten. Cayden
   * sold the original; that it was replaced by somebody else is a fact about the
   * customer worth having, and losing it is how "we sold them this in 2019"
   * becomes unanswerable.
   */
  function replaceAssetMachine(payload) {
    const state = load();
    const asset = assetById(state, payload && payload.assetId);
    if (!asset) return { ok: false, message: "That appliance is not on this household." };
    const details = payload.details || {};
    if (!String(details.brand || "").trim() && !String(details.model || "").trim()) {
      return { ok: false, message: "A replacement needs at least a brand or a model." };
    }
    const at = isoTime(0);
    const today = isoDate(0);
    const who = payload.technician || "Wilson technician";

    if (!Array.isArray(asset.replacedMachines)) asset.replacedMachines = [];
    asset.replacedMachines.push({
      brand: asset.brand || "", model: asset.model || "", serial: asset.serial || "",
      installYear: asset.installYear || null,
      soldByWilson: asset.source === "invoice" || Boolean(asset.sourceInvoice),
      sourceInvoice: asset.sourceInvoice || "",
      retiredAt: today, retiredBy: who,
      note: payload.note || ""
    });

    /* Everything about the machine is cleared first, so a field the technician
       left blank reads as unknown rather than as the old machine's value. */
    asset.brand = String(details.brand || "").trim();
    asset.model = String(details.model || "").trim();
    asset.serial = String(details.serial || "").trim();
    asset.detailProvenance = {};
    ["brand", "model", "serial"].forEach(function (field) {
      /* `tech_new`, not `tech`: this is the first record of a machine nobody has
         described before, which is a different claim from a correction to a
         record that was already there. */
      if (asset[field]) asset.detailProvenance[field] = { source: "tech_new", ref: who, at: at };
    });
    const year = Number(details.installYear);
    asset.installYear = year || "";
    asset.ageSource = year ? "tech" : "unknown";
    asset.ageSourceRef = year ? who : "";
    /* It is no longer something Wilson sold, whatever the original was. */
    asset.sourceInvoice = "";
    asset.source = "tech";
    /*
     * THE LINE THAT CLOSES THE HISTORY. WILSON_TRENDS reads it and ignores every
     * report before it, so decline detection cannot compare two machines.
     */
    asset.lineageStartedAt = today;

    state.activity.unshift({
      id: id("act"), householdId: asset.householdId, at: at, kind: "equipment",
      summary: "Different machine found in the field by " + who + " \u2014 " +
        asset.typeLabel + " (" + (asset.location || "no area") + ") is now " +
        [asset.brand, asset.model].filter(Boolean).join(" ") +
        ". Trend history closed; readings start again from this visit."
    });
    save(state);
    return { ok: true, asset: asset, retired: asset.replacedMachines[asset.replacedMachines.length - 1] };
  }

  /*
   * THE LAUNCH GUARDRAIL.                                          (v0.9.49)
   *
   * Cayden: "it seems i can repeatedly click the launch appliance visit
   * button when in a customer file and launch a new appliance visit at any
   * time... the appliance visit will only launch if passes all checks, like
   * has been billed, epass ticket created, etc? if a visit was not fully
   * completed then obviously the button should work and take someone to the
   * ongoing visit."
   *
   * One decision, made here, rendered by the household page:
   *   resume  — field work already exists on an open visit; the button goes
   *             back into THAT visit, never a second one.
   *   launch  — the next open visit is billed (or bills at the visit by
   *             design, or costs nothing) AND has its service order, so a
   *             truck may roll.
   *   blocked — the button says exactly which office step is missing,
   *             because a disabled button with no reason is a support call.
   */
  function applianceVisitLaunch(householdId) {
    const state = load();
    const open = state.visits
      .filter(function (v) { return v.householdId === householdId && v.category === "appliance" && v.status !== "Completed"; })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (!open.length) return { mode: "none", reason: "There is no appliance field visit waiting for this household." };

    const inspections = state.techInspections || [];
    const inProgress = open.find(function (v) {
      return inspections.some(function (i) { return i.visitId === v.id; });
    });
    if (inProgress) {
      const scoped = scopedAssetsForVisit(state, inProgress);
      const done = scoped.filter(function (a) {
        return inspections.some(function (i) { return i.visitId === inProgress.id && i.assetId === a.id && i.complete; });
      }).length;
      return {
        mode: "resume", visit: inProgress,
        progress: { completed: done, total: scoped.length },
        reason: "Field work is underway — " + done + " of " + scoped.length + " appliance" + (scoped.length === 1 ? "" : "s") + " recorded. This button resumes that visit."
      };
    }

    const visit = open[0];
    const blockers = [];
    const pay = String(visit.paymentStatus || "");
    /* "Charge due at visit" legs (second icemaker visits) bill on site by
       design, and a $0 interval has nothing to bill — neither blocks. */
    const billed = Number(visit.amountToCharge || 0) <= 0
      || /^(Charged|Posted to AR|Paid|Included)/.test(pay)
      || pay === "Charge due at visit";
    if (!billed) blockers.push("the interval has not been billed" + (pay ? " (" + pay + ")" : ""));
    const so = String(visit.serviceOrderStatus || "");
    if (!so || /^Not created/.test(so)) blockers.push("no service order / ePass ticket has been created");
    if (blockers.length) {
      return {
        mode: "blocked", visit: visit,
        reason: "Blocked: " + blockers.join(", and ") + ". Run those from the command center queue, then launch."
      };
    }
    return { mode: "launch", visit: visit };
  }

  /*
   * FILTER VERIFICATION.
   *
   * Cayden: "filters would always be replaced during maintenance... instead
   * ... verifying what type of filter goes with what icemaker or filter."
   * The office's filter job is not chasing due dates (the visit handles
   * replacement); it is making sure the part number on file is RIGHT before
   * anyone orders material or prices a plan. Marking verified records who
   * confirmed it and when, and corrects the part number if the lookup
   * disagreed with what registration guessed.
   */
  function markFilterVerified(filterId, partNumber) {
    const state = load();
    const filter = (state.filters || []).find(function (f) { return f.id === filterId; });
    if (!filter) return { ok: false, message: "Filter record not found." };
    const oldPart = filter.partNumber || "";
    if (partNumber != null && String(partNumber).trim()) filter.partNumber = String(partNumber).trim();
    filter.verified = true;
    filter.verifiedOn = isoDate(0);
    if (filter.status === "Setup needed") filter.status = "Tracked";
    state.activity.unshift({
      id: id("act"),
      householdId: filter.householdId,
      type: "Filter verified",
      text: filter.filterType + " confirmed as " + filter.partNumber +
        (oldPart && oldPart !== filter.partNumber && oldPart !== "To verify" ? " (was " + oldPart + ")" : "") + ".",
      createdAt: isoTime(0)
    });
    save(state);
    return { ok: true, message: filter.filterType + " verified — " + filter.partNumber, filter: filter };
  }

  function unverifiedFilters() {
    const state = load();
    return (state.filters || []).filter(function (f) { return !f.verified; });
  }

  window.WilsonStore = {
    /* Exposed because the field tool had its OWN copy of this filter, and the
       two disagreed: the store excluded HVAC from every visit, and the field
       tool refused HVAC visits outright. One implementation, one answer. */
    scopedAssetsForVisit: function (visit) { return scopedAssetsForVisit(load(), visit); },
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
    saveTechInspection,
    saveWaterTest,
    waterTestsFor,
    waterFor,
    saveAssetDesign,
    getTechInspection,
    generateReportFromTechInspection,
    refreshVisitReportStatus,
    queueReportEmail,
    saveReport,
    getReport,
    saveQuote,
    getQuote,
    updateQuoteStatus,
    acceptQuote,
    equipmentGaps: function (householdId) { return equipmentGaps(load(), householdId); },
    applyEquipmentDetails,
    setAssetEnvironment,
    resolveFollowUp,
    markFollowUpQuoted,
    handFollowUpToApprovals,
    openFollowUps,
    quotedFollowUps,
    amendEnrollment,
    pendingAmendments,
    markAmendmentCharged,
    markFilterVerified,
    unverifiedFilters,
    applianceVisitLaunch,
    recordTempDispatch,
    correctAssetDetails,
    replaceAssetMachine,
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
