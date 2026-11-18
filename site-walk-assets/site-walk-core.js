/* =============================================================
   Wilson Site Walk — core
   Fractions, the Steel Cod spec library, spec-vs-field verdicts,
   the installation-basis guard, correction chips, state, photos.

   No DOM. The three surfaces (field / office / packet) all read
   from here so a number can only be computed one way.
   ============================================================= */
(function () {
  "use strict";

  /* ---------- statuses ----------------------------------------------------
     Four, deliberately. A field tech picking from six on a phone in bad
     light picks wrong. Amber is a builder correction (a condition of the
     property); red is something that stops the delivery until a person
     answers it — the same split the maintenance portal uses. */
  var STATUSES = [
    { k: "ready",    label: "Ready",    long: "Ready for set",         cls: "complete",  tone: "success", hint: "Meets spec" },
    { k: "verify",   label: "Verify",   long: "Verify at set",         cls: "in-progress", tone: "info",  hint: "Acceptable, recheck" },
    { k: "modify",   label: "Modify",   long: "Modification required", cls: "watch",     tone: "warning", hint: "Builder work" },
    { k: "decision", label: "Decision", long: "Response required",     cls: "action",    tone: "danger",  hint: "Builder answers" }
  ];
  var SK = {}; STATUSES.forEach(function (s) { SK[s.k] = s; });
  var DIMS = [{ k: "w", label: "Width" }, { k: "d", label: "Depth" }, { k: "h", label: "Height" }];
  /* A fourth measurement, off by default. Flush and inset details live or die
     on it — "approximately 2 1/8" face-to-cleat vs 2 3/16" shown" is the whole
     finding on the Palomino 48" — but on a standard opening there is nothing
     there to measure, and a fourth empty box on every card is how a tool
     starts feeling like paperwork. So it is a toggle. */
  var DIM4 = { k: "c", label: "Cleat setback", hint: "Finished face to the cleat or return" };
  function dimsFor(it) {
    var base = (it && it.planes4) ? DIMS.concat([DIM4]) : DIMS;
    /* a form relabels the three axes — a cooktop's "width" is a cutout, a
       hood's "height" is above the cooking surface — without changing keys */
    var f = it ? formOf(it) : null;
    /* a library variation can name its own axes — a rangetop's "height" is
       the countertop down to its platform, not a cavity */
    var vv = it ? itemVariation(it) : null, vd = (vv && vv.dims) || null;
    if ((!f || !f.dims) && !vd) return base;
    return base.map(function (d) {
      var o = (vd && vd[d.k]) || (f && f.dims && f.dims[d.k]);
      return o ? Object.assign({}, d, { label: o.label || d.label, datum: o.datum || "" }) : d;
    });
  }
  var RULES = { exact: "true", min: "min", max: "max", range: "min–max" };
  var DEF_TOL = 1 / 16;

  /* ---------- fraction math ---------------------------------------------
     A tech says "thirty-two and a half", writes 32 1/2, and a spreadsheet
     export says 32.5. All three have to mean the same number. */
  var UNI = { "¼": .25, "½": .5, "¾": .75, "⅓": 1 / 3, "⅔": 2 / 3, "⅕": .2, "⅖": .4, "⅗": .6, "⅘": .8, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": .125, "⅜": .375, "⅝": .625, "⅞": .875 };

  function parseIn(raw) {
    if (raw === 0) return 0;
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    s = s.replace(/[”"″']/g, " ").replace(/\b(?:in|inch|inches)\b/gi, " ");
    for (var ch in UNI) { s = s.split(ch).join(" " + UNI[ch] + " "); }
    s = s.replace(/(\d)\s*-\s*(\d+\s*\/)/g, "$1 $2");
    s = s.replace(/\s+/g, " ").trim();
    var m = s.match(/^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) { var w = parseFloat(m[1]); var f = parseFloat(m[2]) / parseFloat(m[3]); return w < 0 ? w - f : w + f; }
    m = s.match(/^(-?\d+)\s+(\d*\.\d+)$/);
    if (m) { var wi = parseFloat(m[1]); var fr = parseFloat(m[2]); return wi < 0 ? wi - fr : wi + fr; }
    m = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]) / parseFloat(m[2]);
    m = s.match(/^(-?\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]);
    return null;
  }

  function fmtIn(n, opts) {
    opts = opts || {};
    if (n == null || isNaN(n)) return "";
    var q = opts.mark === false ? "" : '"';
    var neg = n < 0; n = Math.abs(n);
    var den = 16, whole = Math.floor(n + 1e-9);
    var num = Math.round((n - whole) * den);
    if (num === den) { whole += 1; num = 0; }
    while (num && num % 2 === 0) { num /= 2; den /= 2; }
    var out;
    if (!num) out = String(whole);
    else if (!whole) out = num + "/" + den;
    else out = whole + " " + num + "/" + den;
    return (neg ? "−" : "") + out + q;
  }
  function fmtFrac(n) { return fmtIn(n, { mark: false }); }
  /* The required figure as it prints: one number, or the window the sheet
     allows ("34"–36"") when the axis has a maximum. */
  function specText(it, k) {
    var n = num(it.spec[k]);
    if (n == null) return "";
    var mx = it.specMax ? num(it.specMax[k]) : null;
    return mx != null && (it.rule && it.rule[k]) === "range" ? fmtIn(n) + "–" + fmtIn(mx) : fmtIn(n);
  }
  function fmtDelta(n) {
    if (n == null || isNaN(n)) return "";
    if (Math.abs(n) < 1e-9) return "on spec";
    return (n > 0 ? "+" : "−") + fmtIn(Math.abs(n));
  }
  function num(v) {
    if (v === 0) return 0;
    if (v == null || v === "") return null;
    var n = typeof v === "number" ? v : parseIn(v);
    return (n == null || isNaN(n)) ? null : n;
  }

  /* ---------- spec library ----------------------------------------------
     Openings read off the Steel Cod Full Spec Package. `page` cites where
     each number came from, because a dimension nobody can trace back is a
     dimension nobody will defend in front of a builder. */
  var MODELS = [
    {
      brand: "Sub-Zero", model: "DEU2450CI", prefix: "DEU2450CI", category: "refrigeration",
      appliance: "24\" undercounter refrigerator/freezer", pages: "pp.4–7",
      panelReady: true,
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A",
          where: "Inside the opening, 4\" up from the floor, 5\" in from the left side",
          zone: { kind: "point", x: 5, y: 4 },
          note: "Grounding prong to the right of the thinner blades." },
        { key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX",
          where: "Floor zone, 2\" in from each side, 4\" up; the area extends 1/2\" forward on the floor",
          zone: { kind: "rect", x0: 2, x1: { r: 2 }, y0: 0, y1: 4 } }
      ],
      variations: [{
        key: "standard", label: "Standard", page: "p.5",
        panel: { width: "23 3/4", height: "30 3/8", thickness: "5/8\" min to 3/4\" max", weight: "22 lb max", page: "p.6" },
        opening: { w: "24", d: "24", h: "34 1/2" }, rule: { w: "exact", d: "min", h: "min" },
        tells: ["Appliance panel sits proud of the cabinet faces", "No finished returns inside the opening"],
        requires: ["Add the dedicated 115 VAC 15 A circuit; outlet grounding prong to the right of the thinner blades."],
        notes: "Unit is 23 1/8\" deep before the panel — allow for panel thickness in the finished opening depth. Height dimensions ±1/2\"."
      }]
    },
    {
      brand: "Cove", model: "DW2451", prefix: "DW2451", category: "dishwasher",
      appliance: "24\" dishwasher — panel ready", pages: "pp.8–17",
      panelReady: true,
      utilities: [
        /* offPlane: these belong in the adjacent cabinet, not the plane of
           the dishwasher opening, so there is deliberately nothing to draw
           OR to declare on the photograph. Distinct from "no zone yet". */
        { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A", offPlane: true,
          where: "In the adjacent cabinet, either side — never directly behind the unit" },
        { key: "water", label: "Water supply", need: "5' braided tubing, 3/8\" female compression", offPlane: true,
          where: "Through the adjacent cabinet" },
        { key: "drain", label: "Drain", need: "5' corrugated tubing", offPlane: true,
          where: "Standpipe or disposer connection 20\" to 43\" above the floor" }
      ],
      variations: [
        {
          key: "24in", label: "24\" install", page: "p.11",
          opening: { w: "24", d: "24", h: "34 1/2" }, rule: { w: "exact", d: "min", h: "min" },
          panel: { width: "23 3/4", height: "30 3/8", thickness: "1/2\" min", weight: "20 lb max (under 18 lb optimal)", page: "p.16" },
          tells: ["Opening measures a true 24\" wide", "Panel ordered at 23 3/4\""],
          requires: ["Route plumbing and electrical through the adjacent sink cabinet — nothing directly behind the unit."],
          notes: "Reveals are larger than the 60 cm variation unless the panel width is adjusted. Unit adjusts 33 3/4\"–34 3/4\" tall; opening drawn at 34 1/2\"."
        },
        {
          key: "60cm", label: "60 cm install", page: "p.9",
          opening: { w: "23 5/8", d: "24", h: "34 1/2" }, rule: { w: "exact", d: "min", h: "min" },
          panel: { width: "23 3/8", height: "30 3/8", thickness: "1/2\" min", weight: "20 lb max (under 18 lb optimal)", page: "p.13" },
          tells: ["Opening measures 23 5/8\" wide", "60 cm panel and kickplate ordered"],
          requires: ["Route plumbing and electrical through the adjacent sink cabinet — nothing directly behind the unit."],
          notes: "Minimum reveals, intended for new construction. 60 cm panels and kickplate must be specified to match."
        }
      ]
    },
    {
      brand: "Wolf", model: "SPO3050TE/S/T", prefix: "SPO3050", category: "ovens",
      appliance: "30\" E Series transitional speed oven", pages: "pp.18–21",
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 240/208 VAC, 15 A, NEMA 6-20R",
          where: "Anywhere within the opening", zone: { kind: "any" } }
      ],
      variations: [
        {
          key: "flush", label: "Flush inset", page: "p.19",
          opening: { w: "30 1/8", d: "24", h: "18 1/8" }, rule: { w: "min", d: "min", h: "min" },
          tells: ["Finished cleats inside the opening, finished to match the cabinetry", "Oven face sits in plane with the cabinet fronts"],
          requires: ["Add finished cleats inside the opening — they are visible and must match the cabinetry.",
                     "Add the dedicated 240/208 VAC 15 A supply, NEMA 6-20R, inside the opening."],
          notes: "Flush width and height are drawn as minimum-reveal dimensions."
        },
        {
          key: "standard", label: "Standard", page: "p.21",
          opening: { w: "22 1/8", d: "23", h: "17 11/16" }, rule: { w: "exact", d: "min", h: "exact" },
          tells: ["Oven frame overlaps the cabinet cutout", "No finished cleats inside the opening"],
          requires: ["Add the dedicated 240/208 VAC 15 A supply, NEMA 6-20R, inside the opening."],
          notes: "24\" and 30\" models require the same opening. The frame covers the cutout, so the cutout is not the appliance width."
        }
      ]
    },
    {
      brand: "Sub-Zero", model: "CL4850SID/O", prefix: "CL4850", category: "refrigeration",
      appliance: "48\" classic side-by-side refrigerator/freezer", pages: "pp.31–45",
      panelReady: true,
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A",
          where: "Right side of the opening, 6\" in and 75 1/2\" up from the floor",
          zone: { kind: "point", x: { r: 6 }, y: 75.5 } },
        { key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX",
          where: "Right side of the opening, 18\" in, 6\" wide, 3\" up; extends 1/2\" forward on the floor",
          zone: { kind: "rect", x0: { r: 24 }, x1: { r: 18 }, y0: 0, y1: 3 } }
      ],
      variations: [
        {
          key: "flush-inset", label: "Flush inset", page: "p.33",
          opening: { w: "50", d: "26 3/16", h: "84" }, rule: { w: "exact", d: "min", h: "min" },
          tells: ["Finished cleats and a 5 11/16\" finished return inside the opening",
                  "Door and drawer panels sit in plane with the cabinet faces",
                  "Flush inset grille ordered for the 84\" opening"],
          requires: ["Add finished cleats and returns inside the opening, finished to match the cabinetry.",
                     "Add the dedicated 115 VAC 15 A circuit; water supply in the illustrated floor zone."],
          notes: "Finished return 2 3/16\" from the face, then a 1 1/4\" cleat 3 1/2\" deep (5 11/16\" finished in all); 47 1/2\" between the cleats. The 3/4\" typical is the cabinet side. Reveals 1/4\" and 1 7/16\" as drawn.",
          /* the Design Guide's flush inset detail (p.11 / p.13): the side
             return is finished 2 3/16" back from the face, then a 1 1/4"
             cleat runs 3 1/2" deep behind it, full height — 5 11/16"
             finished in all. The 3/4" "typical" on the detail is the
             cabinet side, not the cleat. 50" less two 1 1/4" cleats is the
             47 1/2" standard opening the 48" body sits in (Cayden, 26 Oct,
             marking up the detail) */
          prep: [
            { kind: "return", label: "Finished return", strip: { face: "both", setbackIn: "0", runIn: "2 3/16" }, finished: true, note: "face to the cleat — 5 11/16\" finished in all with the cleat, visible beside the door" },
            { kind: "cleat", label: "Finished cleat", strip: { face: "both", setbackIn: "2 3/16", runIn: "3 1/2", thicknessIn: "1 1/4" }, finished: true, note: "the body registers against them — 47 1/2\" between" }
          ]
        },
        {
          key: "standard", label: "Standard", page: "p.36",
          opening: { w: "47 1/2", d: "24", h: "83 3/4" }, rule: { w: "exact", d: "min", h: "min" },
          tells: ["Unit and grille sit proud of the cabinet faces", "3 1/2\" finished return only, no flush cleats"],
          requires: ["Add the dedicated 115 VAC 15 A circuit; water supply in the illustrated floor zone."],
          notes: "3 1/2\" finished returns will be visible and should be finished to match the cabinetry.",
          prep: [
            { kind: "return", label: "Finished return", strip: { face: "both", setbackIn: "0", runIn: "3 1/2" }, finished: true, note: "visible beside the door — finish to match the cabinetry" }
          ]
        }
      ]
    },
    {
      brand: "True", model: "TUR-24-L-OP-C", prefix: "TUR-24", category: "refrigeration",
      appliance: "24\" overlay undercounter refrigerator", pages: "pp.55–56",
      variations: [{
        key: "overlay", label: "Overlay / integrated", page: "p.56",
        opening: { w: "24", d: "24", h: "34 1/2" }, rule: { w: "min", d: "min", h: "min" },
        tells: ["Zero-clearance hinging with an overlay panel on the door"], requires: [],
        notes: "All three rough opening dimensions are minimums. Unit is 23 7/8\" × 34 1/4\" × 23 7/8\"; drawing shown with a 3/4\" cabinetry panel."
      }]
    },
    {
      brand: "True", model: "TUF-24-R-OP-C", prefix: "TUF-24", category: "refrigeration",
      appliance: "24\" overlay undercounter freezer", pages: "pp.57–58",
      variations: [{
        key: "overlay", label: "Overlay / integrated", page: "p.58",
        opening: { w: "24", d: "24", h: "34 1/2" }, rule: { w: "min", d: "min", h: "min" },
        tells: ["Zero-clearance hinging with an overlay panel on the door"],
        requires: ["Add anti-condensation pads if specified."],
        notes: "All three rough opening dimensions are minimums. Unit is 23 7/8\" × 34 1/4\" × 23 7/8\"."
      }]
    },
    {
      brand: "True", model: "GDM-23FC-HC~TSL01", prefix: "GDM-23FC", category: "merchandiser",
      appliance: "Glass door floral case — one swing door", pages: "GDM-23FC-HC~TSL01 spec sheet, 2 pp.",
      /* A free-standing merchandiser, so there is no rough opening and no
         panel. What has to be verified is the clear space it will stand in,
         the circuit, and the air the bottom-mounted condenser needs. */
      freestanding: true,
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 115/60/1, 15 A, NEMA 5-15R",
          where: "Within reach of the 9 ft factory cord, measured to the unit position",
          note: "Unit draws 5.4 A, 1/3 HP. Cord and plug supplied; do not extend it." },
        { key: "air", label: "Condenser air", need: "Clear air at the bottom front louvre",
          where: "Across the full width of the base grille, front of the unit",
          fixMissing: "Clear the bottom front louvre so the condenser can breathe — nothing stacked, shelved or built against the base grille.",
          fixMisplaced: "Reduce the restriction at the bottom front louvre — the condenser needs clear air across the full base grille.",
          note: "Bottom-mounted condensing unit breathes through the front. Nothing may be stacked or built against it." }
      ],
      variations: [{
        key: "freestanding", label: "Free-standing — clear space", page: "p.1 chart, p.2 elevation",
        /* Minimums, not a cutout: more space is always fine. Width and height
           are the p.1 rough-in chart (rounded up to the nearest 1/8"); depth
           is the p.2 right-side view, which dimensions the total including
           the door handle and the rear projection as 31 19/32". The chart
           footnote gives 29 7/8" excluding a 1 5/8" handle, i.e. 31 1/2" —
           the drawing is the larger of the two, so the drawing governs. */
        opening: { w: "27", d: "31 19/32", h: "78 5/8" },
        rule: { w: "min", d: "min", h: "min" },
        tells: ["Free-standing cabinet on leg levelers, not built in",
                "Louvered condenser grille across the bottom front",
                "Illuminated sign panel above the glass door"],
        requires: ["Confirm the door swing clears the aisle and any adjacent fixture.",
                   "Keep the bottom front grille clear; the condenser breathes there.",
                   "Level the floor across the opening."],
        notes: "Cabinet 26 31/32\" W × 29 11/16\" D × 78 5/16\" H to the cabinet top (p.2); overall depth 31 19/32\" including the 1 15/32\" handle and 15/32\" rear projection, overall height 78 1/2\" including the 3/16\" floor gap. The p.1 chart rounds to 27 × 29 7/8 × 78 5/8 and its height is 1/8\" above the drawing — verify against the sheet before this is used to reject an opening. Self-contained R290, no plumbing and no drain. 355 lb crated: check the delivery path and floor. Interior clear height 55 1/4\" (section). Two adjustable shelves 22 9/16\" × 23 1/4\"."
      }]
    },
    {
      brand: "LG", model: "WKEX300HBA", prefix: "WKEX300", category: "laundry_center", freestanding: true,
      measure: true,
      appliance: "WashTower — single unit washer/dryer", pages: "pp.46–52",
      variations: [{
        key: "freestanding", label: "Freestanding / closet", page: "pp.46–52", noOpening: true,
        opening: {}, rule: {}, tells: [], requires: [],
        notes: "Manufacturer manual — no rough opening. Verify closet ventilation, exhaust routing and how far the unit projects past the cabinet faces."
      }]
    },
    {
      brand: "LG", model: "WM6500HWA", prefix: "WM6500", category: "washer", freestanding: true,
      /* Front-load sets go under a counter often enough that "no rough
         opening on paper" cannot mean "do not measure the space". */
      measure: true,
      appliance: "5.0 cu. ft. front load washer", pages: "pp.22–25",
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 120 V outlet", where: "Within reach of the unit position" },
        { key: "water", label: "Hot and cold supply", need: "Both valves", where: "Behind the unit position" },
        { key: "drain", label: "Standpipe / drain", need: "Standpipe or floor drain", where: "Behind the unit position" }
      ],
      variations: [{ key: "freestanding", label: "Freestanding / closet", page: "pp.22–25", noOpening: true, opening: {}, rule: {}, tells: [], requires: [],
        notes: "Manufacturer manual — no rough opening. Verify the standpipe / floor drain and closet or recess clearances." }]
    },
    {
      brand: "LG", model: "DLEX6500W", prefix: "DLEX6500", category: "dryer", freestanding: true,
      measure: true,
      appliance: "7.4 cu. ft. electric dryer", pages: "pp.26–30",
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 240 V circuit", where: "Within reach of the unit position" },
        { key: "vent", label: "Dryer exhaust", need: "4\" rigid or semi-rigid duct", where: "Recessed behind the unit position" }
      ],
      variations: [{ key: "freestanding", label: "Freestanding / closet", page: "pp.26–30", noOpening: true, opening: {}, rule: {}, tells: [], requires: [],
        notes: "Manufacturer manual — no rough opening. Closet installs need the upper 48 sq. in. and lower 24 sq. in. vent openings and a 39\" cabinet opening height." }]
    },
    {
      brand: "LG", model: "MSER0990S", prefix: "MSER0990", category: "microwave", freestanding: true,
      appliance: "0.9 cu. ft. countertop microwave", pages: "pp.53–54",
      variations: [{ key: "countertop", label: "Countertop", page: "pp.53–54", noOpening: true, opening: {}, rule: {}, tells: [], requires: [],
        notes: "Countertop appliance, no trim kit. Exterior 18\" × 11\" × 14 1/2\". Keep 4\" clearance at the top, sides and back, on a dedicated 15–20 A outlet." }]
    }
  ];

  /* ---------- the Sub-Zero Design Guide (revised 1/2025) ------------------
     Cayden, 26 Oct: "This subzero design guide may help with more than just
     this fridge." Every Classic, PRO, Designer, wine, undercounter and ice
     model in the guide, with its openings, connection zones, finished
     returns and cleats, panels and dual notes — each number with the guide
     page it came from. The two models already in the library from the
     Steel Cod package (CL4850SID/O, DEU2450CI) keep their own entries; the
     guide corrected two of their zones (below). Which models take water is
     read from the model letters the guide uses — FI/CI (ice maker), ID
     (internal dispenser), the freezers, over-and-unders, French doors and
     side-by-sides — and says so in the note, to be confirmed against the
     model's own sheet. */
  var SZG = "Sub-Zero Design Guide 1/2025";
  function szReturn(faces, run, note, shift) {
    return faces.map(function (f) {
      var st = { face: f, setbackIn: "0", runIn: run || "3 1/2" };
      if (shift) st.panelShift = shift;        /* the return in front of a flush cleat grows with the panel */
      return { kind: "return", label: "Finished return", strip: st, finished: true,
        note: note || "visible beside the door — finish to match the cabinetry" };
    });
  }
  var SZ_CLASSIC_POWER = { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A",
    where: "Right side of the opening: 6\" wide from the right side, 7\" tall, starting 75 1/2\" up from the floor",
    zone: { kind: "rect", x0: { r: 6 }, x1: { r: 0 }, y0: 75.5, y1: 82.5 }, note: "3-prong grounding receptacle. GFCI not recommended — it may interrupt operation." };
  var SZ_CLASSIC_WATER = { key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX · 35–120 psi · 36\" excess line",
    where: "Floor zone at the right: 18\" wide, ending 6\" from the right side, 3\" up; extends 1/2\" forward on the floor",
    zone: { kind: "rect", x0: { r: 24 }, x1: { r: 6 }, y0: 0, y1: 3 },
    note: "Shutoff easily accessible; no self-piercing valves; must not interfere with the anti-tip brackets." };
  /* Designer columns, tall and drawers: the receptacle low at the left, the
     water low at the right, both sized by the unit's width (pp.47–48) */
  var SZ_DESIGNER_POWER_A = { 18: 6, 24: 9.5, 27: 11, 30: 12.5, 36: 15.5 };
  var SZ_DESIGNER_WATER_A = { 18: 3, 24: 5.5, 30: 6, 36: 9 };
  function szDesignerPower(w, outdoor) {
    var a = SZ_DESIGNER_POWER_A[w];
    return { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A" + (outdoor ? ", GFCI" : ""),
      where: "Low at the left: starting 4 1/2\" in from the left side, " + fmtIn(a) + " wide, within 4 1/4\" of the floor",
      zone: { kind: "rect", x0: 4.5, x1: 4.5 + a, y0: 0, y1: 4.25 },
      note: "3-prong grounding receptacle, grounding prong to the right of the thinner blades. " + (outdoor ? "Outdoor: GFCI required." : "GFCI not recommended.") };
  }
  function szDesignerWater(w) {
    var a = SZ_DESIGNER_WATER_A[w];
    return { key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX · 35–120 psi · 36\" excess line",
      where: "Floor zone at the right: " + fmtIn(a) + " wide, ending 6\" from the right side, 3\" up; extends 1/2\" forward on the floor",
      zone: { kind: "rect", x0: { r: 6 + a }, x1: { r: 6 }, y0: 0, y1: 3 },
      note: "Shutoff easily accessible; must not interfere with the anti-tip bracket." };
  }
  var SZ_UC_POWER = { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A",
    where: "Low in the opening: from 5\" in from the left side to 2\" from the right side, within 4\" of the floor",
    zone: { kind: "rect", x0: 5, x1: { r: 2 }, y0: 0, y1: 4 },
    note: "3-prong grounding receptacle, grounding prong to the right of the thinner blades. GFCI not recommended indoors; required on outdoor models." };
  function szClassic(model, prefix, appliance, nominal, water, extra) {
    extra = extra || {};
    var std = { 30: "29 1/2", 36: "35 1/2", 42: "41 1/2", 48: "47 1/2" }[nominal], fl = { 30: "32", 36: "38", 42: "44", 48: "50" }[nominal];
    var utils = [SZ_CLASSIC_POWER].concat(water ? [SZ_CLASSIC_WATER] : []);
    return {
      brand: "Sub-Zero", model: model, prefix: prefix, category: extra.category || "refrigeration", appliance: appliance, pages: SZG + " " + (extra.pages || "pp.3–33"),
      panelReady: true, source: SZG, utilities: utils,
      /* the quote's finish suffix: /O takes the cabinet's panels; /S and /P
         are stainless (tubular or pro handle) and take none (v0.9.79) */
      suffixes: { O: { panelReady: true, label: "overlay" }, S: { panelReady: false, label: "stainless" }, P: { panelReady: false, label: "stainless, pro handle" } },
      variations: [
        { key: "flush-inset", label: "Flush inset", page: extra.flushPage || "p.11",
          onlySuffix: ["O"], onlyWhy: "Flush inset is for overlay models only",
          opening: { w: fl, d: "26 3/16", h: "84" }, rule: { w: "exact", d: "min", h: "min" },
          panel: { thickness: "3/4\" (the cleat setback assumes it)", weight: extra.panelWeight || "50 lb max per panel; grille 13 lb", page: "p.16" },
          tells: ["Finished cleats inside the opening, 2 3/16\" back from the face", "Door and grille panels sit in plane with the cabinet faces"],
          requires: ["Add finished returns and 1 1/4\" × 3 1/2\" finished cleats inside the opening, finished to match the cabinetry."],
          notes: "Flush inset is for overlay models only and assumes a 3/4\" panel; a thicker panel moves the cleats back and may need the 90° door stop (p.31). Add 1/2\" to the door clearance dimensions. " +
            fl + "\" less two 1 1/4\" cleats is the " + std + "\" the unit sits in.",
          panelRule: { assumedIn: 0.75, minIn: extra.panelMin || 0.75, page: "p.31" },
          prep: szReturn(["both"], "2 3/16", "face to the cleat — 5 11/16\" finished in all with the cleat, visible beside the door", "runIn").concat([
            { kind: "cleat", label: "Finished cleat", strip: { face: "both", setbackIn: "2 3/16", runIn: "3 1/2", thicknessIn: "1 1/4", panelShift: "setbackIn" }, finished: true, note: "the unit registers against them" }]) },
        { key: "standard", label: "Standard", page: extra.stdPage || "p.10",
          opening: { w: std, d: "24", h: "83 3/4" }, rule: { w: "exact", d: "min", h: "min" },
          panel: { thickness: "3/4\" overlay + .10\" spacer + 1/4\" backer", weight: extra.panelWeight || "50 lb max per panel; grille 13 lb", page: "p.16" },
          tells: ["Unit and grille sit proud of the cabinet faces", "3 1/2\" finished returns only, no cleats"],
          requires: ["Finish the 3 1/2\" returns on both sides to match the cabinetry — they are visible."],
          notes: "3 1/2\" finished returns will be visible. Framed cabinets need finished filler behind the face frame. Height ±1/2\".",
          panelRule: { assumedIn: 0.75, minIn: extra.panelMin || 0.75, page: "p.29" },
          prep: szReturn(["both"]) }
      ],
      waterNote: water ? "" : "No water connection — this model has no ice maker or dispenser (confirm on the model's sheet)."
    };
  }
  function szPro(model, prefix, appliance, nominal) {
    var std = { 36: "35 1/2", 48: "47 1/2" }[nominal], fl = { 36: "36", 48: "48" }[nominal];
    var water = { key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX · 35–120 psi · 36\" excess line",
      where: "Floor zone at the right: 6\" wide, ending 5 3/16\" from the right side, 3\" up; extends 1/2\" forward on the floor",
      zone: { kind: "rect", x0: { r: 5 + 3 / 16 + 6 }, x1: { r: 5 + 3 / 16 }, y0: 0, y1: 3 },
      note: "Shutoff easily accessible; must not interfere with the anti-tip bracket. With reverse osmosis, bypass the filter." };
    return {
      brand: "Sub-Zero", model: model, prefix: prefix, category: "refrigeration", appliance: appliance, pages: SZG + " pp.34–41",
      panelReady: false, source: SZG, utilities: [SZ_CLASSIC_POWER, water],
      variations: [
        { key: "flush", label: "Flush", page: "p.37", opening: { w: fl, d: "26", h: "84 1/8" }, rule: { w: "exact", d: "min", h: "min" },
          tells: ["Face frame flush with the surrounding cabinetry"], requires: ["Finish the 3 1/2\" returns on both sides to match the cabinetry."],
          notes: "Stainless — no custom panels.", prep: szReturn(["both"]) },
        { key: "standard", label: "Standard", page: "p.37", opening: { w: std, d: "24", h: "83 3/4" }, rule: { w: "exact", d: "min", h: "min" },
          tells: ["Face frame stands 2\" beyond the cabinetry"], requires: ["Finish the 3 1/2\" returns on both sides to match the cabinetry."],
          notes: "In a standard install the face frame extends 2\" beyond the cabinetry.", prep: szReturn(["both"]) }
      ]
    };
  }
  function szDesigner(model, prefix, appliance, w, kind, water, extra) {
    extra = extra || {};
    var outdoor = !!extra.outdoor, h = kind === "drawer" ? "34 1/2" : "84";
    var utils = [szDesignerPower(w, outdoor)].concat(water ? [szDesignerWater(w)] : []);
    var ret = outdoor ? "4 1/2" : "3 1/2";
    return {
      brand: "Sub-Zero", model: model, prefix: prefix, category: extra.category || "refrigeration", appliance: appliance, pages: SZG + " " + (extra.pages || "pp.42–53"),
      panelReady: !outdoor, source: SZG, utilities: utils,
      variations: [{
        key: "standard", label: "Designer · integrated", page: extra.page || "p.46",
        opening: { w: String(w), d: outdoor ? "25 3/4" : "25", h: h }, rule: { w: "exact", d: "min", h: "min" },
        panel: outdoor ? { thickness: "1 1/2\" Sub-Zero outdoor stainless panels required", page: "p.49" }
          : { thickness: "5/8\" min (more is fine within the weight)", weight: extra.panelWeight || "", page: "p.49" },
        panelRule: outdoor ? null : { assumedIn: 0.75, minIn: 0.625, unitDepthIn: 24, faceFlush: true, page: extra.panelPage || "p.49" },
        tells: [ret + "\" finished returns on all sides", "Panels in plane with the cabinet faces, 1/8\" reveals"],
        requires: ["Finish the " + ret + "\" returns on all sides to match the cabinetry."],
        notes: "Unit is 24\" deep before the panel — the opening depth allows for it. Toe kick 2\"–6\" off the floor; 2\"–3 7/8\" needs the reduced toe-kick accessory (sales). " +
          "Dual: openings add; without the dual kit a 2\" filler strip is required." + (outdoor ? " Outdoor: GFCI required." : "") + (extra.note ? " " + extra.note : ""),
        prep: szReturn(["both", "top"], ret)
      }],
      waterNote: water ? "" : "No water connection on this model (confirm on the model's sheet)."
    };
  }
  function szUndercounter(model, prefix, appliance, w, h, water, extra) {
    extra = extra || {};
    var utils = [SZ_UC_POWER].concat(water ? [{ key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX · 35–120 psi · 5' excess line",
      where: "Floor zone, 2\" in from each side, 4\" up; extends 1/2\" forward on the floor", zone: { kind: "rect", x0: 2, x1: { r: 2 }, y0: 0, y1: 4 },
      note: "Recess the shutoff into the wall or put it in the adjacent cabinet." }] : []);
    return {
      brand: "Sub-Zero", model: model, prefix: prefix, category: extra.category || "refrigeration", appliance: appliance, pages: SZG + " " + (extra.pages || "pp.84–91"),
      panelReady: true, source: SZG, utilities: utils,
      variations: [{
        key: "standard", label: "Undercounter", page: extra.page || "p.86",
        opening: { w: String(w), d: "24", h: h }, rule: { w: "exact", d: "min", h: "min" },
        panel: { thickness: "5/8\" min – 3/4\" max", weight: w >= 24 ? "22 lb max" : "15 lb max", page: extra.panelPage || "p.89" },
        panelRule: { assumedIn: 0.75, minIn: 0.625, maxIn: 0.75, unitDepthIn: 23.125, faceFlush: true, page: extra.panelPage || "p.89" },
        tells: ["3 1/2\" finished returns on all sides"], requires: ["Finish the 3 1/2\" returns on all sides to match the cabinetry."],
        notes: "Unit is 23 1/8\" deep before the panel. Kick 2\"–4 1/2\" off the floor. Dual: 15+15 = 30\", 15+24 = 39\", 24+24 = 48\" with the dual kit; otherwise a 2\" filler strip." +
          (extra.note ? " " + extra.note : ""),
        prep: szReturn(["both", "top"])
      }],
      waterNote: water ? "" : "No water connection on this model."
    };
  }
  function szIce(model, prefix, appliance, pump, outdoor) {
    return {
      brand: "Sub-Zero", model: model, prefix: prefix, category: "icemaker", appliance: appliance, pages: SZG + " pp.92–95", panelReady: !outdoor, source: SZG,
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A" + (outdoor ? ", GFCI" : ""), offPlane: true,
          where: "In the adjacent cabinet, either side — not behind the unit", note: "3-prong grounding receptacle, grounding prong to the right of the thinner blades. " + (outdoor ? "Outdoor: GFCI required." : "GFCI not recommended.") },
        { key: "water", label: "Water supply", need: "1/4\" OD copper, braided stainless or PEX · 20–80 psi · 36\" excess line",
          where: "On the floor, 1/2\" out from the back wall and 8\" from the right side", zone: { kind: "point", x: { r: 8 }, y: 0 },
          note: "Recess the shutoff into the wall or put it in the adjacent cabinet. In-line filter where sediment is high." },
        { key: "drain", label: "Drain", need: pump ? "Drain pump model — the pump lifts to a drain within reach" : "Gravity drain: 1/4\" per 12\" fall, air gap likely; a standpipe with a trap is acceptable",
          offPlane: true, where: pump ? "A drain or standpipe the pump hose reaches" : "Below the unit's outlet so the line falls 1/4\" per foot all the way",
          note: "The drain and water tubes are plumbed before the unit is connected." }
      ],
      variations: [{
        key: "standard", label: "Undercounter", page: "p.93", opening: { w: "15 1/4", d: "24", h: "34 1/2" }, rule: { w: "exact", d: "min", h: "min" },
        panel: outdoor ? { thickness: "Sub-Zero outdoor stainless panel", page: "p.95" } : { width: "15", height: "30 3/8", thickness: "5/8\" min – 3/4\" max", weight: "15 lb max", page: "p.95" },
        panelRule: outdoor ? null : { assumedIn: 0.75, minIn: 0.625, maxIn: 0.75, unitDepthIn: 23, faceFlush: true, page: "p.95" },
        tells: ["3 1/2\" finished returns on all sides"], requires: ["Finish the 3 1/2\" returns on all sides to match the cabinetry."],
        notes: "Unit is 23\" deep before the panel." + (outdoor ? " Outdoor: GFCI required." : ""),
        prep: szReturn(["both", "top"])
      }]
    };
  }
  /* Panel weights from p.16 (Classic), p.49 (Designer), p.69 (wine) */
  var SZ_GUIDE_MODELS = [
    szClassic("CL3650R", "CL3650R", "36\" Classic all-refrigerator column", 36, false, { panelWeight: "75 lb max per panel; grille 13 lb" }),
    szClassic("CL3650RID", "CL3650RID", "36\" Classic all-refrigerator column, internal dispenser", 36, true, { panelWeight: "75 lb max per panel; grille 13 lb" }),
    szClassic("CL3650RG", "CL3650RG", "36\" Classic all-refrigerator column, glass door", 36, false, { panelWeight: "75 lb max per panel; grille 13 lb" }),
    szClassic("CL3650F", "CL3650F", "36\" Classic all-freezer column", 36, true, { panelWeight: "75 lb max per panel; grille 13 lb" }),
    szClassic("CL3050U", "CL3050U", "30\" Classic over-and-under refrigerator/freezer", 30, true),
    szClassic("CL3050UG", "CL3050UG", "30\" Classic over-and-under, glass door", 30, true),
    szClassic("CL3650U", "CL3650U", "36\" Classic over-and-under refrigerator/freezer", 36, true),
    szClassic("CL3650UG", "CL3650UG", "36\" Classic over-and-under, glass door", 36, true),
    szClassic("CL3650UFD", "CL3650UFD", "36\" Classic French door refrigerator/freezer", 36, true),
    szClassic("CL4250UFD", "CL4250UFD", "42\" Classic French door refrigerator/freezer", 42, true),
    szClassic("CL4850UFD", "CL4850UFD", "48\" Classic French door refrigerator/freezer", 48, true),
    szClassic("CL4250S", "CL4250S", "42\" Classic side-by-side refrigerator/freezer", 42, true),
    szClassic("CL3050W", "CL3050W", "30\" Classic wine storage column", 30, false, { category: "wine", pages: "pp.54–83", stdPage: "p.62", flushPage: "p.63", panelWeight: "75 lb max per door; grille 13 lb", panelMin: 0.625 }),
    szPro("PRO3650", "PRO3650", "36\" PRO refrigerator/freezer — stainless", 36),
    szPro("PRO4850", "PRO4850", "48\" PRO refrigerator/freezer — stainless", 48),
    szDesigner("DEC1850FI", "DEC1850F", "18\" Designer freezer column with ice maker", 18, "column", true, { panelWeight: "45 lb max per panel" }),
    szDesigner("DEC2450R", "DEC2450R", "24\" Designer refrigerator column", 24, "column", false, { panelWeight: "60 lb max per panel" }),
    szDesigner("DEC2450FI", "DEC2450F", "24\" Designer freezer column with ice maker", 24, "column", true, { panelWeight: "60 lb max per panel" }),
    szDesigner("DEC3050R", "DEC3050R", "30\" Designer refrigerator column", 30, "column", false, { panelWeight: "75 lb max per panel" }),
    szDesigner("DEC3050RID", "DEC3050RID", "30\" Designer refrigerator column, internal dispenser", 30, "column", true, { panelWeight: "75 lb max per panel" }),
    szDesigner("DEC3050FI", "DEC3050F", "30\" Designer freezer column with ice maker", 30, "column", true, { panelWeight: "75 lb max per panel" }),
    szDesigner("DEC3650R", "DEC3650R", "36\" Designer refrigerator column", 36, "column", false, { panelWeight: "75 lb max per panel" }),
    szDesigner("DEC3650RID", "DEC3650RID", "36\" Designer refrigerator column, internal dispenser", 36, "column", true, { panelWeight: "75 lb max per panel" }),
    szDesigner("DEC3650FI", "DEC3650F", "36\" Designer freezer column with ice maker", 36, "column", true, { panelWeight: "75 lb max per panel" }),
    szDesigner("DET3050R", "DET3050R", "30\" Designer tall refrigerator with freezer drawers", 30, "tall", false, { panelWeight: "50 lb door; drawers 15 lb" }),
    szDesigner("DET3050RID", "DET3050RID", "30\" Designer tall refrigerator with freezer drawers, internal dispenser", 30, "tall", true, { panelWeight: "50 lb door; drawers 15 lb" }),
    szDesigner("DET3050CI", "DET3050CI", "30\" Designer tall convertible with ice maker", 30, "tall", true, { panelWeight: "50 lb door; drawers 15 lb" }),
    szDesigner("DET3050FI", "DET3050F", "30\" Designer tall freezer with ice maker", 30, "tall", true, { panelWeight: "50 lb door; drawers 15 lb" }),
    szDesigner("DET3650R", "DET3650R", "36\" Designer tall refrigerator with freezer drawers", 36, "tall", false, { panelWeight: "60 lb door; drawers 15 lb" }),
    szDesigner("DET3650RID", "DET3650RID", "36\" Designer tall refrigerator with freezer drawers, internal dispenser", 36, "tall", true, { panelWeight: "60 lb door; drawers 15 lb" }),
    szDesigner("DET3650CI", "DET3650CI", "36\" Designer tall convertible with ice maker", 36, "tall", true, { panelWeight: "60 lb door; drawers 15 lb" }),
    szDesigner("ID-24R", "ID-24R", "24\" Designer refrigerator drawers", 24, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-24RO", "ID-24RO", "24\" Designer outdoor refrigerator drawers", 24, "drawer", false, { outdoor: true }),
    szDesigner("ID-24F", "ID-24F", "24\" Designer freezer drawers", 24, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-24FI", "ID-24FI", "24\" Designer freezer drawers with ice maker", 24, "drawer", true, { panelWeight: "15 lb per drawer panel", note: "In-line filter required where the water has high sediment." }),
    szDesigner("ID-27R", "ID-27R", "27\" Designer refrigerator drawers", 27, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-30R", "ID-30R", "30\" Designer refrigerator drawers", 30, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-30F", "ID-30F", "30\" Designer freezer drawers", 30, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-30FI", "ID-30FI", "30\" Designer freezer drawers with ice maker", 30, "drawer", true, { panelWeight: "15 lb per drawer panel", note: "In-line filter required where the water has high sediment." }),
    szDesigner("ID-30C", "ID-30C", "30\" Designer combination drawers", 30, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-30CI", "ID-30CI", "30\" Designer combination drawers with ice maker", 30, "drawer", true, { panelWeight: "15 lb per drawer panel", note: "In-line filter required where the water has high sediment." }),
    szDesigner("ID-36R", "ID-36R", "36\" Designer refrigerator drawers", 36, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-36C", "ID-36C", "36\" Designer combination drawers", 36, "drawer", false, { panelWeight: "15 lb per drawer panel" }),
    szDesigner("ID-36CI", "ID-36CI", "36\" Designer combination drawers with ice maker", 36, "drawer", true, { panelWeight: "15 lb per drawer panel", note: "In-line filter required where the water has high sediment." }),
    szDesigner("DEC1850W", "DEC1850W", "18\" Designer wine column", 18, "column", false, { category: "wine", pages: "pp.54–71", page: "p.60", panelWeight: "35 lb max door frame" }),
    szDesigner("DEC2450W", "DEC2450W", "24\" Designer wine column", 24, "column", false, { category: "wine", pages: "pp.54–71", page: "p.60", panelWeight: "35 lb max door frame" }),
    szDesigner("DEC3050W", "DEC3050W", "30\" Designer wine column", 30, "column", false, { category: "wine", pages: "pp.54–71", page: "p.60", panelWeight: "35 lb max door frame" }),
    szDesigner("DET3050WR", "DET3050WR", "30\" Designer tall wine with refrigerator drawers", 30, "tall", false, { category: "wine", pages: "pp.54–71", page: "p.60", panelWeight: "25 lb door frame; drawers 15 lb" }),
    szUndercounter("DEU2450R", "DEU2450R", "24\" Designer undercounter refrigerator", 24, "34 1/2", false),
    szUndercounter("DEU2450RADA", "DEU2450RADA", "24\" Designer undercounter refrigerator, ADA height", 24, "32 1/2", false),
    szUndercounter("DEU2450RO", "DEU2450RO", "24\" Designer outdoor undercounter refrigerator", 24, "34 1/2", false, { note: "Outdoor: GFCI required; Sub-Zero outdoor stainless panel required." }),
    szUndercounter("DEU2450BG", "DEU2450BG", "24\" Designer undercounter beverage center, glass door", 24, "34 1/2", false),
    szUndercounter("DEU2450BGADA", "DEU2450BGADA", "24\" Designer undercounter beverage center, ADA height", 24, "32 1/2", false),
    szUndercounter("DEU1550BG", "DEU1550BG", "15\" Designer undercounter beverage center, glass door", 15, "34 1/2", false),
    szUndercounter("DEU1550B", "DEU1550B", "15\" Designer undercounter beverage center", 15, "34 1/2", false),
    szUndercounter("DEU1550W", "DEU1550W", "15\" Designer undercounter wine storage", 15, "34 1/2", false, { category: "wine", pages: "pp.54–68", page: "p.56", panelPage: "p.67" }),
    szUndercounter("DEU2450W", "DEU2450W", "24\" Designer undercounter wine storage", 24, "34 1/2", false, { category: "wine", pages: "pp.54–68", page: "p.56", panelPage: "p.67" }),
    szUndercounter("DEU2450WADA", "DEU2450WADA", "24\" Designer undercounter wine storage, ADA height", 24, "32 1/2", false, { category: "wine", pages: "pp.54–68", page: "p.56", panelPage: "p.67" }),
    szIce("UC-15I", "UC-15I", "15\" undercounter ice maker — gravity drain", false, false),
    szIce("UC-15IP", "UC-15IP", "15\" undercounter ice maker with drain pump", true, false),
    szIce("UC-15IO", "UC-15IO", "15\" outdoor undercounter ice maker — gravity drain", false, true),
    szIce("UC-15IPO", "UC-15IPO", "15\" outdoor undercounter ice maker with drain pump", true, true)
  ];
  /* the no-water note rides on the model's first variation, where the office reads it */
  SZ_GUIDE_MODELS.forEach(function (m) {
    if (m.waterNote) m.variations.forEach(function (v) { v.notes = (v.notes ? v.notes + " " : "") + m.waterNote; });
    delete m.waterNote;
  });
  /* The guide also corrects the two Steel Cod entries above: the Classic
     power is a 6" × 7" zone from 75 1/2" up (was a point), the Classic
     water zone is 18" wide ending 6" from the right side (was drawn 6"
     wide), the undercounter power is a band 5" from the left to 2" from
     the right, 4" up (was a point). */
  MODELS.forEach(function (m) {
    if (m.model === "CL4850SID/O") {
      m.utilities = [SZ_CLASSIC_POWER, SZ_CLASSIC_WATER];
      m.variations.forEach(function (v) {
        if (v.key === "standard") {
          v.prep = szReturn(["both"]); v.panelRule = { assumedIn: 0.75, minIn: 0.75, page: SZG + " p.29" };
          v.panel = v.panel || { sizes: "refrigerator 28 3/4 × 71 1/4 · freezer 19 × 71 1/4 · grille 48 × 7 3/4", thickness: "3/4\" overlay + .10\" spacer + 1/4\" backer", weight: "50 lb max per panel; grille 13 lb", page: SZG + " p.19" };
        }
        if (v.key === "flush-inset") {
          v.panelRule = { assumedIn: 0.75, minIn: 0.75, page: SZG + " p.31" };
          v.panel = v.panel || { sizes: "refrigerator 29 1/4 × 71 1/4 · freezer 19 1/2 × 71 1/4 · grille 49 × 7 3/4", thickness: "3/4\" (the cleat setback assumes it)", weight: "50 lb max per panel; grille 13 lb", page: SZG + " p.23" };
          (v.prep || []).forEach(function (pr) { if (pr.kind === "cleat") pr.strip.panelShift = "setbackIn"; if (pr.kind === "return") pr.strip.panelShift = "runIn"; });
        }
      });
    }
    if (m.model === "DEU2450CI") {
      m.utilities = [SZ_UC_POWER].concat(m.utilities.filter(function (u) { return u.key !== "power"; }));
      m.variations.forEach(function (v) { v.prep = v.prep || szReturn(["both", "top"]); v.panelRule = { assumedIn: 0.75, minIn: 0.625, maxIn: 0.75, unitDepthIn: 23.125, faceFlush: true, page: "p.6" }; });
    }
  });
  Array.prototype.push.apply(MODELS, SZ_GUIDE_MODELS);

  /* ---------- the Wolf Design Guide (revised 7/2025) ----------------------
     Cayden, 27 Oct: "go ahead and pull these from the subzero website".
     Wolf is the next 20% of the units on site-walk jobs (sales history,
     26 Oct). Every wall oven, steam and speed oven, microwave, warming and
     vacuum seal drawer, coffee system, cooktop, range, rangetop, hood and
     grill in the guide — openings, the finished cleats a flush inset
     needs (sides, top and bottom, and how far back from the face), the
     connection zones the guide dimensions, and the clearances it states.
     Each number carries its guide page. Where the guide draws a
     connection without dimensioning it, the zone is "anywhere in the
     opening" and the words say where it is drawn — nothing is scaled off
     a picture.

     A flush inset's cleats are not stated as cleats: they are the
     difference between the flush and standard openings, and the guide
     prints each band (13/16" sides and 1 1/8" top on a 30" oven,
     30 1/8 − 2 × 13/16 = 28 1/2, 28 3/4 − 1 1/8 − 1/8 = 27 1/2). The
     setback is the face-to-cleat dimension on the top view. */
  var WG = "Wolf Design Guide 7/2025";
  function wCleats(setback, run, sides, top, bottom, o) {
    o = o || {};
    var note = o.note || "visible with the door open";
    function strip(face, t) {
      var s = { face: face, setbackIn: setback, thicknessIn: t };
      if (run) s.runIn = run;
      if (o.shift) s.panelShift = "setbackIn";
      return s;
    }
    var out = [{ kind: "cleat", label: "Finished cleat — sides", strip: strip("both", sides), finished: true, note: note }];
    if (top) out.push({ kind: "cleat", label: "Finished cleat — top", strip: strip("top", top), finished: true, note: note });
    if (bottom) out.push({ kind: "cleat", label: "Finished cleat — bottom", strip: strip("bottom", bottom), finished: true, note: note });
    return out;
  }
  function wCleatWords(setback, sides, top, bottom) {
    return "Add finished cleats inside the opening, " + setback + "\" back from the face — " + sides + "\" at the sides" +
      (top ? ", " + top + "\" at the top" : "") + (bottom ? ", " + bottom + "\" at the bottom" : "") +
      " — finished to match the cabinetry; every corner of the opening exactly 90°.";
  }
  var W_STD_TELLS = ["Face trim overlaps the stiles and rails", "No cleats inside the opening"];
  var W_FLUSH_TELLS = ["Finished cleats inside the opening, set back so the face sits in plane with the cabinets", "1/8\" minimum reveal all round"];
  function wStd(page, opening, rule, overlap, extra) {
    extra = extra || {};
    return { key: "standard", label: "Standard", page: page, opening: opening, rule: rule || { w: "exact", d: "min", h: "exact" },
      tells: W_STD_TELLS, requires: ["Finish the edges of the opening — they show with the door open."].concat(extra.requires || []),
      notes: (overlap ? "Trim overlaps " + overlap + ". " : "") + (extra.notes || ""), prep: [] };
  }
  function wFlush(key, label, page, opening, cl, extra) {
    extra = extra || {};
    var v = { key: key, label: label, page: page, opening: opening, rule: { w: "min", d: "min", h: "min" },
      tells: W_FLUSH_TELLS, requires: [wCleatWords(cl[0], cl[2], cl[3], cl[4])].concat(extra.requires || []),
      notes: "Flush dimensions give the minimum reveals; 1/8\" reveal minimum on all sides. Cleats " + cl[0] + "\" back from the face" +
        (cl[1] ? ", " + cl[1] + "\" deep minimum" : "") + " — they are visible and finished to match. " + (extra.notes || ""),
      prep: wCleats(cl[0], cl[1], cl[2], cl[3], cl[4], { shift: extra.shift }) };
    if (extra.panelRule) v.panelRule = extra.panelRule;
    if (extra.panel) v.panel = extra.panel;
    if (extra.panelReady != null) v.panelReady = extra.panelReady;
    return v;
  }
  function wEntry(model, prefix, category, appliance, pages, utilities, variations, extra) {
    return Object.assign({ brand: "Wolf", model: model, prefix: prefix, category: category, appliance: appliance,
      pages: WG + " " + pages, source: WG, utilities: utilities, variations: variations }, extra || {});
  }

  /* ---- power rows ---- */
  function wOvenPower(dbl) {
    return { key: "power", label: "Power", need: "Dedicated 240/208 VAC, " + (dbl ? "50" : "30") + " A · hard-wired, " + (dbl ? "5'" : "4'") + " conduit",
      where: "Top right of the opening, flush with the back wall: 4\" in from the right side, 5\" down from the top — or in an adjacent cabinet within reach of the conduit",
      zone: { kind: "rect", x0: { r: 4 }, x1: { r: 0 }, y0: { t: 5 }, y1: { t: 0 } },
      note: "Below 240 V performance may be compromised. A supply inside the opening may need extra cabinet depth." };
  }
  function wCordPower(need, where, note) {
    return { key: "power", label: "Power", need: need, where: where, zone: { kind: "any" }, note: note || "" };
  }
  var W_GAS_NEED = "3/4\" ID line · NG 7\"–14\" WC, LP 11\"–14\" WC to the unit's regulator";
  function wGas(where, zone, inlet, note) {
    var u = { key: "gas", label: "Gas", need: W_GAS_NEED + " · " + (inlet || "1/2\" NPT female") + " inlet", where: where,
      note: note || "Certified 3' flexible connector, 1/2\" or 3/4\" ID, where code allows. NG to 10,250', LP to 8,600' without a high-altitude kit." };
    if (zone) u.zone = zone;
    return u;
  }

  /* ---- M and E Series wall ovens (pp.4–29) ---- */
  function wolfOven(model, prefix, appliance, o) {
    var M = o.series === "M", dbl = !!o.dbl, w24 = o.w === 24;
    var pg = M ? (dbl ? ["p.12", "p.13"] : ["p.10", "p.11"]) : (w24 ? ["p.22", "p.23"] : (dbl ? ["p.26", "p.27"] : ["p.24", "p.25"]));
    var std = w24 ? { w: "22 1/8", d: "23", h: "23 1/4" } : { w: "28 1/2", d: "23 1/4", h: dbl ? "49 7/8" : "27 1/2" };
    var fl = w24 ? { w: "23 3/4", d: "24", h: "23 3/4" } : { w: "30 1/8", d: "24", h: dbl ? "51 1/8" : "28 3/4" };
    var setback = o.glass ? "1" : "7/8";
    var power = w24 ? wCordPower("Dedicated 240/208 VAC, 20 A, NEMA 6-20R · 6' cord",
        "In the opening, the cabinet below or an adjacent cabinet within reach of the 6' cord — drawn, not dimensioned (pp.22–23)",
        "GFCI not recommended. Leave 1\" behind the plug for the cord (p.21).")
      : wOvenPower(dbl);
    var support = w24 ? "150 lb" : dbl ? "400 lb" : "250 lb";
    var common = "Base support " + support + " minimum (" + (M ? "p.9" : "p.20") + "). A cooktop above needs 1/4\" between the units." +
      (!w24 && !dbl ? " Two 30\" singles side by side go in one opening — 58 1/2\" standard, 60 1/8\" flush, with the dual installation kit and nothing between them (" + (M ? "pp.14–15" : "pp.28–29") + ")." : "");
    return wEntry(model, prefix, "ovens", appliance, M ? "pp.4–15" : "pp.16–29", [power], [
      wStd(pg[0], std, null, w24 ? "top 1/4\", bottom 0, sides 11/16\"" : "top 1\", bottom 0, sides 11/16\"", { notes: common }),
      /* the 1" minimum cleat depth is printed on the M Series flush pages
         (pp.11, 13), not on the E Series ones (pp.23–27) */
      wFlush("flush", "Flush inset", pg[1], fl, [setback, M ? "1" : "", "13/16", w24 ? "3/8" : "1 1/8", "1/8"], { notes: common + (o.glass ? " Black glass: cleats 1\" back from the face." : "") })
    ]);
  }

  /* ---- the 18" family: steam, speed, drop-down microwave, coffee (pp.30–57, 82–87) ---- */
  function w18(model, prefix, category, appliance, pages, w, std, stdPage, fl, flPage, power, extra) {
    extra = extra || {};
    var A = w === 24 ? "13/16" : extra.a30 || "4";
    return wEntry(model, prefix, category, appliance, pages, extra.utilities ? [power].concat(extra.utilities) : [power], [
      wStd(stdPage, std, null, extra.overlap, { notes: extra.notes || "", requires: extra.stdRequires }),
      wFlush("flush", "Flush inset", flPage, fl, ["7/8", "", A, extra.top || "5/16", "1/8"], { notes: extra.notes || "", requires: extra.flushRequires })
    ]);
  }
  var W_MW_POWER = wCordPower("Dedicated 120 VAC, 15 A · 3-prong, 4' cord", "Upper left of the opening as drawn (not dimensioned), or an adjacent cabinet within reach of the 4' cord",
    "GFCI not recommended.");
  function wolfSpeed(model, prefix, appliance, w) {
    return w18(model, prefix, "ovens", appliance, "pp.38–43", w,
      { w: "22 1/8", d: "23", h: "17 11/16" }, "p.42", { w: w === 24 ? "23 3/4" : "30 1/8", d: "24", h: "18 1/8" }, "p.43",
      wCordPower("Dedicated 240/208 VAC, 15 A, NEMA 6-20R · 6' cord", "Upper left of the opening as drawn (not dimensioned), or an adjacent cabinet within reach of the cord",
        "GFCI not recommended. Leave 1\" behind the plug for the cord (p.41)."),
      { overlap: w === 24 ? "top 3/16\", bottom 0, sides 11/16\"" : "top 3/16\", bottom 0, sides 3 7/8\"",
        notes: "24\" and 30\" take the same standard opening. Base support 125 lb minimum. Over or under a flush E Series oven: 1/4\" reveal (p.40)." });
  }
  function wolfSteam(model, prefix, appliance, w, plumbed) {
    var util = plumbed ? [
      { key: "water", label: "Water supply", need: "Cold supply · 3/8\" female compression, 6.5' braided tubing · 15–145 psi", offPlane: true,
        where: "Below the unit or in an adjacent cabinet, with an easily reached shutoff",
        note: "Do not connect to filtered water — the unit needs the minerals. A hole into the adjacent cabinet is 1 1/2\" at most, edges smooth and round (p.35)." },
      { key: "drain", label: "Drain", need: "10' corrugated tubing · high loop · rated to 130°F", offPlane: true,
        where: "Below the unit or in an adjacent cabinet: at least 2\" below the unit and 4\" off the floor (p.35)",
        note: "Do not extend or shorten the drain tube." }] : [];
    return w18(model, prefix, "ovens", appliance, "pp.30–37", w,
      { w: w === 24 ? "22 1/8" : "28 1/2", d: "23", h: "17 11/16" }, "p.36", { w: w === 24 ? "23 3/4" : "30 1/8", d: "24", h: "18 1/8" }, "p.37",
      wCordPower("Dedicated 240/208 VAC, 20 A · hard-wired, 4' conduit", "Preferably an adjacent cabinet within reach of the conduit (p.34); the sheet also draws it in the opening's upper right and below",
        "Below 240 V performance may be compromised."),
      { a30: "13/16", overlap: w === 24 ? "top 3/16\", bottom 0, sides 5/8\"" : "top 3/16\", bottom 0, sides 11/16\"", utilities: util,
        notes: "Base support 150 lb minimum." + (plumbed ? " The back of the base support stays open for the water and drain lines (p.33)." : ""),
        stdRequires: plumbed ? ["Leave the back of the base support open for the water and drain lines."] : [] });
  }
  function wolfMdd(model, prefix, appliance, w) {
    return w18(model, prefix, "microwave", appliance, "pp.44–51", w,
      { w: "22 1/8", d: "21 9/16", h: "17 11/16" }, "p.50", { w: w === 24 ? "23 3/4" : "30 1/8", d: "23", h: "18 1/8" }, "p.51", W_MW_POWER,
      { overlap: w === 24 ? "top 3/16\", bottom 0, sides 11/16\"" : "top 3/16\", bottom 0, sides 3 7/8\"",
        notes: "24\" and 30\" take the same standard opening. Base support 125 lb minimum. Leave 3\" behind the plug for the cord (p.49)." });
  }
  function wolfCoffee(model, prefix, appliance, w) {
    return w18(model, prefix, "ovens", appliance, "pp.82–87", w,
      { w: "22 1/8", d: "21 9/16", h: "17 11/16" }, "p.86", { w: w === 24 ? "23 3/4" : "30 1/8", d: "23", h: "18 1/8" }, "p.87",
      wCordPower("Dedicated 120 VAC, 15 A · 3-prong, 6' cord", "At the right of the opening as drawn (not dimensioned)", "GFCI not recommended."),
      { overlap: w === 24 ? "top 3/16\", bottom 0, sides 11/16\"" : "top 3/16\", bottom 0, sides 3 7/8\"",
        notes: "24\" and 30\" take the same standard opening. Base support 100 lb minimum. The sides of the opening carry the mounting slides — solid enough to hold them (p.84).",
        stdRequires: ["Make the sides of the opening solid enough to carry the mounting slides."] });
  }
  /* ---- drawer microwave (pp.46, 52–53) ---- */
  function wolfMd(model, prefix, appliance, w) {
    var A = w === 24 ? "1" : "4";
    return wEntry(model, prefix, "microwave", appliance, "pp.44–53", [W_MW_POWER], [
      wStd("p.52", { w: "22 1/8", d: "22", h: "14 3/4" }, null, "top 5/16\", bottom 1/16\", sides " + (w === 24 ? "7/8\"" : "3 7/8\""),
        { notes: "All drawer microwaves take the same standard opening. Anti-tip block at the top rear. Base support 125 lb minimum." }),
      wFlush("flush", "Flush inset", "p.53", { w: w === 24 ? "24 1/8" : "30 1/8", d: "23 3/8", h: "15 15/16" }, ["1 3/8", "", A, "7/16", "3/4"],
        { notes: "Reveal 1/8\" top and sides, 11/16\" at the bottom. Anti-tip block at the top rear.",
          requires: ["Order the sales accessory that directs air away from a flush drawer microwave."] })
    ]);
  }
  /* ---- convection / standard microwave with trim (pp.47, 54–57) ---- */
  function wolfTrimMw(model, prefix, appliance, conv) {
    var std = conv ? { d: "20 1/8", h: "18 7/8" } : { d: "20", h: "17" };
    var fl = conv ? { h: "20 1/8", top: "3/8", bottom: "7/8" } : { h: "18 1/2", top: "11/16", bottom: "13/16" };
    var pages = conv ? ["p.54", "p.55"] : ["p.56", "p.57"];
    var power = wCordPower("Dedicated 120 VAC, 15 A · 3-prong, 4' cord", "In the opening as drawn (not dimensioned), or an adjacent cabinet within reach of the 4' cord", "GFCI not recommended.");
    function std1(tw, w) { var v = wStd(pages[0], { w: w, d: std.d, h: std.h }, null, "", { notes: "With the " + tw + "\" trim kit (M/E Series trim). Base support 125 lb minimum." }); v.key = "standard-" + tw; v.label = "Standard · " + tw + "\" trim"; return v; }
    function fl1(tw, w, a, extra) { return wFlush("flush-" + tw, "Flush inset · " + tw + "\" trim", pages[1], { w: w, d: "23 1/4", h: fl.h }, ["1", "", a, fl.top, fl.bottom], { notes: "With the " + tw + "\" trim kit. " + (extra || "") }); }
    var vs = [std1(27, "25 1/4"), std1(30, "27 1/2"), fl1(27, "27 1/8", "15/16"),
      fl1(30, "30 1/8", "1 3/16", "30 1/8\" less two 1 3/16\" cleats is 27 3/4\", where the standard opening is 27 1/2\" — the guide prints both; check the trim kit's sheet.")];
    vs.push({ key: "countertop", label: "Freestanding / countertop", page: "p.49", noOpening: true, opening: {}, rule: {}, tells: [], requires: [],
      notes: "Freestanding: 2\" minimum clear at the top, rear and sides for air." });
    return wEntry(model, prefix, "microwave", appliance, "pp.44–57", [power], vs);
  }
  /* ---- warming drawer (pp.58–63) — the custom front moves the cleats ---- */
  function wolfWarming(model, prefix, appliance) {
    var fl = { w: "30 1/8", d: "24", h: "10 5/8" };
    function f(key, label, setback, extra) {
      return wFlush(key, label, "p.63", fl, [setback, "", "3/4", "3/4", "3/4"], Object.assign({ notes: "Cleat setback is the drawer front's depth (" + setback + "\") (p.63)." }, extra || {}));
    }
    return wEntry(model, prefix, "ovens", appliance, "pp.58–63",
      [wCordPower("Dedicated 120 VAC, 15 A · 3-prong, 3' cord", "Lower right of the opening, flush with the back wall (as drawn, not dimensioned) — or an adjacent cabinet within reach of the 3' cord",
        "Outdoors a GFCI is required (p.61).")], [
      wStd("p.62", { w: "28 5/8", d: "23", h: "9 1/8" }, null, "5/8\" top, bottom and sides",
        { notes: "Installed with a Wolf drawer front, ordered separately. Recessed install: cabinetry recessed 3/16\" so the collar is flush with the face frame. Anti-tip block at the top rear. Base support 200 lb minimum (p.60)." }),
      f("flush-ss", "Flush inset · stainless front", "1 1/8"),
      f("flush-black", "Flush inset · black front", "1 3/8"),
      f("flush-2in", "Flush inset · 2\" stainless front (under a rangetop or grill)", "2 1/8"),
      f("flush-custom", "Flush inset · custom panel", "1", { shift: true, panelReady: true,
        notes: "Custom front depth is the panel thickness plus 1/4\" — 1\" with a 3/4\" panel; a different panel moves the cleats by the difference (p.63).",
        panelRule: { assumedIn: 0.75, minIn: 0.625, page: "p.59" },
        panel: { width: "29 7/8", height: "10 3/8", thickness: "3/4\" typical, 5/8\" min", page: "p.59" } })
    ]);
  }
  /* ---- vacuum seal drawer (pp.88–93) ---- */
  function wolfVacuum(model, prefix, appliance) {
    function f(w, a, tag) {
      return wFlush("flush-" + tag, "Flush inset · " + tag + "\" front", "p.93", { w: w, d: "23 1/2", h: "5 3/4" }, ["7/8", "", a, "1/16", "1/8"],
        { shift: true, notes: "The 7/8\" cleat depth assumes a stainless, black glass or 3/4\" custom panel (p.93).",
          panelRule: { assumedIn: 0.75, page: "p.93" } });
    }
    return wEntry(model, prefix, "ovens", appliance, "pp.88–93",
      [wCordPower("Dedicated 120 VAC, 10 A · 3-prong, 3' cord", "Right of the opening as drawn (not dimensioned)", "GFCI not recommended.")], [
      wStd("p.92", { w: "22 1/8", d: "22 1/2", h: "5 9/16" }, null, "top 0, bottom 0, sides 11/16\"",
        { notes: "Under a countertop it needs a 2\" filler above — the lid opens to 60° (p.90). A custom panel takes the panel mounting kit and no handle. Base support 75 lb minimum.",
          requires: ["Under a countertop: add the 2\" filler above the drawer so the lid opens."] }),
      f("23 3/4", "13/16", "24"), f("30 1/8", "4", "30")
    ]);
  }

  /* ---- cooktops (pp.64–81): a cutout, and the cabinet below ---- */
  function wCooktopBelow(gas, ind) {
    var drop = ind ? "4 1/2\"" : "4\"";
    var rows = [{ key: "power", label: "Power", need: ind ? "" : "Dedicated 120 VAC, 15 A · 3-prong, 6' cord",
      plane: "below", zone: { kind: "any", plane: "below" },
      where: "In the cabinet below. Over a built-in oven: 10\" wide at the right, 3 1/2\" tall, starting " + drop + " below the countertop",
      note: ind ? "" : "GFCI not recommended." }];
    if (gas) rows.push(wGas("In the cabinet below, beside the power. Over a built-in oven: the same 10\" × 3 1/2\" zone at the right, 4\" below the countertop",
      { kind: "any", plane: "below" }, "1/2\" NPT male"));
    if (gas) rows[1].plane = "below";
    return rows;
  }
  function wolfCooktop(model, prefix, appliance, o) {
    var util = wCooktopBelow(o.gas, !o.gas);
    if (!o.gas) {
      util[0].need = "Dedicated 240/208 VAC, " + o.amps + " A · hard-wired, 4' flexible conduit";
      util[0].note = "GFCI not recommended. Side-by-side units each need their own circuit (p.67).";
    }
    var vs = [{ key: "standard", label: o.flush ? "Standard (on the countertop)" : "Standard", page: o.stdPage,
      opening: { w: o.cutW, d: o.cutD || "19 1/2" }, rule: { w: "exact", d: "exact" },
      form: { behindMinIn: 2.5 },
      tells: ["Cutout in the countertop, 2 1/2\" from the front edge and from the back"],
      requires: ["Keep 30\" from the cooking surface to anything combustible above, and 18\" to wall cabinets no deeper than 13\"."],
      notes: "2 1/2\" minimum from the cutout to the countertop front and to the back. Bottom of the cooktop 2\" minimum from anything combustible below. " + (o.notes || "") }];
    if (o.flush) vs.push({ key: "flush", label: "Flush (recessed into the countertop)", page: o.flushPage,
      opening: { w: o.cutW, d: o.cutD || "19 1/2" }, rule: { w: "exact", d: "exact" }, form: { behindMinIn: 2.5 },
      tells: ["A recess routed around the cutout so the glass sits flush with the countertop"],
      requires: ["Rout the recess around the cutout: " + o.flush + " (granite, solid surface or stone only)."],
      notes: "Flush mount is for granite, solid surface or stone countertops. " + (o.notes || "") });
    return wEntry(model, prefix, "cooktop", appliance, o.pages, util, vs);
  }

  /* ---- ranges (pp.94–107): the opening and the zone low on the back wall ---- */
  var W_RANGE_A = { 30: 10.25, 36: 16.25, 48: 18.25, 60: 18.25 };
  function wolfRange(model, prefix, appliance, o) {
    var w = o.w, util, page, notes, clear;
    if (o.type === "gas") {
      page = "p.101";
      util = [{ key: "power", label: "Power", need: "Dedicated 110/120 VAC, 15 A · 3-prong, 6' cord",
          where: "Back wall: 12\" wide, ending 10\" from the right side, from 7 3/4\" to 13 1/2\" off the floor; may come up through the floor within 3\" of the wall",
          zone: { kind: "rect", x0: { r: 22 }, x1: { r: 10 }, y0: 7.75, y1: 13.5 } },
        wGas("Back wall: 12\" wide, ending 5\" from the right side, within 2\" of the floor; may come up through the floor within 3\" of the wall",
          { kind: "rect", x0: { r: 17 }, x1: { r: 5 }, y0: 0, y1: 2 })];
      clear = "Without a hood, 42\" from the countertop to anything combustible; charbroiler models and the GR488 need non-combustible material there. Against a combustible wall, a 20\" riser minimum (p.100).";
      notes = "Range height 37\" to the top of the back, adjustable 37\"–38\"; 36\" at the front (p.99).";
    } else {
      var A = W_RANGE_A[w], ind = o.type === "induction";
      page = ind ? (o.pro ? "p.106" : "p.105") : "p.97";
      var zone = { kind: "rect", x0: { r: 8.5 + A }, x1: { r: 8.5 }, y0: 0, y1: 4.875 };
      var where = "Back wall: " + fmtIn(A) + " wide, ending 8 1/2\" from the right side, within 4 7/8\" of the floor; may come up through the floor within 2\" of the wall";
      var amps = ind ? "50" : (o.dbl ? "50" : "30");
      util = [{ key: "power", label: "Power", need: "Dedicated 240/208 VAC, " + amps + " A · range cord (3- or 4-conductor) or direct-wired",
        where: where + (ind && w === 48 ? " — two supplies, receptacles with the grounds facing each other (p.104)" : ""), zone: zone,
        note: "A 4-conductor cord where grounding through the neutral is prohibited. Below 240 V performance may be compromised." + (ind && w === 48 ? " Two separate 50 A circuits." : "") }];
      if (!ind) util.push(wGas(where + " — in the same zone as the power", zone));
      clear = "Without a hood, 36\" from the countertop to anything combustible" + (ind ? "" : " (44\" over a charbroiler)") + "." +
        (!ind && (w >= 48 || o.griddle) ? " Against a combustible wall, a 10\" riser minimum (p.96)." : "");
      notes = ind ? "Height 35 1/2\" min to 38\" max on the side view (p.103)." : "Range height 35 1/2\" min to 38\" max on the side view; 36 1/2\" overall at the front (p.95).";
    }
    var vs = [{ key: "standard", label: "Between cabinets", page: page, opening: { w: o.openW || String(w) }, rule: { w: "min" },
      tells: ["Range stands on the floor between the cabinets, its top meeting the countertop"],
      requires: ["Hood 30\"–36\" above the cooking surface; wall cabinets 18\" above the countertop and no deeper than 13\" beside it, kept 6\" back from the opening."],
      notes: notes + " " + clear + " Island: 12\" minimum from the back of the range to a combustible wall above the countertop." }];
    return wEntry(model, prefix, "range", appliance, o.pages, util, vs);
  }
  /* ---- sealed burner rangetops (pp.108–111): on a platform ---- */
  function wolfRangetop(model, prefix, appliance, w, o) {
    o = o || {};
    var zone = { kind: "rect", plane: "floor", x0: 0, x1: { r: 0 }, y0: { t: 4 }, y1: { t: 0 } };
    var where = "Up through the platform: a 16\" wide band within 4\" of the back wall (drawn, its side position not dimensioned)";
    var support = { 30: "200 lb", 36: "250 lb", 48: "300 lb" }[w];
    return wEntry(model, prefix, "rangetop", appliance, "pp.108–111", [
      { key: "power", label: "Power", need: "Dedicated 110/120 VAC, 15 A · 3-prong, 6' cord", plane: "floor", zone: zone, where: where },
      Object.assign(wGas(where + " — beside the power", zone), { plane: "floor" })
    ], [{ key: "standard", label: "On a platform", page: "p.111", opening: { w: String(w), d: "24", h: "7 1/2" }, rule: { w: "min", d: "max", h: "exact" },
      dims: { d: { label: "Platform depth", datum: "front edge of the platform to the back wall — 24\" at most" },
              h: { label: "Countertop to platform", datum: "top of the countertop down to the platform the rangetop sits on" } },
      tells: ["Rangetop sits on a platform 7 1/2\" below the countertop", "Platform cut out for the gas and power"],
      requires: ["Build the platform 3/4\" thick minimum, no deeper than 24\", carrying " + support + ", cut out for the gas and power.",
                 "Hood 30\"–36\" above the cooking surface; wall cabinets 18\" above the countertop and no deeper than 13\"."],
      notes: "Without a hood, 36\" from the countertop to anything combustible (44\" over a charbroiler). " + (o.riser || "") +
        " Island: 12\" minimum from the back of the rangetop to a combustible wall above the countertop. A downdraft works with the SRT304 and SRT366 only, with a trim kit (p.110)." }]);
  }

  /* ---- hoods (pp.124–149): a band above the cooking surface ---- */
  function wHoodPower(where, extra) {
    return Object.assign({ key: "power", label: "Power", need: "Dedicated 120 VAC, 15 A", offPlane: true, where: where }, extra || {});
  }
  function wDuct(size, where) {
    return { key: "vent", label: "Duct", need: size + "\" round duct", type: size + "-round", offPlane: true, where: where };
  }
  function wHood(model, prefix, appliance, o) {
    return wEntry(model, prefix, "ventilation", appliance, o.pages, [o.power, o.duct], [{
      key: "standard", label: o.label, page: o.page, opening: { w: o.w, d: o.d || "", h: o.bandMin }, openingMax: { h: o.bandMax },
      rule: { w: "min", d: o.d ? "min" : "", h: "range" },
      hood: { type: o.type, under: o.under || "range", w: o.unitW || o.w, h: o.unitH, d: o.unitD || o.d || "", duct: { size: o.ductSize + "\" round", dir: o.ductDir || "vertical" }, jbox: o.power.where },
      tells: o.tells || [], requires: o.requires || ["Blocking in the wall or ceiling to hang it; duct run complete to the exterior."],
      notes: o.notes || "" }]);
  }

  /* ---- outdoor grills and the burner module (pp.112–117) ---- */
  function wolfGrill(model, prefix, appliance, nonComb, comb) {
    var util = [{ key: "power", label: "Power", need: "Dedicated 120 VAC, 15 A · 3-prong GFCI, 6' cord", offPlane: true, where: "Within reach of the 6' cord", note: "GFCI required." },
      Object.assign(wGas("In the enclosure, through the 2 3/4\" knockout as drawn (p.116)"), { offPlane: true })];
    return wEntry(model, prefix, "grill", appliance, "pp.112–116", util, [
      { key: "noncombustible", label: "Non-combustible enclosure", page: "p.116", opening: { w: nonComb, d: "24 1/4", h: "11 3/4" }, rule: { w: "exact", d: "min", h: "exact" },
        tells: ["Masonry or steel enclosure — no insulating liner"], requires: ["Build the enclosure of non-combustible material at the cutout."],
        notes: "Countertop overhang 13/16\" at the cutout. Clearance for the hood to open at the back (p.113)." },
      { key: "combustible", label: "Combustible enclosure (insulating liner)", page: "p.116", opening: { w: comb, d: "26", h: "12 5/8" }, rule: { w: "exact", d: "min", h: "exact" },
        tells: ["Wood-framed enclosure with the Wolf insulating liner"], requires: ["Order the Wolf insulating liner — required in a combustible enclosure."],
        notes: "Countertop overhang 13/16\" at the cutout." }
    ]);
  }

  var W_GUIDE_MODELS = [];
  function wAdd(e) { W_GUIDE_MODELS.push(e); }
  /* wall ovens */
  [["SO3050TM/S/TH", "SO3050TM", "30\" M Series transitional single oven", { series: "M" }],
   ["DO3050TM/S/TH", "DO3050TM", "30\" M Series transitional double oven", { series: "M", dbl: true }],
   ["SO3050PM/S/PH", "SO3050PM", "30\" M Series professional single oven", { series: "M" }],
   ["DO3050PM/S/PH", "DO3050PM", "30\" M Series professional double oven", { series: "M", dbl: true }],
   ["SO3050CM/S", "SO3050CM", "30\" M Series contemporary stainless single oven", { series: "M" }],
   ["SO3050CM/B", "SO3050CMB", "30\" M Series contemporary black glass single oven", { series: "M", glass: true }],
   ["DO3050CM/S", "DO3050CM", "30\" M Series contemporary stainless double oven", { series: "M", dbl: true }],
   ["DO3050CM/B", "DO3050CMB", "30\" M Series contemporary black glass double oven", { series: "M", dbl: true, glass: true }],
   ["SO24TE/S/TH", "SO24TE", "24\" E Series transitional single oven", { series: "E", w: 24 }],
   ["SO3050TE/S/TH", "SO3050TE", "30\" E Series transitional single oven", { series: "E" }],
   ["DO3050TE/S/TH", "DO3050TE", "30\" E Series transitional double oven", { series: "E", dbl: true }],
   ["SO3050PE/S/PH", "SO3050PE", "30\" E Series professional single oven", { series: "E" }],
   ["DO3050PE/S/PH", "DO3050PE", "30\" E Series professional double oven", { series: "E", dbl: true }]
  ].forEach(function (r) { wAdd(wolfOven(r[0], r[1], r[2], r[3])); });
  /* steam ovens */
  [["CSO2450TE/S/T", "CSO2450TE", "24\" transitional convection steam oven", 24], ["CSO3050TM/S/T", "CSO3050TM", "30\" M Series transitional convection steam oven", 30],
   ["CSO3050TE/S/T", "CSO3050TE", "30\" E Series transitional convection steam oven", 30], ["CSO3050PM/S/P", "CSO3050PM", "30\" M Series professional convection steam oven", 30],
   ["CSO3050PE/S/P", "CSO3050PE", "30\" E Series professional convection steam oven", 30], ["CSO3050CM", "CSO3050CM", "30\" M Series contemporary convection steam oven", 30],
   ["CSO2450CM/S", "CSO2450CM", "24\" contemporary handleless convection steam oven", 24]
  ].forEach(function (r) {
    wAdd(wolfSteam(r[0], r[1], r[2] + " — not plumbed", r[3], false));
    wAdd(wolfSteam(r[0].replace(/^CSO/, "CSOP"), r[1].replace(/^CSO/, "CSOP"), r[2] + " — plumbed", r[3], true));
  });
  /* speed ovens */
  [["SPO2450TE/S/T", "SPO2450TE", "24\" E Series transitional speed oven", 24], ["SPO3050TM/S/T", "SPO3050TM", "30\" M Series transitional speed oven", 30],
   ["SPO3050PM/S/P", "SPO3050PM", "30\" M Series professional speed oven", 30],
   ["SPO3050PE/S/P", "SPO3050PE", "30\" E Series professional speed oven", 30], ["SPO3050CM/B/T", "SPO3050CM", "30\" M Series contemporary speed oven", 30]
  ].forEach(function (r) { wAdd(wolfSpeed(r[0], r[1], r[2], r[3])); });
  /* SPO3050TE/S/T is already in the library from the Steel Cod package
     (same openings as p.42–43); it keeps its entry, and its prefix stays
     the fallback for any SPO3050 the guide does not list. The guide's
     power words replace "anywhere within the opening". */
  MODELS.forEach(function (m) {
    if (m.model !== "SPO3050TE/S/T") return;
    m.utilities = [wCordPower("Dedicated 240/208 VAC, 15 A, NEMA 6-20R · 6' cord", "Upper left of the opening as drawn (not dimensioned), or an adjacent cabinet within reach of the cord",
      "GFCI not recommended. Leave 1\" behind the plug for the cord (" + WG + " p.41).")];
    m.pages = m.pages + " · " + WG + " pp.38–43";
  });
  /* microwaves */
  [["MDD2450TE/S/T", "MDD2450TE", "24\" E Series transitional drop-down door microwave", 24], ["MDD3050TM/S/T", "MDD3050TM", "30\" M Series transitional drop-down door microwave", 30],
   ["MDD3050TE/S/T", "MDD3050TE", "30\" E Series transitional drop-down door microwave", 30], ["MDD3050PM/S/P", "MDD3050PM", "30\" M Series professional drop-down door microwave", 30],
   ["MDD3050PE/S/P", "MDD3050PE", "30\" E Series professional drop-down door microwave", 30], ["MDD3050CM/B/T", "MDD3050CM", "30\" M Series contemporary drop-down door microwave", 30]
  ].forEach(function (r) { wAdd(wolfMdd(r[0], r[1], r[2], r[3])); });
  [["MD24TE/S", "MD24TE", "24\" transitional drawer microwave", 24], ["MD30TE/S", "MD30TE", "30\" transitional drawer microwave", 30], ["MD30PE/S", "MD30PE", "30\" professional drawer microwave", 30]
  ].forEach(function (r) { wAdd(wolfMd(r[0], r[1], r[2], r[3])); });
  wAdd(wolfTrimMw("MC24", "MC24", "24\" convection microwave oven — built in with trim kit", true));
  wAdd(wolfTrimMw("MS24", "MS24", "24\" standard microwave oven — built in with trim kit", false));
  /* drawers and coffee */
  wAdd(wolfWarming("WWD30", "WWD30", "30\" warming drawer"));
  wAdd(wolfVacuum("VS24", "VS24", "24\" vacuum seal drawer"));
  [["EC2450TE/S", "EC2450TE", "24\" E Series transitional coffee system", 24], ["EC3050TE/S", "EC3050TE", "30\" E Series transitional coffee system", 30],
   ["EC3050TM/S", "EC3050TM", "30\" M Series transitional coffee system", 30], ["EC3050PE/S", "EC3050PE", "30\" E Series professional coffee system", 30],
   ["EC3050PM/S", "EC3050PM", "30\" M Series professional coffee system", 30], ["EC3050CM", "EC3050CM", "30\" M Series contemporary coffee system", 30]
  ].forEach(function (r) { wAdd(wolfCoffee(r[0], r[1], r[2], r[3])); });
  /* cooktops */
  [["CI30460T/S", "CI30460T", "30\" transitional induction cooktop", { cutW: "29", amps: 40 }],
   ["CI36560T/S", "CI36560T", "36\" transitional induction cooktop", { cutW: "35", amps: 50 }],
   ["CI30460C/B", "CI30460C", "30\" contemporary induction cooktop", { cutW: "29", amps: 40, flush: "30 1/8\" × 21 1/8\" recess, 5/16\" deep", notes: "Not for combination with other cooktops (p.66)." }],
   ["CI36560C/B", "CI36560C", "36\" contemporary induction cooktop", { cutW: "35", amps: 50, flush: "36 1/8\" × 21 1/8\" recess, 5/16\" deep", notes: "Not for combination with other cooktops (p.66)." }],
   ["CI243TF/S", "CI243TF", "24\" transitional framed induction cooktop", { cutW: "22 1/8", amps: 30 }],
   ["CI304TF/S", "CI304TF", "30\" transitional framed induction cooktop", { cutW: "29", amps: 40 }],
   ["CI365TF/S", "CI365TF", "36\" transitional framed induction cooktop", { cutW: "35", amps: 50 }]
  ].forEach(function (r) { wAdd(wolfCooktop(r[0], r[1], r[2], Object.assign({ gas: false, pages: "pp.64–69", stdPage: "p.68", flushPage: "p.69" }, r[3]))); });
  [["CG243TF/S", "CG243TF", "24\" transitional framed gas cooktop", "23"], ["CG304T/S", "CG304T", "30\" transitional gas cooktop", "29"],
   ["CG304P/S", "CG304P", "30\" professional gas cooktop", "29"], ["CG365T/S", "CG365T", "36\" transitional gas cooktop", "35"],
   ["CG365P/S", "CG365P", "36\" professional gas cooktop", "35"]
  ].forEach(function (r) { wAdd(wolfCooktop(r[0], r[1], r[2], { gas: true, cutW: r[3], pages: "pp.70–73", stdPage: "p.73" })); });
  wAdd(wolfCooktop("CG365C/S", "CG365C", "36\" contemporary gas cooktop", { gas: true, cutW: "35", cutD: "20", pages: "pp.70–75", stdPage: "p.74", flushPage: "p.75",
    flush: "36\" × 21\" minimum recess, 5/64\" deep",
    notes: "The control knobs mount through the cabinet face below — drill the holes where p.74 draws them; facade 1\" thick at most there. The countertop must take 300°F." }));
  [["CI152TF/S", "CI152TF", "15\" induction module cooktop", false], ["CG152TF/S", "CG152TF", "15\" gas module cooktop", true], ["MM15TF/S", "MM15TF", "15\" multi-function module cooktop", true]
  ].forEach(function (r) {
    var e = wolfCooktop(r[0], r[1], r[2], { gas: r[3], amps: 20, cutW: "14", pages: "pp.76–81", stdPage: r[3] ? "p.81" : "p.80",
      notes: "Side by side: (2) 29\", (3) 44\", (4) 59 1/4\", (5) 74 1/4\", (6) 89 1/4\"; 30\" cooktop + 1 module 44\", 36\" cooktop + 1 module 50\" (p.78). Each unit its own circuit" + (r[3] ? "; gas from a common line, each with its own regulator." : ".") });
    if (r[3]) e.utilities[0].need = "Dedicated 120 VAC, 15 A · 3-prong, 6' cord";
    e.utilities.forEach(function (u) { u.where = "In the cabinet below, as drawn (" + (r[3] ? "p.81" : "p.80") + ")"; });
    wAdd(e);
  });
  /* ranges */
  [["DF30450/S/P", "DF30450", 30, {}], ["DF36650/S/P", "DF36650", 36, {}], ["DF36450C/S/P", "DF36450C", 36, { griddle: true, tag: "charbroiler" }],
   ["DF36450G/S/P", "DF36450G", 36, { griddle: true, tag: "griddle" }], ["DF48850/S/P", "DF48850", 48, { dbl: true }], ["DF48650C/S/P", "DF48650C", 48, { dbl: true, tag: "charbroiler" }],
   ["DF48650G/S/P", "DF48650G", 48, { dbl: true, tag: "griddle" }], ["DF48450CG/S/P", "DF48450CG", 48, { dbl: true, tag: "charbroiler and griddle" }],
   ["DF48450DG/S/P", "DF48450DG", 48, { dbl: true, tag: "double griddle" }], ["DF48450F/S/P", "DF48450F", 48, { dbl: true, tag: "French top" }],
   ["DF60650CG/S/P", "DF60650CG", 60, { dbl: true, tag: "charbroiler and griddle" }], ["DF60650DG/S/P", "DF60650DG", 60, { dbl: true, tag: "double griddle" }],
   ["DF60650F/S/P", "DF60650F", 60, { dbl: true, tag: "French top" }]
  ].forEach(function (r) { wAdd(wolfRange(r[0], r[1], r[2] + "\" dual fuel range" + (r[3].tag ? " with " + r[3].tag : ""), Object.assign({ type: "df", w: r[2], pages: "pp.94–97" }, r[3]))); });
  [["GR304", 30, ""], ["GR366", 36, ""], ["GR364C", 36, "charbroiler"], ["GR364G", 36, "griddle"], ["GR488", 48, ""], ["GR486C", 48, "charbroiler"], ["GR486G", 48, "griddle"],
   ["GR484CG", 48, "charbroiler and griddle"], ["GR484DG", 48, "double griddle"], ["GR606DG", 60, "double griddle"], ["GR606CG", 60, "charbroiler and griddle"]
  ].forEach(function (r) { wAdd(wolfRange(r[0], r[0], r[1] + "\" gas range" + (r[2] ? " with " + r[2] : ""), { type: "gas", w: r[1], openW: r[1] === 60 ? "60 1/4" : String(r[1]), pages: "pp.98–101" })); });
  [["IR30450/S/T", "IR30450", 30, false], ["IR36550/S/T", "IR36550", 36, false], ["IR30451/S/P", "IR30451", 30, true], ["IR36551/S/P", "IR36551", 36, true], ["IR48751/S/P", "IR48751", 48, true]
  ].forEach(function (r) { wAdd(wolfRange(r[0], r[1], r[2] + "\" " + (r[3] ? "professional" : "transitional") + " induction range", { type: "induction", w: r[2], pro: r[3], pages: "pp.102–107" })); });
  /* rangetops */
  [["SRT304", 30, ""], ["SRT366", 36, "Against a combustible wall, a 5\" riser minimum for the SRT366."], ["SRT364C", 36, "Against a combustible wall, a 10\" riser minimum (charbroiler)."],
   ["SRT364G", 36, "Against a combustible wall, a 10\" riser minimum (griddle)."], ["SRT362W", 36, "Cannot be installed against a combustible surface."],
   ["SRT486C", 48, "Against a combustible wall, a 10\" riser minimum (charbroiler)."], ["SRT486G", 48, "Against a combustible wall, a 10\" riser minimum (griddle)."],
   ["SRT484CG", 48, "Against a combustible wall, a 10\" riser minimum."], ["SRT484DG", 48, "Against a combustible wall, a 10\" riser minimum (griddle)."],
   ["SRT484W", 48, "Cannot be installed against a combustible surface."]
  ].forEach(function (r) { wAdd(wolfRangetop(r[0], r[0], r[1] + "\" sealed burner rangetop", r[1], { riser: r[2] })); });
  /* Pro hoods and hood liners */
  var W_LINER_W = { 34: "34 3/8", 40: "40 3/8", 46: "46 3/8", 52: "52 3/8", 58: "58 3/8" };
  [34, 40, 46, 52, 58].forEach(function (n) {
    [["19", "19 3/8"], ["22", "22 5/8"]].forEach(function (dd) {
      var m = "PL" + n + dd[0] + "12";
      wAdd(wHood(m, m, n + "\" Pro hood liner, " + dd[1] + "\" deep", { pages: "pp.140–149", page: "p.142", label: "Liner in a custom hood", type: "insert",
        w: W_LINER_W[n], d: dd[1], unitH: "12 1/8", bandMin: "30", bandMax: "36", ductSize: 10,
        power: wHoodPower("Inside the decorative hood: 12 1/2\" right of the centreline, 7 5/8\" above the bottom edge (p.145)"),
        duct: wDuct(10, "Vertical discharge off the top of the liner"),
        tells: ["Liner sits inside a custom decorative hood, both bottoms on one plane"],
        requires: ["Build the decorative hood to take the " + W_LINER_W[n] + "\" × " + dd[1] + "\" liner, its bottom in the same plane as the liner's.",
                   "Blocking to hang it; 10\" round duct complete to the exterior."],
        notes: "Liner " + W_LINER_W[n] + "\" wide × " + dd[1] + "\" deep × 12 1/8\" tall; bottom of the hood 30\"–36\" above the countertop (p.144). Ships without a blower — internal, in-line or remote (pp.148–149)." }));
    });
  });
  [["PW302210", 30, "low"], ["PW362210", 36, "low"], ["PW422210", 42, "low"], ["PW482210", 48, "low"]].concat(
    [30, 36, 42, 48, 54, 60, 66].map(function (n) { return ["PW" + n + "2418", n, "24"]; }),
    [30, 36, 42, 48, 54, 60, 66].map(function (n) { return ["PW" + n + "2718", n, "27"]; })
  ).forEach(function (r) {
    var low = r[2] === "low", d = low ? "22" : r[2];
    wAdd(wHood(r[0], r[0], r[1] + "\" Pro " + (low ? "low-profile" : d + "\" deep") + " wall hood", { pages: "pp.140–149", page: "p.141", label: "Wall hood", type: "wall",
      w: String(r[1]), d: d, unitH: low ? "10" : "18", bandMin: "30", bandMax: "36", ductSize: 10, ductDir: low ? "either" : "vertical",
      power: wHoodPower("Above the hood: within 6\" of its top, ending 5\" in from its right end (p.145)"),
      duct: wDuct(10, low ? "Adjustable discharge" : "Vertical discharge (horizontal kit available)"),
      notes: "Bottom of the hood 30\"–36\" above the countertop. At least as wide as the cooking surface; a 27\" deep hood is recommended over a charbroiler or griddle (p.144)." }));
  });
  [36, 42, 48, 54].forEach(function (n) {
    wAdd(wHood("PWC" + n + "2418", "PWC" + n + "2418", n + "\" Pro wall chimney hood", { pages: "pp.140–149", page: "p.142", label: "Wall chimney hood", type: "wall",
      w: String(n), d: "24", unitH: "18", bandMin: "30", bandMax: "36", ductSize: 10,
      power: wHoodPower("Above the hood: within 6\" of its top, ending 5\" in from the chimney's right side (p.145)"), duct: wDuct(10, "Vertical discharge"),
      notes: "Bottom of the hood 30\"–36\" above the countertop (p.144)." }));
  });
  [36, 42, 54, 66].forEach(function (n) {
    wAdd(wHood("PI" + n + "3418", "PI" + n + "3418", n + "\" Pro island hood", { pages: "pp.140–149", page: "p.142", label: "Island hood", type: "island",
      w: String(n), d: "34", unitH: "18", bandMin: "30", bandMax: "36", ductSize: 10,
      power: wHoodPower("Through the top of the hood (p.145)"), duct: wDuct(10, "Vertical discharge"),
      notes: "Bottom of the hood 30\"–36\" above the countertop; 3\" wider than the cooking surface on each side (p.144)." }));
  });
  [36, 48, 60].forEach(function (n) {
    wAdd(wHood("PW" + n + "3318O", "PW" + n + "3318O", n + "\" Pro outdoor wall hood", { pages: "pp.140–149", page: "p.143", label: "Outdoor wall hood", type: "wall", under: "range",
      w: String(n), d: "33", unitH: "18", bandMin: "36", bandMax: "42", ductSize: 10,
      power: wHoodPower("Above the hood: within 6\" of its top, ending 5\" in from its right end (p.145)", { need: "Dedicated 120 VAC, 15 A, GFCI", note: "GFCI required outdoors." }),
      duct: wDuct(10, "Vertical discharge"),
      notes: "Bottom of the hood 36\"–42\" above the countertop (p.144)." }));
  });
  /* cooktop hoods, ceiling hood, downdraft */
  [["VW30B", 30], ["VW36B", 36], ["VW45B", 45], ["VW30S", 30], ["VW36S", 36], ["VW36G", 36], ["VW45G", 45]].forEach(function (r) {
    wAdd(wHood(r[0], r[0], r[1] + "\" cooktop wall hood", { pages: "pp.124–128", page: "pp.125–128", label: "Cooktop wall hood", type: "wall", under: "cooktop",
      w: String(r[1]), d: /S$/.test(r[0]) ? "22" : "19 1/4", unitH: "", bandMin: "24", bandMax: "36", ductSize: 6,
      power: wHoodPower("Inside the chimney, 20\" or more above the hood's bottom edge (p.128)"), duct: wDuct(6, "Vertical discharge, telescopic chimney"),
      notes: "Bottom of the hood 24\"–36\" above the countertop. For a range or rangetop a Pro hood is recommended (p.128)." }));
  });
  [["VI42B", 42], ["VI42S", 42], ["VI45G", 45]].forEach(function (r) {
    wAdd(wHood(r[0], r[0], r[1] + "\" cooktop island hood", { pages: "pp.124–128", page: "pp.125–128", label: "Cooktop island hood", type: "island", under: "cooktop",
      w: String(r[1]), d: "26 1/2", unitH: "", bandMin: "24", bandMax: "36", ductSize: 6,
      power: wHoodPower("On the ceiling inside the top of the hood (p.128)"), duct: wDuct(6, "Vertical discharge"),
      notes: "Bottom of the hood 24\"–36\" above the countertop (p.128)." }));
  });
  [["VC36S", "34 1/2"], ["VC36W", "34 1/2"], ["VC48S", "46 1/4"], ["VC48W", "46 1/4"]].forEach(function (r) {
    var n = /36/.test(r[0]) ? 36 : 48;
    wAdd(wHood(r[0], r[0], n + "\" ceiling-mounted hood", { pages: "pp.129–133", page: "p.133", label: "Ceiling opening", type: "insert", under: "cooktop",
      w: r[1], d: "20", unitH: "", bandMin: "36", bandMax: "84", ductSize: 6,
      power: wHoodPower("In the ceiling opening as drawn (p.132); 12\" of Romex left for the connection", { need: "Dedicated 120 VAC, 15 A" }),
      duct: wDuct(6, "6\" round with an internal blower (any direction); 10\" round, vertical, with in-line or remote"),
      requires: ["Frame the ceiling opening " + r[1] + "\" × 20\" to carry 100 lb, joists 12 3/8\"–17 3/4\" deep (p.133)."],
      notes: "Bottom of the hood 36\"–84\" above the countertop (p.131). Ships without a blower." }));
  });
  [["DD30", "27 1/2"], ["DD36", "33 1/2"], ["DD45", "39 1/2"]].forEach(function (r) {
    var e = wEntry(r[0], r[0], "ventilation", r[0].slice(2) + "\" downdraft", "pp.134–139",
      [{ key: "power", label: "Power", need: "Dedicated 120 VAC, 15 A · 3-prong, 2 1/2' cord", plane: "below", zone: { kind: "any", plane: "below" },
         where: "In the cabinet below as drawn — some installs need it in an adjacent cabinet (p.136)", note: "GFCI not recommended." }],
      [{ key: "standard", label: "Behind a cooktop", page: "p.137", opening: { w: r[1] }, rule: { w: "exact" },
         dims: { w: { label: "Downdraft cutout width", datum: "the slot behind the cooktop cutout, side to side" } },
         tells: ["Slot behind the cooktop cutout, centred on it"],
         requires: ["Countertop flat and 25 1/8\" deep minimum (p.136).", "Remote control module within 9' of the downdraft and 3\" or more from the cooktop cutout."],
         notes: "The downdraft cutout is 2 11/16\" behind a standard cooktop's cutout (2 5/16\" behind a flush one, pp.137–138); 8 1/4\" back from the cutout, 6\" with the blower rear-mounted. Works with the SRT304 and SRT366 with a trim kit." }]);
    e.formKey = "cooktop";
    wAdd(e);
  });
  /* grills */
  [["OG30", "28 1/2", "33 1/2"], ["OG36", "34 1/2", "39 1/2"], ["OG42", "40 1/2", "45 1/2"], ["OG54", "52 1/2", "57 1/2"]].forEach(function (r) {
    wAdd(wolfGrill(r[0], r[0], r[0].slice(2) + "\" outdoor gas grill", r[1], r[2]));
  });
  wAdd(wEntry("BM13", "BM13", "grill", "13\" outdoor burner module", "pp.112–117",
    [Object.assign(wGas("In the enclosure as drawn (p.117)"), { offPlane: true })],
    [{ key: "standard", label: "Built in", page: "p.117", opening: { w: "12", d: "24 1/4", h: "10" }, rule: { w: "exact", d: "min", h: "exact" },
       tells: ["No insulating liner needed"], requires: [],
       notes: "Beside a grill: 12\" on the rotisserie side, 2\" on the other (p.114). No tank retention — not for a portable LP tank." }]));

  /* ---------- the Cove Design Guide (revised 4/2026) ----------------------
     DW2451 and its water-softener and ADA-height versions. The guide is
     the same unit the Steel Cod package carried, now with the finished
     returns (3 1/2" all round), the ADA height and the panel rule: the
     24" depth assumes a 3/4" panel on a 23 1/4" unit — thicker needs more
     depth when the face is flush (p.6). DW2450 / DW2450WS are not in this
     guide; they stay off the library until their own sheet is here. */
  var CG = "Cove Design Guide 4/2026";
  function coveDw(model, prefix, appliance, ada) {
    var h = ada ? "32 1/2" : "34 1/2", ph = ada ? "28 3/8" : "30 3/8";
    function v(key, label, w, pw) {
      return { key: key, label: label, page: "p.6", opening: { w: w, d: "24", h: h }, rule: { w: "exact", d: "min", h: "exact" },
        panel: { width: pw, height: ph, thickness: "1/2\" min (3/4\" typical)", weight: "20 lb max with the handle (under 18 lb optimal)", page: "p.8" },
        panelRule: { assumedIn: 0.75, minIn: 0.5, unitDepthIn: 23.25, faceFlush: true, page: "p.6" },
        tells: [w === "24" ? "Opening measures a true 24\" wide" : "Opening measures 23 5/8\" wide — minimum reveals", "3 1/2\" finished returns on all sides"],
        requires: ["Finish the 3 1/2\" returns on all sides to match the cabinetry.",
                   "Route the power cord and water line through the side of the opening within 2\" of the back wall, 1 1/2\"–7\" off the floor."],
        notes: (w === "24" ? "Reveals are larger than at 23 5/8\" unless the panel is widened. " : "Minimum reveals; ideal for new construction. ") +
          "Panel 1/4\" narrower than the opening; panel height assumes a 4\" toe kick and 1/8\" top reveal (minimum panel " + (ada ? "26\"" : "28\"") + "). " +
          "Unit adjusts " + (ada ? "31 7/8\"–32 7/8\"" : "33 3/4\"–34 3/4\"") + " tall (p.5). A kickplate over 3 3/8\" tall is notched at its upper right for air (p.9).",
        prep: szReturn(["both", "top"]) };
    }
    return { brand: "Cove", model: model, prefix: prefix, category: "dishwasher", appliance: appliance, pages: CG + " pp.4–10", source: CG, panelReady: true,
      utilities: [
        { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A · 3-prong, 6' cord", offPlane: true,
          where: "In the adjacent cabinet, either side — the cord passes through the side of the opening within 2\" of the back wall, 1 1/2\"–7\" off the floor (p.7)",
          note: "A GFCI outlet or breaker may be required by local code." },
        { key: "water", label: "Water supply", need: "Hot · 3/8\" female compression, 5' braided tubing · 30–140 psi", offPlane: true,
          where: "In the adjacent cabinet, routed through the same side window as the cord (p.7)", note: "Easily reached shutoff between the supply and the unit." },
        { key: "drain", label: "Drain", need: "5' corrugated tubing (extendable 5')", offPlane: true,
          where: "Standpipe or disposer connection 20\"–43\" above the bottom of the leveling legs (p.7)" }
      ],
      variations: [v("60cm", "60 cm install", "23 5/8", "23 3/8"), v("24in", "24\" install", "24", "23 3/4")] };
  }
  var COVE_GUIDE_MODELS = [
    coveDw("DW2451WS", "DW2451WS", "24\" dishwasher with water softener — panel ready", false),
    coveDw("DW2451/ADA", "DW2451ADA", "24\" dishwasher, ADA height — panel ready", true),
    coveDw("DW2451WS/ADA", "DW2451WSADA", "24\" dishwasher with water softener, ADA height — panel ready", true)
  ];
  /* the Steel Cod DW2451 keeps its entry and its variation keys (walks
     point at them); the guide adds the returns, the depth rule and the
     side routing window */
  MODELS.forEach(function (m) {
    if (m.model !== "DW2451") return;
    var g = coveDw("DW2451", "DW2451", m.appliance, false);
    m.utilities = g.utilities; m.source = CG; m.pages = m.pages + " · " + CG + " pp.4–10";
    m.variations.forEach(function (v) {
      var gv = variationOf(g, v.key);
      if (!gv) return;
      v.panelRule = gv.panelRule; v.prep = gv.prep;
      v.requires = gv.requires; v.notes = gv.notes; v.tells = gv.tells;
    });
  });
  Array.prototype.push.apply(MODELS, W_GUIDE_MODELS.concat(COVE_GUIDE_MODELS));

  /* ---------- Steel Cod sheets for the top-sold models (Oct 2026) ---------
     Cayden, 27 Oct: three Steel Cod spec books for the 100 most-sold
     models the library did not know (quotes Q00085212, Q00085215,
     Q00085216). Each entry below was read off its manufacturer sheet; every
     number in it is printed on the cited book page, and the verbatim text
     behind each one is kept in docs/steelcod-top100-sources.json (a script
     checked all of them against the page text). Where a sheet only gives the
     unit's size, the entry has no opening and the tech measures the space
     (`measure`); where a connection is drawn but not dimensioned, it is
     "anywhere" with words; `sheetGaps` says what each sheet leaves out. */
  var SC = "Steel Cod sheets 10/2026";
  var SC_SHEET_MODELS = [{"brand":"Zephyr","model":"PRB24C01CG","prefix":"PRB24C01CG","category":"beverage","appliance":"24\" single-zone beverage cooler","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.12–13","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Sheet gives no rough-opening (cutout) dimensions, only the unit size and height adjustment range","No outlet location, receptacle type or cord length printed","No ventilation or side/top clearance requirement printed beyond the hinge-side wall clearance","Door-swing angle shown on the top view is not in the text layer; not used"],"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz, max 1.0A","where":"Sheet does not show an outlet location","page":"p.13"}],"measure":true,"variations":[{"key":"undercounter","label":"Built-in / undercounter","page":"p.13","opening":{},"rule":{},"tells":["Glass door with stainless frame, set under the countertop between cabinets","Sheet lists installation type as Compact / Built-in / Freestanding"],"requires":["Leave at least 2-1/4\" between the hinge side of the unit and a wall so the door can open"],"notes":"Sheet gives unit size only: 23-7/8\"W x 33-15/16\"H x 23-3/8\"D; height adjusts 33-15/16\" - 34-15/16\". Side view depth 25-3/16\" overall (23-3/8\" body). Top view shows 45-15/16\" overall depth with the door open. Weight 112 lbs.","noOpening":true}]},{"brand":"Sharp","model":"SMD2470ASY","prefix":"SMD2470ASY","category":"microwave","appliance":"24\" microwave drawer","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.14–15","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Sheet says the page is 'measurements only' and refers to the installation manual for installation","Standard-mount width/height carry no min/max word; treated as minimums","Outlet zone (D 5\", F 4\") is not referenced to the opening edges, so no zone coordinates given; receptacle type and cord length not printed","Anti-tip block reference edges (A, E, H) are not fully clear from the drawing","Flush-mount K, L, I dimensions are not labeled in the key; the 1-3/4\" shelf setback comes from the drawing note (the key's O. 1-3/4\")"],"utilities":[{"key":"power","label":"Power","need":"120V, 60Hz, 1.67kW, 14.5 Amps","where":"Suggested electrical outlet location (B) drawn at the upper left of the back wall, shaded zone dimensioned D 5\" and F 4\"; not tied to the opening edges","zone":{"kind":"any"},"page":"p.15"}],"variations":[{"key":"standard","label":"Standard mount","page":"p.15","opening":{"w":"22 1/8","d":"23 1/2","h":"15 9/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front overlaps the cabinet face (trim overlap at the sides and top)","Opening is narrower than the 24\" cabinet, with face frame showing around the drawer"],"requires":["Base cabinet at least 24\" wide","Floor must support 100 lb","Allow 1/4\" min. space between the top of the opening and the countertop","Anti-tip block is required (location per drawing: A 6\", E 3-1/2\", H 14-13/16\" to bottom of anti-tip block)"],"notes":"Drawer front overlaps the opening 7/8\" at the sides and 1/4\" at the top. Drawing assumes a 36\" countertop height. Unit 23-7/8\" x 15-7/8\" x 23\" (W x H x D), 74.0 lbs. Sheet says these are measurements only; follow the installation manual."},{"key":"flush","label":"Flush mount (with deflector vent kit)","page":"p.15","opening":{"w":"24 3/16","d":"23 1/2","h":"16 7/8"},"rule":{"w":"range","d":"min","h":"min"},"tells":["Drawer front sits flush with the cabinet faces","Shelf under the drawer is set back from the cabinet face"],"requires":["Face of the shelf must sit 1-3/4\" back from the face of the cabinet","Flush mount deflector vent kit (SKMD24F0AS) is sold separately and needed for flush mount","Floor must support 100 lb","Anti-tip block is required (H 14-13/16\" to bottom of anti-tip block per drawing)"],"notes":"Other flush-mount drawing dims: K 22-1/8\", L 1-3/4\", I 1-1/16\" (meaning not labeled in the key). Unit 23-7/8\" x 15-7/8\" x 23\" (W x H x D).","openingMax":{"w":"24 1/2"}}]},{"brand":"Bosch","model":"SHV78CM3N","prefix":"SHV78CM3N","category":"dishwasher","appliance":"24\" custom-panel dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.26–29","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The page-27 drawing shows an opening-height range, opening-width range and other dimensions as graphics only (not in the text layer); only the spec-table cutout size is used","Custom panel width is not printed in the text (only a template size); verify panel width with the installation template","Hole zone '7\"' and '2 1/2\"' read from the drawing as height above floor and distance from the back wall — verify","No water line size or drain connection size printed","Spec table gives a 78 3/4\" outlet hose while the drain page says 79\""],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 12 Amps (1440 W) · 3-prong plug power cord included · cord full length 67\" · hard-wire junction box sold separately (SMZPCJB1UC)","where":"All connections are at the rear of the unit. Drawing shows the receptacle in the adjacent cabinet, reached through a Ø 2 1/2\" hole in the left or right cabinet wall at the back, near the floor (hole zone dimensioned 7\" and 2 1/2\"). Cord install length from edge of unit facing the door: Left 45\", Right 56\".","offPlane":true,"plane":"adjacent","page":"p.27"},{"key":"water","label":"Water","need":"Minimum water pressure 14 lb/sin (as printed); supply hose kit sold separately (SMZSH1ABUC)","where":"Inlet at the rear of the unit; line passes through the Ø 2 1/2\" side-wall hole to the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.26"},{"key":"drain","label":"Drain","need":"Pre-connected drain hose, 79\" long, extendable to 155 3/4\" max with kit SGZ1010UC","where":"Hose runs through the side-wall hole to the sink cabinet; part of the hose must be raised between 33\" min. and 43\" max. above the cabinet floor","note":"Spec table lists outlet hose length 78 3/4\"","offPlane":true,"plane":"adjacent","page":"p.28"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.26","opening":{"w":"24","d":"24","h":"33 7/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Door carries a custom wood panel matching the cabinets","No visible handle or controls on the door face"],"requires":["Top of the dishwasher must be flush with or lower than the adjacent cabinets","A Ø 2 1/2\" hole is required in the left or right cabinet wall for water, drain and electrical","Custom panel: overall length no more than 30 1/8\", at least 3/4\" thick, weight 7 to 24 lbs"],"notes":"Unit 33 7/8\" x 23 9/16\" x 23 1/16\" (HxWxD), net weight 93 lbs. Factory set for panel weights 11 to 18 lbs; other weights need Bosch customer service.","panel":{"height":"30 1/8\" max overall length","thickness":"3/4\" min","weight":"7 to 24 lbs (factory set for 11 to 18 lbs)","page":"p.29"},"panelRule":{"minIn":0.75,"page":"p.29"}}]},{"brand":"Scotsman","model":"SCN60PA-1SU","prefix":"SCN60PA-1SU","category":"icemaker","appliance":"15\" undercounter nugget ice machine (built-in drain pump)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.30–33","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Sheet gives no rough-opening dimensions, only unit size; opening height must suit the 33 3/8\"-34 3/8\" unit and the panel math","Outlet, water stub and drain locations in the cabinet are not specified; positions given are on the unit's rear","Model row for -1SU shows no finish in the text layer (drawing table shows it); panel-ready set from 'Accepts custom wood panel'","Rear-view dimension reference edges (which side) not stated","Maximum water temperature printed inconsistently (90°F in table, 100ºF in the note)"],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115/60/1, 5 amps · 115V power cord","where":"Cord exits at the lower rear of the unit (rear-view drawing: 7 1/2\" and 11 5/8\" from the side, 2 1/2\" up); outlet location not specified","note":"Voltage tolerance -10% / +10%","zone":{"kind":"any"},"page":"p.31"},{"key":"water","label":"Water","need":"1/4\" O.D. copper water inlet, compression fitting provided; supply hose not included; 20-80 PSIG; water 40°F min.","where":"Inlet at the upper rear of the unit (rear-view drawing: 2 3/4\" from the side, 5 1/8\" down)","zone":{"kind":"any"},"page":"p.31"},{"key":"drain","label":"Drain","need":"Built-in drain pump; 3/8\" I.D. flexible drain tubing included (10' drain tube)","where":"Drain access at the lower rear of the unit (3 1/4\" up on the rear-view drawing); pump can push to a drain away from the unit","zone":{"kind":"any"},"page":"p.31"}],"measure":true,"variations":[{"key":"undercounter","label":"Undercounter","page":"p.31","opening":{},"rule":{},"tells":["15\" wide unit under the countertop","Door takes a custom wood panel (or stainless door kit)"],"requires":["Custom panel: 14 7/8\" wide, 29 3/8\" to 30 3/8\" tall, 5/8\" to ¾\" thick, not over 15 lb","Panel length = cabinet opening height (floor to bottom of countertop edge) minus kickplate space minus 1/8 or more top clearance","Power, water and drain within the operating limits: water pressure 20-80 PSIG, air 50°F-100°F"],"notes":"Sheet gives unit size only: 14.875\" x 22.75\" x 33.375\" (W x D x H, legs not adjusted); drawn height 33 3/8\" min. to 34 3/8\" max. with 1\" leg adjustment. Depth 22\" body plus 3/4\" sheet metal door front if door kit installed; 2 3/8\" door kit and handle. Cabinet door .63 min. Shipping weight 129 lb. Approved for indoor or outdoor use. In a corner the door swing may be limited by the handle.","noOpening":true,"panel":{"width":"14 7/8","height":"29 3/8 to 30 3/8","thickness":"5/8\" to ¾\"","weight":"15 lb max","page":"p.32"},"panelRule":{"minIn":0.625,"maxIn":0.75,"page":"p.32"}}]},{"brand":"Zephyr","model":"PRWB24C32CG","prefix":"PRWB24C32CG","category":"wine","appliance":"24\" French-door dual-zone wine & beverage cooler","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.34–35","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Sheet gives no rough-opening (cutout) dimensions, only the unit size and height adjustment range","No outlet location, receptacle type or cord length printed","Meaning of the 12-3/8\" top-view dimension (door leaf) is read from the drawing"],"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz, max 1.5A","where":"Sheet does not show an outlet location","page":"p.35"}],"measure":true,"variations":[{"key":"undercounter","label":"Built-in / undercounter","page":"p.35","opening":{},"rule":{},"tells":["Two glass French doors with stainless frames under the countertop","Sheet lists installation type as Compact / Built-in / Freestanding"],"requires":["Leave at least 2-1/4\" between the side of the unit and a wall so the door can open","Two handles needed; one included"],"notes":"Sheet gives unit size only: 23-7/8\"W x 33-7/8\"H x 23-3/8\"D; height adjusts 33-7/8\" - 34-7/8\". Side view depth 25-1/4\" overall (23-3/8\" body). Top view shows 34-1/4\" overall depth with doors open; 12-3/8\" door leaf. Weight 130 lbs.","noOpening":true}]},{"brand":"Zephyr","model":"AK9234BS","prefix":"AK9234BS","category":"ventilation","appliance":"36\" hood insert (Monsoon I)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.36–37","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Insert height (drawn 12\") is not legible in the text layer; hood.h omitted","Electrical knockout and duct-collar positions are on the insert, not on a wall; no wall zone given","Cut-out size carries no min/max word; treated as minimum"],"utilities":[{"key":"power","label":"Power","need":"120V, 60Hz, max 5A","where":"Electrical knockouts on the insert's top and back: on top 12-1/4\" from the centerline (36\"), on back 11-15/16\" from the centerline (36\"); bring power into the custom hood near there","zone":{"kind":"any"},"page":"p.36"},{"key":"vent","label":"Duct","need":"8\" Round duct (vertical or horizontal internal blower)","where":"Top duct collar on the centerline, 5-5/8\" from the back (30\"/36\")","zone":{"kind":"any"},"page":"p.36"}],"variations":[{"key":"insert","label":"Insert in custom hood","page":"p.36","opening":{"w":"34 5/8","d":"19 1/2","h":"24"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom wood or plaster hood with a stainless liner/insert underneath","Baffle filters visible from below"],"requires":["Cut-out in the bottom of the custom hood 34-5/8\" x 19-1/2\"","Bottom of hood 24\" to 36\" above the top of a 36\" tall cooking surface","8\" round duct (vertical or horizontal blower outlet)"],"notes":"Insert 34-3/8\" x 19-1/4\". Blower 200 - 600 CFM; ACT can limit max to 390 or 290 CFM for code. Optional make-up air kit MUA006A.","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"8\" round (vertical or horizontal)"},"w":"34-3/8","d":"19-1/4","jbox":"Electrical knockouts on the insert's top and back: on top 12-1/4\" from the centerline (36\"), on back 11-15/16\" from the centerline (36\"); bring power into the custom hood near there"}}]},{"brand":"Zephyr","model":"AK9246BS","prefix":"AK9246BS","category":"ventilation","appliance":"48\" hood insert (Monsoon I)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.36–37","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Insert height (drawn 12\") is not legible in the text layer; hood.h omitted","Electrical knockout and duct-collar positions are on the insert, not on a wall; no wall zone given","Cut-out size carries no min/max word; treated as minimum","Horizontal blower discharge listed as NA for this size"],"utilities":[{"key":"power","label":"Power","need":"120V, 60Hz, max 7A","where":"Electrical knockouts on the insert's top and back: on top 18-1/4\" from the centerline (48\"), on back 17-15/16\" from the centerline (48\"); bring power into the custom hood near there","zone":{"kind":"any"},"page":"p.36"},{"key":"vent","label":"Duct","need":"10\" Round duct (vertical internal blower)","where":"Top duct collar on the centerline, 5-7/8\" from the back (42\"/48\"), collar Ø 9-3/4\"","zone":{"kind":"any"},"page":"p.36"}],"variations":[{"key":"insert","label":"Insert in custom hood","page":"p.36","opening":{"w":"46 5/8","d":"19 1/2","h":"24"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom wood or plaster hood with a stainless liner/insert underneath","Three baffle filters visible from below"],"requires":["Cut-out in the bottom of the custom hood 46-5/8\" x 19-1/2\"","Bottom of hood 24\" to 36\" above the top of a 36\" tall cooking surface","10\" round duct (vertical blower outlet only; no horizontal option)"],"notes":"Insert 46-3/8\" x 19-1/4\". Blower 450 - 1,200 CFM; ACT can limit max to 590 or 390 CFM for code. Optional make-up air kit MUA010A.","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"10\" round (vertical only)"},"w":"46-3/8","d":"19-1/4","jbox":"Electrical knockouts on the insert's top and back: on top 18-1/4\" from the centerline (48\"), on back 17-15/16\" from the centerline (48\"); bring power into the custom hood near there"}}]},{"brand":"Bosch","model":"SHP78CM5N","prefix":"SHP78CM5N","category":"dishwasher","appliance":"24\" pocket-handle dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.38–40","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Toe-kick and rear-base dimensions on the drawing are not labeled; not used","Hole zone '7\"' and '2 1/2\"' read from the drawing as height above floor and distance from the back wall — verify","No water line size or drain connection size printed","Spec table gives a 78 3/4\" outlet hose while the drain page says 79\""],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 12 Amps (1440 W) · 3-prong plug power cord included · cord full length 67\" · hard-wire junction box sold separately (SMZPCJB1UC)","where":"All connections are at the rear of the unit. Drawing shows the receptacle in the adjacent cabinet, reached through a Ø 2 1/2\" hole in the left or right cabinet wall at the back, near the floor (hole zone dimensioned 7\" and 2 1/2\"). Cord install length from edge of unit facing the door: Left 45\", Right 56\".","offPlane":true,"plane":"adjacent","page":"p.39"},{"key":"water","label":"Water","need":"Minimum water pressure 14 lb/sin (as printed); supply hose kit sold separately (SMZSH1ABUC)","where":"Inlet at the rear of the unit; line passes through the Ø 2 1/2\" side-wall hole to the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.38"},{"key":"drain","label":"Drain","need":"Pre-connected drain hose, 79\" long, extendable to 155 3/4\" max with kit SGZ1010UC","where":"Hose runs through the side-wall hole to the sink cabinet; part of the hose must be raised between 33\" min. and 43\" max. above the cabinet floor","note":"Spec table lists outlet hose length 78 3/4\"","offPlane":true,"plane":"adjacent","page":"p.40"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.39","opening":{"w":"23 5/8","d":"24","h":"33 7/8"},"rule":{"w":"range","d":"min","h":"min"},"tells":["Stainless door with a recessed pocket handle at the top","Controls on the top edge of the door"],"requires":["A Ø 2 1/2\" hole is required in the left or right cabinet wall for water, drain and electrical"],"notes":"Unit height adjusts 33 7/8\"-35\"; 23 9/16\" wide, 23 3/4\" deep (HxWxD table). Net weight 96 lbs.","openingMax":{"w":"24 1/4"}}]},{"brand":"Scotsman","model":"SCCP50MB-1SU","prefix":"SCCP50MB-1SU","category":"icemaker","appliance":"15\" undercounter gourmet clear ice machine (built-in drain pump)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.41–43","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Sheet gives no rough-opening dimensions, only unit size; opening height must suit the 33 3/8\"-34 3/8\" unit and the panel math","Outlet, water stub and drain locations in the cabinet are not specified; positions given are on the unit's rear and their reference edges are read from the drawing","Model row for -1SU shows no finish in the text layer; panel-ready set from 'Accepts custom wood panels'"],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115/60/1, 5 amps, maximum fuse size 15 · 115 V power cord","where":"Cord exits at the lower rear of the unit (rear-view drawing: 7 3/8\" from the side); outlet location not specified","note":"Voltage tolerance -10% / +10%","zone":{"kind":"any"},"page":"p.42"},{"key":"water","label":"Water","need":"Potable water inlet, 1/4\" compression fitting; supply hose not included; 20-80 PSIG; water 40°F-100°F","where":"Inlet at the lower rear of the unit (rear-view drawing: 3 1/4\" up, 1 1/2\" from the side)","zone":{"kind":"any"},"page":"p.42"},{"key":"drain","label":"Drain","need":"Built-in drain pump; 3/8 I.D. flexible drain tubing included (10' drain tube)","where":"Drain at the lower rear of the unit (rear-view drawing: 2 1/2\" up, 3 3/4\" from the side)","zone":{"kind":"any"},"page":"p.42"}],"measure":true,"variations":[{"key":"undercounter","label":"Undercounter","page":"p.42","opening":{},"rule":{},"tells":["15\" wide unit under the countertop","Door takes a custom wood panel (or stainless door kit)"],"requires":["Custom panel: 14 7/8\" wide, 29 3/8\" to 30 3/8\" tall, 5/8\" to ¾\" thick, not over 15 lbs","Panel length = cabinet opening height (floor to bottom of countertop edge) minus kickplate space minus 1/8\" or more top clearance","Water pressure 20-80 PSIG; air 50°F-100°F"],"notes":"Sheet gives unit size only: 14.875\" x 22\" x 33.375\" (W x D x H, legs not adjusted); drawn height 33 3/8\" Min. to 34 3/8\" Max. with 1\" leg adjustment. Door & handle add 1 5/8\" to the 22\" depth; .75 sheet metal door front; .63 min cabinet door. Shipping weight 118 lb. Indoor & outdoor rated. In a corner the door swing may be limited by the handle.","noOpening":true,"panel":{"width":"14 7/8","height":"29 3/8 to 30 3/8","thickness":"5/8\" to ¾\"","weight":"15 lbs max","page":"p.43"},"panelRule":{"minIn":0.625,"maxIn":0.75,"page":"p.43"}}]},{"brand":"KitchenAid","model":"KDTM604KPS","prefix":"KDTM604KPS","category":"dishwasher","appliance":"24\" top-control dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.44–50","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Shaded utility areas are on the side walls; their dimensions (4\", 3\", 6 1/4\", 2\") are read from the drawing and their reference edges are not labeled, so no zone coordinates given","Opening depth 24\" has no min/max word; treated as minimum","Sheet is a family planning guide (applies to many KDT/KDF/KDP models); model-specific spec pages are garbled in the text layer","Opening height: the drawing labels 33 5/8\" minimum but note A says it is only reachable by removing feet and insulation; normal-install height not stated separately"],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused supply · direct wire, or UL listed power cord kit into a grounded 3 prong outlet (cord not included) · copper wire only","where":"Shaded areas of the side cabinet walls show where utility connections may be made: near the floor at the back of the left wall (dims 4\" and 3\") and of the right wall (dims 6 1/4\" and 2\")","note":"May share a circuit with a disposer if the branch circuit rating allows; time-delay fuse or breaker recommended","offPlane":true,"plane":"adjacent","page":"p.49"},{"key":"water","label":"Water","need":"Hot water line, 20 psi to 120 psi, 120°F at dishwasher; 3/8\" O.D. copper tubing with compression fitting or flexible braided supply line; 90° elbow with 3/4\" hose connection","where":"Through the shaded side-wall areas (see power)","note":"Do not solder within 6\" of the water inlet valve; 1/2\" plastic tubing not recommended","offPlane":true,"plane":"adjacent","page":"p.50"},{"key":"drain","label":"Drain","need":"Drain hose supplied (fits 1\" drain connector) to waste tee or disposer inlet above the trap and 20\" minimum above the floor, or use an air gap; 1/2\" minimum I.D. drain fittings","where":"Through the shaded side-wall areas to the sink cabinet","note":"Replacement hose max length 12 ft","offPlane":true,"plane":"adjacent","page":"p.50"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.49","opening":{"w":"24","d":"24","h":"33 5/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Stainless door with a towel-bar handle","Controls hidden on the top edge of the door"],"requires":["Opening height is measured from the lowest point on the underside of the countertop; 33 5/8\" only works by removing the feet and the perforated top insulation","Corner locations need 2\" minimum between the side of the door and the wall or cabinet","No protrusions on the opening surfaces"],"notes":"Unit 23 15/16\" door width, 33 5/8\" tall (can be raised 1 7/16\" with feet extended), 22 5/8\" deep without door, 26 7/8\" deep with towel-bar handle, 50 3/16\" deep with door fully open. Adjustable toe kick 3 5/16\" min - 4 11/16\" max. Insulation blanket can be crushed up to 1/8\"."}]},{"brand":"KitchenAid","model":"KOED530PSS","prefix":"KOED530PSS","category":"ovens","appliance":"30\" electric double wall oven","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.51–56","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The KOED530PSS kW rating is not legible in the text layer (spec pages are garbled), so the sheet does not settle 40 A vs 20 A for this model — check the rating plate / install manual","Flush section note also gives a larger minimum cutout depth (25 3/8\", 64.4 cm) than the key's 25\"; the fraction is garbled in the text layer, so 25\" is used — verify which governs","Cleat run length (front-to-back) not dimensioned except the 2\" spacers 'entire depth of the cutout'; whether cleats must be finished is not stated","Standard-install opening depth 24\" has no min/max word; treated as minimum","Pages 57-60 duplicate 53-56; 61-68 are French/Spanish versions and were not used"],"utilities":[{"key":"power","label":"Power","need":"Hard-wired (240 V or 208 V) to a junction box through the 66\" flexible conduit (do not cut); separate 40 A circuit for models rated 7.3 to 9.6 kW at 240 V (5.4 to 7.4 kW at 208 V), separate 20 A circuit for 4.8 kW and below at 240 V; fuse both sides of the line","where":"Wall-cabinet install: junction box 3\" maximum below the oven support surface, with a 1\" minimum hole in the right rear or left rear corner of the support surface. Flush drawing shows the recommended junction box location in the cabinet below at the upper left/right. Undercounter: adjacent right or left cabinet recommended.","note":"12\" from back of control panel to start of strain relief","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.54"}],"variations":[{"key":"standard","label":"Standard (trim overlaps cabinet)","page":"p.55","opening":{"w":"28 1/2","d":"24","h":"50"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Oven frame overlaps the cabinet face around the cutout","Cabinet face is visible around the oven only beyond the trim"],"requires":["Cabinet at least 30\" wide","Bottom of cutout 7 1/2\"-14 3/4\" above the floor (14 3/4\" recommended)","1\" from top of cutout to bottom of upper cabinet door; 1 1/2\" minimum from bottom of cutout to top of lower cabinet door","Oven support surface must be solid, level and flush with the bottom of the cutout; recessed area must fully enclose the oven","For cutouts taller than 50 3/8\" contact service for the tall shield"],"notes":"Recommended cutout height 50 1/4\". Unit: 29 3/4\" overall width, 51 3/4\" maximum overall height, recessed part 28 7/16\" max wide x 48 13/16\" high x 23 1/4\" max deep. Floor must support 330 lbs (sheet's figure for 30\" models). Cabinet materials must withstand 194°F.","openingMax":{"h":"52 3/16"}},{"key":"flush-inset","label":"Flush inset","page":"p.55","opening":{"w":"30 1/4","d":"25","h":"52"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven face sits flush with the cabinet faces","Small 1/8\" reveal above and below the oven; cleats visible inside the cutout"],"requires":["Install 3/4\" top cleat, 11/16\" side cleats and 2\" spacers the entire depth of the cutout, all recessed 1 3/8\" from the cabinet front","Exposed areas of the cabinet must be finished to match","Bottom of cutout 4 5/8\"-32\" above the floor"],"notes":"28 7/8\" minimum width of opening between cleats; 51 1/4\" recommended cutout height (E). Bottom: 1/4\" recommended with foot; 15/16\" to 1 1/8\" allowable without foot. Top and bottom gaps of 1/8\" above and below the oven. Recommended junction box location drawn in the cabinet below, at the upper left and right.","prep":[{"kind":"cleat","label":"Top cleat","strip":{"face":"top","setbackIn":"1 3/8","thicknessIn":"3/4"},"finished":false,"note":"Cleats and spacers must be recessed 1 3/8\" from the front of the cabinet"},{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"11/16"},"finished":false,"note":"Cleats and spacers must be recessed 1 3/8\" from the front of the cabinet"},{"kind":"blocking","label":"Side spacers, full depth","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"2"},"finished":false,"note":"2\" spacer the entire depth of the cutout"}]}]},{"brand":"Zephyr","model":"AK9346BS","prefix":"AK9346BS","category":"ventilation","appliance":"48\" hood insert (Monsoon II)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.69–70","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Insert depth (drawn 22-1/2\") and height (drawn 12\") are not legible in the text layer; hood.d and hood.h omitted","Electrical knockout and duct-collar positions are on the insert, not on a wall; no wall zone given","Cut-out size carries no min/max word; treated as minimum","Note: this is the 48\" Monsoon II (46-3/8\" insert), different from the AK9246BS Monsoon I"],"utilities":[{"key":"power","label":"Power","need":"120V, 60Hz, max 7A","where":"Electrical knockouts on the insert's top and back, 18\" from the centerline (46\" model); bring power into the custom hood near there","zone":{"kind":"any"},"page":"p.69"},{"key":"vent","label":"Duct","need":"10\" Round duct (vertical internal blower)","where":"Top duct collar on the centerline, 5-5/8\" from the back","zone":{"kind":"any"},"page":"p.69"}],"variations":[{"key":"insert","label":"Insert in custom hood","page":"p.69","opening":{"w":"46 5/8","d":"22 3/4","h":"24"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom wood or plaster hood with a stainless liner/insert underneath","Three baffle filters visible from below"],"requires":["Cut-out in the bottom of the custom hood 46-5/8\" x 22-3/4\"","Bottom of hood 24\" to 36\" above the top of a 36\" tall cooking surface","10\" round duct (vertical blower only)"],"notes":"Insert width 46-3/8\" (48\" class). Blower 450 - 1,200 CFM; ACT can limit max to 590 or 390 CFM for code. Optional make-up air kit MUA010A.","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"10\" round (vertical only)"},"w":"46-3/8","jbox":"Electrical knockouts on the insert's top and back, 18\" from the centerline (46\" model); bring power into the custom hood near there"}}]},{"brand":"Zephyr","model":"PRW24C02CG","prefix":"PRW24C02CG","category":"wine","appliance":"24\" dual-zone wine cooler","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.71–72","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Sheet gives no rough-opening (cutout) dimensions, only the unit size and height adjustment range","No outlet location, receptacle type or cord length printed","No ventilation or side/top clearance requirement printed beyond the hinge-side wall clearance"],"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz, max 1.0A","where":"Sheet does not show an outlet location","page":"p.72"}],"measure":true,"variations":[{"key":"undercounter","label":"Built-in / undercounter","page":"p.72","opening":{},"rule":{},"tells":["Glass door with stainless frame, set under the countertop between cabinets","Sheet lists installation type as Compact / Built-in / Freestanding"],"requires":["Leave at least 2-1/4\" between the hinge side of the unit and a wall so the door can open"],"notes":"Sheet gives unit size only: 23-7/8\"W x 33-15/16\"H x 23-3/8\"D; height adjusts 33-15/16\" - 34-15/16\". Side view depth 25-3/16\" overall (23-3/8\" body). Top view shows 45-15/16\" overall depth with the door open. Weight 124 lbs.","noOpening":true}]},{"brand":"KitchenAid","model":"KDTF924PPA","prefix":"KDTF924PPA","category":"dishwasher","appliance":"24\" panel-ready flush dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.73–77","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No location is drawn for the power, water or drain connections.","No separate flush-inset drawing (reveal, cabinet face alignment) despite the flush-to-cabinet name.","The opening width is printed as a range ending in the word Minimum; treated as a range.","The panel-ready product drawing shows panel thickness F 11/16\"-1 3/4\" while the panel page says 5/8\"-1\"; the panel page values are used."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused supply; copper wire; UL-listed dishwasher cord kit to a grounded outlet, or direct wire","where":"Sheet does not show a location","note":"May share a circuit with a disposer if the branch circuit rating allows; GFCI/AFCI breakers are compatible.","page":"p.74"},{"key":"water","label":"Hot water","need":"Hot water line, 20-120 psi, 120°F at the dishwasher; 3/8\" O.D. copper with compression fitting or flexible braided line","where":"Sheet does not show a location","note":"Flush supply lines in new construction before connecting.","page":"p.74"},{"key":"drain","label":"Drain","need":"Drain hose to waste tee or disposer inlet above the trap and 20\" min above the floor; 1/2\" min I.D. fittings; hose extension max 12 ft; air gap if house drain is lower than 20\"","where":"High loop (installer-supplied) goes in the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.74"}],"variations":[{"key":"standard","label":"Undercounter, custom panel","page":"p.76","opening":{"w":"23 5/8","d":"24","h":"32 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["Door has no front controls or handle of its own - a custom wood panel mounts to the door","Opening under the countertop, no cabinet floor, between two base cabinets"],"requires":["Custom door panel 23 9/16\" wide, 28 3/8\"-30\" tall and 5/8\"-1\" thick, weighing no more than 16 lbs together with its handle (handle not included).","If a custom toe kick is installed, size the panel thickness so it is flush with the cabinet toe kick; the dishwasher's metal toe kick must stay.","Installer must add a high loop in the adjacent cabinet when draining to a floor drain."],"notes":"Unit 23 9/16\" wide, 21 7/8\" deep without the custom panel, 32 1/4\"-35 7/16\" tall. Leveling feet are set to a standard height of 33 7/8\" and up. Sheet calls the model flush-to-cabinet but draws only one cabinet opening.","openingMax":{"w":"24 1/4","h":"35 7/16"},"panel":{"width":"23 9/16","height":"28 3/8 - 30","thickness":"5/8\" - 1\"","weight":"16 lb max with handle","page":"p.77"},"panelRule":{"minIn":0.625,"maxIn":1,"unitDepthIn":21.875,"page":"p.77"}}]},{"brand":"Zephyr","model":"AK9434BS","prefix":"AK9434BS","category":"ventilation","appliance":"36\" hood insert (Monsoon Connect)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.78–79","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Sheet does not say whether the hood cutout is exact or minimum.","No house-wiring location on the wall/ceiling is given; only the knockout on the insert.","Duct collar position front-to-back is drawn but is not clearly labeled for the 36\" size."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, max 5 A (single blower); max 8 A with optional dual blower","where":"Electrical knockout on top of the insert, 11 7/8\" right of the duct centerline (36\" size)","page":"p.78"},{"key":"vent","label":"Duct","need":"8\" round duct, vertical or horizontal (single blower); 10\" round vertical with optional dual blower","where":"Duct collar on top of the insert at the centerline","page":"p.79"}],"variations":[{"key":"insert","label":"Insert in custom hood","page":"p.78","opening":{"w":"34 5/8","d":"19 5/8","h":"24"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom wood or plaster hood with an open bottom over the cooktop/range","Liner box framed inside the hood bottom"],"requires":["Cut a 34 5/8\" x 19 5/8\" opening in the bottom of the custom hood.","Set the hood bottom 24\"-36\" above the cooking surface (sheet measures from the top of a 36\" tall cooking surface).","Run 8\" round duct from the insert (10\" round if the optional dual blower is used)."],"notes":"Insert is 34 3/8\" x 19 3/8\" and 12\" tall. Electrical knockout is on top of the insert, 11 7/8\" right of the duct centerline for the 36\" size.","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"8\" round (10\" round with optional dual blower)"},"w":"34 3/8","h":"12","d":"19 3/8","jbox":"Electrical knockout on top of the insert, 11 7/8\" right of the duct centerline (36\" size)"}}]},{"brand":"Thermador","model":"MD24BS","prefix":"MD24BS","category":"microwave","appliance":"microwave drawer","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.94–96","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Outlet box drawn on the back wall but its 4\", 5\" and 14 5/8\" callouts cannot be tied to edges with confidence.","Flush cleat setback from the cabinet face is not printed.","Page 96 text layer is garbled (overlapping layers); numbers were confirmed visually."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A circuit breaker; three-prong plug; 48\" cord","where":"Recommended outlet (A) drawn on the back wall at the upper left of the opening; nearby 4\" and 5\" callouts are not clear enough to set a box","zone":{"kind":"any"},"page":"p.96"}],"variations":[{"key":"standard","label":"Standard (overlay)","page":"p.96","opening":{"w":"22 1/8","d":"23 1/2","h":"15 9/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front overlaps the cabinet face; cutout edges are hidden behind it","Plain cutout with no cleats or finished side strips"],"requires":["Cutout floor (base) must support up to 100 lb.","Anti-tip block must be installed at the top rear of the opening as drawn (block shown 6\" wide).","If under a counter, keep at least 7/16\" clearance to the countertop."],"notes":"Unit 16 5/16\" H x 23 7/8\" W x 23 3/8\" D, 74 lbs. Front overlaps the cabinet at least 7/8\" each side, 3/4\" at top and 1/16\" at bottom. Drawing shows the bottom of the cutout at least 13 1/4\" above the floor."},{"key":"flush","label":"Flush","page":"p.96","opening":{"w":"24 3/16","d":"23 1/2","h":"16 5/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front sits inside the cabinet face, flush with the doors around it","Finished cleats visible on both sides of the drawer front"],"requires":["Sides of the opening must be finished and extend back to the cleats; cleats must be finished too, as they may be visible.","Base (cutout floor) must support up to 100 lb and be at least 21 7/8\" deep.","Anti-tip block must be installed at the top rear of the opening as drawn (block shown 6\" wide).","If under a counter, keep at least 7/16\" clearance to the countertop."],"notes":"Front view: 24 3/16\" between finished sides, 22 1/8\" between the 1\" side cleats, 16 5/8\" tall. Drawing shows the bottom of the cutout at least 13 1/4\" above the floor.","prep":[{"kind":"cleat","label":"Finished side cleats","strip":{"face":"both","thicknessIn":"1"},"finished":true,"note":"Cleats 1\" wide each side, leaving 22 1/8\" between them; setback from the cabinet face is not printed"}]}]},{"brand":"KitchenAid","model":"KOWT100ESS","prefix":"KOWT100ESS","category":"warming","appliance":"30\" slow cook warming drawer","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.99–102","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Amperage is not clearly printed; the product page shows only \"15. 120V.\"","Standard install gives no cutout depth other than the 24\" minimum cabinet depth.","Outlet location is described in words only, with no dimensions."],"utilities":[{"key":"power","label":"Power","need":"120 V grounded outlet, recessed (product page lists electrical as \"15. 120V.\")","where":"Rear wall, upper right-hand side of the cutout, or in an adjacent cabinet with a 1 3/8\" min hole through the back of the cutout or support surface for the cord","zone":{"kind":"any"},"page":"p.100"}],"variations":[{"key":"standard","label":"Standard","page":"p.101","opening":{"w":"28 1/2","d":"24","h":"9 1/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front overlaps the cabinet face","Plain cutout, no cleats or platform"],"requires":["Cabinet at least 30\" wide.","Support surface solid, level and flush with the bottom of the cutout; recessed area fully enclosed.","At least 2 1/2\" between cutouts when stacked; dimension C below the lowest cutout (drawn down to the toe kick/floor) is 1\" minimum / 4 1/4\" recommended."],"notes":"Unit recessed depth 23 1/8\", recessed width 28 1/4\", recessed height 9\", overall width 29 3/4\", drawer front height 10 1/4\". Cannot be leveled after installation."},{"key":"flush","label":"Flush inset","page":"p.102","opening":{"w":"30 1/4","d":"25","h":"10 3/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front sits inside the cabinet face with an even reveal","Finished side cleats and a platform visible around the front"],"requires":["Width between side cleats at least 28 1/4\".","Front faces of the cleats and platform will be visible and must be finished.","Bottom of cutout 8 1/4\" above the floor recommended, 5\" minimum; at least 2 1/2\" between cutouts."],"notes":"Results in a 1/4\" reveal on all sides of the drawer. Side cleats 1\" wide, platform 7/8\"; side cleat front is 1 5/8\" back from the cabinet face (top view).","prep":[{"kind":"cleat","label":"Finished side cleats","strip":{"face":"both","setbackIn":"1 5/8","thicknessIn":"1"},"finished":true,"note":"Front face visible - finish it"},{"kind":"platform","label":"Finished platform","strip":{"face":"bottom","thicknessIn":"7/8"},"finished":true,"note":"Front face visible - finish it"}]}]},{"brand":"KitchenAid","model":"KDPS624SPS","prefix":"KDPS624SPS","category":"dishwasher","appliance":"24\" top-control dishwasher, pocket handle","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.103–107","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Shaded utility areas are drawn on the side walls, but the callouts cannot be tied to edges with confidence, so no box is given.","Opening depth 24\" has no min/max wording."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused supply; copper wire; UL-listed cord kit to grounded outlet, or direct wire with strain relief","where":"Through a side cabinet wall within the shaded areas at the rear of the opening (left wall: 4\" and 3\" callouts; right wall: 6 1/4\" and 2\" callouts)","offPlane":true,"plane":"adjacent","page":"p.106"},{"key":"water","label":"Hot water","need":"Hot water line, 20-120 psi, 120°F at the dishwasher; 3/8\" O.D. copper with compression fitting or braided line; 90° elbow with 3/4\" hose connection","where":"Through a side cabinet wall within the shaded areas at the rear of the opening","note":"Do not solder within 6\" of the water inlet valve.","offPlane":true,"plane":"adjacent","page":"p.107"},{"key":"drain","label":"Drain","need":"Drain hose (fits 1\" drain connector) to waste tee or disposer inlet above the trap, 20\" min above the floor; 1/2\" min I.D. fittings; replacement hose max 12 ft; air gap if house drain is lower than 20\"","where":"Through a side cabinet wall within the shaded areas at the rear of the opening","offPlane":true,"plane":"adjacent","page":"p.107"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.106","opening":{"w":"24","d":"24","h":"33 5/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Stainless door with a pocket handle and controls on the top edge","Opening under the countertop between base cabinets"],"requires":["Corner locations need at least 2\" between the side of the door and the wall or cabinet.","No protrusions on any surface of the opening.","Utility lines come through the side cabinet walls within the shaded areas drawn at the rear of the opening."],"notes":"Door width 23 15/16\"; depth with pocket handle 24 1/2\"; depth with door fully open 50 3/16\" min. Unit can be raised 1 7/16\" with feet fully extended. Adjustable toe kick 3 5/16\"-4 11/16\"."}]},{"brand":"KitchenAid","model":"KOEC530PSS","prefix":"KOEC530PSS","category":"ovens","appliance":"30\" combination microwave/wall oven","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.108–113","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["This model's kW rating is not printed in the packet, so 40 A vs 20 A cannot be decided from the sheet.","Standard cutout height range is misprinted (\"between 41 1/8\" (104.5 cm) and 41 1/8\" (105.6 cm)\"); 41 1/8\" used as the minimum, upper limit unknown.","Flush cutout depth for the standard install has no min/max wording (24\")."],"utilities":[{"key":"power","label":"Power","need":"Hard-wired: flexible conduit from the oven connects directly to a junction box. Separate 40 A circuit for models rated 7.3-9.6 kW at 240 V (5.4-7.4 kW at 208 V); separate 20 A circuit for 4.8 kW and below at 240 V (3.6 kW and below at 208 V)","where":"Standard: junction box no more than 3\" below the support surface, cable through a 1\" min hole in a rear corner of the support surface. Flush: recommended junction box location (H) drawn in the cabinet below the cutout.","note":"Fuse both sides of the line; do not cut the conduit.","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.111"}],"variations":[{"key":"standard","label":"Standard","page":"p.111","opening":{"w":"28 1/2","d":"24","h":"41 1/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven frame overlaps the cabinet face","Cutout in a tall/wall cabinet with no cleats"],"requires":["Cabinet at least 30\" wide.","Support surface solid, level and flush with the bottom of the cutout; floor must carry 249 lbs.","Bottom of cutout 19 1/4\" above floor recommended (7 1/2\"-19 1/4\" acceptable); 1 1/4\" from top of cutout to upper door; at least 1 1/2\" from bottom of cutout to the lower door.","Junction box no more than 3\" below the support surface, with a 1\" min hole in a rear corner of the support surface."],"notes":"Recommended cutout height 41 5/16\". Unit 29 3/4\" wide, 41 1/8\" tall without console, 24 1/2\" deep excluding handle. Enclosure must surround the recessed part of the oven."},{"key":"flush","label":"Flush inset","page":"p.112","opening":{"w":"30 1/4","d":"25","h":"43"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven face sits inside the cabinet face with an even reveal","Finished cleats and spacers visible around the oven"],"requires":["Width between side cleats at least 28 7/8\"; recommended cutout height 42 1/2\".","All cleats and spacers recessed 1 3/8\" from the cabinet front; front faces of cleats and platform are visible and must be finished.","Bottom of cutout 4 5/8\"-19 1/4\" above the floor."],"notes":"Gives a 1/4\" reveal at top and sides and 1/8\" at the bottom. Top cleat 5/8\", side cleats 11/16\", 2\" side spacers and 1/4\" bottom spacers run the full depth of the cutout.","prep":[{"kind":"cleat","label":"Finished top cleat","strip":{"face":"top","setbackIn":"1 3/8","thicknessIn":"5/8"},"finished":true,"note":""},{"kind":"cleat","label":"Finished side cleats","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"11/16"},"finished":true,"note":""},{"kind":"spacer","label":"Side spacers, full cutout depth","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"2"},"finished":false,"note":"Run the entire depth of the cutout"},{"kind":"spacer","label":"Bottom spacers, full cutout depth","strip":{"face":"bottom","setbackIn":"1 3/8","thicknessIn":"1/4"},"finished":false,"note":"Drawn at the bottom corners; run the entire depth of the cutout"}]}]},{"brand":"GE Appliances","model":"UVC9480SLSS","prefix":"UVC9480SLSS","category":"ventilation","appliance":"48\" custom hood insert","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.114–119","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Cutout depth differs: 21-1/4\" in the install guide (p.119) vs 21-1/2\" on the spec page art (p.116); 21 1/4\" used.","Hood internal height: text says 17\" min, the side view shows 18-1/2\" min.","Maximum duct length text is garbled in the PDF text layer.","No junction box / wiring location given."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 6.0 A; optional JXHC1 power cord kit","where":"Sheet does not show a house-wiring location","page":"p.115"},{"key":"vent","label":"Duct","need":"10\" round metal duct, vertical, vented outdoors (flex duct not recommended)","where":"Duct collar toward the rear of the insert, 7 5/8\" from the back; bottom of house duct 13\" above the cabinet bottom (front view)","page":"p.119"}],"variations":[{"key":"insert","label":"Insert in custom hood (wall or island)","page":"p.119","opening":{"w":"45","d":"21 1/4","h":"30"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom wood hood with an open rectangular bottom over the cooktop","Two 2x4 studs running front-to-back inside the hood"],"requires":["Two 2x4 horizontal studs, 39\" apart, firmly secured as part of the hood cabinet.","Cabinet bottom of wood, 3/4\" minimum thick; studs and bottom must withstand 100 pounds.","Front of the opening at least 2\" from the hood front; back of the opening at least 2\" from the back wall.","Hood internal height at least 17\" for vertical venting (the side view shows 18-1/2\" min).","Vent to the outdoors with 10\" round metal duct."],"notes":"Insert 45 3/4\" wide (46 5/16\" with included side panels), 21 7/8\" deep, 12 1/2\" tall (15\" to the top of the duct collar). Duct collar is toward the rear, 7 5/8\" from the back. Front view shows 13\" from the bottom of the cabinet to the bottom of the house duct. The spec page art shows the cutout depth as 21-1/2\".","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"10\" round, vertical"},"w":"45 3/4","h":"12 1/2","d":"21 7/8","jbox":"Sheet does not show a house-wiring location"}}]},{"brand":"GE Profile","model":"PCWK22U1WDD","prefix":"PCWK22U1WDD","category":"microwave","appliance":"2.2 cu. ft. built-in microwave with trim kit","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.120–122","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["The cutout drawing is generic for both trim kit sizes; which kit (27\" or 30\") is planned is not in the spec sheet.","No circuit breaker size is printed."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz grounded receptacle; 13.9 A; 41\" cord","where":"Optional on the back wall within the cabinet opening; may be outside the cabinet (then 19-1/2\" min depth)","zone":{"kind":"any"},"page":"p.122"}],"variations":[{"key":"trim-kit","label":"Built-in with trim kit","page":"p.122","opening":{"w":"25 1/2","d":"22","h":"16 3/4"},"rule":{"w":"range","d":"min","h":"exact"},"tells":["Microwave set in a wall/tall cabinet opening with a trim frame around it","Often stacked over a single wall oven"],"requires":["A matching trim kit is required: JX7227 series for 27\" cabinets (26 7/8\" wide) or JX7230 series for 30\" cabinets (29 3/4\" wide), 18 7/8\" tall.","Allow 1\" of clearance beyond the trim frame on all sides; at least 3/4\" gap to an adjoining cabinet door or obstruction.","Opening depth at least 22\" with the receptacle in the cabinet, 19-1/2\" if the receptacle is outside the cabinet.","For ADA compliance, install no higher than 36 1/4\"."],"notes":"Unit 24 1/4\" W x 13 5/8\" H x 20\" D. Trim overlaps the cabinet 1\" at top and 1 1/8\" at bottom; side overlap 2 1/8\" (30\" cabinet) or 5/8\" (27\" cabinet). Approved over a GE single electric wall oven, not over a gas wall oven.","openingMax":{"w":"25 5/8"}}]},{"brand":"Monogram","model":"ZWL1126SRSS","prefix":"ZWL1126SRSS","category":"microwave","appliance":"24\" microwave drawer","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.123–125","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Sheet drawings are labeled ZWL1126SJ; ZWL1126SRSS is the model on the cover page.","Flush cleat width (thickness) is not printed."],"utilities":[{"key":"power","label":"Power","need":"120 VAC, 60 Hz, 20 A individual grounded branch circuit; 51\" cord","where":"Junction box (E) at the upper left of the back wall: within 4\" of the left edge and 5\" down from the top of the cutout; may also be in the adjacent cabinet","zone":{"kind":"rect","x0":0,"x1":4,"y0":{"t":5},"y1":{"t":0}},"page":"p.125"}],"variations":[{"key":"standard","label":"Standard","page":"p.125","opening":{"w":"22 1/8","d":"23 1/2","h":"14 13/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front overlaps the cabinet face","Plain cutout with no cleats or shelf set back"],"requires":["Anti-tip block must be provided and pre-installed by the purchaser or builder, located 14-13/16\" above the floor the drawer sits on (top rear of the cutout).","Base must support at least 100 lbs.","Cabinet at least 23 7/8\" wide and 23 1/2\" deep."],"notes":"Front view draws the bottom of the cutout 18 1/2\" above the floor. Unit 23 7/8\" W x 15 15/16\" H (front) x 23 5/16\" D. Needs 15\" min door (drawer) clearance."},{"key":"flush","label":"Flush inset","page":"p.125","opening":{"w":"24 3/16","d":"23 1/2","h":"16 7/8"},"rule":{"w":"range","d":"min","h":"min"},"tells":["Drawer front sits inside the cabinet face","Finished side cleats and a 3/4\" shelf visible around the drawer"],"requires":["Side cleats leave a 22\" mounting cleat opening width; cleats may be visible and should be finished to match the cabinetry.","3/4\" shelf with its face set 1-7/8\" back from the cabinet face.","Anti-tip block must be provided and pre-installed before install (see standard).","24\" flush mount deflector vent is part of the flush install (see installation instructions)."],"notes":"Cutout height 16 7/8\" includes the 3/4\" shelf; front view shows 16 7/16\" from floor to the shelf. Side cleats drawn 1 3/16\" back from the cabinet face (top view).","openingMax":{"w":"24 1/2"},"prep":[{"kind":"cleat","label":"Finished side cleats","strip":{"face":"both","setbackIn":"1 3/16"},"finished":true,"note":"22\" between cleats; finish to match cabinetry"},{"kind":"shelf","label":"Shelf (base)","strip":{"face":"bottom","setbackIn":"1 7/8","thicknessIn":"3/4"},"finished":false,"note":"Shelf face sits 1-7/8\" back from the cabinet face"}]}]},{"brand":"Miele","model":"CVA 7845","prefix":"CVA 7845","category":"ovens","appliance":"24\" built-in plumbed coffee machine","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.126–128","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No category for coffee machines in the list; filed under ovens (built-in niche).","The proud niche numbers come from the spec table on p.126; the p.128 drawing shows the same values as art only.","Flush opening read off the p.127 drawing (no text layer); two readers agree on every value and each matches its printed mm. Readers differ on whether 22 1/8\" is the front-panel opening or the carcass; the face opening has to take the appliance front, so 23 5/8\" is used at the face.","The bottom cut-out is printed as 4\" x 28\" [100 mm x 720 mm]; 28\" is 711 mm, so the metric figure is rounded — use the inches."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A; NEMA 5-15 plug, 6 ft cord","where":"Recommended in the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.126"},{"key":"water","label":"Cold water","need":"Cold water only, through an accessible shut-off valve; 14.5-145 psi (pressure-reducing valve above 145 psi); 3/4\" BSP to 1/4\" compression fitting supplied; 1/4\" O.D. flexible line or copper not supplied; max line length 4’11”","where":"Recommended in the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.126"}],"variations":[{"key":"standard","label":"Proud (standard)","page":"p.128","opening":{"w":"22 1/8","d":"24","h":"17 11/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Machine front stands proud of the cabinet face","Niche in a tall cabinet, often above a drawer or oven"],"requires":["Cut a 4\" x 28\" opening in the bottom of the niche (cabinet floor) for the power cord and ventilation.","Electrical and water supplies recommended in the adjacent cabinet; more cabinet depth is needed if they are placed behind the machine."],"notes":"Unit 23 7/16\" W x 17 15/16\" H x 19 5/8\" D including the water connection.","prep":[]},{"key":"flush","label":"Flush","page":"p.127","opening":{"w":"23 5/8","h":"18 1/16","d":"24 15/16"},"rule":{"w":"min","h":"min","d":"min"},"tells":["Machine front sits flush with the cabinet face"],"requires":["Cut a 4\" x 28\" opening in the bottom of the niche (cabinet floor) for the power cord and ventilation.","Electrical and water supplies recommended in the adjacent cabinet.","Cut a 4\" × 28\" opening in the cabinet bottom for the power cord and ventilation."],"notes":"Flush niche dimensions are drawn on p.127 but are not in the PDF text layer, so they are not recorded here; check the drawing. Flush (p.127): the opening through the 7/8\"–15/16\" cabinet fronts is 23 5/8\" × 18 1/16\"; behind them the carcass niche is 22 1/8\" wide (the proud niche); cabinet 24 15/16\" deep minimum. A 4\" × 28\" cut-out in the cabinet bottom for the power cord and ventilation; supplies in the adjacent cabinet.","prep":[]}]},{"brand":"Best","model":"CP37I482SB","prefix":"CP37I482SB","category":"ventilation","appliance":"48\" built-in hood insert, internal dual blower","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.129–131","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No wiring location given.","Insert sizes read off the p.130 drawing (inches only); two readers agree. Opening = insert + the sheet's 1/8\" clearance."],"utilities":[{"key":"power","label":"Power","need":"Direct wire, 9.0 A max at 120 V","where":"Sheet does not show a location","page":"p.130"},{"key":"vent","label":"Duct","need":"10\" duct, vertical direction; backdraft damper included","where":"Duct collar on top of the insert","page":"p.130"}],"variations":[{"key":"insert","label":"Insert in custom canopy hood","page":"p.130","opening":{"h":"24","w":"46 1/2","d":"22 5/8"},"rule":{"h":"range","w":"min","d":"min"},"tells":["Custom canopy hood with an open bottom holding a stainless liner","Single large duct collar on top of the liner"],"requires":["Hood bottom 24\"-30\" above the cooking surface.","Size the custom hood opening to the insert plus 1/8\" clearance on all measurements.","Direct-wire electrical connection; 10\" vertical duct."],"notes":"Insert depth 22-1/2\" (48\" dual internal blower, 1300 max blower CFM). Backdraft damper included. Width appears only in the drawing art. Insert 46 3/8\" × 22 1/2\" × 11\" (p.130 drawing); the sheet says allow 1/8\" clearance on all measurements, so the hood opening needs 46 1/2\" × 22 5/8\". The sheet marks the insert sizes \"refer to the technical drawing of each model\".","openingMax":{"h":"30"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"10\" round, vertical"},"w":"46 3/8","h":"11","d":"22 1/2","jbox":"Sheet does not show a location"}}]},{"brand":"Thermador","model":"VCIN48GWS","prefix":"VCIN48GWS","category":"ventilation","appliance":"48\" custom hood insert (blower sold separately)","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.132–135","source":"Steel Cod sheets 10/2026","sheetConfidence":"low","sheetGaps":["No maximum mounting height given.","Which blower is planned is not stated in the spec sheet; amperage depends on it.","Cutout read off the p.133 drawing (no text layer): two readers agree and every inch value matches its printed mm."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, fixed connection (hard-wire); 11.1 A with remote VTR2FZ or inline VTI2FZ blower, 9.5 A with integrated VTN2FZ","where":"Sheet does not show a location","page":"p.134"},{"key":"vent","label":"Duct","need":"10\" duct from the top of the insert; blower sold separately","where":"Top of the insert","page":"p.132"}],"variations":[{"key":"insert","label":"Insert in custom hood","page":"p.132","opening":{"h":"30","w":"44 15/16","d":"21 1/4"},"rule":{"h":"min","w":"min","d":"min"},"tells":["Custom hood with an open bottom holding a stainless liner with hood trim pieces","Blower may be in the hood, inline in the duct, or on the roof/wall"],"requires":["Hood bottom at least 30\" above the cooking surface (gas or electric).","A blower must be bought separately: remote VTR2FZ (1000 CFM), inline VTI2FZ (1000 CFM), or integrated VTN2DA (700 CFM) / VTN2FZ (1000 CFM).","10\" duct from the top of the insert."],"notes":"Overall 12 13/16\" H x 45 3/4\" W x 22\" D (width of canopy included); 65 lbs. Hood trim pieces are included. Cutout in the custom hood bottom 44 15/16\" × 21 1/4\" (p.133); insert body 44 3/8\" × 20 5/8\" × 12 13/16\"; trim 45 3/4\" × 22\"; duct centre 7 3/8\" from the wall.","hood":{"type":"insert","under":"cooktop","duct":{"size":"10\""},"w":"44 3/8","h":"12 13/16","d":"20 5/8","jbox":"Sheet does not show a location"}}]},{"brand":"GE Appliances","model":"UVC9360SLSS","prefix":"UVC9360SLSS","category":"ventilation","appliance":"36\" custom hood insert","pages":"Steel Cod sheets 10/2026 · Q00085212 book pp.136–141","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Insert depth printed as 19-1/8\" (install guide) and 19 1/4\" (spec drawing).","Electrical-area offsets on p.141 (9-1/2\", 5-3/4\" or 8-3/4\") are on the insert, not the wall, so no wall zone is given."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz on an individual grounded branch circuit with a 15 or 20 amp breaker or time-delay fuse; 2 wire with ground; 2.9 A (3.0 A on spec drawing); optional JXHC1 cord kit","where":"Junction box on top of the insert (electrical area drawn behind the duct collar)","page":"p.141"},{"key":"vent","label":"Duct","need":"8\" round metal duct, vertical (or recirculate with UXN70 kit)","where":"Duct collar toward the rear of the insert, 6-1/2\" from the back","page":"p.139"}],"variations":[{"key":"insert","label":"Insert in custom hood (wall or island)","page":"p.138","opening":{"w":"34 1/2","d":"19 1/4","h":"24"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom wood hood with an open rectangular bottom over the cooktop","Insert vents straight up (8\" duct) or recirculates with a charcoal kit"],"requires":["Front of the opening recommended at least 3\" from the hood front; back of the opening at least 1\" from the back wall.","Hood internal height at least 18-1/2\" for vertical venting, 29\" for recirculation.","House wiring must reach the electrical area on top of the insert; over an island the wiring must come from the ceiling.","Hood panels should be removable for access to the wiring and duct.","UL requires combustible surfaces at least 30\" above the cooking surface."],"notes":"Insert 34 1/4\" W x 19 1/8\" D x 11 1/2\" H (spec page drawing shows 19 1/4\" deep). Duct collar toward the rear, 6-1/2\" from the back. Max equivalent duct length 150 ft (text partly garbled).","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"8\" round"},"w":"34 1/4","h":"11 1/2","d":"19 1/8","jbox":"Junction box on top of the insert (electrical area drawn behind the duct collar)"}}]},{"brand":"KitchenAid","model":"KCIG556JBL","prefix":"KCIG556JBL","category":"cooktop","appliance":"36\" induction cooktop","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.12–20","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Cutout width/depth are printed as nominal with no min/max tolerance.","The packet includes only pages 1-7 of the 21-page dimension guide; no hard-wire vs. cord/receptacle type (NEMA) is printed beyond \"Power Cord Included: Yes\".","Outlet zone bottom edge and right edge are not dimensioned; zone uses the cabinet floor and the 10\" max line.","No minimum base cabinet width is printed."],"utilities":[{"key":"power","label":"Power","need":"240 V, 60 Hz, AC only, fused circuit; 50 A circuit for 36\" cooktops; dedicated circuit recommended; power cord included","where":"Recommended electrical outlet zone in the cabinet below: at least 12\" down from the top of the cabinet and within 10\" of the left side of the cabinet","note":"Zone read from the front-view drawing: 10\" max is from the left cabinet side to the outlet, 12\" min is from the top of the cabinet down.","plane":"below","zone":{"kind":"rect","x0":0,"x1":10,"y0":0,"y1":{"t":12},"plane":"below"},"page":"p.20"}],"variations":[{"key":"standard","label":"Countertop cutout","page":"p.19","opening":{"w":"35 9/16","d":"20 3/4"},"rule":{"w":"min","d":"min"},"tells":["Rectangular countertop cutout over a base cabinet","No gas stub - 240 V supply in the cabinet below","Frameless glass top sits on the countertop"],"requires":["Cut countertop and cabinet to 35 9/16\" wide x 20 3/4\" deep (nominal; may need adjusting for clearance).","Keep the cutout at least 1\" from the back wall.","If the back wall is combustible and there is no backsplash, keep 7 3/4\" from the cutout (or 6\" from the back edge of the cooktop) to the wall.","Keep 1\" from the cooktop to a fixed side wall or combustible material.","Upper cabinets must be at least 30\" above the cooking surface and 18\" above the countertop, with a 36\" combustible-free width above the cooktop (follow hood instructions if a hood is installed)."],"notes":"Unit 36 11/16\" W x 21 23/32\" D with frame. Cabinet to countertop height (G) 3 15/16\"; cabinet depth (H) 23 9/32\"; recommended upper cabinet depth 13\". Approved to install over a built-in oven.","form":{"behindMinIn":1}}]},{"brand":"Zephyr","model":"PRR24C01AS-OD","prefix":"PRR24C01AS-OD","category":"refrigeration","appliance":"24\" outdoor/indoor undercounter refrigerator","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.21–22","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The sheet gives no rough opening (width, height or depth) - only unit size.","No outlet location, receptacle type or cord length is printed.","No ventilation clearances for built-in use are printed."],"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz at max. 1.5A","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.22"}],"measure":true,"variations":[{"key":"undercounter","label":"Undercounter / built-in","page":"p.22","opening":{},"rule":{},"tells":["Stainless door with side-mounted pro handle","Outdoor kitchen or bar undercounter space","Front grille at the toe, no plumbing needed"],"requires":["Leave at least 2-1/4\" between the hinge side and a wall so the door can swing."],"notes":"Unit 23-7/8\" W x 33-7/8\" H x 23-5/8\" D; height 33-7/8\" - 34-7/8\" on leveling legs, 37-1/2\" on optional casters. Depth with door open 46-1/4\". Weight 100 lbs. Installation type: Compact / Built-in / Freestanding; outdoor/indoor certified; ambient range 50-115 F. Zero-clearance door hinges.","noOpening":true}]},{"brand":"Thermador","model":"T36FT820NS","prefix":"T36FT820NS","category":"refrigeration","appliance":"36\" freestanding French-door bottom-freezer refrigerator","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.23–26","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No water supply requirement or location is printed, although the unit has an internal water dispenser and ice maker.","No outlet location is printed.","Cutout height 72\" equals the printed overall height 72\" while the sheet also asks for a 1/2\" gap at the top; check the install manual before accepting a 72\" opening.","Cutout values carry no min/max wording."],"utilities":[{"key":"power","label":"Power","need":"110-127 V, 60 Hz, 10 Amp · 120V 3-prong plug · 67\" cord","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.24"}],"variations":[{"key":"standard","label":"Cutout (counter-depth freestanding)","page":"p.25","opening":{"w":"36","d":"25","h":"72"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Stainless French doors with pro handles over a freezer drawer","Full-height tall opening between cabinets or panels","Internal (in-door) water dispenser, no external dispenser"],"requires":["Leave a 1/2\" gap at the top and 1\" behind the refrigerator for ventilation.","Do not install next to a heat source such as a stove or range (recommended)."],"notes":"Unit 35 5/8\" W x 72\" H x 31 7/16\" D overall; depth without hinges and doors 24\"; depth with doors, no handles 28 3/4\". Add 5/8\" height with front leveling feet fully extended; add 1\" depth for fixed spacers on back. Door swing (top view): 57 7/8\" total width and 43 3/8\" depth with doors open. Net weight 326 lbs. Four-point front adjustable with 4 wheels; front serviceable."}]},{"brand":"Scotsman","model":"DCE33PA-1SSD","prefix":"DCE33PA-1SSD","category":"icemaker","appliance":"15\" undercounter gourmet ice machine with drain pump","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.27–32","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The sheet gives no rough opening - only unit size (15\" W x 22.8125\" D x 33.875\" H).","No outlet, water line or drain locations are printed; no water line size or fitting.","Panel pages conflict: page 29 shows a 14 3/4\" x 28 15/16\" drop-in raised panel, page 30 a 15\" x 29\" overlay blank; page 30 title says \"Black or White Only\".","No panel thickness range beyond the 3/4\" blank."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115/60/1 · 3.6 A · 15 A maximum fuse size","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.28"},{"key":"water","label":"Water","need":"Water pressure 14-70 PSIG; water temperature 40-100 F","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.28"},{"key":"drain","label":"Drain","need":"Built-in pump to expel drain water, includes 10' drain tube","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.28"}],"measure":true,"variations":[{"key":"undercounter","label":"Undercounter","page":"p.28","opening":{},"rule":{},"tells":["15\" wide undercounter unit","Door takes a custom wood panel or stainless door","Drain pump - 10' drain tube runs to a standpipe/drain"],"requires":["Install indoors only: air 50-100 F, water 40-100 F, water pressure 14-70 PSIG.","In a corner, the handle may hit the wall or cabinet face and limit door swing."],"notes":"Unit (without legs) 15\" W x 22.8125\" D x 33.875\" H. Shipping weight 83 lb. Overlay panel spec: blank 3/4\" x 15\" w x 29\" h, must weigh no more than 5 lb; edge detail (rabbet and groove) on bottom and sides; add KHAND top trim. A second panel drawing shows a drop-in raised panel 14 3/4\" x 28 15/16\".","noOpening":true,"panel":{"width":"15.0","height":"29.0","thickness":"3/4\"","weight":"5 lb max","page":"p.30"},"panelRule":{"assumedIn":0.75,"page":"p.30"}}]},{"brand":"Café","model":"CDT858P2VS1","prefix":"CDT858P2VS1","category":"dishwasher","appliance":"24\" top-control dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.33–34","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["No water line size/type, drain type or air-gap/high-loop requirement is printed.","Hard-wire vs. cord: the sheet only says an optional cord kit is available; no receptacle location is given.","Service area width is drawn across the full opening but not dimensioned; the 6\" (height) and 4\" (floor depth) are read from the drawing."],"utilities":[{"key":"power","label":"Power","need":"120 V; 60 Hz; 7.2A · optional cord kit (GPFCORD)","where":"Plumbing and electric service must enter inside the shaded area at the back of the opening: bottom 6\" of the back wall, plus 4\" out along the floor","zone":{"kind":"rect","x0":0,"x1":{"r":0},"y0":0,"y1":6},"page":"p.34"},{"key":"water","label":"Water","need":"Water supply (line size and type not printed)","where":"Plumbing and electric service must enter inside the shaded area at the back of the opening: bottom 6\" of the back wall, plus 4\" out along the floor","zone":{"kind":"rect","x0":0,"x1":{"r":0},"y0":0,"y1":6},"page":"p.34"},{"key":"drain","label":"Drain","need":"Drain connection (type not printed)","where":"Plumbing and electric service must enter inside the shaded area at the back of the opening: bottom 6\" of the back wall, plus 4\" out along the floor","zone":{"kind":"rect","x0":0,"x1":{"r":0},"y0":0,"y1":6},"page":"p.34"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.34","opening":{"w":"24","d":"24","h":"33 1/2"},"rule":{"w":"min","d":"min","h":"range"},"tells":["24\" opening under the countertop next to the sink","Stainless door with top controls and bar handle","Water, drain and power stubbed low at the back of the opening"],"requires":["Opening at least 24\" wide and 24\" deep, 33-1/2\" to 34-3/4\" from underside of countertop to floor.","Back wall above the service area must be free of pipes or wires.","Cabinets must be square and plumb."],"notes":"Unit 23-3/4\" W x 24\" D; height 33-3/8\" min to 34-5/8\" max (legs); 4\" toekick; overall depth including handle 26.3\"; door open 27-1/2\". Supports side or top installation, built-up floor and flush cabinet installation.","openingMax":{"h":"34 3/4"}}]},{"brand":"Monogram","model":"ZTS90DPSNSS","prefix":"ZTS90DPSNSS","category":"ovens","appliance":"30\" electric single wall oven","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.35–40","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Installation drawings (pages 36-40) are labelled ZET9050SHSS, not ZTS90DPSNSS; the spec table on page 38 is shared.","Flush inset dimensions come only from the older 1/21 revision page (page 36); the 12/23 revision does not show flush inset.","Flush inset height and depth have no min/max wording.","Junction box zone is read from the undercounter front view; wall-install drawing in the 12/23 revision does not show it."],"utilities":[{"key":"power","label":"Power","need":"240/208 V AC, 60 Hz, 20 A individual grounded circuit · junction box required · 48\" conduit (72\" special order WB18T10398)","where":"ELEC. box 5 1/4\" high x 9 1/2\" wide in the upper right corner of the cutout (may also be in an adjacent cabinet)","note":"Electrical rating 3.4 kW at 208V, 4.5 kW at 240V.","zone":{"kind":"rect","x0":{"r":9.5},"x1":{"r":0},"y0":{"t":5.25},"y1":{"t":0}},"page":"p.39"}],"variations":[{"key":"wall","label":"Standard wall installation","page":"p.38","opening":{"w":"28 1/2","h":"27 1/4","d":"23 1/2"},"rule":{"w":"range","h":"range","d":"min"},"tells":["Oven cutout in a tall wall cabinet","Oven trim overlaps the cabinet face","Platform shelf at the bottom of the cutout"],"requires":["Cabinet at least 30\" wide and 24\" deep.","Platform must support 220 lbs.","Recommended cutout location 32 1/2\" from the floor.","Allow 1/8\" clearance from the side edges of the oven door."],"notes":"Unit 29 3/4\" W x 28 11/16\" H x 27 5/16\" D including handle; oven door clearance 20 9/16\". Shipping weight 184 lbs. Installation drawings are labelled with the companion model ZET9050SHSS. Additional space is needed for flush installation.","openingMax":{"w":"28 5/8","h":"27 5/16"}},{"key":"undercounter","label":"Undercounter / under cooktop","page":"p.39","opening":{"w":"28 1/2","h":"27 1/4","d":"23 1/2"},"rule":{"w":"range","h":"range","d":"min"},"tells":["Oven cutout in a base cabinet below the countertop","3/4\" platform shelf under the oven","Cooktop above"],"requires":["A 3/4\" thick platform is required.","Minimum 31 1/4\" from the top of the countertop to the top of the oven support platform when installed beneath a certified cooktop.","Platform must support 220 lbs.","Cooktop gas regulator and electric connections must be in an adjacent accessible location to the right."],"notes":"Top of cutout is 3\" below the top of the cabinet in the undercounter front view. Oven is approved under specific cooktop models only (labelled on unit). Side-by-side cutouts need 2\" min between them; 2 1/2\" min between stacked cutouts with an Advantium or warming drawer.","openingMax":{"w":"28 5/8","h":"27 5/16"}},{"key":"flush-inset","label":"Flush inset","page":"p.36","opening":{"w":"30","h":"28 15/16","d":"24 15/16"},"rule":{"w":"exact","h":"min","d":"min"},"tells":["Oven face sits flush with the cabinet doors","Finished cleats visible around the oven","1/8\" reveal all around the door"],"requires":["Cabinet surfaces must be appearance-finished for flush installation.","Cleats may be visible and should be finished to match the cabinetry.","Platform must support 220 lbs.","If using the optional flush install vent trim ZX30VT1, adjust cutout height to 28-5/8\" and bottom cleat height to 1/4\"."],"notes":"Cutout between side cleats 28 1/2\". Taken from the older revision of the sheet; the newer revision shows only standard and undercounter.","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 7/16","runIn":"2 1/2","thicknessIn":"3/4"},"finished":true,"note":"Cleats may be visible; finish to match cabinetry"},{"kind":"cleat","label":"Top cleat","strip":{"face":"top","thicknessIn":"1 1/8"},"finished":true,"note":""},{"kind":"cleat","label":"Bottom cleat","strip":{"face":"bottom","thicknessIn":"9/16"},"finished":true,"note":"Extends full depth of cabinet"}]}]},{"brand":"Zephyr","model":"PRW24C02CPG","prefix":"PRW24C02CPG","category":"wine","appliance":"24\" dual-zone panel-ready wine cooler","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.41–42","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The sheet gives no rough opening - only unit size.","No outlet location, receptacle or cord length is printed.","No panel weight limit is printed; unit depth without panel is not stated."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz at max. 1.5A","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.42"}],"measure":true,"variations":[{"key":"undercounter","label":"Undercounter / built-in","page":"p.42","opening":{},"rule":{},"tells":["Glass door framed by a custom overlay panel","Black cabinet and black wood racks","24\" undercounter space"],"requires":["Supply an overlay panel 23-5/8\" W x 29-7/8\" H, 5/8\" to 3/4\" thick (panel not included).","Leave at least 2-1/4\" from the hinge side to a wall (when using an optional Zephyr handle)."],"notes":"Unit 23-7/8\" W x 33-7/8\" H x 23-3/4\" D (depth with 3/4\" overlay panel); height 33-7/8\" - 34-7/8\". Door open depth 46-5/8\". Weight 126 lbs. Handle sits 2-5/8\" - 5\" from the panel edge. Installation type: Compact / Built-in / Freestanding.","noOpening":true,"panel":{"width":"23-5/8","height":"29-7/8","thickness":"5/8\" - 3/4\"","page":"p.41"},"panelRule":{"assumedIn":0.75,"minIn":0.625,"maxIn":0.75,"page":"p.42"}}]},{"brand":"Thermador","model":"PRG486WDH","prefix":"PRG486WDH","category":"range","appliance":"48\" pro gas range with electric griddle","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.43–47","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Page 46 prints 35 7/8\" min height while page 1 prints 35 3/4\" min cutout height.","Utility zone references (which edge X and E run to) are not clear from the drawing; zones left as \"any\" with printed values in the text.","Width 48\" carries no min/max wording.","No hood/ventilation requirement is printed on these pages."],"utilities":[{"key":"gas","label":"Gas","need":"3/4\" gas supply","where":"Gas zone A on the back wall: 4\" wide box, X = 5\" from the left side, E = 2\"; within the 8\" band above the floor (Harmony series row)","note":"Zone dimensions are printed, but the drawing does not make clear which box edge X runs to, so no box is set.","zone":{"kind":"any"},"page":"p.45"},{"key":"power","label":"Power","need":"120 V, 60 Hz, 20 A circuit · NEMA 5-20 receptacle · 3-prong cord 65\"","where":"Electric zone B on the back wall: 6\" wide box, X = 5\" from the right side; within the 8\" band above the floor (Harmony series row)","zone":{"kind":"any"},"page":"p.45"}],"variations":[{"key":"low-back","label":"Against wall - Low Backguard","page":"p.46","opening":{"w":"48","h":"35 3/4"},"rule":{"w":"min","h":"range"},"tells":["48\" opening between base cabinets","Range backs up to a wall","Low backguard on the back of the range"],"requires":["A 36\" minimum clearance is required from the cooking surface to the bottom of an unprotected cabinet (30\" when the cabinet bottom is protected per the sheet).","Range needs a 3/4\" gas supply and a NEMA 5-20 receptacle (120 V, 20 A).","Against a combustible surface, a Thermador Low Backguard (PA48WLBH, sold separately) is required for 0\" rear clearance."],"notes":"Unit 47 15/16\" W x 24 3/4\" D x 35 3/4\"-36 3/4\" H; 24\" max recess depth. The low-backguard clearance drawing prints 35 7/8\" Min. / 36 3/4\" Max. height. Net weight 556 lbs. 7\" low backguard.","openingMax":{"h":"36 3/4"}},{"key":"island","label":"Island - Flush Island Trim","page":"p.47","opening":{"w":"48","h":"35 3/4"},"rule":{"w":"min","h":"range"},"tells":["Range in an island or with open space behind","Flush island trim at the back (included)","Cantilevered counter edge behind the range"],"requires":["A 36\" minimum clearance is required from the cooking surface to the bottom of an unprotected cabinet (30\" when the cabinet bottom is protected per the sheet).","Range needs a 3/4\" gas supply and a NEMA 5-20 receptacle (120 V, 20 A).","With the included Island Trim, keep 6\" minimum rear clearance to a combustible surface (0\" to a non-combustible surface).","Counter surface should have a cantilever edge meeting the back section of the Flush Island Trim.","If an inner wall is used under the cantilever counter, leave a 1/8\" gap from the rear of the range to that wall."],"notes":"Unit 47 15/16\" W x 24 3/4\" D; 24\" max recess depth. Clearances under 6\" must be approved by local codes.","openingMax":{"h":"36 3/4"}}]},{"brand":"JennAir","model":"JUIFX15HX","prefix":"JUIFX15HX","category":"icemaker","appliance":"15\" panel-ready undercounter ice machine with drain pump","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.48–49","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No opening width or depth is printed (only unit width 15\" and depth 24\").","No power, water or drain requirements or locations are printed (installation guide not in packet).","No panel weight limit or thickness range is printed (3/4\" only)."],"panelReady":true,"utilities":[{"key":"drain","label":"Drain","need":"Built-in drain pump (no drain specs printed)","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.48"}],"variations":[{"key":"undercounter","label":"Undercounter","page":"p.49","opening":{"h":"34"},"rule":{"h":"min"},"tells":["15\" undercounter space with a custom wood panel","Panel matches surrounding cabinet doors","Toe kick below the panel"],"requires":["Opening at least 34\" high (gives a 1/8\" reveal above the panel).","Toe kick at least 4\" high and 4 1/4\" deep.","Countersink all handle mounting hardware."],"notes":"Unit 15\" W x 33 3/4\" H x 24\" D; depth with panel 24\"; panel top 33 7/8\" from floor. Leveler legs give 1\" max lift. Door swing 90 degrees max with factory hinge stop. Panel sizes are the minimum to cover the door; panels can be made taller/wider to match cabinetry.","panel":{"width":"14 3/4","height":"29 7/8","thickness":"3/4\"","page":"p.49"},"panelRule":{"assumedIn":0.75,"page":"p.49"}}]},{"brand":"Whirlpool","model":"UMCS5022SZ","prefix":"UMCS5022SZ","category":"microwave","appliance":"2.2 cu. ft. countertop microwave","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.50–53","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["No built-in trim kit model or cutout is printed.","Electrical labels are garbled in the text layer; values read with the Electrical Requirements heading (15 / 60 / 120 / 1700).","No receptacle type or cord length is printed."],"freestanding":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A · 1700 W · power cord included","where":"Not shown on the sheet","note":"Electrical labels on the spec page are font-garbled in the text layer (Amps/Hz/Volts/Watts).","offPlane":true,"plane":"adjacent","page":"p.51"}],"variations":[{"key":"countertop","label":"Countertop","page":"p.52","opening":{},"rule":{},"tells":["Sits on the countertop or a shelf","Push-button door release, door opens to the left","Plugs into a standard outlet"],"requires":["Provide counter or shelf space for a 24 3/4\" W x 14 3/16\" H x 18 5/8\" D unit plus door swing."],"notes":"Unit 24 3/4\" W x 14 3/16\" H; depth without door 18 5/8\", with door 18 5/16\"; depth with door open 90 degrees 38 14/16\". Door height 13 1/8\". Optional built-in trim kit sold separately (kit size not printed).","noOpening":true}]},{"brand":"JennAir","model":"JBSS42E22L","prefix":"JBSS42E22L","category":"refrigeration","appliance":"42\" built-in side-by-side refrigerator with external dispenser","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.54–59","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["The outlet zone top is not dimensioned (zone runs to the top of the opening); the 80\"-90\" marks on the drawing are not explained on these pages.","Floor-hole option for the water line is described but not drawn with x/y in the opening.","The sheet does not give the outlet zone in terms of the opening wall other than 77\" up and 7 1/2\" from the right side."],"utilities":[{"key":"power","label":"Power","need":"115 V, 60 Hz AC, 15 A or 20 A fused, grounded 3-prong outlet; separate circuit recommended; not on a switch; no extension cord; 84\" cord","where":"Outlet at or above 77\" from the floor, within 7 1/2\" (Dimension B) of the right-hand side cabinet or end panel","note":"GFCI-protected outlets may nuisance trip.","zone":{"kind":"rect","x0":{"r":7.5},"x1":{"r":0},"y0":77,"y1":{"t":0}},"page":"p.56"},{"key":"water","label":"Water","need":"Cold water, 30-120 psi; 1/4\" compression fitting if connecting to copper tubing; no piercing or 3/16\" saddle valve","where":"Shutoff valve in the base cabinet on either side of the refrigerator or other accessible area","note":"Reverse osmosis: 30-120 psi at the valve, 40-60 psi to the RO system.","offPlane":true,"plane":"adjacent","page":"p.57"}],"variations":[{"key":"standard","label":"Built-in between cabinets","page":"p.56","opening":{"w":"41 1/2","h":"83 1/2","d":"24"},"rule":{"w":"range","h":"range","d":"min"},"tells":["Full-height built-in opening under a solid soffit","Stainless side-by-side doors with external ice/water dispenser","Top grille above the doors"],"requires":["Solid soffit must be within 1\" maximum above the refrigerator; otherwise the refrigerator must be braced with anti-tip boards.","Anti-tip boards (if needed) go on the rear wall studs with the bottom of the board 84\" from the floor.","Floor must support more than 600 lbs and be level with the room; face of cabinetry must be plumb.","Keep 1/2\" clearance above the top grille so the grille can be removed.","Allow 4 1/2\" minimum between the side of the refrigerator and a corner wall so doors open to 90 degrees."],"notes":"Unit 42 3/8\" W x 83 3/8\" H x 27 3/4\" D (product page); depth from front of top grille to back of cabinet 25 3/8\". Add 1 1/8\" height with legs fully extended. Power cord 84\"; water line on back 5 ft. Door swing depth 41\". Custom side panels min 1/2\" thick; if opening depth is 25\" or more, a support board on the rear wall may be needed. Room temperature 55-110 F. Hole at least 6\" from the right or left side cabinet or panel and no more than 1\" from the back wall (gray area).","openingMax":{"w":"41 3/4","h":"84 3/4"}}]},{"brand":"Thermador","model":"WD30WC","prefix":"WD30WC","category":"warming","appliance":"30\" warming drawer (push to open)","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.60–63","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Cutout values have no min/max wording.","Whether reveal cleats must be finished, and their setback, are not printed.","Page 63 standard drawing dimensions (28 5/8\", 4 3/4\"-38\") are not labelled clearly enough to use.","Flush cleats read off the p.61 drawing (no text layer); two readers agree and every inch value matches its printed mm. Cleat depth front-to-back is not dimensioned."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A circuit · 120V 3-prong plug · 84\" cord · 450 W","where":"For a wall cabinet, the receptacle may be above, below, or to the left or right of the unit within reach of the power cord","offPlane":true,"plane":"adjacent","page":"p.63"}],"variations":[{"key":"standard","label":"Standard","page":"p.60","opening":{"w":"28 1/2","h":"9 1/4","d":"23 1/2"},"rule":{"w":"min","h":"min","d":"min"},"tells":["Drawer cutout below a wall oven, steam or speed oven","Drawer front overlaps the cabinet face","No handle - push to open"],"requires":["Wall cabinet receptacle may be above, below, or to the left or right of the unit within reach of the 84\" cord."],"notes":"Unit 9 7/16\" H x 29 3/4\" W x 24 1/2\" D. Net weight 55 lbs. Installs under Thermador speed, steam or wall oven. 1/2\" between the oven cut-out above and the drawer cut-out (p.61)."},{"key":"flush","label":"Flush","page":"p.61","opening":{"w":"30","h":"9 9/16","d":"24 1/2"},"rule":{"w":"exact","h":"min","d":"min"},"tells":["Drawer face flush with the cabinet doors","Reveal cleats on both sides of the cutout","Oven above also set flush"],"requires":["Install 3/4\" reveal cleats on both sides of the cutout (28 1/2\" between cleats)."],"notes":"Unit 9 7/16\" H x 29 3/4\" W x 24 1/2\" D. Net weight 55 lbs. Reveal cleats 3/4\" each side, 1\" back from the cabinet face, 28 1/2\" between (p.61). The drawing is based on a 3/4\" custom panel. Under an oven: 1/2\" minimum between the cut-outs.","panelRule":{"assumedIn":0.75,"page":"p.61"},"prep":[{"kind":"cleat","label":"Reveal cleats","strip":{"face":"both","setbackIn":"1","thicknessIn":"3/4","panelShift":"setbackIn"},"finished":false,"note":"28 1/2\" between them; the 1\" assumes a 3/4\" custom panel"}]}]},{"brand":"JennAir","model":"JJD3030IL","prefix":"JJD3030IL","category":"warming","appliance":"30\" warming drawer","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.64–68","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Outlet location \"e\" on the flush drawing is shown but not dimensioned.","Dimension C (1\" min / 4 1/4\" recommended) is drawn between the lower cutout and the toe kick; its exact reference is not labelled.","Standard opening depth uses the 24\" minimum cabinet depth; no separate standard cutout depth is printed.","Side-cleat strip: 1\" read as cleat width (30 1/4\" - 28 1/4\" opening), 1 5/8\" as its front-to-back depth from the top view; setback not printed."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A fused circuit; grounded 3-prong outlet; separate circuit recommended","where":"Recessed outlet in the rear wall on the upper right-hand side of the cutout, or in an adjacent cabinet with a 1 3/8\" min. hole through the back of the cutout for the cord","zone":{"kind":"any"},"page":"p.65"}],"variations":[{"key":"standard","label":"Standard","page":"p.66","opening":{"w":"28 1/2","h":"9 1/8","d":"24"},"rule":{"w":"min","h":"min","d":"min"},"tells":["Drawer cutout in a base or oven tower cabinet","Stainless drawer front overlapping the cabinet face","Toe kick below"],"requires":["Cabinet at least 30\" wide and 24\" deep.","Support surface must be solid, level and flush with the bottom of the cutout.","Keep 2 1/2\" minimum between cutouts; 1\" minimum (4 1/4\" recommended) for dimension C at the toe kick.","Recessed area must fully enclose the recessed portion of the drawer."],"notes":"Drawer front 29 3/4\" W x 10 1/4\" H; recessed width 28 1/4\", recessed height 9\", depth 23 1/8\". Cannot be leveled after installation. Approved for indoor/outdoor use (outdoor: permanent fixture)."},{"key":"flush","label":"Flush inset","page":"p.67","opening":{"w":"30 1/4","h":"10 3/4","d":"25"},"rule":{"w":"min","h":"min","d":"min"},"tells":["Drawer face flush with cabinet doors","Finished side cleats and platform visible in the cutout","1/4\" reveal around the drawer"],"requires":["A 25\" minimum cutout depth is required.","Opening between cleats at least 28 1/4\" wide.","Bottom of cutout 8 1/4\" from floor recommended, 5\" minimum; 2 1/2\" minimum between cutouts.","Front face of cleats and platform is visible and should be treated as a finished surface."],"notes":"Results in a 1/4\" reveal on all sides of the drawer.","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","runIn":"1 5/8","thicknessIn":"1"},"finished":true,"note":"Front face visible - finish it"},{"kind":"platform","label":"Platform","strip":{"face":"bottom","thicknessIn":"7/8"},"finished":true,"note":"Front face visible - finish it"}]}]},{"brand":"Thermador","model":"T48BT120NS","prefix":"T48BT120NS","category":"refrigeration","appliance":"48\" built-in French-door bottom-freezer refrigerator (pre-assembled)","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.69–74","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Cutout height 84\" has no min/max wording.","Area B (routing) width is not dimensioned; zone spans the full back wall up to 7 1/4\".","No water line size or fitting is printed.","Page 72 prints 47 1/2\" as 1054 mm (47 1/2\" is 1207 mm elsewhere on the same page)."],"utilities":[{"key":"power","label":"Power","need":"110-120 V, 60 Hz, 15 Amp · 3-prong plug · 118\" cord","where":"Outlet recommended in an adjacent cabinet. If not possible, behind the appliance in Area B (water and electric line routing) on the back wall, up to 7 1/4\" above the floor - only if the outlet can be switched off at a circuit breaker.","offPlane":true,"plane":"adjacent","page":"p.71"},{"key":"water","label":"Water","need":"Cold water supply, 29-116 p.s.i.","where":"Supply recommended in an adjacent cabinet or other area accessible after install; lines route through Area B (water and electric line routing) on the back wall, up to 7 1/4\" above the floor","note":"Width of area B is drawn, not dimensioned.","zone":{"kind":"rect","x0":0,"x1":{"r":0},"y0":0,"y1":7.25},"page":"p.71"}],"variations":[{"key":"flush","label":"Flush (frame removed)","page":"p.71","opening":{"w":"48","h":"84","d":"25"},"rule":{"w":"exact","h":"min","d":"min"},"tells":["Doors flush with surrounding cabinet faces","Pre-assembled frame removed","Finished returns visible inside the opening when doors open"],"requires":["Remove the pre-assembled frame for flush installation.","Top and side furniture returns must be finished to match, at least 4\" deep; side walls of the cutout completely flush for at least 4\".","Allow 11 1/2\" beside the unit and 26\" in front for doors at 115 degrees (based on 3/4\" door panels)."],"notes":"Unit 47 1/4\" W x 83 9/16\"-85 1/2\" H x 24\" D without panel or handles; 24 3/4\" with panel; 27 3/8\" with panel and handles. Recommended height in an 84\" niche: 83 7/8\". Net weight 730 lbs. Anti-tip bracket included. Tipping radius >= 87 1/4\" (front). Side by side with a column unit needs a 5/8\" min partition.","prep":[{"kind":"return","label":"Finished furniture returns - top and sides","strip":{"face":"both","runIn":"4"},"finished":true,"note":"Top and side returns finished to match exterior furniture at a minimum depth of 4\""}]},{"key":"proud","label":"Proud (with pre-assembled frame)","page":"p.72","opening":{"w":"47 1/2","h":"84","d":"24"},"rule":{"w":"range","h":"min","d":"min"},"tells":["Stainless frame around the doors","Door panels protrude slightly past the cabinet faces","Unfinished returns hidden by the metal frame"],"requires":["Side walls of the cutout must be completely flush to a depth of at least 4\".","Allow 13 1/4\" beside the unit and 27\" in front for doors at 115 degrees."],"notes":"Door panels protrude slightly for a proud install. Unit 47 1/4\" W x 83 9/16\"-85 1/2\" H x 24\" D without panel or handles. Net weight 730 lbs.","openingMax":{"w":"48"}}]},{"brand":"Fulgor Milano","model":"F6PIR487S1","prefix":"F6PIR487S1","category":"range","appliance":"48\" induction range, double oven","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.75–81","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No cutout depth or countertop height requirement is printed; only the opening width.","The electrical box is dimensioned by its width, its offset from the right side and its height, so the zone is described in words instead of coordinates.","Side clearance above the cooking surface reads 3\" in the text list but 6\" on the cutout drawing; confirm with the installation manual.","Hood instructions may set a different mounting height than the general 30\" minimum."],"utilities":[{"key":"power","label":"Power","need":"120/240 V, 60 Hz · 50 A dedicated circuit · NEMA 14-50P plug on a 51\" cord","where":"Back wall, lower right of the opening: box 7\" wide, 3\" in from the right side, up to 4 1/4\" above the floor; max 2\" protrusion from wall","note":"Power Management keeps total draw under the 50 A breaker.","zone":{"kind":"any"},"page":"p.80"}],"variations":[{"key":"standard","label":"Standard (between cabinets)","page":"p.80","opening":{"w":"48"},"rule":{"w":"min"},"tells":["Range slides in between base cabinets against a back wall","Wall cabinets or a hood above the range"],"requires":["Bottom of the ventilation hood at least 30\" above the cooking surface.","Wall cabinets beside the range at least 18\" above the cooking surface and no deeper than 13\".","At least 6\" from each side of the range to a side wall or tall cabinet above the countertop (per cutout drawing).","Electrical supply may protrude no more than 2\" from the wall.","Anti-tip bracket must be installed and engaged.","Hood of at least 450 CFM recommended."],"notes":"Unit 47 7/8\" W x 35 3/8\"–37 1/4\" H x 30\" D. Ranges weigh up to 400 lb; two people required. Rear clearance 0\" with 3\" backguard."},{"key":"island","label":"Island (flush island trim)","page":"p.80","opening":{"w":"48"},"rule":{"w":"min"},"tells":["Range in an island with no back wall","Island trim instead of a backguard"],"requires":["Countertop must extend at least 2 1/2\" behind the cutout's back edge.","Countertop must extend at least 3\" past each side of the cutout.","Anti-tip bracket must be installed and engaged."],"notes":"Island trim (F6BG48BCI) is an optional accessory listed on the sheet."}]},{"brand":"JennAir","model":"JDRP548HL","prefix":"JDRP548HL","category":"range","appliance":"48\" dual-fuel pro range with griddle","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.82–85","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Gas pipe size and the range's gas inlet position are not printed on these pages.","Utility areas come from a lettered isometric drawing (H, I, G electrical; M, N, J gas); letters K (5\") and L (24\") are not clearly tied to an edge, so the gas area is described in words only and the electrical rectangle should be field-checked.","No countertop height range is required beyond the 36\" the drawing assumes."],"utilities":[{"key":"power","label":"Power","need":"240 V, 60 Hz, 4-wire, single phase · 50 A minimum circuit protection · cord for a 14-50R receptacle","where":"Back wall: shaded electrical area 40\" wide (H), set 4\" in from each side (I), up to 15\" high (G) per drawing","note":"Do not use an extension cord.","zone":{"kind":"rect","x0":4,"x1":{"r":4},"y0":0,"y1":15},"page":"p.84"},{"key":"gas","label":"Gas","need":"Regulated gas supply · new CSA-approved supply line with shut-off valve · propane not over 14\" water column","where":"Back wall/floor at the right: gas area 10 1/2\" wide (M), 9\" from the right side (N), 3\" up the wall (J)","zone":{"kind":"any"},"page":"p.84"}],"variations":[{"key":"standard","label":"Standard (between cabinets)","page":"p.84","opening":{"w":"48"},"rule":{"w":"min"},"tells":["Range between base cabinets against a back wall","Gas and power on the back wall behind the range"],"requires":["Opening dimensions assume a 25\" deep countertop, 24\" deep base cabinets and 36\" countertop height.","Upper cabinets at least 18\" above the countertop, at least 48\" wide over the range, no deeper than 13\".","At least 12\" from both sides of the range to a side wall or other combustible material.","Without a hood: at least 48\" from the cooking platform to a combustible surface above.","A combustible back wall with no backguard needs at least 6\" clearance.","Anti-tip bracket must be installed.","Floor covering must withstand at least 200°F.","Range hood of 585 CFM or larger recommended.","Recessed installations must enclose the sides and rear; do not seal the range to the side cabinets."],"notes":"Unit 48\" W; 27 1/8\" deep with control panel; 35 3/4\" high on its wheels. In a 24\" base cabinet run with a 25\" countertop the oven door protrudes 1 7/8\" past the cabinets."}]},{"brand":"KitchenAid","model":"KMBD104GSS","prefix":"KMBD104GSS","category":"microwave","appliance":"24\" microwave drawer","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.86–89","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Only the standard-mount page is in the book; no flush-mount dimensions.","The receptacle box's left-right position is not dimensioned.","Dimension A (6\" min / 16\" max) is drawn at the anti-tip block along the back, but which edges it runs between is unclear.","Top overlap K prints 9/16\" beside 5.6 mm, which do not agree."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 or 20 A with fuse or breaker · grounded outlet · separate circuit recommended","where":"Suggested receptacle on the back wall above the opening (box 3\" tall x 4.5\" wide, D and F); left-right position not dimensioned","note":"Do not use an extension cord.","zone":{"kind":"any"},"page":"p.89"}],"variations":[{"key":"standard","label":"Standard mount","page":"p.89","opening":{"w":"22 1/8","d":"24","h":"15 9/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front overlaps the cabinet face around the opening","Opening under the countertop or under a wall oven"],"requires":["Platform must support 100 lb and be solid, level and flush with the bottom of the cutout.","Anti-tip block at the back of the opening, its bottom 14 13/16\" above the opening floor.","Cutout plumb and square in wood cabinetry, with complete enclosure around the recessed part.","Not suitable below cooktops; below a wall oven leave 2\" between cutouts and fit the oven's heat deflector kit."],"notes":"Unit 23 7/8\" W x 16\" H x 23 1/4\" D; drawer opens 15 1/4\". Face overlaps: 7/8\" each side, 3/4\" at the bottom, 9/16\" at the top (K). Anti-tip block: dimension A 6\" minimum to 16\" maximum, block height 3 1/2\" (E)."}]},{"brand":"GE","model":"GZS22IYNFS","prefix":"GZS22IYNFS","category":"refrigeration","appliance":"36\" counter-depth side-by-side refrigerator","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.90–91","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No electrical requirement (volts, amps, outlet location) is on these pages.","Water line type, size and location are not stated beyond fitting in the back clearance.","No rough opening is given; the tool should check clearances around the case instead."],"freestanding":true,"utilities":[{"key":"water","label":"Water","need":"Water hook-up (line type and size not stated on the sheet)","where":"Behind the refrigerator; the hook-up fits within the 2\" back air clearance","zone":{"kind":"any"},"page":"p.91"}],"variations":[{"key":"freestanding","label":"Freestanding (clearances only)","page":"p.91","opening":{},"rule":{},"tells":["Side-by-side doors with handles","Doors stand proud of counter-depth cabinets"],"requires":["Air clearance of 1/8\" each side, 1\" on top and 2\" behind.","Against a wall, allow 10 3/4\" on the freezer side to remove the bin.","Allow 15\" to remove the fresh-food full-size pan without disassembly."],"notes":"Height to top of hinge 69 1/2\"; case height 69\"; width 35 3/4\"; case depth without door 24\"; depth less handle 28 3/4\"; depth with handle 30 3/4\"; depth with fresh-food door open 90° 46 1/2\"; width with door open 90° 42 1/4\".","noOpening":true}]},{"brand":"Monogram","model":"ZTW900PSNSS","prefix":"ZTW900PSNSS","category":"warming","appliance":"30\" warming drawer","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.92–97","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The flush-inset page is labeled ZTW900PN but is page 6 of this model's sheet; confirm it applies to the stainless model.","Side cleat setback (1 7/16\") is read from the top-view drawing and matches the drawer-front thickness; field-check it.","An optional custom panel kit (ZXW900CSNSS, panel up to 3/4\" thick) exists; panel size is not printed."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz · 15 A · 3-prong grounding outlet · 56\" cord exits the right side","where":"Adjacent cabinet within 42\" of the right side or 16\" of the left side of the cutout; or a recessed outlet on the right side of the cutout, 7\" max from the rear of the cabinet","note":"Do not use an extension cord.","offPlane":true,"plane":"adjacent","page":"p.93"}],"variations":[{"key":"below-oven","label":"Below wall oven","page":"p.94","opening":{"w":"28 1/2","d":"23 1/2","h":"9 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Wall oven cutout directly above the drawer cutout"],"requires":["Anti-tip block (2x2 or 2x4) against the rear wall, bottom of block 9\" above the cutout floor.","Support (solid bottom or 2x2/2x4 runners) level, rigid, flush with the cutout bottom and able to carry 150 lb.","Frameless cabinets may need 1/2\" wide side cleats for the mounting screws.","At least 2\" between the oven cutout and the drawer cutout.","Drawer cutout bottom at least 1\" above the toe kick (or adjust to oven height).","Oven supports must not intrude into the 23 1/2\" depth and 9 1/4\" height.","Only approved oven combinations (see label on top of drawer)."],"notes":"Unit 29 3/4\" W x 10 1/2\" H x 23 1/4\" D; 59 lb. Drawer front overlaps the cutout."},{"key":"below-cooktop","label":"Below cooktop","page":"p.94","opening":{"w":"28 1/2","d":"23 1/2","h":"9 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Cooktop in the countertop above the drawer"],"requires":["Anti-tip block (2x2 or 2x4) against the rear wall, bottom of block 9\" above the cutout floor.","Support (solid bottom or 2x2/2x4 runners) level, rigid, flush with the cutout bottom and able to carry 150 lb.","Frameless cabinets may need 1/2\" wide side cleats for the mounting screws.","Top of drawer cutout at least 5 1/2\" below the top of the countertop.","Solid barrier (e.g. 1/4\" plywood) at least 1\" below the lowest point of the cooktop burner box, with at least 1/4\" air gap above the drawer.","Drawer cutout bottom at least 1\" above the toe kick (or adjust to cooktop height)."],"notes":"Unit 29 3/4\" W x 10 1/2\" H x 23 1/4\" D."},{"key":"below-drawer","label":"Below a cabinet drawer","page":"p.95","opening":{"w":"28 1/2","d":"23 1/2","h":"9 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Cabinet drawer directly above the warming drawer"],"requires":["Anti-tip block (2x2 or 2x4) against the rear wall, bottom of block 9\" above the cutout floor.","Support (solid bottom or 2x2/2x4 runners) level, rigid, flush with the cutout bottom and able to carry 150 lb.","Frameless cabinets may need 1/2\" wide side cleats for the mounting screws.","Solid barrier (e.g. 1/4\" plywood) above the warming drawer with at least 1/4\" air gap.","Cutout at least 5\" above the floor or 1\" above the toe kick.","Two drawers side by side need separate cutouts at least 2\" apart."],"notes":"Unit 29 3/4\" W x 10 1/2\" H x 23 1/4\" D."},{"key":"flush-inset","label":"Flush inset","page":"p.97","opening":{"w":"30","d":"24 7/8","h":"10 3/4"},"rule":{"w":"exact","d":"min","h":"min"},"tells":["Drawer front sits inside the cabinet face with 1/8\" reveals","Finished side cleats visible inside the opening"],"requires":["Cabinet surfaces must be appearance-finished for flush installation.","Side cleats may be visible and should be finished to match the cabinetry.","Bottom cleat 1 1/8\" extends the full depth of the cabinet.","Anti-tip block against the rear wall, 9\" from the cutout floor to the bottom of the block."],"notes":"Cutout width between side cleats 28 1/2\". Drawer front thickness 1 7/16\".","prep":[{"kind":"cleat","label":"Finished side cleats","strip":{"face":"both","setbackIn":"1 7/16","runIn":"2 1/2","thicknessIn":"3/4"},"finished":true,"note":"Set back behind the drawer front; leave 28 1/2\" between cleats"},{"kind":"cleat","label":"Bottom cleat","strip":{"face":"bottom","thicknessIn":"1 1/8"},"finished":true,"note":"Extends the full depth of the cabinet"}]}]},{"brand":"Sharp","model":"SMD2479JS","prefix":"SMD2479JS","category":"microwave","appliance":"24\" microwave drawer","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.99–101","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Circuit size (15 or 20 A breaker) and receptacle type are not printed; only the 14.5 A draw.","Receptacle box left-right position is not dimensioned.","Meaning of K (22-1/8\") in the flush drawing is not labeled.","Sheet says these are measurements only and to use the installation manual for installing."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz · 14.5 A draw (1.67 kW)","where":"Suggested outlet on the back wall above the opening (box 5\" tall x 4\" wide, D and F); left-right position not dimensioned","zone":{"kind":"any"},"page":"p.101"}],"variations":[{"key":"standard","label":"Standard mount","page":"p.101","opening":{"w":"22 1/8","d":"23 1/2","h":"15 9/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front overlaps the cabinet face around the opening","Standard 24\" base cabinet under a 36\" countertop"],"requires":["Floor/platform must support 100 lb.","Cabinet at least 24\" deep; drawing assumes a 36\" countertop height.","Anti-tip block at the back, its bottom 14-13/16\" above the opening floor.","Leave 7/16\" min. space above the opening (M)."],"notes":"Unit 23-9/16\" W x 16\" H x 23-1/4\" D; 74 lb. Face overlaps 7/8\" (I) and 7/16\" (K). Anti-tip block drawn 6\" (A) by 3-1/2\" (E). Optional pedestal SKMD24U0ES fits under a counter."},{"key":"flush","label":"Flush mount","page":"p.101","opening":{"w":"23 7/8","d":"23 1/2","h":"16 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front sits flush inside the cabinet face","Support shelf set back behind the face"],"requires":["Floor/platform must support 100 lb.","Front of the support shelf set back 1-17/32\" from the face (L).","Anti-tip block at the back, its bottom 14-13/16\" above the opening floor."],"notes":"Door thickness 1-17/32\". K = 22-1/8\" drawn inside the flush opening. Vent is built into the bottom, so no trim kit is needed."}]},{"brand":"BlueStar","model":"BSEWO30SDV3","prefix":"BSEWO30SDV3","category":"ovens","appliance":"30\" single electric wall oven, French doors","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.102–103","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Page 102 text is broken into fragments; the unit depth could not be quoted cleanly.","Circuit breaker size and conduit length are not quotable from text.","Cutout read off the p.103 drawing (low-resolution scan, inches only); two readers agree."],"utilities":[{"key":"power","label":"Power","need":"208–240 V, 24 A, single phase","where":"Electrical inlet drawn in the cabinet top view 2 11/16\" in from the cutout's right side and 22 3/4\" back from the front; the oven connects on a 20\" flexible conduit (p.103)","zone":{"kind":"any"},"page":"p.103"}],"variations":[{"key":"single","label":"Single wall oven","page":"p.103","opening":{"w":"29 5/8","h":"27","d":"24"},"rule":{"w":"min","h":"min","d":"min"},"tells":["French (side-swing) double doors","Single oven cutout in a tall or base cabinet"],"requires":["Cabinet must support the weight of the oven (see user manual for the minimum).","Cabinet strong enough to carry the oven (check the use & care manual for the weight)."],"notes":"Oven 30\" W x 27\" H (sheet's oven dimensions); weight 304 lbs. Cutout 29 5/8\" W × 27\" H in a 24\" deep cabinet, 2\" minimum from the bottom of the cutout to the bottom of the cabinet front; 33\" recommended cabinet width (p.103). Double oven: 54 1/2\" H."}]},{"brand":"Zephyr","model":"PRB24C01AS-OD","prefix":"PRB24C01AS-OD","category":"beverage","appliance":"24\" outdoor beverage cooler","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.104–105","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No cutout or rough-opening size is printed; only the unit size.","No outlet location, circuit size or receptacle type beyond 115 V / 1.5 A.","No side/top/rear clearance or ventilation requirement is printed other than the hinge-side wall gap.","Door-swing angle on the drawing is rotated text that did not extract."],"utilities":[{"key":"power","label":"Power","need":"115 V, 60 Hz, max 1.5 A","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.105"}],"measure":true,"variations":[{"key":"undercounter","label":"Built-in / freestanding","page":"p.105","opening":{},"rule":{},"tells":["Stainless outdoor-rated glass-door cooler","Front-venting unit under a counter or standing alone"],"requires":["Leave at least 2-1/4\" between the hinge side and a wall so the door can open (top view)."],"notes":"Unit 23-7/8\" W x 33-7/8\" H x 23-1/2\" D; height 33-7/8\" to 34-7/8\" on leveling legs, 37-1/4\" on optional casters; 97 lbs. Installation type listed as compact, built-in or freestanding; outdoor/indoor certified.","noOpening":true}]},{"brand":"Signature Kitchen Suite","model":"SKSDW2411S","prefix":"SKSDW2411S","category":"dishwasher","appliance":"24\" top-control dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.106–108","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Side-wall pass-through hole is shown in a detail (9\" and 4\") but which edges those run to is not labeled.","Water line type/size, drain hose size and air-gap or high-loop rule are not printed.","Hard-wire vs. cord connection and receptacle type are not stated."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A","where":"Accessible location in the adjacent cabinet, not behind the dishwasher, within 4 ft of its side","offPlane":true,"plane":"adjacent","page":"p.108"},{"key":"water","label":"Water","need":"Inlet water 120 °F min to 149 °F max · 20–80 psi","where":"From the adjacent cabinet through a side-wall hole near the floor at the back (detail marks 9\" and 4\")","offPlane":true,"plane":"adjacent","page":"p.108"},{"key":"drain","label":"Drain","need":"Drain to the sink; dishwasher no more than 12 ft from the sink","where":"Through the adjacent sink cabinet","offPlane":true,"plane":"adjacent","page":"p.108"}],"variations":[{"key":"standard","label":"Standard under-counter","page":"p.108","opening":{"w":"24","d":"24","h":"33 5/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Opening beside the sink base","Stainless door with top controls"],"requires":["Install no more than 12 ft from the sink for proper drainage.","Electrical connection accessible, adjacent to and not behind the dishwasher, within 4 ft of its side.","An opening may be needed on both side cabinets to route plumbing and electrical."],"notes":"Unit 23 3/4\" W x 33 5/8\"–36\" H x 24 5/8\" D; depth with door closed and handle 26 13/16\"; depth with door open 49 1/4\"; 97 lbs."}]},{"brand":"Miele","model":"DGC 7885 XXL","prefix":"DGC 7885 XXL","category":"ovens","appliance":"30\" plumbed combi-steam oven","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.109–111","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Proud-install side-view numbers on page 111 are drawing-only; the page 109 minimum niche is used.","Utility positions on the back of the unit (E, W, WW) are drawing-only.","Flush opening read off the p.110 drawing (no text layer); two readers agree on every value and each matches its printed mm. Readers differ on whether 28 1/2\" is the front-panel opening or the carcass; the face opening has to take the appliance front, so 30\" is used at the face.","The bottom cut-out is printed as 4\" x 28\" [100 mm x 720 mm]; 28\" is 711 mm, so the metric figure is rounded — use the inches."],"utilities":[{"key":"power","label":"Power","need":"208/240 V, 60 Hz, 20 A · NEMA 6-20 plug on a 6' 6\" cord","where":"Recommended in the adjacent cabinet; cord runs through the 4\" x 28\" cut-out in the cabinet bottom","offPlane":true,"plane":"adjacent","page":"p.110"},{"key":"water","label":"Water","need":"Cold water · male 3/8\" compression fitting · 14.5–87 psi · supplied 6' 6\" line with female 3/8\" compression","where":"Recommended in the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.110"},{"key":"drain","label":"Drain","need":"Supplied drain hose 9' 10\" long, 7/8\" internal diameter","where":"Recommended in the adjacent cabinet","offPlane":true,"plane":"adjacent","page":"p.110"}],"variations":[{"key":"proud","label":"Proud (standard)","page":"p.111","opening":{"w":"28 1/2","d":"24","h":"24"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven frame sits in front of the cabinet face","Plumbed: water and drain lines run to the oven"],"requires":["Cut a 4\" x 28\" opening in the bottom of the cabinet for the power cord and ventilation.","Electrical and water supplies recommended in adjacent cabinetry; supplies behind the oven need extra cabinet depth."],"notes":"Unit 29 13/16\" W x 24 3/8\" H x 23 1/8\" D."},{"key":"flush","label":"Flush","page":"p.110","opening":{"w":"30","h":"24 1/2","d":"24 15/16"},"rule":{"w":"min","h":"min","d":"min"},"tells":["Oven front sits flush within a recessed cabinet face","Small reveal around the oven front"],"requires":["Cut a 4\" x 28\" opening in the bottom of the cabinet for the power cord and ventilation.","Electrical and water supplies recommended in adjacent cabinetry; supplies behind the oven need extra cabinet depth.","Cut a 4\" × 28\" opening in the cabinet bottom for the power cord and ventilation."],"notes":"Flush recess, reveal and deeper niche are dimensioned only in the flush cutout drawing. Flush (p.110): the opening through the 7/8\"–15/16\" cabinet fronts is 30\" × 24 1/2\"; behind them the carcass niche is 28 1/2\" wide (the proud niche); cabinet 24 15/16\" deep minimum. A 4\" × 28\" cut-out in the cabinet bottom for the power cord and ventilation; supplies in the adjacent cabinet."}]},{"brand":"KitchenAid","model":"KUIX515SPS","prefix":"KUIX515SPS","category":"icemaker","appliance":"15\" automatic ice maker","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.112–116","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Utility areas are given by size and offset letters (B, C, D, G, E, H) without saying which side wall C is measured from, so zones are described in words.","The utility/air-flow slot table (A 14\", B 10.5\", C 7\", D 0.75\", 2\" hole) appears to apply to flush/auxiliary-pump installs; how it applies to this model is unclear.","Page 112 spec table (cutout sizes) did not extract as text and was not used."],"utilities":[{"key":"power","label":"Power","need":"115 V, 60 Hz, AC only, 15 A or 20 A · grounded 3-prong outlet · separate circuit recommended · GFCI may nuisance-trip","where":"Back wall: outlet area 6\" wide (B), 1\" from the side (C), 12\" from the bottom (D), 8\" tall (G)","note":"Use a receptacle that cannot be switched off.","zone":{"kind":"any"},"page":"p.114"},{"key":"water","label":"Water","need":"Cold water: 1/4\" O.D. soft copper tubing with shutoff valve","where":"Back wall: water area 3 1/2\" wide (E), 9\" high (H), drawn at the lower left","zone":{"kind":"any"},"page":"p.114"},{"key":"drain","label":"Drain","need":"Gravity drain 5/8\" I.D. min with 1\" drop per 48\" run, 1\" air gap into a 1 1/2\"–2\" PVC standpipe; or drain pump (max rise 10 ft, max run 100 ft) to an open drain","where":"Floor drain centered 23\" from the front of the door and 7 5/16\" from either side","note":"A drain pump is needed when no floor drain is available.","plane":"floor","zone":{"kind":"any","plane":"floor"},"page":"p.115"}],"variations":[{"key":"undercounter","label":"Under-counter","page":"p.114","opening":{"w":"15","d":"24","h":"34"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Narrow 15\" opening under the counter","Toe grille at the bottom must stay open for airflow"],"requires":["Front must be completely unobstructed for ventilation; unit must be able to pull forward for service.","Floor must be even/level; area sheltered from wind, rain, spray or drip.","Room temperature above 55°F and below 110°F.","Ice maker door must not be flush with standard cabinets (to avoid door-opening problems).","Flush install is intended for auxiliary-pump models with power, water and drain in adjacent cabinetry; with utilities behind, flush may not be achieved."],"notes":"Drain center 23\" from the front of the door (with or without the 3/4\" panel), centered 7 5/16\" from either side.","openingMax":{"h":"34 1/2"}}]},{"brand":"KitchenAid","model":"KCGC506JSS","prefix":"KCGC506JSS","category":"rangetop","appliance":"36\" 6-burner gas rangetop","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.117–120","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Which chart column is the countertop cutout width is read from the drawing: E (35 3/4\", countertop only, for zero clearance) is used; D (35 1/4\") is the cabinet-and-countertop opening.","Gas pipe size is not stated.","N (7 1/4\") is the platform drop from the countertop; the sheet gives it as a single nominal value and notes dimensions are nominal."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A fused circuit · grounded, polarized 3-prong outlet · separate circuit recommended","where":"Cabinet below, left-hand side of the cutout, 16\" max from the enclosure sidewall; at least 10\" from the countertop to the top of the outlet","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.119"},{"key":"gas","label":"Gas","need":"Regulated gas supply · new CSA-approved line with shut-off valve · factory set for natural gas; propane not over 14\" water column","where":"Gas line 14\" below the countertop, in the shaded area on rear or side walls, or up through the floor; unit inlet 1 7/8\" from the back and 4 7/8\" in from the left of the burner base","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.119"}],"variations":[{"key":"standard","label":"Countertop with platform","page":"p.119","opening":{"w":"35 3/4","d":"22 1/4","h":"7 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Front of the countertop and cabinet notched for the rangetop","Cabinet top set down below the countertop as a platform"],"requires":["Upper cabinets at least 18\" above the countertop; upper cabinet depth 13\"; opening between upper cabinets 36\" (C).","At least 12\" from both sides of the rangetop to a side wall or combustible material above the cooking surface.","Without ventilation, at least 58\" from the cooking platform to a combustible surface above.","Backguard required at zero clearance to a combustible back wall; without one, the cutout-to-back-wall distance must be A + 6\".","Cabinet depth 24\"; cabinet-and-countertop opening 35 1/4\" (D).","Range hood of 585 CFM or larger recommended."],"notes":"Unit 35 3/4\" W x 7 7/16\" H x 27 7/8\" D. Gas opening in the platform 12 1/2\" W x 6 7/8\" D, 3/4\" from the back of the cabinet cutout, 2\" from the cabinet side.","form":{"behindMinIn":1.75}}]},{"brand":"KitchenAid","model":"KDTE204KPS","prefix":"KDTE204KPS","category":"dishwasher","appliance":"24\" top-control dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.123–127","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The opening drawing prints 24\" and 34\" as bare labels; depth 24\" has no min/max word.","Utility areas on the side walls are drawn with small dimensions (4\"/3\" and 6 1/4\"/2\") whose edges are not labeled, so they are described in words.","Planning guide covers many models; this entry uses the general standard-model figures (not panel-ready)."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused supply · copper wire only · hard-wire with UL/CSA strain relief, or UL-listed cord kit to a grounded 3-prong outlet","where":"Through the shaded utility areas at the back bottom of the side walls (left drawn 4\" and 3\", right 6 1/4\" and 2\")","note":"May share a circuit with a disposer if the branch circuit rating allows.","offPlane":true,"plane":"adjacent","page":"p.126"},{"key":"water","label":"Water","need":"Hot water, 120°F at the dishwasher · 20–120 psi · 3/8\" O.D. copper with compression fitting or braided line","where":"Through the shaded utility areas at the back bottom of the side walls","note":"Do not solder within 6\" of the inlet valve.","offPlane":true,"plane":"adjacent","page":"p.127"},{"key":"drain","label":"Drain","need":"Drain hose to waste tee or disposer above the trap, at least 20\" above the floor, else an air gap · 1/2\" min I.D. fittings · hose no longer than 12 ft","where":"Adjacent sink cabinet","offPlane":true,"plane":"adjacent","page":"p.127"}],"variations":[{"key":"standard","label":"Standard under-counter","page":"p.126","opening":{"w":"24","d":"24","h":"34"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Opening beside the sink base","Stainless door with top controls"],"requires":["No protrusions on any surface of the opening that would block installation.","Height may be reduced to 33 1/2\" by removing the wheels and perforated insulation area.","Corner installs need 2\" min between the side of the door and the wall or cabinet.","Utility connections go in the shaded areas at the back bottom of the side walls."],"notes":"Door width 23 1/2\"; height 33 7/16\" min, raises 1 7/16\" on feet; toe kick 3 5/16\" min to 4 11/16\" max; depth with door fully open 50 3/16\"; insulation blanket adds up to 11/16\"."}]},{"brand":"Bosch","model":"B36CL80ENS","prefix":"B36CL80ENS","category":"refrigeration","appliance":"36\" counter-depth 4-door French-door refrigerator","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.132–133","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["No outlet or water-line location is printed.","Side gaps and door-swing clearances appear only as drawing labels on page 133 and were not used.","Sheet calls 72\" x 36\" x 25\" the required cutout without saying min or exact."],"utilities":[{"key":"power","label":"Power","need":"115 V, 60 Hz, 15 A · 120V 3-prong plug · 67\" cord","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.132"},{"key":"water","label":"Water","need":"Water supply for the ice maker and internal dispenser (line type and size not stated)","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.132"}],"variations":[{"key":"standard","label":"Counter-depth cutout","page":"p.133","opening":{"w":"36","d":"25","h":"72"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Stainless French doors with recessed handles","Doors sit roughly flush with counter-depth cabinets"],"requires":["Leave a 1/2\" gap at the top and 1\" behind the refrigerator for ventilation.","Do not install next to a heat source such as a stove or range (recommended)."],"notes":"Unit 72\" x 35 5/8\" x 28 3/4\" (H x W x D) with hinges and doors; 71 1/2\" x 35 5/8\" x 24\" without. Leveling legs fully extended add 5/8\" (total 72 5/8\"). 350 lbs. Rear electrical covers need no extra depth."}]},{"brand":"Zephyr","model":"AK9534AS","prefix":"AK9534AS","category":"ventilation","appliance":"36\" hood insert (34-3/8\")","pages":"Steel Cod sheets 10/2026 · Q00085215 book pp.134–135","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["No hood width/overhang or liner requirement is given for the custom hood beyond the bottom cut-out.","Electrical knockout position is read from the top-view drawing; which edge the 4-3/8\" runs to is inferred.","Insert width prints as 34-3/8\" in the table and 34-5/8\" on the cut-out drawing."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, max 4 A","where":"Inside the custom hood; the insert's electrical knockout is near the right end, 4-3/8\" from the right edge in the top view","zone":{"kind":"any"},"page":"p.134"},{"key":"vent","label":"Duct","need":"Vertical: 7\" round or 3-1/4\" x 10\" · Horizontal: 3-1/4\" x 10\"","where":"Duct leaves the top (vertical) or back (horizontal) of the insert","zone":{"kind":"any"},"page":"p.135"}],"variations":[{"key":"insert","label":"Insert in custom hood","page":"p.134","opening":{"w":"34 1/2","d":"18 1/4","h":"24"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Custom hood or cabinet with an open bottom over the range","Stainless insert with baffle filters"],"requires":["Cut the custom hood bottom to 34-1/2\" x 18-1/4\".","Bottom of the hood 24\" to 36\" above the top of a 36\" tall cooking surface."],"notes":"Insert 34-3/8\" wide (34-5/8\" on the cut-out drawing), 6-1/8\" high, 18-1/16\" deep. Blower 290–600 CFM, limitable to 390 or 290 CFM (ACT). Optional recirculating kit ZRC-9100A and make-up air kit MUA006A.","openingMax":{"h":"36"},"hood":{"type":"insert","under":"cooktop","duct":{"size":"7\" round or 3-1/4\" x 10\""},"w":"34 3/8","h":"6 1/8","d":"18 1/16","jbox":"Inside the custom hood; the insert's electrical knockout is near the right end, 4-3/8\" from the right edge in the top view"}}]},{"brand":"Bosch","model":"SHX78CM5N","prefix":"SHX78CM5N","category":"dishwasher","appliance":"24\" bar-handle dishwasher (800 Series)","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.14–16","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Water line type (hot/cold, size) is not stated on the sheet.","No outlet/junction-box location zone is dimensioned; only the side-wall hole is.","The 23 5/8\"-24 1/4\" dimension at the top of the opening is not labelled; the table's 24\" cutout depth was used."],"utilities":[{"key":"power","label":"Power","need":"120 V, 12 A · 3-prong plug cord included (67\" full length) · or hard-wire with junction box SMZPCJB1UC (accessory)","where":"Adjacent cabinet via the side-wall hole; cord install length from edge of unit when facing the door: left 45\", right 56\"","offPlane":true,"plane":"adjacent","page":"p.15"},{"key":"water","label":"Water","need":"Water supply; minimum water pressure 14 lb/sin (supply hose kit SMZSH1ABUC optional)","where":"Through the 2 1/2\" hole in the left or right cabinet wall","note":"Sheet does not state hot vs cold or line type.","offPlane":true,"plane":"adjacent","page":"p.15"},{"key":"drain","label":"Drain","need":"Pre-connected drain hose (79\" included; outlet hose 78 3/4\" in table); extendable to max 155 3/4\" with kit SGZ1010UC","where":"Through the side-wall hole to sink drain; hose loop raised 33\"-43\" above cabinet floor","note":"Drain hose length on drawing: left 67\", right 63\".","offPlane":true,"plane":"adjacent","page":"p.16"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.15","opening":{"w":"24","d":"24","h":"33 7/8"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Stainless door with bar handle across the top of the door","Controls on top edge of door","Toe-kick panel below the door"],"requires":["Cut a 2 1/2\" diameter hole in the left or right cabinet wall for water inlet, drain and power, about 7\" and 2 1/2\" as dimensioned on the drawing.","Raise a portion of the drain hose between 33\" min and 43\" max above the cabinet floor.","Provide a 120 V outlet or a hard-wire connection (junction box accessory SMZPCJB1UC)."],"notes":"Unit 33 7/8\" H x 23 9/16\" W x 23 3/4\" D. Drawing shows height adjustable 33 7/8\"-35\" and toe-kick height 3 1/2\"-4 3/4\". Depth range 23 5/8\"-24 1/4\" is drawn at the top of the opening. All connections are at the rear of the appliance. Net weight 96 lbs.","openingMax":{"h":"35"}}]},{"brand":"Zephyr","model":"PRB24C01CPG","prefix":"PRB24C01CPG","category":"beverage","appliance":"24\" panel-ready single-zone beverage cooler (Presrv)","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.17–18","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No rough-opening (cutout) dimensions on the sheet; only unit size.","Door swing max angle is printed in the drawing graphic only (rotated text), not confirmed in the text layer.","Outlet location and receptacle type are not stated.","Panel weight limit is not stated.","Toe-kick/ventilation clearance requirements are not stated."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz at Max. 1.5A","where":"Not shown on the sheet","zone":{"kind":"any"},"page":"p.18"}],"measure":true,"variations":[{"key":"undercounter","label":"Built-in undercounter","page":"p.18","opening":{},"rule":{},"tells":["Overlay wood panel framing a glass door","Zero-clearance hinges, front vent grille at the bottom"],"requires":["Builder supplies an overlay frame panel 23-5/8\" W x 29-7/8\" H, 5/8\" or 3/4\" thick, with glass opening (panel not included).","Allow 2-1/4\" min from the hinge side to an adjacent wall when an optional Zephyr handle is used."],"notes":"Unit 23-7/8\"W x 33-7/8\"H x 23-3/4\"D (depth with 3/4\" overlay panel); height adjustable 33-7/8\" - 34-7/8\". Side view also dimensions 21-7/8\" (body). Door opens max 115° and needs 46-5/8\" from the back wall when open. Installation type listed as compact / built-in / freestanding. Weight 110lbs.","noOpening":true,"panel":{"width":"23-5/8","height":"29-7/8","thickness":"5/8\" - 3/4\"","page":"p.17"},"panelRule":{"assumedIn":0.75,"minIn":0.625,"maxIn":0.75,"page":"p.18"}}]},{"brand":"Café","model":"CTD90FP2NS1","prefix":"CTD90FP2NS1","category":"ovens","appliance":"30\" French-door double electric wall oven","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.19–21","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Cutout width conflicts: spec table (p19) prints 28-1/2\" while the installation drawing (p20) prints 28-5/8\"; the drawing value was used - confirm against the installation instructions.","Meaning of the 9-1/2\" max dimension at the junction box (offset vs. box zone) is not labelled; zone left as 'any'.","Page 20's text layer contains overlaid side-by-side drawing text that is not visible on the page; only visible content was used."],"utilities":[{"key":"power","label":"Power","need":"Hard-wired, 40 A at 240V (40 A at 208V); 9 kW at 240V / 6.8 kW at 208V; 40\" conduit","where":"Junction box drawn at the upper right of the cutout back wall, bottom of box 47\" above the cutout floor, within a 9-1/2\" max band drawn at the box","note":"Plug and receptacle not approved.","zone":{"kind":"any"},"page":"p.20"}],"variations":[{"key":"standard","label":"Wall cabinet, without pedestal rails","page":"p.20","opening":{"w":"28 5/8","d":"23 1/2","h":"50 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Two French-door oven cavities stacked","No pedestal rails under the lower oven"],"requires":["Hard-wire into an approved junction box; plug and receptacle not approved.","Provide 2x4 (or equivalent) runners level with the bottom of the cutout and flush with its sides, or a solid bottom floor, able to support 400 lbs.","Keep 14\" min from either side of the oven to an adjacent 45 or 90 degree cabinet, drawer or wall (handles protrude 2-1/2\").","Bottom of cutout at least 12\" from the floor."],"notes":"Oven 53\" overall height with trim x 29-3/4\" wide, install depth 23-1/2\". Trim overlaps cutout 1-1/4\" top, 3/4\" sides, 1-1/4\" bottom. Needs 30\" cabinet. Allow 22\" min door-opening allowance in front and 16\" min front clearance. Not approved for flush-mount or stacking. Adjacent cabinets need 194°F adhesive rating. Approved above 27\" and 30\" warming drawers."},{"key":"pedestal","label":"Wall cabinet, with pedestal rails","page":"p.21","opening":{"w":"28 5/8","d":"23 1/2","h":"51 13/16"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Pedestal rails under the lower oven","Replacement of an older GE double oven cutout"],"requires":["Hard-wire into an approved junction box; plug and receptacle not approved.","Provide 2x4 (or equivalent) runners level with the bottom of the cutout and flush with its sides, or a solid bottom floor, able to support 400 lbs.","Keep 14\" min from either side of the oven to an adjacent 45 or 90 degree cabinet, drawer or wall (handles protrude 2-1/2\").","Bottom of cutout at least 12\" from the floor."],"notes":"Same oven as standard: 53\" high with trim, 29-3/4\" wide, 23-1/2\" install depth; 1-1/4\" top/bottom and 3/4\" side overlap.","openingMax":{"h":"51 15/16"}}]},{"brand":"Monogram","model":"ZSB9232VSS","prefix":"ZSB9232VSS","category":"ovens","appliance":"30\" built-in 5-in-1 speedcook oven (Advantium), 240V","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.26–30","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The book holds two copies of this sheet: pages 26-27 (2 pages, flush inset drawing visible on p27) and pages 28-30 (3 pages, only the standard drawing visible on p30). Page 30's hidden text layer also mentions a 30 1/2\" flush inset width with 1/4\" reveals that is not drawn; the visible p27 values were used.","Side-cleat setback (1 7/16\") is read from the top view; cleat front-to-back run is not dimensioned.","Junction box zone is drawn but not dimensioned."],"utilities":[{"key":"power","label":"Power","need":"240/208V AC, 60 Hz, 30A individual grounded branch circuit; hard-wired junction box required; 48\" power cord","where":"Junction box drawn in the upper right of the opening back wall (labelled ELECTRICAL); may also be located in adjacent cabinet","note":"Rating 6.3 kW at 240V / 4.72 kW at 208V.","zone":{"kind":"any"},"page":"p.30"}],"variations":[{"key":"standard","label":"Standard wall installation","page":"p.30","opening":{"w":"25 1/4","d":"23 1/2","h":"17 1/2"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven trim overlaps the face of the cabinet around the cutout","No cleats around the cutout"],"requires":["Bottom of cutout at least 36 3/4\" from the floor.","Platform must support cabinet load, weight of oven and additional oven loads (minimum base support 130 lbs).","Cabinet at least 30\" wide and 23 1/2\" deep.","Hard-wire to a junction box on a 240/208V, 30 Amp individual circuit."],"notes":"Unit 29 3/4\" W x 20 1/4\" H x 22 15/16\" D (includes control panel). Oven door clearance 13\". Shipping weight 115.4 lbs."},{"key":"flush-inset","label":"Flush inset installation","page":"p.27","opening":{"w":"30","d":"23 1/2","h":"20 1/2"},"rule":{"w":"exact","d":"min","h":"exact"},"tells":["Oven face flush with cabinet faces with 1/8\" reveals","Finished cleats visible at sides, top and bottom of the opening"],"requires":["Install finished side, top and bottom cleats to form the 25 1/4\" x 17 1/2\" cutout.","Top surface of the cabinet below must be an appearance-finished surface.","Allow 1/8\" clearances from the side edges of the oven door."],"notes":"Cleats may be visible and should be finished to match cabinetry. Bottom cleat extends full depth of cabinet less side-cleat setback.","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 7/16","thicknessIn":"2 3/8"},"finished":true,"note":"Setback measured in top view from cabinet face"},{"kind":"cleat","label":"Top cleat","strip":{"face":"top","thicknessIn":"1 7/8"},"finished":true,"note":""},{"kind":"cleat","label":"Bottom cleat","strip":{"face":"bottom","thicknessIn":"1 1/8"},"finished":true,"note":"Extends full depth of cabinet less side cleat setback"}]}]},{"brand":"GE","model":"JTS3000SNSS","prefix":"JTS3000SNSS","category":"ovens","appliance":"30\" built-in single electric wall oven","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.31–33","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Undercounter cutout width and depth are not given ('See Installation Instructions for Cutout Size').","Meaning of the 9-1/2\" MAX. dimension at the junction box is not labelled; zone left as 'any'.","Page 32/33 text layers contain overlapping copies of the drawings; quotes were matched to the visible values."],"utilities":[{"key":"power","label":"Power","need":"Hard-wired; breaker 20 Amps at 240V or 208V; 3.6 kW at 240V / 2.7 kW at 208V; 48\" conduit","where":"Wall install: junction box drawn at the upper right of the cutout back wall, 22\" from the cutout floor to the bottom of the box, with a 9-1/2\" MAX. dimension at the box. Undercounter: may be in the adjacent cabinet.","note":"Plug and receptacle not approved.","zone":{"kind":"any"},"page":"p.32"}],"variations":[{"key":"wall","label":"Wall cabinet","page":"p.32","opening":{"w":"28 1/2","d":"23 1/2","h":"27 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["Single oven in a tall wall cabinet","Oven trim overlaps the cabinet face around the cutout"],"requires":["Hard-wire into an approved junction box; plug and receptacle not approved.","If the cabinet has no solid bottom, install two braces or runners that support up to 220 lbs.","Recommended cutout location 32-1/2\" from the floor.","Surrounding wall coverings, countertops and cabinets must withstand up to 200°F."],"notes":"Oven 28-5/8\" overall height with trim x 29-3/4\" wide, install depth 23-1/2\". Overlap: 1\" top, 3/4\" sides, 1-1/4\" bottom. 30\" cabinet. 23\" minimum door-opening allowance. Handle protrudes 3\" from door face. Not approved for stacking with another single wall oven. Approved above 27\" and 30\" warming drawers.","openingMax":{"w":"28 5/8","h":"27 5/16"}},{"key":"undercounter","label":"Undercounter (below countertop or cooktop)","page":"p.33","opening":{"h":"22"},"rule":{"h":"min"},"tells":["Oven below the countertop in a base cabinet","Cooktop may be above the oven"],"requires":["3/4\" support platform required; must support 220 lbs; platform height must match toekick height.","Below a cooktop, keep 31 1/4\" min from the countertop top surface to the wall oven platform.","Gas or electric connections for a gas cooktop must be in an adjacent accessible location to the right."],"notes":"Drawing shows 36\" countertop height, 24\" cabinet depth, 25\" countertop depth and 4\" toekick. Side-by-side: two ovens in separate cutouts, 2\" min between cutouts."}]},{"brand":"Monogram","model":"ZGU366NTSS","prefix":"ZGU366NTSS","category":"rangetop","appliance":"36\" professional gas rangetop, 6 burners (natural gas)","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.34–37","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Rangetop is not on a platform, so no platform height applies.","Cutout width and gas zone read off the p.36 drawing (inches only); two readers agree. Drawing depth (22 3/4\" min) and text depth (25 1/4\" min) disagree."],"utilities":[{"key":"gas","label":"Gas","need":"Natural gas through supplied pressure regulator; inlet pressure 6\" to 13\" water column (LP 11\" to 13\")","where":"Gas inlet zone 17\" wide × 16\" high on the back wall of the cabinet below (drawn at its left side), or on the floor 2\" from the back wall (p.36)","note":"Use a 90 degree elbow to limit interference with drawers. LP conversion kit included.","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.36"},{"key":"power","label":"Power","need":"120V, 60Hz, individual grounded branch circuit protected by a 15 amp breaker or time-delay fuse","where":"Not dimensioned in text","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.35"}],"variations":[{"key":"standard","label":"Countertop cutout","page":"p.36","opening":{"d":"25 1/4","w":"35"},"rule":{"d":"range","w":"min"},"tells":["Knob control panel projects forward of standard-depth cabinets","Rangetop sits 1/2\" above adjacent countertops","Grates on a stainless top frame, no oven below"],"requires":["Clearance between rangetop and side walls at least 12\" each side.","Allow 8\" free space below the top surface of the countertop, plus room below the burner box for the regulator and gas connection.","Without a hood, 48\" minimum to combustibles above; a 36\"- or 42\"-wide professional hood is recommended.","Rear vertical combustible surface needs 12\" minimum clearance, otherwise a non-combustible backsplash is required; back wall between countertop and hood must be non-combustible.","Opening between a 4\" high backsplash must be 36\" for the rangetop to slide back against the wall."],"notes":"Unit 35 7/8\" W x 27 1/2\" D x 8 1/2\" H; 27-5/8\" to front of bullnose, 29-1/8\" to front of knobs. Weight is carried by the side trims. Net weight 135 lbs. Drawing (p.36): countertop cutout 35\" wide, 22 3/4\" min front to back; the opening between a 4\" backsplash must be 36\"; 36\" base cabinet; 8\" free below the countertop surface; 12\" min to a side wall; 48\" min to combustibles without a hood; wall cabinets 18\" min above, 16\" max deep. The text gives 25 1/4\" min cutout depth — the drawing's 22 3/4\" disagrees; check before judging depth.","openingMax":{"d":"26 7/8"}}]},{"brand":"Thermador","model":"DWHD660EFP","prefix":"DWHD660EFP","category":"dishwasher","appliance":"24\" Sapphire dishwasher, Professional handle","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.38–39","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Connection locations, outlet type and drain loop height are not stated.","Water line type is not stated.","Opening width range read off the p.39 drawing (no text layer); two readers agree and the mm match."],"utilities":[{"key":"power","label":"Power","need":"120 V, 12 A; 67\" power cord; junction box SMZPCJB1UC optional","where":"Not dimensioned","offPlane":true,"plane":"adjacent","page":"p.38"},{"key":"water","label":"Water","need":"Minimum water pressure 14 lb/sin; max intake temperature 140 F; supply hose not included (SMZSH1ABUC optional)","where":"Not dimensioned","offPlane":true,"plane":"adjacent","page":"p.38"},{"key":"drain","label":"Drain","need":"Outlet hose 90.5\"; extension SGZ1010UC (76 3/4\") available","where":"Not dimensioned","offPlane":true,"plane":"adjacent","page":"p.38"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.38","opening":{"w":"23 5/8","d":"24","h":"33 7/8"},"rule":{"w":"range","d":"min","h":"min"},"tells":["Stainless door with Professional-style handle","Blue light projected on the floor while running"],"requires":["Provide 120 V power by cord (67\") or junction box; water and drain to the adjacent sink cabinet."],"notes":"Unit 33 7/8\" x 23 9/16\" x 23 3/4\" (HxWxD). Power cord install length from corner of unit facing the door: left 45\", right 56\". Net weight 102 lbs. Opening 23 5/8\"–24 1/4\" wide, 33 7/8\" min high, 24\" deep; unit 33 7/8\"–35\" tall with the feet, toe kick 3 1/2\"–4 3/4\" (p.39).","openingMax":{"w":"24 1/4"}}]},{"brand":"KitchenAid","model":"KOES530SPS","prefix":"KOES530SPS","category":"ovens","appliance":"30\" electric single wall oven","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.40–46","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The lower limit of the allowed cutout-height range in the standard wall install is printed on page 43 but its fraction did not survive text extraction; the 28\" recommended height is used as the lower bound - check page 43.","The electrical table (p41) uses a garbled font: amps/volts values are readable but their labels are not; kW rating could not be read.","Standard cutout depth (24\") has no min/max wording; treated as min.","Dimension guide is labelled 1 of 15 to 5 of 15; only five pages are in the book, so later install details (e.g. double/combination notes) are missing."],"utilities":[{"key":"power","label":"Power","need":"240 V, 20 A; hard-wired through 48\" flexible conduit to a junction box (power cord not included); grounded supply","where":"Wall cabinet: junction box 3\" max above the product opening (recommended locations drawn at upper left/right above the opening). Undercounter: adjacent right or left cabinet.","note":"Do not cut the conduit.","zone":{"kind":"any"},"page":"p.43"}],"variations":[{"key":"standard","label":"Wall cabinet, standard","page":"p.43","opening":{"w":"28 1/2","d":"24","h":"28"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Oven trim overlaps the cabinet face around the cutout","Single oven in a tall wall cabinet"],"requires":["Hard-wire via the oven's flexible conduit to a junction box; junction box 3\" max above the opening when in a wall cabinet, with a 1\" min hole in the right or left rear corner.","Oven support surface must be rigid, level and flush with the bottom of the cutout; floor must support 200 lbs.","Recessed area must completely enclose the sides and top of the oven.","Bottom of cutout 32\" to floor; 1\" from top of cutout to bottom of upper cabinet door; 1 1/2\" min from bottom of cutout to top of lower cabinet door."],"notes":"30\" minimum cabinet width. Tall vent shield needed for cutouts taller than 28 11/16\". Unit 29 3/4\" overall width, 24 1/2\" depth closed excluding handle, 23 1/4\" recessed depth, 26 3/4\" recessed height as received, 28 3/4\" max recessed width. Cabinets must tolerate 194°F.","openingMax":{"h":"29 7/16"}},{"key":"flush","label":"Wall cabinet, flush inset","page":"p.43","opening":{"w":"30 1/4","d":"25","h":"29 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven face flush with cabinet faces, 1/8\" gaps above and below","Cleats visible at top and sides of the opening"],"requires":["Hard-wire via the oven's flexible conduit to a junction box; junction box 3\" max above the opening when in a wall cabinet, with a 1\" min hole in the right or left rear corner.","Oven support surface must be rigid, level and flush with the bottom of the cutout; floor must support 200 lbs.","Recessed area must completely enclose the sides and top of the oven.","Install a 3/4\" top cleat and 11/16\" side cleats recessed 1 3/8\" from the cabinet front, leaving 28 7/8\" min opening width and 28 1/2\" recommended cutout height.","Bottom of cutout 4 5/8\"-32\" to floor.","Exposed areas of the cabinet should be finished to match."],"notes":"Bottom spacer 1/4\" recommended with foot; 15/16\" to 1 1/8\" allowable without foot.","prep":[{"kind":"cleat","label":"Top cleat","strip":{"face":"top","setbackIn":"1 3/8","thicknessIn":"3/4"},"finished":false,"note":""},{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"11/16"},"finished":false,"note":""},{"kind":"spacer","label":"Bottom spacer","strip":{"face":"bottom","setbackIn":"1 3/8","thicknessIn":"1/4"},"finished":false,"note":"1/4\" recommended with foot; 15/16\" to 1 1/8\" without foot"}]},{"key":"undercounter-flush","label":"Undercounter, flush inset (no cooktop above)","page":"p.44","opening":{"w":"30 1/4","d":"25","h":"29 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven flush with base cabinet faces under the countertop","Cleats and spacers visible around the opening"],"requires":["Install 3/4\" top cleat, 11/16\" side cleats, 2\" side spacers the entire depth of the cutout and a 1/4\" bottom spacer the entire depth of the cabinet, all recessed 1 3/8\" from the cabinet front.","Bottom of cutout 4 5/8\" to floor.","Junction box recommended in the adjacent right or left cabinet, with a 1\" min hole in the upper rear corner of the side wall."],"notes":"28 7/8\" minimum width of opening; 28 1/2\" recommended cutout height.","prep":[{"kind":"cleat","label":"Top cleat","strip":{"face":"top","setbackIn":"1 3/8","thicknessIn":"3/4"},"finished":false,"note":""},{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"11/16"},"finished":false,"note":""},{"kind":"spacer","label":"Side spacers","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"2"},"finished":false,"note":"Entire depth of the cutout"},{"kind":"spacer","label":"Bottom spacer","strip":{"face":"bottom","setbackIn":"1 3/8","thicknessIn":"1/4"},"finished":false,"note":"Entire depth of the cabinet"}]},{"key":"undercounter","label":"Undercounter, under a cooktop (standard)","page":"p.44","opening":{"w":"28 1/2","h":"27 3/4"},"rule":{"w":"min","h":"min"},"tells":["Oven below an approved cooktop in a base cabinet","Trim overlaps the base cabinet face"],"requires":["Cooktop must be an approved combination (label on top of oven); center the cooktop cutout over the oven cutout.","31 3/8\" from top of countertop to bottom of cutout; 36\" from cabinet base to countertop.","Junction boxes for oven and cooktop recommended in the adjacent right or left cabinet."],"notes":"24\" cabinet depth, 25\" countertop depth. Allow 5/8\" for oven trim to overlap on each side. 4 5/8\" max from cabinet base with feet installed. Gas cooktop combinations: gas line through wall or floor 10 1/2\" to center of cutout; 1\" clearance to bottom of countertop."}]},{"brand":"Miele","model":"CVA 7775","prefix":"CVA 7775","category":"ovens","appliance":"30\" built-in coffee machine with DirectWater (ContourLine)","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.47–49","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No coffee-machine category exists in the library list; filed under 'ovens' as a built-in niche appliance.","Niche height is printed as 18 1/9\" in the spec table (likely a typo; the raster drawing appears to read 18 1/8\") - verify on site.","Overall unit width is printed with a broken fraction in the text layer and was left out.","Flush opening read off the p.48 drawing (no text layer); two readers agree on every value and each matches its printed mm. Readers differ on whether 28 1/2\" is the front-panel opening or the carcass; the face opening has to take the appliance front, so 30\" is used at the face.","The bottom cut-out is printed as 4\" x 28\" [100 mm x 720 mm]; 28\" is 711 mm, so the metric figure is rounded — use the inches."],"utilities":[{"key":"power","label":"Power","need":"120V, 60Hz, 15 Amps · NEMA 5-15 plug, 6 ft cord","where":"Recommended in adjacent cabinetry","offPlane":true,"plane":"adjacent","page":"p.48"},{"key":"water","label":"Water","need":"Cold water only, with an accessible shut-off valve; 14.5 psi to 145 psi (pressure-reducing valve above 145 psi); BSP to 1/4\" compression fitting supplied; 1/4\" O.D flexible line or copper not supplied; max line length 4’11”","where":"Recommended in adjacent cabinetry","offPlane":true,"plane":"adjacent","page":"p.47"}],"variations":[{"key":"proud","label":"Proud (standard) niche","page":"p.49","opening":{"w":"28 1/2","d":"24","h":"18 1/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Machine front stands proud of the cabinet face","Plumbed coffee machine in a tall or wall cabinet niche"],"requires":["Cut a 4\" x 28\" opening in the bottom of the cabinet for the power cord and ventilation.","Electrical and water supplies recommended in adjacent cabinetry; extra cabinet depth is needed if they are placed behind the appliance."],"notes":"Unit 18 7/8\" H x 18 5/8\" D (width printed with a broken fraction in the text). Shipping weight 83.7 lbs. Niche height 18 1/8\" (460 mm) from the p.49 drawing; the spec table misprints it as 18 1/9\".","prep":[]},{"key":"flush","label":"Flush niche","page":"p.48","opening":{"w":"30","h":"19","d":"24 15/16"},"rule":{"w":"min","h":"min","d":"min"},"tells":["Machine front flush with the cabinet faces"],"requires":["Cut a 4\" x 28\" opening in the bottom of the cabinet for the power cord and ventilation.","Electrical and water supplies recommended in adjacent cabinetry.","Cut a 4\" × 28\" opening in the cabinet bottom for the power cord and ventilation."],"notes":"See the flush cutout drawing for the niche width, height and depth. Flush (p.48): the opening through the 7/8\"–15/16\" cabinet fronts is 30\" × 19\"; behind them the carcass niche is 28 1/2\" wide (the proud niche); cabinet 24 15/16\" deep minimum. A 4\" × 28\" cut-out in the cabinet bottom for the power cord and ventilation; supplies in the adjacent cabinet.","prep":[]}]},{"brand":"JennAir","model":"JDAF3924RX","prefix":"JDAF3924RX","category":"dishwasher","appliance":"24\" panel-ready fully integrated dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.50–54","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Panel width and maximum panel weight are not stated.","Opening width is printed as a range '23 5/8\"-24 1/4\" Minimum'; treated as a 23 5/8\" min / 24 1/4\" max range.","F (11/16\"-1 3/4\") is read as the panel thickness from the side view; the sheet does not label it in words.","No connection location zones are given; the spec table (pp50-51) uses an unreadable font, so cutout table values there could not be used."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused supply; copper wire only; direct wire (max 2 conductors 12 AWG + ground) or UL-listed cord kit into a grounded 3 prong outlet (cord not included)","where":"Not dimensioned on the sheet","note":"Compatible with GFCI and AFCI breakers; may share a circuit with a disposal within rated load.","offPlane":true,"plane":"adjacent","page":"p.52"},{"key":"water","label":"Water","need":"Hot water line, 20 psi to 120 psi, 120°F at dishwasher; 3/8\" O.D. copper tubing with compression fitting or braided supply line","where":"Not dimensioned on the sheet","note":"3/8\" compression x 3/4\" inlet adapter included on leak-detection models.","offPlane":true,"plane":"adjacent","page":"p.52"},{"key":"drain","label":"Drain","need":"Drain hose supplied; to waste tee or disposer above the trap, 20\" min above the floor; 1/2\" minimum I.D. fittings; extension max 12 ft","where":"Adjacent sink cabinet","note":"High loop in adjacent cabinet is the installer's responsibility when draining to a floor drain.","offPlane":true,"plane":"adjacent","page":"p.52"}],"variations":[{"key":"standard","label":"Undercounter, panel-ready","page":"p.54","opening":{"w":"23 5/8","d":"24","h":"32 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["Custom wood panel on the door, controls hidden on the top edge","No visible handle or toe-kick other than cabinet's"],"requires":["Builder supplies the custom door panel (11/16\"-1 3/4\" thick, 28 3/8\"-29 15/16\" tall per the product drawing).","If a custom toe kick is used, adjust panel thickness so it is flush with the cabinet toe kick; the original metal toe kick must remain.","Installer must add a high loop in the adjacent cabinet if draining to a floor drain; use an air gap if the drain connection is lower than 20\" above the floor."],"notes":"Unit 23 9/16\" wide, 21 7/8\" deep without panel. Height of unit equals opening height range 32 1/4\"-35 7/16\".","openingMax":{"w":"24 1/4","h":"35 7/16"},"panel":{"height":"28 3/8\"-29 15/16\"","thickness":"11/16\"-1 3/4\"","page":"p.53"},"panelRule":{"minIn":0.6875,"maxIn":1.75,"unitDepthIn":21.875,"page":"p.53"}}]},{"brand":"Scotsman","model":"SRNP110A-1SS","prefix":"SRNP110A-1SS","category":"icemaker","appliance":"15\" undercounter nugget ice machine with drain pump, stainless door","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.55–56","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["No rough-opening dimensions; only unit size. Opening width/height/depth must be judged from the unit size.","Connection positions are dimensioned on the unit's back, not on the opening wall; exact reference edges of the 7 1/2\", 2 1/2\", 5 1/8\", 2 3/4\", 3 1/4\" and 11 5/8\" dimensions are hard to read in the drawing.","Outlet location/receptacle type is not stated."],"utilities":[{"key":"power","label":"Power","need":"115/60/1, 5 amps, 15a dedicated circuit; 115V power cord","where":"Cord exits the back of the unit about 7 1/2\" from the side and 2 1/2\" up (unit-referenced)","note":"Voltage tolerance -10% / +10%.","zone":{"kind":"any"},"page":"p.56"},{"key":"water","label":"Water","need":"1/4\" O.D. copper water inlet, compression fitting provided; 20-80 PSIG; water 40°F-90°F","where":"Inlet at the upper back of the unit, 5 1/8\" down and 2 3/4\" in (unit-referenced)","note":"Water supply line not included.","zone":{"kind":"any"},"page":"p.56"},{"key":"drain","label":"Drain","need":"Built-in pump; 3/8\" I.D. flexible drain tubing included (10' drain tube)","where":"Drain access at the lower back, 3 1/4\" up and 11 5/8\" from the side (unit-referenced)","zone":{"kind":"any"},"page":"p.56"}],"measure":true,"variations":[{"key":"undercounter","label":"Undercounter","page":"p.56","opening":{},"rule":{},"tells":["Stainless door, front grille with air in/air out at the bottom","Nugget ice in a lighted bin"],"requires":["Provide a 15a dedicated circuit.","Provide a 1/4\" O.D. copper water supply (supply line not included) with 20-80 PSIG pressure.","Pump model: route the included 3/8\" I.D. drain tubing (10' supplied) to a drain."],"notes":"Unit 14 7/8\" W x 22\" D x 33 3/8\" min to 34 3/8\" max H (1\" leg adjustment). Front-breathing (air in/out at the front grille). Anti-tip bracket kit KATB is an accessory. Air temperature 50°F-100°F. Door swing may be limited in a corner by the handle. Shipping weight 138 lb.","noOpening":true}]},{"brand":"Monogram","model":"ZDP486NDTSS","prefix":"ZDP486NDTSS","category":"range","appliance":"48\" dual-fuel professional range, 6 burners + griddle","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.57–60","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Gas inlet / connector size not stated.","Zone x-edges are computed by adding the chained drawing dimensions; the drawing does not print the edge positions themselves.","Sheet does not say whether the range is cord-and-plug or hard-wired, or the receptacle type.","No hood width or mounting height for this range is given (refers to hood instructions)."],"utilities":[{"key":"power","label":"Power","need":"208/240 V, 60 Hz, individual properly grounded branch circuit; 50-amp circuit for 48\" ranges","where":"Box labelled \"Electric\" on the back wall: 16\" wide, 2\" to the right of the Gas/Electric box, drawn the same 6-1/2\" high from the floor.","note":"Zone edges are sums of the chained dimensions (8\" + 14\" + 2\" = 24\", + 16\" = 40\"). A 2\" dimension at the floor edge appears to show the shaded zone running onto the floor.","zone":{"kind":"any"},"page":"p.60"},{"key":"gas","label":"Gas","need":"Natural gas (factory set); supplied regulator must be used; inlet pressure 6\" to 13\" water column (NG), 11\" to 13\" (LP)","where":"Box labelled \"Gas/Electric\" on the back wall: starts 8\" from the left side of the 48\" opening, 14\" wide, 6-1/2\" high from the floor.","note":"x1 is 8\" + 14\". Gas inlet size is not stated on the sheet.","zone":{"kind":"any"},"page":"p.60"}],"variations":[{"key":"standard","label":"Standard (between cabinets)","page":"p.58","opening":{"w":"48","h":"35 1/4"},"rule":{"w":"min","h":"range"},"tells":["Pro-style range with brass-accented knobs and a griddle at the right","Seamless stainless top frame; range trim sits at or above the countertop"],"requires":["Opening between cabinets 48\" min.","Cooking surface / trim height 35 1/4\" to 36 3/4\"; trim must be flush with or higher than the countertop.","At least 12\" between the range sides and any side wall or combustible material.","18\" min between countertop and bottom of the wall cabinets beside the range; those wall cabinets 16\" deep max (as drawn).","Rear wall: 12\" min to a vertical combustible surface, otherwise a backsplash (accessory or custom non-combustible) is required; 0\" to a back or side wall below the cooking surface.","Entire back wall above the range up to the hood must be covered with non-combustible material (metal, tile, brick, stone).","Overhead vent hood required for models with a grill and recommended for all others; without a hood, 60\" min to combustibles above. A custom hood with exposed horizontal combustible surfaces needs an Auto-On feature."],"notes":"Unit 47 7/8\" W x 35 1/4\" H x 28 1/4\" D (to front of door); 29-3/8\" to front of bullnose; 48 1/4\" with oven door open. Toe kick / leg height 3-1/4\" to 4-3/4\". Countertop sits 1\" below the cooking surface (as drawn). Shipping weight 576 lbs. Factory set for natural gas; propane conversion kit included; high-altitude kit needed above 6,000 feet.","openingMax":{"h":"36 3/4"}}]},{"brand":"Monogram","model":"ZGP486NDTSS","prefix":"ZGP486NDTSS","category":"range","appliance":"48\" all-gas professional range, 6 burners + griddle","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.64–67","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Gas inlet / connector size not stated.","Zone x-edges are computed by adding the chained drawing dimensions; the drawing does not print the edge positions themselves.","Sheet does not say whether the range is cord-and-plug or hard-wired, or the receptacle type.","No hood width or mounting height for this range is given (refers to hood instructions).","The tall/low step of the Gas/Electric zone cannot be expressed as one rectangle; only the tall part is coded."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, properly grounded dedicated circuit protected by a 15-amp breaker or time-delay fuse","where":"Shared \"Gas/Electric\" area on the back wall: starts 8\" from the left side, 11\" wide and 6-1/2\" high from the floor, then a lower strip 21\" wide and 3\" high continues to the right.","note":"Zone shown is the tall 11\" part only (x1 = 8\" + 11\"); the 21\" x 3\" low strip to its right is also allowed. A 2\" dimension at the floor edge appears to show the zone running onto the floor.","zone":{"kind":"any"},"page":"p.67"},{"key":"gas","label":"Gas","need":"Natural gas (factory set); supplied regulator must be used; inlet pressure 6\" to 13\" water column (NG), 11\" to 13\" (LP)","where":"Same \"Gas/Electric\" area as power: starts 8\" from the left side, 11\" wide x 6-1/2\" high, plus a 21\" wide x 3\" high strip to the right.","note":"Gas inlet size is not stated on the sheet.","zone":{"kind":"any"},"page":"p.67"}],"variations":[{"key":"standard","label":"Standard (between cabinets)","page":"p.65","opening":{"w":"48","h":"35 1/4"},"rule":{"w":"min","h":"range"},"tells":["Pro-style range with brass-accented knobs and a griddle at the right","Seamless stainless top frame; range trim sits at or above the countertop"],"requires":["Opening between cabinets 48\" min.","Cooking surface / trim height 35 1/4\" to 36 3/4\"; trim must be flush with or higher than the countertop.","At least 12\" between the range sides and any side wall or combustible material.","18\" min between countertop and bottom of the wall cabinets beside the range; those wall cabinets 16\" deep max (as drawn).","Rear wall: 12\" min to a vertical combustible surface, otherwise a backsplash (accessory or custom non-combustible) is required; 0\" to a back or side wall below the cooking surface.","Entire back wall above the range up to the hood must be covered with non-combustible material (metal, tile, brick, stone).","A suitable overhead vent hood is required; a custom hood with exposed horizontal combustible surfaces needs an Auto-On feature."],"notes":"Unit 47 7/8\" W x 35 1/4\" H x 28 1/4\" D (to front of door); 29-3/8\" to front of bullnose; 48 1/4\" with oven door open. Toe kick / leg height 3-1/4\" to 4-3/4\". Countertop sits 1\" below the cooking surface (as drawn). Shipping weight 672 lbs. Factory set for natural gas; propane conversion kit included; high-altitude kit needed above 6,000 feet.","openingMax":{"h":"36 3/4"}}]},{"brand":"Monogram","model":"ZDT985SINII","prefix":"ZDT985SINII","category":"dishwasher","appliance":"24\" fully integrated (custom panel) dishwasher","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.68–71","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Pages 69-70 (dimensions and cutout drawings) are labelled \"ZDT870SIFII & ZDT800SIFII\" even though the sheet is for ZDT985SINII; numbers were used as printed on this sheet but should be confirmed against the ZDT985SINII installation instructions.","Water line size and drain connection size not stated.","Power connection type (hard-wire or cord) not stated.","Unit depth without the panel is not printed (only 23 3/4\" including a 3/4\" panel).","faceFlush is based on \"true flush capable, even with inset cabinets\" (p.68), not a dimensioned flush detail."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115 V, 60 Hz, 15 or 20 amp circuit; unit draws 10.2 A","where":"Electric/water band across the full back wall of the cutout, 6\" high from the floor, running 4\" out from the rear wall at the floor. Electrical connects at the right front of the dishwasher and must extend forward at least 24\" to reach the junction box.","note":"Sheet does not say hard-wire vs cord, or receptacle type.","zone":{"kind":"rect","x0":0,"x1":{"r":0},"y0":0,"y1":6},"page":"p.70"},{"key":"water","label":"Water","need":"Hot water supply line","where":"Same 6\" high band at the bottom of the back wall. Water connects on the left; the hot water line should extend forward 30\" to 40\" from the rear wall.","note":"Line type/size not stated.","zone":{"kind":"rect","x0":0,"x1":{"r":0},"y0":0,"y1":6},"page":"p.70"},{"key":"drain","label":"Drain","need":"Drain hose no more than 12 feet long; air gap or high drain loop required to prevent siphoning","where":"Hose runs to the sink drain / disposer (not drawn).","offPlane":true,"plane":"adjacent","page":"p.70"}],"variations":[{"key":"flush","label":"Flush cutout, custom panel","page":"p.70","opening":{"w":"24","d":"24","h":"33 1/2"},"rule":{"w":"min","d":"min","h":"range"},"tells":["No visible controls on the front; door is a custom cabinet panel with a custom handle","Top-control dishwasher fully hidden behind panel"],"requires":["Cabinet opening at least 24\" wide and 24\" deep.","Underside of countertop 33 1/2\" to 34 3/4\" above the floor.","Custom panel 23-3/4\" wide, 29-13/16\" to 30-1/4\" tall, 20 lbs max, with a custom handle mounted 4-1/2\" max from the top of the panel.","Panel must keep a 1/8\" min gap to the countertop and must not hang below the bottom of the metal door panel.","Allow 2\" min clearance to a wall at the door sides (corner installs)."],"notes":"Unit 23 3/4\" W; height 33 3/8\" min to 34 5/8\" max; depth 23 3/4\" including 3/4\" custom panel. Toe kick height 3 3/8\" min to 4 5/8\" max. Door clearance 25 1/2\". Shipping weight 119 lb. Template drawn for a 3/4\" panel; 1/2\" panels need shorter #8 x 3/4\" screws. Panel template part WD35X25996.","openingMax":{"h":"34 3/4"},"panel":{"width":"23-3/4","height":"29-13/16 to 30-1/4","thickness":"3/4\" (1/2\" allowed with shorter screws)","weight":"20 lb max","page":"p.71"},"panelRule":{"assumedIn":0.75,"faceFlush":true,"page":"p.69"}}]},{"brand":"KitchenAid","model":"KDPM704KPS","prefix":"KDPM704KPS","category":"dishwasher","appliance":"24\" dishwasher, pocket handle, stainless","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.72–76","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["The shaded utility areas are dimensioned on the side walls, and the drawing does not say which number is a height and which a setback, so no zone box is coded.","Junction box / outlet location not stated."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused supply; direct-wire, or UL listed power cord kit into a grounded 3 prong outlet; copper wire only","where":"Shaded utility areas at the rear bottom of the side cabinet walls (drawing marks 4\" and 3\" on the left wall, 6¼\" and 2\" on the right wall); not tied to a specific utility.","note":"May share a circuit with a disposer if within rated load and code.","zone":{"kind":"any"},"page":"p.75"},{"key":"water","label":"Water","need":"120°F hot water, 20 psi to 120 psi; 3/8\" O.D. copper tubing with compression fitting or flexible braided supply line","where":"Same shaded areas at the rear bottom of the side walls (not dimensioned per utility).","note":"Do not solder within 6\" of the water inlet valve; flush new lines before connecting.","zone":{"kind":"any"},"page":"p.76"},{"key":"drain","label":"Drain","need":"1\" drain connector; supplied hose, any replacement 12 ft max; 1/2\" min I.D. drain fittings; connect to waste tee or disposer above the trap, 20\" min above the floor, or use an air gap","where":"Waste tee or disposer inlet at the sink, above the trap.","offPlane":true,"plane":"adjacent","page":"p.76"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.75","opening":{"w":"24","d":"24","h":"34"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Stainless door with a recessed pocket handle","Controls on the top edge of the door"],"requires":["Opening 24\" wide at its narrowest point, 24\" deep, 34\" from floor to the lowest point of the countertop underside (33 1/2\" possible only by removing the wheels and perforated part of the insulation blanket).","Corner installs need 2\" min between the side of the door and the wall or cabinet.","Surfaces inside the opening must have no protrusions."],"notes":"Unit 23 1/2\" W x 33 7/16\" H x 24 1/2\" D (can be raised 1 7/16\" on fully extended feet). Recessed height 33 5/8\" min. Toe kick 3 5/16\" min to 4 11/16\" max. Depth with door fully open 50 3/16\". Insulation blanket adds up to 11/16\" on the sides."}]},{"brand":"KitchenAid","model":"KOES730SPS","prefix":"KOES730SPS","category":"ovens","appliance":"30\" smart single wall oven","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.77–82","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["The product spec pages (77-78) are font-garbled in the text layer; their cutout and weight values are not readable, and the electrical labels are only decodable (Amps 20, Volts 240).","Oven kW rating not readable, so 20 A vs 40 A circuit is taken from the spec page value only.","Installation guide excerpt skips guide page 9; any other variant drawn there is missing.","Cleat run (front-to-back length) not stated; finished/unfinished not stated for cleats.","Under-cooktop variations give cabinet depth (24\") and countertop depth (25\") but no oven cutout depth."],"utilities":[{"key":"power","label":"Power","need":"240 V, 20 A (spec page); hard-wired to a grounded metal permanent wiring system; no power cord included (48\" flexible conduit on the oven)","where":"Wall cabinet: junction box 3\" max below the oven support surface, cable through a 1\" min hole in the right rear or left rear corner of the support surface. Undercounter: junction box in the adjacent right or left cabinet (or recessed, upper center of the rear wall).","note":"Guide rule: 7.3-9.6 kW models need a separate 40 A circuit; 4.8 kW and below need a separate 20 A circuit. This oven's kW rating is not printed in readable text.","plane":"below","zone":{"kind":"any","plane":"below"},"page":"p.79"}],"variations":[{"key":"standard","label":"Wall cabinet (standard)","page":"p.80","opening":{"w":"28 1/2","d":"24","h":"27 1/4"},"rule":{"w":"min","d":"min","h":"range"},"tells":["Oven trim overlaps the cabinet face around the cutout","Single oven in a tall cabinet with doors above and below"],"requires":["Cabinet 30\" wide min.","Bottom of cutout 32\" from the floor (as drawn); 1 1/2\" min from bottom of cutout to top of the lower cabinet door; 1\" from top of cutout to bottom of the upper cabinet door.","Support surface solid, level and flush with the bottom of the cutout; floor must carry a 200 lbs single oven.","Recessed area must fully enclose the recessed part of the oven.","Junction box 3\" max below the support surface, with a 1\" min hole in the right rear or left rear corner of the support surface for the cable."],"notes":"Recommended cutout height 28\"; a tall shield is needed above 28 11/16\". Unit 29 3/4\" overall width, 29\" max overall height; recessed part 28 7/16\" max wide, 26\" high, 23 1/4\" max deep. 48\" flexible conduit.","openingMax":{"h":"29 7/16"}},{"key":"flush-inset","label":"Wall cabinet, flush inset","page":"p.80","opening":{"w":"30 1/4","d":"25","h":"29 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven face sits flush in the cabinet face with no trim overlap","Thin even gap around the oven; cleats visible inside the cutout"],"requires":["Between the side cleats the opening must be 28 7/8\" min wide; recommended cutout height inside cleats 28 1/2\".","Side cleats 11/16\" and top cleat 3/4\", recessed 1 3/8\" from the cabinet front.","Bottom spacer 1/4\" recommended with foot (15/16\" to 1 1/8\" allowable without foot).","Bottom of cutout 4 5/8\" to 32\" from the floor.","Exposed areas of the cabinet should be finished to match."],"notes":"Flush install leaves a 1/8\" gap above and below the oven. Unit 29 3/4\" overall width, 29\" max overall height; recessed part 28 7/16\" max wide, 26\" high, 23 1/4\" max deep. 48\" flexible conduit.","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"11/16"},"finished":false,"note":"Cleats and spacers recessed 1 3/8\" from the cabinet front"},{"kind":"cleat","label":"Top cleat","strip":{"face":"top","setbackIn":"1 3/8","thicknessIn":"3/4"},"finished":false,"note":"Recessed 1 3/8\" from the cabinet front"},{"kind":"spacer","label":"Bottom spacer","strip":{"face":"bottom","setbackIn":"1 3/8","thicknessIn":"1/4"},"finished":false,"note":"1/4\" recommended with foot; 15/16\" to 1 1/8\" allowable without foot"}]},{"key":"undercounter","label":"Undercounter, no cooktop above (flush inset)","page":"p.81","opening":{"w":"30 1/4","d":"25","h":"29 1/4"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven below the countertop with no cooktop over it","Flush face with cleats inside the cutout"],"requires":["Opening between side cleats 28 7/8\" min wide; recommended cutout height 28 1/2\".","Side cleats 11/16\", top cleat 3/4\", 1/4\" x 2\" spacers the full cabinet depth, all recessed 1 3/8\" from the cabinet front.","Bottom of cutout 4 5/8\" from the floor.","Junction box recommended in the adjacent right or left cabinet, with a 1\" min hole in the upper rear corner of the side wall."],"notes":"Unit 29 3/4\" overall width, 29\" max overall height; recessed part 28 7/16\" max wide, 26\" high, 23 1/4\" max deep. 48\" flexible conduit.","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 3/8","thicknessIn":"11/16"},"finished":false,"note":"Cleats and spacers recessed 1 3/8\" from the cabinet front"},{"kind":"cleat","label":"Top cleat","strip":{"face":"top","setbackIn":"1 3/8","thicknessIn":"3/4"},"finished":false,"note":"Recessed 1 3/8\" from the cabinet front"},{"kind":"spacer","label":"Bottom spacers","strip":{"face":"bottom","setbackIn":"1 3/8","thicknessIn":"1/4"},"finished":false,"note":"1/4\" x 2\" spacer the entire depth of the cabinet, at each bottom corner (H); top view also shows a 2\" spacer the entire depth of the cutout"}]},{"key":"under-cooktop","label":"Under electric cooktop (or none)","page":"p.81","opening":{"w":"28 1/2","h":"27 3/4"},"rule":{"w":"min","h":"min"},"tells":["Oven directly below a cooktop in a base cabinet","Oven trim overlaps the cabinet face"],"requires":["Cooktop must be approved for use over an oven; center the cooktop cutout over the oven cutout.","24\" cabinet depth, 25\" countertop depth, 36\" from cabinet base to countertop.","Top of countertop to bottom of oven cutout 31 3/8\"; oven cutout bottom 4 5/8\" max above the cabinet base with feet installed.","Allow 5/8\" each side for the oven trim overlap.","Oven and cooktop junction boxes recommended in the adjacent right or left cabinet, 1\" min hole in the upper rear corner of the side wall."],"notes":"Unit 29 3/4\" overall width, 29\" max overall height; recessed part 28 7/16\" max wide, 26\" high, 23 1/4\" max deep. 48\" flexible conduit."},{"key":"under-gas-cooktop","label":"Under gas cooktop","page":"p.82","opening":{"w":"28 1/2","h":"27 3/4"},"rule":{"w":"min","h":"min"},"tells":["Oven directly below a gas cooktop","Gas pipe beside the oven cutout"],"requires":["24\" cabinet depth, 25\" countertop depth, 36\" from cabinet base to countertop.","1\" clearance from the oven to the bottom of the countertop and 1\" to the cabinet.","Top of countertop to bottom of cutout 31 3/8\"; 4 5/8\" max from cabinet base with feet installed; allow 5/8\" each side for trim overlap.","Gas line through the wall or floor 10 1/2\" to the center of the cutout, on either side; cooktop gas connection is on the right.","Cooktop 120 V grounded outlet recessed in the upper shaded area; oven junction box in the adjacent cabinet with a 1\" min hole in the upper rear corner of the side wall."],"notes":"Unit 29 3/4\" overall width, 29\" max overall height; recessed part 28 7/16\" max wide, 26\" high, 23 1/4\" max deep. 48\" flexible conduit."}]},{"brand":"KitchenAid","model":"KEWS105BPA","prefix":"KEWS105BPA","category":"warming","appliance":"30\" slow cook warming drawer, panel ready","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.83–84","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Custom panel size, thickness and max weight are not given (sheet only recommends a cabinetmaker).","Outlet position is described (\"upper right-hand side\") but not dimensioned.","The meaning of the \"Recommended 4 1/4\"\" / \"Minimum 1\"\" / 4\" dimensions under the lowest cutout is not explained in text."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15-amp fused circuit; separate circuit recommended; 120 V grounded outlet","where":"Recessed outlet in the rear wall at the upper right-hand side of the cutout, or in an adjacent cabinet with a 1 3/8\" min hole through the back of the cutout or support surface.","note":"Outlet must be recessed.","zone":{"kind":"any"},"page":"p.84"}],"variations":[{"key":"standard","label":"Built-in (single, double, or under a single oven)","page":"p.84","opening":{"w":"28 1/2","d":"24","h":"9 1/8"},"rule":{"w":"exact","d":"min","h":"min"},"tells":["Drawer front is a custom wood panel matching the cabinets","Drawer below a wall oven or in a base cabinet"],"requires":["Cabinet 30\" wide min.","Support surface solid, level and flush with the bottom of the cutout; recessed area must fully enclose the drawer.","2 1/2\" min between stacked drawer cutouts and above the top cutout (as drawn).","Below the lowest cutout the drawing shows \"Recommended 4 1/4\"\", \"Minimum 1\"\" and a 4\" toe kick dimension.","Back of the custom wood panel must be sealed against moisture."],"notes":"Unit 29 3/4\" overall width; recessed 28 1/4\" wide, 9\" high, 22 3/4\" deep. Drawer cannot be leveled after install. Can be installed under a single oven (two drawers shown under an oven)."}]},{"brand":"GE Profile","model":"PJE23BYWFS","prefix":"PJE23BYWFS","category":"refrigeration","appliance":"Counter-depth 4-door French-door refrigerator, 23.2 cu. ft.","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.85–89","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["No outlet location, receptacle type or water line location/size given.","No rough opening; clearances are \"air clearances\" from a planning sheet that defers to the installation guide."],"freestanding":true,"utilities":[{"key":"power","label":"Power","need":"120V 60Hz 15A","where":"Not stated on the sheet.","zone":{"kind":"any"},"page":"p.87"},{"key":"water","label":"Water","need":"Water supply for the factory-installed icemaker and internal water dispenser (line type/size not stated)","where":"Not stated on the sheet.","zone":{"kind":"any"},"page":"p.86"}],"variations":[{"key":"freestanding","label":"Freestanding, counter depth","page":"p.89","opening":{},"rule":{},"tells":["French doors over a middle convertible drawer and a bottom freezer drawer","No through-door dispenser; water pitcher inside the left door"],"requires":["Leave air clearance of 1/8\" at each side, 1\" on top and 2\" at the back.","Door swing: 44 7/8\" wide with doors open 90 degrees (incl. handle); 43 3/8\" deep with the fresh-food door open 90 degrees."],"notes":"Case 35 5/8\" wide; 69 7/8\" to top of door, 69 3/4\" to top of hinge cover, 68 5/8\" to top of case. Depth 24 1/2\" case without door, 29 1/4\" without handle, 31 3/4\" with handle. Net weight 360 lb.","noOpening":true}]},{"brand":"Thermador","model":"DWHD640EFP","prefix":"DWHD640EFP","category":"dishwasher","appliance":"Emerald dishwasher, stainless, professional handle","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.90–91","source":"Steel Cod sheets 10/2026","sheetConfidence":"medium","sheetGaps":["Utility locations in the opening are not stated in text.","Water line type/size and drain connection details not stated.","Opening width range read off the p.91 drawing (no text layer); two readers agree and the mm match."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 12 A (1,440 W); 67\" power cord","where":"Sheet gives cord reach from the unit corner (facing the door): 45\" to the left, 56\" to the right. Outlet location is not stated.","note":"Junction box kit SMZPCJB1UC and installation kit SMZ3IN1UC are optional accessories.","offPlane":true,"plane":"adjacent","page":"p.90"},{"key":"water","label":"Water","need":"Min water pressure 14 psi; max inlet water temperature 140 F; inlet hose not included (supply hose SMZSH1ABUC optional)","where":"Not stated.","offPlane":true,"plane":"adjacent","page":"p.90"},{"key":"drain","label":"Drain","need":"Outlet (drain) hose 90.5\" long","where":"Not stated.","offPlane":true,"plane":"adjacent","page":"p.90"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.90","opening":{"w":"23 5/8","d":"24","h":"33 7/8"},"rule":{"w":"range","d":"min","h":"min"},"tells":["Stainless door with a Professional (round bar) handle","Thermador badge; controls on the top edge of the door"],"requires":["Cutout 24\" min wide, 24\" deep and 33 7/8\" min high."],"notes":"Unit 33 7/8\" H x 23 9/16\" W x 23 3/4\" D; adjustable feet; net weight 85.1 lbs. Optional supply/drain hose extension 76 3/4\" (SGZ1010UC). Opening 23 5/8\"–24 1/4\" wide, 33 7/8\" min high, 24\" deep; unit 33 7/8\"–35\" tall with the feet, toe kick 3 1/2\"–4 3/4\" (p.91).","openingMax":{"w":"24 1/4"}}]},{"brand":"Thermador","model":"T36IR905SP","prefix":"T36IR905SP","category":"refrigeration","appliance":"36\" built-in fresh food column, panel ready","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.92–94","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["Panel weight limit not given.","Required cutout depth is 25\" in the spec table but the drawing says recess depth depends on kitchen design, and a frame kit is offered for 24\" deep cutouts.","The product drawing on p.94 also shows 7 1/8\" and 2 13/16\"-4 3/16\" dimensions near the toe kick whose meaning is not labelled; not used.","Power area \"A\" is drawn but not dimensioned."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"110-120 V, 60 Hz, 15 A; 120V 3-prong plug; 118\" power cord","where":"Area \"A\" for the power connection, drawn low on the back wall toward the left; not dimensioned.","zone":{"kind":"any"},"page":"p.93"}],"variations":[{"key":"flush","label":"Built-in column (Freedom hinge)","page":"p.93","opening":{"w":"36","d":"25","h":"84"},"rule":{"w":"exact","d":"min","h":"range"},"tells":["Tall column with a full-height custom panel and a 4\" toe kick panel below","Door hinges hidden; panel sits in line with the cabinet faces"],"requires":["Opening 36\" wide, 84\" to 85 1/16\" high, 25\" deep (per required cutout size).","Furniture return at the front edge of the opening, 4\" min (as drawn).","Door swing: 16 7/8\" beside the hinge side plus the handle; 38 11/16\" in front with the door at 90 degrees.","Custom door panel 35 3/4\" wide x 79 7/8\" high, with a 4\" toe kick below.","Side-by-side columns installed less than 6 inches apart (but not connected) need the Freedom heater kit."],"notes":"Unit 83 3/4\" H (adjustable +/-1/2\") x 35 3/4\" W x 24\" D; net weight 406 lbs. 1/8\" gap each side between unit and cabinet (top view). Door thickness depends on the furniture door; 3/4\" applies to the stainless steel accessory door. Frame kit FRAMEKIT10 is for custom installs in 24-inch deep cutouts with unfinished cabinet returns.","openingMax":{"h":"85 1/16"},"panel":{"width":"35 3/4","height":"79 7/8","thickness":"3/4\" (stainless accessory door; custom depends on furniture door)","page":"p.94"},"panelRule":{"unitDepthIn":24,"page":"p.94"}}]},{"brand":"KitchenAid","model":"KVWB606DSS","prefix":"KVWB606DSS","category":"ventilation","appliance":"36\" wall-mount canopy range hood","pages":"Steel Cod sheets 10/2026 · Q00085216 book pp.95–97","source":"Steel Cod sheets 10/2026","sheetConfidence":"high","sheetGaps":["The vent/power entry area is dimensioned relative to the hood and chimney, not to the cooking surface or floor, so no zone box is coded.","Hood width rule (min vs exact) is not stated; treated as min space between side cabinets.","Mounting/blocking requirements for the wall are not on this sheet."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15-amp fused circuit","where":"Vent and power supply cable entry area on the wall inside the chimney footprint above the hood (drawn 10\" min to 13\" max wide; for recirculating installs its bottom is 17\" above the hood bottom).","zone":{"kind":"any"},"page":"p.97"},{"key":"vent","label":"Vent","need":"6\" round duct; hood exhaust opening 6\" round; roof or wall cap","where":"Up through the chimney inside the same entry area; for wall venting a 90° elbow may sit immediately above the hood.","zone":{"kind":"any"},"page":"p.96"}],"variations":[{"key":"wall-gas","label":"Wall mount over gas cooking","page":"p.97","opening":{"w":"36","h":"27"},"rule":{"w":"min","h":"range"},"tells":["Stainless canopy hood with a chimney cover on the wall","Baffle filters under the canopy"],"requires":["6\" round rigid vent system (flexible vent not recommended), terminating through the roof or wall; max equivalent vent length 35 ft (90° elbow = 5.0 ft, 45° elbow = 2.5 ft).","Vented install ceiling height 7' 4\" min to 9' 2\" max over gas cooking."],"notes":"Hood 36\" wide, 19 11/16\" deep; overall height 24 5/8\" min to 38 3/4\" max vented (28 5/16\" to 42 5/8\" recirculating); canopy edge 5\". Chimney adjusts for ceiling height; extension kit for higher ceilings. 600 CFM. Can be converted to non-vented with a recirculation kit.","openingMax":{"h":"36"},"hood":{"type":"wall","under":"cooktop","duct":{"size":"6\" round"},"w":"36","d":"19 11/16","jbox":"Vent and power supply cable entry area on the wall inside the chimney footprint above the hood (drawn 10\" min to 13\" max wide; for recirculating installs its bottom is 17\" above the hood bottom)."}},{"key":"wall-electric","label":"Wall mount over electric cooking","page":"p.97","opening":{"w":"36","h":"24"},"rule":{"w":"min","h":"range"},"tells":["Stainless canopy hood with a chimney cover on the wall","Over an electric or induction cooktop/range"],"requires":["6\" round rigid vent system (flexible vent not recommended), terminating through the roof or wall; max equivalent vent length 35 ft (90° elbow = 5.0 ft, 45° elbow = 2.5 ft).","Vented install ceiling height 7' 1\" min to 9' 2\" max over electric cooking."],"notes":"Hood 36\" wide, 19 11/16\" deep; overall height 24 5/8\" min to 38 3/4\" max vented (28 5/16\" to 42 5/8\" recirculating); canopy edge 5\". Chimney adjusts for ceiling height; extension kit for higher ceilings. 600 CFM. Can be converted to non-vented with a recirculation kit.","openingMax":{"h":"36"},"hood":{"type":"wall","under":"cooktop","duct":{"size":"6\" round"},"w":"36","d":"19 11/16","jbox":"Vent and power supply cable entry area on the wall inside the chimney footprint above the hood (drawn 10\" min to 13\" max wide; for recirculating installs its bottom is 17\" above the hood bottom)."}}]},{"brand":"Zephyr","model":"PRRFD24C2AP","prefix":"PRRFD24C2AP","category":"refrigeration","appliance":"24\" dual-zone panel-ready refrigerator/freezer drawers","pages":"Steel Cod sheets 11/2026 · S00065111 book pp.13–14","source":"Steel Cod sheets 11/2026","sheetConfidence":"medium","sheetGaps":["The sheet prints no cabinet cutout (width, height or depth) - only the unit dimensions 23-7/8\"W x 33-7/8\"H x 24\"D; noOpening is set and the opening must be sized from the unit.","No receptacle location, cord length, plug type or dedicated-circuit requirement is printed.","No ventilation, side/rear clearance or anti-tip/levelling statement is printed.","No panel weight limit is printed.","The unit's depth without the panel is not printed as a number (24\" is the depth with a 3/4\" panel; the 21-1/16\" side-view dimension runs to the cabinet body, not the drawer front), so panelRule.unitDepthIn is omitted.","All drawing dimensions on pages 13-14 appear only as drawing labels (no table row), so they are marked drawing: true; the sheet prints no mm twins."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"115V, 60Hz at Max. 2A","where":"The sheet does not show a receptacle location or cord length.","note":"No cord length, plug type or dedicated-circuit statement on the sheet.","zone":{"kind":"any"},"page":"p.14"}],"measure":true,"variations":[{"key":"undercounter","label":"Built-in undercounter","page":"p.14","opening":{},"rule":{},"tells":["Two full-width drawer fronts stacked in a 24\" undercounter cabinet space, panel-ready with no handle","Louvered grille across the bottom front of the unit (drawing shows the vent at the toe)","Drawer fronts take customer-supplied wood overlay panels, 2 panels 23-9/16\" wide x 14-7/8\" tall"],"requires":["Unit is 23-7/8\" wide x 33-7/8\" tall x 24\" deep (depth measured with a 3/4\" thick overlay panel); the sheet prints no cabinet cutout, so size the opening to the unit.","Height is adjustable from 33-7/8\" to 34-7/8\" (side view).","Builder/customer supplies two wood overlay panels, each 23-9/16\" wide x 14-7/8\" tall, 5/8\" to 3/4\" thick.","Drawer handles are sold separately: 2 handles are needed and the Zephyr accessory handle comes 1 per pack.","Power: 115V, 60Hz at Max. 2A; the sheet does not say where to put the receptacle."],"notes":"Unit 23-7/8\"W x 33-7/8\"H x 24\"D, 124 lb, Compact / Built-in. Side view: overall depth 25-15/16\" with handle, 24\" to the face of a 3/4\" overlay panel, 21-1/16\" cabinet body; height 33-7/8\" - 34-7/8\". Top view: drawer extends to 39-1/8\" (41-1/8\" to handle) from the back of the unit when fully open; drawer travel 18-1/16\" / 20-1/16\" beyond the front. Front view: 23-7/8\" top width, 23-1/2\" body width. Max clearance height inside drawers 12\". 37 dBA.","noOpening":true,"panel":{"width":"23-9/16","height":"14-7/8","thickness":"5/8\" - 3/4\"","page":"p.13","note":"Two overlay panels, one per drawer, each 23-9/16\" wide x 14-7/8\" tall; optional Zephyr handle screw holes 19-5/16\" apart, 3-9/16\" down from the panel top. No panel weight limit printed."},"panelRule":{"assumedIn":0.75,"minIn":0.625,"maxIn":0.75,"page":"p.14"}}]},{"brand":"KitchenAid","model":"KDTF324PPA","prefix":"KDTF324PPA","category":"dishwasher","appliance":"24\" panel-ready two-rack flush dishwasher","pages":"Steel Cod sheets 11/2026 · S00065111 book pp.15–18","source":"Steel Cod sheets 11/2026","sheetConfidence":"high","sheetGaps":["Opening width is printed as a range with the word Minimum (23 5/8\"-24 1/4\" Minimum, measured from narrowest point of opening); recorded as rule range with 23 5/8\" as the min and 24 1/4\" as the max.","No panel width or panel weight limit is printed (only thickness 11/16\"-1 3/4\" and height 28 3/8\"-29 15/16\").","No electrical or water connection location is drawn or dimensioned; the drain high loop is only placed in the adjacent cabinet in words.","No cord length is printed (power cord kit is sold separately).","The page text renders stacked fractions without a space (321/4 means 32 1/4, 357/16 means 35 7/16, 235/8 means 23 5/8, 241/4 means 24 1/4, 239/16 means 23 9/16, 217/8 means 21 7/8, 183/4 means 18 3/4, 13/4 means 1 3/4, 283/8 means 28 3/8, 2915/16 means 29 15/16); the quotes are verbatim, the values are the readable inch fractions.","The sheet prints the water tubing as 3/8\" (95 mm) O.D., a typo on the sheet for 9.5 mm; the inch value is used."],"panelReady":true,"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A, fused electrical supply; copper wire only; UL Listed power cord kit into a grounded 3 prong outlet, or direct wiring (flexible, armored or nonmetallic sheathed copper wire with ground, max 2 supply conductors 12 AWG largest plus 1 ground in the terminal box)","where":"The sheet does not locate the receptacle or junction box; the dishwasher junction box takes only the dishwasher power and ground connections.","note":"Compatible with time-delay fuses, standard breakers, GFCI and AFCI breakers; may share a circuit with a garbage disposal if the branch circuit load is not exceeded.","zone":{"kind":"any"},"page":"p.16"},{"key":"water","label":"Hot water","need":"Hot water supply at 120°F (49°C), 20 psi to 120 psi (138 kPa to 862 kPa); 3/8\" O.D. copper tubing with compression fitting or flexible braided water supply line; included 3/8\" (9.5 mm) Compression x 3/4\" (19 mm) water inlet adapter for Leak Detection System models","where":"The sheet does not locate the water connection; do not cut the smart inlet hose; in new construction flush the house supply lines before connecting.","note":"Dishwasher has a water heating feature but still requires a hot water line.","offPlane":true,"plane":"adjacent","page":"p.16"},{"key":"drain","label":"Drain","need":"Supplied drain hose (extension max 12 ft / 3.7 m) to a waste tee or disposer inlet above the drain trap and 20\" (508 mm) minimum above the floor; 1/2\" (13 mm) minimum I.D. drain line fittings; air gap if house plumbing is lower than 20\" (508 mm) above the subfloor or floor","where":"In the adjacent cabinet: the unit has no high loop on its side, so the installer adds a high loop in the adjacent cabinet (required if draining to a floor drain; generally not required when connected to a sink drain, counter-top air gap or disposer).","note":"A rubber hose (not provided) is needed between an air gap and the waste tee or disposer inlet.","offPlane":true,"plane":"adjacent","page":"p.16"}],"variations":[{"key":"flush","label":"Flush panel-ready","page":"p.18","opening":{"w":"23 5/8","d":"24","h":"32 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["24\" undercounter dishwasher opening with a custom cabinet-matching door panel and top (hidden) controls","Flush design: the panel face sits in line with the adjacent cabinet doors","Metal toe kick at the bottom that stays even when a custom toe kick is added"],"requires":["Cabinet opening height 32 1/4\" to 35 7/16\" (820-900 mm), measured from the lowest point on the underside of the countertop.","Cabinet opening depth 24\" (609.6 mm) minimum.","Cabinet opening width 23 5/8\" to 24 1/4\" (600-616 mm), measured at the narrowest point of the opening.","Custom door panel 11/16\" to 1 3/4\" (18-45 mm) thick and 28 3/8\" to 29 15/16\" (720-760 mm) tall; the product's original metal toe kick must remain even if a custom toe kick is installed.","Hot water line at 120°F (49°C) and 20 psi to 120 psi (138 kPa to 862 kPa), 3/8\" O.D. copper tubing with compression fitting or flexible braided supply line.","Drain connection to a waste tee or disposer inlet above the drain trap and 20\" (508 mm) minimum above the floor; otherwise an air gap, and a high loop in the adjacent cabinet is the installer's responsibility.","120 V, 60 Hz, AC only, 15 A or 20 A fused electrical supply, copper wire only; power cord kit with a grounded 3 prong outlet or direct wiring."],"notes":"Panel-ready product dimensions (page 17): height A 32 1/4\"-35 7/16\" (820-900 mm), width C 23 9/16\" (599 mm), depth B 21 7/8\" (555 mm) without panel, base depth D 18 3/4\" (477 mm), panel thickness F 11/16\"-1 3/4\" (18-45 mm), panel height G 28 3/8\"-29 15/16\" (720-760 mm), toe-kick space E = A - G. Page 15 product dimensions: Height 35 7/16, Width 23 9/16, Depth 21 7/8. Note: the page text renders the stacked fractions without a space (e.g. 321/4 = 32 1/4).","openingMax":{"w":"24 1/4","h":"35 7/16"},"panel":{"height":"28 3/8\"-29 15/16\"","thickness":"11/16\"-1 3/4\"","page":"p.17","note":"Panel height G is a range 28 3/8\"-29 15/16\" (720-760 mm) and sets the toe-kick space E = A - G. No panel width or weight limit is printed."},"panelRule":{"minIn":0.6875,"maxIn":1.75,"unitDepthIn":21.875,"faceFlush":true,"page":"p.17"}}]},{"brand":"Fisher & Paykel","model":"RGV3-366-L","prefix":"RGV3-366-L","category":"range","appliance":"36\" Series 7 professional 6-burner gas range, LP","pages":"Steel Cod sheets 11/2026 · S00065102 book pp.3–9","source":"Steel Cod sheets 11/2026","sheetConfidence":"medium","sheetGaps":["Gas fitting NPT size and minimum flex-line size are printed as unreadable (missing-glyph) characters on page 3; only 'NPT, min. \"' survives — get the size from the installation guide.","Sheet does not say whether the range ships with a cord and plug or is hard-wired, and gives no NEMA receptacle type.","The electrical supply area's bottom edge is not dimensioned (only its top at 19\" from the floor); zone x0 (6 1/2\" from the right) is a sum of two printed numbers, not a printed figure.","Hood height max. is printed '42 (762mm)' — inch and mm disagree; the sheet's own figures are copied as printed.","No anti-tip bracket detail is printed in these pages."],"utilities":[{"key":"gas","label":"Gas (LPG)","need":"LPG supply at 11\" to 14\" W.C.; NPT fitting with flex line (the NPT size and min. flex-line size are printed as unreadable glyphs on the sheet).","where":"Supply area on the back wall at the right: 1 1/2\" from the right edge of the range to the supply area, supply area 5\" wide (36\" models), gas supply area 12\" high from the floor; max protrusion of the gas connection from the wall 2\". Regulator sits at the back left of the range.","note":"x0 of the zone (6 1/2\" from the right) is derived as 1 1/2\" offset + 5\" width; both are printed, the sum is not.","zone":{"kind":"rect","x0":{"r":6.5},"x1":{"r":1.5},"y0":0,"y1":12},"page":"p.9"},{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A service (the sheet does not say cord/plug or hard-wire, nor a NEMA receptacle).","where":"Electrical supply area on the back wall at the right, directly above the gas area: 1 1/2\" from the right edge of the range, 5\" wide, top of the electrical supply area 19\" from the floor; max protrusion 2\".","note":"The drawing shows the electrical box above the gas box in the same 5\"-wide column; only the top height (19\") is dimensioned, so y0 is taken as the floor. x0 derived as 1 1/2 + 5.","zone":{"kind":"rect","x0":{"r":6.5},"x1":{"r":1.5},"y0":0,"y1":19},"page":"p.9"},{"key":"vent","label":"Ventilation","need":"Hood at least 36\" wide and min. 19\" deep; blower min. 550 CFM for a 36\" range; bottom of hood min. 30\" above the cook surface (non-combustible) or min. 36\" (combustible), max. 42\". Single-wall ducting designed; local codes may require double wall and/or a damper; make-up air recommended.","where":"Above the range, wall or island; overhead cabinetry max. 13\" deep.","note":"The max. is printed as \"max. 42 (762mm)\" — the inch figure 42 does not match the mm figure (762 mm = 30\"); flagged as a sheet inconsistency.","zone":{"kind":"any"},"page":"p.8"}],"variations":[{"key":"standard","label":"Standard (wall or island)","page":"p.6","opening":{"w":"36","h":"35 3/4"},"rule":{"w":"min","h":"range"},"tells":["36\" opening between base cabinets with a 36\"-wide hood above","Gas and electrical supply area at the back right of the opening","Cook surface sits flush with or above the adjacent countertop"],"requires":["Cabinet opening width 36\" (914 mm).","Countertop height 35 3/4\" (flush with counter, legs retracted) to 36 3/4\" (legs fully extended); the cook surface must sit flush with or above the adjacent countertop.","Cabinet depth 27 11/16\" for a flush-with-counter install, or 25 1/8\" if the control panel is to project.","Overhead cabinetry no deeper than 13\" (330 mm); ventilation hood at least 36\" wide.","Minimum 12\" from the side of the range to the nearest vertical combustible surface.","Minimum 54\" from the cook surface to an overhead combustible surface; 36\" to a combustible covering for a ventilation hood; 30\" to a non-combustible surface (guidance only, check local codes).","Minimum 18\" between countertop and cabinet.","Any openings behind or under the range must be sealed; combustion and ventilation air must not be obstructed."],"notes":"Unit: 35 7/8\" W x 29 1/8\" D overall (chassis 25 1/8\" deep; 27 11/16\" rear to control panel front); height 35 3/4\" min (legs retracted) to 36 3/4\" max (legs extended); adjustable feet 1/2\" to 1 1/2\". Weight 440 lb (200 kg) excluding packaging. Door open depth to front control panel 19 1/8\". Recommended back guard: BGRV3-3036H (combustible), BGRV2-3036 / BGRV2-1236 (non-combustible). Recommended hood HCB36-6_N or HCB36-12_N (36\" Professional Range Hood). Clearances apply to both wall and island installs. Clearances under 6\" (152 mm) need local-code approval.","openingMax":{"h":"36 3/4"}}]},{"brand":"Trade-Wind","model":"P32423RC","prefix":"P32423RC","category":"ventilation","appliance":"42\" P3200 series wall-mount pyramid range hood with telescopic duct cover","pages":"Steel Cod sheets 11/2026 · S00065102 book pp.10–11","source":"Steel Cod sheets 11/2026","sheetConfidence":"low","sheetGaps":["The task described this model as an insert/liner for a custom hood, but the sheet is a wall-mount pyramid chimney hood with a telescopic duct cover: there is no custom-hood cutout to report.","No mounting height band above the cooking surface is printed.","No electrical requirement (volts/amps/location) is printed.","No weight is printed.","No mounting/structure requirement is printed.","Duct collar position on the top plate is drawn (centred) but not dimensioned; the 1\", 3/4\" and 2 1/2\" callouts on the drawing are undefined small offsets and were not used.","Duct cover / top plate width for the 42\" model is not stated (drawing lists 18\", 24\", 30\" or 36\" for the series)."],"utilities":[{"key":"vent","label":"Duct","need":"7\" round duct collar on top of the canopy, 390 CFM blower.","where":"Top of the hood, round collar centred on the 12\"-deep top plate (drawing; collar position not dimensioned).","note":"Duct cover (included) is 12\" deep and telescopes 25\" to 42\" for 8' to 10' ceilings; optional PDC3242 telescopes 37\" to 66\" for 10' to 12' ceilings.","zone":{"kind":"any"},"page":"p.11"},{"key":"power","label":"Power","need":"Not stated on this sheet (only 'wiring diagram label for simple electrical connection').","where":"Not stated.","note":"Volts/amps and connection location are not printed; see the installation instructions.","zone":{"kind":"any"},"page":"p.10"}],"variations":[{"key":"wall","label":"Wall mount (pyramid chimney hood)","page":"p.11","opening":{"w":"42","d":"20"},"rule":{"w":"min","d":"min"},"tells":["Stainless pyramid-shaped canopy on the wall with a telescopic stainless duct cover running to the ceiling","7\" round duct collar on top of the canopy","Baffle filters, 2 LED lights, touch controls on the front edge"],"requires":["Wall space 42\" wide for the hood body, 20\" front to back.","7\" round duct connection; vertical (top) discharge through the telescopic duct cover.","Duct cover included covers ceilings 8' to 10' (telescopes 25\" to 42\"); for 10' to 12' ceilings the separate duct cover PDC3242 (37\" to 66\") is needed.","Ductless conversion kit 5BL-33-300-DCK1 is available for 390 CFM models like this one."],"notes":"This is NOT an insert/liner: the sheet describes a 'pyramid hood shape with telescopic duct cover' that 'installs easily to desired ceiling height'. 390 CFM, 3-speed internal blower, 2 LED lights, S/S baffle filters, remote control, electronic touch control, #304 stainless. Drawing (generic for the series): canopy 12\" tall pyramid section plus 4\" straight front lip, 20\" deep, top plate 12\" deep with the round collar centred on it; duct cover 12\" deep. The drawing's top-plate widths are listed as 18\", 24\", 30\", 36\" for the series without saying which goes with the 42\" model. The hood sheet prints no mounting height; the range under it (RGV3-366-L) asks for its hood 30\"–42\" above the cooking surface, at least 36\" wide and 19\" deep, 550 CFM minimum — this hood is 390 CFM.","hood":{"type":"wall","under":"range","w":"42","h":"12","d":"20","duct":{"size":"7\" round","dir":"vertical"}}}]},{"brand":"DCS","model":"DD24DV2T9","prefix":"DD24DV2T9","category":"dishwasher","appliance":"24\" double DishDrawer dishwasher","pages":"Steel Cod sheets 11/2026 · S00065102 book pp.12–13","source":"Steel Cod sheets 11/2026","sheetConfidence":"medium","sheetGaps":["No electrical, water-supply or drain requirements or locations are in these pages (the book holds only the product/cabinetry dimension pages).","Model printed on the sheet is DD24DV2T; the task's DD24DV2T9 suffix is not shown.","Cavity width is printed without a qualifier; recorded as min per the brief's rule, though the unit (23 13/16\") is sized to fill a 24\" cavity."],"utilities":[],"variations":[{"key":"undercounter","label":"Under counter","page":"p.13","opening":{"w":"24","d":"22 1/16","h":"34"},"rule":{"w":"min","d":"min","h":"min"},"tells":["24\" wide cavity under the counter with two stacked drawer fronts","Toekick space 3 15/16\" to 6 5/16\" high","Bracket slots at the top front corners of the chassis for fixing to the cabinetry"],"requires":["Cavity inside width 24\" (610 mm), inside depth min. 22 1/16\" (560 mm), inside height min. 34\" (864 mm).","Recommended height of the adjacent cabinet space 30\" (762 mm).","Toekick space 3 15/16\" to 6 5/16\" high depending on leveling-feet adjustment.","Min. 1/2\" (13 mm) clearance from a corner cupboard and min. 1/16\" (2 mm) clearance to an adjacent cupboard door."],"notes":"Sheet is headed DD24DV2T (the 9 suffix is not printed). Unit: 23 13/16\" W, 22 3/4\" D excluding handle (chassis 21 3/4\" to the back of the drawer panel; panel 1\" thick), overall height 34\" to 36 3/8\" depending on leveling feet (3/8\" to 2 11/16\"); chassis 33 11/16\" high including 1/16\" bracket slots. Drawer fronts 30\" total (upper 17 3/8\", lower 12 1/4\", 5/16\" ventilation gap). Toekick height customisable 2 13/16\" to 5\"; toekick setback adjustable 1 11/16\" to 4 3/16\" to match adjoining cabinetry. Drawer extends 21 9/16\"."}]},{"brand":"Fisher & Paykel","model":"OMD24SPX1","prefix":"OMD24SPX1","category":"microwave","appliance":"24\" Series 7 professional microwave drawer","pages":"Steel Cod sheets 11/2026 · S00065102 book pp.14–18","source":"Steel Cod sheets 11/2026","sheetConfidence":"high","sheetGaps":["Receptacle location in the cabinet is not given; only the inlet position on the unit (back left, 4\" x 4 13/16\") and the rating are printed.","Sheet does not say cord-and-plug or hard-wire.","Page 16 prints a 'Minimum inside height of cavity 393 mm / 15 1/12\"' that disagrees with the cabinetry page (16 1/16\" flush, 15 9/16\" proud); the cabinetry page values were used.","No weight is printed."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, 15 A; must be earthed; connected only by a suitably qualified person (cord/plug vs hard-wire and receptacle type not stated).","where":"The unit's electrical inlet is on the top of the chassis at the back left corner: 4\" from the back and 4 13/16\" from the left of the chassis (plan view L, M). The sheet does not locate the receptacle in the cabinet.","note":"Rating label is beyond the back wall of the microwave cavity, facing up, visible with the drawer fully open.","zone":{"kind":"any"},"page":"p.18"}],"variations":[{"key":"flush","label":"Flush install","page":"p.17","opening":{"w":"22 1/8","d":"21 15/16","h":"16 1/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front sits flush with the surrounding cabinet faces","Cabinet face 5/8\" to 13/16\" (16-20 mm) thick at the reveal, 1/16\" (2 mm) gap","Push-to-open handle-free drawer under a counter or lower cabinet"],"requires":["Cavity inside min. 22 1/8\" wide x 21 15/16\" deep x 16 1/16\" high (flush install); overall cabinetry width 24\", overall cabinetry height 17 9/16\".","Anti-tip block (not supplied) built into the cabinetry at the top rear: 6\" wide x 3 1/2\" deep, bottom of block 14 13/16\" above the bottom of the cabinetry.","120 V, 60 Hz, 15 A earthed supply connected by a qualified person.","If a cooktop is installed above, provide clearance per the cooktop manufacturer's instructions."],"notes":"Unit 23 7/8\" W x 15 15/16\" H x 23 5/16\" D overall; chassis 21 15/16\" W x 14 3/4\" H x 21 3/4\" D; control panel 2 15/16\" high, 1 9/16\" deep; drawer opens 13\". Dimensions may vary ±2 mm (1/16\"). Flush detail on the drawing: 5/8-13/16\" (16-20 mm) cabinet face, 1/16\" (2 mm) reveal.","prep":[{"kind":"blocking","label":"Anti-tip block — top rear of cavity","strip":{"face":"top","runIn":"3 1/2"},"finished":false,"note":"6\" wide x 3 1/2\" deep block at the top rear of the cavity (drawn at the back right in plan); bottom of block 14 13/16\" above the bottom of the cabinetry. Not supplied with the product"}]},{"key":"proud","label":"Proud install","page":"p.17","opening":{"w":"22 1/8","d":"21 15/16","h":"15 9/16"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Drawer front and control panel stand 3/4\" (19 mm) proud of the cabinet face","Push-to-open handle-free drawer under a counter or lower cabinet","Shorter cavity: 15 9/16\" inside height"],"requires":["Cavity inside min. 22 1/8\" wide x 21 15/16\" deep x 15 9/16\" high (proud install); overall cabinetry width 24\", overall cabinetry height 17 1/16\".","Anti-tip block (not supplied) built into the cabinetry at the top rear: 6\" wide x 3 1/2\" deep, bottom of block 14 13/16\" above the bottom of the cabinetry.","120 V, 60 Hz, 15 A earthed supply connected by a qualified person.","If a cooktop is installed above, provide clearance per the cooktop manufacturer's instructions."],"notes":"Unit 23 7/8\" W x 15 15/16\" H x 23 5/16\" D overall; chassis 21 15/16\" W x 14 3/4\" H x 21 3/4\" D; control panel 2 15/16\" high, 1 9/16\" deep; drawer opens 13\". Dimensions may vary ±2 mm (1/16\"). Proud detail on the drawing: front stands 3/4\" (19 mm) proud of the cabinet face; 1 9/16\" (40 mm) control panel depth below.","prep":[{"kind":"blocking","label":"Anti-tip block — top rear of cavity","strip":{"face":"top","runIn":"3 1/2"},"finished":false,"note":"6\" wide x 3 1/2\" deep block at the top rear of the cavity (drawn at the back right in plan); bottom of block 14 13/16\" above the bottom of the cabinetry. Not supplied with the product"}]}]},{"brand":"Monogram","model":"ZTS90DPSZSS","prefix":"ZTS90DPSZSS","category":"ovens","appliance":"30\" built-in single electric wall oven (Statement)","pages":"Steel Cod sheets 11/2026 · Q00082998 book pp.7–10","source":"Steel Cod sheets 11/2026","sheetConfidence":"medium","sheetGaps":["Model-number mismatch: page 7 names ZTS90DPSZSS, but the dimension pages 8-10 carry a hidden 'ZET9050SHSS' header in their text layer; the visible drawings/table were used as the sheet for this model.","The flush-inset drawings (30\" x 28 15/16\" x 24 15/16\" with cleats) are present only in the clipped/hidden layer of page 9, not in the visible print; treat the flush-inset variation as unverified until checked against the Monogram installation instructions.","No wall-installation front view is visible, so the junction-box zone (5 1/4\" x 9 1/2\") is taken from the undercounter front view.","Sheet gives shipping weight (184 lbs) and base support (220 lbs) but not the oven's net weight.","Advantium and warming-drawer cutout sizes are not given here (per those products' sheets)."],"utilities":[{"key":"power","label":"Power","need":"240/208 V AC, 60 Hz, 20 A individual properly grounded branch circuit or breaker · hard-wired (junction box required for built-in product) · 48\" conduit (72\" available special order WB18T10398) · 3.4 kW at 208 V / 4.5 kW at 240 V","where":"Junction box in the upper right corner of the cutout back wall: the ELEC zone is drawn 9 1/2\" wide x 5 1/4\" high from the top right corner (undercounter front view, page 9). May also be located in the adjacent cabinet.","note":"Under a cooktop the junction box can protrude 2 7/8\" max from the back wall of the installation (not the cabinet wall) (page 10).","zone":{"kind":"rect","x0":{"r":9.5},"x1":{"r":0},"y0":{"t":5.25},"y1":{"t":0}},"page":"p.9"}],"variations":[{"key":"standard","label":"Standard (wall)","page":"p.9","opening":{"w":"28 1/2","d":"23 1/2","h":"27 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["Oven sits in a tall cabinet on a support platform; the oven trim/door stands proud of the cabinet face (not flush)","Cutout bottom recommended 32 1/2\" above the floor","Single oven cavity, nothing stacked above or below it"],"requires":["Cutout 28 1/2\" to 28 5/8\" wide, 27 1/4\" to 27 5/16\" high, 23 1/2\" deep minimum, in a cabinet at least 30\" wide and 24\" deep.","Support platform must be able to support 220 lbs (99 kg).","Allow 1/8\" clearance from the side edges of the oven door.","Junction box in the upper right corner of the cutout (may also be located in the adjacent cabinet); 240/208 V, 60 Hz, 20 A individual grounded branch circuit, hard-wired."],"notes":"Overall 29 3/4\" W x 28 11/16\" H x 27 5/16\" D including handle; open-door clearance 20 9/16\"; shipping weight 184 lbs. Recommended cutout location 32 1/2\" from floor to cutout bottom (based on a user height of 5' 6\" to 5' 10\"). Page 8 note: additional space will be needed for flush installation. Stacked or paired: Stacked with Advantium and warming drawer: Leave 2 1/2\" (6.4) minimum of cabinet between the Advantium cutout and the oven cutout. Leave 2\" (5.1) minimum of cabinet between the oven cutout and the warming drawer cutout. | Side by side (two ovens): Leave 2\" (5.1) minimum of cabinet between the two oven cutouts. Each cutout per the page 8 table; each needs its own junction box location (may also be in an adjacent cabinet) and a platform supporting 220 lbs (99 kg).","openingMax":{"w":"28 5/8","h":"27 5/16"}},{"key":"flush-inset","label":"Flush inset","page":"p.9","opening":{"w":"30","d":"24 15/16","h":"28 15/16"},"rule":{"w":"exact","d":"min","h":"exact"},"tells":["Oven face finishes flush with the cabinet faces, with a 1/8\" reveal all round","Cabinet opening is larger than the oven (30\" x 28 15/16\") with wood cleats inside that the oven lands on","Cutout is deeper (24 15/16\") than the standard 23 1/2\""],"requires":["Flush inset cutout 30\" wide x 28 15/16\" high with 1/8\" reveals, 24 15/16\" deep.","Side cleats 3/4\" thick, 2 1/2\" deep, set back 1 7/16\" from the cabinet face; top cleat 1 1/8\"; bottom cleat 9/16\" extending the full depth of the cabinet. The cleats form the 28 1/2\" x 27 1/4\" opening the oven needs.","Support platform must be able to support 220 lbs (99 kg).","Allow 1/8\" clearance from the side edges of the oven door."],"notes":"Read off the sheet's flush-inset drawing, which this package prints clipped (hidden under the standard view) — confirm against the Monogram installation instructions before the cabinet shop builds to it. ","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 7/16","runIn":"2 1/2","thicknessIn":"3/4"},"finished":false,"note":"Side cleats depth 2 1/2\" (6.4), set back 1 7/16\" (3.6) from the cabinet face per the hidden top view; 3/4\" (1.9) wide in the front view. Sheet does not say whether they are finished"},{"kind":"cleat","label":"Top cleat","strip":{"face":"top","thicknessIn":"1 1/8"},"finished":false,"note":"Top cleat 1 1/8\" (2.8)"},{"kind":"cleat","label":"Bottom cleat","strip":{"face":"bottom","thicknessIn":"9/16"},"finished":false,"note":"Bottom cleat 9/16\" (1.4), extends full depth of cabinet"}]},{"key":"undercounter","label":"Undercounter","page":"p.9","opening":{"w":"28 1/2","d":"23 1/2","h":"27 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["Oven sits in a base cabinet below a countertop (often under a cooktop)","A 3/4\" thick platform under the oven, with a solid toe-kick area below it","Cutout top is 3\" below the top of the cabinet in the front view"],"requires":["3/4\" thick support platform required, able to support 220 lbs (99 kg).","Minimum 31 1/4\" from the top surface of the countertop to the top surface of the wall oven support platform when installed beneath a certified cooktop.","Cutout 28 1/2\" min wide x 27 1/4\" high x 23 1/2\" min deep; junction box zone 9 1/2\" wide x 5 1/4\" high in the upper right corner of the cutout (may also be in the adjacent cabinet).","Allow 1/8\" clearance from the side edges of the oven door."],"notes":"Front view shows 3\" (7.6) from the cabinet top to the top of the cutout and the 3/4\" (1.9) platform at the bottom.","openingMax":{"w":"28 5/8","h":"27 5/16"}},{"key":"under-cooktop","label":"Under a cooktop","page":"p.10","opening":{"w":"28 1/2","d":"23 1/2","h":"27 1/4"},"rule":{"w":"range","d":"min","h":"range"},"tells":["Oven cutout directly below a cooktop in a base cabinet, 3/4\" platform under the oven","Gas line and cooktop electrical come into the right-hand adjacent cabinet","Junction box for the oven in the upper right of the cutout, cooktop junction box above it"],"requires":["This oven is only approved to be installed under specific cooktop models as labeled on the unit.","Minimum 31 1/4\" from the top surface of the countertop to the top surface of the oven support platform; 3/4\" thick wood platform required, capable of supporting 220 lbs (99 kg), platform base at the same height as the toe kick.","Gas regulator and electric connections for the cooktop must be located in an adjacent accessible location to the right.","For flush oven installations the cooktop cutout must be set back 2 1/2\" (6.4 cm) plus the cleat setback.","Oven junction box may protrude 2 7/8\" max from the back wall of the installation (not the cabinet wall).","Top and/or side fillers may be needed between existing cabinets and must be attached securely since they anchor the oven."],"notes":"Cooktop gas/electric offsets vary by cooktop model; sheet examples: ZGU36 gas stub 5 1/2\" from wall, 0\" from centerline, 5 1/2\" drop requiring a 90 degree 1/2\" FPT x 1/2\" FL brass street elbow; ZGU30 4 5/16\" from wall, 12 1/16\" from centerline, 5\". Verify the actual cooktop's sheet.","openingMax":{"w":"28 5/8","h":"27 5/16"}}]},{"brand":"Monogram","model":"ZSB9132VSS","prefix":"ZSB9132VSS","category":"ovens","appliance":"30\" built-in 5-in-1 oven with Advantium technology, 120 V","pages":"Steel Cod sheets 11/2026 · Q00082998 book pp.11–12","source":"Steel Cod sheets 11/2026","sheetConfidence":"medium","sheetGaps":["Two-page sheet with no specification table: no overall unit dimensions, no weight, no amperage/receptacle/cord information (only '120V' in the title).","Model-number mismatch: the sheet title (page 11) says ZSB9132VSS; the drawing page's hidden text header reads ZSB9132NSS.","The standard (non-flush) installation drawing is clipped out of the visible print; the standard cutout is inferred from the cleat-formed cutout in the flush-inset front view.","Undercounter drawing dimensions only the 23 1/2\" min depth.","Junction box zone is drawn but not dimensioned; side-cleat run (front to back) not given."],"utilities":[{"key":"power","label":"Power","need":"120 V (per the sheet title '5-IN-1 OVEN WITH ADVANTIUM TECHNOLOGY 120V'); amps, receptacle type and cord/hard-wire are not stated on this sheet","where":"ELECTRICAL box drawn in the upper right corner of the cutout back wall (not dimensioned); junction box may also be located in the adjacent cabinet.","zone":{"kind":"any"},"page":"p.12"}],"variations":[{"key":"flush-inset","label":"Flush inset (wall)","page":"p.12","opening":{"w":"30","d":"23 1/2","h":"20 1/2"},"rule":{"w":"exact","d":"min","h":"exact"},"tells":["Oven face finishes flush with the cabinet faces with a 1/8\" reveal at the sides, top and bottom","Cabinet opening 30\" x 20 1/2\" with wood cleats inside forming a 25 1/4\" x 17 1/2\" cutout the oven lands in","Top surface of the cabinet is an appearance-finished surface"],"requires":["Flush inset opening 30\" wide with 1/8\" reveals x 20 1/2\" high with 1/8\" reveal at top and bottom; cutout depth 23 1/2\" minimum.","Side cleats 2 3/8\" wide set back 1 7/16\" from the cabinet face; top cleat 1 7/8\"; bottom cleat 1 1/8\" extending the full depth of the cabinet less the side cleat setback. Cleats may be visible and should be finished to match the cabinetry.","Top surface of the cabinet must be an appearance finished surface for flush installation.","Platform must be able to support the cabinet load, the weight of the oven and additional oven loads.","Allow 1/8\" clearances from the side edges of the oven door.","Junction box in the upper right corner of the cutout (may also be located in the adjacent cabinet)."],"notes":"Cutout inside the cleats: 25 1/4\" (64.1) wide x 17 1/2\" (44.5) high. Sheet gives no overall unit dimensions or weight.","prep":[{"kind":"cleat","label":"Side cleats","strip":{"face":"both","setbackIn":"1 7/16","thicknessIn":"2 3/8"},"finished":true,"note":"Side cleats 2 3/8\" (6.0); top view shows them set back 1 7/16\" (3.7) from the cabinet face. Run (front to back) not dimensioned"},{"kind":"cleat","label":"Top cleat","strip":{"face":"top","thicknessIn":"1 7/8"},"finished":true,"note":"Top cleat 1 7/8\" (4.8)"},{"kind":"cleat","label":"Bottom cleat","strip":{"face":"bottom","thicknessIn":"1 1/8"},"finished":true,"note":"Bottom cleat 1 1/8\" (2.9), extends full depth of cabinet less side cleat setback"}]},{"key":"undercounter","label":"Undercounter (flush inset)","page":"p.12","opening":{"d":"23 1/2"},"rule":{"d":"min"},"tells":["Oven set in a base cabinet under a countertop, face flush with the cabinet","Oven sits on the cabinet platform with the same cleat frame as the wall flush-inset"],"requires":["Cutout depth 23 1/2\" minimum.","Platform must be able to support the cabinet load, the weight of the oven and additional oven loads."],"notes":"The undercounter drawing is labelled FLUSH INSET INSTALLATION and only dimensions the depth; width/height are not restated (the wall flush-inset 30\" x 20 1/2\" opening is presumably the same, but the sheet does not say so)."},{"key":"standard","label":"Standard (not flush)","page":"p.12","opening":{"w":"25 1/4","d":"23 1/2","h":"17 1/2"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Oven trim stands proud of the cabinet face, no cleat frame or reveal","Plain 25 1/4\" x 17 1/2\" cutout in a 30\" cabinet"],"requires":["Cutout 25 1/4\" wide x 17 1/2\" high x 23 1/2\" deep minimum.","Allow 1/8\" clearances from the side edges of the oven door."],"notes":"CAUTION: the visible print of page 12 shows only flush-inset drawings; 'STANDARD INSTALLATION' labels and the 25 1/4\" / 23 1/2\" callouts exist only in the clipped text layer. The 25 1/4\" x 17 1/2\" cutout is the opening the cleats form in the flush-inset front view. Confirm against the installation instructions."}]},{"brand":"KitchenAid","model":"KDTS624SPS","prefix":"KDTS624SPS","category":"dishwasher","appliance":"24\" top-control dishwasher with towel bar handle, third rack","pages":"Steel Cod sheets 11/2026 · Q00082998 book pp.13–17","source":"Steel Cod sheets 11/2026","sheetConfidence":"high","sheetGaps":["The sheet shows two side-wall utility zones (4\" x 3\" and 6 1/4\" x 2\") but does not say which wall (left/right) or which utility (power, water, drain) uses which.","No NEMA receptacle designation and no cord length (a cord kit is sold separately).","Planning guide covers many KitchenAid models; the 24\" and 3/4\" panel-ready figures on page 15 do not apply to this stainless towel-bar model.","Page 13 spec table text is garbled in the PDF (font encoding) so the model-specific dimension values there could not be read; dimensions come from the planning guide pages 14-16.","Weight is not stated."],"utilities":[{"key":"power","label":"Power","need":"120 V, 60 Hz, AC only, 15 A or 20 A fused electrical supply · copper wire only · time-delay fuse or circuit breaker recommended · cord: UL listed power cord kit into a grounded 3-prong outlet, or direct wire with flexible, armored or nonmetallic sheathed copper wire and a UL listed/CSA approved metallic strain relief · may share the circuit with a garbage disposal if the branch circuit is not overloaded","where":"Through a shaded area of the cabinet side walls at the rear bottom corner of the opening: 4\" (10.2 cm) wide x 3\" (7.6 cm) high on one side wall, 6 1/4\" (15.9 cm) high x 2\" (5.1 cm) wide on the other (page 16 drawing); the sheet does not say which utility uses which side.","note":"A maximum of 2 field wiring supply conductors (12 AWG largest size) plus 1 grounding conductor in the terminal box; no extension cord or adapter.","offPlane":true,"plane":"adjacent","page":"p.17"},{"key":"water","label":"Water","need":"Hot water line, 20 psi to 120 psi, 120°F at the dishwasher · 3/8\" O.D. copper tubing with compression fitting or flexible braided supply line · 90° elbow with 3/4\" hose connection with rubber washer","where":"Through the shaded area of a cabinet side wall at the rear bottom corner of the opening (4\" x 3\" on one side, 6 1/4\" x 2\" on the other); side not specified.","note":"1/2\" minimum plastic tubing is not recommended; do not solder within 6\" of the water inlet valve; flush new-construction supply lines before connecting.","offPlane":true,"plane":"adjacent","page":"p.17"},{"key":"drain","label":"Drain","need":"Drain hose supplied (fits the 1\" drain connector); replacement hose 12 ft maximum, no joined hoses · connect to a waste tee or disposer inlet above the drain trap and 20\" minimum above the floor, or use an air gap if the connection is lower than 20\" · 1/2\" minimum I.D. drain line fittings","where":"To the house plumbing in the adjacent sink cabinet, entering through the shaded side-wall area at the rear bottom corner of the opening.","note":"Loop the hose up and fasten it to the underside of the counter or connect it to an air gap.","offPlane":true,"plane":"adjacent","page":"p.17"}],"variations":[{"key":"standard","label":"Standard undercounter","page":"p.16","opening":{"w":"24","d":"24","h":"33 5/8"},"rule":{"w":"min","d":"min","h":"min"},"tells":["Standard 24\" opening under the countertop between base cabinets","Stainless (PrintShield) front with a towel-bar handle and controls on the top edge of the door","Utility connections come through the cabinet side walls at the rear floor corners"],"requires":["Opening 24\" wide minimum (measured at the narrowest point), 24\" deep, 33 5/8\" high minimum measured from the lowest point on the underside of the countertop.","Check that all surfaces have no protrusions that would prohibit dishwasher installation.","Corner locations require a 2\" minimum clearance between the side of the dishwasher door and the wall or cabinet.","Utility connections may only be installed in the shaded areas of the cabinet walls: a 4\" x 3\" area on one side wall and a 6 1/4\" x 2\" area on the other, both at the rear bottom corner of the opening."],"notes":"Unit: door width 23 15/16\"; height to top of handle 30 13/16\"; recessed height 33 5/8\" minimum (can be raised 1 7/16\" with feet fully extended); depth without door 22 5/8\", depth with towel bar handle 26 7/8\", depth with door fully open 50 3/16\" minimum, depth with toe kick 20 13/16\" minimum; adjustable toe kick 3 5/16\" to 4 11/16\". Insulation blanket can be crushed up to 1/8\" or removed along the top perforated section for extra clearance. The 33 5/8\" minimum may be achieved by removing the feet and the perforated insulation area."}]}];
  /* the four Sub-Zero Group sheets in the books are the same format as the
     guides, and match them dimension for dimension: the Cove DW2450 (the
     DW2451's predecessor) and two legacy Wolf models */
  function scLegacy(e, book, pages, vpages, extra) {
    e.source = SC; e.pages = SC + " · " + book + " book " + pages;
    e.variations.forEach(function (v) { if (vpages[v.key]) v.page = vpages[v.key]; });
    return Object.assign(e, extra || {});
  }
  function coveLegacy(model, prefix, appliance, book, pages, vp) {
    var e = coveDw(model, prefix, appliance, false);
    e.utilities = [
      { key: "power", label: "Power", need: "Dedicated 115 VAC, 15 A · 3-prong grounding receptacle, 6' cord", offPlane: true,
        where: "Within reach of the 6' cord — the sheet draws no location (the DW2451 guide puts it in the adjacent cabinet)" },
      { key: "water", label: "Water supply", need: "5' braided tubing, 3/8\" female compression · 30–140 psi", offPlane: true,
        where: "Within reach of the 5' tubing" },
      { key: "drain", label: "Drain", need: "5' corrugated tubing", offPlane: true, where: "Within reach of the 5' tubing" }
    ];
    e.variations.forEach(function (v) {
      v.page = vp[v.key];
      v.panel = Object.assign({}, v.panel, { weight: "20 lb limit (under 16 lb optimal; the panel table lists 16 lb)", page: vp[v.key + "Panel"] });
      v.panelRule = Object.assign({}, v.panelRule, { page: vp.notes });
      v.requires = ["Finish the 3 1/2\" returns on all sides to match the cabinetry."];
      v.notes = (v.key === "24in" ? "Reveals are larger than at 23 5/8\" unless the panel is widened. " : "Minimum reveals; ideal for new construction. ") +
        "Unit 23 5/8\" W × 34 1/2\" H × 23 1/4\" D; allow for the panel thickness in the opening depth. Panel sizes assume a 34 1/2\" opening and 1/8\" top reveal; minimum panel height 28\", minimum toe kick 4\". Legacy model.";
    });
    e.source = SC; e.pages = SC + " · " + book + " book " + pages;
    return e;
  }
  SC_SHEET_MODELS.push(
    coveLegacy("DW2450", "DW2450", "24\" dishwasher — panel ready (legacy)", "Q00085212", "pp.16–25", { "60cm": "p.17", "24in": "p.19", "60cmPanel": "p.21", "24inPanel": "p.24", notes: "p.22" }),
    coveLegacy("DW2450WS", "DW2450WS", "24\" dishwasher with water softener — panel ready (legacy)", "Q00085212", "pp.80–89", { "60cm": "p.81", "24in": "p.83", "60cmPanel": "p.85", "24inPanel": "p.88", notes: "p.86" }),
    scLegacy(wolfSpeed("SPO30PM/S/PH", "SPO30PM", "30\" M Series professional speed oven (legacy)", 30), "Q00085212", "pp.90–93", { flush: "p.91", standard: "p.93" }, {
      utilities: [{ key: "power", label: "Power", need: "Dedicated 240/208 VAC, 15 A, NEMA 6-20R · 6' cord", where: "Anywhere within the opening (p.91)", zone: { kind: "any" } }] }),
    scLegacy(wolfMdd("MDD24TE/S/TH", "MDD24TE", "24\" E Series transitional drop-down door microwave (legacy)", 24), "Q00085215", "pp.128–131", { flush: "p.129", standard: "p.131" }, {
      utilities: [{ key: "power", label: "Power", need: "Dedicated 120 VAC, 15 A · 3-prong, 4' cord", where: "Upper left of the opening as drawn (not dimensioned)", zone: { kind: "any" } }] })
  );
  /* family members the sheets name themselves: the KitchenAid planning
     guides "apply to all model numbers starting with" their lists (book 3
     p.73 for the KDPM line, book 1 p.47 for the KDTM line), and the
     Scotsman SCN60 sheet's table carries the stainless pump model */
  var SC_ALIASES = { "KDPM704KPS": ["KDPM604K", "KDPM804K"], "KDTM604KPS": ["KDTM404K", "KDTM704K", "KDTM804K"], "SCN60PA-1SU": ["SCN60PA-1SS"] };
  SC_SHEET_MODELS.forEach(function (e) { if (SC_ALIASES[e.model]) e.aliases = SC_ALIASES[e.model]; });
  Array.prototype.push.apply(MODELS, SC_SHEET_MODELS);

  /* Manufacturers punctuate their own model numbers inconsistently — the
     Steel Cod contents block says GDM23FCHC, the True sheet says
     GDM-23FC-HC~TSL01. Comparison strips everything but the letters and
     digits so the same box matches itself however it is written. */
  function normModel(m) { return String(m || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  /* A model the office has entered or corrected shadows the built-in of the
     same number. The built-ins are a starting set, not the authority. */
  function libModels() {
    var mine = (STATE && STATE.models) || [];
    var shadowed = {};
    mine.forEach(function (m) { shadowed[normModel(m.model)] = true; });
    return mine.concat(MODELS.filter(function (m) { return !shadowed[normModel(m.model)]; }));
  }
  function isBuiltIn(model) {
    var q = normModel(model);
    return MODELS.some(function (m) { return normModel(m.model) === q; });
  }
  function isEdited(model) {
    var q = normModel(model);
    return ((STATE && STATE.models) || []).some(function (m) { return normModel(m.model) === q; });
  }
  function saveModel(entry) {
    var st = load();
    st.models = st.models || [];
    var q = normModel(entry.model);
    var at = -1;
    st.models.forEach(function (m, i) { if (normModel(m.model) === q) at = i; });
    if (at >= 0) st.models[at] = entry; else st.models.push(entry);
    save();
    libMark("model", q);
    return entry;
  }
  function removeModel(model) {
    var st = load();
    var q = normModel(model);
    st.models = (st.models || []).filter(function (m) { return normModel(m.model) !== q; });
    save();
    libMark("model", q, true);
  }
  function blankVariation() {
    return { key: "", label: "", page: "", opening: { w: "", d: "", h: "" },
             rule: { w: "exact", d: "min", h: "min" }, tells: [], requires: [], notes: "" };
  }
  function blankModelEntry() {
    return { brand: "", model: "", prefix: "", category: "", appliance: "", pages: "",
             variations: [blankVariation()], source: "manual" };
  }
  /* Every variation in the library that still has no opening. This is the
     queue the office works through after a spec package is read. */
  function openingQueue() {
    var out = [];
    libModels().forEach(function (e) {
      (e.variations || []).forEach(function (v) {
        if (v.noOpening) return;
        if (hasOpening(v)) return;
        out.push({ entry: e, variation: v });
      });
    });
    return out;
  }
  /* ---------- remembered dimensions -------------------------------------
     Not a library. A library is a thing somebody owns, curates and keeps
     current, and an unaudited one is worse than none — it speaks with
     confidence about numbers nobody checked.

     This is a memory: what a person already read off a Steel Cod page,
     stamped with which package it came from, the date that sheet was cut,
     and who typed it. It is never authoritative. Next job it arrives
     pre-filled and UNCONFIRMED, sitting beside that job's own sheet, and a
     person clears it with one look. Steel Cod re-cuts these sheets — the
     same job's package carried sheets dated July 1 and August 3 — so the
     page in hand always outranks anything remembered.

     Key is model + installation variation, because a CL4850's flush and
     standard openings differ by inches. */
  function dimKey(model, basisKey) {
    return normModel(model) + "|" + (basisKey || "-");
  }
  function dimMemory() {
    var st = load();
    st.dims = st.dims || {};
    return st.dims;
  }
  function rememberedDims(model, basisKey) {
    if (!model) return null;
    return dimMemory()[dimKey(model, basisKey)] || null;
  }
  /* `confirmed` is the whole point: a remembered number only becomes usable
     once a person has said it matches the sheet in front of them. */
  function rememberDims(model, basisKey, rec) {
    if (!model) return null;
    var mem = dimMemory();
    var entry = {
      /* the model as written and its install type, so the library screen can
         show the row without decoding its key (v0.9.85) */
      model: String(rec.model || model), basisKey: basisKey || "",
      w: rec.w || "", d: rec.d || "", h: rec.h || "",
      rule: rec.rule || null,
      noOpening: !!rec.noOpening,
      /* v0.9.41: everything else the office settled about the model comes
         back with the numbers — the library cache grows one model per walk */
      max: rec.max ? { w: rec.max.w || "", d: rec.max.d || "", h: rec.max.h || "" } : null,
      installType: rec.installType || "",
      rules: rec.rules && typeof rec.rules === "object" ? rec.rules : null,
      prep: Array.isArray(rec.prep) && rec.prep.length ? JSON.parse(JSON.stringify(rec.prep)) : null,
      utilities: Array.isArray(rec.utilities) ? rec.utilities.map(function (u) {
        return JSON.parse(JSON.stringify(u));
      }) : null,
      panel: rec.panel && (rec.panel.ready === true || rec.panel.ready === false)
        ? { ready: rec.panel.ready, by: rec.panel.by || "", thicknessIn: rec.panel.thicknessIn || "", w: rec.panel.w || "", h: rec.panel.h || "" }
        : null,
      sourceDoc: rec.sourceDoc || "", sheetDate: rec.sheetDate || "",
      pageNo: rec.pageNo || null,
      typedBy: rec.by || "", typedAt: isoNow(),
      /* The confirmation is the part that matters: who put their eyes on a
         real drawing, and which printing of it. A later package carrying a
         re-cut sheet asks again. */
      confirmedBy: rec.confirmedBy || "", confirmedAt: rec.confirmedAt || "",
      confirmedSheetDate: rec.confirmedSheetDate || "",
      confirmedDoc: rec.confirmedDoc || "",
      origin: rec.origin || "read",
      seenCount: ((mem[dimKey(model, basisKey)] || {}).seenCount || 0) + 1
    };
    mem[dimKey(model, basisKey)] = entry;
    save();
    libMark("dims", dimKey(model, basisKey));
    return entry;
  }
  function forgetDims(model, basisKey) {
    var mem = dimMemory();
    delete mem[dimKey(model, basisKey)];
    save();
    libMark("dims", dimKey(model, basisKey), true);
  }

  /* ---------- the shared spec library (v0.9.85) ---------------------------
     Cayden, 17 Nov 2026: "We need a place we can access all of our spec
     libraries and make edits to anything we may run into that imported
     wrong ... I want to be able to improve the library outside of walks."

     Until now a model the office corrected (`models`) and a set of numbers
     somebody confirmed against a sheet (`dims`) lived in the one browser
     that did it. Both are now rows on the server, so a correction made once
     is made for everybody:

       kind "model"  key = the model number, letters and digits only
                     doc = the library entry (it shadows the built-in)
       kind "dims"   key = model|install type
                     doc = the confirmed numbers, with the sheet and who

     The built-in entries still ship in this file; the server holds only
     what people changed or added. One row is written per change, the
     newest write wins, and removing a row leaves a marker so it is removed
     everywhere. With no server (the one-file build) nothing here runs and
     the library stays in the browser as before. */
  function libUrl() { return hasPortal() ? apiUrl("library", "/api/sitewalk/library") : ""; }
  function libDirty() { var st = load(); st.libDirty = st.libDirty || {}; return st.libDirty; }
  function libMark(kind, key, gone) {
    if (!key || libApplying) return;
    libDirty()[kind + "|" + key] = gone ? "gone" : "set";
    save();
    if (libUrl()) setTimeout(function () { libPush(); }, 0);
  }
  var libApplying = false, libBusy = null, libState = { at: "", rows: 0, error: "" };
  function libDocOf(kind, key) {
    var st = load();
    if (kind === "dims") return (st.dims || {})[key] || null;
    return (st.models || []).filter(function (m) { return normModel(m.model) === key; })[0] || null;
  }
  /* send what this browser changed; a row stays marked until the server has it */
  function libPush() {
    var url = libUrl(), dirty = libDirty(), keys = Object.keys(dirty);
    if (!url || !keys.length) return Promise.resolve(0);
    var sent = 0;
    return keys.reduce(function (p, dk) {
      return p.then(function () {
        var cut = dk.indexOf("|"), kind = dk.slice(0, cut), key = dk.slice(cut + 1);
        var doc = dirty[dk] === "gone" ? null : libDocOf(kind, key);
        var body = doc ? { kind: kind, key: key, doc: doc } : { kind: kind, key: key, deleted: true };
        return fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (b) { if (b && b.ok) { delete libDirty()[dk]; sent++; } })
          .catch(function () { });
      });
    }, Promise.resolve()).then(function () { if (sent) save(); return sent; });
  }
  /* take the server's rows; anything this browser has changed and not yet
     sent is left alone, and anything it holds that the server has never
     seen is sent up (so a library built before v0.9.85 is not lost) */
  function libApply(rows) {
    var st = load(), dirty = libDirty(), seen = {}, changed = 0;
    st.models = st.models || []; st.dims = st.dims || {};
    libApplying = true;
    try {
      (rows || []).forEach(function (r) {
        if (!r || !r.key || (r.kind !== "model" && r.kind !== "dims")) return;
        var dk = r.kind + "|" + r.key;
        seen[dk] = true;
        if (dirty[dk]) return;
        var doc = r.deleted ? null : r.doc;
        if (doc && typeof doc === "object") { doc.sharedAt = r.updatedAt || ""; doc.sharedBy = r.updatedBy || ""; }
        if (r.kind === "dims") {
          var had = JSON.stringify(st.dims[r.key] || null);
          if (doc) st.dims[r.key] = doc; else delete st.dims[r.key];
          if (had !== JSON.stringify(st.dims[r.key] || null)) changed++;
        } else {
          var at = -1;
          st.models.forEach(function (m, i) { if (normModel(m.model) === r.key) at = i; });
          var was = at >= 0 ? JSON.stringify(st.models[at]) : "null";
          if (doc) { if (at >= 0) st.models[at] = doc; else st.models.push(doc); }
          else if (at >= 0) st.models.splice(at, 1);
          if (was !== JSON.stringify(doc)) changed++;
        }
      });
      st.models.forEach(function (m) { var dk = "model|" + normModel(m.model); if (!seen[dk] && !dirty[dk]) dirty[dk] = "set"; });
      Object.keys(st.dims).forEach(function (k) { var dk = "dims|" + k; if (!seen[dk] && !dirty[dk]) dirty[dk] = "set"; });
    } finally { libApplying = false; }
    save();
    return changed;
  }
  function syncLibrary() {
    var url = libUrl();
    if (!url) return Promise.resolve({ ok: false, shared: false });
    if (libBusy) return libBusy;
    libBusy = libPush().then(function () {
      return fetch(url, { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; });
    }).then(function (b) {
      if (!b || !b.ok) { libState.error = "The shared library could not be reached."; return { ok: false, shared: true }; }
      var changed = libApply(b.rows || []);
      libState = { at: isoNow(), rows: (b.rows || []).filter(function (r) { return !r.deleted; }).length, error: "" };
      return libPush().then(function () { return { ok: true, shared: true, changed: changed, rows: libState.rows }; });
    }).catch(function () { libState.error = "The shared library could not be reached."; return { ok: false, shared: true }; })
      .then(function (out) { libBusy = null; return out; });
    return libBusy;
  }
  function libraryState() {
    return { shared: !!libUrl(), at: libState.at, rows: libState.rows, error: libState.error, unsent: Object.keys(libDirty()).length };
  }

  function findModel(model) {
    var q = normModel(model);
    if (!q) return null;
    var all = libModels(), i;
    for (i = 0; i < all.length; i++) if (normModel(all[i].model) === q) return all[i];
    /* a sheet that says "applies to all model numbers starting with …"
       carries those prefixes as `aliases`; the longest match wins (v0.9.75) */
    var best = null, bestLen = 0;
    for (i = 0; i < all.length; i++) {
      [all[i].prefix || all[i].model].concat(all[i].aliases || []).forEach(function (pre) {
        var p = normModel(pre);
        if (p && q.indexOf(p) === 0 && p.length > bestLen) { best = all[i]; bestLen = p.length; }
      });
    }
    return best;
  }
  function variationOf(entry, key) {
    if (!entry) return null;
    return entry.variations.filter(function (x) { return x.key === key; })[0] || null;
  }
  /* The finish suffix a quote line carries past the library's prefix —
     CL4250UFD/S → "S". Only entries that declare `suffixes` read it. */
  function modelSuffix(e, model) {
    if (!e || !e.suffixes) return "";
    var m = /\/([A-Z])\s*$/i.exec(String(model || ""));
    return m && e.suffixes[m[1].toUpperCase()] ? m[1].toUpperCase() : "";
  }
  /* Why the sheet rules this install out for this exact model, or "". */
  function variationBar(e, v, model) {
    if (!e || !v || !v.onlySuffix) return "";
    var sx = modelSuffix(e, model);
    if (!sx || v.onlySuffix.indexOf(sx) >= 0) return "";
    return (v.onlyWhy || (v.label + " is not for this model")) + " (" + (e.source || "the sheet") + " " + (v.page || "") + "); " +
      String(model).toUpperCase() + " is " + e.suffixes[sx].label + ".";
  }
  /* Panel-ready for this exact model: the suffix decides when it can. */
  function entryPanelReady(e, model) {
    if (!e) return null;
    var sx = modelSuffix(e, model);
    if (sx && typeof e.suffixes[sx].panelReady === "boolean") return e.suffixes[sx].panelReady;
    return !!e.panelReady;
  }
  /* Is a page heading the drawing of this install? "STANDARD INSTALLATION"
     ~ Standard; "FLUSH INSET INSTALLATION" ~ Flush inset. Word-subset, the
     same reading the office import uses. */
  function headingFits(heading, label) {
    var H = String(heading || "").toUpperCase().replace(/INSTALLATION/g, "").replace(/[^A-Z0-9 ]/g, " ");
    var words = String(label || "").split(/[·(]/)[0].toUpperCase().replace(/INSTALL(ATION)?/g, "").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    return !!words.length && words.every(function (w) { return H.indexOf(w) >= 0; });
  }
  /* The attached sheet draws one install and the opening is walked as
     another (Cayden, 27 Oct: CL4250UFD/S walked as Flush inset, the
     package's p.41 is STANDARD INSTALLATION). Returns the sheet's heading
     when they disagree, else "". */
  function sheetBasisMismatch(it) {
    var v = itemVariation(it), hd = it && it.specPage && it.specPage.heading;
    if (!v || !hd || !/INSTALLATION/i.test(hd)) return "";
    return headingFits(hd, v.label) ? "" : hd;
  }
  function itemEntry(it) { return findModel(isMerge(it) ? it.merge.units[0].model : it.model); }
  function itemVariation(it) { return variationOf(itemEntry(it), it.basisKey); }
  function hasOpening(v) { return !!(v && v.opening && (v.opening.w || v.opening.d || v.opening.h)); }
  function openingText(v) {
    if (!v) return "";
    var parts = [];
    DIMS.forEach(function (d) { var n = num(v.opening[d.k]); if (n != null) parts.push(fmtIn(n) + " " + d.k.toUpperCase()); });
    return parts.join(" × ") || "no rough opening";
  }

  function basisPending(it) {
    var e = itemEntry(it);
    return !!(e && e.variations.length > 1 && !it.basisKey);
  }
  function applyBasis(it, key) {
    var e = itemEntry(it), v = variationOf(e, key);
    if (!v) return;
    it.basisKey = key;
    it.installType = v.label;
    it.specRef = v.page;
    if (hasOpening(v)) {
      it.specMax = it.specMax || {};
      DIMS.forEach(function (d) {
        it.spec[d.k] = v.opening[d.k] || "";
        if (v.rule && v.rule[d.k]) it.rule[d.k] = v.rule[d.k];
        /* a sheet that gives a window (a hood's 30"–36" above the cooking
           surface) carries its top end with it */
        it.specMax[d.k] = (v.openingMax && v.openingMax[d.k]) || "";
      });
    } else {
      DIMS.forEach(function (d) { it.spec[d.k] = ""; });
    }
    if (!it.brand && e.brand) it.brand = e.brand;
    if (!it.appliance && e.appliance) it.appliance = e.appliance;
    it.basisConfirmed = "";
  }

  /* Dimensions on which a model's variations actually disagree. Scoring a
     basis on a dimension both details share tells you nothing. */
  function discriminators(entry) {
    var vs = entry.variations.filter(hasOpening);
    var out = { dims: [], spread: 0 };
    if (vs.length < 2) return out;
    var total = 0;
    DIMS.forEach(function (d) {
      var vals = vs.map(function (v) { return num(v.opening[d.k]); }).filter(function (x) { return x != null; });
      if (vals.length < 2) return;
      var spread = Math.max.apply(null, vals) - Math.min.apply(null, vals);
      if (spread > 1 / 32) { out.dims.push(d.k); total += spread; }
    });
    out.spread = out.dims.length ? total / out.dims.length : 0;
    return out;
  }
  function fitVariations(it) {
    var e = itemEntry(it);
    if (!e) return [];
    var disc = discriminators(e), out = [];
    e.variations.forEach(function (v) {
      if (!hasOpening(v)) return;
      var n = 0, sum = 0, dn = 0, dsum = 0, parts = [];
      DIMS.forEach(function (d) {
        var spec = num(v.opening[d.k]), act = num(it.actual[d.k]);
        if (spec == null || act == null) return;
        var gap = Math.abs(act - spec);
        n++; sum += gap;
        if (disc.dims.indexOf(d.k) >= 0) { dn++; dsum += gap; }
        parts.push(d.k.toUpperCase() + " " + fmtDelta(act - spec));
      });
      if (!n) return;
      out.push({ v: v, n: n, avg: sum / n, davg: dn ? dsum / dn : sum / n, parts: parts });
    });
    out.sort(function (a, b) { return a.davg - b.davg; });
    out.spread = disc.spread;
    return out;
  }
  /* Scaled to how far apart the details actually are: 3/8" decides a
     dishwasher, 8" separates the speed oven details. */
  function basisMismatch(it) {
    if (!it.basisKey) return null;
    var fits = fitVariations(it);
    if (fits.length < 2) return null;
    var chosen = null, i;
    for (i = 0; i < fits.length; i++) if (fits[i].v.key === it.basisKey) chosen = fits[i];
    var best = fits[0];
    if (!chosen || best.v.key === it.basisKey) return null;
    var spread = fits.spread || 0;
    if (best.davg > Math.max(1 / 8, 0.35 * spread)) return null;
    if (chosen.davg - best.davg < Math.max(1 / 16, 0.40 * spread)) return null;
    return { chosen: chosen, best: best };
  }

  /* ---------- multi-point openings --------------------------------------
     A curved bar or an out-of-square opening cannot be settled by one
     reading at the face. The Founders Suites notes put it exactly: depth is
     verified perpendicular from the finished panel plane at the left edge,
     centre and right edge of each bay, and the minimum reading governs.

     Points feed the single `actual` value rather than replacing it, so
     verdicts, the basis guard and the packet all keep working unchanged. */
  /* Three readings, and the keys never change — but what the three points
     ARE depends on the axis. A cabinet opening's width runs out top to
     bottom ("24 at the top widening to 24 1/2 at the bottom"); its depth
     and height run out side to side ("23 7/8 left and 23 1/4 right").
     Labelling a width reading "left" puts the wrong word in front of a
     builder, so the labels are per axis and the storage is not. */
  var POINTS = [{ i: 0, label: "Left" }, { i: 1, label: "Centre" }, { i: 2, label: "Right" }];
  var POINT_LABELS = {
    w: ["Top", "Middle", "Bottom"],
    d: ["Left", "Centre", "Right"],
    h: ["Left", "Centre", "Right"]
  };
  function pointLabel(k, i) {
    var set = POINT_LABELS[k] || POINT_LABELS.d;
    return set[i] || POINTS[i].label;
  }
  function pointsFor(k) {
    return POINTS.map(function (p) { return { i: p.i, k: p.k, label: pointLabel(k, p.i) }; });
  }

  function pointValues(item, k) {
    return ((item.points && item.points[k]) || []).map(num).filter(function (v) { return v != null; });
  }
  /* The reading that decides the verdict: the worst one for the rule in
     force. On a minimum, that is the smallest; on a true dimension, the one
     furthest from spec in either direction. */
  function governing(item, k) {
    var vals = pointValues(item, k);
    if (!vals.length) return null;
    var rule = (item.rule && item.rule[k]) || (k === "w" ? "exact" : "min");
    if (rule === "min") return Math.min.apply(null, vals);
    if (rule === "max") return Math.max.apply(null, vals);
    var spec = num(item.spec && item.spec[k]);
    if (spec == null) return Math.min.apply(null, vals);
    var worst = vals[0];
    vals.forEach(function (v) { if (Math.abs(v - spec) > Math.abs(worst - spec)) worst = v; });
    return worst;
  }
  function governingPoint(item, k) {
    var g = governing(item, k);
    if (g == null) return -1;
    var at = -1;
    ((item.points && item.points[k]) || []).forEach(function (raw, i) {
      if (at < 0 && num(raw) != null && Math.abs(num(raw) - g) < 1e-9) at = i;
    });
    return at;
  }
  /* Called after any point changes: the governing reading becomes the
     item's actual, so nothing downstream needs to know about points. */
  function syncPoints(item) {
    if (!item.multiPoint) return;
    DIMS.forEach(function (d) {
      var g = governing(item, d.k);
      item.actual[d.k] = g == null ? "" : fmtFrac(g);
    });
  }
  function pointsAnswered(item, k) { return pointValues(item, k).length; }

  /* ---------- utilities -------------------------------------------------
     Measuring the box is half the job. An opening that is a perfect 24" and
     has no outlet in it is not ready, and the Palomino walk found exactly
     that twice — a box 7" to 11" below the illustrated zone, and a
     microwave outlet nobody could find. The spec sheets say where each
     connection belongs; the field says whether it is there. */
  /* Four answers, not three. The most common observation in a year of
     Hudson's site notes was none of the original three: "romex ran into
     cavity (no outlet)", "unfinished outlet 52 in from floor", "plumbing
     not finished", "gas pipe was shut off". Roughed in is a different job
     from absent — a different trade call and a different amount of time —
     and forcing it into "Not found" told the builder there was no outlet
     when the wire was sitting right there. */
  var UTILITY_ANSWERS = [
    { k: "ok", label: "There, right place", tone: "good" },
    { k: "misplaced", label: "There, wrong place", tone: "monitor" },
    { k: "roughed", label: "Roughed in, not finished", tone: "monitor" },
    { k: "missing", label: "Not found", tone: "poor" }
  ];
  /* "na" is a fourth answer offered only on generic checks — an unknown
     model may simply take no water. It counts as answered and raises
     nothing. */
  /* When a spec fails to load, or a model simply is not in the library,
     the box still has to have power checked and the water still has to be
     found. Rather than silently dropping those steps, an unknown model gets
     the two generic checks — and because not every appliance takes water,
     the generic checks accept "does not apply" as an answer. */
  var GENERIC_WHERE = "Wherever the install sheet in hand puts it — mark it on the photo";
  var GENERIC_POWER = { key: "power", label: "Power", generic: true, where: GENERIC_WHERE };
  var GENERIC_WATER = { key: "water", label: "Water supply", generic: true, where: GENERIC_WHERE };
  var GENERIC_UTILITIES = [GENERIC_POWER, GENERIC_WATER];
  /* A microwave does not take water. The generic checks are for a model
     nobody has described, so they follow what the appliance plainly is:
     power for everything, water only where the kind of appliance drinks. */
  var TAKES_WATER = /dishwasher|washer|laundry|ice|refrigerat|fridge|column|wine|beverage|coffee|espresso|steam|water/i;
  function genericUtilitiesFor(it) {
    var words = [it.category, it.appliance, it.model].filter(Boolean).join(" ");
    if (/microwave|warming|oven|cooktop|rangetop|range\b|hood|ventilation|dryer|disposer|grill|freezer/i.test(words) && !TAKES_WATER.test(words)) return [GENERIC_POWER];
    return GENERIC_UTILITIES;
  }
  function utilitiesFor(it) {
    if (isMerge(it)) return unitUtilities(it);
    return sinkCabinetRows(it, utilitiesRaw(it));
  }
  function utilitiesRaw(it) {
    /* connections typed at the desk off the sheet, for a model the library
       does not carry — or to override what it does */
    if (it.utilitiesSpec && it.utilitiesSpec.length) return it.utilitiesSpec;
    if (it.utilitiesNone) return [];        /* the office looked and said none */
    var e = itemEntry(it);
    if (e && e.utilities && e.utilities.length) return e.utilities;
    if (e && e.utilities) return [];        /* an entry that says "none" means none */
    return genericUtilitiesFor(it);
  }
  /* A dishwasher's hook-ups live in the sink cabinet beside it. Whatever
     road the rows came in on — the sheet's hook-up lines tapped at the
     desk, a library entry, the generic checks — a row nobody placed is
     taken as "in the sink cabinet, within reach", so the field always
     draws that cabinet and asks for the side (Cayden, 22 Oct: the
     JennAir on Q00084974 never showed it). A row the office drew or
     placed on purpose keeps its place. */
  function sinkCabinetRows(it, list) {
    if (!isDishwasherish(it) || !list.length) return list;
    return list.map(function (u) {
      if (u.zone || FACE_PLANES[u.plane] || (PLANE_DEFAULT[u.plane] && u.plane !== "opening") || (u.plane === "opening" && u.pos)) return u;
      var v = Object.assign({}, u);
      v.plane = "adjacent"; v.offPlane = true; v.pos = v.pos || "anywhere in it — within reach";
      v.zone = { kind: "any", plane: "adjacent", planeSize: { w: 36 } };
      if (!v.where) v.where = "Anywhere in the sink cabinet beside it, within reach";
      return v;
    });
  }
  function utilityAnswered(it) {
    var need = utilitiesFor(it);
    if (!need.length) return true;
    return need.every(function (u) { return !!it.utilities[u.key]; });
  }
  /* The photograph is the answer.

     A pin inside the zone the sheet draws is "there, right place"; a pin
     outside it is "wrong place"; and the only button left to press is "not
     roughed in". Asking the tech to also grade it from a menu was asking the
     same question twice and letting the two answers disagree.

     Connections that belong outside the plane of the opening — the Cove's
     power and water run through the adjacent cabinet — have no zone to be
     inside, so those keep a plain tap. */
  function utilityIsMarkable(it, u) {
    var plane = utilPlane(u);
    if (!plane) return false;
    if (plane === "opening") return !!planeSize(it);
    if (plane === "left" || plane === "right" || plane === "above" || plane === "below") return !!(planeSize(it) && planeAllowed(it, plane) && !(u.zone && u.zone.kind === "any"));
    if (FACE_PLANES[plane]) return !!planeDims(it, plane);    /* on the 3D box, once a depth is known */
    if (u.zone && u.zone.kind === "any") return false;        /* anywhere in that cabinet: nothing to pin against */
    return !!(u.zone && planeDims(it, plane));
  }
  /* True when the connection needs the tech to declare where it belongs
     before a pin can be judged: in the plane, but no drawn zone and no
     declared target yet. */
  /* Retired in v0.9.49. The tech used to tap where a connection BELONGS
     before pinning where it is, when the office had drawn nothing; two
     taps a few inches apart then produced "relocate the power" items
     nobody asked for. Where it belongs is the office's drawing or
     nothing; the tech's one tap is where it is. */
  function utilityNeedsTarget(it, u) { return false; }
  function deriveUtility(it, u) {
    var ex = it.utilities[u.key];
    if (ex === "missing" || ex === "roughed") return ex;   /* explicit beats derived */
    var at = markAt(it, u.key);
    if (!at) return it.utilities[u.key] || "";
    /* A pin says it is there, and where. Whether "where" is acceptable is
       the tech's call with the answers below the drawing — the tool no
       longer computes how far anything has to move (Cayden, 20 Oct). */
    if (ex === "misplaced") return ex;
    return "ok";
  }
  function syncUtilities(it) {
    utilitiesFor(it).forEach(function (u) {
      var v = deriveUtility(it, u);
      if (v) it.utilities[u.key] = v;
    });
  }

  /* Which step of the walk a connection belongs to. */
  function utilityGroup(u) {
    var k = utilBase(u);
    if (k === "water" || k === "drain") return "plumbing";
    if (k === "power") return "electrical";
    return "other";
  }
  function utilitiesIn(it, group) {
    return utilitiesFor(it).filter(function (u) { return utilityGroup(u) === group; });
  }

  /* ---------- connections outside the plane of the opening --------------
     The Cove pattern: "electrical location in adjacent cabinet". There is
     nothing to overlay on the opening photograph, so the flow is a second
     photograph — under the sink, into the adjacent cabinet — with one
     dropped pin per connection. A pin has no homography behind it: it
     LOCATES the connection for whoever reads the packet, it does not
     measure it. The verdict stays a tap, and the wording stays honest. */
  function offPlaneIn(it, group) {
    return utilitiesIn(it, group).filter(function (u) { return u.offPlane; });
  }
  function servicePhotoOf(it, group) {
    it.servicePhotos = it.servicePhotos || {};
    return it.servicePhotos[group] || null;
  }
  function setServicePhoto(it, group, stored) {
    it.servicePhotos = it.servicePhotos || {};
    it.servicePhotos[group] = {
      photoId: stored.id, portalId: stored.portalId || "", thumb: stored.thumb, pins: {}
    };
    return it.servicePhotos[group];
  }
  function servicePin(it, group, key) {
    var sp = servicePhotoOf(it, group);
    return (sp && sp.pins && sp.pins[key]) || null;
  }

  function utilityFixes(it) {
    var out = [];
    utilitiesFor(it).forEach(function (u) { utilityFixesFor(it, u).forEach(function (f) { out.push(f); }); });
    return out;
  }
  function utilityFixesFor(it, u) {
    var out = [];
    [u].forEach(function (u) {
      var a = it.utilities[u.key];
      if (a === "na") return;
      if (acceptedUtilReason(it, u.key)) return;      /* the installer accepted it as it is */
      /* in a merge, say which unit's connection this is */
      var forUnit = u.unit ? " for the " + (u.unit.model || u.unit.appliance) + " (" + u.unit.pos + ")" : "";
      /* A generic check's `where` is a field-tool instruction ("mark it on
         the photo"); the builder gets the sheet instead. */
      var where = u.generic ? "per the attached installation sheet" : (u.where ? u.where.charAt(0).toLowerCase() + u.where.slice(1) : "");
      if (a === "missing") {
        /* "Add the power" reads correctly; "add the condenser air" does not.
           An entry that needs different wording supplies it. */
        if (u.fixMissing) { out.push(u.fixMissing); return; }
        out.push("Add the " + u.label.toLowerCase() + forUnit + (u.need ? " — " + u.need : "") +
          (where ? " — " + where : "") + ".");
      } else if (a === "roughed") {
        /* The wire or the stub is there. The instruction is to finish it,
           and to finish it to the spec — which is the part that gets missed
           when an electrician terminates whatever is handy. */
        out.push("Finish the " + u.label.toLowerCase() + forUnit + " that is roughed in" +
          (u.need ? " — " + u.need : "") +
          (where ? " — " + where : "") + ".");
      } else if (a === "misplaced") {
        if (u.fixMisplaced) { out.push(u.fixMisplaced); return; }
        /* If it was marked on a photograph we can say how far off it is,
           which is the difference between "move the outlet" and an
           instruction an electrician can price. */
        var o = markOffset(it, u);
        var z = zoneOf(it, u);
        /* A tech-declared location quotes its coordinates — the library's
           `where` text for a generic check is a field-tool instruction and
           has no business on a builder's punch list. */
        var whereText = z && z.field
          ? " to " + posText(it, z.x, z.y) + " (location recorded at the walk)"
          : (where ? (u.generic ? " " : ": ") + where : "");
        /* The picture is the instruction; the inches are the caption. A
           drawn box is the area the sheet allows, so "outside it" is the
           finding, not a target the electrician has to hit to the inch. */
        var at2 = markAt(it, u.key);
        out.push("Relocate the " + u.label.toLowerCase() + forUnit + " to where the sheet draws it" +
          (whereText ? " —" + whereText.replace(/^ to /, " ").replace(/^: /, " ") : "") +
          " (see the drawing)" + (at2 ? "; found at " + markText(it, u.key) : "") + ".");
      }
    });
    return out;
  }


  /* ---------- what is in the opening ------------------------------------
     The failure mode that measurements cannot catch. From two jobs' notes:
     an unused gas stub projecting 3" that "will establish the appliance
     setback"; a sink drain pipe that "will hold the unit off the back
     wall"; wiring coming out of the floor; electrical boxes that "do not
     hold the units off the back wall" only if someone checks. Every one of
     those openings measured acceptably.

     So the depth reading is not the question. The question is whether
     anything is in there, and whether it sets the setback. */
  var OBSTRUCTION_KINDS = [
    "Drain pipe", "Water supply line", "Gas stub", "Wiring from the floor",
    "Electrical box", "Duct or vent", "Cabinet back or framing", "Something else"
  ];
  var OBSTRUCTION_STATES = [
    { k: "none", label: "Nothing in it", tone: "good" },
    { k: "clears", label: "Something, but it clears", tone: "monitor" },
    { k: "holds", label: "Holds the unit off", tone: "poor" }
  ];
  function obstructionOf(it) {
    it.obstruction = it.obstruction || { state: "", kind: "", projectsIn: "" };
    return it.obstruction;
  }
  function obstructionAnswered(it) { return !!obstructionOf(it).state; }
  function obstructionFixes(it) {
    var o = obstructionOf(it);
    if (o.state !== "holds") return [];
    var what = (o.kind || "the obstruction").toLowerCase();
    var proj = num(o.projectsIn);
    return ["Recess or relocate the " + what + " so the unit sits fully back" +
      (proj != null ? " — it projects " + fmtIn(proj) + " from the back wall and will set the appliance setback" : "") + "."];
  }
  /* An obstruction that clears is not a correction, but it is the note the
     installer needs before he pushes a unit into the box. */
  function obstructionNote(it) {
    var o = obstructionOf(it);
    if (o.state !== "clears") return "";
    var proj = num(o.projectsIn);
    return (o.kind || "An obstruction") + " is present in the opening" +
      (proj != null ? ", projecting " + fmtIn(proj) : "") +
      ", and clears the unit as measured. Confirm at set before anchoring.";
  }

  /* ---------- photo geometry --------------------------------------------
     A cutout photo is taken from wherever the tech happened to be standing,
     so nothing in the frame is square and no pixel means anything on its
     own. But the tech has just measured that opening, which makes its four
     corners four points whose real separation is known — and four
     correspondences are exactly enough to solve the homography between the
     photo and the plane of the opening face. That single mapping does both
     jobs: it turns "tap where the outlet is" into a number in inches, and
     it draws the spec zone back onto the photo in the same perspective the
     camera saw.

     Opening space: origin at the bottom-left of the finished opening, x to
     the right, y up, in inches. Photo space: 0..1 of the frame, so the
     mapping survives any resize, any device, and the packet's own scaling. */

  function solveH(src, dst) {
    var A = [], b = [], i, r, c;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    /* Gauss-Jordan with partial pivoting. Eight unknowns: the ninth
       coefficient is pinned at 1, because a homography is scale free. */
    for (i = 0; i < 8; i++) {
      var p = i;
      for (r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      if (Math.abs(A[p][i]) < 1e-12) return null;   /* degenerate: taps in a line */
      var tA = A[i]; A[i] = A[p]; A[p] = tA;
      var tb = b[i]; b[i] = b[p]; b[p] = tb;
      for (r = 0; r < 8; r++) {
        if (r === i) continue;
        var f = A[r][i] / A[i][i];
        if (!f) continue;
        for (c = i; c < 8; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    var h = [];
    for (i = 0; i < 8; i++) h.push(b[i] / A[i][i]);
    return h;
  }
  function applyH(h, x, y) {
    if (!h) return null;
    var w = h[6] * x + h[7] * y + 1;
    if (!w) return null;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }

  /* The face in the photograph is the opening: width by height. Depth is
     out of plane and plays no part. Field numbers beat spec numbers here,
     because the photograph is of what was built, not what was drawn. */
  function planeSize(it) {
    var w = num(it.actual && it.actual.w) || num(it.spec && it.spec.w);
    var h = num(it.actual && it.actual.h) || num(it.spec && it.spec.h);
    return (w && h) ? { w: w, h: h } : null;
  }
  /* ---- the planes beside, above and below the opening ----
     Which plane a connection lives on: the opening's back wall unless the
     office drew it in a neighbouring cabinet. A library connection marked
     offPlane with no drawing has no plane at all — that one keeps the
     pin-only flow. */
  function utilPlane(u) {
    if (u && u.zone && u.zone.plane && u.zone.plane !== "opening") return u.zone.plane;
    if (u && FACE_PLANES[u.plane]) return u.plane;
    if (u && PLANE_DEFAULT[u.plane]) return u.plane;          /* "cabinet left" with nothing drawn: still that cabinet on the drawing */
    if (u && u.plane === "opening") return "opening";          /* said so, whatever an older offPlane flag says */
    return (u && u.offPlane) ? "" : "opening";
  }
  /* ---- the front frame, and the floor it gives ----
     The four required corners are the BACK WALL of the opening — that is
     where connections live and what the office drew. Four optional taps on
     the front edge close the box: with both quads the side walls and the
     floor are known in the photograph without another tap, and the typed
     depth gives the floor its inches. Floor coordinates: x in from the
     left, y back from the front edge (y = D at the back wall). */
  function frontReady(it) {
    var ov = it && it.overlay;
    return !!(ov && ov.front && ov.front.length === 4 && overlayReady(ov));
  }
  function depthIn(it) { return num(it.actual && it.actual.d) || num(it.spec && it.spec.d) || null; }
  function floorOverlay(it) {
    if (!frontReady(it)) return null;
    var ov = it.overlay;
    /* top-left of the floor plane is the back-left corner (the back wall's
       bottom-left), bottom-left is the front-left corner */
    return { photoId: ov.photoId, portalId: ov.portalId || "", thumb: ov.thumb,
             corners: [ov.corners[3], ov.corners[2], ov.front[2], ov.front[3]], marks: ov.marks, size: {}, synthetic: true };
  }
  /* The size of a neighbouring plane: what the tech typed on site, else
     what the office drew it at, else the drawing's defaults. */
  /* The faces of the opening other than its back wall, for pins placed on
     the 3D box: floor and ceiling are W × D (x in from the left, y back
     from the front edge); the side walls are D × H (x back from the
     front edge, y up). */
  var FACE_PLANES = { floor: 1, ceiling: 1, "wall-left": 1, "wall-right": 1 };
  function planeDims(it, plane) {
    if (!plane || plane === "opening") return planeSize(it);
    if (plane === "floor" || plane === "ceiling") {
      var fpl = planeSize(it), fd = depthIn(it);
      return (fpl && fd) ? { w: fpl.w, h: fd } : null;
    }
    if (plane === "wall-left" || plane === "wall-right") {
      var spl = planeSize(it), sd = depthIn(it);
      return (spl && sd) ? { w: sd, h: spl.h } : null;
    }
    var pp = it.planePhotos && it.planePhotos[plane];
    if (pp && pp.size && num(pp.size.w) && num(pp.size.h)) return { w: num(pp.size.w), h: num(pp.size.h) };
    /* one typed size (a cabinet added to the run on site): the other
       follows the opening, like the drawing's default */
    if (pp && pp.size && (num(pp.size.w) || num(pp.size.h))) {
      var opl = planeSize(it), od = PLANE_DEFAULT[plane];
      if (opl && od) return { w: num(pp.size.w) || (od.w != null ? od.w : opl.w), h: num(pp.size.h) || (od.h != null ? od.h : opl.h) };
    }
    var found = null;
    utilitiesFor(it).concat(it.prep || []).forEach(function (x) {
      var z = x && x.zone;
      if (!found && z && z.plane === plane && z.planeSize && num(z.planeSize.w) && num(z.planeSize.h)) found = { w: num(z.planeSize.w), h: num(z.planeSize.h) };
    });
    if (found) return found;
    var pl = planeSize(it), d = PLANE_DEFAULT[plane];
    if (!pl || !d) return null;
    return { w: d.w != null ? d.w : pl.w, h: d.h != null ? d.h : pl.h };
  }
  function planeOverlay(it, plane) {
    if (!plane || plane === "opening") return it.overlay;
    if (plane === "floor") return floorOverlay(it);
    return (it.planePhotos && it.planePhotos[plane]) || null;
  }
  function planeReady(it, plane) {
    var ov = planeOverlay(it, plane);
    return !!(ov && ov.corners && ov.corners.length === 4 && planeDims(it, plane));
  }
  function toPhotoFor(it, plane) {
    var pl = planeDims(it, plane), ov = planeOverlay(it, plane);
    if (!pl || !overlayReady(ov)) return null;
    return solveH([[0, pl.h], [pl.w, pl.h], [pl.w, 0], [0, 0]], ov.corners);
  }
  function toPlaneFor(it, plane) {
    var pl = planeDims(it, plane), ov = planeOverlay(it, plane);
    if (!pl || !overlayReady(ov)) return null;
    return solveH(ov.corners, [[0, pl.h], [pl.w, pl.h], [pl.w, 0], [0, 0]]);
  }
  function utilByKey(it, key) {
    return utilitiesFor(it).filter(function (u) { return u.key === key; })[0] || null;
  }
  var PLANE_WORDS = { left: "cabinet to the left", right: "cabinet to the right", above: "cabinet above", below: "cabinet below", adjacent: "sink cabinet beside it",
                      left2: "second cabinet to the left", right2: "second cabinet to the right",
                      floor: "floor of the opening", ceiling: "top of the opening", "wall-left": "left side wall of the opening", "wall-right": "right side wall of the opening" };

  /* A zone edge is either inches from the left/bottom, or {r:n} inches in
     from the right, or {t:n} down from the top — because that is how the
     sheets dimension them ("6\" in from the right side"). */
  function edgeIn(v, span) {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v.r != null) return span - v.r;
    if (typeof v === "object" && v.t != null) return span - v.t;
    return null;
  }
  /* Where the tech says it belongs.

     The library's zones come off the manufacturer drawings, and when there
     is no drawing — a spec that failed to load, a unit whose sheet gives no
     usable picture — the tech in front of the opening, paper sheet in hand,
     is the best remaining authority. One tap declares the correct location;
     the offset math then treats it exactly like a drawn point, and the
     packet says who put it there. */
  function targetAt(it, u) {
    var t = it.overlay && it.overlay.targets && it.overlay.targets[u.key];
    if (!t) return null;
    var p = applyH(toPlane(it), t[0], t[1]);
    return p ? { x: p[0], y: p[1] } : null;
  }
  function zoneOf(it, u) {
    var plane = utilPlane(u), z = u && u.zone;
    var pl = plane === "opening" ? planeSize(it) : (plane ? planeDims(it, plane) : null);
    if (!pl || !z) return null;
    if (z.kind === "any") return { kind: "rect", x0: 0, x1: pl.w, y0: 0, y1: pl.h, any: true };
    if (z.kind === "point") {
      var px = edgeIn(z.x, pl.w), py = edgeIn(z.y, pl.h);
      return (px == null || py == null) ? null : { kind: "point", x: px, y: py };
    }
    if (z.kind === "rect") {
      var a = edgeIn(z.x0, pl.w), b2 = edgeIn(z.x1, pl.w),
          c2 = edgeIn(z.y0, pl.h), d2 = edgeIn(z.y1, pl.h);
      if (a == null || b2 == null || c2 == null || d2 == null) return null;
      return { kind: "rect", x0: Math.min(a, b2), x1: Math.max(a, b2),
               y0: Math.min(c2, d2), y1: Math.max(c2, d2) };
    }
    return null;
  }
  function hasZone(it, u) { return !!zoneOf(it, u); }

  var CORNER_TAPS = [
    { k: "tl", label: "Top left" }, { k: "tr", label: "Top right" },
    { k: "br", label: "Bottom right" }, { k: "bl", label: "Bottom left" }
  ];
  function blankOverlay() { return { photoId: "", thumb: "", corners: [], front: [], marks: {}, targets: {} }; }
  function overlayReady(ov) { return !!(ov && ov.corners && ov.corners.length === 4); }
  function canMark(it) { return !!planeSize(it) && !!(it.overlay && it.overlay.thumb); }

  /* inches -> photo */
  function toPhoto(it) {
    var pl = planeSize(it);
    if (!overlayReady(it.overlay) || !pl) return null;
    return solveH([[0, pl.h], [pl.w, pl.h], [pl.w, 0], [0, 0]], it.overlay.corners);
  }
  /* photo -> inches */
  function toPlane(it) {
    var pl = planeSize(it);
    if (!overlayReady(it.overlay) || !pl) return null;
    return solveH(it.overlay.corners, [[0, pl.h], [pl.w, pl.h], [pl.w, 0], [0, 0]]);
  }
  /* ---- pins: where the tech put each connection, in inches on a plane ----
     v0.9.51: the placement surface is the drawing, not the photograph. A
     pin is {plane, x, y} in that plane's inches (x in from the left, y up
     from its floor), tapped on the rough-in drawing and nudged or typed
     from the keypad. Walks from before carry photo marks; those still
     read through the old calibration so nothing already recorded is lost. */
  function pinOf(it, key) {
    var p = it.pins && it.pins[key];
    if (!p || p.x == null || p.y == null) return null;
    return { plane: p.plane || "opening", x: num(p.x), y: num(p.y) };
  }
  function setPin(it, key, plane, x, y) {
    it.pins = it.pins || {};
    it.pins[key] = { plane: plane || "opening", x: x, y: y };
  }
  function clearPin(it, key) {
    if (it.pins) delete it.pins[key];
    if (it.overlay && it.overlay.marks) delete it.overlay.marks[key];
  }
  function markAt(it, key) {
    var pin = pinOf(it, key);
    if (pin) return { x: pin.x, y: pin.y };
    var u = utilByKey(it, key), plane = u ? utilPlane(u) : "opening";
    var ov = planeOverlay(it, plane);
    var m = ov && ov.marks && ov.marks[key];
    if (!m) return null;
    var p = applyH(plane === "opening" ? toPlane(it) : toPlaneFor(it, plane), m[0], m[1]);
    return p ? { x: p[0], y: p[1] } : null;
  }
  function marksMade(it) {
    var n = Object.keys(it.pins || {}).length;
    var m = (it.overlay && it.overlay.marks) || {};
    return n + Object.keys(m).length;
  }
  /* What a drawing says about each measured dimension (v0.9.85). Cayden,
     17 Nov 2026: "Eliminate colored sides if a measurement is wrong. Wrong
     measurements should turn red in the overlaid measurement on the
     rendering, not the lines of the box themselves." So the box is always
     drawn in its own neutral lines, and each dimension is a label laid on
     the drawing: the reading, and when it misses, the figure to build to.

       state  "bad"       the reading misses the sheet            → red
              "ok"        it meets the sheet                      → plain
              "accepted"  it misses and Wilson accepted it        → plain
              "plain"     a reading with no sheet figure to judge → plain
              "none"      not measured yet; the sheet's figure    → grey  */
  function dimNeed(it, k) {
    var spec = num(it.spec && it.spec[k]);
    if (spec == null) return "";
    var rule = (it.rule && it.rule[k]) || (k === "w" ? "exact" : "min");
    var mx = it.specMax ? num(it.specMax[k]) : null;
    if (rule === "range" && mx != null) return "needs " + fmtIn(spec) + "–" + fmtIn(mx);
    if (rule === "max") return "needs " + fmtIn(spec) + " max";
    if (rule === "exact") return "needs " + fmtIn(spec);
    return "needs " + fmtIn(spec) + " min";
  }
  function dimNotes(it) {
    var out = {};
    ["w", "h", "d"].forEach(function (k) {
      var act = num(it.actual && it.actual[k]), spec = num(it.spec && it.spec[k]);
      if (act == null) {
        if (spec != null) out[k] = { k: k, state: "none", value: specText(it, k), need: "" };
        return;
      }
      var v = verdict(it, k);
      var st = v.state === "bad" ? "bad" : v.state === "ok" ? "ok" : v.state === "accepted" ? "accepted" : "plain";
      /* a height read over the subfloor is judged with the flooring taken
         off, so that is the figure the label carries, and it says so */
      var ded = k === "h" ? flooringDeduction(walkOfItem(it), it) : 0;
      out[k] = { k: k, state: st, value: fmtIn(act - ded) + (ded ? " after flooring" : ""), need: st === "bad" ? dimNeed(it, k) : "" };
    });
    return out;
  }
  var DIM_LETTER = { w: "W", h: "H", d: "D" };
  var DIM_INK = { bad: "#c8341f", none: "#6b7a72" };
  function dimInk(note) { return DIM_INK[note.state] || "#1f2a24"; }
  function dimLines(note) {
    var l = [DIM_LETTER[note.k] + " " + note.value + (note.state === "none" ? " spec" : "")];
    if (note.need) l.push(note.need);
    return l;
  }
  /* how big the label is, before it is drawn — for placing and clamping */
  function dimPillSize(note, fs) {
    var lines = dimLines(note), n = 0;
    lines.forEach(function (t, i) { n = Math.max(n, t.length * (i ? 0.8 : 1)); });
    return { w: n * fs * 0.56 + fs * 1.1, h: fs * (lines.length > 1 ? 2.55 : 1.6) };
  }
  /* The label itself: a white pill with the reading in it, centred on
     (cx, cy). Taps pass through it, so it never takes a tap meant for the
     drawing underneath. */
  function dimPill(note, cx, cy, fs, turn) {
    var lines = dimLines(note), ink = dimInk(note), sz = dimPillSize(note, fs);
    var two = lines.length > 1;
    var h = '<g class="sw-dim" data-dim="' + note.k + '" data-state="' + note.state + '" pointer-events="none"' +
      (turn ? ' transform="rotate(' + turn + " " + cx.toFixed(2) + " " + cy.toFixed(2) + ')"' : "") + ">" +
      '<rect x="' + (cx - sz.w / 2).toFixed(2) + '" y="' + (cy - sz.h / 2).toFixed(2) + '" width="' + sz.w.toFixed(2) + '" height="' + sz.h.toFixed(2) + '" rx="' + (fs * 0.45).toFixed(2) +
      '" fill="#ffffff" stroke="' + ink + '" stroke-width="' + (fs * (note.state === "bad" ? 0.17 : 0.1)).toFixed(2) + '"' + (note.state === "none" ? ' stroke-dasharray="' + (fs * 0.5).toFixed(2) + " " + (fs * 0.35).toFixed(2) + '"' : "") + "/>" +
      '<text x="' + cx.toFixed(2) + '" y="' + (cy + (two ? -fs * 0.18 : fs * 0.36)).toFixed(2) + '" font-size="' + fs.toFixed(2) + '" text-anchor="middle" fill="' + ink + '" font-weight="' + (note.state === "none" ? 600 : 800) + '">' + lines[0] + "</text>";
    if (two) h += '<text x="' + cx.toFixed(2) + '" y="' + (cy + fs * 0.85).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" text-anchor="middle" fill="' + ink + '" font-weight="700">' + lines[1] + "</text>";
    return h + "</g>";
  }

  /* How far the found connection sits from where the sheet puts it. A point
     zone gives a vector from the target; a rectangle gives the distance out
     of the box, which is zero whenever the connection is inside it. */
  /* A point on a sheet is nominal: an outlet two inches off the drawn
     cross is where the sheet wants it (Cayden, 15 Oct). A rectangle is a
     boundary and gets no slack. */
  var POINT_SLACK = 2;
  function markOffset(it, u) {
    var at = markAt(it, u.key), z = zoneOf(it, u), pin = pinOf(it, u.key);
    if (!at || !z) return null;
    /* pinned on a face the sheet did not draw it on: a different place,
       whatever the inches say */
    if (pin && pin.plane !== utilPlane(u)) return { at: at, zone: z, dx: 0, dy: 0, out: true, otherPlane: pin.plane };
    if (z.kind === "point") {
      /* A point on a sheet is a nominal location, not a boundary: an outlet
         an inch off the drawn cross is where the sheet wants it. A rectangle
         is a boundary, and gets no slack at all. */
      var px = at.x - z.x, py = at.y - z.y;
      return { at: at, zone: z, dx: px, dy: py, out: Math.abs(px) >= POINT_SLACK || Math.abs(py) >= POINT_SLACK };
    }
    var dx = at.x < z.x0 ? at.x - z.x0 : at.x > z.x1 ? at.x - z.x1 : 0;
    var dy = at.y < z.y0 ? at.y - z.y0 : at.y > z.y1 ? at.y - z.y1 : 0;
    return { at: at, zone: z, dx: dx, dy: dy, out: !!(dx || dy) };
  }
  function offsetText(o) {
    if (!o) return "";
    /* Report a component only once it is worth reporting: an inch off a
       nominal point is nothing, an inch outside a drawn box is not. */
    var floor = (o.zone && o.zone.kind === "point") ? POINT_SLACK : 1 / 16;
    var p = [];
    if (Math.abs(o.dx) >= floor) p.push(fmtIn(Math.abs(o.dx)) + " too far " + (o.dx > 0 ? "right" : "left"));
    if (Math.abs(o.dy) >= floor) p.push(fmtIn(Math.abs(o.dy)) + " too " + (o.dy > 0 ? "high" : "low"));
    return p.join(" and ");
  }
  /* A position in plain words, including one outside the opening — the
     Advantium's outlet in the cabinet below is "3 3/4" below the opening",
     never "−3 3/4" up". */
  function posText(it, x, y, plane) {
    var pl = plane && plane !== "opening" ? planeDims(it, plane) : planeSize(it), bits = [];
    if (plane === "floor" || plane === "ceiling") return fmtIn(x) + " in from the left, " + fmtIn(y) + " back from the front edge, on the " + (plane === "floor" ? "floor" : "top") + " of the opening";
    if (plane === "wall-left" || plane === "wall-right") return fmtIn(x) + " back from the front edge, " + fmtIn(y) + " up, on the " + (plane === "wall-left" ? "left" : "right") + " side wall";
    if (plane && plane !== "opening") {
      return fmtIn(x) + " in from the left, " + fmtIn(y) + " up, in the " + planeWord(it, plane);
    }
    if (x < 0) bits.push(fmtIn(-x) + " left of the opening");
    else if (pl && x > pl.w) bits.push(fmtIn(x - pl.w) + " right of the opening");
    else bits.push(fmtIn(x) + " in from the left");
    if (y < 0) bits.push(fmtIn(-y) + " below the opening");
    else if (pl && y > pl.h) bits.push(fmtIn(y - pl.h) + " above the opening");
    else bits.push(fmtIn(y) + " up");
    return bits.join(", ");
  }
  function markText(it, key) {
    var at = markAt(it, key);
    if (!at) return "";
    var u = utilByKey(it, key), pin = pinOf(it, key);
    return posText(it, at.x, at.y, pin ? pin.plane : u ? utilPlane(u) : "opening");
  }
  /* Read against the sheet: the sentence a builder can act on without
     opening the spec book. */
  function markVerdict(it, u) {
    var at = markAt(it, u.key);
    if (!at) return null;
    var o = markOffset(it, u);
    var upl = utilPlane(u);
    var where = "Found at " + markText(it, u.key);
    if (!o) return { text: where + (upl === "opening" ? ", in the opening" : "") + ".", out: false };
    if (o.otherPlane) return { text: where + " — the sheet draws it " + (upl === "opening" ? "on the back wall of the opening" : (FACE_PLANES[upl] ? "on the " : "in the ") + planeWord(it, upl)) + " (see the drawing).", out: true };
    if (o.zone.any) return { text: where + " — anywhere in there is what the sheet asks.", out: false };
    if (!o.out) return { text: where + " — where the sheet draws it.", out: false };
    /* outside the drawn area: said in words, shown on the drawing, and
       left to the tech's answer below — no inches to move */
    return { text: where + " — outside the area the sheet draws (see the drawing).", out: true };
  }
  /* The safety net: the tech tapped "right place" but the photograph says
     otherwise. One inch of slack absorbs a shaky corner tap; anything past
     that is a real disagreement and belongs in front of a person. */
  /* Retired in v0.9.51: the tech's answer is the answer; the drawing shows
     the pin against the sheet's area and the reader draws the conclusion. */
  function markConflicts(it) { return []; }

  /* ---------- custom panels ---------------------------------------------
     A panel-ready unit is only ready when its panel is. Builders hang custom
     panels late and are rarely on site during a walk, so "are they right?"
     usually has no answer yet. Forcing a yes/no there produces a guess.
     What the walk can do is record the state of knowledge and carry the
     panel specification onto the report, so "not yet" becomes a dated item
     with a number attached rather than a blank. */
  var PANEL_BY = [
    { k: "wilson", label: "Wilson supplies" },
    { k: "custom", label: "Custom — cabinet shop" },
    { k: "undecided", label: "Not decided yet" }
  ];
  var PANEL_STATE = [
    { k: "verified", label: "On site, to spec", tone: "good" },
    { k: "onsite-wrong", label: "On site, not right", tone: "poor" },
    { k: "absent", label: "Not on site yet", tone: "monitor" }
  ];
  function isPanelReady(it) {
    if (it.panelReady === true || it.panelReady === false) return it.panelReady;
    /* a basis can be the panel one — a warming drawer with a custom front */
    var pv = itemVariation(it);
    if (pv && (pv.panelReady === true || pv.panelReady === false)) return pv.panelReady;
    var e = itemEntry(it);
    return !!entryPanelReady(e, it.model);
  }
  /* Library panel spec, overlaid by anything the office typed from the
     manufacturer sheet at verify time (size and thickness live on the item;
     a model outside the library has nothing else). Same shape as the
     library's: width/height/thickness/weight/page. */
  function panelSpec(it) {
    var v = itemVariation(it), e = itemEntry(it);
    var lib = (v && v.panel) || (e && e.panel) || null;
    var own = it.panelSize && (num(it.panelSize.w) != null || num(it.panelSize.h) != null);
    var thick = panelThickness(it);
    if (!own && thick == null) return lib;
    var out = {};
    if (lib) Object.keys(lib).forEach(function (k) { out[k] = lib[k]; });
    if (own) { out.width = num(it.panelSize.w); out.height = num(it.panelSize.h); if (!lib) out.page = ""; }
    if (thick != null) out.thickness = fmtIn(thick) + " thick";
    return out;
  }
  /* The panel's thickness sets the cleat setback on a flush job (a 3/4"
     panel wants the cleat back 7/8"–1"); it prints on the cavity sheet. */
  function panelThickness(it) { return num(it.panelThicknessIn); }
  /* ---------- cabinet prep ----------------------------------------------
     What the cabinet maker builds before the truck comes, as the sheet
     draws it: cleats (flush installs), cutouts (the Miele's 4" × 28" in the
     cabinet floor for cord and vent), clearances (door swing to the
     neighbour's front), a vent path into the cabinet below. The office
     draws each one on the rough-in drawing; the tech says whether it is
     there; a missing or wrong one is a cabinet-shop item with the numbers. */
  /* Three of these are STRIPS — wood along one face of the opening at some
     depth behind the cabinet face (Cayden, 24 Oct, with the Sub-Zero design
     guide: "how we measure and display finished cleats, in addition to
     non-finished cleats or structural blocking"). A finished RETURN is the
     visible side wall itself, from the face back to where the unit body
     begins (3 1/2" on every Sub-Zero built-in and column; 5 11/16" flush
     inset). A finished CLEAT is an added strip in plain view — the Classic
     flush inset's 1 1/4" cleats, 3 1/2" deep, starting 2 3/16" behind the
     face — 50" less two of them is the 47 1/2" the 48" body sits in;
     an oven's cleats recessed 7/8" behind a 3/4" panel. BLOCKING is
     unfinished structure hidden behind the unit — the 2×4 anti-tip block
     9" off the floor, a platform rail, a backer for a wall oven's rail.
     All three carry the same numbers: which face, set back how far from the
     cabinet face, running how far front to back, projecting how far into
     the opening, how tall or wide (full, or a band), and finished or not.
     Finished wood that must match the cabinetry is the cabinet shop's;
     blocking is the builder's. */
  var PREP_KINDS = [
    { k: "return",    label: "Finished return", verb: "Finish the return", tag: "FR", color: "#a16207", strip: true, finished: true },
    { k: "cleat",     label: "Cleat",        verb: "Build the cleat",   tag: "CL", color: "#7c3aed", strip: true, finished: true },
    { k: "blocking",  label: "Blocking",     verb: "Install the blocking", tag: "BLK", color: "#9a3412", strip: true, finished: false },
    { k: "cutout",    label: "Cutout",       verb: "Cut the opening",   tag: "CU", color: "#b45309" },
    { k: "clearance", label: "Clearance",    verb: "Keep clear",        tag: "CLR", color: "#0e7490" },
    { k: "vent",      label: "Vent path",    verb: "Open the vent path", tag: "VP", color: "#2f9e5a" },
    { k: "other",     label: "Other prep",   verb: "Provide",           tag: "P", color: "#5b6b63" }
  ];
  var STRIP_FACES = [
    { k: "left",   label: "Left side",  words: "on the left side" },
    { k: "right",  label: "Right side", words: "on the right side" },
    { k: "both",   label: "Both sides", words: "on both sides" },
    { k: "top",    label: "Top",        words: "across the top" },
    { k: "bottom", label: "Bottom",     words: "across the bottom" },
    { k: "back",   label: "Back wall",  words: "on the back wall" }
  ];
  function stripFace(k) { return STRIP_FACES.filter(function (f) { return f.k === k; })[0] || null; }
  function stripOf(pr) {
    pr.strip = pr.strip || {};
    ["face", "setbackIn", "runIn", "thicknessIn", "fromIn", "sizeIn"].forEach(function (k) { if (pr.strip[k] == null) pr.strip[k] = ""; });
    return pr.strip;
  }
  function isStrip(pr) { return !!(pr && prepKind(pr.kind).strip && pr.strip && pr.strip.face); }
  function prepFinished(pr) { return pr.finished != null && pr.finished !== "" ? !!pr.finished : !!prepKind(pr.kind).finished; }
  function prepOwner(pr) { return prepKind(pr.kind).strip && !prepFinished(pr) ? "builder" : "cabinet"; }
  /* A strip in the opening's own inches: x across, y up, z from the cabinet
     face (0) back to the wall (−depth). "both" yields two. A return has no
     thickness — it is the wall's own face, drawn as a band. */
  function stripGeoms(it, pr) {
    var pl = planeSize(it);
    if (!pl || !isStrip(pr)) return [];
    var s = pr.strip, D = depthIn(it) || num(it.spec && it.spec.d) || 24, kd = prepKind(pr.kind);
    var t = num(s.thicknessIn), sb = stripTarget(it, pr, "setbackIn") || 0, run = stripTarget(it, pr, "runIn"), from = num(s.fromIn), size = num(s.sizeIn);
    if (t == null) t = kd.k === "return" ? 0 : 0.75;
    var faces = s.face === "both" ? ["left", "right"] : [s.face];
    return faces.map(function (face) {
      var g = { face: face, t: t, finished: prepFinished(pr), kind: kd.k, color: kd.color, tag: kd.tag, label: pr.label || kd.label, key: "prep:" + pr.id };
      var zF = -sb, zB = -(sb + (run != null ? run : Math.max(0, D - sb)));
      if (face === "back") { zB = -D; zF = -D + t; }
      var a0 = from != null ? from : 0;
      if (face === "left" || face === "right") {
        g.x0 = face === "left" ? 0 : pl.w - t; g.x1 = face === "left" ? t : pl.w;
        g.y0 = a0; g.y1 = size != null ? a0 + size : pl.h;
      } else if (face === "top" || face === "bottom") {
        g.y0 = face === "bottom" ? 0 : pl.h - t; g.y1 = face === "bottom" ? t : pl.h;
        g.x0 = a0; g.x1 = size != null ? a0 + size : pl.w;
      } else {
        g.x0 = 0; g.x1 = pl.w; g.y0 = a0; g.y1 = size != null ? a0 + size : pl.h;
      }
      g.z0 = Math.max(-D, Math.min(zB, zF)); g.z1 = Math.min(0, Math.max(zB, zF));
      return g;
    });
  }
  /* The clear width between two side strips at the depth they sit — the
     number the unit body actually has to fit (50" less two 3/4" cleats is
     47 1/2" for a 48" Classic flush inset). Measured values win over the sheet's when
     the tech typed them. */
  function stripInterior(it) {
    var pl = planeSize(it); if (!pl) return null;
    var left = 0, right = 0, any = false;
    (it.prep || []).forEach(function (pr) {
      if (!isStrip(pr) || pr.kind === "return") return;
      var ck = (it.prepChecks || {})[pr.id] || {}, mt = num(ck.meas && ck.meas.thicknessIn), t = mt != null ? mt : num(pr.strip.thicknessIn);
      if (t == null) t = 0.75;
      if (pr.strip.face === "left" || pr.strip.face === "both") { left = Math.max(left, t); any = true; }
      if (pr.strip.face === "right" || pr.strip.face === "both") { right = Math.max(right, t); any = true; }
    });
    if (!any) return null;
    var w = num(it.actual && it.actual.w) != null ? num(it.actual.w) : pl.w;
    return { w: w, left: left, right: right, clear: w - left - right };
  }
  function stripWords(pr, it) {
    var s = stripOf(pr), kd = prepKind(pr.kind), bits = [];
    var f = stripFace(s.face); if (f) bits.push(f.words);
    var t = num(s.thicknessIn), sb = it ? stripTarget(it, pr, "setbackIn") : num(s.setbackIn), run = it ? stripTarget(it, pr, "runIn") : num(s.runIn), from = num(s.fromIn), size = num(s.sizeIn);
    /* the words the crew uses (Cayden, 26 Oct): "1 1/4" wide, 3 1/2" deep,
       starts 2 3/16" back from the face of the cabinet" */
    if (kd.k !== "return" && t != null) bits.push(fmtIn(t) + (s.face === "back" ? " proud of the wall" : " wide"));
    if (s.face !== "back" && run != null) bits.push(kd.k === "return" ? fmtIn(run) + " deep from the face" : fmtIn(run) + " deep");
    if (s.face !== "back" && sb != null && !(kd.k === "return" && sb === 0)) bits.push("starting " + fmtIn(sb) + " back from the cabinet face");
    if (from != null || size != null) {
      var vertical = s.face !== "top" && s.face !== "bottom";
      bits.push((from != null ? fmtIn(from) + (vertical ? " off the floor" : " from the left") : "") + (size != null ? (from != null ? ", " : "") + fmtIn(size) + (vertical ? " tall" : " wide") : ""));
    } else bits.push(s.face === "top" || s.face === "bottom" ? "full width" : "full height");
    bits.push(prepFinished(pr) ? "finished to match the cabinetry" : "unfinished — hidden behind the unit");
    var sh = s.panelShift && it ? panelShift(it, pr, s.panelShift) : 0, pb = s.panelShift && it ? panelBasis(it) : null;
    if (sh) bits.push("moved " + fmtIn(Math.abs(sh)) + (sh > 0 ? " back" : " forward") + " for the " + fmtIn(pb.actual) + " panel (the sheet's " + fmtIn(num(s[s.panelShift])) + " is for " + fmtIn(pb.assumed) + ")");
    return bits.join(", ");
  }
  var PREP_STATES = [
    { k: "built",   label: "Built as drawn", tone: "good" },
    { k: "missing", label: "Not there",      tone: "poor" },
    { k: "wrong",   label: "Wrong size / place", tone: "monitor" }
  ];
  function prepKind(k) { return PREP_KINDS.filter(function (x) { return x.k === k; })[0] || PREP_KINDS[PREP_KINDS.length - 1]; }
  function prepText(pr, it) {
    var kd = prepKind(pr.kind), bits = [];
    if (isStrip(pr)) return (pr.label || kd.label) + " — " + stripWords(pr, it) + (pr.note ? ", " + pr.note : "");
    var z = pr.zone;
    if (z && z.kind === "rect") {
      var w = Math.abs(num(z.x1) - num(z.x0)), h = Math.abs(num(z.y1) - num(z.y0));
      bits.push(fmtIn(w) + " wide × " + fmtIn(h) + " tall");
      var where = z.plane && z.plane !== "opening" ? " in the " + planeWord(it, z.plane) : "";
      bits.push(fmtIn(Math.min(num(z.x0), num(z.x1))) + " from the left, " + fmtIn(Math.min(num(z.y0), num(z.y1))) + " up" + where);
    }
    if (num(pr.setbackIn) != null) bits.push("set back " + fmtIn(num(pr.setbackIn)) + " from the face");
    if (num(pr.thicknessIn) != null) bits.push(fmtIn(num(pr.thicknessIn)) + " thick");
    if (pr.note) bits.push(pr.note);
    return (pr.label || kd.label) + (bits.length ? " — " + bits.join(", ") : "");
  }
  function prepState(it, id) { return (it.prepChecks && it.prepChecks[id] && it.prepChecks[id].state) || ""; }
  /* Which cabinet face a prep item was drawn on, and its box in that
     plane's inches (bottom-left origin, y up) — the same frame the photo
     overlay and the pin verdicts use, so the dashed box lands on the
     photograph where the sheet put it. */
  function prepPlane(pr) {
    var z = pr && pr.zone;
    return (z && z.plane && z.plane !== "opening" && PLANE_DEFAULT[z.plane]) ? z.plane : "opening";
  }
  function prepZoneOf(it, pr) {
    var z = pr && pr.zone;
    if (!z || z.kind !== "rect") return null;
    var a = num(z.x0), b = num(z.x1), c = num(z.y0), d = num(z.y1);
    if ([a, b, c, d].some(function (v) { return v == null; })) return null;
    return { kind: "rect", x0: Math.min(a, b), x1: Math.max(a, b), y0: Math.min(c, d), y1: Math.max(c, d), plane: prepPlane(pr) };
  }
  function prepOnPlane(it, plane) {
    return (it.prep || []).filter(function (pr) { return prepPlane(pr) === (plane || "opening") && prepZoneOf(it, pr); });
  }
  function prepAnswered(it) {
    return (it.prep || []).every(function (pr) { return !!prepState(it, pr.id); });
  }
  /* What the tape found on a strip: setback, thickness, run, and whether
     it is finished. Kept beside the state so a "built as drawn" with a
     setback 1/4" off still carries its number. */
  var STRIP_MEAS = [
    { k: "setbackIn", label: "Starts back from the face", faces: ["left", "right", "both", "top", "bottom"] },
    { k: "thicknessIn", label: "Width", faces: ["left", "right", "both", "top", "bottom", "back"] },
    { k: "runIn", label: "Depth, front to back", faces: ["left", "right", "both", "top", "bottom"] }
  ];
  function stripMeasFor(pr) {
    var s = stripOf(pr), kd = prepKind(pr.kind);
    return STRIP_MEAS.filter(function (m) { return m.faces.indexOf(s.face) >= 0 && !(kd.k === "return" && m.k === "thicknessIn"); });
  }
  function prepMeas(it, id, k) { var ck = (it.prepChecks || {})[id]; return ck && ck.meas ? ck.meas[k] : ""; }
  function setPrepMeas(it, id, k, v) {
    it.prepChecks = it.prepChecks || {};
    var ck = it.prepChecks[id] = it.prepChecks[id] || { state: "", note: "" };
    ck.meas = ck.meas || {}; ck.meas[k] = v == null ? "" : String(v);
  }
  function prepFoundFinished(it, id) { var ck = (it.prepChecks || {})[id]; return (ck && ck.finished) || ""; }
  function setPrepFoundFinished(it, id, v) {
    it.prepChecks = it.prepChecks || {};
    var ck = it.prepChecks[id] = it.prepChecks[id] || { state: "", note: "" };
    ck.finished = ck.finished === v ? "" : v;
  }
  var STRIP_TOL = 1 / 8;
  /* The measured strip against the sheet's: each number off by more than
     1/8" is its own line with the amount, and finished-vs-not is a line of
     its own. Nothing is said about a number nobody typed. */
  function stripFindings(it, pr) {
    var out = [], kd = prepKind(pr.kind), s = stripOf(pr), ck = (it.prepChecks || {})[pr.id] || {}, meas = ck.meas || {};
    var who = stripFace(s.face) ? stripFace(s.face).words : "";
    stripMeasFor(pr).forEach(function (m) {
      var want = stripTarget(it, pr, m.k), got = num(meas[m.k]);
      if (want == null || got == null) return;
      var dd = got - want;
      if (Math.abs(dd) <= STRIP_TOL + 1e-9) return;
      var what = m.k === "setbackIn" ? "back from the face" : m.k === "thicknessIn" ? (s.face === "back" ? "proud of the wall" : "wide") : "deep";
      out.push({ id: pr.id + ":" + m.k, k: m.k, label: kd.label + " " + (m.k === "setbackIn" ? "setback" : m.k === "thicknessIn" ? "width" : "depth") + " off",
        detail: (pr.label || kd.label) + " " + who + " is " + fmtIn(got) + " " + what + " — " + (panelShift(it, pr, m.k) ? "it belongs at " + fmtIn(want) + " for the " + fmtIn(panelBasis(it).actual) + " panel" : "the sheet draws " + fmtIn(want)) + ". " +
          (m.k === "setbackIn" ? "Move it " + fmtIn(Math.abs(dd)) + (dd > 0 ? " toward the face" : " toward the back") + "."
            : m.k === "thicknessIn" ? (dd > 0 ? "Rip or replace it " + fmtIn(dd) + " narrower." : "Build it out " + fmtIn(-dd) + ".")
            : (dd > 0 ? "Cut it back " + fmtIn(dd) + "." : "Extend it " + fmtIn(-dd) + ".")),
        owner: prepOwner(pr) });
    });
    var ff = ck.finished;
    if (prepFinished(pr) && ff === "no") {
      out.push({ id: pr.id + ":finished", k: "finished", label: kd.label + " unfinished",
        detail: "Finish the " + (pr.label || kd.label).toLowerCase() + " " + who + " to match the cabinetry — it is in plain view beside the door once the unit is set.", owner: "cabinet" });
    }
    return out;
  }
  function prepFindings(it) {
    var out = [];
    (it.prep || []).forEach(function (pr) {
      var st = prepState(it, pr.id), ck = it.prepChecks[pr.id] || {};
      var kd = prepKind(pr.kind), owner = prepOwner(pr);
      if (st === "missing" || st === "wrong") {
        out.push({ id: pr.id, label: kd.label + (st === "missing" ? " not there" : " wrong"), owner: owner,
          detail: kd.verb + " as the sheet draws it: " + prepText(pr, it) + "." +
            (st === "wrong" && ck.note ? " Found: " + ck.note + "." : "") + (st === "wrong" && !ck.note && !(isStrip(pr) && ck.meas) ? " What is there does not match." : "") });
      }
      if (isStrip(pr) && st && st !== "missing") stripFindings(it, pr).forEach(function (f) { out.push(f); });
    });
    return out;
  }

  /* ---------- the rough-in drawing ---------------------------------------
     The opening to scale, the cabinets beside, above and below it, and
     every connection the sheet calls for drawn where it belongs — the
     office authors it by dragging boxes on this picture, the phone shows
     the opening-plane boxes on the calibrated photograph (that part
     predates the drawing), and the packet prints it with its dimensions,
     which is what the builder's electrician and plumber actually want.

     Planes are back-wall elevations seen from the front. Every zone is in
     inches from its plane's bottom-left corner, y up — the convention the
     library's zones have always used. Neighbouring planes carry their own
     size on the zone, since the sheet does not know the cabinet. */
  /* `adjacent` is the cabinet beside a dishwasher whose side nobody knows
     until the walk (Cayden, 21 Oct: "it's random which we end up with"):
     drawn on the right until the tech says which, and drawn as the sink
     cabinet it almost always is — a dashed sink and disposal for
     orientation, never a measurement. */
  var PLANE_DEFAULT = { left: { w: 24 }, right: { w: 24 }, above: { h: 30 }, below: { h: 30 }, adjacent: { w: 36 }, left2: { w: 24 }, right2: { w: 24 } };
  function adjacentSide(it) { return it && it.adjacentSide === "left" ? "left" : "right"; }
  /* the one plane-word map everything reads */
  function planeWord(it, k) {
    if (k === "adjacent") return "sink cabinet " + (it && it.adjacentSide ? "to the " + it.adjacentSide : "beside it");
    return PLANE_WORDS[k] || k;
  }
  function isDishwasherish(it) {
    var e = it ? itemEntry(it) : null;
    return /dishwasher|\bdw\b/i.test([it && it.category, it && it.appliance, it && it.model, e && e.category, e && e.appliance].filter(Boolean).join(" "));
  }
  /* zone colours by connection group (the markup palette, also MARK_COLORS
     once, is a different thing — the clash left every zone orange) */
  var ZONE_COLORS = { power: "#c77d00", water: "#1f6fd1", drain: "#5b6b63", gas: "#d9480f", vent: "#2f9e5a" };
  function roughInModel(it, planeSizes) {
    var pl = planeSize(it);
    if (!pl) return null;
    var sizes = Object.assign({}, PLANE_DEFAULT, planeSizes || {});
    var planes = {
      opening: { k: "opening", label: "the opening", w: pl.w, h: pl.h, x: 0, y: 0 },
      left:    { k: "left",    label: "cabinet left",  w: sizes.left.w,  h: pl.h, x: -sizes.left.w, y: 0 },
      right:   { k: "right",   label: "cabinet right", w: sizes.right.w, h: pl.h, x: pl.w, y: 0 },
      above:   { k: "above",   label: "cabinet above", w: pl.w, h: sizes.above.h, x: 0, y: pl.h },
      below:   { k: "below",   label: "cabinet below", w: pl.w, h: sizes.below.h, x: 0, y: -sizes.below.h },
      adjacent: { k: "adjacent", label: it.adjacentSide ? "sink cabinet (" + it.adjacentSide + ")" : "sink cabinet · either side", w: sizes.adjacent.w, h: pl.h,
                  x: adjacentSide(it) === "left" ? -sizes.adjacent.w : pl.w, y: 0, sink: it.sinkCabinet !== false },
      /* a run: the second cabinet over, beyond the first (a dishwasher two
         cabinets from the sink needs the extension kit) */
      left2:   { k: "left2",   label: "2nd cabinet left",  w: sizes.left2.w,  h: pl.h, x: -sizes.left.w - sizes.left2.w, y: 0 },
      right2:  { k: "right2",  label: "2nd cabinet right", w: sizes.right2.w, h: pl.h, x: pl.w + sizes.right.w, y: 0 }
    };
    /* nothing under a product that stands on the floor */
    if (!planeAllowed(it, "below")) delete planes.below;
    /* a zone drawn on a plane this opening cannot have (old data: a
       cutout "below" a refrigerator) is left off rather than moved onto
       the opening where it would mean something else */
    function planeKey(z) {
      if (!z || !z.plane || z.plane === "opening") return "opening";
      if (planes[z.plane]) return z.plane;
      return PLANE_DEFAULT[z.plane] ? null : "opening";
    }
    /* a cabinet the tech added in the field, with the size they typed */
    Object.keys(it.planePhotos || {}).forEach(function (k) {
      var pp = it.planePhotos[k], P = planes[k];
      if (!P || !pp || !pp.size) return;
      if (num(pp.size.w)) P.w = num(pp.size.w);
      if (num(pp.size.h)) P.h = num(pp.size.h);
      if (k === "left") P.x = -P.w; if (k === "below") P.y = -P.h; if (k === "adjacent" && adjacentSide(it) === "left") P.x = -P.w;
    });
    var marks = [], strips = [];
    (it.prep || []).forEach(function (pr) {
      if (isStrip(pr)) {
        /* a strip shows in the front view as the sliver it really is — a
           3/4" band down the side, a block across the back wall — and in
           full on the box */
        stripGeoms(it, pr).forEach(function (g) {
          strips.push(g);
          var vis = Math.max(g.t, 0.5);
          var r = g.face === "left" ? { x0: 0, x1: vis, y0: g.y0, y1: g.y1 } : g.face === "right" ? { x0: pl.w - vis, x1: pl.w, y0: g.y0, y1: g.y1 }
            : g.face === "top" ? { x0: g.x0, x1: g.x1, y0: pl.h - vis, y1: pl.h } : g.face === "bottom" ? { x0: g.x0, x1: g.x1, y0: 0, y1: vis }
            : { x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 };
          marks.push({ key: g.key, group: "prep", prep: true, strip: true, finished: g.finished, tag: g.tag, color: g.color, label: g.label, plane: "opening", kind: "rect",
            x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, words: stripWords(pr, it) });
        });
        return;
      }
      var z = pr.zone; if (!z || z.kind !== "rect") return;
      var pk = planeKey(z); if (!pk) return;
      var P = planes[pk];
      if (z.planeSize && pk !== "opening") { P.w = num(z.planeSize.w) || P.w; P.h = num(z.planeSize.h) || P.h; if (pk === "left" || (pk === "adjacent" && P.x < 0)) P.x = -P.w; if (pk === "below") P.y = -P.h; }
      var kd = prepKind(pr.kind);
      marks.push({ key: "prep:" + pr.id, group: "prep", prep: true, tag: kd.tag, color: kd.color, label: pr.label || kd.label, plane: pk, kind: "rect",
        x0: num(z.x0), x1: num(z.x1), y0: num(z.y0), y1: num(z.y1) });
    });
    utilitiesFor(it).forEach(function (u) {
      var z = u.zone; if (!z) return;
      var pk = planeKey(z); if (!pk) return;
      var P = planes[pk];
      if (z.planeSize && pk !== "opening") { P.w = num(z.planeSize.w) || P.w; P.h = num(z.planeSize.h) || P.h; if (pk === "left" || (pk === "adjacent" && P.x < 0)) P.x = -P.w; if (pk === "below") P.y = -P.h; }
      var m = { key: u.key, group: utilTypeGroup(u) || "power", label: utilLabel(u), need: u.need || "", plane: pk };
      if (z.kind === "any") { if (pk === "opening") return; m.kind = "rect"; m.any = true; m.x0 = 0; m.x1 = P.w; m.y0 = 0; m.y1 = P.h; }
      else if (z.kind === "point") { m.kind = "point"; m.x = edgeIn(z.x, P.w); m.y = edgeIn(z.y, P.h); if (m.x == null || m.y == null) return; }
      else {
        m.kind = "rect";
        m.x0 = edgeIn(z.x0, P.w); m.x1 = edgeIn(z.x1, P.w); m.y0 = edgeIn(z.y0, P.h); m.y1 = edgeIn(z.y1, P.h);
        if ([m.x0, m.x1, m.y0, m.y1].some(function (v) { return v == null; })) return;
      }
      marks.push(m);
    });
    /* the run settles after every width is known (the zones above can resize a plane): the second cabinets sit
       beyond the first, and the sink cabinet sits beyond whatever the tech
       put between it and the dishwasher on its side */
    planes.left2.x = planes.left.x - planes.left2.w;
    planes.right2.x = planes.right.x + planes.right.w;
    var pp = it.planePhotos || {}, side = adjacentSide(it);
    var between = (pp[side] && pp[side].added) ? planes[side].w + ((pp[side + "2"] && pp[side + "2"].added) ? planes[side + "2"].w : 0) : 0;
    planes.adjacent.x = side === "left" ? -between - planes.adjacent.w : pl.w + between;
    if (between) planes.adjacent.label = (it.adjacentSide ? "sink cabinet (" + it.adjacentSide + ")" : "sink cabinet") + " · " + (between >= planes[side].w + 1 ? "two cabinets" : "one cabinet") + " over";
    /* the walk's pins, in the plane's inches, coloured by the tech's answer */
    var pins = [];
    utilitiesFor(it).forEach(function (u) {
      /* the pin sits on the face the tech chose, which can differ from the
         sheet's; the verdict carries the difference */
      var pin = pinOf(it, u.key), pk = pin ? pin.plane : utilPlane(u);
      if (!planes[pk] && !FACE_PLANES[pk]) return;
      var at = markAt(it, u.key);
      if (!at) return;
      var a = it.utilities[u.key] || "", v = markVerdict(it, u);
      pins.push({ key: u.key, plane: pk, x: at.x, y: at.y, label: utilLabel(u), group: utilTypeGroup(u) || "power",
                  bad: a === "misplaced" || a === "missing" || !!(v && v.out), answer: a });
    });
    return { opening: pl, planes: planes, marks: marks, strips: strips, pins: pins, dims: dimNotes(it), depth: depthIn(it) };
  }
  /* ---------- the 3D box ---------------------------------------------
     Step two of "connections as a picture" (20 Oct 2026): the same planes
     and inches as the flat drawing, stood up as boxes. World axes: x to
     the right, y up, z toward the viewer; the opening's front edge is z =
     0 and its back wall z = −D. A neighbouring cabinet is a box beside,
     above or below it at the same depth. The camera is orthographic —
     no vanishing points, so every face stays a parallelogram and a tap
     on one solves back to inches with one 2 × 2 inverse — turned by a
     yaw and a pitch the tech drags, within limits that keep the open
     front toward them. */
  var BOX_FACES = ["back", "floor", "ceiling", "left", "right"];
  function boxModel(it, extraPlanes) {
    var pl = planeSize(it), D = depthIn(it) || 24;
    if (!pl) return null;
    var ri = roughInModel(it);
    if (!ri) return null;
    var boxes = {};
    var want = ["opening"].concat(extraPlanes || []);
    want.forEach(function (k) {
      var P = ri.planes[k];
      if (!P || boxes[k]) return;
      boxes[k] = { k: k, label: P.label, x0: P.x, x1: P.x + P.w, y0: P.y, y1: P.y + P.h, z0: -D, z1: 0, w: P.w, h: P.h, d: D, sink: !!P.sink, planeX: P.x };
    });
    var ex = [Infinity, -Infinity, Infinity, -Infinity];
    Object.keys(boxes).forEach(function (k) { var b = boxes[k]; ex[0] = Math.min(ex[0], b.x0); ex[1] = Math.max(ex[1], b.x1); ex[2] = Math.min(ex[2], b.y0); ex[3] = Math.max(ex[3], b.y1); });
    var span = Math.max(ex[1] - ex[0], ex[3] - ex[2], D);
    return { boxes: boxes, marks: ri.marks, strips: ri.strips || [], pins: ri.pins, dims: ri.dims, depth: D, opening: pl,
             centre: [(ex[0] + ex[1]) / 2, (ex[2] + ex[3]) / 2, -D / 2], dist: span * 2.6 };
  }
  /* a face: origin + two axes in world inches, local (a, b) in inches */
  function boxFace(b, f) {
    switch (f) {
      case "back":    return { O: [b.x0, b.y0, b.z0], U: [b.w, 0, 0], V: [0, b.h, 0], N: [0, 0, 1],  plane: b.k, w: b.w, h: b.h };
      case "floor":   return { O: [b.x0, b.y0, b.z1], U: [b.w, 0, 0], V: [0, 0, -b.d], N: [0, 1, 0], plane: b.k === "opening" ? "floor" : "", w: b.w, h: b.d };
      case "ceiling": return { O: [b.x0, b.y1, b.z1], U: [b.w, 0, 0], V: [0, 0, -b.d], N: [0, -1, 0], plane: b.k === "opening" ? "ceiling" : "", w: b.w, h: b.d };
      case "left":    return { O: [b.x0, b.y0, b.z1], U: [0, 0, -b.d], V: [0, b.h, 0], N: [1, 0, 0],  plane: b.k === "opening" ? "wall-left" : "", w: b.d, h: b.h };
      case "right":   return { O: [b.x1, b.y0, b.z1], U: [0, 0, -b.d], V: [0, b.h, 0], N: [-1, 0, 0], plane: b.k === "opening" ? "wall-right" : "", w: b.d, h: b.h };
    }
    return null;
  }
  /* The camera: yaw/pitch turn the world, then a mild perspective from a
     camera `dist` inches in front of the model's centre. Orthographic
     boxes read as a flat drawing of the back of a cabinet (Cayden, 21
     Oct); with the back wall smaller than the open front the eye knows it
     is looking in. `rot(p)` gives the turned point (x right, y up, depth
     toward the viewer) for the hit solver; `proj(p)` the screen point. */
  function boxProjector(view, model) {
    var yaw = (view.yaw || 0) * Math.PI / 180, pitch = (view.pitch || 0) * Math.PI / 180;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var c = model && model.centre ? model.centre : [0, 0, 0];
    var dist = model && model.dist ? model.dist : 1e9, F = dist;     /* focal length = distance: the centre plane is 1:1 */
    function rot(p) {
      var px = p[0] - c[0], py = p[1] - c[1], pz = p[2] - c[2];
      var x = px * cy + pz * sy, z1 = -px * sy + pz * cy;
      var y = py * cp - z1 * sp, z2 = py * sp + z1 * cp;
      return { x: x, y: y, depth: z2 };
    }
    function proj(p) {
      var r = rot(p), k = F / Math.max(1, dist - r.depth);
      return { x: r.x * k, y: -r.y * k, depth: r.depth };          /* screen y down; depth grows toward the viewer */
    }
    proj.rot = rot; proj.dist = dist; proj.F = F;
    return proj;
  }
  function add3(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
  /* every face of every box, projected, with its polygon, depth and
     whether the viewer sees its inside */
  function boxFaces(model, view) {
    var proj = boxProjector(view, model), out = [];
    var zero = proj.rot([0, 0, 0]);
    Object.keys(model.boxes).forEach(function (bk) {
      var b = model.boxes[bk];
      BOX_FACES.forEach(function (f) {
        var F = boxFace(b, f);
        var c = [F.O, add3(F.O, F.U, 1), add3(add3(F.O, F.U, 1), F.V, 1), add3(F.O, F.V, 1)];
        var pts = c.map(proj);
        /* the turned origin and axes, for the hit solver and the lighting */
        var ro = proj.rot(F.O), ru = proj.rot(add3(F.O, F.U, 1)), rv = proj.rot(add3(F.O, F.V, 1));
        var R = { o: [ro.x, ro.y, ro.depth], u: [ru.x - ro.x, ru.y - ro.y, ru.depth - ro.depth], v: [rv.x - ro.x, rv.y - ro.y, rv.depth - ro.depth] };
        var nr = proj.rot([F.N[0], F.N[1], F.N[2]]), n = [nr.x - zero.x, nr.y - zero.y, nr.depth - zero.depth];
        var mid = [R.o[0] + R.u[0] / 2 + R.v[0] / 2, R.o[1] + R.u[1] / 2 + R.v[1] / 2, R.o[2] + R.u[2] / 2 + R.v[2] / 2];
        var toCam = [-mid[0], -mid[1], proj.dist - mid[2]];
        var inside = (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2]) > 0.02 * proj.dist;  /* the inward normal faces the camera */
        /* a lamp above and a little in front of the camera */
        var L = [0.25, 0.75, 0.6], ln = Math.hypot(L[0], L[1], L[2]);
        var light = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / ln);
        var depth = pts.reduce(function (a, q) { return a + q.depth; }, 0) / 4;
        out.push({ box: b, f: f, F: F, R: R, pts: pts, inside: inside, light: light, depth: depth, o: pts[0], u: { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y }, v: { x: pts[3].x - pts[0].x, y: pts[3].y - pts[0].y } });
      });
    });
    /* Draw order for a cutaway box seen from its open front: outlines
       (the outsides) first so they sit behind, neighbours before the
       opening, the back wall before the faces that run toward the viewer.
       Average-depth sorting gets a tall back wall wrong under pitch. */
    function rank(f) {
      return (f.box.k === "opening" ? 4 : 0) + (f.inside ? 2 : 0) + (f.inside && f.f !== "back" ? 1 : 0);
    }
    out.sort(function (a, b) { return rank(a) - rank(b) || a.depth - b.depth; });
    return { faces: out, proj: proj };
  }
  /* where a screen point lands on a face, as fractions (a, b) of its
     axes: the ray through the camera meets the face's plane — under
     perspective that is still a 2 × 2 linear solve, because the face's
     turned coordinates are linear in a and b */
  function faceLocal(face, x, y, proj) {
    var R = face.R;
    if (!R || !proj) {
      var det0 = face.u.x * face.v.y - face.u.y * face.v.x;
      if (Math.abs(det0) < 1e-6) return null;
      var ddx = x - face.o.x, ddy = y - face.o.y;
      return { a: (ddx * face.v.y - ddy * face.v.x) / det0, b: (face.u.x * ddy - face.u.y * ddx) / det0 };
    }
    var sx = x / proj.F, sy = -y / proj.F, D = proj.dist;
    /* xr(a,b) = sx (D - zr(a,b)); yr(a,b) = sy (D - zr(a,b)) */
    var a11 = R.u[0] + sx * R.u[2], a12 = R.v[0] + sx * R.v[2], b1 = sx * (D - R.o[2]) - R.o[0];
    var a21 = R.u[1] + sy * R.u[2], a22 = R.v[1] + sy * R.v[2], b2 = sy * (D - R.o[2]) - R.o[1];
    var det = a11 * a22 - a12 * a21;
    if (Math.abs(det) < 1e-9) return null;
    return { a: (b1 * a22 - a12 * b2) / det, b: (a11 * b2 - a21 * b1) / det };
  }
  function facePoint(face, a, b, proj) {       /* a, b in inches on the face → screen */
    var fa = a / face.F.w, fb = b / face.F.h;
    if (face.R && proj) {
      var R = face.R, xr = R.o[0] + R.u[0] * fa + R.v[0] * fb, yr = R.o[1] + R.u[1] * fa + R.v[1] * fb, zr = R.o[2] + R.u[2] * fa + R.v[2] * fb;
      var k = proj.F / Math.max(1, proj.dist - zr);
      return { x: xr * k, y: -yr * k };
    }
    return { x: face.o.x + face.u.x * fa + face.v.x * fb, y: face.o.y + face.u.y * fa + face.v.y * fb };
  }
  /* a hex colour lit by 0..1 (0.55 = flat, below darker, above lighter) */
  function shade(hex, light) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var k = 0.86 + light * 0.22;
    function c(v) { return Math.max(0, Math.min(255, Math.round(v * k))); }
    return "#" + ((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1);
  }
  /* Base colours of a cabinet's insides: pale birch-ish carcass, the
     floor a touch warmer. Each face is then lit by its angle to the lamp,
     so the two side walls never read the same and the back wall sits
     darker than the floor — what free cabinet planners do to make a box
     read as a box. */
  var FACE_FILL = { back: "#f1ece2", floor: "#e9dfcc", ceiling: "#ece7dc", left: "#e6e0d3", right: "#e6e0d3" };
  function boxSvg(model, view, opts) {
    opts = opts || {};
    if (!model) return "";
    var fv = boxFaces(model, view), faces = fv.faces, proj = fv.proj;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    faces.forEach(function (f) { f.pts.forEach(function (q) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }); });
    var pad = 5, W = maxX - minX + pad * 2, fs = Math.max(1.3, W / 30);
    var H = maxY - minY + pad * 2 + fs * 1.6;   /* room under the box for the "open front" label */
    function sx(x) { return x - minX + pad; }
    function sy(y) { return y - minY + pad; }
    function P(q) { return sx(q.x).toFixed(2) + "," + sy(q.y).toFixed(2); }
    function poly(pts) { return pts.map(P).join(" "); }
    /* the measurements are labels on the box (v0.9.85), never its lines */
    var notes = (opts.measure !== false && model.dims) || {};
    var h = '<svg class="sw-box' + (opts.interactive ? " interactive" : "") + (opts.lockFace ? " locked" : "") + '" viewBox="0 0 ' + W.toFixed(2) + " " + H.toFixed(2) + '" xmlns="http://www.w3.org/2000/svg"' +
      ' data-minx="' + minX + '" data-miny="' + minY + '" data-pad="' + pad + '" data-yaw="' + (view.yaw || 0) + '" data-pitch="' + (view.pitch || 0) + '"' +
      (opts.width ? ' style="width:' + opts.width + '"' : "") + ">";
    /* the floor the run stands on: a soft shadow under every box */
    var open = model.boxes.opening;
    Object.keys(model.boxes).forEach(function (bk) {
      var b = model.boxes[bk];
      var g = [[b.x0 - 1.5, b.y0, b.z1 + 1.5], [b.x1 + 1.5, b.y0, b.z1 + 1.5], [b.x1 + 1.5, b.y0, b.z0 - 1.5], [b.x0 - 1.5, b.y0, b.z0 - 1.5]].map(proj);
      h += '<polygon points="' + poly(g) + '" fill="#000" fill-opacity=".06"/>';
    });
    faces.forEach(function (face) {
      var b = face.box, isOpen = b.k === "opening";
      /* a cutaway: the outside of a wall is an outline only, so the top
         never hides the back wall when the tech looks down into the box */
      var fill = face.inside ? shade(isOpen ? FACE_FILL[face.f] : (face.f === "back" ? "#eef2ef" : FACE_FILL[face.f]), face.light) : "none";
      if (face.inside && !isOpen && face.f !== "back") fill = "none";
      var stroke = face.inside ? (isOpen ? "#2a3630" : "#9aa7a0") : (isOpen ? "#aab5af" : "#c3ccc7");
      var locked = !!(opts.lockFace && face.F.plane === opts.lockFace);
      h += '<g class="sw-box-face' + (face.inside ? " in" : " out") + (locked ? " lock" : "") + '" data-box="' + b.k + '" data-face="' + face.f + '">' +
        '<polygon points="' + poly(face.pts) + '" fill="' + (locked ? "#fbf3dc" : fill) + '" stroke="' + (locked ? "#c77d00" : stroke) + '" stroke-width="' + (locked ? 1.1 : isOpen ? 0.3 : 0.25) + '"' + (isOpen && face.inside ? "" : ' stroke-dasharray="1.2 .9"') + "/>";
      if (locked && !face.inside) {
        /* the chosen face is turned away: say so on the drawing itself */
        var lc = { x: 0, y: 0 }; face.pts.forEach(function (q) { lc.x += q.x / 4; lc.y += q.y / 4; });
        h += '<text x="' + sx(lc.x).toFixed(2) + '" y="' + sy(lc.y).toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" fill="#c77d00" font-weight="700">turn the box</text>';
      }
      /* depth lines across the floor and the top every 6", so the eye
         reads how far in a point sits */
      if (face.inside && isOpen && (face.f === "floor" || face.f === "ceiling")) {
        for (var dd = 6; dd < face.F.h - 0.5; dd += 6) {
          var l0 = facePoint(face, 0, dd, proj), l1 = facePoint(face, face.F.w, dd, proj);
          h += '<line x1="' + sx(l0.x).toFixed(2) + '" y1="' + sy(l0.y).toFixed(2) + '" x2="' + sx(l1.x).toFixed(2) + '" y2="' + sy(l1.y).toFixed(2) + '" stroke="#000" stroke-opacity=".07" stroke-width=".25"/>';
        }
      }
      if (face.inside && face.f === "back") {
        if (!isOpen) {
          /* the name sits at the top of the wall, or at the bottom when a
             sink hangs from the top */
          var lab = facePoint(face, 1, b.sink ? 8.5 : b.h - fs * 1.2, proj);
          h += '<text x="' + sx(lab.x).toFixed(2) + '" y="' + sy(lab.y).toFixed(2) + '" font-size="' + fs + '" fill="#5b6b63">' + b.label + "</text>";
        }
        if (!isOpen && b.sink) {
          /* the sink cabinet's furniture in three dimensions: a basin hung
             from the top, a disposer under it, the dishwasher's hose running
             to it — a generic sink and disposer, dashed, for orientation */
          var skb = sinkSketch({ w: b.w, h: b.h }, b.planeX < 0 ? "right" : "left"), scb = "#7b8a84";
          var zf = b.z1 - Math.min(4, b.d * 0.15), zb = b.z0 + Math.min(3, b.d * 0.12);     /* the basin sits between the front and the back */
          function P3(x, y, z) { var q = proj([b.x0 + x, b.y0 + y, z]); return sx(q.x).toFixed(2) + "," + sy(q.y).toFixed(2); }
          var bs = skb.basin, bx0 = bs.x, bx1 = bs.x + bs.w, by0 = bs.y, by1 = bs.y + bs.h;
          var edges = [];
          [[bx0, by1, zb, bx1, by1, zb], [bx1, by1, zb, bx1, by1, zf], [bx1, by1, zf, bx0, by1, zf], [bx0, by1, zf, bx0, by1, zb],   /* rim */
           [bx0, by0, zb, bx1, by0, zb], [bx1, by0, zb, bx1, by0, zf], [bx1, by0, zf, bx0, by0, zf], [bx0, by0, zf, bx0, by0, zb],   /* bottom */
           [bx0, by1, zb, bx0, by0, zb], [bx1, by1, zb, bx1, by0, zb], [bx1, by1, zf, bx1, by0, zf], [bx0, by1, zf, bx0, by0, zf]    /* verticals */
          ].forEach(function (e) { edges.push('<line x1="' + P3(e[0], e[1], e[2]).split(",")[0] + '" y1="' + P3(e[0], e[1], e[2]).split(",")[1] + '" x2="' + P3(e[3], e[4], e[5]).split(",")[0] + '" y2="' + P3(e[3], e[4], e[5]).split(",")[1] + '"/>'); });
          /* the disposer: a cylinder under the basin's centre */
          var ds = skb.disposal, cx = ds.x + ds.w / 2, cz = (zf + zb) / 2, cr = ds.w / 2, ring = [];
          for (var ai = 0; ai <= 24; ai++) { var an = ai / 24 * Math.PI * 2; ring.push([cx + Math.cos(an) * cr, cz + Math.sin(an) * cr]); }
          var topRing = ring.map(function (q) { return P3(q[0], ds.y + ds.h, q[1]); }).join(" "), botRing = ring.map(function (q) { return P3(q[0], ds.y, q[1]); }).join(" ");
          var sideL = P3(cx - cr, ds.y + ds.h, cz) + " " + P3(cx - cr, ds.y, cz), sideR = P3(cx + cr, ds.y + ds.h, cz) + " " + P3(cx + cr, ds.y, cz);
          /* the hose: from the dishwasher's side of the cabinet, low, to the disposer's inlet at mid height */
          var hx = b.planeX < 0 ? b.w : 0, hoseY = 6, inX = b.planeX < 0 ? cx + cr : cx - cr;
          var hose = [P3(hx, hoseY, cz), P3(inX, hoseY, cz), P3(inX, ds.y + ds.h * 0.55, cz)].join(" ");
          h += '<g class="sw-box-sink" fill="none" stroke="' + scb + '" stroke-width=".3" stroke-dasharray="1 .7">' + edges.join("") +
            '<polyline points="' + topRing + '"/><polyline points="' + botRing + '"/><polyline points="' + sideL + '"/><polyline points="' + sideR + '"/>' +
            '<polyline points="' + hose + '" stroke-width=".45" stroke-dasharray="1.4 .8"/></g>';
          var sl = proj([b.x0 + bx0 + bs.w / 2, b.y0 + by1 + 1.2, zf]), dl = proj([b.x0 + cx, b.y0 + ds.y - 1.4, zf]);
          h += '<text x="' + sx(sl.x).toFixed(2) + '" y="' + sy(sl.y).toFixed(2) + '" font-size="' + (fs * 0.75).toFixed(2) + '" text-anchor="middle" fill="' + scb + '">sink</text>' +
            '<text x="' + sx(dl.x).toFixed(2) + '" y="' + sy(dl.y).toFixed(2) + '" font-size="' + (fs * 0.75).toFixed(2) + '" text-anchor="middle" fill="' + scb + '">disposer</text>';
        }
        /* the sheet's zones and the cabinet prep live on the back walls;
           "anywhere" zones all cover the face, so their tags line up
           side by side instead of on top of each other */
        var anyN = (model.marks || []).filter(function (m) { return m.plane === b.k && m.any; }).length, anyI = 0;
        (model.marks || []).forEach(function (m) {
          if (m.plane !== b.k || m.strip) return;        /* strips are solids, drawn after the faces */
          var col = m.color || ZONE_COLORS[m.group] || "#c77d00", tag = m.tag || (m.group || "?").charAt(0).toUpperCase();
          if (m.kind === "point") {
            var q = facePoint(face, m.x, m.y, proj);
            h += '<circle cx="' + sx(q.x).toFixed(2) + '" cy="' + sy(q.y).toFixed(2) + '" r="' + (fs * 0.8).toFixed(2) + '" fill="' + col + '" fill-opacity=".8" stroke="#fff" stroke-width=".25"/>';
          } else {
            var x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
            var zp = [facePoint(face, x0, y0, proj), facePoint(face, x1, y0, proj), facePoint(face, x1, y1, proj), facePoint(face, x0, y1, proj)];
            var midIn = (x0 + x1) / 2, midY = (y0 + y1) / 2;
            if (m.any) { midIn += (anyI - (anyN - 1) / 2) * Math.min(fs * 2.4, (x1 - x0) / Math.max(4, anyN * 2)); if (b.sink) midY = Math.min(y1, y0 + 5); }
            var mid = facePoint(face, midIn, midY, proj);
            if (m.any) {
              if (anyI === 0) h += '<polygon points="' + poly(zp) + '" fill="#8a9a92" fill-opacity=".10" stroke="#8a9a92" stroke-width=".35" stroke-dasharray="1 .5"/>';
              h += '<circle cx="' + sx(mid.x).toFixed(2) + '" cy="' + sy(mid.y).toFixed(2) + '" r="' + (fs * 0.95).toFixed(2) + '" fill="' + col + '" fill-opacity=".9" stroke="#fff" stroke-width=".3"/>' +
                '<text x="' + sx(mid.x).toFixed(2) + '" y="' + (sy(mid.y) + fs * 0.35).toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" fill="#fff" font-weight="700">' + tag + "</text>";
              anyI++;
            } else
            h += '<polygon points="' + poly(zp) + '" fill="' + col + '" fill-opacity="' + (m.prep ? ".14" : ".3") + '" stroke="' + col + '" stroke-width=".35"' + (m.prep ? ' stroke-dasharray="1 .5"' : "") + "/>" +
              '<text x="' + sx(mid.x).toFixed(2) + '" y="' + (sy(mid.y) + fs * 0.35).toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" fill="' + col + '" font-weight="700">' + tag + "</text>";
          }
        });
      }
      /* the walk's pins on whichever face they sit */
      if (face.inside && face.F.plane) {
        (model.pins || []).forEach(function (pn) {
          if (pn.plane !== face.F.plane) return;
          var q = facePoint(face, pn.x, pn.y, proj), col = pn.bad ? "#c8341f" : "#16713a", live = opts.activePin === pn.key;
          h += '<g class="sw-ri-pin' + (live ? " on" : "") + '" data-key="' + pn.key + '"><circle cx="' + sx(q.x).toFixed(2) + '" cy="' + sy(q.y).toFixed(2) + '" r="' + (fs * (live ? 1 : 0.8)).toFixed(2) + '" fill="' + col + '" stroke="#fff" stroke-width=".35"/>' +
            '<text x="' + sx(q.x).toFixed(2) + '" y="' + (sy(q.y) - fs * 1.2).toFixed(2) + '" font-size="' + (fs * 0.85).toFixed(2) + '" text-anchor="middle" fill="' + col + '" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width=".5">' + pn.label + "</text></g>";
        });
      }
      h += "</g>";
    });
    /* the cleats, returns and blocking: solid wood inside the opening at
       its own depth — a 3/4" strip standing proud of the side wall behind
       the return, a 2×4 across the back wall — not a mark painted on a
       face. Finished wood draws in a wood tone with the kind's edge;
       unfinished blocking draws paler and dashed. A return has no
       thickness: it is the wall itself, so it draws as a band on the wall. */
    if (open && model.strips && model.strips.length) {
      var zero2 = proj.rot([0, 0, 0]);
      function seesFace(N, mid) {
        var nr = proj.rot(N), n = [nr.x - zero2.x, nr.y - zero2.y, nr.depth - zero2.depth];
        var m = proj.rot(mid), toCam = [-m.x, -m.y, proj.dist - m.depth];
        return (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2]) > 0;
      }
      function lightOf(N) {
        var nr = proj.rot(N), n = [nr.x - zero2.x, nr.y - zero2.y, nr.depth - zero2.depth];
        var L = [0.25, 0.75, 0.6], ln = Math.hypot(L[0], L[1], L[2]);
        return Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / ln);
      }
      var stripsSorted = model.strips.slice().sort(function (a, b) {
        var ma = proj([open.x0 + (a.x0 + a.x1) / 2, open.y0 + (a.y0 + a.y1) / 2, (a.z0 + a.z1) / 2]), mb = proj([open.x0 + (b.x0 + b.x1) / 2, open.y0 + (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2]);
        return ma.depth - mb.depth;      /* farther first */
      });
      stripsSorted.forEach(function (g) {
        var X0 = open.x0 + g.x0, X1 = open.x0 + g.x1, Y0 = open.y0 + g.y0, Y1 = open.y0 + g.y1, Z0 = g.z0, Z1 = g.z1;
        var base = g.finished ? "#d2ad73" : "#e6dac3", edge = g.color, dash = g.finished ? "" : ' stroke-dasharray="1 .6"';
        if (g.t <= 0) {
          /* a return: the finished band of the wall from the face back */
          var band = g.face === "left" ? [[X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], [X0, Y0, Z0]]
            : g.face === "right" ? [[X1, Y0, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X1, Y0, Z0]]
            : g.face === "top" ? [[X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0]]
            : [[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y0, Z0], [X0, Y0, Z0]];
          var N = g.face === "left" ? [1, 0, 0] : g.face === "right" ? [-1, 0, 0] : g.face === "top" ? [0, -1, 0] : [0, 1, 0];
          var midB = [(band[0][0] + band[2][0]) / 2, (band[0][1] + band[2][1]) / 2, (band[0][2] + band[2][2]) / 2];
          if (!seesFace(N, midB)) return;
          h += '<g class="sw-box-strip return" data-key="' + g.key + '"><polygon points="' + poly(band.map(proj)) + '" fill="' + shade(base, lightOf(N)) + '" fill-opacity=".55" stroke="' + edge + '" stroke-width=".45"/>';
          var lb = proj([midB[0], Y0 + (Y1 - Y0) * 0.3, midB[2]]);     /* a third of the way up, clear of a cleat's tag at mid-height */
          h += '<text x="' + sx(lb.x).toFixed(2) + '" y="' + (sy(lb.y) + fs * 0.35).toFixed(2) + '" font-size="' + (fs * 0.85).toFixed(2) + '" text-anchor="middle" fill="' + edge + '" font-weight="700">' + g.tag + "</text></g>";
          return;
        }
        /* a solid: the three faces turned toward the camera */
        var C = {
          front:  { pts: [[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1]], N: [0, 0, 1] },
          back:   { pts: [[X0, Y0, Z0], [X1, Y0, Z0], [X1, Y1, Z0], [X0, Y1, Z0]], N: [0, 0, -1] },
          left:   { pts: [[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0]], N: [-1, 0, 0] },
          right:  { pts: [[X1, Y0, Z0], [X1, Y0, Z1], [X1, Y1, Z1], [X1, Y1, Z0]], N: [1, 0, 0] },
          top:    { pts: [[X0, Y1, Z0], [X1, Y1, Z0], [X1, Y1, Z1], [X0, Y1, Z1]], N: [0, 1, 0] },
          bottom: { pts: [[X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1]], N: [0, -1, 0] }
        };
        h += '<g class="sw-box-strip' + (g.finished ? " finished" : " rough") + '" data-key="' + g.key + '">';
        var order = Object.keys(C).map(function (k) { var f = C[k], mid = [(f.pts[0][0] + f.pts[2][0]) / 2, (f.pts[0][1] + f.pts[2][1]) / 2, (f.pts[0][2] + f.pts[2][2]) / 2]; return { k: k, f: f, mid: mid, depth: proj(mid).depth }; })
          .filter(function (o) { return seesFace(o.f.N, o.mid); }).sort(function (a, b) { return a.depth - b.depth; });
        order.forEach(function (o) {
          h += '<polygon points="' + poly(o.f.pts.map(proj)) + '" fill="' + shade(base, lightOf(o.f.N)) + '" stroke="' + edge + '" stroke-width=".4" stroke-linejoin="round"' + dash + "/>";
        });
        /* the tag rides the strip's front face, mid-height */
        var tm = proj([(X0 + X1) / 2, (Y0 + Y1) / 2, Z1]);
        h += '<circle cx="' + sx(tm.x).toFixed(2) + '" cy="' + sy(tm.y).toFixed(2) + '" r="' + (fs * 0.9).toFixed(2) + '" fill="' + edge + '" fill-opacity=".92" stroke="#fff" stroke-width=".3"/>' +
          '<text x="' + sx(tm.x).toFixed(2) + '" y="' + (sy(tm.y) + fs * 0.35).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" text-anchor="middle" fill="#fff" font-weight="700">' + g.tag + "</text></g>";
      });
    }
    /* the cut: the front edges of every wall at z = 0, drawn heavy — the
       open front the appliance slides into, where the tech stands */
    Object.keys(model.boxes).forEach(function (bk) {
      var b = model.boxes[bk], isOpen = bk === "opening";
      var fr = [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]].map(proj);
      h += '<polygon class="sw-box-front" points="' + poly(fr) + '" fill="none" stroke="' + (isOpen ? "#1f2a24" : "#7d8a84") + '" stroke-width="' + (isOpen ? 1.1 : 0.6) + '" stroke-linejoin="round"' + (isOpen ? "" : ' stroke-dasharray="2 1"') + "/>";
    });
    if (open) {
      /* a tag riding the front bottom edge: the cut the tech stands at */
      var fm = proj([(open.x0 + open.x1) / 2, open.y0, open.z1]), tw = fs * 0.55 * 24, th = fs * 1.3;
      h += '<g class="sw-box-fronttag"><rect x="' + (sx(fm.x) - tw / 2).toFixed(2) + '" y="' + (sy(fm.y) - th / 2).toFixed(2) + '" width="' + tw.toFixed(2) + '" height="' + th.toFixed(2) + '" rx="' + (th / 2).toFixed(2) + '" fill="#1f2a24"/>' +
        '<text x="' + sx(fm.x).toFixed(2) + '" y="' + (sy(fm.y) + fs * 0.3).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" text-anchor="middle" fill="#fff" font-weight="700" letter-spacing=".08">OPEN FRONT · you are here</text></g>';
    }
    if (open && (notes.w || notes.h || notes.d)) {
      /* Each label rides the edge it measures: width on the front top
         edge, height on the front upright that stands clear of the box,
         depth on the top edge that runs back along the wall you can see
         into. Kept inside the picture, so nothing is cut off at its edge. */
      var seen = {};
      faces.forEach(function (f) { if (f.box.k === "opening") seen[f.f] = f.inside; });
      var nearLeft = seen.right && !seen.left ? true : seen.left && !seen.right ? false : (view.yaw || 0) >= 0;
      var hxw = nearLeft ? open.x0 : open.x1, dxw = nearLeft ? open.x1 : open.x0;
      var at = {
        w: proj([(open.x0 + open.x1) / 2, open.y1, open.z1]),
        h: proj([hxw, (open.y0 + open.y1) / 2, open.z1]),
        d: proj([dxw, open.y1, (open.z0 + open.z1) / 2])
      };
      var fa = proj([open.x0, open.y1, open.z1]), fb = proj([open.x1, open.y1, open.z1]);
      var fd = Math.max(0.9, Math.min(fs * 0.92, Math.abs(fb.x - fa.x) / 11));
      var put = [];
      h += '<g class="sw-dims" pointer-events="none">';
      [["w", 0], ["h", 1], ["d", -1]].forEach(function (kd) {
        var k = kd[0];
        if (!notes[k]) return;
        var sz = dimPillSize(notes[k], fd);
        var cx = Math.max(sz.w / 2 + 0.3, Math.min(W - sz.w / 2 - 0.3, sx(at[k].x)));
        var cy = Math.max(sz.h / 2 + 0.3, Math.min(H - sz.h / 2 - 0.3, sy(at[k].y)));
        /* a small box in a wide run: step along the edge until clear */
        for (var n = 0; n < 8 && put.some(function (t) { return Math.abs(cx - t[0]) < (sz.w + t[2]) / 2 + 0.3 && Math.abs(cy - t[1]) < (sz.h + t[3]) / 2 + 0.3; }); n++) cy += kd[1] * sz.h * 0.5;
        cy = Math.max(sz.h / 2 + 0.3, Math.min(H - sz.h / 2 - 0.3, cy));
        put.push([cx, cy, sz.w, sz.h]);
        h += dimPill(notes[k], cx, cy, fd);
      });
      h += "</g>";
    }
    return h + "</svg>";
  }
  /* ---------- ventilation: the hood over the cooking surface --------------
     A hood has no cavity, so the opening drawing is the wrong picture. This
     is a front elevation with the cooking surface as the datum: the counter
     (or range), the wall cabinets either side, the ceiling, the sheet's
     height band, and the hood itself — a mock-up PLACED FROM THE READINGS,
     its bottom at the measured height above the cooking surface and its
     centre at the measured offset (v0.9.81: Cayden, 6 Nov — "instead of us
     sliding around the box of the hood, place a mock-up where it actually
     will be based on our cooking surface to hood measurement").

     Two kinds of hood walk differently. A finished hood (wall, chimney,
     under-cabinet, island) is one box hung at a height. An insert or liner
     goes into a custom hood — the shroud — and it is the shroud that is
     walked: its cutout against the insert's spec, its bottom above the
     cooking surface, the room inside it, the duct and power brought in
     where the insert wants them. Everything in inches. */
  var HOOD_UNDER = [
    { k: "cooktop", label: "Cooktop", surfaceAbove: 0 },
    { k: "rangetop", label: "Rangetop", surfaceAbove: 0 },
    { k: "range", label: "Range", surfaceAbove: 0 }
  ];
  /* the cooking appliance under this hood, when it is on the same walk:
     its nominal width is what the hood has to cover, and its kind is what
     the elevation draws under the hood */
  function cookingUnder(walk, it) {
    if (!walk || !it) return null;
    var best = null;
    (walk.items || []).forEach(function (x) {
      if (x === it || isMerge(x)) return;
      var fk = formKeyFor(x);
      if (fk !== "range" && fk !== "cooktop") return;
      var sameArea = (x.area || "").trim().toLowerCase() === (it.area || "").trim().toLowerCase();
      if (best && !sameArea && best.sameArea) return;
      var words = ((x.appliance || "") + " " + (x.model || "")).toLowerCase();
      var w = null, mm = /(\d{2})\s*(?:"|”|in\b|-?inch)/.exec(x.appliance || "");
      if (mm) w = +mm[1];
      if (w == null) { var e = itemEntry(x); var m2 = e && /(\d{2})"/.exec(e.appliance || ""); if (m2) w = +m2[1]; }
      if (w == null) w = num(x.spec && x.spec.w);
      var kind = fk === "range" ? "range" : (/rangetop|range top/.test(words) ? "rangetop" : "cooktop");
      best = { item: x, w: w, kind: kind, sameArea: sameArea, title: [x.brand, x.model].filter(Boolean).join(" ") };
    });
    return best;
  }
  function hoodSpec(it, walk) {
    var hd = it.hood || {}, pl = planeSize(it), cu = cookingUnder(walk, it);
    var type = hd.type || "insert";
    return {
      type: type, under: hd.under || (cu ? cu.kind : "cooktop"),
      unitW: num(hd.w) || (pl && pl.w) || 36, unitH: num(hd.h) || (type === "insert" ? 12 : 18), unitD: num(hd.d) || (pl && pl.d) || 22,
      cookW: num(hd.cookW) || (cu && cu.w) || 36, cooking: cu,
      bandMin: num(it.spec && it.spec.h), bandMax: num(it.specMax && it.specMax.h),
      duct: hd.duct || {}, jbox: hd.jbox || "", notes: hd.notes || ""
    };
  }
  function hoodModel(it, walk) {
    if (!it) return null;
    var fk = formKeyFor(it);
    if (fk !== "hood" && fk !== "shroud") return null;
    var sp = hoodSpec(it, walk || walkOfItem(it)), f = it.form || {};
    var counterH = num(f.counterH) || 36, toCeiling = num(f.toCeiling);
    var ceiling = toCeiling != null ? counterH + toCeiling : null;
    var space = num(it.actual && it.actual.w);                   /* finished hood: between the wall cabinets; shroud: the cutout width */
    var cabBottom = num(f.cabBottom) != null ? num(f.cabBottom) : 18;
    var measured = num(it.actual && it.actual.h);                /* the bottom above the cooking surface — the reading that places it */
    var placed = measured != null;
    var bottom = placed ? measured : (sp.bandMin != null ? sp.bandMin : 30);
    /* the offset is typed as a size and a side (the pad has no minus key) */
    var offset = (num(f.hoodOff) || 0) * (f.hoodOffSide === "left" ? -1 : 1);
    var surface = counterH;
    var shroud = null;
    if (fk === "shroud") {
      var sw = num(f.shroudW), ih = num(f.shroudInnerH);
      var cutW = num(it.actual && it.actual.w), cutD = num(it.actual && it.actual.d);
      var specW = num(it.spec && it.spec.w), specD = num(it.spec && it.spec.d);
      shroud = {
        w: sw != null ? sw : Math.max(sp.unitW + 6, sp.cookW), wGiven: sw != null,
        innerH: ih, cutW: cutW, cutD: cutD, specW: specW, specD: specD,
        top: ih != null ? surface + bottom + ih : (ceiling != null ? ceiling : surface + bottom + sp.unitH + 10),
        cutOk: cutW == null || specW == null ? null : cutW + 1e-9 >= specW,
        cutDOk: cutD == null || specD == null ? null : cutD + 1e-9 >= specD,
        innerOk: ih == null ? null : ih + 1e-9 >= sp.unitH,
        wideOk: sw == null ? null : sw + 1e-9 >= sp.cookW
      };
    }
    var top = shroud ? shroud.top : surface + bottom + sp.unitH;
    var hoodW = shroud ? shroud.w : sp.unitW, half = Math.max(sp.cookW, hoodW, space || 0) / 2 + 34;
    var floorY = 0, sceneTop = Math.max((ceiling != null ? ceiling : surface + 60) + 4, top + 8);
    return {
      form: fk, spec: sp, counterH: counterH, ceiling: ceiling, surface: surface, space: space, cabBottom: cabBottom,
      bottom: bottom, placed: placed, offset: offset, top: top, toCeiling: ceiling != null ? ceiling - top : null,
      shroud: shroud,
      x0: -half, x1: half, y0: floorY, y1: sceneTop,
      inBand: !placed || (sp.bandMin == null && sp.bandMax == null) ? null : !((sp.bandMin != null && bottom < sp.bandMin - 1 / 16) || (sp.bandMax != null && bottom > sp.bandMax + 1 / 16))
    };
  }
  function hoodSvg(model, opts) {
    opts = opts || {};
    if (!model) return "";
    var m = model, sp = m.spec, pad = 6, shroud = m.shroud;
    var W = m.x1 - m.x0 + pad * 2, H = m.y1 - m.y0 + pad * 2, fs = Math.max(1.6, W / 34);
    function sx(x) { return x - m.x0 + pad; }
    function sy(y) { return m.y1 - y + pad; }
    function rect(x, y, w, h, extra) { return '<rect x="' + sx(x).toFixed(2) + '" y="' + sy(y + h).toFixed(2) + '" width="' + w.toFixed(2) + '" height="' + h.toFixed(2) + '" ' + (extra || "") + "/>"; }
    function line(x0, y0, x1, y1, extra) { return '<line x1="' + sx(x0).toFixed(2) + '" y1="' + sy(y0).toFixed(2) + '" x2="' + sx(x1).toFixed(2) + '" y2="' + sy(y1).toFixed(2) + '" ' + (extra || "") + "/>"; }
    function text(x, y, t, extra) { return '<text x="' + sx(x).toFixed(2) + '" y="' + sy(y).toFixed(2) + '" font-size="' + fs.toFixed(2) + '" ' + (extra || "") + ">" + t + "</text>"; }
    var h = '<svg class="sw-hood' + (shroud ? " shroud" : "") + '" viewBox="0 0 ' + W.toFixed(2) + " " + H.toFixed(2) + '" xmlns="http://www.w3.org/2000/svg"' +
      ' data-minx="' + m.x0 + '" data-maxy="' + m.y1 + '" data-pad="' + pad + '"' + (opts.width ? ' style="width:' + opts.width + '"' : "") + ">";
    /* the wall and floor */
    h += rect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0, 'fill="#f8faf9"');
    h += line(m.x0, 0, m.x1, 0, 'stroke="#1f2a24" stroke-width=".6"');
    /* the ceiling */
    if (m.ceiling != null) {
      h += line(m.x0, m.ceiling, m.x1, m.ceiling, 'stroke="#1f2a24" stroke-width=".6"');
      h += text(m.x0 + 1, m.ceiling + 0.8, "ceiling · " + fmtIn(m.ceiling) + " above the floor", 'fill="#5a646c" font-size="' + (fs * 0.8).toFixed(2) + '"');
    } else {
      h += line(m.x0, m.y1 - 2, m.x1, m.y1 - 2, 'stroke="#9aa7a0" stroke-width=".4" stroke-dasharray="2 1.5"');
      h += text(m.x0 + 1, m.y1 - 1.2, "ceiling height not entered", 'fill="#9aa7a0" font-size="' + (fs * 0.8).toFixed(2) + '"');
    }
    /* the counter and what cooks on it */
    var cw = sp.cookW, cx0 = -cw / 2, under = sp.under;
    /* the cooking appliance on this walk is named only when the tech's
       "under it" agrees with what it is */
    var cookLabel = (sp.cooking && sp.cooking.kind === under ? sp.cooking.title + " · " : "") + fmtIn(cw) + " " + under + " · cooking surface";
    if (under === "range") {
      h += rect(m.x0, 0, cx0 - m.x0 - 1, m.counterH, 'fill="#e4e8e6" stroke="#9aa7a0" stroke-width=".3"');
      h += rect(cx0 + cw + 1, 0, m.x1 - cx0 - cw - 1, m.counterH, 'fill="#e4e8e6" stroke="#9aa7a0" stroke-width=".3"');
      h += rect(cx0, 0, cw, m.counterH, 'fill="#cfd6d2" stroke="#1f2a24" stroke-width=".4"');
      h += rect(cx0 + 2, 6, cw - 4, m.counterH - 12, 'fill="#dfe4e1" stroke="#1f2a24" stroke-width=".3"');
      h += line(cx0 + 4, m.counterH - 2.5, cx0 + cw - 4, m.counterH - 2.5, 'stroke="#1f2a24" stroke-width=".6"');
      h += rect(cx0, m.counterH, cw, 1.2, 'fill="#333"');
    } else {
      h += rect(m.x0, 0, m.x1 - m.x0, m.counterH - 1.5, 'fill="#e4e8e6" stroke="#9aa7a0" stroke-width=".3"');
      h += rect(m.x0, m.counterH - 1.5, m.x1 - m.x0, 1.5, 'fill="#cfd6d2" stroke="#1f2a24" stroke-width=".4"');
      if (under === "rangetop") {
        h += rect(cx0, m.counterH, cw, 7, 'fill="#3a3f3c" stroke="#1f2a24" stroke-width=".4"');
        for (var k = 0; k < Math.floor(cw / 7); k++) h += '<circle cx="' + sx(cx0 + 4 + k * 7).toFixed(2) + '" cy="' + sy(m.counterH + 3.5).toFixed(2) + '" r="1.3" fill="#c8341f"/>';
      } else {
        h += rect(cx0, m.counterH, cw, 1, 'fill="#333"');
      }
    }
    h += text(0, -3.4, cookLabel, 'text-anchor="middle" fill="#1f2a24" font-weight="700"');
    /* the wall cabinets either side of a finished hood's space */
    if (!shroud && m.space != null && m.ceiling != null) {
      var sx0 = -m.space / 2, sx1 = m.space / 2, cabTop = m.ceiling, cabY = m.counterH + m.cabBottom;
      h += rect(m.x0, cabY, sx0 - m.x0, cabTop - cabY, 'fill="#eef1ef" stroke="#1f2a24" stroke-width=".4"');
      h += rect(sx1, cabY, m.x1 - sx1, cabTop - cabY, 'fill="#eef1ef" stroke="#1f2a24" stroke-width=".4"');
      h += text(m.x0 + 1, cabTop - fs * 3.2, "wall cabinet", 'fill="#5a646c" font-size="' + (fs * 0.8).toFixed(2) + '"');
      h += line(sx0, cabY + 2, sx1, cabY + 2, 'stroke="#5a646c" stroke-width=".3"') + line(sx0, cabY + 1, sx0, cabY + 3, 'stroke="#5a646c" stroke-width=".3"') + line(sx1, cabY + 1, sx1, cabY + 3, 'stroke="#5a646c" stroke-width=".3"');
      h += text(0, cabY + 3, fmtIn(m.space) + " between the cabinets", 'text-anchor="middle" fill="#5a646c" font-size="' + (fs * 0.8).toFixed(2) + '"');
    }
    /* the sheet's band: where the bottom of the hood may sit */
    if (sp.bandMin != null || sp.bandMax != null) {
      var bMin = sp.bandMin != null ? sp.bandMin : sp.bandMax, bMax = sp.bandMax != null ? sp.bandMax : sp.bandMin;
      h += rect(-sp.unitW / 2 - 6, m.surface + bMin, sp.unitW + 12, Math.max(0.5, bMax - bMin), 'fill="#dcecdf" fill-opacity=".6" stroke="#2f7d4f" stroke-width=".3" stroke-dasharray="1.5 1"');
      h += text(0, m.surface + bMin - fs * 1.3, "sheet: bottom " + (bMin === bMax ? fmtIn(bMin) : fmtIn(bMin) + "–" + fmtIn(bMax)) + " above the cooking surface", 'text-anchor="middle" fill="#12331f" font-weight="700" font-size="' + (fs * 0.85).toFixed(2) + '"');
    }
    /* the centreline */
    h += line(0, m.counterH, 0, m.y1 - 2, 'stroke="#9aa7a0" stroke-width=".3" stroke-dasharray="1 2"');
    /* the hood, placed from the readings; a ghost until the height is typed */
    var ghost = !m.placed;
    /* the hood keeps its own lines whatever the reading says (v0.9.85);
       the reading beside it is what turns red */
    var hy = m.surface + m.bottom, col = ghost ? "#9aa7a0" : "#1f2a24", readCol = ghost ? "#9aa7a0" : m.inBand === false ? "#c8341f" : "#1f2a24";
    var dash = ghost ? ' stroke-dasharray="2 1.4"' : "";
    var hxl = m.offset - sp.unitW / 2;
    h += '<g class="sw-hood-box">';
    if (shroud) {
      /* the shroud: a trapezoid when it is wider at the bottom than the
         insert, running from its bottom to its top (the ceiling, or the
         inside height typed) */
      var sw2 = shroud.w / 2, topW = Math.min(shroud.w, Math.max(sp.unitW + 4, shroud.w * 0.6));
      var pts = [[m.offset - sw2, hy], [m.offset + sw2, hy], [m.offset + topW / 2, shroud.top], [m.offset - topW / 2, shroud.top]].map(function (p) { return sx(p[0]).toFixed(2) + "," + sy(p[1]).toFixed(2); }).join(" ");
      h += '<polygon points="' + pts + '" fill="#efe6d6" stroke="' + col + '" stroke-width=".9"' + dash + "/>";
      /* the cutout in its bottom, and the insert sitting in it */
      var cutW = shroud.cutW != null ? shroud.cutW : sp.unitW;
      h += line(m.offset - cutW / 2, hy, m.offset + cutW / 2, hy, 'stroke="#f8faf9" stroke-width="1.1"');
      h += rect(hxl, hy, sp.unitW, sp.unitH, 'fill="#e9eeeb" stroke="#1f2a24" stroke-width=".6"' + dash);
      h += text(m.offset, hy + sp.unitH / 2 - fs * 0.35, "insert · " + fmtIn(sp.unitW) + " × " + fmtIn(sp.unitH), 'text-anchor="middle" fill="#1f2a24" font-weight="700" font-size="' + (fs * 0.9).toFixed(2) + '"');
      var cutCol = shroud.cutOk === false ? "#c8341f" : shroud.cutOk ? "#1f2a24" : "#5a646c";
      h += line(m.offset - cutW / 2, hy - 2.2, m.offset + cutW / 2, hy - 2.2, 'stroke="' + cutCol + '" stroke-width=".4"') + line(m.offset - cutW / 2, hy - 3.2, m.offset - cutW / 2, hy - 1.2, 'stroke="' + cutCol + '" stroke-width=".4"') + line(m.offset + cutW / 2, hy - 3.2, m.offset + cutW / 2, hy - 1.2, 'stroke="' + cutCol + '" stroke-width=".4"');
      /* the cutout reading sits under the band's label, in the clear air
         between the shroud and the cooking surface */
      var bandY = sp.bandMin != null ? m.surface + sp.bandMin - fs * 1.3 : hy;
      h += text(m.offset, Math.min(hy - 2.6, bandY) - fs * 1.5, "cutout " + (shroud.cutW != null ? fmtIn(shroud.cutW) : "not measured") + (shroud.specW != null ? " · sheet " + fmtIn(shroud.specW) : ""), 'text-anchor="middle" fill="' + cutCol + '" font-weight="700" font-size="' + (fs * 0.85).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
      if (shroud.innerH != null) {
        var ix = m.offset + sp.unitW / 2 + 3, innerCol = shroud.innerOk === false ? "#c8341f" : "#1f2a24";
        h += line(ix, hy, ix, shroud.top, 'stroke="' + innerCol + '" stroke-width=".4"') + line(ix - 1, hy, ix + 1, hy, 'stroke="' + innerCol + '" stroke-width=".4"') + line(ix - 1, shroud.top, ix + 1, shroud.top, 'stroke="' + innerCol + '" stroke-width=".4"');
        h += text(ix + 1.2, (hy + shroud.top) / 2, fmtIn(shroud.innerH) + " inside" + (shroud.innerOk === false ? " — insert is " + fmtIn(sp.unitH) : ""), 'fill="' + innerCol + '" font-weight="700" font-size="' + (fs * 0.8).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
      }
      h += text(m.offset - shroud.w / 2 - 1.5, hy + 1.2, "shroud · " + fmtIn(shroud.w) + " wide" + (shroud.wGiven ? "" : " (not measured)"), 'text-anchor="end" fill="#5a4a2e" font-weight="700" font-size="' + (fs * 0.85).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
    } else {
      h += rect(hxl, hy, sp.unitW, sp.unitH, 'fill="#e9eeeb" stroke="' + col + '" stroke-width="1"' + dash);
      h += text(m.offset, hy + sp.unitH / 2 - fs * 0.35, "hood · " + fmtIn(sp.unitW) + " × " + fmtIn(sp.unitH), 'text-anchor="middle" fill="#1f2a24" font-weight="700"');
    }
    /* the duct collar */
    var d = sp.duct || {}, dcx = m.offset + (num(d.fromCL) || 0), collarY = shroud ? hy + sp.unitH : hy + sp.unitH;
    if (d.size || d.dir) {
      h += rect(dcx - 2.5, collarY, 5, 6, 'fill="#dcecdf" stroke="#1b7a44" stroke-width=".4"');
      h += '<polygon points="' + sx(dcx).toFixed(2) + "," + sy(collarY + 11).toFixed(2) + " " + sx(dcx - 2).toFixed(2) + "," + sy(collarY + 8).toFixed(2) + " " + sx(dcx + 2).toFixed(2) + "," + sy(collarY + 8).toFixed(2) + '" fill="#1b7a44"/>';
      h += text(dcx - 3.5, collarY + 4, (d.size || "duct") + (d.dir ? " · " + d.dir : ""), 'text-anchor="end" fill="#1b7a44" font-weight="700" font-size="' + (fs * 0.85).toFixed(2) + '"');
    }
    h += "</g>";
    /* the readings: bottom above the surface, top to the ceiling, centre off the cooktop */
    var rx = (shroud ? m.offset - shroud.w / 2 : hxl) - 8;
    h += line(rx, m.surface, rx, hy, 'stroke="' + readCol + '" stroke-width=".5"') + line(rx - 1.5, m.surface, rx + 1.5, m.surface, 'stroke="' + readCol + '" stroke-width=".4"') + line(rx - 1.5, hy, rx + 1.5, hy, 'stroke="' + readCol + '" stroke-width=".4"');
    h += '<text x="' + sx(rx - 1.5).toFixed(2) + '" y="' + sy((m.surface + hy) / 2).toFixed(2) + '" font-size="' + fs.toFixed(2) + '" text-anchor="end" fill="' + readCol + '" font-weight="800" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2">' + (ghost ? "type the height" : fmtIn(m.bottom) + " above") + "</text>";
    if (m.ceiling != null) {
      var rx2 = (shroud ? m.offset + shroud.w / 2 : hxl + sp.unitW) + 8;
      h += line(rx2, m.top, rx2, m.ceiling, 'stroke="#1f2a24" stroke-width=".5"') + line(rx2 - 1.5, m.ceiling, rx2 + 1.5, m.ceiling, 'stroke="#1f2a24" stroke-width=".4"') + line(rx2 - 1.5, m.top, rx2 + 1.5, m.top, 'stroke="#1f2a24" stroke-width=".4"');
      h += text(rx2 - 1.5, (m.top + m.ceiling) / 2, fmtIn(Math.max(0, m.toCeiling)) + " to the ceiling", 'text-anchor="end" fill="#1f2a24" font-weight="800" font-size="' + (fs * 0.9).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
    }
    var oy = m.surface + (under === "rangetop" ? 10 : 4);
    if (Math.abs(m.offset) >= 1 / 16) {
      h += line(0, oy, m.offset, oy, 'stroke="#c8341f" stroke-width=".5"') + line(m.offset, oy - 1, m.offset, oy + 1, 'stroke="#c8341f" stroke-width=".4"') + line(0, oy - 1, 0, oy + 1, 'stroke="#c8341f" stroke-width=".4"');
      h += text(m.offset / 2, oy + fs * 0.6, fmtIn(Math.abs(m.offset)) + " off centre to the " + (m.offset > 0 ? "right" : "left"), 'text-anchor="middle" fill="#c8341f" font-weight="700" font-size="' + (fs * 0.85).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
    } else {
      h += text(0, oy + fs * 0.6, "centred on the cooktop", 'text-anchor="middle" fill="#1f9d55" font-size="' + (fs * 0.85).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
    }
    return h + "</svg>";
  }
  /* The shroud bottom seen from below: the cutout the cabinet shop made
     against the one the sheet asks for, and where the duct collar lands.
     The back wall runs across the top; forward is down the page. */
  function shroudPlanSvg(model, opts) {
    opts = opts || {};
    if (!model || !model.shroud) return "";
    var m = model, sp = m.spec, sh = m.shroud;
    var specW = sh.specW != null ? sh.specW : sp.unitW, specD = sh.specD != null ? sh.specD : sp.unitD;
    var cutW = sh.cutW, cutD = sh.cutD;
    var bodyW = Math.max(sh.w, specW + 6, cutW || 0), bodyD = Math.max(specD + 7, (cutD || 0) + 5, 18);
    var pad = 7, top = 4, W = bodyW + pad * 2, H = bodyD + top + pad + 4, fs = Math.max(1.5, W / 30);
    function sx(x) { return x + bodyW / 2 + pad; }     /* x: 0 at the centreline */
    function sy(y) { return top + y; }                   /* y: 0 at the back wall, forward is down the page */
    function rect(x0, y0, w, d, extra) { return '<rect x="' + sx(x0).toFixed(2) + '" y="' + sy(y0).toFixed(2) + '" width="' + w.toFixed(2) + '" height="' + d.toFixed(2) + '" ' + (extra || "") + "/>"; }
    function text(x, y, t, extra) { return '<text x="' + sx(x).toFixed(2) + '" y="' + sy(y).toFixed(2) + '" font-size="' + fs.toFixed(2) + '" ' + (extra || "") + ">" + t + "</text>"; }
    var h = '<svg class="sw-shroud-plan" viewBox="0 0 ' + W.toFixed(2) + " " + H.toFixed(2) + '" xmlns="http://www.w3.org/2000/svg"' + (opts.width ? ' style="width:' + opts.width + '"' : "") + ">";
    h += '<rect x="0" y="0" width="' + W.toFixed(2) + '" height="' + H.toFixed(2) + '" fill="#f8faf9"/>';
    /* the back wall across the top */
    h += '<line x1="' + sx(-bodyW / 2 - 3).toFixed(2) + '" y1="' + sy(0).toFixed(2) + '" x2="' + sx(bodyW / 2 + 3).toFixed(2) + '" y2="' + sy(0).toFixed(2) + '" stroke="#1f2a24" stroke-width=".7"/>';
    h += text(-bodyW / 2 - 2, -1.2, "back wall", 'fill="#5a646c" font-size="' + (fs * 0.8).toFixed(2) + '"');
    /* the shroud bottom */
    h += rect(-bodyW / 2, 0, bodyW, bodyD, 'fill="#efe6d6" stroke="#5a4a2e" stroke-width=".6"');
    h += text(-bodyW / 2, bodyD + fs * 1.2, "shroud bottom, seen from below · " + fmtIn(sh.w) + " wide", 'fill="#5a4a2e" font-weight="700" font-size="' + (fs * 0.8).toFixed(2) + '"');
    /* the sheet's cutout, centred, its back edge 1" off the wall (the usual clearance) */
    var back = 1;
    h += rect(-specW / 2, back, specW, specD, 'fill="none" stroke="#2f7d4f" stroke-width=".5" stroke-dasharray="1.6 1"');
    h += text(0, back + specD + fs * 1.1, "sheet: cutout " + fmtIn(specW) + " × " + fmtIn(specD), 'text-anchor="middle" fill="#12331f" font-weight="700" font-size="' + (fs * 0.85).toFixed(2) + '"');
    /* the cutout as measured */
    var cw = cutW != null ? cutW : specW, cd = cutD != null ? cutD : specD;
    if (cutW != null || cutD != null) {
      var bad = sh.cutOk === false || sh.cutDOk === false;
      h += rect(-cw / 2, back, cw, cd, 'fill="#ffffff" fill-opacity=".8" stroke="#1f2a24" stroke-width=".8"');
      h += text(0, back + cd - fs * 0.6, "cut " + (cutW != null ? fmtIn(cutW) : "?") + " × " + (cutD != null ? fmtIn(cutD) : "?") + (bad ? " — under the sheet" : " — fits the insert"), 'text-anchor="middle" fill="' + (bad ? "#c8341f" : "#1f2a24") + '" font-weight="800" font-size="' + (fs * 0.9).toFixed(2) + '"');
    } else {
      h += text(0, back + fs * 1.3, "measure the cutout: width, then depth", 'text-anchor="middle" fill="#9aa7a0" font-size="' + (fs * 0.85).toFixed(2) + '"');
    }
    /* the insert body inside the cutout, and its collar */
    h += rect(-sp.unitW / 2, back + (specD - sp.unitD) / 2, sp.unitW, sp.unitD, 'fill="none" stroke="#1f2a24" stroke-width=".35" stroke-dasharray=".8 .8"');
    var d = sp.duct || {};
    var dia = num((d.size || "").replace(/[^0-9./ ]/g, " ").trim().split(" ")[0]) || 8;
    var collarBack = num(d.fromBack), ductOff = num(opts.ductOff), ductDia = num(opts.ductDia) || dia;
    var cy = collarBack != null ? back + collarBack : back + (specD - sp.unitD) / 2 + sp.unitD * 0.4;
    var ccx = num(d.fromCL) || 0;
    h += '<circle cx="' + sx(ccx).toFixed(2) + '" cy="' + sy(cy).toFixed(2) + '" r="' + (dia / 2).toFixed(2) + '" fill="#dcecdf" stroke="#1b7a44" stroke-width=".5"/>';
    h += text(ccx, cy + dia / 2 + fs * 1.05, "collar " + (d.size || fmtIn(dia) + '"') + (collarBack != null ? " · " + fmtIn(collarBack) + " from the back" : ""), 'text-anchor="middle" fill="#1b7a44" font-weight="700" font-size="' + (fs * 0.8).toFixed(2) + '"');
    if (ductOff != null) {
      h += '<circle cx="' + sx(0).toFixed(2) + '" cy="' + sy(ductOff).toFixed(2) + '" r="' + (ductDia / 2).toFixed(2) + '" fill="none" stroke="#c8341f" stroke-width=".6" stroke-dasharray="1 .8"/>';
      h += text(0, ductOff - ductDia / 2 - fs * 0.35, "duct in the ceiling · " + fmtIn(ductOff) + " off the wall" + (collarBack != null && Math.abs(ductOff - collarBack) >= 1 ? " — " + fmtIn(Math.abs(ductOff - collarBack)) + " off the collar" : ""), 'text-anchor="middle" fill="#c8341f" font-weight="700" font-size="' + (fs * 0.8).toFixed(2) + '" paint-order="stroke" stroke="#f8faf9" stroke-width="1.2"');
    }
    return h + "</svg>";
  }
  /* an elevation point of the drawing (svg units) → inches on the wall */
  function hoodPoint(svg, x, y) {
    var minX = +svg.getAttribute("data-minx"), maxY = +svg.getAttribute("data-maxy"), pad = +svg.getAttribute("data-pad");
    return { x: x - pad + minX, y: maxY - (y - pad) };
  }
  /* which face, and where on it in inches, a point of the drawing lands;
     the nearest face to the viewer wins, and only an inside face with a
     plane name can take a pin */
  function boxHit(model, view, px, py, only) {
    var fv = boxFaces(model, view), best = null;
    if (only) {
      /* the tech chose the face: the tap lands on it even when the finger
         strays past its edge (clamped), and whichever way the box is turned */
      for (var i = 0; i < fv.faces.length; i++) {
        var fc = fv.faces[i];
        if (fc.F.plane !== only) continue;
        var lo = faceLocal(fc, px, py, fv.proj);
        /* a finger just past the edge is taken at the edge; a tap well away
           from the face is not a placement at all */
        if (!lo || lo.a < -0.15 || lo.a > 1.15 || lo.b < -0.15 || lo.b > 1.15) return null;
        var a = Math.max(0, Math.min(1, lo.a)), b = Math.max(0, Math.min(1, lo.b));
        return { plane: only, x: Math.round(a * fc.F.w * 8) / 8, y: Math.round(b * fc.F.h * 8) / 8, clamped: a !== lo.a || b !== lo.b };
      }
      return null;
    }
    fv.faces.forEach(function (face) {
      if (!face.inside) return;                      /* outlines are see-through */
      var l = faceLocal(face, px, py, fv.proj);
      if (!l || l.a < -0.001 || l.a > 1.001 || l.b < -0.001 || l.b > 1.001) return;
      var p3 = add3(add3(face.F.O, face.F.U, l.a), face.F.V, l.b), d = fv.proj(p3).depth;
      if (!best || d > best.d) best = { face: face, a: l.a, b: l.b, d: d };
    });
    if (!best || !best.face.F.plane) return null;
    var F = best.face.F;
    return { plane: F.plane, x: Math.round(best.a * F.w * 8) / 8, y: Math.round(best.b * F.h * 8) / 8 };
  }
  /* where a point on a face lands in the drawing's own units (the svg's
     viewBox less its padding) — for the tests, and for anything that wants
     to annotate the box from outside */
  function boxPoint(model, view, plane, x, y) {
    var fv = boxFaces(model, view);
    for (var i = 0; i < fv.faces.length; i++) {
      var face = fv.faces[i];
      if (face.inside && face.F.plane === plane) return facePoint(face, x, y, fv.proj);
    }
    return null;
  }
  var BOX_VIEW = { yaw: 24, pitch: 18 };
  /* The uniform box a click places on the drawing, by what the connection
     is (Cayden, 21 Oct: dragged areas "will never look good on a final
     report"). Electrical: the cover plate of the box the sheet's
     receptacle takes — a single-gang plate 2 3/4 × 4 1/2 for a 5-15R /
     5-20R / 6-20R, a two-gang or 4" square plate 4 1/2 × 4 1/2 for the
     14-30R / 14-50R / 6-50R family, a 4 × 4 junction box when it is
     hard-wired. A duct takes its own size. Null means "a point" — a stub
     or a valve is a mark, not a box. */
  function stdBox(u) {
    if (!u) return null;
    var key = String(u.base || u.key || "").replace(/\d+$/, ""), type = String(u.type || "").toLowerCase(), need = String(u.need || "").toLowerCase();
    if (key === "power") {
      if (/hard|junction|j-?box|whip|direct/.test(type + " " + need)) return { w: 4, h: 4, name: '4" junction box' };
      if (/14-30|14-50|14-60|10-30|10-50|6-50|6-30|l14|2-gang|double/.test(type + " " + need)) return { w: 4.5, h: 4.5, name: "two-gang plate" };
      return { w: 2.75, h: 4.5, name: "single-gang plate" };
    }
    if (key === "duct" || key === "vent" || key === "exhaust") {
      var m = /(\d+(?:\.\d+)?)\s*(?:"|in)?\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(type + " " + need);
      if (m) return { w: +m[2], h: +m[1], name: m[1] + " × " + m[2] + " duct" };
      var r = /(\d+(?:\.\d+)?)\s*(?:"|in|inch)?\s*(?:round|rd|dia)/.exec(type + " " + need) || /^(\d+(?:\.\d+)?)$/.exec(type);
      if (r) return { w: +r[1], h: +r[1], name: r[1] + '" duct' };
      return { w: 4, h: 4, name: "duct collar" };
    }
    return null;
  }
  /* a view that shows the inside of the named face, changing the current
     one as little as possible (the right wall needs yaw > 0, the floor
     pitch > 0, and so on) */
  function boxViewFor(view, plane) {
    var v = { yaw: view.yaw, pitch: view.pitch }, m = 8;
    if (plane === "wall-right" && v.yaw < m) v.yaw = BOX_VIEW.yaw;
    if (plane === "wall-left" && v.yaw > -m) v.yaw = -BOX_VIEW.yaw;
    if (plane === "floor" && v.pitch < m) v.pitch = BOX_VIEW.pitch;
    if (plane === "ceiling" && v.pitch > -m) v.pitch = -BOX_VIEW.pitch;
    /* a neighbour below is seen past the opening's floor only from
       underneath; one above, past its top only from above */
    if (plane === "below" && v.pitch > -m) v.pitch = -BOX_VIEW.pitch;
    if (plane === "above" && v.pitch < m) v.pitch = BOX_VIEW.pitch;
    return v;
  }

  /* The sentence under the drawing: "Power — 6"–10" from the left, 4"–8" up". */
  function roughInMarkText(m) {
    var where = m.plane === "opening" ? "" : " in the " + (PLANE_WORDS[m.plane] || m.plane);
    if (m.any) return m.label + " — anywhere" + where + ", within reach";
    if (m.strip && m.words) return m.label + " — " + m.words;
    if (m.prep) return m.label + where + " — " + fmtIn(Math.abs(m.x1 - m.x0)) + " × " + fmtIn(Math.abs(m.y1 - m.y0)) + ", " + fmtIn(Math.min(m.x0, m.x1)) + " from the left, " + fmtIn(Math.min(m.y0, m.y1)) + " up";
    if (m.kind === "point") return m.label + where + " — " + fmtIn(m.x) + " from the left, " + fmtIn(m.y) + " up";
    return m.label + where + " — " + fmtIn(Math.min(m.x0, m.x1)) + "–" + fmtIn(Math.max(m.x0, m.x1)) + " from the left, " +
      fmtIn(Math.min(m.y0, m.y1)) + "–" + fmtIn(Math.max(m.y0, m.y1)) + " up";
  }
  /* The sink cabinet, sketched: a basin hung from the top, a disposal
     under it, the dishwasher's drain hose running to it. Pure
     orientation — dashed, grey, no dimensions — so the reader sees "the
     drain goes to the disposal under the sink" without a word. Returns
     shapes in the plane's own inches (x from its left, y up); `toward`
     says which side the dishwasher is on so the hose leaves that way. */
  function sinkSketch(P, toward) {
    var bw = Math.min(P.w * 0.62, 30), bx = (P.w - bw) / 2, bd = Math.min(9, P.h * 0.25), top = P.h - 1;
    var dw = 7, dh = Math.min(12, P.h * 0.35), dx = bx + bw / 2 - dw / 2, dy = top - bd - 1 - dh;
    var hx = toward === "left" ? 0 : P.w, hy = 6;
    return {
      basin: { x: bx, y: top - bd, w: bw, h: bd },
      disposal: { x: dx, y: dy, w: dw, h: dh },
      hose: [[hx, hy], [toward === "left" ? dx : dx + dw, hy], [toward === "left" ? dx : dx + dw, dy + dh * 0.55]],
      inlet: [toward === "left" ? dx : dx + dw, dy + dh * 0.55]
    };
  }
  function roughInSvg(model, opts) {
    opts = opts || {};
    if (!model) return "";
    var P = model.planes, pad = 3;
    var show = (opts.planes || ["opening", "left", "right", "above", "below", "adjacent"]).filter(function (k) { return !!P[k]; });
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    show.forEach(function (k) {
      var p = P[k]; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h);
    });
    var W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
    /* y up in inches → y down in the picture */
    function sx(x) { return x - minX + pad; }
    function sy(y) { return maxY - y + pad; }
    var fs = Math.max(1.2, W / 34);
    var h = '<svg class="sw-roughin' + (opts.interactive ? " interactive" : "") + '" viewBox="0 0 ' + W.toFixed(2) + " " + H.toFixed(2) +
      '" xmlns="http://www.w3.org/2000/svg" data-minx="' + minX + '" data-maxy="' + maxY + '" data-pad="' + pad + '"' +
      (opts.width ? ' style="width:' + opts.width + '"' : "") + ">";
    /* the measurements laid on the opening (v0.9.85): the box keeps its own
       lines whatever the readings say */
    var notes = (opts.measure !== false && model.dims) || {};
    var noted = !!(notes.w || notes.h || notes.d);
    show.forEach(function (k) {
      var p = P[k], active = opts.active === k, isOpen = k === "opening";
      var x0 = sx(p.x), y0 = sy(p.y + p.h), x1 = x0 + p.w, y1 = y0 + p.h;
      h += '<g class="sw-ri-plane' + (isOpen ? " opening" : "") + (active ? " active" : "") + '" data-plane="' + k + '"' + (opts.interactive ? ' data-act="pkgriplane" data-v="' + k + '"' : "") + ">" +
        '<rect x="' + x0.toFixed(2) + '" y="' + y0.toFixed(2) + '" width="' + p.w.toFixed(2) + '" height="' + p.h.toFixed(2) + '"' +
        ' fill="' + (isOpen ? "#ffffff" : active ? "#eef7f1" : "#f6f8f7") + '" stroke="' + (isOpen ? "#1f2a24" : active ? "#1b7a44" : "#9aa7a0") +
        '" stroke-width="' + (isOpen ? 0.5 : 0.3) + '"' + (isOpen ? "" : ' stroke-dasharray="1.2 0.9"') + "/>";
      if (p.sink && !isOpen) {
        var sk = sinkSketch(p, p.x < 0 ? "right" : "left"), sc = "#7b8a84";
        function px(v) { return sx(p.x + v); } function py(v) { return sy(p.y + v); }
        h += '<g class="sw-ri-sink" fill="none" stroke="' + sc + '" stroke-width=".3" stroke-dasharray="1 .7">' +
          '<rect x="' + px(sk.basin.x).toFixed(2) + '" y="' + py(sk.basin.y + sk.basin.h).toFixed(2) + '" width="' + sk.basin.w.toFixed(2) + '" height="' + sk.basin.h.toFixed(2) + '" rx="1.5"/>' +
          '<rect x="' + px(sk.disposal.x).toFixed(2) + '" y="' + py(sk.disposal.y + sk.disposal.h).toFixed(2) + '" width="' + sk.disposal.w.toFixed(2) + '" height="' + sk.disposal.h.toFixed(2) + '" rx="2"/>' +
          '<polyline points="' + sk.hose.map(function (q) { return px(q[0]).toFixed(2) + "," + py(q[1]).toFixed(2); }).join(" ") + '" stroke-width=".45"/>' +
          '<circle cx="' + px(sk.inlet[0]).toFixed(2) + '" cy="' + py(sk.inlet[1]).toFixed(2) + '" r=".9" fill="#fff" stroke-dasharray="none"/>' +
          '</g><text x="' + px(sk.basin.x + sk.basin.w / 2).toFixed(2) + '" y="' + (py(sk.basin.y) - 1).toFixed(2) + '" font-size="' + (fs * 0.75).toFixed(2) + '" text-anchor="middle" fill="' + sc + '">sink</text>' +
          '<text x="' + px(sk.disposal.x + sk.disposal.w / 2).toFixed(2) + '" y="' + (py(sk.disposal.y) + fs * 0.9).toFixed(2) + '" font-size="' + (fs * 0.75).toFixed(2) + '" text-anchor="middle" fill="' + sc + '">disposer</text>' +
          '<text x="' + px((sk.hose[0][0] + sk.hose[1][0]) / 2).toFixed(2) + '" y="' + (py(6) - 0.9).toFixed(2) + '" font-size="' + (fs * 0.7).toFixed(2) + '" text-anchor="middle" fill="' + sc + '">drain hose</text>';
      }
      h += '<text x="' + (x0 + 1).toFixed(2) + '" y="' + (y0 + fs + 0.6).toFixed(2) + '" font-size="' + fs + '" fill="' + (isOpen ? "#1f2a24" : "#5b6b63") + '">' +
        (isOpen ? (noted ? "" : fmtIn(p.w) + " × " + fmtIn(p.h)) : p.label) + "</text></g>";
    });
    var anyCount = {}, anySeen = {};
    model.marks.forEach(function (m) { if (m.any && show.indexOf(m.plane) >= 0) anyCount[m.plane] = (anyCount[m.plane] || 0) + 1; });
    model.marks.forEach(function (m, i) {
      if (show.indexOf(m.plane) < 0) return;
      var p = P[m.plane], col = m.color || ZONE_COLORS[m.group] || "#c77d00";
      var tag = m.tag || (m.group || "?").charAt(0).toUpperCase();
      var sel = opts.interactive && opts.selected === m.key;
      h += '<g class="sw-ri-mark' + (sel ? " sel" : "") + '" data-mark="' + i + '" data-key="' + m.key + '"' + (opts.interactive ? ' data-act="pkgrimark" data-key="' + m.key + '"' : "") + ">";
      if (m.kind === "point") {
        var cx = sx(p.x + m.x), cy = sy(p.y + m.y);
        h += '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="' + (fs * 0.9).toFixed(2) + '" fill="' + col + '" fill-opacity=".85" stroke="#fff" stroke-width=".25"/>' +
          '<text x="' + cx.toFixed(2) + '" y="' + (cy + fs * 0.35).toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" fill="#fff" font-weight="700">' + tag + "</text>";
        if (opts.dims !== false) {
          var plx = sx(p.x), pfy = sy(p.y);
          h += '<line x1="' + plx.toFixed(2) + '" y1="' + cy.toFixed(2) + '" x2="' + cx.toFixed(2) + '" y2="' + cy.toFixed(2) + '" stroke="' + col + '" stroke-width=".2" stroke-dasharray=".6 .5"/>' +
            '<text x="' + ((plx + cx) / 2).toFixed(2) + '" y="' + (cy - 0.5).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" text-anchor="middle" fill="' + col + '">' + fmtIn(m.x) + "</text>" +
            '<line x1="' + cx.toFixed(2) + '" y1="' + pfy.toFixed(2) + '" x2="' + cx.toFixed(2) + '" y2="' + cy.toFixed(2) + '" stroke="' + col + '" stroke-width=".2" stroke-dasharray=".6 .5"/>' +
            '<text x="' + (cx + 0.5).toFixed(2) + '" y="' + ((pfy + cy) / 2).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" fill="' + col + '">' + fmtIn(m.y) + "</text>";
        }
      } else if (m.any) {
        /* the whole cabinet, lightly — once, however many connections
           share it — and the tags in a row, low when a sink is drawn */
        var ax = sx(p.x) + 0.6, ay = sy(p.y + p.h) + 0.6, aw = p.w - 1.2, ah = p.h - 1.2;
        var an = anyCount[m.plane] || 1, ai = anySeen[m.plane] = (anySeen[m.plane] || 0);
        anySeen[m.plane] = ai + 1;
        var ty = p.sink ? sy(p.y) - fs * 2.6 : ay + ah / 2 + fs * 0.35;
        var tx = ax + aw / 2 + (ai - (an - 1) / 2) * fs * 2.2;
        if (ai === 0) h += '<rect x="' + ax.toFixed(2) + '" y="' + ay.toFixed(2) + '" width="' + aw.toFixed(2) + '" height="' + ah.toFixed(2) + '" rx=".8" fill="#8a9a92" fill-opacity=".10" stroke="#8a9a92" stroke-width=".3" stroke-dasharray="1 .7"/>' +
          '<text x="' + (ax + aw / 2).toFixed(2) + '" y="' + (ty + fs * 1.25).toFixed(2) + '" font-size="' + (fs * 0.75).toFixed(2) + '" text-anchor="middle" fill="#5b6b63">anywhere in it, within reach</text>';
        h += '<circle cx="' + tx.toFixed(2) + '" cy="' + (ty - fs * 0.35).toFixed(2) + '" r="' + (fs * 0.95).toFixed(2) + '" fill="' + col + '" fill-opacity=".9" stroke="#fff" stroke-width=".3"/>' +
          '<text x="' + tx.toFixed(2) + '" y="' + ty.toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" fill="#fff" font-weight="700">' + tag + "</text>";
      } else {
        var x0 = sx(p.x + Math.min(m.x0, m.x1)), y0 = sy(p.y + Math.max(m.y0, m.y1));
        var w = Math.abs(m.x1 - m.x0), hh = Math.abs(m.y1 - m.y0);
        h += '<rect x="' + x0.toFixed(2) + '" y="' + y0.toFixed(2) + '" width="' + w.toFixed(2) + '" height="' + hh.toFixed(2) + '" fill="' + col + '" fill-opacity="' + (m.prep ? ".14" : ".28") + '" stroke="' + col + '" stroke-width=".35"' + (m.prep ? ' stroke-dasharray="1 .5"' : "") + "/>" +
          '<text x="' + (x0 + w / 2).toFixed(2) + '" y="' + (y0 + hh / 2 + fs * 0.35).toFixed(2) + '" font-size="' + fs + '" text-anchor="middle" fill="' + col + '" font-weight="700">' + tag + "</text>";
        if (opts.dims !== false) {
          /* dimension ties to the plane's left edge and floor */
          var lx = sx(p.x), fy = sy(p.y), mx0 = Math.min(m.x0, m.x1), my0 = Math.min(m.y0, m.y1);
          h += '<line x1="' + lx.toFixed(2) + '" y1="' + (y0 + hh).toFixed(2) + '" x2="' + x0.toFixed(2) + '" y2="' + (y0 + hh).toFixed(2) + '" stroke="' + col + '" stroke-width=".2" stroke-dasharray=".6 .5"/>' +
            '<text x="' + ((lx + x0) / 2).toFixed(2) + '" y="' + (y0 + hh - 0.5).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" text-anchor="middle" fill="' + col + '">' + fmtIn(mx0) + "</text>" +
            '<line x1="' + x0.toFixed(2) + '" y1="' + fy.toFixed(2) + '" x2="' + x0.toFixed(2) + '" y2="' + (y0 + hh).toFixed(2) + '" stroke="' + col + '" stroke-width=".2" stroke-dasharray=".6 .5"/>' +
            '<text x="' + (x0 + 0.5).toFixed(2) + '" y="' + ((fy + y0 + hh) / 2).toFixed(2) + '" font-size="' + (fs * 0.8).toFixed(2) + '" fill="' + col + '">' + fmtIn(my0) + "</text>";
        }
        if (sel) {
          /* the handles: white bubbles on the corners, like a photo
             editor's — drag one to resize, the box itself to move */
          var hr = Math.max(0.9, fs * 0.55);
          [["nw", x0, y0], ["ne", x0 + w, y0], ["sw", x0, y0 + hh], ["se", x0 + w, y0 + hh]].forEach(function (c) {
            h += '<circle class="sw-ri-handle" data-handle="' + c[0] + '" data-key="' + m.key + '" cx="' + c[1].toFixed(2) + '" cy="' + c[2].toFixed(2) + '" r="' + hr.toFixed(2) + '" fill="#fff" stroke="#1f2a24" stroke-width=".35"/>';
          });
        }
      }
      if (sel && m.kind === "point") {
        h += '<circle class="sw-ri-handle" data-handle="pt" data-key="' + m.key + '" cx="' + sx(p.x + m.x).toFixed(2) + '" cy="' + sy(p.y + m.y).toFixed(2) + '" r="' + (fs * 1.3).toFixed(2) + '" fill="none" stroke="#1f2a24" stroke-width=".35" stroke-dasharray=".8 .6"/>';
      }
      h += "</g>";
    });
    /* the walk's pins: a dot with the label, red when the tech said it is
       missing or in the wrong place or it sits outside the drawn area */
    (opts.pins === false ? [] : (model.pins || [])).forEach(function (pn) {
      if (show.indexOf(pn.plane) < 0 || !P[pn.plane]) return;      /* a floor or side-wall pin lives on the box, not the elevation */
      var p = P[pn.plane], cx = sx(p.x + pn.x), cy = sy(p.y + pn.y), col = pn.bad ? "#c8341f" : "#16713a";
      var live = opts.activePin === pn.key;
      h += '<g class="sw-ri-pin' + (live ? " on" : "") + '" data-key="' + pn.key + '">' +
        '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="' + (fs * (live ? 1.1 : 0.85)).toFixed(2) + '" fill="' + col + '" stroke="#fff" stroke-width=".35"/>' +
        '<text x="' + cx.toFixed(2) + '" y="' + (cy - fs * 1.3).toFixed(2) + '" font-size="' + (fs * 0.85).toFixed(2) + '" text-anchor="middle" fill="' + col + '" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width=".5">' + pn.label + "</text></g>";
    });
    /* The measurements, last so they sit over everything: width on a line
       across the top of the opening, height on a line down its left side,
       depth as a label of its own (an elevation has no edge for it). Each
       is plain when the reading is good and red when it misses — the line
       and the label, never the box. */
    if (noted && P.opening && show.indexOf("opening") >= 0) {
      var O = P.opening, ox0 = sx(O.x), oy0 = sy(O.y + O.h), ox1 = ox0 + O.w, oy1 = oy0 + O.h;
      /* type sized to the opening it sits in, so a 24" opening between two
         cabinets is not buried under its own labels */
      var fd = Math.max(W, H) / 34;
      if (notes.w) fd = Math.min(fd, O.w * 0.8 / dimPillSize(notes.w, 1).w);
      if (notes.h) fd = Math.min(fd, O.h * 0.9 / dimPillSize(notes.h, 1).w, O.w * 0.2 / dimPillSize(notes.h, 1).h);
      if (notes.d) fd = Math.min(fd, O.w * 0.6 / dimPillSize(notes.d, 1).w);
      fd = Math.max(0.8, fd);
      var inX = Math.min(fd * 2.1, O.w * 0.14), inY = Math.min(fd * 2.1, O.h * 0.14), tk = fd * 0.5, lw = (fd * 0.1).toFixed(2);
      var taken = [];
      var dline = function (xa, ya, xb, yb, ink, dash) {
        var vert = Math.abs(xa - xb) < 1e-6;
        return '<line class="sw-dim-line" x1="' + xa.toFixed(2) + '" y1="' + ya.toFixed(2) + '" x2="' + xb.toFixed(2) + '" y2="' + yb.toFixed(2) + '" stroke="' + ink + '" stroke-width="' + lw + '"' + (dash ? ' stroke-dasharray="' + (fd * 0.6).toFixed(2) + " " + (fd * 0.45).toFixed(2) + '"' : "") + "/>" +
          [[xa, ya], [xb, yb]].map(function (q) {
            return vert ? '<line x1="' + (q[0] - tk).toFixed(2) + '" y1="' + q[1].toFixed(2) + '" x2="' + (q[0] + tk).toFixed(2) + '" y2="' + q[1].toFixed(2) + '" stroke="' + ink + '" stroke-width="' + lw + '"/>'
                        : '<line x1="' + q[0].toFixed(2) + '" y1="' + (q[1] - tk).toFixed(2) + '" x2="' + q[0].toFixed(2) + '" y2="' + (q[1] + tk).toFixed(2) + '" stroke="' + ink + '" stroke-width="' + lw + '"/>';
          }).join("");
      };
      h += '<g class="sw-dims" pointer-events="none">';
      if (notes.w) {
        var wy = oy0 + inY, wsz = dimPillSize(notes.w, fd);
        h += dline(ox0, wy, ox1, wy, dimInk(notes.w), notes.w.state === "none") + dimPill(notes.w, (ox0 + ox1) / 2, wy, fd);
        taken.push([(ox0 + ox1) / 2 - wsz.w / 2, wy - wsz.h / 2, wsz.w, wsz.h]);
      }
      if (notes.h) {
        var hx = ox0 + inX, hsz = dimPillSize(notes.h, fd);
        h += dline(hx, oy0, hx, oy1, dimInk(notes.h), notes.h.state === "none") + dimPill(notes.h, hx, (oy0 + oy1) / 2, fd, -90);
        taken.push([hx - hsz.h / 2, (oy0 + oy1) / 2 - hsz.w / 2, hsz.h, hsz.w]);
      }
      if (notes.d) {
        /* the first corner of the opening that is clear of the connections
           drawn on it and of the two labels above */
        var dsz = dimPillSize(notes.d, fd), gap = fd * 0.7;
        model.marks.forEach(function (m) {
          if (m.plane !== "opening" || m.any) return;
          if (m.kind === "point") taken.push([sx(O.x + m.x) - fs, sy(O.y + m.y) - fs, fs * 2, fs * 2]);
          else taken.push([sx(O.x + Math.min(m.x0, m.x1)), sy(O.y + Math.max(m.y0, m.y1)), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)]);
        });
        var dl = ox0 + (notes.h ? inX + fd * 1.5 : 0) + gap + dsz.w / 2, dr = ox1 - gap - dsz.w / 2;
        var dt = oy0 + (notes.w ? inY + fd * 1.4 : 0) + gap + dsz.h / 2, db = oy1 - gap - dsz.h / 2;
        var spots = [[dr, dt], [dr, db], [dl, db], [(dl + dr) / 2, db], [(dl + dr) / 2, (dt + db) / 2], [dr, (dt + db) / 2]];
        var spot = spots.filter(function (q) {
          return !taken.some(function (t) { return q[0] - dsz.w / 2 < t[0] + t[2] && q[0] + dsz.w / 2 > t[0] && q[1] - dsz.h / 2 < t[1] + t[3] && q[1] + dsz.h / 2 > t[1]; });
        })[0] || spots[0];
        h += dimPill(notes.d, Math.max(dsz.w / 2 + 0.3, Math.min(W - dsz.w / 2 - 0.3, spot[0])), spot[1], fd);
      }
      h += "</g>";
    }
    h += '<g class="sw-ri-live"></g></svg>';
    return h;
  }

  /* ---------- the panel basis -------------------------------------------
     Cayden, 26 Oct: "Can we have panel stuff have a built in rule? Or a flag
     that passes through into the report that basically says cleats measure
     perfect here, assuming 3/4" panel thickness. We need to cascade this
     panel logic to all panel related appliances."
     Every panel-ready detail says what panel its numbers assume
     (`variation.panelRule`): the thickness (`assumedIn`), what the model
     allows (`minIn`/`maxIn`), and — where the panel face sits flush with
     the cabinet faces — the body depth behind it (`unitDepthIn`). The job's
     own panel (`it.panelThicknessIn`, from the office or the tech) moves
     what depends on it: a strip marked `panelShift` slides back by the
     difference (the Classic flush cleat is 2 3/16" back for a 3/4" panel,
     2 7/16" for a 1" one), and the depth the opening needs grows with it.
     A panel-ready model with no rule from the sheet takes Wilson's standard
     3/4" and says so. */
  function panelRuleOf(it) {
    if (!isPanelReady(it)) return null;
    var v = itemVariation(it), e = itemEntry(it);
    var r = (v && v.panelRule) || (e && e.panelRule) || null;
    if (r) return Object.assign({ source: "sheet" }, r);
    return { assumedIn: 0.75, source: "wilson" };
  }
  function panelBasis(it) {
    var r = panelRuleOf(it);
    if (!r) return null;
    var t = panelThickness(it), assumed = r.assumedIn != null ? r.assumedIn : 0.75;
    var used = t != null ? t : assumed;
    return {
      assumed: assumed, actual: t, used: used, delta: used - assumed, confirmed: t != null, source: r.source, page: r.page || "",
      min: r.minIn != null ? r.minIn : null, max: r.maxIn != null ? r.maxIn : null,
      inRange: t == null || ((r.minIn == null || t >= r.minIn - 1e-9) && (r.maxIn == null || t <= r.maxIn + 1e-9)),
      unitDepth: r.unitDepthIn != null ? r.unitDepthIn : null,
      depthNeed: r.unitDepthIn != null && r.faceFlush ? r.unitDepthIn + used : null
    };
  }
  function panelRangeText(b) {
    if (!b) return "";
    if (b.min != null && b.max != null) return b.min === b.max ? fmtIn(b.min) : fmtIn(b.min) + "–" + fmtIn(b.max);
    if (b.min != null) return fmtIn(b.min) + " min";
    if (b.max != null) return fmtIn(b.max) + " max";
    return "";
  }
  /* how far a strip's number moves for this job's panel */
  function panelShift(it, pr, field) {
    if (!it || !pr || !pr.strip || pr.strip.panelShift !== field) return 0;
    var b = panelBasis(it);
    return b ? b.delta : 0;
  }
  function stripTarget(it, pr, k) {
    var n = num(stripOf(pr)[k]);
    return n == null ? null : n + panelShift(it, pr, k);
  }
  function panelShifts(it) {
    return (it.prep || []).some(function (pr) { return isStrip(pr) && pr.strip.panelShift; });
  }
  /* The sentence the packet and the phone print: what the cleats and depth
     were checked for, and what this job's panel does to them. */
  function panelBasisText(it) {
    var b = panelBasis(it);
    if (!b) return "";
    var shifts = panelShifts(it), what = shifts ? "Cleats" + (b.depthNeed != null ? " and depth" : "") : b.depthNeed != null ? "Depth" : "";
    var basis = fmtIn(b.assumed) + " panel" + (b.source === "wilson" ? " (Wilson's standard — the sheet does not say)" : " — the thickness the sheet assumes");
    if (!b.confirmed) {
      return (what ? what + (what === "Depth" ? " is" : " are") + " checked assuming a " : "Panel assumed to be ") + basis + "." +
        (shifts ? " A different panel moves the cleats by the difference — confirm the thickness before they are built." : "");
    }
    if (Math.abs(b.delta) < 1e-9) return (what ? what + (what === "Depth" ? " is" : " are") + " checked for this job's " : "This job's panel is ") + fmtIn(b.actual) + " panel" + (what ? ", the thickness the sheet assumes." : ", the thickness the sheet assumes.");
    var moved = (it.prep || []).filter(function (pr) { return isStrip(pr) && pr.strip.panelShift; }).map(function (pr) {
      var k = pr.strip.panelShift, t = stripTarget(it, pr, k);
      return (pr.label || prepKind(pr.kind).label).toLowerCase() + " " + (k === "setbackIn" ? "starts " + fmtIn(t) + " back from the face" : fmtIn(t) + " deep");
    });
    return "This job's panel is " + fmtIn(b.actual) + "; the sheet's numbers assume " + fmtIn(b.assumed) + ", so " +
      (moved.length ? "everything moves " + fmtIn(Math.abs(b.delta)) + (b.delta > 0 ? " back" : " forward") + ": " + moved.join(", ") : "the depth it needs changes") +
      (b.depthNeed != null ? "; the opening needs " + fmtIn(b.depthNeed) + " deep for the panel to sit flush" : "") + ".";
  }
  /* The panel against the model and the opening: too thick or thin for the
     model, an opening too shallow for this panel to sit flush, and — when a
     custom panel's thickness is unknown and cleats depend on it — one
     question for the cabinet shop. */
  function panelBasisFindings(it) {
    var b = panelBasis(it), out = [];
    if (!b) return out;
    var who = it.panelBy === "custom" ? "cabinet" : it.panelBy === "wilson" ? "internal" : "sales";
    if (b.confirmed && !b.inRange) {
      out.push({ key: "pbasis:range", kind: "fix", owner: who, label: "Panel thickness out of range",
        text: "The panel is " + fmtIn(b.actual) + " thick; this model takes " + panelRangeText(b) + (b.page ? " (" + b.page + ")" : "") + ". Make the panel within that range." });
    }
    var d = num(it.actual && it.actual.d);
    if (b.depthNeed != null && d != null && b.confirmed && d < b.depthNeed - 1 / 16) {
      var vd = verdict(it, "d");
      if (vd.state !== "bad") {
        out.push({ key: "pbasis:depth", kind: "fix", owner: "cabinet", label: "Opening too shallow for this panel",
          text: "The opening is " + fmtIn(d) + " deep; the " + fmtIn(b.unitDepth) + " unit with its " + fmtIn(b.actual) + " panel needs " + fmtIn(b.depthNeed) +
            " for the panel to sit flush with the cabinet faces. Deepen the opening " + fmtIn(b.depthNeed - d) + "." });
      }
    }
    if (!b.confirmed && panelShifts(it)) {
      if (it.panelBy === "custom") {
        out.push({ key: "pbasis:confirm", kind: "question", owner: "cabinet", label: "Custom panel thickness",
          text: "Confirm the custom panel thickness. The cleats were checked for a " + fmtIn(b.assumed) + " panel; a thicker panel moves them back by the difference." });
      } else if (it.panelBy === "wilson") {
        out.push({ key: "pbasis:confirm", kind: "note", owner: "wilson", label: "Panel thickness",
          text: "Order the panels at " + fmtIn(b.assumed) + " — the cleats were checked for it." });
      }
    }
    return out;
  }
  function panelText(it) {
    var p = panelSpec(it);
    if (!p) return "";
    var bits = [];
    if (p.width && p.height) bits.push(fmtIn(num(p.width)) + " W × " + fmtIn(num(p.height)) + " H");
    else if (p.sizes) bits.push(p.sizes);          /* several panels on one unit, W × H each, from the sheet's table */
    if (p.thickness) bits.push(p.thickness);
    if (p.weight) bits.push(p.weight);
    return bits.join(", ");
  }
  /* A panel-ready model whose variation carries no panel dimensions is a
     hole in the library, not a unit without a panel. Saying so out loud
     beats printing a blank where a builder expects a number. */
  function panelSpecMissing(it) { return isPanelReady(it) && !panelSpec(it); }
  function panelAnswered(it) {
    if (!isPanelReady(it)) return true;
    if (!it.panelBy) return false;
    if (it.panelBy !== "custom") return true;
    return !!it.panelState;
  }
  function panelFindings(it) {
    if (!isPanelReady(it) || it.panelBy !== "custom") return [];
    var spec = panelText(it), p = panelSpec(it);
    var where = p && p.page ? " (spec package " + p.page + ")" : "";
    if (it.panelState === "absent") {
      return [{
        label: "Custom panel not on site",
        detail: "The custom panel was not on site at the walk. Confirm it is built to " +
          (spec || "the panel specification") + where + " with the handle pulls installed, and notify " +
          "Wilson AC & Appliance before the delivery is scheduled."
      }];
    }
    if (it.panelState === "onsite-wrong") {
      return [{
        label: "Custom panel does not meet spec",
        detail: "The custom panel on site does not meet " + (spec || "the panel specification") + where +
          ". Correct it before delivery." +
          (it.panelPulls === "no" ? " Handle pulls are also not installed." : "")
      }];
    }
    if (it.panelState === "verified" && it.panelPulls === "no") {
      return [{
        label: "Handle pulls not installed",
        detail: "The custom panel is to spec but the handle pulls are not installed. " +
          "They must be on before the appliance is set."
      }];
    }
    return [];
  }

  /* =====================================================================
     PANELS, MEASURED
     ---------------------------------------------------------------------
     "dw panel dimensions: 30 1/4 tall by 24 wide → reduce panel width to
     23 3/4." "top grill 8 3/16 by 47 15/16 → needs to be reduced to 7 3/4
     tall." "Re-level the right side panel front to back." Hudson measures
     panels the way he measures openings, and one fridge can carry three of
     them. A three-way "on site / not right / absent" cannot say which
     panel, by how much, or what to cut it to. */
  var PANEL_LABELS = ["Door", "Left door", "Right door", "Top grill", "Drawer", "Freezer drawer", "Kick plate", "Side panel", "Other"];
  var PANEL_PLANES = [
    { k: "ok", label: "Sits flat and true", tone: "good" },
    { k: "bowed", label: "Bows in the middle", tone: "poor" },
    { k: "unlevel", label: "Out of plumb / level", tone: "poor" }
  ];
  function normPanel(p) {
    p = p || {};
    return { id: p.id || uid("pnl"), label: p.label || "Door", w: p.w || "", h: p.h || "",
      targetW: p.targetW || "", targetH: p.targetH || "", plane: p.plane || "", note: p.note || "" };
  }
  function addPanel(it, label) {
    var spec = panelSpec(it);
    var p = normPanel({ label: label || "Door",
      targetW: spec && spec.width ? String(spec.width).replace(/"/g, "") : "",
      targetH: spec && spec.height ? String(spec.height).replace(/"/g, "") : "" });
    it.panels = it.panels || [];
    it.panels.push(p);
    return p;
  }
  function removePanel(it, id) {
    it.panels = (it.panels || []).filter(function (p) { return p.id !== id; });
  }
  var PANEL_TOL = 1 / 16;
  /* A panel's own verdicts: size against its target, and its plane. */
  function panelVerdicts(p) {
    var out = [];
    ["w", "h"].forEach(function (k) {
      var act = num(p[k]), tgt = num(p[k === "w" ? "targetW" : "targetH"]);
      if (act == null || tgt == null) return;
      var d = act - tgt;
      if (Math.abs(d) <= PANEL_TOL) return;
      out.push({ k: k, d: d, act: act, tgt: tgt,
        fix: (d > 0 ? "Cut the " : "Remake the ") + p.label.toLowerCase() + " panel to " + fmtIn(tgt) + (k === "w" ? " wide" : " tall") +
          " — it measures " + fmtIn(act) + ", " + fmtIn(Math.abs(d)) + (d > 0 ? " over." : " short.") });
    });
    if (p.plane === "bowed") out.push({ k: "plane", fix: "Relevel the " + p.label.toLowerCase() + " panel — it bows in the middle — for even reveals." });
    if (p.plane === "unlevel") out.push({ k: "plane", fix: "Relevel the " + p.label.toLowerCase() + " panel front to back and side to side for even reveals." });
    return out;
  }
  function panelMeasuredFindings(it) {
    var out = [];
    (it.panels || []).forEach(function (p) {
      panelVerdicts(p).forEach(function (v) {
        out.push({ label: p.label + " panel", detail: v.fix, panelId: p.id, k: v.k });
      });
    });
    return out;
  }
  function panelsMeasured(it) { return !!(it.panels && it.panels.length); }

  /* =====================================================================
     UTILITY TYPE — what is actually there, against what the spec asks for
     ---------------------------------------------------------------------
     "nema 14-30R outlet" where a 14-50R is wanted. "three prong 240 outlet"
     — "change to nema 1450R." The spec library already carries the
     requirement in `need`; the field could only say whether SOMETHING was
     there. Right receptacle vs wrong receptacle is the most consequential
     mismatch in appliance install, and it could not be recorded. */
  var UTIL_TYPES = {
    power: [
      { k: "5-15R",   label: "NEMA 5-15R · 120 V 15 A" },
      { k: "5-20R",   label: "NEMA 5-20R · 120 V 20 A" },
      { k: "6-20R",   label: "NEMA 6-20R · 240 V 20 A" },
      { k: "6-50R",   label: "NEMA 6-50R · 240 V 50 A" },
      { k: "14-30R",  label: "NEMA 14-30R · dryer" },
      { k: "14-50R",  label: "NEMA 14-50R · range" },
      { k: "10-30R",  label: "3-prong 240 · 10-30R" },
      { k: "10-50R",  label: "3-prong 240 · 10-50R" },
      { k: "jbox-1",  label: "Junction box · single gang" },
      { k: "jbox-2",  label: "Junction box · double gang" },
      { k: "romex",   label: "Romex only" }
    ],
    water: [
      { k: "1/4-T",   label: '1/4" T-valve' },
      { k: "3/8-T",   label: '3/8" T-valve' },
      { k: "1/2",     label: '1/2" valve' },
      { k: "box",     label: "Water box" },
      { k: "stub",    label: "Stub, no shutoff" }
    ],
    drain: [
      { k: "disposer",  label: "Disposer with a dishwasher inlet" },
      { k: "tailpiece", label: "Branch tailpiece under the sink" },
      { k: "standpipe", label: "Standpipe / its own drain" },
      { k: "airgap",    label: "Air gap on the counter" },
      { k: "floor",     label: "Floor drain" },
      { k: "pump",      label: "Pump to a remote drain" }
    ],
    vent: [
      { k: "6-round",  label: '6" round' },
      { k: "7-round",  label: '7" round' },
      { k: "8-round",  label: '8" round' },
      { k: "10-round", label: '10" round' },
      { k: "3x10",     label: "3 1/4 × 10 rect" },
      { k: "4-dryer",  label: '4" dryer duct' },
      { k: "recirc",   label: "Recirculating" }
    ],
    gas: [
      { k: "1/2-shutoff", label: '1/2" pipe with shutoff' },
      { k: "3/4-shutoff", label: '3/4" pipe with shutoff' },
      { k: "no-shutoff",  label: "Pipe, no shutoff" }
    ]
  };
  function utilTypeGroup(u) {
    var k = utilBase(u);
    if (k === "power") return "power";
    if (k === "water") return "water";
    if (k === "drain") return "drain";
    if (k === "gas") return "gas";
    if (k === "vent") return "vent";
    return "";
  }
  function utilTypesFor(u) { return UTIL_TYPES[utilTypeGroup(u)] || []; }
  /* The type the spec calls for, read off its `need` text. NEMA first,
     then valve sizes. Nothing invented: no match means no requirement. */
  /* What the category nearly always has when the sheet does not say —
     a dishwasher's drain hose goes to the disposer 98 times in 100
     (Cayden, 23 Oct); the sheet only describes the hose. */
  function usualUtilType(u, it) {
    if (!it || !u) return "";
    var k = kindOf(it), g = utilTypeGroup(u);
    if (k === "dishwasher") {
      if (g === "drain") return "disposer";
      if (g === "water") return "3/8-T";
      if (g === "power") return "5-15R";
    }
    if ((k === "refrigeration" || k === "ice") && g === "water") return "1/4-T";
    return "";
  }
  function requiredUtilType(u, it) {
    var fromSheet = requiredFromSheet(u);
    return fromSheet || usualUtilType(u, it);
  }
  /* true when the type on the card is the category's usual, not the sheet's */
  function requiredIsUsual(u, it) { return !requiredFromSheet(u) && !!usualUtilType(u, it); }
  function requiredFromSheet(u) {
    if (u && u.type) return u.type;        /* tapped at the desk off the sheet */
    var need = (u && u.need) || "";
    var m = need.match(/NEMA\s*(\d{1,2}-\d{2})\s*R?/i);
    if (m) return m[1] + "R";
    /* a sheet that allows either — "power cord included, or hard-wire to a
       junction box" (Bosch, KitchenAid dishwashers) — sets no type: a
       receptacle and a J-box are both right (v0.9.75) */
    var hard = /hardwire|hard-wire|hard wire|junction|j-box|jbox|direct[- ]wire/i.test(need);
    if (utilTypeGroup(u) === "power" && hard && /cord|plug/i.test(need)) return "";
    if (hard && !/direct[- ]wire/i.test(need) || /hardwire|hard-wire|junction|j-box|jbox/i.test(need)) return /double|2-gang|two gang/i.test(need) ? "jbox-2" : "jbox-1";
    if (utilTypeGroup(u) === "power") {
      /* "15 A or 20 A" leaves the receptacle open too */
      if (/\b15\s*(?:A|amps?)?\s*(?:or|\/)\s*20\s*A/i.test(need)) return "";
      /* Voltage and amperage name the receptacle by code — a 115/120 V 15 A
         circuit lands on a 5-15R, a 20 A one on a 5-20R. 240 V is only
         inferred when the spec says "receptacle" (ranges and dryers), since
         cooktops and ovens at 240 V are as often hardwired. */
      var v = need.match(/\b(1[12][05]|2[024]0|208)\s*V/i), a = need.match(/\b(15|20|30|40|50)\s*A(?:mp)?s?\b/i);
      if (v && a) {
        var volts = parseInt(v[1], 10), amps = parseInt(a[1], 10);
        if (volts < 200) return amps === 20 ? "5-20R" : "5-15R";
        if (/receptacle|outlet|plug/i.test(need)) {
          if (amps === 30) return "14-30R";
          if (amps >= 40) return "14-50R";
          if (amps === 20) return "6-20R";
        }
      }
    }
    if (utilTypeGroup(u) === "water") {
      if (/1\/4/.test(need)) return "1/4-T";
      if (/3\/8/.test(need)) return "3/8-T";
      if (/1\/2/.test(need)) return "1/2";
    }
    if (utilTypeGroup(u) === "drain" && /3\/4|tail/i.test(need)) return "tailpiece";
    if (utilTypeGroup(u) === "gas") {
      if (/3\/4/.test(need)) return "3/4-shutoff";
      if (/1\/2/.test(need)) return "1/2-shutoff";
    }
    if (utilTypeGroup(u) === "vent") {
      var r = /\b(6|7|8|10)\s*(?:"|in(?:ch)?)?\s*round/i.exec(need);
      if (r) return r[1] + "-round";
      if (/3\s*1\/4/.test(need)) return "3x10";
      if (/dryer|4\s*"/i.test(need)) return "4-dryer";
      if (/recirc/i.test(need)) return "recirc";
    }
    return "";
  }
  function utilTypeLabel(u, k) {
    var t = utilTypesFor(u).filter(function (x) { return x.k === k; })[0];
    return t ? t.label : k;
  }
  function utilTypeOf(it, u) { return (it.utilTypes && it.utilTypes[u.key]) || ""; }
  function setUtilType(it, u, k) { it.utilTypes = it.utilTypes || {}; it.utilTypes[u.key] = k || ""; }
  /* A recorded type that is not the required type is a correction of its
     own — the outlet is there, in the right place, and still wrong. */
  function utilTypeFix(it, u) {
    var have = utilTypeOf(it, u), want = requiredUtilType(u, it);
    if (!have || !want || have === want) return "";
    if (have === "romex") return "";        /* romex is "roughed in", handled there */
    var g = utilTypeGroup(u);
    if (g === "power") return "Change the receptacle from " + utilTypeLabel(u, have) + " to " + utilTypeLabel(u, want) + " — the spec calls for it.";
    if (g === "water") return "Change the water connection from " + utilTypeLabel(u, have) + " to " + utilTypeLabel(u, want) + " — the spec calls for it.";
    if (g === "drain") return "Change the drain from " + utilTypeLabel(u, have) + " to " + utilTypeLabel(u, want) + ".";
    return "";
  }

  /* ---------------------------------------------------------------------
     The short list (v0.9.59). Thirty spec books across six categories say
     a category only ever uses two to four connection types: a fridge is a
     5-15R, a range is a 14-50R or hardwired, a dryer is a 14-30R or the
     old 10-30R. The full list stays (nothing an old walk recorded is
     lost) but the field sees the category's own types first and "Other…"
     for the rest (Cayden, 22 Oct: "default to what the tool reads from
     the spec book"). */
  function kindOf(it) {
    var e = itemEntry(it);
    var words = [(e && e.category), (e && e.appliance), it && it.category, it && it.appliance, it && it.model].filter(Boolean).join(" ").toLowerCase();
    if (/dishwasher|\bdw\b/.test(words)) return "dishwasher";
    if (HOODISH_RE.test(words)) return "hood";
    if (/washer|dryer|laundry|washtower/.test(words)) return "laundry";
    if (/grill/.test(words)) return "grill";
    /* an outdoor fridge or ice maker is still refrigeration — "outdoor"
       alone only means a grill when nothing else says what it is */
    if (/\bice\b|icemaker|ice maker|nugget/.test(words)) return "ice";
    if (/range\b|rangetop|range top|cooktop|stove/.test(words)) return "cooking";
    if (/oven|warming|steam|speed|microwave|coffee|espresso/.test(words)) return "oven";
    if (/refrigerat|fridge|freezer|column|beverage|wine|undercounter|drawer/.test(words)) return "refrigeration";
    if (/outdoor/.test(words)) return "grill";
    return "other";
  }
  var SHORT_TYPES = {
    power: {
      cooking: ["14-50R", "6-50R", "jbox-1", "14-30R", "6-20R", "5-15R", "5-20R"],
      oven: ["jbox-1", "14-30R", "5-20R", "5-15R", "6-20R"],
      refrigeration: ["5-15R", "5-20R", "jbox-1"], ice: ["5-15R", "5-20R"], dishwasher: ["5-15R", "5-20R", "jbox-1"],
      laundry: ["14-30R", "10-30R", "5-15R", "5-20R"], hood: ["5-15R", "jbox-1"], grill: ["5-15R", "5-20R"],
      other: ["5-15R", "5-20R", "jbox-1", "14-50R", "14-30R"]
    },
    water: {
      refrigeration: ["1/4-T", "box", "stub"], ice: ["1/4-T", "box", "stub"], dishwasher: ["3/8-T", "stub", "1/2"],
      laundry: ["box", "stub", "1/2"], oven: ["1/4-T", "3/8-T"], other: ["1/4-T", "3/8-T", "box", "stub"]
    },
    drain: {
      dishwasher: ["disposer", "tailpiece", "airgap", "standpipe"], ice: ["floor", "standpipe", "airgap", "pump"],
      refrigeration: ["floor", "standpipe", "pump"], laundry: ["standpipe", "floor"], other: ["tailpiece", "standpipe", "floor", "disposer"]
    },
    vent: { hood: ["6-round", "8-round", "10-round", "3x10", "7-round", "recirc"], laundry: ["4-dryer"], other: ["4-dryer", "6-round", "8-round"] },
    gas: { other: ["3/4-shutoff", "1/2-shutoff", "no-shutoff"] }
  };
  function utilTypesShort(it, u) {
    var g = utilTypeGroup(u), all = utilTypesFor(u);
    if (!all.length) return all;
    var table = SHORT_TYPES[g] || {}, keys = table[kindOf(it)] || table.other || [];
    var want = requiredUtilType(u, it), have = utilTypeOf(it, u);
    if (want) keys = [want].concat(keys.filter(function (k) { return k !== want; }));
    if (have && keys.indexOf(have) < 0) keys = keys.concat([have]);
    return keys.map(function (k) { return all.filter(function (t) { return t.k === k; })[0]; }).filter(Boolean);
  }

  /* The details the spec books ask about that no chip carried: GFCI,
     a dedicated circuit, natural gas or propane, a shutoff you can reach
     with the unit in, a stub that projects into the unit. Yes/no each,
     behind "More…", printed only when answered. */
  var UTIL_FLAGS = {
    power: [
      { k: "gfci", q: "GFCI protected?", yes: "GFCI", no: "not GFCI" },
      { k: "dedicated", q: "Dedicated circuit?", yes: "dedicated circuit", no: "shared circuit", bad: "no", fix: "Put the receptacle on its own dedicated circuit — the spec calls for it." }
    ],
    gas: [
      { k: "fuel", q: "Fuel", opts: [["ng", "Natural gas"], ["lp", "Propane"]] },
      { k: "reach", q: "Shutoff reachable with the unit in?", yes: "shutoff reachable", no: "shutoff not reachable", bad: "no", fix: "Move the gas shutoff where it can be reached with the unit in place." },
      { k: "proj", q: "Stub projects 2\" or less from the wall?", yes: "stub ≤ 2\"", no: "stub projects past 2\"", bad: "no", fix: "Cut the gas stub back so it projects no more than 2\" from the wall, with a 90° elbow." }
    ],
    water: [
      { k: "temp", q: "Supply", opts: [["hot", "Hot"], ["cold", "Cold"], ["both", "Hot & cold"]] },
      { k: "shut", q: "Shutoff you can reach?", yes: "shutoff accessible", no: "no accessible shutoff", bad: "no", fix: "Add an accessible shutoff on the water supply." }
    ],
    drain: [
      { k: "high", q: "Connection within 20\"–43\" of the floor?", yes: "drain height in range", no: "drain height out of range", bad: "no", fix: "Bring the drain connection to 20\"–43\" above the floor (or an air gap per code)." }
    ],
    vent: [
      { k: "rigid", q: "Rigid metal duct?", yes: "rigid metal duct", no: "flex or plastic duct", bad: "no", fix: "Replace the duct run with rigid metal — flex and plastic are not allowed." },
      { k: "exit", q: "Duct leaves the cabinet", opts: [["back", "Out the back"], ["top", "Up"], ["side", "Sideways"], ["down", "Down"]] }
    ]
  };
  function utilFlagsFor(u) { return UTIL_FLAGS[utilTypeGroup(u)] || []; }
  function utilFlag(it, u, k) { return (it.utilFlags && it.utilFlags[u.key] && it.utilFlags[u.key][k]) || ""; }
  function setUtilFlag(it, u, k, v) {
    it.utilFlags = it.utilFlags || {}; it.utilFlags[u.key] = it.utilFlags[u.key] || {};
    if (!v) delete it.utilFlags[u.key][k]; else it.utilFlags[u.key][k] = v;
  }
  /* the answered flags as words — "GFCI, dedicated circuit" — for the packet */
  function utilFlagText(it, u) {
    return utilFlagsFor(u).map(function (f) {
      var v = utilFlag(it, u, f.k);
      if (!v) return "";
      if (f.opts) { var o = f.opts.filter(function (x) { return x[0] === v; })[0]; return o ? o[1].toLowerCase() : ""; }
      return v === "yes" ? f.yes : f.no;
    }).filter(Boolean).join(", ");
  }
  function utilFlagFixes(it, u) {
    return utilFlagsFor(u).filter(function (f) { return f.bad && utilFlag(it, u, f.k) === f.bad; }).map(function (f) { return f.fix; });
  }

  /* ---------------------------------------------------------------------
     Small generic renderings of what a connection looks like: the face of
     a NEMA receptacle, a valve, a drain, a duct collar. Not any maker's
     drawing — the slots as code lays them out, so the tech can glance from
     the phone to the wall and say yes or no. */
  function plugSvg(k, size) {
    size = size || 56;
    var g = "", face = '<rect x="6" y="4" width="44" height="48" rx="6" fill="#f4efe6" stroke="#7a7266" stroke-width="1.5"/>';
    var slot = function (x, y, w, h) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="1" fill="#2b2822"/>'; };
    var ground = function (cx, cy, r) { return '<path d="M' + (cx - r) + ' ' + (cy - r * 0.6) + ' v' + r * 0.6 + ' a' + r + ' ' + r + ' 0 0 0 ' + (2 * r) + ' 0 v-' + r * 0.6 + ' z" fill="#2b2822"/>'; };
    var round = function (cx, cy, r) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#2b2822"/>'; };
    var circle = '<circle cx="28" cy="28" r="18" fill="#fbf8f2" stroke="#9a9184" stroke-width="1.2"/>';
    switch (k) {
      case "5-15R": g = face + circle + slot(18, 17, 3.5, 10) + slot(34, 19, 3.5, 8) + ground(28, 38, 3.5); break;
      case "5-20R": g = face + circle + slot(18, 17, 3.5, 10) + slot(14, 20.5, 8, 3.5) + slot(34, 19, 3.5, 8) + ground(28, 38, 3.5); break;
      case "6-20R": g = face + circle + slot(18, 17, 3.5, 10) + slot(14, 20.5, 8, 3.5) + slot(30, 20.5, 9, 3.5) + ground(28, 38, 3.5); break;
      case "6-50R": g = face + circle + slot(13, 20, 10, 3.5) + slot(33, 20, 10, 3.5) + ground(28, 38, 4); break;
      case "10-30R": g = face + circle + '<path d="M14 24 l8 -7" stroke="#2b2822" stroke-width="3.5" stroke-linecap="round"/><path d="M42 24 l-8 -7" stroke="#2b2822" stroke-width="3.5" stroke-linecap="round"/>' + slot(26.5, 31, 3.5, 9) + slot(26.5, 36.5, 8, 3.5); break;
      case "10-50R": g = face + circle + '<path d="M13 25 l9 -8" stroke="#2b2822" stroke-width="4" stroke-linecap="round"/><path d="M43 25 l-9 -8" stroke="#2b2822" stroke-width="4" stroke-linecap="round"/>' + slot(26, 30, 4, 10) + slot(26, 36, 9, 4); break;
      case "14-30R": g = face + circle + ground(28, 15, 3.5) + slot(14, 22, 3.5, 10) + slot(38.5, 22, 3.5, 10) + slot(26.5, 31, 3.5, 8) + slot(26.5, 35.5, 8, 3.5); break;
      case "14-50R": g = face + circle + ground(28, 15, 4) + slot(13, 21, 4, 11) + slot(39, 21, 4, 11) + slot(26, 32, 4, 10); break;
      case "jbox-1": case "jbox-2":
        g = '<rect x="8" y="8" width="40" height="40" rx="2" fill="#9aa3ad" stroke="#5d6670" stroke-width="1.5"/>' +
          '<rect x="13" y="13" width="30" height="30" rx="1" fill="#c9d0d6" stroke="#5d6670"/>' +
          round(28, 12, 1.6) + round(28, 44, 1.6) + '<path d="M28 20 q6 8 0 16" stroke="#1d1a16" stroke-width="2.5" fill="none"/>';
        break;
      case "romex":
        g = '<path d="M6 40 q14 -30 44 -24" stroke="#f0d060" stroke-width="7" fill="none" stroke-linecap="round"/>' +
          '<path d="M6 40 q14 -30 44 -24" stroke="#1d1a16" stroke-width="2" fill="none" stroke-dasharray="3 5"/>' +
          '<path d="M44 14 l8 -4 M46 20 l8 -2" stroke="#1d1a16" stroke-width="2"/>';
        break;
      case "1/4-T": case "3/8-T": case "1/2":
        g = '<rect x="6" y="24" width="44" height="8" rx="2" fill="#b7853b"/>' + '<rect x="24" y="12" width="8" height="20" rx="2" fill="#b7853b"/>' +
          '<rect x="19" y="6" width="18" height="7" rx="2" fill="#d1432b"/>' + '<rect x="40" y="21" width="12" height="14" rx="2" fill="#c89b55"/>' +
          '<text x="28" y="46" font-size="9" text-anchor="middle" fill="#2b2822" font-family="system-ui">' + (k === "1/2" ? "1/2" : k.replace("-T", "")) + '"</text>';
        break;
      case "box":
        g = '<rect x="8" y="6" width="40" height="44" rx="2" fill="#e8eef2" stroke="#5d6670" stroke-width="1.5"/>' +
          '<circle cx="20" cy="22" r="5" fill="#d1432b"/><circle cx="36" cy="22" r="5" fill="#2a6fd1"/>' +
          '<rect x="18" y="30" width="4" height="14" fill="#8a9099"/><rect x="34" y="30" width="4" height="14" fill="#8a9099"/>' +
          '<rect x="25" y="34" width="6" height="12" fill="#5d6670"/>';
        break;
      case "stub":
        g = '<rect x="6" y="24" width="30" height="8" rx="2" fill="#b7853b"/><rect x="34" y="21" width="6" height="14" rx="1" fill="#8a6a2e"/>' +
          '<text x="28" y="46" font-size="8" text-anchor="middle" fill="#8a2a1a" font-family="system-ui">no valve</text>';
        break;
      case "tailpiece":
        g = '<rect x="18" y="6" width="20" height="6" fill="#9aa3ad"/><rect x="24" y="12" width="8" height="18" fill="#9aa3ad"/>' +
          '<path d="M24 30 v8 q0 6 6 6 h16" stroke="#9aa3ad" stroke-width="8" fill="none"/><circle cx="36" cy="22" r="4" fill="#5d6670"/>';
        break;
      case "standpipe":
        g = '<rect x="24" y="6" width="8" height="34" fill="#c9d0d6" stroke="#5d6670"/><path d="M28 40 q0 8 8 8 h10" stroke="#c9d0d6" stroke-width="8" fill="none"/>' +
          '<path d="M12 10 q8 -8 14 0" stroke="#8a9099" stroke-width="4" fill="none"/>';
        break;
      case "floor":
        g = '<rect x="6" y="40" width="44" height="10" fill="#d8d2c6"/><circle cx="28" cy="40" r="10" fill="#9aa3ad" stroke="#5d6670"/>' +
          '<path d="M20 40 h16 M28 32 v16 M22 34 l12 12 M34 34 l-12 12" stroke="#2b2822" stroke-width="1.5"/>';
        break;
      case "airgap":
        g = '<rect x="10" y="44" width="36" height="6" fill="#d8d2c6"/><rect x="24" y="22" width="8" height="22" fill="#9aa3ad"/>' +
          '<path d="M18 22 q10 -16 20 0 z" fill="#c9d0d6" stroke="#5d6670"/><rect x="12" y="34" width="8" height="6" fill="#8a9099"/><rect x="36" y="34" width="8" height="6" fill="#8a9099"/>';
        break;
      case "disposer":
        g = '<rect x="18" y="6" width="20" height="8" fill="#9aa3ad"/><path d="M16 14 h24 v22 q0 10 -12 10 q-12 0 -12 -10 z" fill="#5d6670"/>' +
          '<rect x="40" y="22" width="12" height="6" fill="#9aa3ad"/><circle cx="36" cy="26" r="2.5" fill="#f4efe6"/>';
        break;
      case "pump":
        g = '<rect x="10" y="20" width="26" height="22" rx="3" fill="#5d6670"/><circle cx="23" cy="31" r="6" fill="#c9d0d6"/>' +
          '<path d="M36 26 h8 v-14 h6" stroke="#9aa3ad" stroke-width="5" fill="none"/><path d="M46 6 l4 6 l-8 0 z" fill="#9aa3ad"/>';
        break;
      case "6-round": case "7-round": case "8-round": case "10-round":
        g = '<circle cx="28" cy="26" r="18" fill="#c9d0d6" stroke="#5d6670" stroke-width="2"/><circle cx="28" cy="26" r="12" fill="#2b2822"/>' +
          '<text x="28" y="50" font-size="9" text-anchor="middle" fill="#2b2822" font-family="system-ui">' + k.replace("-round", '" round') + "</text>";
        break;
      case "3x10":
        g = '<rect x="6" y="18" width="44" height="18" rx="2" fill="#c9d0d6" stroke="#5d6670" stroke-width="2"/><rect x="10" y="22" width="36" height="10" fill="#2b2822"/>' +
          '<text x="28" y="48" font-size="8" text-anchor="middle" fill="#2b2822" font-family="system-ui">3 1/4 × 10</text>';
        break;
      case "4-dryer":
        g = '<circle cx="28" cy="24" r="14" fill="#c9d0d6" stroke="#5d6670" stroke-width="2"/><circle cx="28" cy="24" r="9" fill="#2b2822"/>' +
          '<text x="28" y="48" font-size="9" text-anchor="middle" fill="#2b2822" font-family="system-ui">4" dryer</text>';
        break;
      case "recirc":
        g = '<path d="M14 30 a14 14 0 1 1 6 11" stroke="#5d6670" stroke-width="4" fill="none"/><path d="M12 36 l2 10 l10 -4 z" fill="#5d6670"/>' +
          '<text x="28" y="54" font-size="8" text-anchor="middle" fill="#2b2822" font-family="system-ui">recirculating</text>';
        break;
      case "1/2-shutoff": case "3/4-shutoff": case "no-shutoff":
        g = '<rect x="6" y="26" width="44" height="8" rx="2" fill="#d9c23a" stroke="#8a7a1a"/>' +
          (k === "no-shutoff" ? '<rect x="40" y="23" width="8" height="14" fill="#8a7a1a"/>' : '<rect x="22" y="22" width="12" height="16" rx="2" fill="#8a7a1a"/><rect x="26" y="8" width="4" height="16" fill="#d1432b"/><rect x="18" y="6" width="20" height="5" rx="2" fill="#d1432b"/>') +
          '<text x="28" y="48" font-size="8" text-anchor="middle" fill="#2b2822" font-family="system-ui">' + (k === "no-shutoff" ? "no shutoff" : k.replace("-shutoff", '" + shutoff')) + "</text>";
        break;
      default:
        g = face + '<text x="28" y="34" font-size="20" text-anchor="middle" fill="#9a9184" font-family="system-ui">?</text>';
    }
    return '<svg class="sw-plug" viewBox="0 0 56 56" width="' + size + '" height="' + size + '" aria-hidden="true">' + g + "</svg>";
  }

  /* =====================================================================
     FLUSH INSET — the cleats, the header, the platform
     ---------------------------------------------------------------------
     "30 1/8 flush inset width with 4-in cleats recessed back 7/8 of an inch
     by 18 1/8 flush inset height with 1/8 lip on bottom and 3/8 cleat on
     top." Twenty-five openings in the corpus were described exactly this
     way. Width and height are the finished opening; the rest is what the
     panel sits against. The side setback is the fourth plane the tool
     already scores, so it lives in actual.c as well. */
  var FLUSH_FIELDS = [
    { k: "sideSize",     label: "Side cleats · width",        hint: "3/4, 1, 4…" },
    { k: "sideSetback",  label: "Side cleats · recessed from face frame", hint: "7/8, 1, 1 3/8" },
    { k: "topSize",      label: "Top header · thickness",     hint: "5/16, 1/2, 3/4" },
    { k: "topSetback",   label: "Top header · recessed" },
    { k: "bottomSize",   label: "Bottom platform / shelf · thickness", hint: "1/8, 3/4" },
    { k: "bottomSetback",label: "Bottom platform · recessed" },
    { k: "interiorW",    label: "Interior width between cleats" },
    { k: "interiorH",    label: "Interior height between header and shelf" }
  ];
  function flushOf(it) {
    it.flush = it.flush || { on: false };
    FLUSH_FIELDS.forEach(function (f) { if (it.flush[f.k] == null) it.flush[f.k] = ""; });
    return it.flush;
  }
  function flushOn(it) { return !!(it.flush && it.flush.on); }
  /* A variation labelled flush turns the block on by default. */
  function flushLikely(it) {
    var v = itemVariation(it);
    if (v && /flush/i.test(v.label || "")) return true;
    return /flush/i.test(it.installType || "");
  }
  function flushText(it) {
    if (!flushOn(it)) return "";
    var f = flushOf(it), bits = [];
    if (num(f.sideSize) != null) bits.push(fmtIn(num(f.sideSize)) + " side cleats" + (num(f.sideSetback) != null ? " recessed " + fmtIn(num(f.sideSetback)) : ""));
    if (num(f.topSize) != null) bits.push(fmtIn(num(f.topSize)) + " header" + (num(f.topSetback) != null ? " recessed " + fmtIn(num(f.topSetback)) : ""));
    if (num(f.bottomSize) != null) bits.push(fmtIn(num(f.bottomSize)) + " platform" + (num(f.bottomSetback) != null ? " recessed " + fmtIn(num(f.bottomSetback)) : ""));
    if (num(f.interiorW) != null || num(f.interiorH) != null) {
      bits.push("interior " + [num(f.interiorW) != null ? fmtIn(num(f.interiorW)) + " W" : "", num(f.interiorH) != null ? fmtIn(num(f.interiorH)) + " H" : ""].filter(Boolean).join(" × "));
    }
    return bits.join(" · ");
  }
  /* The side setback is the cleat plane the verdict engine already knows. */
  function syncFlush(it) {
    if (!flushOn(it)) return;
    var f = flushOf(it);
    if (num(f.sideSetback) != null) { it.planes4 = true; it.actual.c = fmtFrac(num(f.sideSetback)); }
  }

  /* =====================================================================
     DOOR SWING — room for the door to open
     ---------------------------------------------------------------------
     "the unit will hinge on the right only as we don't have enough space
     on the left for the door to open." "specs call for 5 1/2 minimum from
     back of cutout to wall (for space to open unit) — currently 4 1/2, may
     be a serious issue." */
  var SWING_SIDES = [{ k: "left", label: "Left" }, { k: "right", label: "Right" }];
  function swingOf(it) {
    it.swing = it.swing || { on: false, hinge: "", wallSide: "", clearanceIn: "" };
    return it.swing;
  }
  function swingOn(it) { return !!(it.swing && it.swing.on); }
  function swingMin(it) {
    var v = itemVariation(it), e = itemEntry(it);
    var m = (v && v.swingMinIn) || (e && e.swingMinIn);
    return num(m);
  }
  function swingFinding(it) {
    if (!swingOn(it)) return null;
    var sw = swingOf(it), c = num(sw.clearanceIn), min = swingMin(it);
    if (c == null) return null;
    if (min != null && c < min - DEF_TOL) {
      return { kind: "fix", owner: "cabinet",
        text: "Only " + fmtIn(c) + " beside the door on the " + (sw.wallSide || "hinge") + " side — the spec calls for " + fmtIn(min) + " minimum for the door to open. Gain " + fmtIn(min - c) + " or move the unit." };
    }
    return { kind: "note", owner: "wilson",
      text: "Door hinges " + (sw.hinge || "as drawn") + " — " + fmtIn(c) + " to the " + (sw.wallSide || "adjacent") + " wall" +
        (min != null ? " against " + fmtIn(min) + " minimum" : "") + ". " + (sw.hinge ? "Hinge side is set by the clearance; do not reverse it." : "") };
  }

  /* =====================================================================
     FLOORING NOT DOWN — a pending deduction from every floor-standing height
     ---------------------------------------------------------------------
     "(no flooring yet)" on six openings; "Flooring is gonna be 9/16 of an
     inch. So account for flooring." A height read over the subfloor is
     wrong by exactly the flooring, and the builder needs both numbers. */
  function floorStanding(it) {
    var k = kindOf(it);
    if (k === "dishwasher" || k === "laundry" || k === "refrigeration" || k === "ice") return true;
    if (k === "cooking") {
      /* a range stands on the floor; a cooktop or rangetop sits in the counter over a base cabinet */
      var e = itemEntry(it);
      var words = [(e && e.category), (e && e.appliance), it && it.category, it && it.appliance, it && it.model].filter(Boolean).join(" ").toLowerCase();
      return !/cooktop|rangetop|range top/.test(words);
    }
    return false;
  }
  /* Which neighbour planes an opening can have. A product that stands on
     the floor — every refrigerator and column, a dishwasher, a range, a
     laundry pair — has nothing under it: no "cabinet below" to draw, place
     a connection in, or offer (Cayden, 24 Oct: "There will never be a
     cabinet under a fridge or any product that goes on the floor"). */
  function planeAllowed(it, pk) {
    if (pk === "below") return !floorStanding(it);
    return true;
  }
  function flooringDeduction(walk, it) {
    if (!walk) return 0;
    var fl = flooringOf(walk);
    if (!fl.pending) return 0;
    var t = num(fl.thicknessIn);
    if (t == null || !floorStanding(it)) return 0;
    return t;
  }
  /* The finished height: what the opening will measure once the floor is
     in. The reading itself is never edited — both print. */
  function finishedHeight(walk, it) {
    var h = num(it.actual && it.actual.h);
    if (h == null) return null;
    return h - flooringDeduction(walk, it);
  }

  /* =====================================================================
     MERGES — two or three units in one cavity
     ---------------------------------------------------------------------
     "Triple Fridge Merge", "24" UC Merge": the most common column
     refrigeration install and, until now, three openings on the sheet that
     were one opening on the wall. Cayden's rule: a merge is ONE opening —
     one set of cavity dimensions — and each unit keeps its own outlet and
     plumbing. Every merge needs the brand's join / merge kit, which is an
     ordered accessory, so a merge always asks about the kit.

     Model: the first unit becomes the host item; the others are folded into
     `host.merge.units` (identity, basis and required opening each) and
     leave `walk.items`. Unmerging restores them. The host's required width
     is the SUM of the unit openings unless the office types the drawing's
     figure — the basis is recorded and printed, never silent. */
  var KIT_STATES = [
    { k: "onsite",  label: "Kit on site",  tone: "good" },
    { k: "ordered", label: "Ordered",      tone: "monitor" },
    { k: "missing", label: "Not ordered",  tone: "poor" },
    { k: "na",      label: "Not needed",   tone: "" }
  ];
  function isMerge(it) { return !!(it && it.merge && it.merge.units && it.merge.units.length > 1); }
  function mergeUnits(it) { return isMerge(it) ? it.merge.units : []; }
  function unitPos(i, n) {
    if (n === 2) return i === 0 ? "left" : "right";
    if (n === 3) return ["left", "center", "right"][i];
    return "position " + (i + 1);
  }
  function unitSnapshot(it) {
    return {
      id: it.id, brand: it.brand || "", model: it.model || "", appliance: it.appliance || "",
      category: it.category || "", basisKey: it.basisKey || "", installType: it.installType || "",
      specRef: it.specRef || "", spec: Object.assign({}, it.spec || {}), rule: Object.assign({}, it.rule || {}),
      specPage: it.specPage || null, location: it.location || "", area: it.area || "",
      /* connections typed at the desk off the sheet travel with the unit */
      utilitiesSpec: it.utilitiesSpec && it.utilitiesSpec.length ? it.utilitiesSpec.map(function (u) { return Object.assign({}, u); }) : null,
      utilitiesNone: !!it.utilitiesNone,
      hinge: it.hinge || "",
      /* the unit's own field record, kept so an unmerge loses nothing */
      kept: null
    };
  }
  /* Merges are a refrigeration thing (Cayden, 24 Sep): 84" columns across
     every luxury brand, Sub-Zero undercounters (the DEU1550 ice maker with
     DEU2450s), True undercounters second. Nothing else merges. */
  /* Built-in refrigeration comes in two shapes that install differently
     (Cayden, 24 Oct: "take extra care"). A BUILT-IN is one cabinet with a
     grille at the top — an over-and-under, side-by-side or French door —
     anchored by floor brackets (Sub-Zero) or a 2×4 to the wall studs at
     84" (Monogram, JennAir, Thermador), with an outlet high in a corner
     (75"–77"). A COLUMN is a single-purpose tall unit, one or more side
     by side in one opening, height-adjustable at the toe kick, vented
     through the kickplate, with 3½" finished returns, an outlet low (Sub-
     Zero) or in a recess / the cabinet beside (F&P, Miele), anti-tip to
     wall-and-floor or to ¾" plywood side panels (JennAir, Miele). The
     thirty spec books behind this are in claude/simplify-and-missing-pass.md. */
  /* ID- are Designer DRAWERS (undercounter), not columns; the Classic
     columns include the glass-door (RG), dispenser (RID) and wine (W)
     models (Sub-Zero Design Guide 1/2025) */
  var COLUMN_RE = /\bcolumns?\b|\b(IC|IT|IW|DEC|DET)-?\d{2}|\bCL\d{2}50(?:RG|R|F|W)(?:ID)?(?:\b|\/)|\bZI[RFK]\d{2}|\bT\d{2}I[RFCD]\d|\bJB[RZC]FL\d{2}|mastercool|\bK ?\d{4} ?Vi\b|\bF ?\d{4} ?Vi\b|\bRS\d{2}(84|61)\b/i;
  var BUILTIN_RE = /built[- ]?in|side[- ]by[- ]side|french door|over[- ]and[- ]under|bottom[- ]freezer|\bBI-?\d{2}|\bCL\d{4}\b|\bZISS|\bZIPS|\bZIS\d|\bZIC\d|\bJS48|\bJB36|\bJF42|\bT\d{2}B[BDF]\d|\bKF ?\d{4} ?Vi\b|\bRS36A|classic/i;
  var UNDERCOUNTER_RE = /undercounter|under[- ]counter|drawer|beverage|wine|ice ?maker|icemaker|nugget|\bDEU|\bUC-|\bUW-|\bHP24|\bHC24|\bHA24|\bTUR-|\bTUF-|\bTUC-|\bTBC-|\bTWC-|merchandiser/i;
  function refrigKind(it) {
    if (!it || !isRefrigeration(it)) return "";
    if (isMerge(it)) return "column";
    var e = itemEntry(it);
    var words = [it.brand, it.model, it.appliance, it.category, e && e.appliance, e && e.category].filter(Boolean).join(" ");
    if (UNDERCOUNTER_RE.test(words) && !COLUMN_RE.test(words)) return "undercounter";
    /* No word for it, but a unit or opening under 40" tall goes under a
       counter: a Perlick "G5 Shallow ADA 24" Refrigerator Glass Door" walked
       as a tall built-in, soffit and anti-tip at 84" (Cayden, 27 Oct). */
    var tall = refrigHeight(it);
    if (tall != null && tall <= 40) return "undercounter";
    if (/\bADA\b/.test(words) && !COLUMN_RE.test(words) && !BUILTIN_RE.test(words)) return "undercounter";
    if (COLUMN_RE.test(words)) return "column";
    if (BUILTIN_RE.test(words)) return "builtin";
    return "builtin";
  }
  /* The height the sheet gives: the opening's, else the unit's own off the
     package's product table ("23 7/8"W x 34"H x 23 1/8"D"). */
  function refrigHeight(it) {
    var h = num(it.spec && it.spec.h);
    if (h != null) return h;
    var m = /([0-9]+(?:\s+[0-9]+\/[0-9]+)?(?:\.[0-9]+)?)\s*(?:"|”|in\.?)?\s*H\b/i.exec(String(it.unitSize || ""));
    return m ? num(m[1]) : null;
  }
  var REFRIG_MODEL_RE = /\bBI-?\d{2}|\bCL\d{4}|\b(IC|IT|IW|DEC|DET|ID)-?\d{2}|\bZI[SRFKPC]\d|\bT\d{2}(B[BDF]|I[RFCD])\d|\bJB[RZC]FL|\bJS48|\bJB36|\bJF42|\bRS\d{2}(84|61)|mastercool|french door|side[- ]by[- ]side|\bDEU\d|\bUC-\d|\bHC24|\bHP24|\bTU[RFC]-/i;
  function isRefrigeration(it) {
    var e = itemEntry(it);
    var cat = ((e && e.category) || it.category || "").toLowerCase();
    if (/refrig|icemaker|ice maker|wine|beverage|column|freezer|merchandiser/.test(cat)) return true;
    var words = ((e && e.appliance) || it.appliance || "") + " " + (it.model || "") + " " + (it.brand || "");
    if (/fridge|refrigerat|freezer|ice ?maker|wine|beverage|column|undercounter/i.test(words)) return true;
    return REFRIG_MODEL_RE.test(words) && !/oven|range|cooktop|hood|dishwasher|washer|dryer/i.test(words);
  }
  function canMerge(items) {
    if (!items || items.length < 2 || items.length > 4) return "Pick two to four openings.";
    for (var i = 0; i < items.length; i++) {
      if (isMerge(items[i])) return "One of these is already a merge — unmerge it first.";
      if (!isRefrigeration(items[i])) return itemTitle(items[i]) + " is not refrigeration — only refrigeration merges.";
      if (basisPending(items[i])) return "Choose the install basis on " + itemTitle(items[i]) + " first.";
    }
    return "";
  }
  /* Enough refrigeration on the sheet for a merge to be possible at all. */
  function mergeCandidates(walk) {
    return (walk.items || []).filter(function (it) { return !isMerge(it) && isRefrigeration(it); });
  }
  /* The merges the sheet itself suggests: two to four unmerged columns in
     the same area (a 30" refrigerator and an 18" freezer column both in
     "Kitchen") almost always share one cavity with a kit between them.
     Built-ins never merge on their own — a 48" side-by-side beside a
     column is two openings until someone says otherwise — and a column
     whose basis is still pending waits. Each group is offered as one tap,
     never merged behind the office's back (Cayden, 24 Oct). */
  function suggestMerges(walk) {
    var dismissed = (walk && walk.mergeDismissed) || {};
    var groups = {}, order = [];
    (walk && walk.items || []).forEach(function (it) {
      if (isMerge(it) || refrigKind(it) !== "column" || basisPending(it)) return;
      var key = String(it.area || "").trim().toLowerCase() || "(no area)";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    });
    var out = [];
    order.forEach(function (key) {
      var g = groups[key];
      if (g.length < 2 || g.length > 4) return;
      var ids = g.map(function (x) { return x.id; });
      if (dismissed[ids.slice().sort().join("+")]) return;
      if (canMerge(g)) return;
      out.push({ area: g[0].area || "", ids: ids, items: g, widths: g.map(function (x) { return x.spec && x.spec.w; }) });
    });
    return out;
  }
  function dismissMergeSuggestion(walk, ids) {
    walk.mergeDismissed = walk.mergeDismissed || {};
    walk.mergeDismissed[ids.slice().sort().join("+")] = true;
  }
  /* The combined required opening. Widths add; depth and height are the
     largest unit's (a minimum is a minimum for every unit). Any unit without
     a required width leaves the sum blank rather than pretending. */
  /* The brands' own dual / triple opening widths. "A merge is the sum of
     the unit widths" is what Sub-Zero Designer, Thermador and Miele say
     and what Sub-Zero Classic, Monogram and Fisher & Paykel do NOT
     (Classic 30+30 = 59 3/4", not 59"; Monogram 30+30 = 59 1/2", not
     59 5/8"; F&P 30+30 = 60 1/32"). Keys are the unit nominal widths in
     order; values in inches; `flush` where the brand publishes one. */
  var MERGE_TABLES = [
    { brand: "Sub-Zero Classic columns", test: function (u) { return /\bCL\d{2}50(?:RG|R|F|W)/i.test(u.model || "") || (/sub[- ]?zero/i.test(u.brand || "") && /classic/i.test(u.appliance || "") && /column/i.test(u.appliance || "")); },
      source: "Sub-Zero Classic Series design guide — dual installation table (one grille frame spans both)",
      pairs: { "30+30": { w: 59.75, flush: 62.25 }, "30+36": { w: 65.75, flush: 68.25 }, "36+30": { w: 65.75, flush: 68.25 }, "36+36": { w: 71.75, flush: 74.25 } },
      kit: "Sub-Zero Classic dual installation kit with the 60\" or 66\" grille frame",
      notes: ["Without the dual kit a 2\" filler strip is required between the units.", "French-door and side-by-side Classic units cannot pair with the dual kit — the doors interfere.", "Without a filler strip the two units must have opposite hinges.", "The CL3050W wine column pairs with a 30\" or 36\" Classic on the same table."] },
    { brand: "Sub-Zero PRO", test: function (u) { return /^PRO\d{4}/i.test(u.model || ""); },
      source: "Sub-Zero Design Guide 1/2025 p.38 — dual PRO 36\" opening",
      pairs: { "36+36": { w: 71.5, flush: 72 } },
      kit: "Sub-Zero PRO dual installation kit",
      notes: ["Without the kit a 2\" filler strip is recommended; without a filler the units must have opposite hinges."] },
    { brand: "Sub-Zero Designer undercounter", test: function (u) { return /^DEU\d{4}/i.test(u.model || "") || /^UC-?\d{2}/i.test(u.model || ""); },
      source: "Sub-Zero Design Guide 1/2025 pp.57, 86 — 15+15 = 30\", 15+24 = 39\", 24+24 = 48\"",
      sum: true, kit: "Sub-Zero undercounter dual installation kit",
      notes: ["Without the kit a 2\" filler strip is recommended; without a filler the units must have opposite hinges.", "A door model next to a drawer model: the door's face frame sits about 1/16\" proud, and its handle must be next to the drawers."] },
    { brand: "Sub-Zero Designer columns", test: function (u) { return /^(IC|IT|IW|DEC|DET|ID)-?\d{2}/i.test(u.model || ""); },
      source: "Sub-Zero Designer design guide — \"the opening width is the width of the two units added together\"",
      sum: true, kit: "Sub-Zero integrated dual installation kit (by hinge configuration: handle-to-handle 7023628 · hinge-to-hinge 7029830 · hinge-to-handle 7029829)",
      kitByHinge: { "handle-to-handle": "7023628", "hinge-to-hinge": "7029830", "hinge-to-handle": "7029829" },
      notes: ["Without the dual kit a minimum 2\" filler strip is required between the units.", "Dual installs take the narrower dual door panels (e.g. 29 13/16\" for a 30\")."] },
    { brand: "Monogram columns", test: function (u) { return /^ZI[RFK]\d{2}/i.test(u.model || "") || (/monogram/i.test(u.brand || "") && /column/i.test(u.appliance || "")); },
      source: "Monogram column installation — dual opening widths",
      pairs: { "18+24": { w: 41.5 }, "24+18": { w: 41.5 }, "18+30": { w: 47.5 }, "30+18": { w: 47.5 }, "24+30": { w: 53.5 }, "30+24": { w: 53.5 }, "30+30": { w: 59.5 } },
      kit: "Monogram ZKUN heater unification kit (required on every dual install, and on singles within 4\" of each other)",
      notes: ["Left- and right-swing units need 1/2\" clearance between them."] },
    { brand: "Fisher & Paykel columns", test: function (u) { return /^RS\d{2}(84|61)/i.test(u.model || ""); },
      source: "Fisher & Paykel dual / triple installation data sheets",
      pairs: { "18+18": { w: 36 }, "24+24": { w: 48 }, "30+30": { w: 60 + 1 / 32 }, "36+36": { w: 72 } },
      triples: { "18+18+18": { w: 53 + 31 / 32 }, "24+24+24": { w: 72 }, "30+30+30": { w: 90 }, "36+36+36": { w: 107 + 15 / 16 } },
      kit: "Fisher & Paykel joiner kit AJ-RS84LR (included only with freezer and wine columns)",
      notes: ["French-door pairs are not recommended — the hinges clash."] },
    { brand: "Thermador Freedom columns", test: function (u) { return /^T\d{2}I[RFCD]\d/i.test(u.model || ""); },
      source: "Thermador Freedom planning guide — one cutout, widths added",
      sum: true, partitionForThree: 0.625,
      kit: "Thermador sealing kit (provided with a freezer column) / HEATRKIT20 heater kit when units sit within 6\" but are not joined",
      notes: ["Each column needs its own receptacle.", "Three columns together need a 5/8\" partition between two of them so the doors clear."] },
    { brand: "Miele MasterCool columns", test: function (u) { return /^[KF] ?\d{4} ?Vi/i.test(u.model || "") || /mastercool/i.test(u.appliance || ""); },
      source: "Miele MasterCool installation — niche width is the sum, the kit adds no width",
      sum: true, kit: "Miele KSK 2002 side-by-side kit (heating mat) when there is no partition wall",
      notes: ["Receptacle must not be behind the appliance.", "Adjoining furniture must be fixed to the floor and/or wall — the columns anchor to it."] }
  ];
  function mergeTableFor(units) {
    for (var i = 0; i < MERGE_TABLES.length; i++) {
      if (units.length && units.every(function (u) { return MERGE_TABLES[i].test(u); })) return MERGE_TABLES[i];
    }
    return null;
  }
  function unitNominal(u) {
    var w = num(u.spec && u.spec.w);
    if (w == null) return null;
    /* 29 13/16 → 30, 17 13/16 → 18, 23 1/2 → 24; a flush-inset 32 → 30 */
    var best = null;
    [18, 24, 30, 36, 42, 48].forEach(function (n) { if (Math.abs(w - n) <= 2.6 && (best == null || Math.abs(w - n) < Math.abs(w - best))) best = n; });
    return best == null ? Math.round(w) : best;
  }
  function mergeRequired(units) {
    var w = 0, allW = true, d = null, h = null;
    units.forEach(function (u) {
      var uw = num(u.spec && u.spec.w), ud = num(u.spec && u.spec.d), uh = num(u.spec && u.spec.h);
      if (uw == null) allW = false; else w += uw;
      if (ud != null) d = d == null ? ud : Math.max(d, ud);
      if (uh != null) h = h == null ? uh : Math.max(h, uh);
    });
    var out = { w: allW && units.length ? w : null, d: d, h: h, basis: "sum", source: "", table: null };
    var t = mergeTableFor(units);
    if (t) {
      out.table = t;
      var key = units.map(unitNominal).join("+"), flush = units.some(function (u) { return /flush/i.test(u.installType || ""); });
      var row = (units.length === 2 && t.pairs && t.pairs[key]) || (units.length === 3 && t.triples && t.triples[key]) || null;
      if (row) { out.w = flush && row.flush != null ? row.flush : row.w; out.basis = "table"; out.source = t.source + (flush && row.flush != null ? " (flush inset)" : ""); }
      else if (t.sum && allW) {
        out.basis = "brand-sum"; out.source = t.source;
        if (units.length === 3 && t.partitionForThree) { out.w = w + t.partitionForThree; out.source += " + " + fmtIn(t.partitionForThree) + " partition between two of the three"; }
      }
    }
    return out;
  }
  function applyMergeRequired(host) {
    var m = host.merge, req = mergeRequired(m.units);
    if (m.widthBasis !== "typed") { host.spec.w = req.w != null ? fmtIn(req.w) : ""; m.widthBasis = req.basis === "table" ? "table" : "sum"; }
    host.spec.d = req.d != null ? fmtIn(req.d) : "";
    host.spec.h = req.h != null ? fmtIn(req.h) : "";
    /* every unit exact → exact; any minimum → minimum */
    host.rule.w = m.units.every(function (u) { return (u.rule && u.rule.w) === "exact"; }) ? "exact" : "min";
    host.rule.d = "min"; host.rule.h = "min";
  }
  function mergeItems(walk, ids) {
    var items = ids.map(function (id) { return item(walk, id); }).filter(Boolean);
    var why = canMerge(items);
    if (why) return { error: why };
    var host = items[0];
    host.merge = {
      units: items.map(unitSnapshot),
      kit: { state: "", partNo: "", note: "" },
      widthBasis: "sum",
      mergedAt: isoNow()
    };
    items.slice(1).forEach(function (u, i) {
      host.merge.units[i + 1].kept = u;          /* whole record, for unmerge */
      var at = walk.items.indexOf(u);
      if (at >= 0) walk.items.splice(at, 1);
      /* the unit's connection answers come along, under the unit's key */
      Object.keys(u.utilities || {}).forEach(function (k) { host.utilities["u" + (i + 1) + ":" + k] = u.utilities[k]; });
      Object.keys(u.utilTypes || {}).forEach(function (k) { host.utilTypes["u" + (i + 1) + ":" + k] = u.utilTypes[k]; });
    });
    Object.keys(host.utilities).forEach(function (k) {
      if (k.indexOf(":") < 0) { host.utilities["u0:" + k] = host.utilities[k]; delete host.utilities[k]; }
    });
    Object.keys(host.utilTypes).forEach(function (k) {
      if (k.indexOf(":") < 0) { host.utilTypes["u0:" + k] = host.utilTypes[k]; delete host.utilTypes[k]; }
    });
    host.appliance = host.merge.units.map(function (u) { return u.appliance || u.model; }).join(" + ");
    host.model = host.merge.units.map(function (u) { return u.model; }).filter(Boolean).join(" + ");
    host.installType = "Merged — " + host.merge.units.length + " units, one cavity";
    /* readings taken on the single unit no longer describe the cavity */
    host.actual = { w: "", d: "", h: "", c: "" };
    host.points = { w: ["", "", ""], d: ["", "", ""], h: ["", "", ""], c: ["", "", ""] };
    applyMergeRequired(host);
    host.updatedAt = isoNow();
    return { host: host };
  }
  function unmergeItem(walk, host) {
    if (!isMerge(host)) return;
    var units = host.merge.units, at = walk.items.indexOf(host);
    var first = units[0];
    units.slice(1).forEach(function (u, i) {
      var back = u.kept || normItem(Object.assign(blankItem(), {
        id: u.id, brand: u.brand, model: u.model, appliance: u.appliance, category: u.category,
        basisKey: u.basisKey, installType: u.installType, specRef: u.specRef, area: u.area, location: u.location,
        spec: Object.assign({}, u.spec), rule: Object.assign({}, u.rule), specPage: u.specPage,
        utilitiesSpec: u.utilitiesSpec || null, utilitiesNone: !!u.utilitiesNone
      }));
      back.utilities = {}; back.utilTypes = {}; back.utilFlags = {};
      Object.keys(host.utilities).forEach(function (k) {
        if (k.indexOf("u" + (i + 1) + ":") === 0) back.utilities[k.split(":")[1]] = host.utilities[k];
      });
      Object.keys(host.utilTypes).forEach(function (k) {
        if (k.indexOf("u" + (i + 1) + ":") === 0) back.utilTypes[k.split(":")[1]] = host.utilTypes[k];
      });
      Object.keys(host.utilFlags || {}).forEach(function (k) {
        if (k.indexOf("u" + (i + 1) + ":") === 0) back.utilFlags[k.split(":")[1]] = host.utilFlags[k];
      });
      walk.items.splice(at + 1 + i, 0, back);
    });
    var hu = {}, ht = {}, hf = {};
    Object.keys(host.utilities).forEach(function (k) { if (k.indexOf("u0:") === 0) hu[k.slice(3)] = host.utilities[k]; });
    Object.keys(host.utilTypes).forEach(function (k) { if (k.indexOf("u0:") === 0) ht[k.slice(3)] = host.utilTypes[k]; });
    Object.keys(host.utilFlags || {}).forEach(function (k) { if (k.indexOf("u0:") === 0) hf[k.slice(3)] = host.utilFlags[k]; });
    host.utilities = hu; host.utilTypes = ht; host.utilFlags = hf;
    host.brand = first.brand; host.model = first.model; host.appliance = first.appliance;
    host.installType = first.installType; host.specRef = first.specRef;
    host.spec = Object.assign({ w: "", d: "", h: "", c: "" }, first.spec);
    host.rule = Object.assign({ w: "exact", d: "min", h: "min", c: "exact" }, first.rule);
    host.actual = { w: "", d: "", h: "", c: "" };
    host.merge = null;
    host.updatedAt = isoNow();
  }
  function moveUnit(host, idx, dir) {
    var u = host.merge.units, j = idx + dir;
    if (j < 0 || j >= u.length) return;
    var t = u[idx]; u[idx] = u[j]; u[j] = t;
    /* the connection answers travel with the unit */
    var swap = function (bag) {
      var out = {};
      Object.keys(bag).forEach(function (k) {
        var m = k.match(/^u(\d+):(.*)$/);
        if (!m) { out[k] = bag[k]; return; }
        var n = parseInt(m[1], 10);
        out["u" + (n === idx ? j : n === j ? idx : n) + ":" + m[2]] = bag[k];
      });
      return out;
    };
    host.utilities = swap(host.utilities); host.utilTypes = swap(host.utilTypes); host.utilFlags = swap(host.utilFlags || {});
  }
  function setMergeWidth(host, raw) {
    if (!isMerge(host)) return;
    var n = num(raw);
    if (n == null) { host.merge.widthBasis = "sum"; applyMergeRequired(host); return; }
    host.merge.widthBasis = "typed"; host.spec.w = fmtIn(n);
  }
  function mergeWidthText(host) {
    if (!isMerge(host)) return "";
    var u = host.merge.units, req = mergeRequired(u);
    if (host.merge.widthBasis === "typed") return "Required width " + fmtIn(num(host.spec.w)) + " is from the merge drawing, typed at setup.";
    if (req.w == null) return "Required width is not set — a unit has no required width.";
    if (req.basis === "table") return "Required width " + fmtIn(req.w) + " is the brand's own dual-install figure, not the sum of the units (" +
      u.map(function (x) { return fmtIn(num(x.spec.w)); }).join(" + ") + " = " + fmtIn(u.reduce(function (a, x) { return a + (num(x.spec.w) || 0); }, 0)) + "). " + req.source + ".";
    if (req.basis === "brand-sum") return "Required width " + fmtIn(req.w) + " — " + req.source + " (" +
      u.map(function (x) { return fmtIn(num(x.spec.w)); }).join(" + ") + ").";
    return "Required width " + fmtIn(req.w) + " is the sum of the unit openings (" +
      u.map(function (x) { return fmtIn(num(x.spec.w)); }).join(" + ") + "). Confirm against the merge kit instructions.";
  }
  /* which unit's door hinges where — it picks the Sub-Zero kit and decides
     whether Monogram needs its 1/2" between units */
  var HINGE_SIDES = [{ k: "left", label: "Hinge left" }, { k: "right", label: "Hinge right" }];
  function setUnitHinge(host, idx, side) {
    if (!isMerge(host) || !host.merge.units[idx]) return;
    host.merge.units[idx].hinge = host.merge.units[idx].hinge === side ? "" : side;
  }
  function hingeConfig(host) {
    var u = mergeUnits(host);
    if (u.length !== 2 || !u[0].hinge || !u[1].hinge) return "";
    if (u[0].hinge === "left" && u[1].hinge === "right") return "handle-to-handle";
    if (u[0].hinge === "right" && u[1].hinge === "left") return "hinge-to-hinge";
    return "hinge-to-handle";
  }
  /* the kit the brand calls for, by name — and the part when the hinges say which */
  function mergeKitHint(host) {
    var t = mergeTableFor(mergeUnits(host));
    if (!t) return "";
    var cfg = hingeConfig(host);
    if (t.kitByHinge && cfg) return t.brand.replace(/ columns$/, "") + " dual installation kit " + t.kitByHinge[cfg] + " (" + cfg + ")";
    return t.kit;
  }
  function mergeNotes(host) {
    var t = mergeTableFor(mergeUnits(host)), out = [];
    if (!t) return out;
    (t.notes || []).forEach(function (n) { out.push(n); });
    var u = mergeUnits(host);
    if (/Monogram/.test(t.brand) && u.length === 2 && u[0].hinge && u[1].hinge && u[0].hinge !== u[1].hinge) out.unshift("This pair swings left and right: Monogram asks for 1/2\" between the units.");
    return out;
  }
  function kitState(host) { return (isMerge(host) && host.merge.kit && host.merge.kit.state) || ""; }
  function kitLabel(k) { var s = KIT_STATES.filter(function (x) { return x.k === k; })[0]; return s ? s.label : ""; }
  /* Kit corrections are Wilson's, never the builder's: the kit is an
     accessory on Wilson's order. */
  /* =====================================================================
     THE RUN — what stands between a dishwasher and its sink cabinet
     ---------------------------------------------------------------------
     Side by side, the hoses and the cord that come with the dishwasher
     reach. A cabinet in between wider than 8" and they do not: Wilson
     brings extension kits (drain hose, supply line, power cord), and the
     salesperson has to know before the truck is loaded (Cayden, 23 Oct). */
  var EXTENSION_GAP_IN = 8;
  var EXTENSION_KINDS = [
    { k: "drain", label: "Drain hose", noun: "drain hose" },
    { k: "water", label: "Water supply line", noun: "water supply line" },
    { k: "power", label: "Power cord", noun: "power cord" }
  ];
  function runGapOf(it) { return (it && it.runGap) || { kind: "", w: "", ext: [] }; }
  function setRunGap(it, kind, w) {
    var prev = runGapOf(it);
    it.runGap = { kind: kind || "", w: kind === "cabinet" ? (w == null ? "" : String(w)) : "",
                  ext: kind === "cabinet" ? (prev.ext && prev.ext.length ? prev.ext.slice() : ["drain"]) : [] };
  }
  /* which extensions the installer says are needed — the drain hose by
     default ("should be just drain mostly" — Cayden, 23 Oct); the supply
     line and the cord are added when they fall short too */
  function extensionsOf(it) {
    var g = runGapOf(it);
    return (g.ext && g.ext.length) ? g.ext : ["drain"];
  }
  function toggleExtension(it, k) {
    var g = runGapOf(it), list = extensionsOf(it).slice();
    var i = list.indexOf(k);
    if (i >= 0) { if (list.length > 1) list.splice(i, 1); } else list.push(k);
    it.runGap = Object.assign({}, g, { ext: EXTENSION_KINDS.map(function (e) { return e.k; }).filter(function (x) { return list.indexOf(x) >= 0; }) });
  }
  function extensionWords(it) {
    var names = EXTENSION_KINDS.filter(function (e) { return extensionsOf(it).indexOf(e.k) >= 0; }).map(function (e) { return e.noun; });
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }
  function runGapAnswered(it) { return !!runGapOf(it).kind; }
  function needsExtensions(it) {
    var g = runGapOf(it);
    return isDishwasherish(it) && g.kind === "cabinet" && num(g.w) != null && num(g.w) > EXTENSION_GAP_IN;
  }
  function runFindings(it) {
    if (!needsExtensions(it)) return [];
    var g = runGapOf(it);
    var words = extensionWords(it), one = extensionsOf(it).length === 1;
    return [Object.assign(derivedFix(it, "run:ext",
      "Extension " + (one ? "kit" : "kits") + " needed — " + words + ": a " + fmtIn(num(g.w)) + " cabinet sits between the dishwasher and the sink cabinet. Have " + (one ? "it" : "them") + " on the truck.",
      "internal"), { owner: fixMeta(it, "run:ext").owner || "internal" })];
  }

  function mergeFindings(host) {
    if (!isMerge(host)) return [];
    var out = [], ks = kitState(host), models = host.merge.units.map(function (u) { return u.model; }).filter(Boolean).join(" + ");
    var kitName = mergeKitHint(host);
    if (ks === "missing") out.push(Object.assign(derivedFix(host, "kit", "Order the " + (kitName || "join / merge kit") + " for " + models + " — none on the order. The units cannot be set without it.", "internal"), { owner: fixMeta(host, "kit").owner || "internal" }));
    else if (ks === "ordered") out.push(Object.assign(derivedFix(host, "kit", "Join / merge kit for " + models + " is ordered — confirm it is on the truck with the units.", "internal"), { owner: fixMeta(host, "kit").owner || "wilson", kind: "note" }));
    return out;
  }
  /* A unit's connection list, keyed so answers never collide. */
  function unitUtilities(host) {
    var out = [];
    host.merge.units.forEach(function (u, i) {
      var e = findModel(u.model);
      var list = (u.utilitiesSpec && u.utilitiesSpec.length) ? u.utilitiesSpec
        : u.utilitiesNone ? [] : e && e.utilities ? e.utilities : (e ? [] : genericUtilitiesFor(u));
      list.forEach(function (x) {
        out.push(Object.assign({}, x, {
          key: "u" + i + ":" + x.key, base: x.key,
          unit: { idx: i, model: u.model, pos: unitPos(i, host.merge.units.length), appliance: u.appliance }
        }));
      });
    });
    return out;
  }
  function utilBase(u) { return (u && (u.base || u.key)) || ""; }
  /* The label with the unit named, for a merge: "Power · CL3050U (left)". */
  function utilLabel(u) {
    if (!u) return "";
    return u.label + (u.unit ? " · " + (u.unit.model || u.unit.appliance) + " (" + u.unit.pos + ")" : "");
  }

  /* =====================================================================
     PHOTO MARKUP — freehand, shapes, text on any photograph
     ---------------------------------------------------------------------
     Hudson circles the stub and writes "MOVE" on the photo before it goes
     to the builder. The marks are vectors in photo coordinates (u, v in
     0..1), never burned into the pixels, so the original stays evidence
     and the marks print at any size. `ar` is the photo's height/width so
     circles stay round. */
  var MARK_COLORS = [
    { k: "red",    c: "#d92d20" },
    { k: "yellow", c: "#f5b400" },
    { k: "green",  c: "#1f9d55" },
    { k: "white",  c: "#ffffff" },
    { k: "black",  c: "#111111" }
  ];
  var MARK_TOOLS = [
    { k: "pen",     label: "Draw" },
    { k: "arrow",   label: "Arrow" },
    { k: "rect",    label: "Box" },
    { k: "ellipse", label: "Circle" },
    { k: "text",    label: "Text" }
  ];
  function blankMarkup(ar) { return { ar: ar || 0.75, strokes: [], shapes: [], texts: [] }; }
  function markupOf(photo) {
    var m = photo && photo.markup;
    if (!m) return null;
    m.strokes = m.strokes || []; m.shapes = m.shapes || []; m.texts = m.texts || [];
    return m;
  }
  function markupCount(m) { return m ? m.strokes.length + m.shapes.length + m.texts.length : 0; }
  function hasMarkup(photo) { return markupCount(markupOf(photo)) > 0; }
  /* Undo is one list, in the order things were drawn. */
  function markupUndo(m) {
    if (!m) return;
    var all = [].concat(
      m.strokes.map(function (x) { return { at: x.ts || 0, list: m.strokes, x: x }; }),
      m.shapes.map(function (x) { return { at: x.ts || 0, list: m.shapes, x: x }; }),
      m.texts.map(function (x) { return { at: x.ts || 0, list: m.texts, x: x }; }));
    if (!all.length) return;
    all.sort(function (a, b) { return b.at - a.at; });
    var last = all[0]; last.list.splice(last.list.indexOf(last.x), 1);
  }
  function markColor(k) {
    var c = MARK_COLORS.filter(function (x) { return x.k === k; })[0];
    return c ? c.c : (k && k.charAt(0) === "#" ? k : MARK_COLORS[0].c);
  }
  /* The SVG. viewBox is 1000 × 1000·ar so the picture's own aspect governs;
     strokes are non-scaling so a 3px line is 3px on a thumbnail and on a
     printed page alike. */
  function markupSvg(m, cls) {
    if (!m) return "";
    var W = 1000, Hh = Math.round(1000 * (m.ar || 0.75));
    var X = function (u) { return (u * W).toFixed(1); }, Y = function (v) { return (v * Hh).toFixed(1); };
    var out = "";
    m.strokes.forEach(function (st) {
      if (!st.pts || st.pts.length < 2) return;
      var d = st.pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]) + " " + Y(p[1]); }).join(" ");
      out += '<path d="' + d + '" fill="none" stroke="' + markColor(st.c) + '" stroke-width="' + (st.w || 4) + '" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    });
    m.shapes.forEach(function (sh) {
      var c = markColor(sh.c), a = sh.a, b = sh.b;
      if (!a || !b) return;
      if (sh.k === "rect") {
        out += '<rect x="' + X(Math.min(a[0], b[0])) + '" y="' + Y(Math.min(a[1], b[1])) + '" width="' + X(Math.abs(b[0] - a[0])) + '" height="' + Y(Math.abs(b[1] - a[1])) +
          '" fill="none" stroke="' + c + '" stroke-width="4" vector-effect="non-scaling-stroke"/>';
      } else if (sh.k === "ellipse") {
        out += '<ellipse cx="' + X((a[0] + b[0]) / 2) + '" cy="' + Y((a[1] + b[1]) / 2) + '" rx="' + X(Math.abs(b[0] - a[0]) / 2) + '" ry="' + Y(Math.abs(b[1] - a[1]) / 2) +
          '" fill="none" stroke="' + c + '" stroke-width="4" vector-effect="non-scaling-stroke"/>';
      } else if (sh.k === "arrow") {
        var x1 = a[0] * W, y1 = a[1] * Hh, x2 = b[0] * W, y2 = b[1] * Hh;
        /* the head is 4.5% of the picture's width plus a non-scaling
           outline, so it reads on a thumbnail and on a printed page */
        var ang = Math.atan2(y2 - y1, x2 - x1), L = 45, sp = 0.42;
        var p1 = [x2 - L * Math.cos(ang - sp), y2 - L * Math.sin(ang - sp)], p2 = [x2 - L * Math.cos(ang + sp), y2 - L * Math.sin(ang + sp)];
        out += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + c + '" stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
          '<polygon points="' + x2.toFixed(1) + "," + y2.toFixed(1) + " " + p1[0].toFixed(1) + "," + p1[1].toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1) + '" fill="' + c + '" stroke="' + c + '" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
      }
    });
    m.texts.forEach(function (t) {
      if (!t.at || !t.t) return;
      var c = markColor(t.c), halo = c === "#ffffff" ? "#111111" : "#ffffff";
      out += '<text x="' + X(t.at[0]) + '" y="' + Y(t.at[1]) + '" font-size="' + (t.s || 44) + '" font-weight="800" font-family="Inter, system-ui, sans-serif" fill="' + c +
        '" stroke="' + halo + '" stroke-width="6" paint-order="stroke" stroke-linejoin="round">' + escapeXml(t.t) + "</text>";
    });
    if (!out) return "";
    return '<svg class="' + (cls || "sw-markup") + '" viewBox="0 0 ' + W + " " + Hh + '" preserveAspectRatio="none">' + out + "</svg>";
  }
  function escapeXml(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; });
  }
  /* Any photograph on the walk, by id — an opening's, the overlay's, or the access route's. */
  function photoById(walk, id) {
    if (!walk || !id) return null;
    for (var i = 0; i < walk.items.length; i++) {
      var it = walk.items[i];
      for (var j = 0; j < it.photos.length; j++) if (it.photos[j].id === id) return { photo: it.photos[j], item: it };
    }
    var ap = (walk.access && walk.access.photos) || [];
    for (var k = 0; k < ap.length; k++) if (ap[k].id === id) return { photo: ap[k], item: null, access: true };
    return null;
  }
  function markupPayload(p) {
    var m = markupOf(p);
    return m && markupCount(m) ? { ar: m.ar, strokes: m.strokes.length, shapes: m.shapes.length, texts: m.texts.map(function (t) { return t.t; }), json: JSON.stringify(m) } : null;
  }

  /* =====================================================================
     FORMS — different appliances are measured on different sheets
     ---------------------------------------------------------------------
     The W × D × H cavity is right for undercounter units, dishwashers and
     built-in refrigeration. The corpus measures four more things on their
     own terms: a cooktop is a cutout read from the countertop DOWN; a hood
     has no cavity at all and is referenced to the countertop and the
     ceiling; laundry is all connections and a clean-out; a grill is a
     cutout plus the clearance behind it for the lid. Each form relabels
     the axes, adds its own measured fields (with the datum named) and its
     own yes / no checks, and a "no" is a correction with an owner. */
  var FORMS = {
    standard: { k: "standard", short: "Cavity", label: "Cavity (W × D × H)", fields: [], checks: [] },
    cooktop: {
      k: "cooktop", short: "Cooktop", label: "Cooktop / rangetop cutout",
      dims: { w: { label: "Cutout width", datum: "countertop cutout, side to side" },
              d: { label: "Cutout depth", datum: "countertop cutout, front to back" },
              h: { label: "Countertop to floor of cabinet", datum: "underside of countertop to the shelf or drawer below" } },
      fields: [
        { k: "trimRecess", label: "Trim recess below the countertop", hint: "how far the cutout edge sits below the finished top" },
        { k: "behind", label: "Behind the cutout to the wall", hint: "back edge of the cutout to the backsplash", minKey: "behindMinIn" },
        { k: "drawerGap", label: "Drawer below — top of drawer to underside of top", hint: "the unit's body needs this", minKey: "drawerGapMinIn" }
      ],
      checks: [
        { k: "ctLevel", q: "Countertop level front to back at the cutout?", fix: "Level the countertop front to back at the cutout — the unit will not sit flat.", owner: "countertop" },
        { k: "ctDone", q: "Countertop and backsplash finished?", fix: "Finish the countertop and backsplash before the cooktop is set.", owner: "countertop" },
        { k: "utilCut", q: "Utility opening cut in the cabinet below?", fix: "Cut the utility opening in the cabinet below for the gas and power drop.", owner: "cabinet" },
        { k: "downdraft", q: "Downdraft or drawer clears the unit body below?", fix: "The drawer or downdraft below fouls the unit body — rework the cabinet so the body drops clear.", owner: "cabinet" },
        { k: "gasShutoff", q: "Gas shutoff in the cabinet below, reachable?", fix: "Put the gas shutoff in the cabinet below where it can be reached with the cooktop set.", owner: "plumber" },
        { k: "connBelow", q: "Receptacle or junction box in the cabinet below, within reach of the cord or conduit?", fix: "Move the receptacle / junction box into the cabinet below within reach of the unit's cord or conduit.", owner: "electrician" }
      ]
    },
    /* A range between cabinets: the opening is width-and-height, and
       what fails is behind it — the gas stub standing into the body, a
       shutoff nobody can reach, a countertop out of level, no way to
       anchor the anti-tip (Hudson's notes ×12 / ×8 / ×2; 30 spec books,
       22 Oct). */
    range: {
      k: "range", short: "Range", label: "Range between cabinets",
      dims: { w: { label: "Opening width", datum: "cabinet to cabinet, throughout — front and back" },
              d: { label: "Countertop depth", datum: "back wall to the cabinet face" },
              h: { label: "Countertop height", datum: "finished floor to the countertop — the range top must meet it" } },
      fields: [
        { k: "gasProj", label: "Gas stub projects from the wall", hint: "the sheet allows 2\" at most", maxIn: 2, owner: "plumber",
          fixOver: "Cut the gas stub back to 2\" or less from the wall, with a 90° elbow — it projects {v} and will stand into the range body." },
        { k: "recepH", label: "Receptacle height off the floor", hint: "where the sheet draws it — low, behind the range" }
      ],
      checks: [
        { k: "gasShutoff", q: "Gas shutoff reachable with the range in?", fix: "Move the gas shutoff where it can be reached with the range in place.", owner: "plumber" },
        { k: "ctLevel", q: "Countertop level front to back at the opening?", fix: "Level the countertop front to back at the range opening — the range top will not meet it.", owner: "countertop" },
        { k: "ctDone", q: "Countertop and backsplash finished?", fix: "Finish the countertop and backsplash before the range is set.", owner: "countertop" },
        { k: "widthThrough", q: "Opening width holds front to back?", fix: "Open the cabinets to the sheet's width throughout — the opening narrows toward the back.", owner: "cabinet" },
        { k: "antiTip", q: "Anti-tip bracket can anchor at the back (solid floor or wall)?", fix: "Provide solid anchoring at the back of the opening for the anti-tip bracket.", owner: "builder" },
        { k: "floorIn", q: "Finished flooring in under the range?", fix: "Install the finished flooring under the range before it is set, or the height changes.", owner: "flooring" },
        { k: "islandTrim", q: "Island install — is the island / rear trim kit on the order?", fix: "Add the island trim kit to the order — the back of the range will show.", owner: "sales", kind: "question" }
      ]
    },
    /* A traditional built-in: one cabinet, grille on top, outlet high in
       a corner, anti-tip by floor brackets (Sub-Zero) or a 2×4 to the
       wall studs at 84" (Monogram / JennAir / Thermador). What fails on
       site: no finished returns, the soffit out of level or too low, the
       width not holding front to back, a water shutoff behind the unit. */
    builtin: {
      k: "builtin", short: "Built-in", label: "Built-in refrigeration (one cabinet)",
      dims: { w: { label: "Opening width", datum: "finished return to finished return, throughout" },
              d: { label: "Opening depth", datum: "back wall to the face of the cabinets" },
              h: { label: "Opening height", datum: "floor to the header, at the lowest point of the floor" } },
      fields: [
        { k: "soffitH", label: "Soffit / header off the floor", hint: "the sheet's 84\" is to the top frame" },
        { k: "recepH", label: "Receptacle height off the floor", hint: "the sheet puts it 75\"–77\" up, in its corner" }
      ],
      checks: [
        { k: "returnsBoth", q: "Finished returns on both sides to secure the unit?", fix: "Provide finished returns on both sides of the opening — the unit secures to them.", owner: "cabinet" },
        { k: "soffitLevel", q: "Soffit / header level across the opening?", fix: "Level the soffit / header across the opening — the grille frame will not sit true.", owner: "cabinet" },
        { k: "widthThrough", q: "Opening width holds front to back?", fix: "Open the cabinets to the sheet's width throughout — the opening narrows toward the back.", owner: "cabinet" },
        { k: "antiTip", q: "Anti-tip anchoring as the sheet shows (floor plate / concrete for floor brackets, studs at 84\" for a wall block)?", fix: "Provide the anti-tip anchoring the sheet calls for — the unit cannot be set without it.", owner: "builder" },
        { k: "grilleClear", q: "Clearance above for the grille per the sheet?", fix: "Leave the clearance above the unit the sheet calls for at the grille.", owner: "cabinet" },
        { k: "floorLevel", q: "Floor under the unit level with the room's finished floor?", fix: "Bring the floor under the unit level with the finished floor — the unit levels to the floor, not the cabinets.", owner: "flooring" },
        { k: "shutoffClear", q: "Water shutoff reachable without pulling the unit?", fix: "Water shutoff is behind the unit — reachable only by pulling it. Fine unless the depth is tight; check the valve's projection against the opening depth at set.", owner: "wilson", kind: "note" }
      ]
    },
    /* An undercounter unit: a 24" cavity under the counter. Hudson's
       near-universal checks: outlet low (≤ 4" off the floor) in the
       sheet's zone, depth 24" throughout, flooring in or its thickness
       noted, anti-tip for the drawer / undercounter models that take one. */
    undercounter: {
      k: "undercounter", short: "Undercounter", label: "Undercounter cavity",
      dims: { w: { label: "Opening width", datum: "finished return to finished return, throughout — 1/8\" reveals" },
              d: { label: "Opening depth", datum: "back wall to the face of the cabinets, throughout" },
              h: { label: "Opening height", datum: "finished floor to the underside of the countertop, at the lowest point" } },
      fields: [
        { k: "recepH", label: "Receptacle height off the floor", hint: "the sheet puts it low, 4\" or less on most" }
      ],
      checks: [
        { k: "depthThrough", q: "Depth holds front to back (no stub, box or stringer in the way)?", fix: "Clear the opening to the sheet's depth throughout — the unit will stand proud.", owner: "cabinet" },
        { k: "flooringIn", q: "Finished flooring in under the unit?", fix: "Install the finished flooring under the unit before it is set, or the height changes.", owner: "flooring" },
        { k: "antiTip", q: "Anti-tip anchoring possible where the sheet shows (floor or cabinet)?", fix: "Provide the anti-tip anchoring the sheet calls for under the counter.", owner: "builder" },
        { k: "returnsBoth", q: "Finished returns on both sides to secure the unit?", fix: "Provide finished returns on both sides of the opening — the unit secures to them.", owner: "cabinet" }
      ]
    },
    /* A column: one or more tall single-purpose units, height-adjustable
       at the toe kick, vented through the kickplate, 3½" finished returns
       all round, outlet low (Sub-Zero) or in a recess / the cabinet beside
       (F&P, Miele), anti-tip to wall-and-floor — or screwed to ¾" plywood
       side panels (JennAir, Miele). A merge is this form. */
    column: {
      k: "column", short: "Column", label: "Column refrigeration",
      dims: { w: { label: "Opening width", datum: "finished return to finished return, throughout — exact" },
              d: { label: "Opening depth", datum: "back wall to the face of the cabinets — 25\" on most columns" },
              h: { label: "Opening height", datum: "floor to the header, at the lowest point of the floor — 84\" on most columns" } },
      fields: [
        { k: "toeKick", label: "Toe kick height", hint: "2\"–6\" on Sub-Zero, 4\" typical; the panel is cut to it" },
        { k: "returnDepth", label: "Finished return depth", hint: "3 1/2\" minimum on Sub-Zero and Monogram" }
      ],
      checks: [
        { k: "returnsAll", q: "Finished returns on all sides, 3 1/2\" deep (or the sheet's figure)?", fix: "Provide 3 1/2\" finished returns on both sides and the top — the column needs them to secure and to seal the look.", owner: "cabinet" },
        { k: "heightHolds", q: "Opening height holds at the lowest point of the floor?", fix: "Hold the opening height at the sheet's figure at the lowest point of the floor — the toe kick cannot make up the difference.", owner: "cabinet" },
        { k: "widthThrough", q: "Opening width holds front to back?", fix: "Open the cabinets to the sheet's width throughout — the opening narrows toward the back.", owner: "cabinet" },
        { k: "antiTip", q: "Anti-tip anchoring possible: studs / plate / concrete about 24\" from the front, or 3/4\" plywood side panels where the sheet screws to them?", fix: "Provide the anti-tip anchoring the sheet calls for (wall and floor, or 3/4\" plywood side panels anchored to the floor or wall).", owner: "builder" },
        { k: "floorLevel", q: "Floor under the unit level with the room's finished floor?", fix: "Bring the floor under the column level with the finished floor — it levels to the floor, not the cabinets.", owner: "flooring" },
        { k: "ventClear", q: "Kickplate / plinth vent clear (nothing closes the toe kick)?", fix: "Keep the toe kick open at the column — it breathes through the kickplate.", owner: "cabinet" },
        { k: "shutoffClear", q: "Water shutoff reachable without pulling the unit?", fix: "Water shutoff is behind the column — reachable only by pulling it. Fine unless the depth is tight; check the valve's projection against the 25\" at set.", owner: "wilson", kind: "note" }
      ]
    },
    /* A finished hood — wall, chimney, under-cabinet, island — hung where
       the sheet's band says. The elevation places it from the readings:
       the height above the cooking surface and the centre off the
       cooktop's (v0.9.81: no more dragging the box — "place a mock-up
       where it actually will be, based on our cooking surface to hood
       measurement"). */
    hood: {
      k: "hood", short: "Hood", label: "Hood — finished unit, no cavity",
      dims: { w: { label: "Hood width available", datum: "between the cabinets or walls either side" },
              d: { label: "Hood depth available", datum: "back wall to the face of the hood" },
              h: { label: "Height above cooking surface", datum: "cooking surface to the bottom edge of the hood" } },
      fields: [
        { k: "counterH", label: "Countertop height", hint: "finished floor to the cooking surface, usually 36", more: true },
        { k: "toCeiling", label: "Countertop to ceiling", hint: "sets the duct cover" },
        { k: "hoodOff", label: "Hood centre off the cooktop centre", hint: "zero when centred", signed: true },
        { k: "cabBottom", label: "Wall cabinets start above the counter", hint: "usually 18", more: true },
        { k: "coverH", label: "Duct cover height needed", hint: "top of hood to ceiling or soffit", more: true },
        { k: "ductDia", label: "Duct diameter", hint: "what is in the wall or ceiling", minKey: "ductMinIn" },
        { k: "ductOff", label: "Duct centre off the back wall", hint: "so the hood collar lands on it", more: true }
      ],
      checks: [
        { k: "blocking", q: "Blocking in the wall or ceiling to hang it?", fix: "Add blocking in the wall / ceiling at the hood mounting points.", owner: "builder" },
        { k: "ductIn", q: "Duct run in place and terminated outside?", fix: "Complete the duct run to the exterior before the hood is set.", owner: "hvac" },
        { k: "makeup", q: "Make-up air provided where required?", fix: "Confirm make-up air — the blower size requires it by code.", owner: "hvac", kind: "question" },
        { k: "access", q: "Access to the duct connection with the hood up?", fix: "Leave an access opening at the duct connection.", owner: "builder" },
        { k: "power", q: "Power at the hood location?", fix: "Add the power for the hood at the mounting location.", owner: "electrician" }
      ]
    },
    /* A custom hood (the shroud: wood, plaster, metal — the cabinet shop's)
       with an insert or liner set into its bottom. Inserts and liners are
       54% of the ventilation Wilson sells and 77% of what is on site-walk
       jobs (ePASS, 3 years), so this is the ventilation walk: the shroud's
       cutout against the insert's spec, the shroud's bottom above the
       cooking surface, room inside for the insert and its collar, the
       duct and power brought in where the insert wants them, and a way
       to reach the connections once the insert is up. */
    shroud: {
      k: "shroud", short: "Shroud + insert", label: "Custom hood (shroud) with an insert",
      dims: { w: { label: "Shroud cutout width", datum: "the opening cut in the shroud bottom for the insert, side to side" },
              d: { label: "Shroud cutout depth", datum: "the opening cut in the shroud bottom, front to back" },
              h: { label: "Shroud bottom above cooking surface", datum: "cooking surface to the underside of the shroud at the cutout" } },
      fields: [
        { k: "counterH", label: "Countertop height", hint: "finished floor to the cooking surface, usually 36", more: true },
        { k: "toCeiling", label: "Countertop to ceiling", hint: "the shroud runs to it or stops short" },
        { k: "shroudW", label: "Shroud width overall", hint: "at least the cooking surface's width", minFrom: "cookW" },
        { k: "shroudInnerH", label: "Inside height of the shroud", hint: "from the cutout up to its top — the insert and its collar go in here", minFrom: "insertH" },
        { k: "hoodOff", label: "Shroud centre off the cooktop centre", hint: "zero when centred", signed: true },
        { k: "ductDia", label: "Duct diameter", hint: "what comes into the shroud", minKey: "ductMinIn" },
        { k: "ductOff", label: "Duct centre off the back wall", hint: "where the sheet puts the collar", more: true }
      ],
      checks: [
        { k: "shroudBuilt", q: "Shroud built and finished — not just framed?", fix: "Finish the custom hood before delivery — the insert sets into the finished shroud.", owner: "cabinet" },
        { k: "cutoutClean", q: "Cutout square and clean, with the sheet's clearance all round for the insert?", fix: "Cut the shroud bottom to the insert's cutout size, square, with the sheet's clearance.", owner: "cabinet" },
        { k: "blocking", q: "Structure in the shroud to carry the insert (the sheet's weight / blocking)?", fix: "Add the blocking or framing the sheet calls for inside the shroud — the insert hangs from it.", owner: "builder" },
        { k: "ductIn", q: "Duct run inside the shroud, landing on the collar location, and terminated outside?", fix: "Run the duct into the shroud at the insert's collar location and complete it to the exterior.", owner: "hvac" },
        { k: "access", q: "Access inside the shroud to make the duct and power connections with the insert up?", fix: "Provide access inside the shroud (an open top, a removable panel) to connect the duct and power once the insert is in.", owner: "cabinet" },
        { k: "power", q: "Power inside the shroud at the insert's connection point?", fix: "Bring the hood circuit into the shroud at the insert's junction box / knockout location.", owner: "electrician" },
        { k: "makeup", q: "Make-up air provided where required?", fix: "Confirm make-up air — the blower size requires it by code.", owner: "hvac", kind: "question" }
      ]
    },
    laundry: {
      k: "laundry", short: "Laundry", label: "Laundry",
      dims: { w: { label: "Width", datum: "wall to wall or cabinet to cabinet" },
              d: { label: "Depth", datum: "back wall to the door or cabinet face" },
              h: { label: "Height", datum: "floor or pedestal to the counter or shelf" } },
      fields: [
        { k: "platformH", label: "Pedestal / platform height", hint: "zero if on the floor" },
        { k: "doorClear", label: "Door or closet clearance in front", hint: "the door has to open", minKey: "doorClearMinIn" }
      ],
      checks: [
        { k: "waterBox", q: "Recessed water box with hot and cold?", fix: "Install a recessed water box with hot and cold supplies at the washer.", owner: "plumber" },
        { k: "hammer", q: "Hammer arrestors on the supplies?", fix: "Add hammer arrestors on the washer supplies.", owner: "plumber" },
        { k: "drain", q: "Drain — standpipe or box, at height?", fix: "Provide the washer drain (standpipe or box) at the height on the sheet.", owner: "plumber" },
        { k: "ductPort", q: "Dryer duct port recessed in the wall?", fix: "Recess the dryer duct port so the dryer sits back to the wall.", owner: "hvac" },
        { k: "cleanout", q: "Clean-out cut back and capped flush?", fix: "Cut the clean-out back and cap it flush — the unit cannot sit back with it projecting.", owner: "plumber" },
        { k: "dryerPower", q: "Dryer power — the receptacle the sheet calls for?", fix: "Provide the dryer receptacle the sheet calls for (240 V).", owner: "electrician" }
      ]
    },
    grill: {
      k: "grill", short: "Grill", label: "Grill / outdoor cutout",
      dims: { w: { label: "Cutout width", datum: "countertop cutout, side to side" },
              d: { label: "Cutout depth", datum: "countertop cutout, front to back" },
              h: { label: "Cutout height", datum: "countertop to the floor of the enclosure" } },
      fields: [
        { k: "behind", label: "Behind the cutout to the wall (lid clearance)", hint: "the lid swings back", minKey: "behindMinIn" },
        { k: "overhang", label: "Countertop overhang / bullnose", hint: "front edge past the face" },
        { k: "notch", label: "Notch for the gas and power", hint: "size of the cutout in the enclosure" }
      ],
      checks: [
        { k: "combust", q: "Non-combustible construction at the cutout?", fix: "Use non-combustible construction at the grill cutout — the sheet requires it.", owner: "builder" },
        { k: "gasAccess", q: "Gas shutoff reachable with the grill in?", fix: "Relocate the gas shutoff so it is reachable with the grill set.", owner: "plumber" },
        { k: "vent", q: "Enclosure vented for gas?", fix: "Add the enclosure vents the sheet calls for.", owner: "builder" },
        { k: "drainage", q: "Enclosure drains — no standing water?", fix: "Provide drainage in the enclosure floor.", owner: "builder" }
      ]
    }
  };
  var FORM_KEYS = ["standard", "builtin", "column", "undercounter", "range", "cooktop", "hood", "shroud", "laundry", "grill"];
  var CHECK_ANSWERS = [
    { k: "yes", label: "Yes", tone: "good" },
    { k: "no",  label: "No",  tone: "poor" },
    { k: "na",  label: "N/A", tone: "" }
  ];
  /* Which form: the tech's choice first, then the category, then the words. */
  var HOODISH_RE = /\bhoods?\b|ventilation|vent[\s-]?hood|downdraft|canopy|chimney|hood liner|\bliner\b|blower|extractor|perimetric|accolade|\bcfm\b/i;
  function formKeyFor(it) {
    if (it.formKey && FORMS[it.formKey]) return it.formKey;
    var e = itemEntry(it);
    if (e && e.formKey && FORMS[e.formKey]) return e.formKey;      /* a downdraft is a countertop slot, not a hood band */
    var cat = ((e && e.category) || it.category || "").toLowerCase();
    var words = (((e && e.appliance) || it.appliance || "") + " " + (it.model || "")).toLowerCase();
    /* the words a sheet or a quote line uses for a hood without saying
       "hood": canopy, chimney, liner, blower, downdraft, the JennAir
       "Perimetric"/"Accolade" names (Cayden, 22 Oct: the hood on
       Q00084974 walked as a cavity) */
    if (HOODISH_RE.test(cat) || HOODISH_RE.test(words)) {
      /* an insert or liner goes into a custom hood: the shroud is what is walked */
      var ht = (it.hood && it.hood.type) || (e && e.variations && e.variations[0] && e.variations[0].hood && e.variations[0].hood.type) || "";
      if (ht === "insert" || /insert|liner/.test(words)) return "shroud";
      return "hood";
    }
    if (/cooktop|rangetop|range top/.test(cat) || /cooktop|rangetop|range ?top/.test(words)) return "cooktop";
    if (/\branges?\b|slide[- ]in|freestanding|dual[- ]fuel/.test(cat) || /\brange\b|slide[- ]in|dual[- ]fuel/.test(words)) return "range";
    if (/dishwasher|\bdw\b/.test(cat + " " + words)) return "standard";          /* a dishwasher is not a washer */
    if (/laundry|\bwasher\b|\bdryer\b|washtower/.test(cat) || /\bwasher\b|\bdryer\b|laundry|washtower/.test(words)) return "laundry";
    if (/grill|outdoor/.test(cat) || /\bgrill\b/.test(words)) return "grill";
    var rk = refrigKind(it);
    if (rk === "column") return "column";
    if (rk === "builtin") return "builtin";
    if (rk === "undercounter") return "undercounter";
    return "standard";
  }
  function formOf(it) { return FORMS[formKeyFor(it)] || FORMS.standard; }
  function setForm(it, key) { it.formKey = FORMS[key] ? key : ""; }
  function formVal(it, k) { return num(it.form && it.form[k]); }
  function setFormVal(it, k, v) { it.form = it.form || {}; it.form[k] = v == null || v === "" ? "" : fmtIn(num(v)); }
  function formCheck(it, k) { return (it.formChecks && it.formChecks[k]) || ""; }
  function setFormCheck(it, k, v) { it.formChecks = it.formChecks || {}; it.formChecks[k] = it.formChecks[k] === v ? "" : v; }
  /* A field minimum comes off the spec entry / variation (`form.behindMinIn`
     …). Nothing is invented: no key, no verdict, the reading just prints. */
  function formFieldMin(it, fd) {
    if (fd.minFrom) {
      var sp = hoodSpec(it, walkOfItem(it));
      if (fd.minFrom === "insertH") return sp.unitH || null;        /* the insert's own height — the shroud has to swallow it */
      if (fd.minFrom === "cookW") return sp.cookW || null;          /* a hood no narrower than what cooks under it */
      return null;
    }
    if (!fd.minKey) return null;
    var v = itemVariation(it), e = itemEntry(it);
    var src = (v && v.form) || (e && e.form) || null;
    return src ? num(src[fd.minKey]) : null;
  }
  function formFieldVerdict(it, fd) {
    var val = formVal(it, fd.k), min = formFieldMin(it, fd);
    /* a field with a ceiling rather than a floor: the gas stub may project
       2" at most (Hudson's notes ×12) */
    if (fd.maxIn != null && val != null) {
      if (val <= fd.maxIn + 1e-9) return { state: "ok", text: "within the " + fmtIn(fd.maxIn) + " maximum" };
      return { state: "bad", text: fmtIn(val - fd.maxIn) + " over the " + fmtIn(fd.maxIn) + " maximum",
        fix: (fd.fixOver || ("Bring " + fd.label.toLowerCase() + " to " + fmtIn(fd.maxIn) + " or less — it measures " + fmtIn(val) + ".")).replace("{v}", fmtIn(val)), owner: fd.owner || "builder" };
    }
    if (val == null || min == null) return null;
    if (val + 1e-9 >= min) return { state: "ok", text: "meets " + fmtIn(min) + " minimum" };
    return { state: "bad", text: fmtIn(min - val) + " short of the " + fmtIn(min) + " minimum",
      fix: "Gain " + fmtIn(min - val) + " at " + fd.label.toLowerCase() + " — it measures " + fmtIn(val) + " against a minimum of " + fmtIn(min) + "." };
  }
  function formFindings(it) {
    var f = formOf(it), out = [];
    f.fields.forEach(function (fd) {
      var v = formFieldVerdict(it, fd);
      if (v && v.state === "bad") out.push({ key: "form:" + fd.k, label: fd.label, text: v.fix, kind: "dim", owner: v.owner || fd.owner || "builder" });
    });
    f.checks.forEach(function (c) {
      if (formCheck(it, c.k) === "no") out.push({ key: "chk:" + c.k, label: c.q, text: c.fix, kind: c.kind || "fix", owner: c.owner || "builder" });
    });
    return out;
  }
  function formAnswered(it) {
    var f = formOf(it);
    if (!f.checks.length) return true;
    return f.checks.every(function (c) { return !!formCheck(it, c.k); });
  }
  function formText(it) {
    var f = formOf(it), bits = [];
    f.fields.forEach(function (fd) { var v = formVal(it, fd.k); if (v != null) bits.push(fd.label + " " + fmtIn(v)); });
    return bits.join(" · ");
  }

  /* ---------- verdicts --------------------------------------------------- */
  /* Wilson accepting a reading that misses the sheet.

     From the Founders Suites notes: "height is just under spec, acceptable",
     "height variance is minor, no correction requested", "83 3/4 with Ram
     Board — remeasure after floor protection is removed". Three different
     openings where the number failed and Wilson did not want a correction.

     Without somewhere to put that, the packet punches the builder for things
     Wilson has already accepted, and a punch list with junk in it stops
     being read. Accepting is a decision with a reason attached, printed on
     the page — not a number quietly edited to fit. */
  var ACCEPT_REASONS = [
    "Minor variance — acceptable as built.",
    "Measured over floor protection — remeasure before set.",
    "Over spec on a minimum — acceptable here.",
    "Accepted by Wilson; installer to verify at set."
  ];
  function acceptedReason(item, k) {
    return (item.accepted && item.accepted[k]) || "";
  }
  function isAccepted(item, k) { return !!acceptedReason(item, k); }
  function acceptedUtilReason(item, key) {
    return (item.acceptedUtil && item.acceptedUtil[key]) || "";
  }
  /* The tech's own call on the status. Marking an opening Ready over a
     measured miss is a decision, not a contradiction — the True column
     7/8" wide for a proud install (Cayden, showroom walk) — so every miss
     the measurements found is accepted with the installer named, the
     reading still prints, and nothing goes on the builder's list. Taking
     the Ready off again lets the measurements speak again. */
  var INSTALLER_ACCEPT = "Accepted by the installer at the walk";
  function setStatus(item, k) {
    var was = item.status || "";
    item.status = was === k ? "" : k;
    item.accepted = item.accepted || {};
    item.acceptedUtil = item.acceptedUtil || {};
    if (item.status === "ready" && autoStatus(item) && autoStatus(item) !== "ready") {
      dimsFor(item).forEach(function (d) {
        if (rawVerdict(item, d.k).state === "bad" && !item.accepted[d.k]) item.accepted[d.k] = INSTALLER_ACCEPT;
      });
      utilitiesFor(item).forEach(function (u) {
        var a = item.utilities[u.key], mv = markVerdict(item, u);
        if ((a === "misplaced" || (mv && mv.out)) && !item.acceptedUtil[u.key]) item.acceptedUtil[u.key] = INSTALLER_ACCEPT;
      });
    } else {
      Object.keys(item.accepted).forEach(function (kk) { if (item.accepted[kk] === INSTALLER_ACCEPT) delete item.accepted[kk]; });
      Object.keys(item.acceptedUtil).forEach(function (kk) { if (item.acceptedUtil[kk] === INSTALLER_ACCEPT) delete item.acceptedUtil[kk]; });
    }
    return item.status;
  }

  function verdict(item, k) {
    var raw = rawVerdict(item, k);
    if (raw.state !== "bad" || !isAccepted(item, k)) return raw;
    /* The reading and the miss are both still true and both still print;
       what changes is that Wilson is not asking the builder to fix it. */
    return {
      state: "accepted", text: raw.text + " · accepted",
      miss: raw.text, reason: acceptedReason(item, k)
    };
  }
  /* The walk an item belongs to, for the job-level facts (flooring). */
  function walkOfItem(item) {
    var ws = STATE ? STATE.walks : [];
    for (var i = 0; i < ws.length; i++) {
      if ((ws[i].items || []).indexOf(item) >= 0) return ws[i];
    }
    return null;
  }
  function rawVerdict(item, k) {
    var spec = num(item.spec && item.spec[k]);
    var act = num(item.actual && item.actual[k]);
    var floorNote = "";
    if (k === "h" && act != null) {
      var ded = flooringDeduction(walkOfItem(item), item);
      if (ded) { act = act - ded; floorNote = " (read " + fmtIn(act + ded) + " over the subfloor; " + fmtIn(ded) + " flooring still to go in)"; }
    }
    if (item.actual && item.actual[k] === "NM") return { state: "skip", text: "not measured" };
    if (spec == null && act == null) return { state: "none", text: "—" };
    if (spec == null) return { state: "none", text: "no spec" };
    if (act == null) return { state: "none", text: "not measured" };
    var rule = (item.rule && item.rule[k]) || (k === "w" ? "exact" : "min");
    var tol = num(item.tol) != null ? num(item.tol) : DEF_TOL;
    var d = act - spec;
    /* DIM4 too — a cleat with a spec and a reading takes this same path,
       and "cleat setback" has to name itself in the fix line. */
    var dimDef = DIMS.concat([DIM4]).filter(function (x) { return x.k === k; })[0];
    var label = (dimDef ? dimDef.label : k).toLowerCase();
    /* Every correction Hudson writes carries the number to build to, the
       number it measures now, and the reason. "Reduce cavity width to
       23 5/8 for clean 1/8 reveals" — never "make it narrower". These
       lines are written to that shape. */
    var run = spreadText(item, k, spec, tol);
    if (rule === "min") {
      if (d >= -tol) return { state: "ok", text: d > tol ? fmtDelta(d) + " over min" : "meets min" };
      return { state: "bad", text: "short " + fmtIn(-d),
        fix: "Gain " + fmtIn(-d) + " of " + label + " — it measures " + fmtIn(act) + floorNote + " against a minimum of " + fmtIn(spec) + "." + run };
    }
    if (rule === "max") {
      if (d <= tol) return { state: "ok", text: "within max" };
      return { state: "bad", text: "over " + fmtIn(d),
        fix: "Reduce the " + label + " to " + fmtIn(spec) + " — it measures " + fmtIn(act) + floorNote + ", " + fmtIn(d) + " over the maximum." + run };
    }
    /* A sheet that gives both ends — the Cornufe's countertop height,
       35 5/16" to 36 7/8" — is a range: `spec` is the minimum, `specMax`
       the maximum, and the reading has to land between them. */
    if (rule === "range") {
      var mx = num(item.specMax && item.specMax[k]);
      if (mx == null) {
        if (d >= -tol) return { state: "ok", text: d > tol ? fmtDelta(d) + " over min" : "meets min" };
        return { state: "bad", text: "short " + fmtIn(-d),
          fix: "Gain " + fmtIn(-d) + " of " + label + " — it measures " + fmtIn(act) + floorNote + " against a minimum of " + fmtIn(spec) + "." + run };
      }
      if (d >= -tol && act - mx <= tol) return { state: "ok", text: "within " + fmtIn(spec) + "–" + fmtIn(mx) };
      if (d < -tol) return { state: "bad", text: "short " + fmtIn(-d),
        fix: "Gain " + fmtIn(-d) + " of " + label + " — it measures " + fmtIn(act) + floorNote + "; the sheet allows " + fmtIn(spec) + " to " + fmtIn(mx) + "." + run };
      return { state: "bad", text: "over " + fmtIn(act - mx),
        fix: "Reduce the " + label + " to " + fmtIn(mx) + " at most — it measures " + fmtIn(act) + floorNote + ", " + fmtIn(act - mx) + " over; the sheet allows " + fmtIn(spec) + " to " + fmtIn(mx) + "." + run };
    }
    if (Math.abs(d) <= tol) return { state: "ok", text: "on spec" };
    /* Checked after the tolerance so accepting never hides an on-spec
       reading, and before the failures so an accepted miss carries no fix —
       which is what keeps it off the punch list. */
    if (d > 0) return { state: "bad", text: fmtDelta(d) + " wide",
      fix: "Reduce the " + label + " to " + fmtIn(spec) + " throughout — it measures " + fmtIn(act) + ", " + fmtIn(d) +
        " over. Clean " + revealOf(item) + " reveals depend on it." + run };
    return { state: "bad", text: fmtDelta(d),
      fix: "Bring the " + label + " to " + fmtIn(spec) + " throughout — it measures " + fmtIn(act) + ", " + fmtIn(-d) + " short." + run };
  }
  /* The reveal the opening is being built to. 1/8" is what the notes ask
     for on every panel-ready and flush job; a walk can carry another. */
  function revealOf(item) {
    var r = item && item.reveal ? String(item.reveal).trim() : "";
    return (r || "1/8") + '"';
  }
  /* When three points were taken and they disagree by more than the
     tolerance, the fix is not "make it bigger" — it is "relevel", and the
     builder needs the range to see why. */
  function spreadText(item, k, spec, tol) {
    if (!item.multiPoint) return "";
    var vals = pointValues(item, k);
    if (vals.length < 2) return "";
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo <= tol) return "";
    var axis = k === "w" ? "top to bottom" : "side to side";
    return " It runs " + fmtIn(lo) + " to " + fmtIn(hi) + " " + axis + " — relevel so it reads " +
      (spec != null ? fmtIn(spec) : "the same") + " throughout.";
  }
  function autoStatus(item) {
    var any = false, bad = false, missing = false, accepted = false;
    /* A missing outlet fails an opening that measures perfectly. */
    if (utilityFixes(item).length) bad = true;
    if (panelFindings(item).length) bad = true;
    if (panelMeasuredFindings(item).length) bad = true;
    if (prepFindings(item).length) bad = true;
    if (obstructionFixes(item).length) bad = true;
    if (utilitiesFor(item).some(function (u) { return !!utilTypeFix(item, u) || utilFlagFixes(item, u).length; })) bad = true;
    var sf0 = swingFinding(item);
    if (sf0 && sf0.kind === "fix") bad = true;
    dimsFor(item).forEach(function (d) {
      var v = verdict(item, d.k);
      if (v.state === "bad") { bad = true; any = true; }
      else if (v.state === "accepted") { any = true; accepted = true; }
      else if (v.state === "ok") any = true;
      else if (v.text === "not measured" && v.state === "none") missing = true;
    });
    if (bad) return "modify";
    /* An accepted miss is not a correction, but it is not "ready" either —
       Wilson has waived a dimension, and the installer should be told to
       look at it. That is exactly what verify means. */
    if (any && !missing && utilityAnswered(item) && panelAnswered(item) && prepAnswered(item)) {
      return accepted ? "verify" : "ready";
    }
    if (!needsDims(item) && (utilityAnswered(item) && panelAnswered(item)) && (utilitiesFor(item).length || isPanelReady(item))) return "ready";
    return null;
  }
  /* Derived corrections carry a default owner by what they are: a
     dimension is the cabinet shop's, power is the electrician's, water and
     drain are the plumber's, an obstruction is whoever put it there. The
     tech can reassign any of them; the override lives in item.fixMeta under
     the correction's stable key so it survives a re-measure. */
  function defaultOwnerFor(kind, hint) {
    if (kind === "form") return OWNER_BY[hint] ? hint : "builder";   /* the form names the trade */
    if (kind === "dim") return OWNER_BY[hint] ? hint : "cabinet";

    if (kind === "panel") return "cabinet";
    if (kind === "utility") {
      if (hint === "power") return "electrician";
      if (hint === "water" || hint === "drain") return "plumber";
      if (hint === "gas") return "plumber";
      if (hint === "duct" || hint === "exhaust") return "hvac";
      return "builder";
    }
    if (kind === "obstruction") {
      var h = String(hint || "").toLowerCase();
      if (/drain|water|gas/.test(h)) return "plumber";
      if (/wiring|electrical|box/.test(h)) return "electrician";
      if (/duct|vent/.test(h)) return "hvac";
      if (/cabinet|framing/.test(h)) return "cabinet";
      return "builder";
    }
    return "builder";
  }
  function fixMeta(item, key) {
    return (item.fixMeta && item.fixMeta[key]) || {};
  }
  function setFixMeta(item, key, patch) {
    item.fixMeta = item.fixMeta || {};
    item.fixMeta[key] = Object.assign({}, item.fixMeta[key] || {}, patch);
  }
  function derivedFix(item, key, text, kind, hint) {
    var m = fixMeta(item, key);
    return { key: key, id: key, text: text, kind: "fix", derived: true,
      owner: OWNER_BY[m.owner] ? m.owner : defaultOwnerFor(kind, hint),
      severity: m.severity === "cosmetic" ? "cosmetic" : "blocks" };
  }
  /* The measured corrections, as objects. */
  function autoFixObjects(item) {
    var out = [];
    dimsFor(item).forEach(function (d) {
      var v = verdict(item, d.k);
      if (v.state === "bad" && v.fix) out.push(derivedFix(item, "dim:" + d.k, v.fix, "dim"));
    });
    utilitiesFor(item).forEach(function (u) {
      var one = utilityFixesFor(item, u);
      one.forEach(function (f, i) { out.push(derivedFix(item, "util:" + u.key + (i ? ":" + i : ""), f, "utility", utilBase(u))); });
      var tf = utilTypeFix(item, u);
      if (tf) out.push(derivedFix(item, "utype:" + u.key, tf, "utility", utilBase(u)));
      utilFlagFixes(item, u).forEach(function (f, i) { out.push(derivedFix(item, "uflag:" + u.key + ":" + i, f, "utility", utilBase(u))); });
    });
    panelMeasuredFindings(item).forEach(function (f) {
      out.push(derivedFix(item, "pnl:" + f.panelId + ":" + f.k, f.detail, "panel"));
    });
    var sf = swingFinding(item);
    if (sf && sf.kind === "fix") out.push(derivedFix(item, "swing", sf.text, "dim"));
    mergeFindings(item).forEach(function (f) { out.push(f); });
    runFindings(item).forEach(function (f) { out.push(f); });
    formFindings(item).forEach(function (f) {
      var d = derivedFix(item, f.key, f.text, f.kind === "dim" ? "dim" : "form", f.owner);
      if (f.kind === "question") d.kind = "question";
      if (f.kind === "note") { d.kind = "note"; d.owner = f.owner || "wilson"; }   /* an installer's note, never the builder's item */
      out.push(d);
    });
    panelBasisFindings(item).forEach(function (f) {
      var d = derivedFix(item, f.key, f.text, "form", f.owner);
      if (f.kind === "question") d.kind = "question";
      if (f.kind === "note") { d.kind = "note"; d.owner = "wilson"; }
      out.push(d);
    });
    obstructionFixes(item).forEach(function (f, i) {
      out.push(derivedFix(item, "obs" + (i ? ":" + i : ""), f, "obstruction", obstructionOf(item).kind));
    });
    return out;
  }
  function autoFixes(item) {
    return autoFixObjects(item).map(function (f) { return f.text; });
  }
  /* Every correction on the opening — measured and tapped — as objects. */
  function corrections(item) {
    var out = autoFixObjects(item);
    panelFindings(item).forEach(function (f, i) {
      out.push(derivedFix(item, "panel" + (i ? ":" + i : ""), f.detail || f.label, "panel"));
    });
    prepFindings(item).forEach(function (f) {
      out.push(derivedFix(item, "prep:" + f.id, f.detail, "dim", f.owner));
    });
    normActions(item.actions).forEach(function (a) {
      if (!out.some(function (o) { return o.text === a.text; })) out.push(a);
    });
    return out;
  }
  function statusOf(item) {
    /* An opening nobody could measure is not "ready" and not "modify" — it
       is something the builder has to come back to us about, which is what
       decision already means. Keeping the vocabulary at four matters more
       than a fifth colour on the phone. */
    if (item.notReady) return "decision";
    if (item.specDoubt) return "verify";
    return item.status || autoStatus(item) || "";
  }
  function specDoubtOf(item) { return item && item.specDoubt && item.specDoubt.note ? item.specDoubt : null; }
  function setSpecDoubt(item, note, by) {
    item.specDoubt = note ? { note: note, by: by || "", at: isoNow() } : null;
  }
  /* Openings the office still has to settle before the packet can go out. */
  function heldItems(walk) { return (walk && walk.items || []).filter(specDoubtOf); }
  /* Some appliances have no rough opening on paper and still have to be
     measured. Front-load laundry goes under a counter often enough now that
     "no spec" cannot mean "no measurement" — the space still has to be
     recorded, it just gets recorded without a pass or a fail. */
  function measuresAnyway(it) {
    var e = itemEntry(it);
    return !!(it.measureAnyway || (e && e.measure));
  }
  function dimNeeded(item, k) {
    /* The fourth plane is needed exactly when the tech turned it on — they
       turned it on because there is a cleat or a return in front of them. */
    if (k === "c") return !!item.planes4;
    return num(item.spec[k]) != null || measuresAnyway(item);
  }
  function dimsAnswered(item) {
    var n = 0;
    dimsFor(item).forEach(function (d) {
      if (!dimNeeded(item, d.k)) { n++; return; }
      if (item.multiPoint) { if (pointsAnswered(item, d.k) >= 3) n++; return; }
      if (item.actual[d.k] !== "" && item.actual[d.k] != null) n++;
    });
    return n;
  }
  function needsDims(item) {
    var n = 0;
    dimsFor(item).forEach(function (d) { if (dimNeeded(item, d.k)) n++; });
    return n;
  }
  function isDone(item) {
    if (basisPending(item)) return false;
    /* Recorded as unmeasurable is a finished answer, not an unfinished one.
       Without this the walk can never be completed on a jobsite where the
       cabinetry is not in yet. */
    if (item.notReady) return true;
    if (needsDims(item) && dimsAnswered(item) < 3) return false;
    if (!utilityAnswered(item)) return false;
    if (!panelAnswered(item)) return false;
    return !!statusOf(item);
  }
  /* Started means somebody did something at the house. The install basis
     and who supplies the panel are settled at the desk, so they do not count
     (v0.9.82: every opening the office built read "In progress" on the phone
     before anyone had walked it). */
  function isStarted(item) {
    return !!(item.notReady || item.status || item.photos.length || item.actions.length ||
      item.panelState || Object.keys(item.utilities || {}).length ||
      Object.keys(item.formChecks || {}).length ||
      DIMS.some(function (d) { return item.actual[d.k] !== "" && item.actual[d.k] != null; }));
  }

  /* Six-state machine for the field card, same shape as the maintenance
     tool: the card can say why it is not finished. */
  function fieldState(item) {
    if (basisPending(item)) return { code: "action", label: "Basis?", action: "Choose basis", detail: "Installation basis not chosen", attention: true, started: isStarted(item), complete: false };
    if (item.notReady) return { code: "action", label: "Not verified", action: "Review", detail: item.notReady, attention: true, started: true, complete: true };
    var mm = basisMismatch(item);
    if (mm) return { code: "action", label: "Conflict", action: "Resolve", detail: "Field opening matches " + mm.best.v.label, attention: true, started: true, complete: false };
    var s = statusOf(item);
    if (!isDone(item)) {
      if (!isStarted(item)) return { code: "not-started", label: "Not started", action: "Start", detail: "", attention: false, started: false, complete: false };
      var left = needsDims(item) - dimsAnswered(item);
      var detail = left > 0 ? left + " dimension" + (left > 1 ? "s" : "") + " left"
        : !utilityAnswered(item) ? "Utilities not checked"
        : !panelAnswered(item) ? "Panel not answered"
        : "Set the status";
      return { code: "in-progress", label: "In progress", action: "Continue", detail: detail, attention: false, started: true, complete: false };
    }
    return {
      code: s === "ready" ? "complete" : SK[s].cls, label: SK[s].label, action: "Review",
      detail: s === "ready" ? "" : (item.conclusion || SK[s].long),
      attention: s === "modify" || s === "decision", started: true, complete: true
    };
  }
  function itemFlags(it) {
    var out = [], e = itemEntry(it);
    if (it.notReady) {
      out.push({ kind: "not-ready", short: "Not verified on this walk — " + it.notReady,
        text: "This opening could not be measured during the site walk: " + it.notReady.toLowerCase() +
          ". Notify Wilson AC & Appliance when it is ready and we will verify it before the appliance is delivered." });
    }
    if (basisPending(it)) {
      out.push({ kind: "basis-open", short: "Installation basis not chosen",
        text: "The spec package carries " + e.variations.length + " installation variations for " + (it.model || "this model") +
          " (" + e.variations.map(function (v) { return v.label + " " + v.page; }).join(", ") +
          "). Pick the one this opening was built to before the item is verified." });
    }
    var mm = basisMismatch(it);
    if (mm) {
      out.push({ kind: "basis-conflict", short: "Field opening matches " + mm.best.v.label + ", not " + mm.chosen.v.label,
        text: "Specified basis is " + mm.chosen.v.label + " (" + mm.chosen.v.page + "), which wants " + openingText(mm.chosen.v) +
          ". The field opening is a closer match to " + mm.best.v.label + " (" + mm.best.v.page + ") at " + openingText(mm.best.v) +
          ". Confirm which detail the cabinetry was built to before delivery." });
    }
    if (specDoubtOf(it)) {
      out.push({ kind: "spec-doubt", short: "Spec under review by Wilson",
        text: "The installer questioned the required dimensions at the walk (" + it.specDoubt.note +
          "). Wilson AC & Appliance is confirming them against the manufacturer's sheet; no builder action on this opening until it is confirmed." });
    }
    if (it.basisConfirmed === "no") {
      out.push({ kind: "tell-conflict", short: "Field conditions do not match the specified basis",
        text: "The tech reported that the opening does not show the conditions the " +
          ((itemVariation(it) || {}).label || "specified") + " detail requires. Resolve the installation basis before delivery." });
    }
    return out;
  }
  function needsAction(it) {
    var s = statusOf(it);
    return s === "modify" || s === "decision" || itemFlags(it).length > 0;
  }

  /* ---------- correction chips ------------------------------------------
     One tap each, and the same words on every report in Wilson's voice
     rather than in each technician's. The measured ones are generated from
     the readings; these are the ones a tech sees and cannot type wrong. */
  /* Why an opening could not be measured. Fixed wording so the same reason
     reads the same on every report. */
  var NOT_READY_REASONS = [
    "Cabinetry not built yet",
    "Opening not accessible",
    "Obstructed by stored materials",
    "Appliance already set",
    "Finishes not complete"
  ];

  /* =====================================================================
     WHO DOES IT, HOW MUCH IT MATTERS
     ---------------------------------------------------------------------
     From the builder's own reply to a set of Hudson's notes: every line
     annotated "ELECTRICIAN WILL GET THIS ADDED", "CABINET COMPANY WILL GET
     THIS ADJUSTED", "TRIM CARPENTER WILL MAKE THIS MODIFICATION". Builders
     triage by trade and dispatch to subs. The packet can hand them the
     list already sorted.

     And not every correction is the builder's at all: "order packer kit
     for panels @Christian Houde" is a Wilson purchasing task. It has no
     business on a builder's punch list, and it went on one.

     `who` decides where a correction prints:
       builder → the punch list, grouped by trade
       wilson  → a Wilson-only prep page, never the builder
       sales   → the punch list, flagged as a spec decision, and the
                 salesperson's notification feed */
  var OWNERS = [
    { k: "builder",     label: "Builder / GC",              who: "builder" },
    { k: "cabinet",     label: "Cabinet shop",              who: "builder" },
    { k: "electrician", label: "Electrician",               who: "builder" },
    { k: "plumber",     label: "Plumber",                   who: "builder" },
    { k: "trim",        label: "Trim carpenter",            who: "builder" },
    { k: "countertop",  label: "Countertop",                who: "builder" },
    { k: "hvac",        label: "HVAC",                      who: "builder" },
    { k: "flooring",    label: "Flooring / tile",           who: "builder" },
    { k: "wilson",      label: "Wilson install crew",       who: "wilson" },
    { k: "internal",    label: "Wilson — order / office",   who: "wilson" },
    { k: "sales",       label: "Salesperson — spec decision", who: "sales" }
  ];
  var OWNER_BY = {};
  OWNERS.forEach(function (o) { OWNER_BY[o.k] = o; });
  function ownerOf(k) { return OWNER_BY[k] || OWNER_BY.builder; }

  /* "Raise the support shelf 1/8 — current height will leave the unit
     approximately 1/8 proud of the countertop (cosmetic only)." Hudson asks
     for the fix AND says how much it matters, so the builder can triage
     honestly. A punch list where every line looks equally urgent gets
     skimmed. Two grades is enough; a third would be argued over. */
  var SEVERITIES = [
    { k: "blocks",   label: "Blocks the install", short: "Blocks" },
    { k: "cosmetic", label: "Cosmetic — finish quality", short: "Cosmetic" }
  ];
  var KINDS = [
    { k: "fix",      label: "Correction" },
    { k: "question", label: "Question for the builder" },
    { k: "note",     label: "Note to the installer" }
  ];

  /* A correction is an object. It used to be a string, and the walks that
     were written before this are still full of strings, so everything
     reads through normAction(). */
  function normAction(a) {
    if (a && typeof a === "object") {
      a.id = a.id || uid("act");
      a.text = String(a.text || "").trim();
      a.owner = OWNER_BY[a.owner] ? a.owner : "builder";
      a.severity = a.severity === "cosmetic" ? "cosmetic" : "blocks";
      a.kind = (a.kind === "question" || a.kind === "note") ? a.kind : "fix";
      a.at = a.at || isoNow();
      return a;
    }
    var text = String(a == null ? "" : a).trim();
    return { id: uid("act"), text: text, owner: "builder", severity: "blocks", kind: "fix", at: isoNow(), chip: "" };
  }
  function normActions(list) {
    return (list || []).map(normAction).filter(function (a) { return a.text; });
  }
  function hasAction(it, text) {
    return it.actions.some(function (a) { return a.text === text; });
  }
  function addAction(it, text, opts) {
    var o = opts || {};
    if (hasAction(it, text)) return null;
    var a = normAction({ text: text, owner: o.owner || "builder", severity: o.severity || "blocks",
      kind: o.kind || "fix", chip: o.chip || "" });
    it.actions.push(a);
    return a;
  }
  function removeAction(it, idOrText) {
    var i = -1;
    it.actions.forEach(function (a, n) { if (i < 0 && (a.id === idOrText || a.text === idOrText)) i = n; });
    if (i >= 0) it.actions.splice(i, 1);
    return i >= 0;
  }
  function toggleAction(it, text, opts) {
    if (hasAction(it, text)) { removeAction(it, text); return false; }
    addAction(it, text, opts); return true;
  }

  /* =====================================================================
     THE CHIP LIBRARY — rewritten from the notes
     ---------------------------------------------------------------------
     The previous 17 chips were written from two documents. Against ~250
     correction lines from a year of the department's site notes, about one
     in twelve landed on one of them. These are those lines, generalised
     only as far as the number that changes per job.

     `{n}` is a number the tech fills from the pad when the chip is tapped —
     because every correction Hudson writes carries the number to build to.
     `owner` is the trade that usually does it. `cats` restricts a chip to
     the categories it belongs to; a chip with no `cats` is offered
     everywhere. `kind` defaults to fix. */
  var CHIPS = [
    /* ---- cabinet: size ---- */
    { id: "c-width-reduce",  owner: "cabinet", t: 'Reduce the opening width to {n} throughout — clean 1/8" reveals depend on it.' },
    { id: "c-height-trim",   owner: "cabinet", t: "Add finished trim on top to bring the opening height down to {n}." },
    { id: "c-depth-gain",    owner: "cabinet", t: "Increase the opening depth to {n} throughout — room for the lines behind the unit." },
    { id: "c-width-gain",    owner: "cabinet", t: "Increase the opening width to {n} for clearance." },
    { id: "c-relevel",       owner: "cabinet", t: "Relevel the sides of the opening — front to back and side to side — so it reads {n} throughout." },
    { id: "c-square-depth",  owner: "cabinet", t: "Square the opening depth so both sides read {n} — the difference will leave a gap in the back corner." },
    { id: "c-width-cleats",  owner: "cabinet", t: "Add {n} cleats on both sides to bring the opening width to spec — solid wood to secure into.", cats: ["ovens", "microwave"] },
    /* ---- cabinet: what is in the way ---- */
    { id: "c-bracer",        owner: "cabinet", t: "Remove the bracer boards at the back for full depth." },
    { id: "c-spacers",       owner: "cabinet", t: "Remove the cabinet spacers at the front for full height." },
    { id: "c-stringer",      owner: "cabinet", t: "Remove the stringer at the back of the opening." },
    { id: "c-screws",        owner: "cabinet", t: "Cut off the screws projecting into the opening." },
    { id: "c-toekick",       owner: "cabinet", t: "Cut back the toe kick to full opening width.", cats: ["refrigeration", "dishwasher"] },
    /* ---- cabinet: securing and finishing ---- */
    { id: "c-returns",       owner: "cabinet", t: "Add finished returns on both sides, top to bottom — solid wood to secure into." },
    { id: "c-return-one",    owner: "cabinet", t: "Add a finished return filler on one side for securing." },
    { id: "c-shelf",         owner: "cabinet", t: 'Build a 3/4" shelf from the back wall to the toe kick so the unit levels off it.', cats: ["range", "cooktop", "refrigeration"] },
    { id: "c-platform",      owner: "cabinet", t: "Add a {n} platform to bring the opening to height." },
    { id: "c-antitip",       owner: "cabinet", t: "Add an anti-tip block at the back to match the opening height.", cats: ["microwave"] },
    { id: "c-access",        owner: "cabinet", t: "Cut an access hole in the adjacent cabinet — the connections are behind the unit." },
    { id: "c-plughole",      owner: "cabinet", t: '2" hole in the back corner to run the plug to the outlet below.', cats: ["microwave"] },
    { id: "c-buildout",      owner: "cabinet", t: "Build out the cabinet to spec for a flush install and proper securing." },
    /* ---- cabinet: flush / cleats ---- */
    { id: "c-cleats-back",   owner: "cabinet", t: "Move the side cleats back so they sit {n} recessed from the face frame for the finished panel." },
    { id: "c-runner",        owner: "cabinet", t: "Add a {n} recessed shelf on the bottom to flush up with the front lip.", cats: ["ovens", "microwave"] },
    { id: "c-header",        owner: "cabinet", t: "Add {n} recessed finished trim on top to close the gap.", cats: ["ovens", "microwave"] },
    { id: "c-finished-cleats", owner: "cabinet", t: "Add finished cleats on the sides and top, finished to match the cabinetry.", cats: ["ovens", "microwave", "refrigeration"] },
    /* ---- cabinet: panels ---- */
    { id: "c-panel-w",       owner: "cabinet", t: "Cut the panel to {n} wide." },
    { id: "c-panel-h",       owner: "cabinet", t: "Cut the panel to {n} tall." },
    { id: "c-panel-kit",     owner: "cabinet", t: "Add backers and spacers to the panels per spec.", cats: ["refrigeration", "dishwasher"] },
    { id: "c-handles",       owner: "cabinet", t: "Install handles on all panels before panel installation." },
    { id: "c-panel-side",    owner: "cabinet", t: "Add the missing side panel for a finished look." },
    /* ---- electrician ---- */
    { id: "e-outlet-marked", owner: "electrician", t: "Set up a dedicated outlet in the marked location, flush with the back wall." },
    { id: "e-outlet-corner", owner: "electrician", t: "Set up the outlet in the topmost left corner of the opening.", cats: ["microwave"] },
    { id: "e-outlet-move",   owner: "electrician", t: "Move the outlet into the marked area — for depth and for servicing." },
    { id: "e-outlet-low",    owner: "electrician", t: "Move the outlet so it is no higher than {n} from the finished floor." },
    { id: "e-outlet-high",   owner: "electrician", t: "Move the outlet up to at least {n} above the base of the shroud.", cats: ["ventilation"] },
    { id: "e-recess",        owner: "electrician", t: "Recess the outlet or junction box into the wall for depth." },
    { id: "e-adjacent",      owner: "electrician", t: "Relocate the outlet to the adjacent cabinet — under the sink." },
    { id: "e-faceplate",     owner: "electrician", t: "Supply a faceplate for the junction box and confirm the dedicated circuit.", cats: ["ovens", "cooktop"] },
    { id: "e-romex",         owner: "electrician", t: "Extend the romex {n} so the hood can be hardwired outside the shroud.", cats: ["ventilation"] },
    { id: "e-nema",          owner: "electrician", t: "Change the receptacle to the type the spec calls for." },
    /* ---- plumber ---- */
    { id: "p-cold-t",        owner: "plumber", t: '1/4" cold water T-valve for the ice maker — under the sink or in the adjacent cabinet.', cats: ["refrigeration", "icemaker"] },
    { id: "p-hot-t",         owner: "plumber", t: '3/8" hot water T-valve for the dishwasher, under the sink.', cats: ["dishwasher"] },
    { id: "p-drain",         owner: "plumber", t: 'Dedicated drain port — 3/4" tailpiece — under the sink.', cats: ["dishwasher", "icemaker", "refrigeration"] },
    { id: "p-drain-vert",    owner: "plumber", t: "Vertical drop-in drain port, recessed into the back wall.", cats: ["icemaker", "refrigeration"] },
    { id: "p-drain-second",  owner: "plumber", t: "A separate drain port for the second unit — one per unit.", cats: ["dishwasher", "icemaker"] },
    { id: "p-recess-water",  owner: "plumber", t: "Recess the water lines into the drywall for depth." },
    { id: "p-rotate-valve",  owner: "plumber", t: "Rotate the water valve in the box so the line does not pinch behind the unit.", cats: ["refrigeration"] },
    { id: "p-waterbox-low",  owner: "plumber", t: "Move the water box so it is no higher than {n} from the floor.", cats: ["refrigeration"] },
    { id: "p-gas-2in",       owner: "plumber", t: '90° elbow on the gas pipe so it projects no more than 2" from the back wall.', cats: ["range", "cooktop", "grill"] },
    { id: "p-gas-shutoff",   owner: "plumber", t: "Add an accessible gas shutoff — in the adjacent cabinet.", cats: ["range", "cooktop", "grill"] },
    { id: "p-gas-rotate",    owner: "plumber", t: "Rotate the gas pipe and shutoff to the side so the unit sits back.", cats: ["range", "cooktop"] },
    { id: "p-cleanout",      owner: "plumber", t: "Cut back and cap the clean-out flush with the wall.", cats: ["washer", "dryer", "laundry_center"] },
    { id: "p-drainpan",      owner: "plumber", t: "Finish the drain pan and drain pipe in the washer cavity.", cats: ["washer", "laundry_center"] },
    /* ---- countertop / trim / HVAC / flooring ---- */
    { id: "t-countertop",    owner: "countertop", t: "Install the countertop and backsplash before delivery." },
    { id: "t-ct-level",      owner: "countertop", t: "Relevel the countertop front to back for a flush top reveal.", cats: ["range", "cooktop"] },
    { id: "t-ct-cutout",     owner: "countertop", t: "Cut the countertop to the cutout on the spec sheet, with the clearance behind.", cats: ["cooktop", "grill"] },
    { id: "t-drywall",       owner: "trim", t: "Cut out the drywall and baseboard in the back corner for full width." },
    { id: "t-blocking",      owner: "trim", t: "Add blocking at the back for securing the hood.", cats: ["ventilation"] },
    { id: "t-shroud",        owner: "trim", t: "Install the shroud before install day so the hood can be secured.", cats: ["ventilation"] },
    { id: "h-duct-wall",     owner: "hvac", t: 'Move the duct so it sits within 1" of the wall for the duct cover.', cats: ["ventilation"] },
    { id: "h-duct-excess",   owner: "hvac", t: "Remove the excess ducting from the elbow.", cats: ["ventilation"] },
    { id: "h-duct-size",     owner: "hvac", t: "Switch the ducting to {n} — the hood requires it.", cats: ["ventilation"] },
    { id: "h-makeup",        owner: "hvac", t: "Complete make-up air before the duct cover goes on.", cats: ["ventilation"] },
    { id: "f-flooring",      owner: "flooring", t: "Finish the flooring in the opening before delivery." },
    { id: "f-floor-under",   owner: "flooring", t: "Add flooring under the unit so it levels." },
    /* ---- Wilson ---- */
    { id: "w-mark-holes",    owner: "wilson", t: "We will mark the mounting holes on install day.", cats: ["ventilation"], kind: "note" },
    { id: "w-duct-ourselves", owner: "wilson", t: "Excess ducting can be removed by our crew if needed.", cats: ["ventilation"], kind: "note" },
    { id: "w-order-merge",   owner: "internal", t: "Order the merge / join kit for these units.", cats: ["refrigeration"] },
    { id: "w-order-cover",   owner: "internal", t: "Order the duct cover extension.", cats: ["ventilation"] },
    { id: "w-order-panelkit", owner: "internal", t: "Order the panel spacer and backer kit.", cats: ["refrigeration", "dishwasher"] },
    /* ---- sales ---- */
    { id: "s-confirm-model", owner: "sales", t: "Confirm the model for this opening — the cavity does not match the ticket." },
    { id: "s-switch-model",  owner: "sales", t: "The opening fits the other size — switch models, or the cabinet has to change." },
    { id: "s-no-flush-spec", owner: "sales", t: "No flush spec exists for this model — cabinet maker on site install day." },
    /* ---- questions ---- */
    { id: "q-flush",         owner: "builder", kind: "question", t: "Flush or standard mount for this unit?" },
    { id: "q-where",         owner: "builder", kind: "question", t: "Where is this unit to be installed?" },
    { id: "q-hood-height",   owner: "builder", kind: "question", t: "Hood height — to the fur-down, or a set height from the countertop?", cats: ["ventilation"] },
    { id: "q-hardwire",      owner: "builder", kind: "question", t: "Hardwired, or a receptacle?", cats: ["ovens", "cooktop"] }
  ];
  var CHIP_BY = {};
  CHIPS.forEach(function (c) { CHIP_BY[c.id] = c; });
  function chipHasSlot(c) { return /\{n\}/.test(c.t); }
  function chipText(c, n) {
    return n == null ? c.t : c.t.replace(/\{n\}/g, fmtIn(n));
  }
  /* Kept so anything still asking for the flat list gets one. */
  var CHIPS_ALL = CHIPS.filter(function (c) { return c.kind !== "question"; }).map(function (c) { return c.t; });

  /* Categories share trades: a rangetop is a cooktop is a range as far as
     the gas line is concerned, and every undercounter box is refrigeration. */
  var CAT_ALIAS = {
    range: ["range", "cooktop"], cooktop: ["cooktop", "range"], rangetop: ["range", "cooktop"],
    icemaker: ["icemaker", "refrigeration"], wine: ["refrigeration"], beverage: ["refrigeration"],
    hood: ["ventilation"], vent: ["ventilation"], laundry_center: ["laundry_center", "washer", "dryer"]
  };
  function chipCats(it) {
    var e = itemEntry(it);
    var cat = (e && e.category) || "";
    var out = CAT_ALIAS[cat] ? CAT_ALIAS[cat].slice() : [cat];
    /* the plain-English name catches models the library does not know */
    var name = ((e && e.appliance) || "") + " " + (it.model || "") + " " + (it.notes || "");
    if (/ice ?maker/i.test(name)) out.push("icemaker");
    if (/hood|vent/i.test(name)) out.push("ventilation");
    if (/range|rangetop|cooktop/i.test(name)) out.push("range", "cooktop");
    if (/grill/i.test(name)) out.push("grill");
    if (/washer|dryer|laundry/i.test(name)) out.push("washer", "dryer", "laundry_center");
    if (/dishwasher/i.test(name)) out.push("dishwasher");
    if (/micro/i.test(name)) out.push("microwave");
    if (/oven|coffee|warming/i.test(name)) out.push("ovens");
    if (/fridge|refrigerat|freezer|column|wine|beverage/i.test(name)) out.push("refrigeration");
    return out;
  }
  /* Chips for this opening: the ones for its category first (a chip whose
     `cats` lists it), then the universal ones, then everything else behind
     More. Grouped by owner in the UI, so the tech scans "Electrician" and
     "Plumber" as headings rather than a wall of sentences. */
  function chipsFor(it) {
    var cats = chipCats(it);
    var v = itemVariation(it);
    var primary = [], more = [];
    (v && v.requires ? v.requires : []).forEach(function (r) {
      primary.push({ id: "req:" + r, owner: "builder", t: r, req: true });
    });
    CHIPS.forEach(function (c) {
      var fits = !c.cats || c.cats.some(function (k) { return cats.indexOf(k) >= 0; });
      if (c.cats && fits) primary.push(c);
      else if (!c.cats) primary.push(c);
      else more.push(c);
    });
    return { primary: primary, more: more };
  }

  function suggestConclusion(it) {
    var s = statusOf(it), fixes = autoFixes(it);
    var flags = itemFlags(it);
    if (flags.length) return flags[0].short + ".";
    if (s === "modify") {
      var all = actionTexts(it);
      if (all.length) return all.slice(0, 2).join(" ");
    }
    if (s === "ready") return "Opening is acceptable" + (fieldSummary(it) ? " at " + fieldSummary(it) : "") + ".";
    if (s === "verify") return "Opening looks acceptable; recheck at set.";
    if (s === "decision") return it.question || "Builder response required before the appliance is ordered or set.";
    return "";
  }
  function specSummary(it) {
    var parts = [];
    DIMS.forEach(function (d) { var s = num(it.spec[d.k]); if (s != null) parts.push(fmtIn(s) + " " + d.k.toUpperCase()); });
    return parts.join(" × ");
  }
  function fieldSummary(it) {
    var parts = [];
    DIMS.forEach(function (d) { var s = num(it.actual[d.k]); if (s != null) parts.push(fmtIn(s) + " " + d.k.toUpperCase()); });
    return parts.join(" × ");
  }
  function itemTitle(it) {
    var t = it.appliance || it.model || "Untitled item";
    /* a hand-typed "steam oven" prints as a title, not a note */
    return /^[a-z]/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }
  function itemWhere(it) { return [it.area, it.location].filter(Boolean).join(" — "); }


  /* ---------- getting the appliances into the building -------------------
     Every dimension in this tool is about whether an appliance fits the hole
     it is going into. None of it matters if the thing cannot be carried to
     the hole. A 355 lb crated merchandiser, a 48" built-in, a WashTower —
     these come off a truck and go through a door, round a turn, and
     sometimes up a stair, and the first anybody hears about a problem is
     the morning of the delivery with a crew standing in the driveway.

     So it is a required part of the walk, not an optional note: a route, a
     condition, and a photograph. A walk cannot be finished without it. */
  var ACCESS_ROUTES = [
    { k: "ground", label: "Ground level, straight in" },
    { k: "entry-steps", label: "Steps at the entry" },
    { k: "interior-stairs", label: "Interior stairs" },
    { k: "elevator", label: "Elevator" },
    { k: "lift", label: "Lift or crane needed" }
  ];
  var ACCESS_STATES = [
    { k: "clear", label: "Clear — nothing in the way", tone: "good" },
    { k: "tight", label: "Tight — measure the pinch point", tone: "monitor" },
    { k: "blocked", label: "Blocked — builder has to clear it", tone: "poor" }
  ];

  function accessOf(w) {
    w.access = w.access || { route: "", state: "", tightestIn: "", note: "", photos: [] };
    w.access.photos = w.access.photos || [];
    return w.access;
  }
  function accessAnswered(w) {
    var a = accessOf(w);
    return !!(a.route && a.state && a.photos.length);
  }
  function accessMissing(w) {
    var a = accessOf(w), out = [];
    if (!a.route) out.push("how the appliances get in");
    if (!a.state) out.push("whether the route is clear");
    if (!a.photos.length) out.push("a photograph of the route");
    return out;
  }
  function accessRouteLabel(w) {
    var a = accessOf(w);
    var r = ACCESS_ROUTES.filter(function (x) { return x.k === a.route; })[0];
    return r ? r.label : "";
  }
  function accessStateLabel(w) {
    var a = accessOf(w);
    var st = ACCESS_STATES.filter(function (x) { return x.k === a.state; })[0];
    return st ? st.label : "";
  }
  /* =====================================================================
     JOB-LEVEL PREREQUISITES — the house, not the hole
     ---------------------------------------------------------------------
     Half the emails end with the same paragraph: power on, water on,
     countertops in, floor protection down, someone there to open the door.
     None of it belongs to an opening. Asked once per walk on the access
     screen; a "no" is a builder item at the top of the one-pager. */
  var JOB_PREREQS = [
    { k: "power",       q: "Power on at the panel?",                       fix: "Have power on at the panel — every unit is tested at set.", owner: "electrician" },
    { k: "water",       q: "Water on to the house?",                       fix: "Have the water on — supply lines are connected and tested at set.", owner: "plumber" },
    { k: "gas",         q: "Gas on and tested?",                           fix: "Have gas on and tested before the range or cooktop is set.", owner: "plumber" },
    { k: "countertops", q: "Countertops installed?",                       fix: "Install the countertops before delivery — slide-ins, cooktops and undercounter units set against them.", owner: "countertop" },
    { k: "protect",     q: "Floor protection down along the route?",       fix: "Lay floor protection along the delivery route before the crew arrives.", owner: "builder" },
    { k: "clear",       q: "Route and openings clear of stored material?", fix: "Clear stored materials from the delivery route and the openings.", owner: "builder" },
    { k: "onsite",      q: "Someone on site to receive?",                  fix: "Confirm who meets the crew and opens the house on delivery day.", owner: "builder", kind: "question" },
    { k: "disposal",    q: "Somewhere for crates and packaging?",          fix: "Provide a dumpster or a place for crates and packaging.", owner: "builder", kind: "question" }
  ];
  function prereqsOf(w) { w.prereqs = w.prereqs || {}; return w.prereqs; }
  function prereqAnswer(w, k) { return prereqsOf(w)[k] || ""; }
  function setPrereq(w, k, v) { var p = prereqsOf(w); p[k] = p[k] === v ? "" : v; }
  function prereqsAnswered(w) { return JOB_PREREQS.every(function (x) { return !!prereqAnswer(w, x.k); }); }
  function prereqsOpen(w) { return JOB_PREREQS.filter(function (x) { return !prereqAnswer(w, x.k); }).length; }
  /* Builder items for the top of the one-pager: the prerequisites that are
     not met, and the flooring still to go in. */
  function jobFindings(w) {
    var out = [];
    JOB_PREREQS.forEach(function (x) {
      if (prereqAnswer(w, x.k) === "no") out.push({ key: "job:" + x.k, label: x.q, detail: x.fix, owner: x.owner, severity: "blocks", kind: x.kind || "fix" });
    });
    var fl = flooringOf(w);
    if (fl.pending) {
      var t = num(fl.thicknessIn);
      out.push({ key: "job:flooring", label: "Finished flooring not down", owner: "flooring", severity: "blocks", kind: "fix",
        detail: "Finished flooring" + (t != null ? " (" + fmtIn(t) + ")" : "") + " goes in before delivery. Heights in this packet are computed to the finished floor" + (t != null ? " with " + fmtIn(t) + " deducted" : "; the thickness was not recorded") + "." });
    }
    return out;
  }
  /* One line for the cover: what the house is like today. */
  function jobReadinessBits(w) {
    var bits = [];
    var acc = accessSummary(w);
    if (acc) bits.push({ label: "Access", value: acc, bad: accessFindings(w).length > 0 });
    var fl = flooringOf(w);
    if (fl.answered || fl.pending) {
      var t = num(fl.thicknessIn);
      bits.push({ label: "Flooring", value: fl.pending ? ("not down" + (t != null ? " · " + fmtIn(t) + " to go in" : "")) : "finished floor is in", bad: !!fl.pending });
    }
    JOB_PREREQS.forEach(function (x) {
      var a = prereqAnswer(w, x.k);
      if (!a || a === "na") return;
      bits.push({ label: x.q.replace(/\?$/, ""), value: a === "yes" ? "yes" : "no", bad: a === "no" });
    });
    return bits;
  }

  /* What the builder is told, and what the delivery crew needs to know. */
  function accessFindings(w) {
    var a = accessOf(w), out = [];
    if (a.state === "blocked") {
      out.push("Clear the delivery route into the building before the appliances are scheduled — " +
        "it was obstructed at the walk" + (a.note ? " (" + a.note + ")" : "") + ".");
    }
    var tight = num(a.tightestIn);
    if (a.state === "tight") {
      out.push(tight != null
        ? "Delivery route pinches to " + fmtIn(tight) +
          " at its tightest point. Confirm every unit clears it, crated or uncrated, before delivery is scheduled."
        : "Delivery route was called tight at the walk. Confirm every unit clears the pinch point, crated or uncrated, before delivery is scheduled.");
    }
    if (a.route === "lift") {
      out.push("A lift or crane is required to get the appliances in. Confirm who is arranging it before the delivery date.");
    }
    return out;
  }
  function accessSummary(w) {
    var a = accessOf(w);
    if (!a.route && !a.state) return "";
    var bits = [accessRouteLabel(w), accessStateLabel(w)].filter(Boolean);
    var tight = num(a.tightestIn);
    if (tight != null) bits.push("tightest point " + fmtIn(tight));
    return bits.join(" · ");
  }

  /* ---------- the punch list -------------------------------------------
     A specificity cascade, same idea as findingsFor() in the maintenance
     review: a basis conflict beats a measured failure, a measured failure
     beats a chip a tech tapped, and all of them beat a status label. */
  function findingsFor(it) {
    var flags = itemFlags(it);
    if (flags.length) return flags.map(function (f) { return { label: f.short, detail: f.text }; });
    var measured = [];
    dimsFor(it).forEach(function (d) {
      var v = verdict(it, d.k);
      if (v.state !== "bad") return;
      var spec = num(it.spec[d.k]), act = num(it.actual[d.k]);
      /* the fix line already carries the reading, the requirement and the
         delta — saying them twice made the cover read like a stutter */
      measured.push({ label: d.label, detail: v.fix });
    });
    /* attach who and how-much to the dimension findings just built */
    measured.forEach(function (m, i) {
      var d = dimsFor(it).filter(function (x) { return x.label === m.label; })[0];
      var meta = d ? derivedFix(it, "dim:" + d.k, "", "dim") : { owner: "cabinet", severity: "blocks" };
      m.owner = meta.owner; m.severity = meta.severity; m.kind = "fix";
    });
    panelFindings(it).forEach(function (f, i) {
      var meta = derivedFix(it, "panel" + (i ? ":" + i : ""), "", "panel");
      measured.push({ label: f.label, detail: f.detail, owner: meta.owner, severity: meta.severity, kind: "fix" });
    });
    panelMeasuredFindings(it).forEach(function (f) {
      var meta = derivedFix(it, "pnl:" + f.panelId + ":" + f.k, "", "panel");
      measured.push({ label: f.label, detail: f.detail, owner: meta.owner, severity: meta.severity, kind: "fix" });
    });
    prepFindings(it).forEach(function (f) {
      var meta = derivedFix(it, "prep:" + f.id, "", "dim", f.owner);
      measured.push({ label: f.label, detail: f.detail, owner: meta.owner, severity: meta.severity, kind: "fix" });
    });
    utilitiesFor(it).forEach(function (u) {
      utilityFixesFor(it, u).forEach(function (f, i) {
        var meta = derivedFix(it, "util:" + u.key + (i ? ":" + i : ""), "", "utility", utilBase(u));
        measured.push({ label: "Utility connection", detail: f, owner: meta.owner, severity: meta.severity, kind: "fix" });
      });
      var tf = utilTypeFix(it, u);
      if (tf) {
        var tm = derivedFix(it, "utype:" + u.key, "", "utility", utilBase(u));
        measured.push({ label: "Wrong connection type", detail: tf, owner: tm.owner, severity: tm.severity, kind: "fix" });
      }
      utilFlagFixes(it, u).forEach(function (f, i) {
        var fm = derivedFix(it, "uflag:" + u.key + ":" + i, "", "utility", utilBase(u));
        measured.push({ label: utilLabel(u), detail: f, owner: fm.owner, severity: fm.severity, kind: "fix" });
      });
    });
    var sf = swingFinding(it);
    if (sf && sf.kind === "fix") {
      var sm = derivedFix(it, "swing", "", "dim");
      measured.push({ label: "Door clearance", detail: sf.text, owner: sm.owner, severity: sm.severity, kind: "fix" });
    }
    mergeFindings(it).forEach(function (f) {
      measured.push({ label: "Join / merge kit", detail: f.text, owner: f.owner, severity: f.severity, kind: f.kind || "fix" });
    });
    runFindings(it).forEach(function (f) {
      measured.push({ label: "Extensions", detail: f.text, owner: f.owner, severity: f.severity, kind: "fix" });
    });
    formFindings(it).forEach(function (f) {
      var fm = derivedFix(it, f.key, "", f.kind === "dim" ? "dim" : "form", f.owner);
      measured.push({ label: f.label, detail: f.text, owner: f.kind === "note" ? (f.owner || "wilson") : fm.owner, severity: fm.severity, kind: f.kind === "question" ? "question" : f.kind === "note" ? "note" : "fix" });
    });
    panelBasisFindings(it).forEach(function (f) {
      var pm = derivedFix(it, f.key, "", "form", f.owner);
      measured.push({ label: f.label, detail: f.text, owner: f.kind === "note" ? "wilson" : pm.owner, severity: pm.severity, kind: f.kind });
    });
    obstructionFixes(it).forEach(function (f, i) {
      var meta = derivedFix(it, "obs" + (i ? ":" + i : ""), "", "obstruction", obstructionOf(it).kind);
      measured.push({ label: "Obstruction in the opening", detail: f, owner: meta.owner, severity: meta.severity, kind: "fix" });
    });
    /* Tapped corrections print alongside the measured ones now — a
       builder's punch list is not shorter for hiding the tech's own lines
       behind the measured ones, it is just wrong. */
    normActions(it.actions).forEach(function (a) {
      measured.push({
        label: a.kind === "question" ? "Question for the builder" : a.kind === "note" ? "Note to the installer" : "Required before delivery",
        detail: a.text, owner: a.owner, severity: a.severity, kind: a.kind, tapped: true
      });
    });
    /* the sheet is in question: a miss against numbers the office may be
       about to correct is not a builder item yet */
    if (specDoubtOf(it)) measured = measured.filter(function (f) { return f.kind !== "fix" || f.tapped; });
    if (measured.length) return measured;
    if (it.question) return [{ label: "Builder response required", detail: it.question, owner: "builder", severity: "blocks", kind: "question" }];
    var s = statusOf(it);
    /* a status line for the opening's own page — never a punch-list row,
       which is how "Ready for set" printed under Builder / GC on the
       showroom cover */
    if (s) return [{ label: SK[s].long, detail: it.conclusion || "", kind: "status" }];
    return [];
  }
  /* One line per item for the cover punch list. */
  /* The line that goes on the cover: the first thing the BUILDER has to do
     that blocks the install. A Wilson purchasing note never leads. */
  /* "Location · Brand Model" for a list row; the plain-English name only
     when there is no model, and never the same string twice. */
  function rowTitle(it) {
    var where = itemWhere(it);
    var name = [it.brand, it.model].filter(Boolean).join(" ") || itemTitle(it);
    if (!where || where === name || where === itemTitle(it)) return name;
    return where + " · " + name;
  }
  function punchLine(it) {
    var fs = findingsFor(it);
    var pick = fs.filter(function (f) { return ownerOf(f.owner).who !== "wilson" && f.kind !== "note" && f.severity !== "cosmetic"; })[0]
      || fs.filter(function (f) { return ownerOf(f.owner).who !== "wilson" && f.kind !== "note"; })[0]
      || fs[0];
    if (!pick) return "";
    return pick.detail || pick.label;
  }
  /* Corrections as objects, measured then tapped. `actionTexts` is the old
     string list for anything that still wants it. */
  function actionsFor(it) { return corrections(it); }
  function actionTexts(it) { return corrections(it).map(function (a) { return a.text; }); }
  /* Which of the corrections on a walk print where. */
  function whoOf(a) { return ownerOf(a && a.owner).who; }
  function punchItems(walk) {
    var rows = [];
    walk.items.forEach(function (it) {
      /* An opening the tech has started and left in "modify" belongs on the
         list even if a utility was never answered — the correction is real
         either way. An untouched opening is not. */
      if (!isStarted(it)) return;
      if (specDoubtOf(it)) return;              /* under review by Wilson: nothing for the builder yet */
      findingsFor(it).forEach(function (f) {
        var who = ownerOf(f.owner).who;
        if (who === "wilson" || f.kind === "note" || f.kind === "status") return;
        rows.push({ it: it, f: f, who: who });
      });
    });
    /* blockers first, cosmetic after; questions with the blockers because
       an unanswered question blocks an order */
    rows.sort(function (a, b) {
      var sa = a.f.severity === "cosmetic" ? 1 : 0, sb = b.f.severity === "cosmetic" ? 1 : 0;
      return sa - sb;
    });
    return rows;
  }
  function wilsonItems(walk) {
    var rows = [];
    walk.items.forEach(function (it) {
      findingsFor(it).forEach(function (f) {
        if (f.kind === "status") return;
        if (ownerOf(f.owner).who === "wilson" || f.kind === "note") rows.push({ it: it, f: f });
      });
      var sf = swingFinding(it);
      if (sf && sf.kind === "note") rows.push({ it: it, f: { label: "Door swing", detail: sf.text, owner: "wilson", severity: "blocks", kind: "note" } });
    });
    return rows;
  }
  function salesItems(walk) {
    var rows = [];
    walk.items.forEach(function (it) {
      findingsFor(it).forEach(function (f) { if (ownerOf(f.owner).who === "sales") rows.push({ it: it, f: f }); });
    });
    return rows;
  }
  function questionItems(walk) {
    var rows = [];
    walk.items.forEach(function (it) {
      findingsFor(it).forEach(function (f) { if (f.kind === "question") rows.push({ it: it, f: f }); });
    });
    return rows;
  }

  /* ---------- rollup ---------------------------------------------------
     The headline is a count, not an average. "14 of 17 openings are ready"
     is a fact a builder can check; a percentage hides the one that isn't. */
  function tally(walk) {
    /* `held` is an opening the installer sent back to the office ("spec
       looks wrong"): it is neither ready nor unwalked, and a cover that
       files it under either misleads the builder. */
    var c = { ready: 0, verify: 0, modify: 0, decision: 0, open: 0, held: 0 };
    walk.items.forEach(function (it) {
      if (specDoubtOf(it)) { c.held++; return; }
      if (!isDone(it)) { c.open++; return; }
      var s = statusOf(it);
      if (c[s] === undefined) c.open++; else c[s]++;
    });
    return c;
  }
  function rollup(walk) {
    var c = tally(walk);
    var items = walk.items;
    var attention = items.filter(needsAction);
    var blockers = items.filter(function (it) { return itemFlags(it).length; });
    return {
      counts: c, total: items.length,
      ready: c.ready, attention: attention, blockers: blockers,
      readyCount: c.ready + c.verify,
      done: items.filter(isDone).length,
      pct: items.length ? Math.round(items.filter(isDone).length / items.length * 100) : 0,
      accessDone: accessAnswered(walk),
      accessFindings: accessFindings(walk),
      held: heldItems(walk),
      deliverable: items.length > 0 && blockers.length === 0 && c.modify === 0 &&
        c.decision === 0 && c.open === 0 && accessAnswered(walk) &&
        accessFindings(walk).length === 0 && heldItems(walk).length === 0
    };
  }
  function stage(walk) {
    if (!walk.items.length) return { code: "setup", label: "Loading specs" };
    var r = rollup(walk);
    if (walk.sentAt) return { code: "sent", label: "Sent to builder" };
    /* v0.9.83: "in the field" starts with the first thing anybody records at
       the house — a photo, a reading, the way in — not when the first opening
       is completely finished. Until then a walk somebody was halfway through
       its first opening still read "Ready to walk" on every other screen. */
    var a0 = accessOf(walk), begun = walk.items.some(isStarted) || !!(a0.route || a0.state || (a0.photos && a0.photos.length));
    if (r.done === 0 && !begun) return { code: "ready-to-walk", label: "Ready to walk" };
    /* Every opening measured and still no answer on how the units get into
       the building is not a finished walk. */
    if (r.done < r.total || !accessAnswered(walk)) return { code: "in-field", label: "In the field" };
    return { code: "ready-to-send", label: "Ready to send" };
  }


  /* ---------- the sync payload ------------------------------------------
     What leaves the phone for the operations dashboard.

     The rule that matters here: the payload carries the *derived* answers
     alongside the raw field entries. Status, verdicts, fixes, marked
     positions in inches — all of it computed by the functions above and
     shipped as values. The server stores them; it never recomputes them.

     The alternative is a second implementation of the same arithmetic in
     SQL or Python, which is how a builder ends up holding a packet that
     says one thing and a dashboard that says another. There is one place a
     number is computed in this system, and it is this file. */

  function dimPayload(it, d) {
    var v = verdict(it, d.k);
    var spec = num(it.spec[d.k]), act = num(it.actual[d.k]);
    return {
      axis: d.k,
      label: d.label,
      rule: (it.rule && it.rule[d.k]) || "",
      specIn: spec,
      specMaxIn: (it.specMax && num(it.specMax[d.k]) != null) ? num(it.specMax[d.k]) : null,
      actualIn: it.actual[d.k] === "NM" ? null : act,
      notMeasured: it.actual[d.k] === "NM",
      deltaIn: (spec != null && act != null) ? act - spec : null,
      verdict: v.state,
      verdictText: v.text,
      /* An accepted miss carries both truths: what it measured against the
         sheet, and the reason Wilson is not asking for a change. */
      acceptedReason: acceptedReason(it, d.k),
      rawVerdict: rawVerdict(it, d.k).state,
      points: it.multiPoint
        ? POINTS.map(function (p, i) {
            return { at: p.k, label: p.label, valueIn: num(it.points[d.k][i]) };
          })
        : [],
      governingPoint: it.multiPoint ? governingPoint(it, d.k) : null
    };
  }

  function utilityPayload(it, u) {
    var at = markAt(it, u.key), o = markOffset(it, u), mv = markVerdict(it, u);
    var z = zoneOf(it, u);
    return {
      code: u.key,
      label: u.label,
      requirement: u.need || "",
      belongs: u.generic ? "Per the installation sheet" : (u.where || ""),
      /* the box the office drew, on whichever plane, as drawn */
      drawnZone: u.zone ? JSON.parse(JSON.stringify(u.zone)) : null,
      plane: u.plane || (u.offPlane ? "" : "opening"),
      answer: it.utilities[u.key] || "",
      markedXIn: at ? at.x : null,
      markedYIn: at ? at.y : null,
      markedPlane: at ? (pinOf(it, u.key) ? pinOf(it, u.key).plane : utilPlane(u)) : "",
      /* the sink cabinet's side, once the tech said (adjacent planes only) */
      adjacentSide: (u.plane === "adjacent" || (u.zone && u.zone.plane === "adjacent")) ? (it.adjacentSide || "") : undefined,
      offsetXIn: o ? o.dx : null,
      offsetYIn: o ? o.dy : null,
      outsideZone: o ? !!o.out : null,
      zoneKind: z ? (z.any ? "any" : (z.field ? "field-point" : z.kind)) : "",
      targetXIn: z && z.field ? z.x : null,
      targetYIn: z && z.field ? z.y : null,
      measuredText: mv ? mv.text : "",
      /* what is actually there against what the sheet asks for */
      typeFound: utilTypeOf(it, u) || "",
      typeRequired: requiredUtilType(u, it) || "",
      typeMismatch: !!utilTypeFix(it, u),
      /* the yes/no details behind "More…" — GFCI, dedicated, NG/LP, shutoff reach… */
      details: (it.utilFlags && it.utilFlags[u.key]) ? Object.assign({}, it.utilFlags[u.key]) : {},
      detailsText: utilFlagText(it, u),
      /* in a merge: which unit this connection serves */
      unitIndex: u.unit ? u.unit.idx : null,
      unitModel: u.unit ? u.unit.model : ""
    };
  }

  function openingPayload(it, n) {
    var e = itemEntry(it), v = itemVariation(it);
    var panel = panelSpec(it);
    return {
      clientId: it.id,
      sortOrder: n,
      area: it.area || "",
      location: it.location || "",
      brand: it.brand || "",
      model: it.model || "",
      appliance: it.appliance || "",
      title: itemTitle(it),
      where: itemWhere(it),
      category: (e && e.category) || it.category || "",

      installBasisCode: it.basisKey || "",
      installBasisLabel: it.installType || "",
      specPageRef: it.specRef || "",
      basisConfirmed: it.basisConfirmed || "",
      basisPending: basisPending(it),
      basisConflict: (function () {
        var m = basisMismatch(it);
        return m ? { chosen: m.chosen.label, betterFit: m.best.label } : null;
      })(),

      status: statusOf(it),
      statusLabel: statusOf(it) ? SK[statusOf(it)].long : "",
      done: isDone(it),
      started: isStarted(it),
      notMeasuredReason: it.notReady || "",
      irregular: !!it.multiPoint,
      conclusion: it.conclusion || "",
      punchLine: punchLine(it),
      fieldNote: it.notes || "",

      dimensions: dimsFor(it).map(function (d) { return dimPayload(it, d); }),
      utilities: utilitiesFor(it).map(function (u) { return utilityPayload(it, u); }),
      obstruction: (function () {
        var o = obstructionOf(it);
        if (!o.state) return null;
        return { state: o.state, kind: o.kind || "", projectsIn: num(o.projectsIn),
                 note: obstructionNote(it) };
      })(),
      utilityMarkConflicts: markConflicts(it),

      /* the measuring sheet this opening was walked on, and its own fields */
      form: (function () {
        var f = formOf(it);
        return {
          key: f.k, label: f.label, chosen: !!it.formKey,
          fields: f.fields.map(function (fd) {
            var v = formFieldVerdict(it, fd);
            return { code: fd.k, label: fd.label, valueIn: formVal(it, fd.k), minIn: formFieldMin(it, fd), state: v ? v.state : "" };
          }).filter(function (x) { return x.valueIn != null; }),
          checks: f.checks.map(function (c) { return { code: c.k, question: c.q, answer: formCheck(it, c.k), fix: formCheck(it, c.k) === "no" ? c.fix : "", owner: c.owner || "builder" }; })
            .filter(function (x) { return x.answer; })
        };
      })(),
      /* a merged opening: the units in it, left to right */
      merge: isMerge(it) ? {
        units: it.merge.units.map(function (u, i) {
          return { clientId: u.id, position: unitPos(i, it.merge.units.length), brand: u.brand, model: u.model,
                   appliance: u.appliance, specRef: u.specRef, basisKey: u.basisKey,
                   openingWIn: num(u.spec && u.spec.w), openingDIn: num(u.spec && u.spec.d), openingHIn: num(u.spec && u.spec.h) };
        }),
        kitState: kitState(it), widthBasis: it.merge.widthBasis, widthText: mergeWidthText(it)
      } : null,
      /* the panels as measured — one row each, with the target and the plane */
      panelsMeasured: (it.panels || []).map(function (pn) {
        var vs = panelVerdicts(pn);
        return { clientPanelId: pn.id, label: pn.label,
          widthIn: num(pn.w), heightIn: num(pn.h), targetWidthIn: num(pn.targetW), targetHeightIn: num(pn.targetH),
          plane: pn.plane || "", widthBad: vs.some(function (v) { return v.k === "w"; }), heightBad: vs.some(function (v) { return v.k === "h"; }),
          fixes: vs.map(function (v) { return v.fix; }) };
      }),
      flush: flushOn(it) ? (function () {
        var f = flushOf(it), out = { on: true, text: flushText(it) };
        FLUSH_FIELDS.forEach(function (fd) { out[fd.k + "In"] = num(f[fd.k]); });
        return out;
      })() : null,
      swing: swingOn(it) ? (function () {
        var sw = swingOf(it), f = swingFinding(it);
        return { hinge: sw.hinge || "", wallSide: sw.wallSide || "", clearanceIn: num(sw.clearanceIn),
          minIn: swingMin(it), finding: f ? f.text : "", blocks: !!(f && f.kind === "fix") };
      })() : null,
      finishedHeightIn: finishedHeight(walkOfItem(it), it),
      flooringDeductionIn: flooringDeduction(walkOfItem(it), it) || 0,

      panel: isPanelReady(it) ? {
        readyOverride: (it.panelReady === true || it.panelReady === false) ? it.panelReady : null,
        thicknessIn: panelThickness(it),
        suppliedBy: it.panelBy || "",
        onSiteState: it.panelState || "",
        pullsInstalled: it.panelPulls || "",
        requiredText: panelText(it),
        specMissing: panelSpecMissing(it),
        requiredWidthIn: panel ? num(panel.width) : null,
        requiredHeightIn: panel ? num(panel.height) : null,
        thickness: panel ? (panel.thickness || "") : "",
        weightLimit: panel ? (panel.weight || "") : "",
        specPageRef: panel ? (panel.page || "") : ""
      } : null,

      actions: actionsFor(it),
      findings: findingsFor(it),

      photos: it.photos.map(function (p, i) {
        return {
          clientId: p.id, portalId: p.portalId || "", caption: p.caption || "",
          kind: (it.overlay && it.overlay.photoId === p.id) ? "OPENING_FACE" : "OPENING",
          sortOrder: i, markup: markupPayload(p)
        };
      }),

      /* Who checked the opening dimensions against the manufacturer's
         drawing, and which printing of it. An opening that asks a builder
         to act should be able to say where its numbers came from. */
      dimsVerified: it.dimsVerified ? {
        by: it.dimsVerified.by || "",
        at: it.dimsVerified.at || "",
        sourceDoc: it.dimsVerified.sourceDoc || "",
        pageNo: it.dimsVerified.pageNo || null,
        sheetDate: it.dimsVerified.sheetDate || ""
      } : null,

      /* The install sheet this opening was measured against, photographed
         out of the spec package at import time. */
      planePhotos: Object.keys(it.planePhotos || {}).map(function (k) {
        var pp = it.planePhotos[k], d = planeDims(it, k);
        return { plane: k, photoClientId: pp.photoId || "", portalId: pp.portalId || "", corners: pp.corners || [], marks: pp.marks || {},
          widthIn: d ? d.w : null, heightIn: d ? d.h : null, addedOnSite: !!pp.added };
      }),
      utilitiesNone: !!it.utilitiesNone,      /* the office looked at the sheet and found no connections */
      prep: (it.prep || []).map(function (pr) {
        return { id: pr.id, kind: pr.kind, label: pr.label || "", text: prepText(pr, it), zone: pr.zone || null,
          setbackIn: num(pr.setbackIn), thicknessIn: num(pr.thicknessIn), note: pr.note || "",
          strip: isStrip(pr) ? { face: pr.strip.face, setbackIn: num(pr.strip.setbackIn), runIn: num(pr.strip.runIn), thicknessIn: num(pr.strip.thicknessIn), fromIn: num(pr.strip.fromIn), sizeIn: num(pr.strip.sizeIn), finished: prepFinished(pr), owner: prepOwner(pr) } : null,
          state: prepState(it, pr.id), fieldNote: (it.prepChecks[pr.id] || {}).note || "",
          found: isStrip(pr) ? { finished: prepFoundFinished(it, pr.id) || null, setbackIn: num(prepMeas(it, pr.id, "setbackIn")), runIn: num(prepMeas(it, pr.id, "runIn")), thicknessIn: num(prepMeas(it, pr.id, "thicknessIn")) } : null };
      }),
      specPages: (it.specPages || []).map(function (x) {
        return { photoClientId: x.photoId, portalId: x.portalId || "", pageNo: x.pageNo || null, sourceDoc: x.doc || "", heading: x.heading || "" };
      }),
      specPage: it.specPage ? {
        photoClientId: it.specPage.photoId,
        portalId: it.specPage.portalId || "",
        pageNo: it.specPage.pageNo || null,
        sourceDoc: it.specPage.doc || "",
        heading: it.specPage.heading || ""
      } : null,

      /* Second photographs for connections spec'd outside the plane of the
         opening — pins are photo-space fractions, they locate rather than
         measure. */
      servicePhotos: Object.keys(it.servicePhotos || {}).map(function (g) {
        var sp = it.servicePhotos[g];
        return {
          group: g,
          photoClientId: sp.photoId,
          portalId: sp.portalId || "",
          pins: Object.keys(sp.pins || {}).map(function (k) {
            return { code: k, xFrac: sp.pins[k][0], yFrac: sp.pins[k][1] };
          })
        };
      }),
      /* The calibration travels with the walk so the marked frame can be
         redrawn anywhere the photograph is available — the packet on a
         different machine, or the dashboard. */
      overlay: overlayReady(it.overlay) && marksMade(it) ? {
        photoClientId: it.overlay.photoId,
        corners: it.overlay.corners,
        frontCorners: (it.overlay.front && it.overlay.front.length === 4) ? it.overlay.front : null,
        depthIn: depthIn(it),
        marks: it.overlay.marks,
        targets: it.overlay.targets || {},
        planeWidthIn: (planeSize(it) || {}).w || null,
        planeHeightIn: (planeSize(it) || {}).h || null
      } : null,

      variationNotes: (v && v.notes) || ""
    };
  }

  function syncPayload(w) {
    var r = rollup(w), st = stage(w), c = r.counts;
    return {
      schema: "wilson.sitewalk/2",
      exportedAt: isoNow(),
      device: (window.navigator && window.navigator.userAgent) || "",
      walk: {
        clientId: w.id,
        jobNo: w.jobNo || "",
        project: w.project || "",
        address: w.address || "",
        builder: w.builder || "",
        builderContact: w.builderContact || "",
        builderEmail: w.builderEmail || "",
        walkDate: w.walkDate || "",
        walkedBy: w.walkedBy || "",
        specSource: w.specSource || "",
        salesName: w.salesName || "",
        salesEmail: w.salesEmail || "",
        flooringPending: !!flooringOf(w).pending,
        flooringThicknessIn: num(flooringOf(w).thicknessIn),
        installerName: w.installerName || "",
        installerPhone: w.installerPhone || "",
        quoteNo: w.quoteNo || "",
        reviewedAt: w.reviewedAt || "",
        reviewedBy: w.reviewedBy || "",
        note: w.note || "",
        packageModels: w.packageModels || [],
        sentAt: w.sentAt || "",
        sentTo: w.sentTo || "",
        createdAt: w.createdAt || "",
        updatedAt: w.updatedAt || "",
        stageCode: st.code,
        stageLabel: st.label,
        /* How the appliances get into the building. Required on every walk;
           a route nobody checked is a delivery nobody can make. */
        access: (function () {
          var a = accessOf(w);
          return {
            route: a.route || "", routeLabel: accessRouteLabel(w),
            state: a.state || "", stateLabel: accessStateLabel(w),
            tightestIn: num(a.tightestIn), note: a.note || "",
            answered: accessAnswered(w),
            findings: accessFindings(w),
            photos: a.photos.map(function (p, i) {
              return { clientId: p.id, portalId: p.portalId || "",
                       caption: p.caption || "", sortOrder: i, markup: markupPayload(p) };
            })
          };
        })(),
        /* the house, not the hole */
        prereqs: JOB_PREREQS.map(function (x) {
          var a = prereqAnswer(w, x.k);
          return { code: x.k, question: x.q, answer: a, fix: a === "no" ? x.fix : "", owner: x.owner, kind: x.kind || "fix" };
        }).filter(function (x) { return x.answer; }),
        prereqsAnswered: prereqsAnswered(w),
        jobFindings: jobFindings(w),
        /* the last comparison with the ePASS tickets (Phase A of the Agility
           link) — carried as data so the dashboard can show it without the
           pull */
        ticket: w.ticket ? {
          jobBase: w.ticket.jobBase || "", pulledAt: w.ticket.pulledAt || "", scheduleDate: w.ticket.scheduleDate || "",
          surveyOnTicket: !!w.ticket.surveyOnTicket, tickets: (w.ticket.tickets || []).map(function (t) { return t.code; }),
          open: (w.ticket.counts || {}).open || 0, blocks: (w.ticket.counts || {}).blocks || 0,
          applied: Object.keys(w.ticketApplied || {}).length,
          diffs: (w.ticket.diffs || []).map(function (d) { return { id: d.id, kind: d.kind, sub: d.sub || "", state: d.state, owner: d.owner, severity: d.severity, model: d.model || "", invoice: d.invoice || "", text: d.text, applied: !!(w.ticketApplied || {})[d.id] }; })
        } : null
      },
      rollup: {
        openings: r.total,
        walked: r.done,
        percentWalked: r.pct,
        readyCount: c.ready,
        verifyCount: c.verify,
        modifyCount: c.modify,
        decisionCount: c.decision,
        openCount: c.open,
        heldCount: c.held,
        blockerCount: r.blockers.length,
        attentionCount: r.attention.length,
        deliverable: r.deliverable
      },
      openings: w.items.map(function (it, i) { return openingPayload(it, i + 1); }),

      /* ---------- the walk itself, verbatim ----------------------------
         Everything above is a projection for the dashboard: flat rows, no
         arithmetic left to do. This is the walk object exactly as the
         client holds it, carried so another device can be handed the walk
         and pick up where this one left off.

         It exists because the alternative is worse. Rebuilding a walk from
         the projected rows would be a second implementation of the data
         model — the thing this whole sync path refuses to have — and it
         would be lossy anyway, since the projection deliberately drops
         thumbnails. A document beside the projection keeps one authority.

         Photographs are not in here. Their bytes go to the portal's photo
         store and are fetched by id; this carries only the thumbnails the
         walk already holds. */
      walkDocument: JSON.parse(JSON.stringify(w))
    };
  }

  /* ---------- state ---------------------------------------------------- */
  var LSKEY = "wilson-site-walk-v1";
  var STATE = null;
  var listeners = [];

  function uid(p) { return (p || "x") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function isoNow() { return new Date().toISOString(); }

  /* Flooring that is not down yet is a pending deduction from every
     floor-standing height on the job. "Flooring is gonna be 9/16 of an inch.
     So account for flooring when remeasuring." One answer per walk. */
  function flooringOf(w) {
    w.flooring = w.flooring || { pending: false, thicknessIn: "" };
    return w.flooring;
  }
  function blankWalk() {
    return {
      id: uid("walk"), jobNo: "", project: "", builder: "", builderContact: "", builderEmail: "",
      address: "", walkDate: today(), walkedBy: "", specSource: "Steel Cod Full Spec Package",
      /* Who sold the job. The walk starts from their spec package and comes
         back to them for review, so the packet knows whose name to sign. */
      salesName: "", salesEmail: "", quoteNo: "",
      reviewedAt: "", reviewedBy: "",
      installerName: "", installerPhone: "",
      flooring: { pending: false, thicknessIn: "" },
      prereqs: {},                         /* k -> yes | no | na — see JOB-LEVEL PREREQUISITES */
      ticket: null, ticketApplied: {},      /* the last ePASS comparison (site-walk-ticket.js) */
      access: { route: "", state: "", tightestIn: "", note: "", photos: [] },
      note: "", packageModels: [], items: [], sentAt: "", sentTo: "",
      createdAt: isoNow(), updatedAt: isoNow()
    };
  }
  function blankItem() {
    return {
      id: uid("op"), area: "", location: "", brand: "", model: "", appliance: "",
      installType: "", specRef: "", category: "",
      spec: { w: "", d: "", h: "", c: "" }, specMax: { w: "", d: "", h: "" }, actual: { w: "", d: "", h: "", c: "" },
      rule: { w: "exact", d: "min", h: "min", c: "exact" }, tol: "",
      planes4: false, measureAnyway: false,
      multiPoint: false,
      points: { w: ["", "", ""], d: ["", "", ""], h: ["", "", ""], c: ["", "", ""] },
      notReady: "",
      utilities: {},                       /* key -> ok | misplaced | missing */
      accepted: { w: "", d: "", h: "", c: "" },  /* a miss Wilson is not asking to be fixed */
      obstruction: { state: "", kind: "", projectsIn: "" },
      overlay: null,                       /* photo + 4 corners + marked locations */
      panelBy: "", panelState: "", panelPulls: "",
      /* set at the desk for a model the library does not know, or to
         override the entry: panel-ready, the panel's size and thickness,
         and the connections the sheet calls for */
      panelReady: null, panelThicknessIn: "", panelSize: { w: "", h: "" },
      utilitiesSpec: null,                 /* [{ key, label, need, where }] */
      utilitiesNone: false,                /* the office looked at the sheet and found no connections */
      pins: {},                            /* key -> { plane, x, y } in inches, placed on the drawing */
      acceptedUtil: {},                    /* key -> why a misplaced connection is left as is */
      /* "the spec looks wrong" from the phone: the office checks the sheet
         and either corrects the numbers or confirms them; until then the
         opening is Verify, nothing goes to the builder, and the packet is a
         draft. { note, by, at } or null. */
      specDoubt: null,
      /* cabinet prep the sheet calls for — cleats, cutouts, clearances, a
         vent path — drawn by the office, checked by the tech:
         [{ id, kind, label, zone, setbackIn, thicknessIn, note }] and
         prepChecks: { id: { state: "built"|"missing"|"wrong", note } } */
      prep: [],
      prepChecks: {},
      /* a neighbouring cabinet photographed and framed like the opening —
         plane -> { photoId, portalId, thumb, corners, marks, size } — so a
         box the office drew in the cabinet to the left overlays on it and
         the tech's pin reads in inches there too (v0.9.46) */
      planePhotos: {},

      basisKey: "", basisConfirmed: "",
      status: "", conclusion: "", punch: "", actions: [], question: "", options: [], fixMeta: {}, reveal: "",
      panels: [], utilTypes: {}, flush: null, swing: null, countertopPending: false,
      merge: null,                         /* { units, kit, widthBasis } — see MERGES */
      formKey: "", form: {}, formChecks: {}, /* the measuring sheet — see FORMS */
      notes: "", photos: [], pageBreak: "own",
      /* The manufacturer's install sheet, photographed out of the spec
         package at import time. The field tech gets it one tap away; the
         packet prints it beside the readings it was measured against. */
      specPage: null,                      /* { photoId, thumb, pageNo, doc, heading } */
      specPages: [],                       /* extra pages ticked at import, same shape */
      /* Who read the opening dimensions off that sheet, and when. An
         opening whose numbers nobody verified must never print a confident
         verdict, so this travels with the walk and onto the packet. */
      dimsVerified: null,                  /* { by, at, sourceDoc, pageNo, sheetDate } */
      /* Connections spec'd OUTSIDE the plane of the opening — the Cove
         pattern, "electrical location in adjacent cabinet". A second
         photograph per service group with a dropped pin per connection. */
      servicePhotos: {}                    /* group -> { photoId, portalId, thumb, pins: {key:[u,v]} } */
    };
  }
  function normItem(it) {
    var b = blankItem(); it.id = it.id || b.id;
    for (var k in b) if (!(k in it)) it[k] = b[k];
    ["spec", "specMax", "actual", "rule", "accepted", "panelSize"].forEach(function (g) { it[g] = Object.assign({}, b[g], it[g] || {}); });
    it.panelReady = (it.panelReady === true || it.panelReady === false) ? it.panelReady : null;
    it.utilitiesSpec = Array.isArray(it.utilitiesSpec) && it.utilitiesSpec.length ? it.utilitiesSpec : null;
    it.utilitiesNone = !!it.utilitiesNone;
    it.adjacentSide = it.adjacentSide === "left" || it.adjacentSide === "right" ? it.adjacentSide : "";
    it.pins = (it.pins && typeof it.pins === "object") ? it.pins : {};
    it.acceptedUtil = (it.acceptedUtil && typeof it.acceptedUtil === "object") ? it.acceptedUtil : {};
    it.specDoubt = (it.specDoubt && typeof it.specDoubt === "object" && it.specDoubt.note) ? it.specDoubt : null;
    it.prep = Array.isArray(it.prep) ? it.prep.filter(function (x) { return x && x.kind; }) : [];
    it.planePhotos = (it.planePhotos && typeof it.planePhotos === "object") ? it.planePhotos : {};
    Object.keys(it.planePhotos).forEach(function (k) {
      var pp = it.planePhotos[k];
      /* a plane entry survives with a photo, or as a cabinet the tech
         added to the run (no photo, a typed size) */
      if (!pp || (!pp.photoId && !pp.added)) { delete it.planePhotos[k]; return; }
      pp.corners = Array.isArray(pp.corners) ? pp.corners : [];
      pp.marks = pp.marks && typeof pp.marks === "object" ? pp.marks : {};
    });
    it.prepChecks = (it.prepChecks && typeof it.prepChecks === "object") ? it.prepChecks : {};
    it.obstruction = Object.assign({}, b.obstruction, it.obstruction || {});
    it.points = it.points || { w: ["", "", ""], d: ["", "", ""], h: ["", "", ""], c: ["", "", ""] };
    DIMS.concat([DIM4]).forEach(function (d) {
      var arr = it.points[d.k] || [];
      it.points[d.k] = [arr[0] || "", arr[1] || "", arr[2] || ""];
    });
    it.actions = normActions(it.actions); it.photos = it.photos || []; it.options = it.options || [];
    it.fixMeta = it.fixMeta || {};
    it.reveal = it.reveal || "";
    it.panels = (it.panels || []).map(normPanel);
    it.utilTypes = it.utilTypes || {}; it.utilFlags = it.utilFlags || {}; it.runGap = it.runGap || null;
    it.flush = it.flush || null;
    it.swing = it.swing || null;
    it.merge = (it.merge && it.merge.units && it.merge.units.length > 1) ? it.merge : null;
    it.formKey = FORMS[it.formKey] ? it.formKey : ""; it.form = it.form || {}; it.formChecks = it.formChecks || {};
    if (it.merge) { it.merge.kit = it.merge.kit || { state: "", partNo: "", note: "" }; it.merge.widthBasis = it.merge.widthBasis || "sum"; }
    it.countertopPending = !!it.countertopPending;
    it.utilities = it.utilities || {};
    it.servicePhotos = it.servicePhotos || {};
    Object.keys(it.servicePhotos).forEach(function (g) {
      var sp = it.servicePhotos[g];
      if (!sp || !sp.photoId) { delete it.servicePhotos[g]; return; }
      sp.pins = sp.pins || {};
    });
    if (it.specPage && !it.specPage.photoId) it.specPage = null;
    it.specPages = Array.isArray(it.specPages) ? it.specPages.filter(function (p) { return p && p.photoId; }) : [];
    if (it.dimsVerified && !it.dimsVerified.at) it.dimsVerified = null;
    if (it.overlay) {
      it.overlay.corners = (it.overlay.corners || []).slice(0, 4);
      it.overlay.front = Array.isArray(it.overlay.front) ? it.overlay.front.slice(0, 4) : [];
      it.overlay.marks = it.overlay.marks || {};
      it.overlay.targets = it.overlay.targets || {};
    }
    return it;
  }
  function normWalk(w) {
    var b = blankWalk(); w.id = w.id || b.id;
    for (var k in b) if (!(k in w)) w[k] = b[k];
    w.access = Object.assign({}, b.access, w.access || {});
    w.access.photos = w.access.photos || [];
    w.flooring = Object.assign({}, b.flooring, w.flooring || {});
    w.prereqs = w.prereqs || {};
    w.ticket = w.ticket || null; w.ticketApplied = w.ticketApplied || {};
    w.items = (w.items || []).map(normItem);
    return w;
  }

  function load() {
    if (STATE) return STATE;
    var raw = null;
    try { raw = JSON.parse(window.localStorage.getItem(LSKEY) || "null"); } catch (e) { raw = null; }
    if (!raw || !raw.walks) raw = { v: 1, walks: [], models: [], dims: {} };
    raw.walks = (raw.walks || []).map(normWalk);
    raw.models = raw.models || [];
    raw.dims = raw.dims || {};
    STATE = raw;
    /* A shared build can carry state in the page itself. If the copy that
       arrived with the page is newer than the copy on this device, take it —
       otherwise the device keeps its own, unsynced work. */
    var emb = window.WILSON_SW_EMBEDDED;
    if (emb && emb.walks && (emb.rev || 0) > (STATE.rev || 0)) {
      STATE = { v: 1, rev: emb.rev || 0, walks: emb.walks.map(normWalk),
                models: emb.models || [], dims: emb.dims || {} };
      try { window.localStorage.setItem(LSKEY, JSON.stringify(STATE)); } catch (e) { }
    }
    /* A page that opens holding work nobody has sent must know it. */
    try { adoptUnsent(); } catch (e) { }
    /* Nothing is seeded automatically. A demo walk that looks like a live
       one is a document hazard: a tech measures into it, the openings nobody
       touched keep the demo's readings, and the packet goes out with today's
       date on last month's numbers. The office can load the example
       deliberately — see loadDemo(). */
    return STATE;
  }
  /* ---------- the write, and what happens when it cannot happen ----------
     localStorage is about 5 MB, and a walk with photographs and rendered
     spec pages can approach that. The old code swallowed the quota error
     and left a comment claiming the dirty flag would tell somebody — it
     does not, in any way a technician standing in a kitchen would notice.
     A tech who keeps measuring into a store that is silently refusing every
     write loses the whole walk, which is the worst outcome this tool has.

     So a failed write is now loud, sticky and impossible to miss, and it
     says the one thing that actually helps: send what you have now. */
  var storageFull = false, lastSaveError = "";
  function storageState() {
    if (!lastBytes) { try { lastBytes = (window.localStorage.getItem(LSKEY) || "").length; } catch (e) { } }
    return { full: storageFull, error: lastSaveError, bytes: lastBytes };
  }
  var lastBytes = 0;
  /* The travel copies of the install sheets are what fill a browser:
     ~1.1 MB a walk against a ~5 MB localStorage ceiling, so four test
     builds and the fifth walk "is gone" (Cayden, 22 Oct). With a shop
     server every page is held full size by id and fetched on demand, so
     the copies can be shed to make room — oldest walks first, and never
     the one just made. Returns how many pages were shed. */
  function shedTravelCopies(keepWalkId) {
    if (!hasPortal()) return 0;
    var n = 0;
    var list = (STATE.walks || []).slice().reverse();      /* oldest first */
    list.forEach(function (w) {
      if (w.id === keepWalkId) return;
      (w.items || []).forEach(function (it) {
        if (it.specPage && it.specPage.thumb) { it.specPage.thumb = ""; n++; }
        (it.specPages || []).forEach(function (x) { if (x.thumb) { x.thumb = ""; n++; } });
      });
    });
    return n;
  }
  /* ---------- walks the server already holds (v0.9.84) -------------------
     Every walk a browser opens is kept in its own store, which holds about
     5 MB. With a server that has every walk, the copies of finished ones are
     dead weight, and an office computer would fill up after fifteen or twenty
     walks. So, only where the host has a server gate:
       - a walk that has been sent, with nothing here still to send, is
         dropped the next time a page loads (it reopens from the server);
       - when the store is full, walks with nothing to send are dropped,
         oldest first, until the save fits.
     Never dropped: a walk with unsent work, or the walk the page is on. */
  function hasGate() { return hasPortal() && !!((window.WILSON_SW_API || {}).gate); }
  function walkIdsInAddress() {
    var out = {};
    try { (String(window.location.href).match(/walk_[A-Za-z0-9_]+/g) || []).forEach(function (id) { out[id] = true; }); } catch (e) { }
    return out;
  }
  function nothingToSend(w) { return !!w && !!w.syncRev && w.syncRev === w.updatedAt; }
  function shedSentWalks() {
    if (!hasGate() || !STATE) return 0;
    var keep = walkIdsInAddress(), before = STATE.walks.length;
    STATE.walks = STATE.walks.filter(function (w) { return keep[w.id] || !(w.sentAt && nothingToSend(w)); });
    return before - STATE.walks.length;
  }
  function shedOneSyncedWalk() {
    if (!hasGate() || !STATE) return false;
    var keep = walkIdsInAddress();
    var cands = STATE.walks.filter(function (w) { return !keep[w.id] && nothingToSend(w); })
      .sort(function (a, b) { return (a.updatedAt || "") < (b.updatedAt || "") ? -1 : 1; });
    if (!cands.length) return false;
    STATE.walks = STATE.walks.filter(function (w) { return w !== cands[0]; });
    return true;
  }
  /* called once by each page as it starts */
  function tidyHeld() {
    load();
    var n = shedSentWalks();
    if (n) save();
    return n;
  }
  function save() {
    var json;
    try { json = JSON.stringify(STATE); }
    catch (e) { json = null; }
    if (json != null) {
      try {
        window.localStorage.setItem(LSKEY, json);
        lastBytes = json.length;
        if (storageFull) { storageFull = false; lastSaveError = ""; renderStorageBanner(); }
      } catch (e) {
        /* out of room: shed the sheets' travel copies (the server has them) and try once more */
        var retried = false;
        if (shedTravelCopies((STATE.walks[0] || {}).id)) {
          try { json = JSON.stringify(STATE); window.localStorage.setItem(LSKEY, json); retried = true; } catch (e2) { }
        }
        /* still no room: let go of walks the server holds, oldest first */
        while (!retried && shedOneSyncedWalk()) {
          try { json = JSON.stringify(STATE); window.localStorage.setItem(LSKEY, json); retried = true; } catch (e3) { }
        }
        if (retried) {
          lastBytes = json.length;
          if (storageFull) { storageFull = false; lastSaveError = ""; renderStorageBanner(); }
        } else {
          storageFull = true;
          lastSaveError = (e && e.name) || "QuotaExceededError";
          lastBytes = json.length;
          renderStorageBanner();
        }
      }
    }
    markDirty();
    listeners.forEach(function (fn) { try { fn(); } catch (e) { } });
  }

  /* Its own banner, above the sync banner, because "not saved on this
     device" is a different and worse fact than "not sent yet". */
  function renderStorageBanner() {
    if (typeof document === "undefined" || !document.body) return;
    var id = "sw-storage-banner";
    var el = document.getElementById(id);
    if (!storageFull) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.className = "sw-storage-banner";
      document.body.insertBefore(el, document.body.firstChild);
    }
    var mb = (lastBytes / 1048576).toFixed(1);
    el.innerHTML =
      '<strong>This phone is out of room — the last change was NOT saved.</strong>' +
      "<span>The walk holds about " + mb + " MB and the browser will not take more. " +
      "Send what you have now, then delete a finished walk from the office screen. " +
      "Do not keep measuring: nothing more will be stored on this device.</span>" +
      '<button type="button" data-sw-storage-send>Send now</button>';
    var btn = el.querySelector("[data-sw-storage-send]");
    if (btn) btn.onclick = function () { trySync("storage full"); };
  }
  function onChange(fn) { listeners.push(fn); }

  /* The example walk, on request only, and clearly stamped as an example so
     it can never be mistaken for a jobsite record. */
  function hasDemo() { return !!(window.WILSON_SW_DEMO && window.WILSON_SW_DEMO.walks); }
  function loadDemo() {
    if (!hasDemo()) return null;
    var st = load();
    var w = normWalk(JSON.parse(JSON.stringify(window.WILSON_SW_DEMO.walks[0])));
    w.id = uid("walk");
    w.project = "EXAMPLE — " + (w.project || "site walk");
    w.note = "Example only. Measurements carried over from the manual August packet — " +
      "this is not a jobsite record and must not be sent to a builder.";
    st.walks.unshift(w);
    save();
    return w;
  }
  /* ---------- receiving a walk from the office ---------------------------
     The outbox only ever pushed: the phone measured, the server listened.
     That was right when the phone was the only author. The spec-package
     flow made the office an author too, so a walk now has to be able to
     travel down to a truck that has never seen it.

     The rule on arrival is the same rule as on the server, pointed the
     other way: whoever holds the newer copy wins, and field work is never
     overwritten by an older office copy. A walk this device has already
     touched more recently is left alone. */
  /* ---------- where the server lives (v0.9.83) ---------------------------
     The standalone server answers at /api/sitewalk/… and /photo-store/…;
     Agility answers at /api/site-walk/…. A hosting page says where by
     setting window.WILSON_SW_API before this file loads; with nothing set,
     every address is the standalone's and nothing changes. The keys:
       pull, sync, walks, session, photos, photoBase   — addresses
       gate   — base for /walks/<id>/sign-off and /walks/<id>/sent; when set,
                sign-off and "sent" are decided by the server under a login
       login  — where a signed-out browser is sent
       live   — milliseconds between looks at the server for newer work */
  var API = window.WILSON_SW_API || {};
  function apiUrl(k, dflt) { return API[k] || dflt; }
  function pullWalks(clientId) {
    if (!hasPortal()) return Promise.resolve({ ok: false, reason: "no portal" });
    return fetch(apiUrl("pull", "/api/sitewalk/pull") + (clientId ? "?client=" + encodeURIComponent(clientId) : ""), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        if (!body || !body.ok) return { ok: false, reason: "unavailable" };
        return { ok: true, offers: body.walks || [], held: body.held || null };
      })
      .catch(function () { return { ok: false, reason: "offline" }; });
  }
  /* What an offer would do if accepted, so the screen can say so plainly
     rather than making the tech guess. */
  function offerState(offer) {
    var mine = walk(offer.clientId);
    if (!mine) return { kind: "new" };
    /* v0.9.84: an offer may be a summary with no document in it (the server's
       list no longer carries every walk whole); its own revision is enough */
    var here = mine.updatedAt || "", there = (offer.walk && offer.walk.updatedAt) || offer.updatedAt || "";
    if (here && there && here > there) return { kind: "mine-newer", here: here, there: there };
    if (here && there && here === there) return { kind: "same" };
    return { kind: "theirs-newer", here: here, there: there };
  }
  function acceptWalk(offer) {
    /* a summary has no walk in it to accept; takeOffer fetches one */
    if (!offer || !offer.walk) return { ok: false, reason: "no-document" };
    var st = load();
    var incoming = normWalk(JSON.parse(JSON.stringify(offer.walk)));
    var state = offerState(offer);
    if (state.kind === "mine-newer") return { ok: false, reason: "mine-newer" };
    var at = -1;
    st.walks.forEach(function (w, i) { if (w.id === incoming.id) at = i; });
    /* A walk arriving from the office has not been sent from here, so it
       must look pending to this device's outbox or the tech's first
       measurement would not be posted back. */
    incoming.syncRev = "";
    if (at >= 0) st.walks[at] = incoming; else st.walks.unshift(incoming);
    save();
    return { ok: true, walk: incoming, replaced: at >= 0 };
  }

  /* A walk this device was pointed at (…?walk=<id>) but does not hold yet:
     fetch it and keep it, so "open the walk" is one tap and the copy that
     makes it work with no signal is made without anybody asking for it.
     Also brings a held walk up to date when the server's is newer and
     nothing here is waiting to be sent. Resolves the walk, or null. */
  function ensureWalk(id) {
    var mine = walk(id);
    if (!id || !hasPortal()) return Promise.resolve(mine);
    if (mine && mine.syncRev !== mine.updatedAt) return Promise.resolve(mine);   /* unsent work here: this device is the authority */
    return pullWalks(id).then(function (res) {
      var offer = res && res.ok ? (res.offers || []).filter(function (o) { return o.clientId === id && o.walk; })[0] : null;
      if (!offer) return walk(id);
      var st = offerState(offer);
      if (st.kind === "new" || st.kind === "theirs-newer" || (st.kind === "same" && serverFactsDiffer(walk(id), offer.walk))) {
        var got = acceptWalk(offer);
        if (got.ok) {
          /* it came from the server as it stands there: nothing to send back */
          got.walk.syncRev = got.walk.updatedAt; save();
          return got.walk;
        }
      }
      return walk(id);
    }).catch(function () { return walk(id); });
  }
  /* Sign-off and "sent" are the server's facts; a copy with the same
     revision can still be behind on them. */
  function serverFactsDiffer(mine, theirs) {
    if (!mine || !theirs) return false;
    return (mine.reviewedAt || "") !== (theirs.reviewedAt || "") || (mine.sentAt || "") !== (theirs.sentAt || "");
  }
  /* Given the server's queue rows, bring every walk held here that the server
     has newer up to date. Returns a promise of how many changed. Used by the
     pages' own timers, so a walk being measured on a phone fills in on every
     screen that has it open. */
  function adoptNewer(rows) {
    var want = (rows || []).filter(function (r) {
      var mine = walk(r.ClientWalkId);
      if (!mine || !r.ClientUpdatedAt) return false;
      if (mine.syncRev !== mine.updatedAt) return false;
      return r.ClientUpdatedAt > (mine.updatedAt || "") ||
        (r.SignedOffAt ? !mine.reviewedAt : !!mine.reviewedAt) || (r.PacketSentAt ? !mine.sentAt : false);
    });
    return want.reduce(function (p, r) {
      return p.then(function (n) {
        var before = walk(r.ClientWalkId), stamp = before ? before.updatedAt + "|" + (before.reviewedAt || "") + "|" + (before.sentAt || "") : "";
        return ensureWalk(r.ClientWalkId).then(function (w) {
          return n + (w && (w.updatedAt + "|" + (w.reviewedAt || "") + "|" + (w.sentAt || "")) !== stamp ? 1 : 0);
        });
      });
    }, Promise.resolve(0));
  }
  function liveMs() { return hasPortal() && +API.live > 0 ? +API.live : 0; }

  /* Who is signed in. Asked once, remembered on the device so the name is
     still known at a house with no signal. Null where there is no login. */
  var USER_KEY = "wilson.sitewalk.user", sessionUserCache = null;
  function sessionUser() {
    if (sessionUserCache) return sessionUserCache;
    try { sessionUserCache = JSON.parse(window.localStorage.getItem(USER_KEY) || "null"); } catch (e) { sessionUserCache = null; }
    return sessionUserCache;
  }
  function whoAmI() {
    if (!hasPortal() || !API.session) return Promise.resolve(sessionUser());
    return fetch(API.session, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        if (b && b.ok && b.user && (b.user.displayName || b.user.email)) {
          sessionUserCache = { email: b.user.email || "", displayName: b.user.displayName || b.user.email || "" };
          try { window.localStorage.setItem(USER_KEY, JSON.stringify(sessionUserCache)); } catch (e) { }
        }
        return sessionUser();
      }).catch(function () { return sessionUser(); });
  }
  /* The gate before a packet goes out. Where the host has a login (API.gate)
     the server stamps it under that login and refuses out of order; anywhere
     else the page stamps it as it always did. Both resolve
     { ok, at, by, why }. */
  function gatePost(id, what, body) {
    return fetch(API.gate + "/walks/" + encodeURIComponent(id) + "/" + what, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401 || r.status === 403) return { ok: false, why: "Sign in again, then try once more." };
        return r.ok && b.ok ? b : { ok: false, why: b.error || b.why || ("The server answered " + r.status + ".") };
      });
    }, function () { return { ok: false, why: "The server could not be reached. Nothing was changed." }; });
  }
  function signOff(w) {
    if (!w) return Promise.resolve({ ok: false, why: "No walk." });
    if (!hasPortal() || !API.gate) {
      var by = w.walkedBy || w.salesName || "Office";
      w.reviewedAt = isoNow(); w.reviewedBy = by; touch(w); save();
      return Promise.resolve({ ok: true, at: w.reviewedAt, by: by });
    }
    /* the server must hold the finished walk before it will sign it off */
    saveNow();
    return Promise.resolve(trySync("sign-off")).then(function () {
      return gatePost(w.id, "sign-off", {});
    }).then(function (b) {
      if (!b.ok) return b;
      w.reviewedAt = b.signedOffAt; w.reviewedBy = b.signedOffBy; touch(w); save();
      return { ok: true, at: b.signedOffAt, by: b.signedOffBy };
    });
  }
  /* Take a walk out of everybody's list. With a server gate the server
     archives it (it can be restored there) and this device lets its copy go;
     anywhere else the caller deletes the local copy as it always did. */
  function archiveWalk(w) {
    if (!w) return Promise.resolve({ ok: false, why: "No walk." });
    if (!hasGate()) return Promise.resolve({ ok: true, local: true });
    var drop = function () { STATE.walks = STATE.walks.filter(function (x) { return x.id !== w.id; }); save(); };
    /* a walk that never reached the server has nothing to archive there */
    if (!w.syncRev) { drop(); return Promise.resolve({ ok: true, local: true }); }
    return gatePost(w.id, "archive", {}).then(function (b) {
      if (!b.ok) return b;
      drop();
      return { ok: true };
    });
  }
  /* Open an offered walk on this device. An offer that carries its document
     is taken as before; a summary is fetched by its id. Resolves
     { ok, walk, reason }. */
  function takeOffer(offer) {
    if (!offer) return Promise.resolve({ ok: false, reason: "none" });
    if (offer.walk) return Promise.resolve(acceptWalk(offer));
    if (offerState(offer).kind === "mine-newer") return Promise.resolve({ ok: false, reason: "mine-newer" });
    return ensureWalk(offer.clientId).then(function (w) {
      return w ? { ok: true, walk: w } : { ok: false, reason: "unreachable" };
    });
  }
  /* What the server's queue last said, for anything that needs to know
     whether a job already has a walk somewhere else. */
  var serverRowsCache = [];
  function setServerRows(rows) { serverRowsCache = Array.isArray(rows) ? rows : []; }
  function serverRows() { return serverRowsCache; }

  function markSent(w, to) {
    if (!w) return Promise.resolve({ ok: false, why: "No walk." });
    if (!hasPortal() || !API.gate) {
      w.sentAt = isoNow(); w.sentTo = to || ""; touch(w); save();
      return Promise.resolve({ ok: true, at: w.sentAt });
    }
    return gatePost(w.id, "sent", { to: to || "" }).then(function (b) {
      if (!b.ok) return b;
      w.sentAt = b.sentAt; w.sentTo = to || ""; touch(w); save();
      return { ok: true, at: b.sentAt };
    });
  }

  function walks() { return load().walks; }
  function walk(id) { return walks().filter(function (w) { return w.id === id; })[0] || null; }
  function item(w, id) { return w ? (w.items.filter(function (i) { return i.id === id; })[0] || null) : null; }
  function addWalk() { var w = blankWalk(); load().walks.unshift(w); save(); return w; }
  function touch(w) { if (w) w.updatedAt = isoNow(); }

  /* Debounced autosave, 450ms, matching the maintenance tool: every tap
     writes, nothing waits for a Save button. */
  var saveTimer = null, dirty = false;
  function scheduleSave(cb) {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save(); dirty = false; if (cb) cb(); }, 450);
  }
  function saveNow() { if (saveTimer) clearTimeout(saveTimer); save(); dirty = false; }
  function isDirty() { return dirty; }

  /* ---------- sync: offline first, sent later ---------------------------
     The walk itself never needs a network. Measurements go to localStorage
     on every tap and photographs to IndexedDB, so a tech in a basement with
     no bars is not degraded — he is in the normal case.

     What needs a network is sending the walk somewhere else. That is an
     outbox: work is queued here, attempts are made when there is something
     to attempt with, and the banner says what is actually true rather than
     what is reassuring. The wording rule is the maintenance portal's and it
     was learned the hard way — never tell a technician his photographs
     "will sync", because he will assume they are safe on a server when they
     are on one phone.

     `transport` is the seam. The hosted preview registers the artifact
     publish; the portal will register an API POST. Neither is known here. */
  var transport = null, transportLabel = "";
  var syncMeta = { since: 0, lastAt: 0, error: "", busy: false, attempts: 0 };
  var syncListeners = [];
  var retryTimer = null;

  function onSync(fn) { syncListeners.push(fn); }
  function notifySync() {
    renderSyncBanner();
    syncListeners.forEach(function (fn) { try { fn(syncState()); } catch (e) { } });
  }
  function setTransport(fn, label) {
    transport = fn; transportLabel = label || "the shared link";
    /* The transport registers while the scripts are still loading, before
       any surface has asked for the state — so the walks have to be read
       here or the outbox cannot see that it is holding one. Without this a
       page that opens carrying unsent work waits for the technician to
       touch something before it tries, which on the office side meant an
       imported walk sat on the desk and never reached the server. */
    try { load(); adoptUnsent(); } catch (e) { }
    notifySync();
    trySync("transport ready");
  }
  /* Every save calls this, including the save the transport itself triggers
     when it stamps a revision on the way out. That write must not re-arm
     the outbox, or a walk that just went through reads as unsent forever —
     so "dirty" asks the walks whether anything is actually unsent rather
     than assuming a write means work is waiting. */
  var autoSyncTimer = null;
  function markDirty() {
    if (!syncMeta.since && hasUnsent()) syncMeta.since = Date.now();
    syncMeta.error = "";
    notifySync();
    /* Send on its own, a moment after the last change. Until 13 Oct the
       outbox only went out on "transport ready", a retry, a tap on the
       banner, or the page coming back into view — so a walk the office had
       just set up sat on the desk, and the phone's "from the office" list
       stayed empty until somebody tapped the banner. The transport's own
       stamp-and-save comes back through here with nothing unsent, so this
       cannot loop. */
    if (transport && syncMeta.since && online()) {
      if (autoSyncTimer) clearTimeout(autoSyncTimer);
      autoSyncTimer = setTimeout(function () { autoSyncTimer = null; trySync("autosave"); }, 1500);
    }
  }

  /* ---------- "is there anything to send" is a fact, not a flag ----------
     `syncMeta.since` lives in memory, and the portal serves three separate
     pages. Finishing a spec-package import navigates from the wizard to the
     setup page, so the flag died with the old page and the outbox forgot it
     was holding a walk — office-created walks never reached the server at
     all, and it looked exactly like a broken sync.

     The walks themselves already carry the answer: the transport stamps
     `syncRev` with the `updatedAt` it sent, so anything where those differ
     has not been sent. Ask the data. */
  function unsentWalks() {
    return (STATE ? STATE.walks : []).filter(function (w) {
      return !w.syncRev || w.syncRev !== w.updatedAt;
    });
  }
  function hasUnsent() { return unsentWalks().length > 0; }
  /* Called once the state is loaded, so a page that opens holding unsent
     work knows it straight away rather than waiting for the next tap. */
  function adoptUnsent() {
    if (syncMeta.since) return;
    var list = unsentWalks();
    if (!list.length) return;
    var oldest = list.reduce(function (acc, w) {
      var t = Date.parse(w.updatedAt || "") || Date.now();
      return acc == null || t < acc ? t : acc;
    }, null);
    syncMeta.since = oldest || Date.now();
    notifySync();
  }
  function online() { return typeof navigator === "undefined" || navigator.onLine !== false; }

  /* What is on this device and has not left it. Counted, never asserted. */
  function heldHere() {
    var walks = 0, openings = 0, photos = 0;
    (STATE ? STATE.walks : []).forEach(function (w) {
      var touched = w.items.filter(isStarted).length;
      if (touched) { walks++; openings += touched; }
      w.items.forEach(function (it) { photos += it.photos.length; });
    });
    return { walks: walks, openings: openings, photos: photos };
  }
  function syncState() {
    return {
      pending: syncMeta.since > 0, since: syncMeta.since, lastAt: syncMeta.lastAt,
      error: syncMeta.error, busy: syncMeta.busy, online: online(),
      hasTransport: !!transport, label: transportLabel, held: heldHere()
    };
  }

  function scheduleRetry() {
    if (retryTimer || !syncMeta.since || !transport) return;
    /* Back off, but never past a minute: a tech walking out of a mechanical
       room should not wait five minutes for the outbox to notice. */
    var wait = Math.min(60000, 5000 * Math.pow(2, Math.min(syncMeta.attempts, 4)));
    retryTimer = setTimeout(function () { retryTimer = null; trySync("retry"); }, wait);
  }
  function trySync(reason) {
    if (!transport || syncMeta.busy) return Promise.resolve(false);
    /* A fresh page can be holding unsent work with no flag set yet. */
    if (!syncMeta.since && hasUnsent()) adoptUnsent();
    if (!syncMeta.since) return Promise.resolve(false);
    if (!online()) { syncMeta.error = "offline"; notifySync(); return Promise.resolve(false); }
    syncMeta.busy = true; syncMeta.error = ""; notifySync();
    return Promise.resolve()
      .then(function () { return transport(STATE); })
      .then(function () {
        syncMeta.busy = false;
        syncMeta.attempts = 0;
        syncMeta.lastAt = Date.now();
        /* "Nothing left to send" is the fact that matters, and the walks
           answer it directly — the transport stamps each one as it goes.
           The old `since === at` test was a proxy for "did anything change
           mid-flight", and it read as permanently unsent once the transport
           began stamping revisions, because that write marks the outbox
           dirty again on its way out. */
        if (!hasUnsent()) syncMeta.since = 0;
        syncMeta.error = "";
        notifySync();
        return true;
      })
      .catch(function (err) {
        syncMeta.busy = false;
        syncMeta.attempts++;
        syncMeta.error = (err && (err.code || err.message)) || "failed";
        notifySync();
        scheduleRetry();
        return false;
      });
  }

  /* ---------- the banner ----------
     One element, owned here, so every surface gets the same truth. */
  function relTime(ms) {
    if (!ms) return "";
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " hr ago";
    return Math.round(s / 86400) + " days ago";
  }
  function heldPhrase(h) {
    var bits = [];
    if (h.openings) bits.push(h.openings + " opening" + (h.openings === 1 ? "" : "s"));
    if (h.photos) bits.push(h.photos + " photograph" + (h.photos === 1 ? "" : "s"));
    return bits.join(" and ");
  }
  function syncMessage() {
    var st = syncState(), held = heldPhrase(st.held);
    if (!st.online) {
      return { tone: "offline", show: true, html:
        "<strong>Working offline.</strong> Everything you enter is saved on this phone as you go." +
        (held ? " " + held + " are held here and have not been sent yet." : "") };
    }
    if (!st.hasTransport) {
      return { tone: "local", show: !!held, html:
        "<strong>This device only.</strong> " + (held ? held + " are saved here. " : "") +
        "Nothing is being sent anywhere." };
    }
    if (st.busy) return { tone: "busy", show: true, html: "<strong>Sending…</strong> Do not close this tab." };
    if (st.pending && st.error) {
      /* say why, so the shop knows whether to sign in again, restart the
         server, or send the walk to Claude (Cayden, 21 Oct: a red banner
         with no reason on it) */
      var why = String(st.error || "");
      if (/sign in/i.test(why)) {
        return { tone: "error", show: true, action: "signin", html:
          "<strong>Signed out.</strong> The server was restarted or the session expired — " +
          '<a href="' + apiUrl("login", "/login") + "?next=" + encodeURIComponent(location.pathname + location.search + location.hash) + '">sign in again</a> and sending resumes. Your work is safe on this device' + (held ? " — " + held : "") + "." };
      }
      return { tone: "error", show: true, action: "sync", html:
        "<strong>Could not send.</strong> Your work is safe on this device" +
        (held ? " — " + held : "") + ". " + (why && why !== "failed" && why !== "offline" ? (/^!/.test(why) ? String(why.slice(1)).replace(/[<>&]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }) + " " : "The server said: <em>" + String(why).replace(/[<>&]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }) + "</em>. ") : "") + "Trying again shortly." };
    }
    if (st.pending) {
      return { tone: "pending", show: true, action: "sync", html:
        "<strong>Not sent yet.</strong> " + (held ? held + " saved on this phone." : "Changes saved on this phone.") };
    }
    return { tone: "clean", show: false, html: "" };
  }
  function renderSyncBanner() {
    if (typeof document === "undefined" || !document.body) return;
    var msg = syncMessage();
    var node = document.getElementById("wilson-offline-banner");
    if (!msg.show) {
      if (node) node.remove();
      document.body.classList.remove("is-offline");
      document.body.classList.remove("has-banner");
      return;
    }
    if (!node) {
      node = document.createElement("div");
      node.id = "wilson-offline-banner";
      node.className = "offline-banner no-print";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      document.body.appendChild(node);
      node.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-sync-now]") : null;
        if (b) trySync("tapped");
      });
    }
    document.body.classList.toggle("is-offline", msg.tone === "offline");
    document.body.classList.add("has-banner");
    node.setAttribute("data-tone", msg.tone);
    node.innerHTML = msg.html +
      (msg.action === "sync" ? ' <button class="sync-now" data-sync-now>Send now</button>' : "") +
      (syncMeta.lastAt && msg.tone !== "offline" ? ' <span class="sync-when">last sent ' + relTime(syncMeta.lastAt) + "</span>" : "");
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", function () { syncMeta.attempts = 0; notifySync(); trySync("back online"); });
    window.addEventListener("offline", notifySync);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) { notifySync(); trySync("visible"); }
      });
    }
    /* An accidental swipe-close on a jobsite is the one way work leaves this
       phone unsent, so it is worth one confirmation. */
    window.addEventListener("beforeunload", function (e) {
      if (dirty) saveNow();
      if (syncMeta.since && transport) { e.preventDefault(); e.returnValue = ""; }
    });
    /* A save waits 450 ms after the last tap; a tech who taps and leaves
       the page inside that window lost the tap (the showroom forms suite
       caught it). The page going away flushes it. */
    window.addEventListener("pagehide", function () { if (dirty) saveNow(); });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", function () { if (document.hidden && dirty) saveNow(); });
    }
    /* Say the standing truth once the page has settled. Rendering
       immediately would flash "this device only" on a build whose transport
       registers a second later, which is exactly the kind of small lie the
       banner exists to avoid. */
    setTimeout(function () { renderSyncBanner(); }, 1500);
  }

  /* ---------- Steel Cod import ------------------------------------------ */
  var HEADERMAP = [
    ["area", /^(area|zone|floor|level|building|house|bldg)$/],
    ["location", /^(location|opening|room|suite|position|place|space|unit)$/],
    ["brand", /^(brand|mfr|mfg|manufacturer|make|vendor)$/],
    ["model", /^(model|model ?#|model ?no\.?|sku|part|part ?#)$/],
    ["appliance", /^(appliance|type|product|description|desc|item|category)$/],
    ["installType", /^(install|installation|install ?type|mount|detail)$/],
    ["basis", /^(basis|variation|install ?variation|spec ?basis|installation ?basis)$/],
    ["w", /^(w|width|spec ?w|opening ?w|rough ?w)$/],
    ["d", /^(d|depth|spec ?d|opening ?d|rough ?d)$/],
    ["h", /^(h|height|spec ?h|opening ?h|rough ?h)$/],
    ["dims", /^(?:spec ?|opening ?|rough ?|required ?)?(?:dims?|dimensions?|size|w ?x ?d ?x ?h|w ?x ?h ?x ?d|spec)$/],
    ["specRef", /^(ref|reference|page|pg|spec ?page|spec ?ref|cut ?sheet)$/],
    ["notes", /^(note|notes|comment|comments|remark|remarks)$/]
  ];
  function splitRow(line, delim) {
    if (delim !== ",") return line.split(delim).map(function (s) { return s.trim(); });
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  function parseDims(str) {
    var out = { w: null, d: null, h: null, rule: {} };
    if (!str) return out;
    var s = String(str);
    var re = /([\d]+(?:\s+\d+\s*\/\s*\d+)?(?:\s*[-–]\s*\d+\s*\/\s*\d+)?(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:[”"″])?\s*(?:(min|minimum|max|maximum|true|exact)\s*)?\b([WDH])\b/gi;
    var m, found = false;
    while ((m = re.exec(s))) {
      var k = m[3].toLowerCase(), v = parseIn(m[1]);
      if (v != null) { out[k] = v; found = true; }
      if (m[2]) out.rule[k] = /max/i.test(m[2]) ? "max" : /min/i.test(m[2]) ? "min" : "exact";
    }
    if (found) return out;
    var parts = s.split(/\s*[x×]\s*/i).map(parseIn).filter(function (v) { return v != null; });
    if (parts.length >= 3) { out.w = parts[0]; out.d = parts[1]; out.h = parts[2]; }
    else if (parts.length === 1) out.w = parts[0];
    if (/\bmin/i.test(s)) out.rule.w = out.rule.w || "min";
    return out;
  }
  function importRows(text) {
    var lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    if (!lines.length) return { items: [], msg: "Nothing to read." };
    var delim = lines[0].indexOf("\t") >= 0 ? "\t" : lines[0].indexOf("|") >= 0 ? "|" : lines[0].indexOf(",") >= 0 ? "," : "|";
    var rows = lines.map(function (l) { return splitRow(l, delim); });
    var head = rows[0].map(function (c) { return c.toLowerCase().replace(/[”"″*:]/g, "").replace(/\s+/g, " ").trim(); });
    var cand = {}, hits = 0;
    head.forEach(function (c, i) {
      for (var n = 0; n < HEADERMAP.length; n++) if (HEADERMAP[n][1].test(c)) { cand[HEADERMAP[n][0]] = i; hits++; return; }
    });
    var map, start;
    if (hits >= 2) { map = cand; start = 1; }
    else { map = { area: 0, location: 1, brand: 2, model: 3, appliance: 4, installType: 5, dims: 6, specRef: 7 }; start = 0; }

    var items = [], skipped = 0, bound = 0;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r];
      if (!row.join("").trim()) continue;
      var get = function (k) { return map[k] != null && row[map[k]] != null ? String(row[map[k]]).trim() : ""; };
      var it = blankItem();
      it.area = get("area"); it.location = get("location"); it.brand = get("brand");
      it.model = get("model"); it.appliance = get("appliance"); it.installType = get("installType");
      it.specRef = get("specRef"); it.notes = get("notes");
      var dm = map.dims != null ? parseDims(get("dims")) : { w: null, d: null, h: null, rule: {} };
      DIMS.forEach(function (d) {
        var k = d.k;
        var direct = map[k] != null ? parseDims(get(k) + " " + k.toUpperCase()) : null;
        var v = direct && direct[k] != null ? direct[k] : dm[k];
        if (v != null) it.spec[k] = fmtFrac(v);
        var rl = (direct && direct.rule[k]) || dm.rule[k];
        if (rl) it.rule[k] = rl;
      });
      if (!it.appliance && !it.model && !it.location) { skipped++; continue; }
      var entry = findModel(it.model);
      if (entry) {
        if (!it.brand) it.brand = entry.brand;
        if (!it.appliance) it.appliance = entry.appliance;
        it.category = entry.category || "";
        var want = get("basis") || it.installType;
        var picked = null;
        if (want) {
          var wq = String(want).toLowerCase().replace(/[^a-z0-9]/g, "");
          picked = entry.variations.filter(function (v) {
            var lq = v.label.toLowerCase().replace(/[^a-z0-9]/g, "");
            return v.key === want || lq === wq || (wq && (lq.indexOf(wq) === 0 || wq.indexOf(lq) === 0));
          })[0] || null;
        }
        if (!picked && entry.variations.length === 1) picked = entry.variations[0];
        if (picked) applyBasis(it, picked.key); else bound++;
      }
      if (!it.appliance) it.appliance = it.model || it.location;
      items.push(it);
    }
    return {
      items: items,
      msg: items.length + " opening" + (items.length === 1 ? "" : "s") + " read" +
        (skipped ? ", " + skipped + " line" + (skipped === 1 ? "" : "s") + " skipped" : "") + "." +
        (bound ? " " + bound + " need an installation basis picked." : "")
    };
  }

  /* ---------- spec package contents + coverage --------------------------- */
  var MODELTOK = /\b[A-Z][A-Z0-9]{1,}[A-Z0-9][A-Z0-9\/\-\*\.]*\b/g;
  var NOTMODEL = /^(THE|AND|FOR|WITH|CU|FT|LG|WOLF|COVE|TRUE|SUB|ZERO|PAGE|NO|SPEC|FULL|PACKAGE|CONTENTS|WASHER|DRYER|OVEN|MICROWAVE|DISHWASHER|REFRIGERATOR|FREEZER|PANEL|READY|SERIES|SMART|LOAD|FRONT|STAR|ENERGY|AI|DD|SIDE|BY|CLASSIC|DESIGNER|UNDERCOUNTER|CUSTOM|OVERLAY|INCH|WASH|TOWER|CENTER|CONTROL|TURBOWASH|NEOCHEF|TURBOSTEAM|MEGA|CAPACITY|SENSOR|DRY|TECHNOLOGY|WHITE|STAINLESS|STEEL|INTERNAL|DISPENSER|ICE|MAKER|TRANSITIONAL|SPEED|BUILT|IN|INTELLIGENCE|E)$/;

  function parseContents(text) {
    var out = [], seen = {};
    text.replace(/\r/g, "").split("\n").forEach(function (line) {
      var pages = (line.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/) || line.match(/\b(\d{1,3})\s*$/) || [])[0] || "";
      var toks = line.toUpperCase().match(MODELTOK) || [];
      toks.forEach(function (tk) {
        if (NOTMODEL.test(tk)) return;
        if (!/\d/.test(tk)) return;
        if (!findModel(tk) && tk.replace(/[^0-9]/g, "").length < 3) return;
        var m = new RegExp("(" + tk.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&") + ")", "i").exec(line);
        var raw = m ? m[1] : tk;
        var k = normModel(raw);
        if (seen[k]) return;
        seen[k] = 1;
        out.push({ model: raw, pages: pages ? "pp." + pages.replace(/\s/g, "") : "" });
      });
    });
    return out;
  }
  function modelParts(m) {
    return String(m || "").split(/\s*(?:\+|&|,|\/\/| and )\s*/i).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function coverage(w) {
    var pkg = (w.packageModels || []).map(function (p) { return { model: p.model, pages: p.pages, entry: findModel(p.model) }; });
    var covers = function (it, p) {
      return modelParts(it.model).some(function (part) {
        if (normModel(part) === normModel(p.model)) return true;
        return !!(p.entry && findModel(part) === p.entry);
      });
    };
    var rows = pkg.map(function (p) { return { pkg: p, count: w.items.filter(function (it) { return covers(it, p); }).length }; });
    var extra = w.items.filter(function (it) { return it.model && !pkg.some(function (p) { return covers(it, p); }); });
    return { rows: rows, extra: extra, missing: rows.filter(function (r) { return !r.count; }) };
  }
  function itemsFromContents(w) {
    return (w.packageModels || []).map(function (p) {
      var it = blankItem();
      it.model = p.model; it.specRef = p.pages;
      var e = findModel(p.model);
      if (e) {
        it.brand = e.brand; it.appliance = e.appliance; it.category = e.category || "";
        if (e.variations.length === 1) applyBasis(it, e.variations[0].key);
      }
      if (!it.appliance) it.appliance = p.model;
      return it;
    });
  }

  /* ---------- photos ---------------------------------------------------
     Full frame into IndexedDB (or the portal's WILSON_PHOTOS so its sync to
     the shop machine keeps working); a small thumb into walk state so the
     office and the packet always have something to show even on a device
     that never held the original. */
  var DB_NAME = "wilson-site-walk-photos", DB_VERSION = 1, STORE = "photos";
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error("no indexeddb")); return; }
      var req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var st = d.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("byWalk", "walkId", { unique: false });
        }
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    return dbp;
  }
  function drawTo(src, maxEdge, quality, asBlob) {
    var w = src.width, h = src.height;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), chh = Math.max(1, Math.round(h * scale));
    var c = document.createElement("canvas");
    c.width = cw; c.height = chh;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, chh);
    ctx.drawImage(src, 0, 0, cw, chh);
    if (!asBlob) return { dataUrl: c.toDataURL("image/jpeg", quality), width: cw, height: chh };
    return new Promise(function (res) {
      c.toBlob(function (b) { res({ blob: b, width: cw, height: chh }); }, "image/jpeg", quality);
    });
  }
  function decode(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = fr.result; };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }
  /* 1600px long edge at q0.82 for the archive — the number that keeps a
     serial plate readable when someone zooms in. 340px thumb for state. */
  function putPhoto(file, meta) {
    return decode(file).then(function (src) {
      var thumb = drawTo(src, 340, 0.55, false);
      return Promise.resolve(drawTo(src, 1600, 0.82, true)).then(function (full) {
        if (src.close) src.close();
        var id = "swph_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
        var rec = {
          id: id, walkId: meta.walkId || "", itemId: meta.itemId || "", checkName: meta.checkName || "",
          caption: "", capturedAt: isoNow(), technician: meta.technician || "",
          width: full.width, height: full.height, bytes: full.blob ? full.blob.size : 0, blob: full.blob
        };
        var archive = (window.WILSON_PHOTOS && window.WILSON_PHOTOS.put)
          ? window.WILSON_PHOTOS.put(file, {
              visitId: meta.walkId, assetId: meta.itemId, householdId: "",
              checkId: meta.itemId, checkName: meta.checkName, kind: "condition", technician: meta.technician
            }).then(function (stored) { return stored && stored.id; }).catch(function () { return null; })
          : Promise.resolve(null);
        return archive.then(function (portalId) {
          return db().then(function (d) {
            return new Promise(function (res) {
              var tx = d.transaction(STORE, "readwrite");
              tx.objectStore(STORE).put(rec);
              tx.oncomplete = function () { res(); };
              tx.onerror = function () { res(); };
            });
          }).catch(function () { }).then(function () {
            return { id: id, portalId: portalId, thumb: thumb.dataUrl, width: full.width, height: full.height };
          });
        });
      });
    });
  }
  /* Ask the photo sync to move what was just stored.

     photo-sync deliberately has no timer — it drains on page load and when
     the tab comes forward, which is the moment a technician walks back into
     signal. That covers photographs taken while the page is open. It does
     not cover a batch of spec pages rendered minutes after load by the
     import wizard: those sat in IndexedDB until the next navigation, and if
     the reachability monitor happened to be answering "no" at that moment
     they sat there longer. Storing something new is an event, not a timer,
     so it is a fair thing to drain on. */
  function drainPhotos() {
    var sync = window.WILSON_PHOTO_SYNC;
    if (!sync || !sync.drain) return Promise.resolve(null);
    return Promise.resolve()
      .then(function () { return sync.drain({ force: true }); })
      .catch(function () { return null; });
  }

  /* A frame that was never a camera file — a spec page rendered off the
     package PDF, or any canvas the caller sized itself. Same store, same
     archive path, so photoUrl() serves it back like any photograph. */
  function dataUrlBlob(dataUrl) {
    var m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return null;
    var bin = atob(m[2]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }
  function putFrame(opts) {
    var blob = dataUrlBlob(opts.full);
    if (!blob) return Promise.reject(new Error("bad frame"));
    var id = "swph_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    var meta = opts.meta || {};
    var rec = {
      id: id, walkId: meta.walkId || "", itemId: meta.itemId || "", checkName: meta.checkName || "",
      caption: "", capturedAt: isoNow(), technician: meta.technician || "",
      width: opts.width || 0, height: opts.height || 0, bytes: blob.size, blob: blob
    };
    var archive = (window.WILSON_PHOTOS && window.WILSON_PHOTOS.put)
      ? window.WILSON_PHOTOS.put(blob, {
          visitId: meta.walkId, assetId: meta.itemId, householdId: "",
          checkId: meta.itemId, checkName: meta.checkName, kind: meta.kind || "condition", technician: meta.technician
        }).then(function (stored) { return stored && stored.id; }).catch(function () { return null; })
      : Promise.resolve(null);
    return archive.then(function (portalId) {
      return db().then(function (d) {
        return new Promise(function (res) {
          var tx = d.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(rec);
          tx.oncomplete = function () { res(); };
          tx.onerror = function () { res(); };
        });
      }).catch(function () { }).then(function () {
        return { id: id, portalId: portalId, thumb: opts.thumb || "" };
      });
    });
  }
  /* ---------- getting a photograph onto a device that never took it ------
     IndexedDB holds the full frame on the device that captured it, and
     nowhere else. That was fine while photographs only ever travelled from
     the phone to the office as evidence — the office could live with a
     thumbnail. It is not fine now, because the spec page the tech taps
     "Spec sheet" to read is rendered at the office and has to arrive on the
     phone legible; a 340 px thumbnail of a Sub-Zero drawing is unreadable.

     So: local store first, then the portal's photo store over HTTP, and
     anything fetched is written into the local store so the second look
     works with no signal. Where there is no portal — the shared-link build
     — the caller still falls back to the thumbnail it already has. */
  var PHOTO_HTTP = (window.WILSON_SW_API || {}).photoBase || "/photo-store/";
  /* Is there a shop server behind this page at all?
     ------------------------------------------------------------------
     The protocol used to answer this: file:// meant the single-file
     shared-link build, http(s):// meant the portal. That stopped being
     true the moment the single-file build was published as a hosted
     page — it is https, so it looked like a portal, and it would have
     asked a server that does not exist for its photo store, got a 404
     for every sheet, and told a technician that eleven install sheets
     were missing with a Download button that could never work.

     So the portal says so, in one line on each of its three site-walk
     pages. Anything that does not say so gets the behaviour that build
     actually has: the travel copy it already carries, and no promises. */
  function hasPortal() {
    if (!window.WILSON_SW_PORTAL) return false;
    return location.protocol === "http:" || location.protocol === "https:";
  }
  function photoRecord(id) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var req = d.transaction(STORE, "readonly").objectStore(STORE).get(id);
        req.onsuccess = function () { res(req.result || null); };
        req.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function cacheBlob(id, walkId, blob) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({
          id: id, walkId: walkId || "", itemId: "", checkName: "", caption: "",
          capturedAt: isoNow(), technician: "", width: 0, height: 0,
          bytes: blob.size, blob: blob, fetched: true
        });
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { res(); };
      });
    }).catch(function () { });
  }
  /* Which folder on the shop server holds it. The portal files photographs
     under the walk they belong to, so the walk id is part of the address. */
  function photoHttpUrl(id, walkId, portalId) {
    var key = portalId || id;
    if (!key) return null;
    if (!hasPortal()) return null;
    return PHOTO_HTTP + encodeURIComponent(walkId || "unassigned") + "/" +
      encodeURIComponent(key) + ".jpg";
  }
  function photoUrl(id, opts) {
    if (!id) return Promise.resolve(null);
    var o = opts || {};
    return photoRecord(id).then(function (rec) {
      if (rec && rec.blob) return window.URL.createObjectURL(rec.blob);
      var href = photoHttpUrl(id, o.walkId, o.portalId);
      if (!href) return null;
      return fetch(href, { credentials: "same-origin" }).then(function (r) {
        if (!r.ok) return null;
        return r.blob().then(function (blob) {
          if (!blob || !blob.size) return null;
          return cacheBlob(id, o.walkId, blob).then(function () {
            return window.URL.createObjectURL(blob);
          });
        });
      }).catch(function () { return null; });
    });
  }
  /* ---------- pulling the sheets down BEFORE the truck leaves -------------
     photoUrl() fetches a spec page the first time somebody taps "Spec
     sheet", and caches it so the second look needs no signal. That is one
     look too late. The tech opens the walk at the shop, drives to a house
     under construction with no wifi and one bar of LTE behind a foil-faced
     sheathing wall, and taps the sheet standing in front of the opening —
     the moment there is no network. What they would get is the travel
     thumbnail, which on a big job is 340 px and has no legible dimension
     on it. That is exactly the defect the HTTP path was added to fix,
     moved half a mile down the road.

     So when a walk lands on a phone, every install sheet is pulled down at
     once, while the phone is still somewhere with signal, and the screen
     says how far along it is. A sheet already in the local store is
     skipped, so this costs nothing on a second pickup.

     It is deliberately sequential. Eleven parallel fetches of a 200 KB
     JPEG on a shop wifi that is also running the server is how you get
     four timeouts and a tech who believes the sheets are aboard. */
  function specPageIds(w) {
    var out = [];
    (w && w.items ? w.items : []).forEach(function (it) {
      var sp = it && it.specPage;
      if (sp && sp.photoId) out.push({ id: sp.photoId, portalId: sp.portalId || "" });
      (it && it.specPages || []).forEach(function (x) {
        if (x && x.photoId) out.push({ id: x.photoId, portalId: x.portalId || "" });
      });
    });
    return out;
  }
  /* How many of this walk's sheets are already on this device, without
     touching the network. Drives the honest label on the screen. */
  function specPagesLocal(w) {
    /* No shop server means no sheets to pull and nothing worth saying
       about it: the walk carries its travel copies and that is the whole
       story on this build. */
    if (!hasPortal()) return Promise.resolve({ have: 0, total: 0 });
    var want = specPageIds(w);
    if (!want.length) return Promise.resolve({ have: 0, total: 0 });
    var have = 0;
    return want.reduce(function (p, ref) {
      return p.then(function () {
        return photoRecord(ref.id).then(function (rec) {
          if (rec && rec.blob) have++;
        });
      });
    }, Promise.resolve()).then(function () {
      return { have: have, total: want.length };
    });
  }
  var warming = {};   /* walkId -> true, so two renders do not both start it */
  function warmSpecPages(w, onProgress) {
    var wid = w && w.id;
    if (!wid) return Promise.resolve({ have: 0, total: 0, failed: 0, offline: false });
    if (warming[wid]) return Promise.resolve(null);
    if (!hasPortal()) return Promise.resolve({ have: 0, total: 0, failed: 0, offline: false });
    var want = specPageIds(w);
    if (!want.length) return Promise.resolve({ have: 0, total: 0, failed: 0, offline: false });
    warming[wid] = true;
    var have = 0, failed = 0, offline = false;
    function report() {
      if (onProgress) {
        try { onProgress({ have: have, total: want.length, failed: failed, offline: offline }); } catch (e) { }
      }
    }
    return want.reduce(function (p, ref) {
      return p.then(function () {
        return photoRecord(ref.id).then(function (rec) {
          if (rec && rec.blob) { have++; report(); return null; }
          if (offline) { failed++; report(); return null; }
          var href = photoHttpUrl(ref.id, wid, ref.portalId);
          if (!href) { failed++; report(); return null; }
          return fetch(href, { credentials: "same-origin" }).then(function (r) {
            if (!r.ok) { failed++; report(); return null; }
            return r.blob().then(function (blob) {
              if (!blob || !blob.size) { failed++; report(); return null; }
              return cacheBlob(ref.id, wid, blob).then(function () { have++; report(); });
            });
          }).catch(function () {
            /* A network error, not a missing file: the phone is off the
               server. Stop asking for the other ten. */
            offline = true; failed++; report();
          });
        });
      });
    }, Promise.resolve()).then(function () {
      delete warming[wid];
      return { have: have, total: want.length, failed: failed, offline: offline };
    }).catch(function () {
      delete warming[wid];
      return { have: have, total: want.length, failed: failed, offline: offline };
    });
  }
  function removePhoto(id) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
      });
    }).catch(function () { });
  }

  /* ---------- navigation -------------------------------------------------
     The portal serves three pages; the single-file preview serves three
     hash routes. Every link goes through here so neither build has to know
     about the other. */
  function nav(kind, a, b) {
    var o = window.WILSON_SW_NAV;
    if (o && o[kind]) return o[kind](a, b);
    if (kind === "field") return "#/field/" + a + (b ? "/op/" + b : "");
    if (kind === "office") return a ? "#/office/" + a : "#/office";
    if (kind === "packet") return "#/office/" + a + "/packet";
    return "#";
  }
  function goto(href) {
    if (href.charAt(0) === "#") location.hash = href;
    else location.href = href;
  }

  /* ---------- exports ---------------------------------------------------- */
  window.WILSON_SW = {
    STATUSES: STATUSES, SK: SK, DIMS: DIMS, RULES: RULES, MODELS: MODELS,
    POINTS: POINTS, NOT_READY_REASONS: NOT_READY_REASONS,
    DIM4: DIM4, dimsFor: dimsFor, dimNeeded: dimNeeded, measuresAnyway: measuresAnyway,
    utilityIsMarkable: utilityIsMarkable, utilityNeedsTarget: utilityNeedsTarget,
    deriveUtility: deriveUtility, syncUtilities: syncUtilities,
    utilityGroup: utilityGroup, utilitiesIn: utilitiesIn,
    offPlaneIn: offPlaneIn, servicePhotoOf: servicePhotoOf,
    setServicePhoto: setServicePhoto, servicePin: servicePin,
    putFrame: putFrame,
    POINT_LABELS: POINT_LABELS, pointLabel: pointLabel, pointsFor: pointsFor,
    ACCEPT_REASONS: ACCEPT_REASONS, acceptedReason: acceptedReason, isAccepted: isAccepted,
    rawVerdict: rawVerdict,
    OBSTRUCTION_KINDS: OBSTRUCTION_KINDS, OBSTRUCTION_STATES: OBSTRUCTION_STATES,
    obstructionOf: obstructionOf, obstructionAnswered: obstructionAnswered,
    obstructionFixes: obstructionFixes, obstructionNote: obstructionNote,
    UTILITY_ANSWERS: UTILITY_ANSWERS, PANEL_BY: PANEL_BY, PANEL_STATE: PANEL_STATE,
    utilitiesFor: utilitiesFor, utilityAnswered: utilityAnswered, utilityFixes: utilityFixes,
    CORNER_TAPS: CORNER_TAPS, blankOverlay: blankOverlay, overlayReady: overlayReady, canMark: canMark,
    targetAt: targetAt,
    planeSize: planeSize, zoneOf: zoneOf, hasZone: hasZone, toPhoto: toPhoto, toPlane: toPlane,
    applyH: applyH, markAt: markAt, marksMade: marksMade, markOffset: markOffset, pinOf: pinOf, setPin: setPin, clearPin: clearPin, dimNotes: dimNotes,
    offsetText: offsetText, markText: markText, markVerdict: markVerdict, markConflicts: markConflicts,
    isPanelReady: isPanelReady, panelSpec: panelSpec, panelText: panelText,
    panelSpecMissing: panelSpecMissing,
    panelAnswered: panelAnswered, panelFindings: panelFindings,
    governing: governing, governingPoint: governingPoint, syncPoints: syncPoints,
    pointValues: pointValues, pointsAnswered: pointsAnswered,
    parseIn: parseIn, fmtIn: fmtIn, fmtFrac: fmtFrac, fmtDelta: fmtDelta, num: num, specText: specText,
    dimKey: dimKey, rememberedDims: rememberedDims, rememberDims: rememberDims,
    syncLibrary: syncLibrary, libraryState: libraryState, libApply: libApply,
    forgetDims: forgetDims, dimMemory: dimMemory,
    findModel: findModel, variationOf: variationOf, modelSuffix: modelSuffix, variationBar: variationBar,
    entryPanelReady: entryPanelReady, headingFits: headingFits, sheetBasisMismatch: sheetBasisMismatch, refrigHeight: refrigHeight, itemEntry: itemEntry, itemVariation: itemVariation,
    hasOpening: hasOpening, openingText: openingText, libModels: libModels,
    isBuiltIn: isBuiltIn, isEdited: isEdited, saveModel: saveModel, removeModel: removeModel,
    blankModelEntry: blankModelEntry, blankVariation: blankVariation, openingQueue: openingQueue,
    normModel: normModel,
    basisPending: basisPending, applyBasis: applyBasis, discriminators: discriminators,
    fitVariations: fitVariations, basisMismatch: basisMismatch,
    verdict: verdict, autoStatus: autoStatus, autoFixes: autoFixes, autoFixObjects: autoFixObjects, statusOf: statusOf,
    isDone: isDone, isStarted: isStarted, fieldState: fieldState, itemFlags: itemFlags, needsAction: needsAction,
    dimsAnswered: dimsAnswered, needsDims: needsDims,
    chipsFor: chipsFor, suggestConclusion: suggestConclusion, specSummary: specSummary, fieldSummary: fieldSummary,
    itemTitle: itemTitle, itemWhere: itemWhere, rowTitle: rowTitle, findingsFor: findingsFor, punchLine: punchLine, actionsFor: actionsFor,
    actionTexts: actionTexts, corrections: corrections, punchItems: punchItems, wilsonItems: wilsonItems,
    salesItems: salesItems, questionItems: questionItems, whoOf: whoOf,
    OWNERS: OWNERS, ownerOf: ownerOf, SEVERITIES: SEVERITIES, KINDS: KINDS,
    CHIPS: CHIPS, CHIP_BY: CHIP_BY, chipHasSlot: chipHasSlot, chipText: chipText,
    normAction: normAction, addAction: addAction, removeAction: removeAction, toggleAction: toggleAction, hasAction: hasAction,
    fixMeta: fixMeta, setFixMeta: setFixMeta, revealOf: revealOf,
    PANEL_LABELS: PANEL_LABELS, PANEL_PLANES: PANEL_PLANES, addPanel: addPanel, removePanel: removePanel,
    panelVerdicts: panelVerdicts, panelMeasuredFindings: panelMeasuredFindings, panelsMeasured: panelsMeasured,
    MARK_COLORS: MARK_COLORS, MARK_TOOLS: MARK_TOOLS, blankMarkup: blankMarkup, markupOf: markupOf, markupCount: markupCount,
    hasMarkup: hasMarkup, markupUndo: markupUndo, markupSvg: markupSvg, markColor: markColor, photoById: photoById,
    FORMS: FORMS, FORM_KEYS: FORM_KEYS, CHECK_ANSWERS: CHECK_ANSWERS, formKeyFor: formKeyFor, formOf: formOf, setForm: setForm,
    formVal: formVal, setFormVal: setFormVal, formCheck: formCheck, setFormCheck: setFormCheck, formFieldMin: formFieldMin,
    formFieldVerdict: formFieldVerdict, formFindings: formFindings, formAnswered: formAnswered, formText: formText,
    panelThickness: panelThickness, posText: posText, setStatus: setStatus,
    utilPlane: utilPlane, planeDims: planeDims, frontReady: frontReady, floorOverlay: floorOverlay, depthIn: depthIn, planeOverlay: planeOverlay, planeReady: planeReady, toPhotoFor: toPhotoFor, toPlaneFor: toPlaneFor, utilByKey: utilByKey, PLANE_WORDS: PLANE_WORDS,
    PREP_KINDS: PREP_KINDS, PREP_STATES: PREP_STATES, prepKind: prepKind, prepText: prepText,
    panelRuleOf: panelRuleOf, panelBasis: panelBasis, panelBasisText: panelBasisText, panelBasisFindings: panelBasisFindings, panelShift: panelShift, stripTarget: stripTarget, panelRangeText: panelRangeText,
    STRIP_FACES: STRIP_FACES, stripFace: stripFace, stripOf: stripOf, isStrip: isStrip, prepFinished: prepFinished, prepOwner: prepOwner, stripGeoms: stripGeoms, stripInterior: stripInterior, stripWords: stripWords, STRIP_MEAS: STRIP_MEAS, stripMeasFor: stripMeasFor, prepMeas: prepMeas, setPrepMeas: setPrepMeas, prepFoundFinished: prepFoundFinished, setPrepFoundFinished: setPrepFoundFinished, stripFindings: stripFindings, prepState: prepState, prepPlane: prepPlane, prepZoneOf: prepZoneOf, prepOnPlane: prepOnPlane, prepAnswered: prepAnswered, prepFindings: prepFindings, specDoubtOf: specDoubtOf, setSpecDoubt: setSpecDoubt, heldItems: heldItems, acceptedUtilReason: acceptedUtilReason, INSTALLER_ACCEPT: INSTALLER_ACCEPT,
    roughInModel: roughInModel, roughInSvg: roughInSvg, planeWord: planeWord, isDishwasherish: isDishwasherish, hoodModel: hoodModel, hoodSvg: hoodSvg, hoodSpec: hoodSpec, hoodPoint: hoodPoint, shroudPlanSvg: shroudPlanSvg, cookingUnder: cookingUnder, HOOD_UNDER: HOOD_UNDER, roughInMarkText: roughInMarkText, boxModel: boxModel, boxSvg: boxSvg, boxHit: boxHit, boxPoint: boxPoint, boxViewFor: boxViewFor, stdBox: stdBox, BOX_VIEW: BOX_VIEW, FACE_PLANES: FACE_PLANES, PLANE_DEFAULT: PLANE_DEFAULT, ZONE_COLORS: ZONE_COLORS,
    KIT_STATES: KIT_STATES, isMerge: isMerge, isRefrigeration: isRefrigeration, mergeCandidates: mergeCandidates, suggestMerges: suggestMerges, dismissMergeSuggestion: dismissMergeSuggestion, mergeUnits: mergeUnits, unitPos: unitPos, canMerge: canMerge, mergeItems: mergeItems,
    unmergeItem: unmergeItem, moveUnit: moveUnit, setMergeWidth: setMergeWidth, mergeWidthText: mergeWidthText, mergeRequired: mergeRequired,
    kitState: kitState, kitLabel: kitLabel, mergeFindings: mergeFindings, refrigKind: refrigKind, MERGE_TABLES: MERGE_TABLES, mergeTableFor: mergeTableFor, HINGE_SIDES: HINGE_SIDES, setUnitHinge: setUnitHinge, hingeConfig: hingeConfig, mergeKitHint: mergeKitHint, mergeNotes: mergeNotes, EXTENSION_GAP_IN: EXTENSION_GAP_IN, EXTENSION_KINDS: EXTENSION_KINDS, runGapOf: runGapOf, setRunGap: setRunGap, extensionsOf: extensionsOf, toggleExtension: toggleExtension, extensionWords: extensionWords, runGapAnswered: runGapAnswered, needsExtensions: needsExtensions, runFindings: runFindings, utilBase: utilBase, utilLabel: utilLabel,
    UTIL_TYPES: UTIL_TYPES, utilTypesFor: utilTypesFor, requiredUtilType: requiredUtilType, utilTypeLabel: utilTypeLabel,
    utilTypeOf: utilTypeOf, setUtilType: setUtilType, utilTypeFix: utilTypeFix, utilTypeGroup: utilTypeGroup,
    kindOf: kindOf, utilTypesShort: utilTypesShort, usualUtilType: usualUtilType, requiredIsUsual: requiredIsUsual, requiredFromSheet: requiredFromSheet, UTIL_FLAGS: UTIL_FLAGS, utilFlagsFor: utilFlagsFor, utilFlag: utilFlag, setUtilFlag: setUtilFlag, utilFlagText: utilFlagText, utilFlagFixes: utilFlagFixes, plugSvg: plugSvg,
    FLUSH_FIELDS: FLUSH_FIELDS, flushOf: flushOf, flushOn: flushOn, flushLikely: flushLikely, flushText: flushText, syncFlush: syncFlush,
    SWING_SIDES: SWING_SIDES, swingOf: swingOf, swingOn: swingOn, swingMin: swingMin, swingFinding: swingFinding,
    flooringOf: flooringOf, flooringDeduction: flooringDeduction, finishedHeight: finishedHeight, floorStanding: floorStanding, planeAllowed: planeAllowed, walkOfItem: walkOfItem,
    ACCESS_ROUTES: ACCESS_ROUTES, ACCESS_STATES: ACCESS_STATES,
    accessOf: accessOf, accessAnswered: accessAnswered, accessMissing: accessMissing,
    accessRouteLabel: accessRouteLabel, accessStateLabel: accessStateLabel,
    accessFindings: accessFindings, accessSummary: accessSummary,
    JOB_PREREQS: JOB_PREREQS, prereqAnswer: prereqAnswer, setPrereq: setPrereq, prereqsAnswered: prereqsAnswered, prereqsOpen: prereqsOpen,
    jobFindings: jobFindings, jobReadinessBits: jobReadinessBits,
    tally: tally, rollup: rollup, stage: stage,
    syncPayload: syncPayload, openingPayload: openingPayload,
    hasDemo: hasDemo, loadDemo: loadDemo,
    load: load, save: save, saveNow: saveNow, scheduleSave: scheduleSave, isDirty: isDirty, onChange: onChange,
    walks: walks, walk: walk, item: item, addWalk: addWalk, touch: touch,
    blankWalk: blankWalk, blankItem: blankItem, normItem: normItem, normWalk: normWalk,
    importRows: importRows, parseDims: parseDims, parseContents: parseContents, coverage: coverage,
    itemsFromContents: itemsFromContents, modelParts: modelParts,
    putPhoto: putPhoto, photoUrl: photoUrl, removePhoto: removePhoto,
    warmSpecPages: warmSpecPages, specPagesLocal: specPagesLocal, hasPortal: hasPortal,
    storageState: storageState, renderStorageBanner: renderStorageBanner,
    drainPhotos: drainPhotos,
    pullWalks: pullWalks, offerState: offerState, acceptWalk: acceptWalk,
    hasUnsent: hasUnsent, unsentWalks: unsentWalks,
    nav: nav, goto: goto, state: function () { return load(); },
    apiUrl: apiUrl, ensureWalk: ensureWalk, adoptNewer: adoptNewer, liveMs: liveMs,
    whoAmI: whoAmI, sessionUser: sessionUser, signOff: signOff, markSent: markSent, hasGate: hasGate,
    archiveWalk: archiveWalk, takeOffer: takeOffer, setServerRows: setServerRows, serverRows: serverRows, tidyHeld: tidyHeld,
    setTransport: setTransport, trySync: trySync, syncState: syncState, onSync: onSync,
    markDirty: markDirty, renderSyncBanner: renderSyncBanner, syncClean: function () { syncMeta.since = 0; notifySync(); },
    uid: uid, today: today, isoNow: isoNow
  };
})();
