/* =============================================================
   Wilson Site Walk — field tool
   Phone first. Taps, not typing: a fully on-spec opening is three
   taps for all three dimensions, and the status sets itself.
   ============================================================= */
(function () {
  "use strict";
  var SW = window.WILSON_SW;
  var ui = window.WilsonUI;
  var esc = function (v) { return ui.escapeHtml(v); };

  var HOST = null;
  var walkId = null, itemId = null;
  var openDim = null;          /* which dimension pad is open */
  var mergeMode = false, mergeSel = [];   /* home: picking units to merge into one opening */
  /* the photo markup editor: which photo, which tool, what is mid-stroke */
  var mu = { open: false, photoId: "", tool: "pen", color: "red", url: "", draft: null, textAt: null };
  var openPoint = null;        /* which measurement point, on an irregular opening */
  var showMoreChips = false;
  var moreOpen = {};           /* itemId → the measure step's "More on this opening…" open (v0.9.59) */
  var ownWordsOpen = false;    /* the free-text correction inputs shown */
  var formPickOpen = false;    /* the "Measuring as" chips shown */
  var stepKey = null;          /* the step the tech is on, null = first unanswered */
  var accessView = false;      /* the jobsite access screen */
  var savedFlash = false, flashTimer = null;
  var specOpen = false;        /* the install sheet, full screen */
  var specFull = { id: "", url: "" };
  var specExtra = {};            /* photoId -> url, the rest of the book, fetched when the sheet opens */

  /* A tick you can feel. Every answer that lands gets one, so the tech
     knows the tap registered without looking for a spinner. */
  function tick(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { }
  }

  /* The fractions, in order, as a 2 x 8 block beside the digits.

     There used to be a row of deltas here — −1/4, +1/2 and so on, offsets
     from the spec. They read fast on paper and badly in the field, because a
     tech reading a tape thinks "thirty-six and a quarter", not "spec minus a
     quarter". Type the number, tap the fraction. */
  var FRACTIONS = [
    ["1/16", 1 / 16], ["1/8", 1 / 8], ["3/16", 3 / 16], ["1/4", 1 / 4], ["5/16", 5 / 16],
    ["3/8", 3 / 8], ["7/16", 7 / 16], ["1/2", 1 / 2], ["9/16", 9 / 16], ["5/8", 5 / 8],
    ["11/16", 11 / 16], ["3/4", 3 / 4], ["13/16", 13 / 16], ["7/8", 7 / 8], ["15/16", 15 / 16]
  ];

  function walk() { return SW.walk(walkId); }
  function item() { return SW.item(walk(), itemId); }

  function autosave() {
    /* v0.9.83: with a login behind the page, whoever first records something
       at the house is the walker — and the walker is who signs it off */
    var aw = walk(), au = SW.hasGate() ? SW.sessionUser() : null;
    if (aw && !aw.walkedBy && au && au.displayName) aw.walkedBy = au.displayName;
    SW.touch(walk());
    SW.scheduleSave(function () {
      savedFlash = true;
      var chip = document.getElementById("sw-autosave");
      if (chip) { chip.className = "tech-autosave saved"; chip.textContent = "✓ Saved"; }
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        savedFlash = false;
        var c = document.getElementById("sw-autosave");
        if (c) { c.className = "tech-autosave"; c.textContent = "Saves as you go"; }
      }, 1600);
    });
  }

  /* ---------------- routing ---------------- */
  /* Where the tech was, kept so a page that comes back without its
     address lands on the same opening and step. On an iPhone the camera
     can cost the page its memory; the hosted single-file build reloads
     inside a frame whose address carries no hash, so every photo dropped
     the tech on the landing page (Cayden, 21 Oct). */
  var RESUME_KEY = "wilson.sitewalk.field.resume";
  function rememberPlace() {
    try {
      if (walkId) window.localStorage.setItem(RESUME_KEY, JSON.stringify({ walkId: walkId, itemId: itemId || "", step: stepKey || "", access: !!accessView, at: Date.now() }));
    } catch (e) { }
  }
  function resumePlace() {
    try {
      var r = JSON.parse(window.localStorage.getItem(RESUME_KEY) || "null");
      if (!r || !r.walkId || Date.now() - (r.at || 0) > 12 * 3600 * 1000) return null;
      if (!SW.walk(r.walkId)) return null;
      return r;
    } catch (e) { return null; }
  }
  var resumed = false;
  var pickView = false;        /* "#/pick": the list of walks, on purpose — no resume (22 Oct) */
  function route() {
    var h = (location.hash || "").replace(/^#\/?/, "").split("/");
    var q = new URLSearchParams(location.search);
    var wasPick = pickView;
    pickView = h[0] === "pick";
    if (pickView) {
      /* a deliberate trip to the list: the resume must not pull the phone
         back into the last walk (Cayden set the same walk up four times
         and never saw it — the phone could not get to the list) */
      resumed = true; walkId = null; itemId = null; accessView = false; stepKey = null;
      if (!wasPick) { offers = null; }          /* arriving: look again */
      return;
    }
    if (h[0] === "field") {
      walkId = h[1] || null;
      itemId = (h[2] === "op" ? h[3] : null) || null;
      accessView = h[2] === "access";
    } else {
      walkId = q.get("walk") || walkId;
      itemId = q.get("op") || null;
      accessView = q.get("view") === "access";
    }
    if (!resumed) {
      resumed = true;
      var r = resumePlace();
      if (r && !walkId) {
        walkId = r.walkId; itemId = r.itemId || null; accessView = !!r.access;
        if (r.step) stepKey = r.step;
        /* put the address back so the next reload needs no memory at all */
        try {
          var want = r.access ? accessHref() : SW.nav("field", walkId, itemId || undefined);
          if (want.charAt(0) === "#" && location.hash !== want) history.replaceState(null, "", want);
        } catch (e) { }
      } else if (r && r.walkId === walkId && (r.itemId || null) === (itemId || null) && r.step && !stepKey) {
        /* the shell already put the address back; pick up the step too */
        stepKey = r.step;
      }
    }
    rememberPlace();
  }
  function go(hash) { SW.goto(hash); }
  function opHref(id) { return SW.nav("field", walkId, id); }
  function homeHref() { return SW.nav("field", walkId); }
  /* The standalone pages link by query string, the single-file build by
     hash; "/access" tacked onto a query string made the walk id
     "walk_x/access" and dropped the tech on the landing page (Cayden,
     showroom walk, 13 Oct). */
  function accessHref() {
    var base = SW.nav("field", walkId);
    return base.charAt(0) === "#" ? base + "/access" : base + (base.indexOf("?") >= 0 ? "&" : "?") + "view=access";
  }

  /* ---------------- head ---------------- */
  function head() {
    var w = walk();
    if (!w) return "";
    var r = SW.rollup(w);
    var open = r.total - r.done;
    return '<section class="tech-visit-head">' +
      '<span class="eyebrow">Pre-delivery site walk</span>' +
      "<h1>" + esc(w.project || "Untitled project") + "</h1>" +
      "<p>" + esc([w.jobNo, w.builder, w.address].filter(Boolean).join("  ·  ") || "Job details not set") + "</p>" +
      '<div class="tech-progress-stats">' +
      "<span><strong>" + r.done + "</strong> walked</span>" +
      "<span><strong>" + open + "</strong> remaining</span>" +
      '<span class="' + (r.attention.length ? "has-attention" : "") + '"><strong>' + r.attention.length + "</strong> need builder action</span>" +
      (r.blockers.length ? '<span class="has-attention"><strong>' + r.blockers.length + "</strong> blocked</span>" : "") +
      "</div>" +
      '<div class="tech-progress" aria-label="' + r.pct + '% walked"><span style="width:' + r.pct + '%"></span></div>' +
      "</section>";
  }

  /* ---------------- home ---------------- */
  function nextItem(w) {
    var list = w.items;
    return list.filter(function (it) { var s = SW.fieldState(it); return !s.complete && s.started; })[0] ||
      list.filter(function (it) { return !SW.fieldState(it).complete; })[0] || null;
  }
  function nextStepCard(w) {
    var n = nextItem(w);
    if (!n) {
      return '<div class="tech-home-intro"><div><h2>Every opening is walked</h2>' +
        "<p>Save to the job, then the office compiles the builder packet.</p></div>" +
        '<button class="button" data-act="finish">Finish the walk</button></div>';
    }
    var st = SW.fieldState(n);
    var idx = w.items.indexOf(n) + 1;
    return '<button class="sw-next" data-act="open" data-id="' + n.id + '">' +
      '<span class="sw-next-body">' +
      '<span class="sw-next-kicker">Next · opening ' + idx + " of " + w.items.length + "</span>" +
      "<strong>" + esc(SW.itemTitle(n)) + "</strong>" +
      "<span>" + esc([SW.itemWhere(n), st.detail].filter(Boolean).join(" · ")) + "</span>" +
      "</span><span class=\"sw-next-go\">" + esc(st.action) + " →</span></button>";
  }
  function attentionPanel(w) {
    var list = w.items.filter(SW.needsAction);
    if (!list.length) return "";
    return '<div class="tech-attention-panel"><div>' +
      '<span class="tech-attention-icon">!</span>' +
      "<div><strong>" + list.length + " opening" + (list.length > 1 ? "s" : "") + " the builder has to act on</strong>" +
      "<p>These carry into the punch list on page one of the packet.</p></div></div>" +
      '<div class="tech-attention-list">' + list.map(function (it) {
        return '<button data-act="open" data-id="' + it.id + '">' +
          "<span>" + esc(SW.itemTitle(it)) + " · " + esc(SW.itemWhere(it)) + "</span>" +
          "<b>" + esc(SW.fieldState(it).label) + "</b></button>";
      }).join("") + "</div></div>";
  }
  function areaSection(area, list, w) {
    var done = list.filter(SW.isDone).length;
    var att = list.filter(SW.needsAction).length;
    return '<section class="tech-area">' +
      '<div class="tech-area-heading"><div><h2>' + esc(area) + "</h2>" +
      "<p>" + done + " of " + list.length + " walked" + (att ? " · " + att + " need action" : "") + "</p></div>" +
      '<span class="tech-area-progress">' + (Math.round((done / list.length) * 100) || 0) + "%</span></div>" +
      '<div class="tech-asset-list">' + list.map(function (it) { return assetCard(it, w); }).join("") + "</div></section>";
  }
  /* The maintenance tool's appliance icons, inlined so the phone's landing
     page works in every build, offline, with no files to fetch. */
  var ICON_SVG = {
  "coffee": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EBuilt-in coffee maker%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2243%22 y=%2222%22 width=%2294%22 height=%22121%22 rx=%225%22/%3E %3Crect x=%2253%22 y=%2232%22 width=%2274%22 height=%2223%22 rx=%222%22/%3E %3Ccircle cx=%22117%22 cy=%2243%22 r=%223%22 fill=%22%23155b26%22 stroke=%22none%22/%3E %3Cpath d=%22M67 67h46M76 67v13M104 67v13%22/%3E %3Cpath d=%22M77 82h27v21H77z%22/%3E %3Cpath d=%22M104 86h7c6 0 6 13 0 13h-7%22/%3E %3Cpath d=%22M70 113h40%22/%3E %3Cpath d=%22M82 119c0 8-8 8-8 16M98 119c0 8-8 8-8 16%22 stroke=%22%23155b26%22/%3E %3C/g%3E %3C/svg%3E",
  "cooktop": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3ECooktop or rangetop%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Cpath d=%22M23 65h134l-10 66H33z%22/%3E %3Cpath d=%22M29 65l10-25h102l10 25%22/%3E %3Cellipse cx=%2253%22 cy=%2254%22 rx=%2216%22 ry=%227%22/%3E %3Cellipse cx=%2290%22 cy=%2252%22 rx=%2217%22 ry=%227%22/%3E %3Cellipse cx=%22127%22 cy=%2254%22 rx=%2216%22 ry=%227%22/%3E %3Cellipse cx=%2265%22 cy=%2283%22 rx=%2217%22 ry=%227%22/%3E %3Cellipse cx=%22115%22 cy=%2283%22 rx=%2217%22 ry=%227%22/%3E %3Ccircle cx=%2254%22 cy=%22116%22 r=%225%22/%3E%3Ccircle cx=%2273%22 cy=%22116%22 r=%225%22/%3E%3Ccircle cx=%2292%22 cy=%22116%22 r=%225%22/%3E%3Ccircle cx=%22111%22 cy=%22116%22 r=%225%22/%3E%3Ccircle cx=%22130%22 cy=%22116%22 r=%225%22/%3E %3Cpath d=%22M43 132h94%22/%3E %3C/g%3E %3C/svg%3E",
  "dishwasher": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3ETop control dishwasher%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2250%22 y=%2221%22 width=%2280%22 height=%22123%22 rx=%224%22/%3E %3Cpath d=%22M51 42h78%22/%3E %3Cpath d=%22M62 48h56%22 stroke-width=%225%22/%3E %3Cpath d=%22M58 30h6M70 30h6M82 30h6%22 stroke=%22%23155b26%22/%3E %3Cpath d=%22M58 57h64%22 opacity=%22.35%22/%3E %3Cpath d=%22M58 136h64%22/%3E %3C/g%3E %3C/svg%3E",
  "dryer": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EFront load dryer%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2247%22 y=%2214%22 width=%2286%22 height=%22132%22 rx=%225%22/%3E %3Cpath d=%22M48 43h84%22/%3E %3Ccircle cx=%2290%22 cy=%2292%22 r=%2234%22/%3E %3Ccircle cx=%2290%22 cy=%2292%22 r=%2224%22/%3E %3Cg fill=%22%23155b26%22 stroke=%22none%22%3E%3Ccircle cx=%2278%22 cy=%2283%22 r=%222%22/%3E%3Ccircle cx=%2292%22 cy=%2288%22 r=%222%22/%3E%3Ccircle cx=%22105%22 cy=%2281%22 r=%222%22/%3E%3Ccircle cx=%2275%22 cy=%22101%22 r=%222%22/%3E%3Ccircle cx=%2297%22 cy=%22107%22 r=%222%22/%3E%3Ccircle cx=%22109%22 cy=%2299%22 r=%222%22/%3E%3C/g%3E %3Ccircle cx=%22117%22 cy=%2229%22 r=%226%22/%3E%3Cpath d=%22M57 29h25%22/%3E %3C/g%3E %3C/svg%3E",
  "ice_maker": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EIcemaker%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2250%22 y=%2225%22 width=%2280%22 height=%22119%22 rx=%224%22/%3E %3Crect x=%2257%22 y=%2232%22 width=%2266%22 height=%2218%22 rx=%222%22/%3E %3Ccircle cx=%22113%22 cy=%2241%22 r=%222%22 fill=%22%23155b26%22 stroke=%22none%22/%3E %3Crect x=%2258%22 y=%2262%22 width=%2264%22 height=%2265%22 rx=%223%22/%3E %3Cpath d=%22M66 71h48%22/%3E %3Cg stroke=%22%23155b26%22%3E%3Crect x=%2268%22 y=%2286%22 width=%2214%22 height=%2214%22 rx=%223%22/%3E%3Crect x=%2286%22 y=%2280%22 width=%2215%22 height=%2215%22 rx=%223%22/%3E%3Crect x=%22103%22 y=%2289%22 width=%2213%22 height=%2213%22 rx=%223%22/%3E%3Crect x=%2278%22 y=%22105%22 width=%2215%22 height=%2215%22 rx=%223%22/%3E%3Crect x=%2298%22 y=%22107%22 width=%2215%22 height=%2215%22 rx=%223%22/%3E%3C/g%3E %3Cline x1=%2261%22 y1=%22136%22 x2=%22119%22 y2=%22136%22/%3E %3C/g%3E %3C/svg%3E",
  "laundry_center": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3ELaundry center / WashTower%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2252%22 y=%2210%22 width=%2276%22 height=%22140%22 rx=%225%22/%3E %3Cpath d=%22M53 34h74%22/%3E %3Cpath d=%22M52 80h76%22/%3E %3Ccircle cx=%2290%22 cy=%2255%22 r=%2217%22/%3E %3Ccircle cx=%2290%22 cy=%22115%22 r=%2224%22/%3E %3Ccircle cx=%2290%22 cy=%22115%22 r=%2216%22/%3E %3Cpath d=%22M79 115c6-7 15-8 23-1-3 10-14 14-23 8%22 stroke=%22%23155b26%22/%3E %3Ccircle cx=%22115%22 cy=%2222%22 r=%225%22/%3E%3Cpath d=%22M62 22h20%22/%3E %3Cpath d=%22M62 92h14%22 stroke=%22%23155b26%22/%3E %3C/g%3E %3C/svg%3E",
  "microwave": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EBuilt-in microwave%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2224%22 y=%2242%22 width=%22132%22 height=%2280%22 rx=%224%22/%3E %3Crect x=%2234%22 y=%2252%22 width=%2288%22 height=%2260%22 rx=%223%22/%3E %3Cpath d=%22M43 61h70%22 opacity=%22.35%22/%3E %3Crect x=%22132%22 y=%2252%22 width=%2214%22 height=%2260%22 rx=%222%22/%3E %3Ccircle cx=%22139%22 cy=%2264%22 r=%223%22 fill=%22%23155b26%22 stroke=%22none%22/%3E %3Ccircle cx=%22136%22 cy=%2279%22 r=%221%22 fill=%22%23132318%22 stroke=%22none%22/%3E%3Ccircle cx=%22142%22 cy=%2279%22 r=%221%22 fill=%22%23132318%22 stroke=%22none%22/%3E %3Ccircle cx=%22136%22 cy=%2286%22 r=%221%22 fill=%22%23132318%22 stroke=%22none%22/%3E%3Ccircle cx=%22142%22 cy=%2286%22 r=%221%22 fill=%22%23132318%22 stroke=%22none%22/%3E %3Ccircle cx=%22136%22 cy=%2293%22 r=%221%22 fill=%22%23132318%22 stroke=%22none%22/%3E%3Ccircle cx=%22142%22 cy=%2293%22 r=%221%22 fill=%22%23132318%22 stroke=%22none%22/%3E %3C/g%3E %3C/svg%3E",
  "outdoor_grill": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EBuilt-in outdoor grill%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Cpath d=%22M28 74c0-22 28-34 62-34s62 12 62 34z%22/%3E %3Cpath d=%22M74 46h32%22/%3E %3Crect x=%2224%22 y=%2274%22 width=%22132%22 height=%2218%22 rx=%223%22/%3E %3Cpath d=%22M28 92h124v42H28z%22/%3E %3Cpath d=%22M28 148h124%22/%3E %3Cpath d=%22M28 134h124%22/%3E %3Ccircle cx=%2290%22 cy=%22104%22 r=%225%22/%3E %3Ccircle cx=%2256%22 cy=%22104%22 r=%225%22/%3E %3Ccircle cx=%22124%22 cy=%22104%22 r=%225%22/%3E %3Cpath d=%22M40 120h100%22 stroke=%22%23155b26%22/%3E %3Cpath d=%22M46 83h88%22 stroke=%22%23155b26%22/%3E %3C/g%3E %3C/svg%3E",
  "ovens": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EWall ovens%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2252%22 y=%2213%22 width=%2276%22 height=%22135%22 rx=%224%22/%3E %3Crect x=%2259%22 y=%2228%22 width=%2262%22 height=%2246%22 rx=%223%22/%3E %3Crect x=%2259%22 y=%2289%22 width=%2262%22 height=%2246%22 rx=%223%22/%3E %3Cpath d=%22M63 23h54M63 84h54%22/%3E %3Ccircle cx=%2266%22 cy=%2220%22 r=%222%22 fill=%22%23155b26%22 stroke=%22none%22/%3E%3Ccircle cx=%22114%22 cy=%2220%22 r=%222%22/%3E %3Cline x1=%2265%22 y1=%2280%22 x2=%22115%22 y2=%2280%22/%3E%3Cline x1=%2265%22 y1=%22141%22 x2=%22115%22 y2=%22141%22/%3E %3C/g%3E %3C/svg%3E",
  "range": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EProfessional range%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Cpath d=%22M27 38h126v106H27z%22/%3E %3Cpath d=%22M24 38h132l-7-20H31z%22/%3E %3Cellipse cx=%2248%22 cy=%2229%22 rx=%2214%22 ry=%226%22/%3E%3Cellipse cx=%2278%22 cy=%2228%22 rx=%2214%22 ry=%226%22/%3E%3Cellipse cx=%22108%22 cy=%2228%22 rx=%2214%22 ry=%226%22/%3E%3Cellipse cx=%22138%22 cy=%2229%22 rx=%2214%22 ry=%226%22/%3E %3Ccircle cx=%2243%22 cy=%2253%22 r=%224%22/%3E%3Ccircle cx=%2262%22 cy=%2253%22 r=%224%22/%3E%3Ccircle cx=%2281%22 cy=%2253%22 r=%224%22/%3E%3Ccircle cx=%22100%22 cy=%2253%22 r=%224%22/%3E%3Ccircle cx=%22119%22 cy=%2253%22 r=%224%22/%3E%3Ccircle cx=%22138%22 cy=%2253%22 r=%224%22/%3E %3Crect x=%2238%22 y=%2269%22 width=%2248%22 height=%2253%22 rx=%222%22/%3E%3Crect x=%2294%22 y=%2269%22 width=%2248%22 height=%2253%22 rx=%222%22/%3E %3Cline x1=%2239%22 y1=%2263%22 x2=%2285%22 y2=%2263%22/%3E%3Cline x1=%2295%22 y1=%2263%22 x2=%22141%22 y2=%2263%22/%3E %3Cline x1=%2238%22 y1=%22133%22 x2=%22142%22 y2=%22133%22/%3E %3C/g%3E %3C/svg%3E",
  "refrigeration": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3ERefrigeration%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2236%22 y=%2216%22 width=%2270%22 height=%22128%22 rx=%224%22/%3E %3Cline x1=%2271%22 y1=%2217%22 x2=%2271%22 y2=%2296%22/%3E %3Cline x1=%2237%22 y1=%2298%22 x2=%22105%22 y2=%2298%22/%3E %3Cline x1=%2263%22 y1=%2229%22 x2=%2263%22 y2=%2286%22/%3E %3Cline x1=%2279%22 y1=%2229%22 x2=%2279%22 y2=%2286%22/%3E %3Crect x=%22116%22 y=%2270%22 width=%2235%22 height=%2274%22 rx=%224%22/%3E %3Cline x1=%22117%22 y1=%2290%22 x2=%22150%22 y2=%2290%22/%3E %3Cpath d=%22M124 106h18M124 116h18M124 126h18%22/%3E %3Ccircle cx=%22139%22 cy=%2282%22 r=%222%22 fill=%22%23155b26%22 stroke=%22none%22/%3E %3C/g%3E %3C/svg%3E",
  "ventilation": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EVentilation hood%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2272%22 y=%2213%22 width=%2236%22 height=%2237%22 rx=%222%22/%3E %3Cpath d=%22M47 49h86l20 50H27z%22/%3E %3Cpath d=%22M34 99h112l7 17H27z%22/%3E %3Ccircle cx=%2257%22 cy=%22107%22 r=%223%22 fill=%22%23155b26%22 stroke=%22none%22/%3E%3Ccircle cx=%22123%22 cy=%22107%22 r=%223%22 fill=%22%23155b26%22 stroke=%22none%22/%3E %3Cpath d=%22M62 126c0 10 7 12 7 21M90 126c0 10 7 12 7 21M118 126c0 10 7 12 7 21%22 stroke=%22%23155b26%22/%3E %3C/g%3E %3C/svg%3E",
  "warming_drawer": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EWarming drawer%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2228%22 y=%2251%22 width=%22124%22 height=%2261%22 rx=%224%22/%3E %3Cpath d=%22M41 63h98%22 stroke-width=%225%22/%3E %3Cpath d=%22M39 75h102v26H39z%22/%3E %3Ccircle cx=%22139%22 cy=%2261%22 r=%222%22 fill=%22%23155b26%22 stroke=%22none%22/%3E %3Cpath d=%22M67 121h46%22/%3E %3C/g%3E %3C/svg%3E",
  "washer": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 180 160%22 role=%22img%22 aria-labelledby=%22title%22%3E %3Ctitle%3EFront load washer%3C/title%3E %3Cg fill=%22none%22 stroke=%22%23132318%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E %3Crect x=%2247%22 y=%2214%22 width=%2286%22 height=%22132%22 rx=%225%22/%3E %3Cpath d=%22M48 43h84%22/%3E %3Ccircle cx=%2290%22 cy=%2292%22 r=%2234%22/%3E %3Ccircle cx=%2290%22 cy=%2292%22 r=%2224%22/%3E %3Cpath d=%22M73 92c9-11 23-13 35-2-5 16-22 22-35 12%22 stroke=%22%23155b26%22/%3E %3Ccircle cx=%22117%22 cy=%2229%22 r=%226%22/%3E%3Cpath d=%22M57 29h25%22/%3E %3C/g%3E %3C/svg%3E"
};
  var ICONS = [
    [/ice ?maker|icemaker/i, "ice_maker.svg"], [/dishwasher/i, "dishwasher.svg"],
    [/laundry center|washtower|wash tower/i, "laundry_center.svg"], [/dryer/i, "dryer.svg"], [/washer/i, "washer.svg"],
    [/hood|liner|ventilation|downdraft|blower|vent/i, "ventilation.svg"], [/microwave|advantium|speed oven/i, "microwave.svg"],
    [/warming|warmer/i, "warming_drawer.svg"], [/grill|outdoor|egg|smoker/i, "outdoor_grill.svg"], [/coffee|espresso/i, "coffee.svg"],
    [/cooktop|rangetop|induction/i, "cooktop.svg"], [/range\b|stove/i, "range.svg"], [/oven|steam/i, "ovens.svg"],
    [/refrigerat|fridge|freezer|column|wine|beverage|undercounter|merchandiser|cooler|kegerator/i, "refrigeration.svg"]
  ];
  function iconFor(it) {
    var words = [it.category, it.appliance, it.model, (SW.formOf(it) || {}).k].filter(Boolean).join(" ");
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(words)) return ICON_SVG[ICONS[i][1].replace(".svg", "")];
    return ICON_SVG.refrigeration;
  }

  function assetCard(it, w) {
    var st = SW.fieldState(it);
    var cls = st.complete && !st.attention ? "complete" : (st.attention ? "attention" : "");
    var spec = SW.specSummary(it), field = SW.fieldSummary(it);
    if (mergeMode) {
      var picked = mergeSel.indexOf(it.id) >= 0, dis = SW.isMerge(it) || SW.basisPending(it) || !SW.isRefrigeration(it);
      return '<button class="tech-asset-card sw-mergepick' + (picked ? " picked" : "") + (dis ? " off" : "") +
        '" data-act="mergepick" data-id="' + it.id + '"' + (dis ? " disabled" : "") + ">" +
        '<span class="sw-pickbox">' + (picked ? "✓" : "") + "</span>" +
        '<span class="sw-card-body"><strong>' + esc(SW.itemTitle(it)) + "</strong>" +
        '<span class="sw-card-sub">' + esc(SW.itemWhere(it) || "Location not set") + "</span>" +
        '<span class="sw-card-meta">' + esc([it.brand, it.model].filter(Boolean).join(" ") || "No model") +
        (spec ? " · spec " + spec : "") + "</span>" +
        (dis ? '<span class="sw-card-detail">' + (SW.isMerge(it) ? "Already a merge" : !SW.isRefrigeration(it) ? "Not refrigeration — does not merge" : "Choose the install basis first") + "</span>" : "") +
        "</span></button>";
    }
    /* One card, one glance: what it is, where it is, how far along. The
       numbers live inside — the showroom walk was "too much on screen". */
    return '<button class="tech-asset-card sw-icon-card ' + cls + '" data-act="open" data-id="' + it.id + '">' +
      '<span class="tech-asset-icon"><img src="' + iconFor(it) + '" alt=""></span>' +
      '<span class="sw-card-body">' +
      (SW.isMerge(it) ? '<span class="sw-merge-tag">Merged · ' + SW.mergeUnits(it).length + " units</span>" : "") +
      "<strong>" + esc(SW.itemTitle(it)) + "</strong>" +
      '<span class="sw-card-meta">' + esc([it.brand, it.model].filter(Boolean).join(" ") || "No model") + "</span>" +
      (SW.itemWhere(it) ? '<span class="sw-card-sub">' + esc(SW.itemWhere(it)) + "</span>" : "") +
      (function () {
        if (st.complete || !st.started) return "";   /* untouched: the pill says so */
        var rest = itemNeeds(it);
        if (!rest.length) return "";
        return '<span class="sw-card-needs">Still needed: ' + esc(rest.slice(0, 3).map(function (n) { return n.label; }).join(" · ")) + (rest.length > 3 ? " +" + (rest.length - 3) : "") + "</span>";
      })() +
      "</span>" +
      '<span class="sw-card-right">' +
      '<span class="tech-status-pill ' + st.code + '">' + esc(st.label) + "</span>" +
      (it.photos.length ? '<span class="sw-card-photos">' + it.photos.length + " ▣</span>" : "") +
      "</span></button>";
  }

  /* Two or three units that share one cavity are one opening. The tech
     (or the office) picks them here; the sheet folds them together. */
  function mergeBar(w) {
    if (!mergeMode) {
      return '<div class="sw-mergebar"><span>Refrigeration that shares one cavity — merged columns, an ice maker beside an undercounter — is one opening.</span>' +
        '<button class="button ghost small" data-act="mergemode">Merge openings</button></div>';
    }
    var sel = mergeSel.map(function (id) { return SW.item(w, id); }).filter(Boolean);
    var why = SW.canMerge(sel);
    return '<div class="sw-mergebar on"><div><strong>Tap the units that share one cavity</strong>' +
      "<span>" + (sel.length ? sel.map(function (x) { return esc(x.model || SW.itemTitle(x)); }).join(" + ") : "Nothing picked yet") +
      (why && sel.length ? " · " + esc(why) : "") + "</span></div>" +
      '<div class="inline-actions"><button class="button small" data-act="mergego"' + (why ? " disabled" : "") + ">Merge " + (sel.length || "") + " into one opening</button>" +
      '<button class="button ghost small" data-act="mergecancel">Cancel</button></div></div>';
  }
  /* Walks the office has sent that this phone does not hold yet, on the
     walk screen itself — a tech inside one job's walk had no way to know
     the office had built the next one (Cayden, 22 Oct). */
  function offersCard(w) {
    if (offers === null && !offerBusy) loadOffers();
    var fresh = (offers || []).filter(function (o) {
      var k = SW.offerState(o).kind;
      return (k === "new" && offerCurrent(o)) || k === "theirs-newer";
    });
    if (!fresh.length) return "";
    /* v0.9.82: one line. The list itself lives on the pick-up screen; here it
       pushed this walk's own openings two screens down. */
    return '<a class="sw-offers-here" href="#/pick"><span>' + fresh.length + " more walk" + (fresh.length === 1 ? "" : "s") +
      " from the office</span><b>All walks →</b></a>";
  }
  function renderHome() {
    var w = walk();
    var groups = {}, order = [];
    w.items.forEach(function (it) {
      var a = it.area || "Openings";   /* no room set at the desk: say what they are, not what is missing */
      if (!groups[a]) { groups[a] = []; order.push(a); }
      groups[a].push(it);
    });
    var r0 = SW.rollup(w);
    /* the hero already counts; the cards are the page. The sheets line
       only appears while something is still missing. */
    var body = '<a class="tech-back-link" href="#/pick">← All walks</a>' + head() + offersCard(w) + offlineCard() + accessCard(w) + sheetsCard(w);
    if (!w.items.length) {
      body += '<div class="card card-pad" style="margin-top:14px"><h2 style="font-size:18px;margin:0 0 6px">No openings loaded</h2>' +
        '<p style="margin:0 0 14px;color:var(--muted);font-size:13px">The office loads the Steel Cod spec book for this job before the walk, so the specs are already here when you arrive.</p>' +
        '<a class="button secondary" href="' + SW.nav("office", w.id) + '">Open the office setup</a></div>';
    }
    body += order.map(function (a) { return areaSection(a, groups[a], w); }).join("");
    if (SW.mergeCandidates(w).length > 1) body += mergeBar(w);
    var allDone = r0.done >= w.items.length && SW.accessAnswered(w);
    body += '<div class="tech-bottom-actions">' +
      '<button class="button secondary" data-act="save">Save now<small id="sw-dirty">' + (SW.isDirty() ? "unsaved edits" : "up to date") + "</small></button>" +
      '<button class="button' + (allDone ? " sw-pulse" : " ghost") + '" data-act="finish">Finish the walk<small>' +
      (SW.accessAnswered(w) ? r0.done + " of " + w.items.length + " walked"
        : "jobsite access still needed") + "</small></button></div>";
    HOST.innerHTML = body;
  }


  /* ---------------- are the sheets actually aboard? ----------------
     The walk arrives with a small travel copy of each install sheet in its
     own record, and the legible page is fetched from the shop server the
     first time somebody looks at it. Fetched at the house, that is a page
     that does not arrive. So the walk screen says, in words, whether the
     real pages are on this phone yet, and pulls them down while the phone
     still has the server. Nothing here is a spinner the tech has to
     interpret: it either says they are aboard or it says what is missing. */
  /* v0.9.83 — is THIS PAGE on the phone?
     The sheets line answered half of "will this work at the house". The
     other half is the page itself: on 9 Nov three walks were loaded at the
     shop from an address that cannot keep an offline copy, and none would
     open on site. So the walk screen says which it is, where there is a
     server behind the page:
       ready   — the page reopens with no signal
       pending — the copy is still being made (seconds, first visit)
       none    — this address cannot keep one; the walk will not reopen
                 away from this network */
  var offlineState = "";
  function offlineCheck() {
    if (!SW.hasPortal()) { offlineState = ""; return; }
    if (!window.isSecureContext || !("serviceWorker" in navigator)) { offlineState = "none"; return; }
    offlineState = navigator.serviceWorker.controller ? "ready" : "pending";
  }
  function offlineCard() {
    if (offlineState === "none") {
      return '<div class="sw-offline warn sw-offline-none"><span class="sw-offline-count">!</span>' +
        "<div><strong>This page is not saved on this phone</strong>" +
        "<p>It was opened from an address that cannot keep an offline copy, so the walk will not reopen away from this network. " +
        "Open the walk from the secure (https) address before leaving.</p></div></div>";
    }
    if (offlineState === "pending") {
      return '<div class="sw-offline sw-offline-pending"><span class="sw-offline-count">…</span>' +
        "<div><strong>Saving this page to the phone</strong><p>A few seconds on the first visit. Stay connected until this line goes away.</p></div></div>";
    }
    return "";
  }
  var sheetState = null;   /* {have,total,failed,offline,busy} for walkId */
  var sheetWalk = "";
  function sheetsCard(w) {
    var s = sheetState;
    if (!s || !s.total) {
      return offlineState === "ready"
        ? '<div class="sw-sheets done compact"><span class="sw-sheets-tick">✓</span><div><strong>Ready for the field — this page is saved on this phone</strong></div></div>'
        : "";
    }
    if (s.have >= s.total) {
      /* one quiet line once they are aboard — the cards are the page */
      return '<div class="sw-sheets done compact"><span class="sw-sheets-tick">✓</span>' +
        "<div><strong>" + (offlineState === "ready" ? "Ready for the field — this page and all " : "All ") + s.total + " install sheets are on this phone</strong></div></div>";
    }
    if (s.busy) {
      return '<div class="sw-sheets"><span class="sw-sheets-count">' + s.have + "/" + s.total + "</span>" +
        "<div><strong>Saving the install sheets to this phone</strong>" +
        "<p>Stay on the shop wifi until this finishes — after that the sheets work with no signal.</p></div></div>";
    }
    return '<div class="sw-sheets warn"><span class="sw-sheets-count">' + s.have + "/" + s.total + "</span>" +
      "<div><strong>" + (s.total - s.have) + " install sheet" + (s.total - s.have > 1 ? "s" : "") + " not on this phone yet</strong>" +
      "<p>" + (s.offline
        ? "The shop server cannot be reached from here. On the openings that are missing, Spec sheet shows the small travel copy, which may be too coarse to read a dimension off."
        : "Tap to try again while you have signal.") + "</p>" +
      '<button class="button ghost small" data-act="getsheets">Download the sheets</button></div></div>';
  }
  function sheetsStart(force) {
    var w = walk();
    if (!w) return;
    if (sheetWalk === w.id && sheetState && !force) return;
    sheetWalk = w.id;
    SW.specPagesLocal(w).then(function (base) {
      if (!base.total) { sheetState = base; return; }
      if (base.have >= base.total) { sheetState = base; render(); return; }
      sheetState = { have: base.have, total: base.total, failed: 0, offline: false, busy: true };
      render();
      return SW.warmSpecPages(w, function (p) {
        sheetState = { have: p.have, total: p.total, failed: p.failed, offline: p.offline, busy: true };
        var el = HOST && HOST.querySelector(".sw-sheets .sw-sheets-count");
        if (el) el.textContent = p.have + "/" + p.total;
      }).then(function (res) {
        if (!res) return;
        sheetState = { have: res.have, total: res.total, failed: res.failed, offline: res.offline, busy: false };
        render();
      });
    }).catch(function () { });
  }

  /* ---------------- jobsite access ----------------
     Required, and it sits above the openings, because a route nobody
     checked is a delivery nobody can make. */
  function accessCard(w) {
    var done = SW.accessAnswered(w);
    var a = SW.accessOf(w);
    var findings = SW.accessFindings(w);
    var jobs = SW.jobFindings(w), openQ = SW.prereqsOpen(w);
    var tone = !done ? "danger" : (findings.length || jobs.length) ? "warn" : "good";
    return '<a class="sw-access-card ' + tone + '" href="' + accessHref() + '">' +
      '<div><span class="sw-access-k">Jobsite access &amp; readiness</span>' +
      "<strong>" + (done ? esc(SW.accessSummary(w)) : "Not recorded yet") + "</strong>" +
      "<span>" + (done
        ? (findings.length ? esc(findings[0]) : jobs.length ? jobs.length + " thing" + (jobs.length > 1 ? "s" : "") + " the builder has to do before delivery" : (openQ ? openQ + " before-delivery question" + (openQ > 1 ? "s" : "") + " still to answer" : "Route photographed and clear · house ready"))
        : "Required before the walk can be finished — " + esc(SW.accessMissing(w).join(", "))) +
      "</span></div>" +
      '<span class="sw-access-go">' + (done ? "✓" : "→") + "</span></a>";
  }

  function renderAccess() {
    var w = walk();
    if (!w) { go(homeHref()); return; }
    var a = SW.accessOf(w);
    var tight = SW.num(a.tightestIn);

    var h = '<button class="tech-back-link" data-act="home">← ' + esc(w.project || "Walk") + "</button>";
    h += '<section class="sw-op-head compact"><div class="sw-op-head-row"><div>' +
      '<span class="sw-op-kicker">Before the openings</span><h1>Jobsite access</h1>' +
      '<p class="sw-op-model">How the appliances get into the building</p></div>' +
      '<span class="tech-autosave' + (savedFlash ? " saved" : "") + '" id="sw-autosave">' +
      (savedFlash ? "✓ Saved" : "Saves as you go") + "</span></div></section>";

    h += '<div class="sw-step-body has-stage">';

    h += '<h2 class="sw-step-h">How do they come in?</h2>' +
      '<div class="tech-chips">' + SW.ACCESS_ROUTES.map(function (r) {
        return '<button class="tech-chip' + (a.route === r.k ? " on" : "") +
          '" data-act="accessroute" data-v="' + r.k + '">' + esc(r.label) + "</button>";
      }).join("") + "</div>";

    h += '<h2 class="sw-step-h" style="margin-top:22px">Is the route clear today?</h2>' +
      '<div class="tech-quick-rating three">' + SW.ACCESS_STATES.map(function (st) {
        return '<button class="' + st.tone + " " + (a.state === st.k ? "selected" : "") +
          '" data-act="accessstate" data-v="' + st.k + '">' + esc(st.label) + "</button>";
      }).join("") + "</div>";

    if (a.state === "tight" || a.state === "blocked") {
      h += '<div class="sw-section" style="margin-top:18px">' +
        '<span class="sw-label">Tightest point <em>' + (tight != null ? "recorded" : "worth a number") + "</em></span>" +
        '<div class="sw-pad-foot">' +
        '<button class="button ghost small" data-act="keypad" data-dim="access">' +
        (tight != null ? esc(SW.fmtIn(tight)) : "Number pad") + "</button>" +
        (tight != null ? '<button class="button ghost small" data-act="accessclear">Clear</button>' : "") +
        '<span class="sw-hint" style="margin:0 0 0 4px">Narrowest door, turn or stair.</span></div></div>';
    }

    h += '<h2 class="sw-step-h" style="margin-top:22px">Photograph the way in <em>' +
      a.photos.length + " so far</em></h2>" +
      '<p class="sw-step-p">The door they come through, and anything that will fight them — a turn, a stair, a threshold.</p>';
    if (a.photos.length) {
      h += '<div class="sw-thumbs">' + a.photos.map(function (p, i) {
        return '<figure class="sw-thumb"><span class="sw-thumb-pic"><img src="' + p.thumb + '" alt="Access photo">' + SW.markupSvg(SW.markupOf(p)) + "</span>" +
          '<button class="sw-thumb-x" data-act="delaccessphoto" data-i="' + i + '" aria-label="Delete photo">×</button>' +
          '<button class="sw-thumb-mark" data-act="markup" data-p="' + esc(p.id) + '">✎ ' + (SW.hasMarkup(p) ? "Edit marks" : "Mark up") + "</button></figure>";
      }).join("") + "</div>";
    }
    h += '<label class="tech-photo-button required-photo' + (a.photos.length ? "" : " big") + '">' +
      "<span>▣ " + (a.photos.length ? "Another photo" : "Take the photo") + "</span>" +
      '<input type="file" accept="image/*" capture="environment" data-act="accessphotoin"></label>';

    /* Flooring not down changes every floor-standing height on the job by
       the same amount. One question, once. */
    var fl = SW.flooringOf(w), flt = SW.num(fl.thicknessIn);
    h += '<h2 class="sw-step-h" style="margin-top:22px">Is the finished flooring down?</h2>' +
      '<div class="tech-quick-rating two">' +
      '<button class="good ' + (fl.pending === false && fl.answered ? "selected" : "") + '" data-act="flooring" data-v="down">Yes, it is in</button>' +
      '<button class="monitor ' + (fl.pending ? "selected" : "") + '" data-act="flooring" data-v="pending">Not yet</button></div>';
    if (fl.pending) {
      h += '<div class="sw-pad-foot" style="margin-top:8px"><button class="button ghost small" data-act="keypad" data-dim="flooring">' +
        (flt != null ? esc(SW.fmtIn(flt)) + " of flooring to come" : "How thick will it be?") + "</button>" +
        '<span class="sw-hint" style="margin:0 0 0 4px">Every floor-standing height on this walk prints both ways — as read, and after the floor.</span></div>';
    }

    /* The house, not the hole: the paragraph every email ends with. */
    var openQ = SW.prereqsOpen(w);
    h += '<h2 class="sw-step-h" style="margin-top:22px">Before delivery <em>' + (openQ ? openQ + " to answer" : "answered") + "</em></h2>" +
      '<p class="sw-step-p">Tap what is true today. A "No" goes to the top of the builder\'s list.</p>' +
      '<div class="sw-form-checks">' + SW.JOB_PREREQS.map(function (x) {
        var pa = SW.prereqAnswer(w, x.k);
        return '<div class="sw-form-check' + (pa ? " answered" : "") + (pa === "no" ? " bad" : "") + '"><p>' + esc(x.q) + "</p>" +
          '<div class="tech-quick-rating three">' + SW.CHECK_ANSWERS.map(function (c) {
            return '<button class="' + c.tone + (pa === c.k ? " selected" : "") + '" data-act="prereq" data-k="' + x.k + '" data-v="' + c.k + '">' + esc(c.label) + "</button>";
          }).join("") + "</div>" +
          (pa === "no" ? '<span class="sw-form-fix">' + esc(x.fix) + " <b>" + esc(SW.ownerOf(x.owner).label) + "</b></span>" : "") + "</div>";
      }).join("") + "</div>";

    h += '<div class="sw-section" style="margin-top:20px"><span class="sw-label">Note <em>optional</em></span>' +
      '<textarea class="sw-input" rows="3" data-field="accessnote" placeholder="Anything the delivery crew needs to know.">' +
      esc(a.note || "") + "</textarea></div>";

    h += "</div>";

    var missing = SW.accessMissing(w);
    h += '<div class="tech-bottom-actions">' +
      '<button class="button ghost" data-act="home">← Openings</button>' +
      '<button class="button" data-act="home"' + (missing.length ? "" : "") + ">" +
      (missing.length ? "Still needs " + esc(missing[0]) : "Done →") + "</button></div>";

    h += keypadSheet({ spec: {}, actual: {}, rule: {}, points: {} });
    h += markupSheet(w);
    HOST.innerHTML = h;
  }

  /* ---------------- dimension entry ----------------
     A row per dimension. Collapsed it shows spec, field and the verdict.
     Tapped, it opens the pad: the spec value as one big button, then the
     fractions a framer is actually off by, then the number pad. Answering
     advances to the next unanswered dimension. */
  function dimRow(it, d, idx) {
    if (it.multiPoint) return dimRowPoints(it, d, idx);
    var spec = SW.num(it.spec[d.k]);
    var raw = it.actual[d.k];
    var skipped = raw === "NM";
    var act = skipped ? null : SW.num(raw);
    var v = SW.verdict(it, d.k);
    var rule = it.rule[d.k] || (d.k === "w" ? "exact" : "min");
    var answered = skipped || act != null;
    var isOpen = openDim === d.k;
    var cls = isOpen ? "open" : "collapsed";
    if (answered) cls += v.state === "bad" ? " bad" : (v.state === "ok" ? " good" : " skipped");

    var h = '<section class="sw-dim ' + cls + '" data-dim="' + d.k + '">' +
      '<button type="button" class="sw-dim-head" data-act="opendim" data-dim="' + d.k + '" aria-expanded="' + (isOpen ? "true" : "false") + '">' +
      '<span class="sw-dim-n">' + (answered ? (v.state === "bad" ? "!" : (skipped ? "–" : "✓")) : (idx + 1)) + "</span>" +
      '<span class="sw-dim-t"><strong>' + esc(d.label) + needPill(!answered && SW.dimNeeded(it, d.k)) + "</strong>" +
      '<span class="sw-dim-spec">' + (spec == null ? "no spec" : "spec " + esc(SW.specText(it, d.k)) + " " + esc(SW.RULES[rule])) + (d.datum ? " · " + esc(d.datum) : "") + "</span></span>" +
      '<span class="sw-dim-val">' + (skipped ? "not measured" : (act != null ? esc(SW.fmtIn(act)) : "—")) + "</span>" +
      '<span class="sw-dim-verdict v-' + v.state + '">' + esc(v.text) + "</span>" +
      "</button>";

    if (isOpen) {
      h += '<div class="sw-dim-pad">' + padBody(d.k, spec, null);
      h += '<div class="sw-pad-foot" style="margin-top:6px">' +
        (answered ? '<button class="button ghost small" data-act="setdim" data-dim="' + d.k + '" data-v="">Clear</button>' : "") +
        '<button class="button ghost small" data-act="multipoint">Irregular — take 3 readings</button>' +
        acceptRow(it, d) +
        "</div></div>";
    }
    return h + "</section>";
  }

  /* Three readings across an irregular opening. The worst one governs, and
     the row says which, so the tech can see the number that decided it. */
  function dimRowPoints(it, d, idx) {
    var spec = SW.num(it.spec[d.k]);
    var gov = SW.governing(it, d.k);
    var govAt = SW.governingPoint(it, d.k);
    var answered = SW.pointsAnswered(it, d.k);
    var v = SW.verdict(it, d.k);
    var rule = it.rule[d.k] || (d.k === "w" ? "exact" : "min");
    var isOpen = openDim === d.k;
    var cls = isOpen ? "open" : "collapsed";
    if (answered >= 3) cls += v.state === "bad" ? " bad" : (v.state === "ok" ? " good" : "");
    cls += " multi";

    var h = '<section class="sw-dim ' + cls + '" data-dim="' + d.k + '">' +
      '<button type="button" class="sw-dim-head" data-act="opendim" data-dim="' + d.k + '" aria-expanded="' + (isOpen ? "true" : "false") + '">' +
      '<span class="sw-dim-n">' + (answered >= 3 ? (v.state === "bad" ? "!" : "✓") : answered + "/3") + "</span>" +
      '<span class="sw-dim-t"><strong>' + esc(d.label) + "</strong>" +
      '<span class="sw-dim-spec">' + (spec == null ? "no spec" : "spec " + esc(SW.specText(it, d.k)) + " " + esc(SW.RULES[rule])) +
      " · 3 points</span></span>" +
      '<span class="sw-dim-val">' + (gov == null ? "—" : esc(SW.fmtIn(gov))) + "</span>" +
      '<span class="sw-dim-verdict v-' + v.state + '">' + esc(v.text) +
      (govAt >= 0 && answered > 1 ? " · " + esc(SW.pointLabel(d.k, govAt).toLowerCase()) + " governs" : "") + "</span>" +
      "</button>";

    if (isOpen) {
      h += '<div class="sw-dim-pad">';
      SW.pointsFor(d.k).forEach(function (pt) {
        var raw = it.points[d.k][pt.i];
        var val = SW.num(raw);
        var on = openPoint === pt.i;
        h += '<div class="sw-point ' + (on ? "open" : "") + (val != null ? " set" : "") +
          (govAt === pt.i && answered > 1 ? " governs" : "") + '">' +
          '<button type="button" class="sw-point-head" data-act="openpoint" data-dim="' + d.k + '" data-i="' + pt.i + '">' +
          "<span>" + esc(pt.label) + "</span>" +
          '<b>' + (val == null ? "—" : esc(SW.fmtIn(val))) + "</b></button>";
        if (on) h += '<div class="sw-point-pad">' + padBody(d.k, spec, pt.i) + "</div>";
        h += "</div>";
      });
      h += '<p class="sw-hint" style="margin-top:8px">Take each reading perpendicular from the finished panel face. The worst of the three decides the verdict.</p>';
      h += acceptRow(it, d);
      h += '<div class="sw-pad-foot" style="margin-top:8px">' +
        '<button class="button ghost small" data-act="singlepoint">Back to one reading</button></div>';
      h += "</div>";
    }
    return h + "</section>";
  }

  /* The spec button, the deltas and the escapes — shared by the single-point
     row and each point of a multi-point row. */
  /* Two ways to answer a dimension and no third. On spec, tap the number.
     Anything else, type it. */
  function padBody(k, spec, pointIndex) {
    var at = pointIndex == null ? "" : '" data-i="' + pointIndex;
    var h = "";
    if (spec != null) {
      h += '<button class="sw-pad-spec" data-act="setdim" data-dim="' + k + at + '" data-v="' + spec + '">' +
        "<b>= " + esc(SW.fmtIn(spec)) + "</b><span>on spec</span></button>";
    }
    h += '<button class="sw-pad-type" data-act="keypad" data-dim="' + k + at + '">' +
      "<b>Type it</b><span>" + (spec == null ? "no spec — measure it" : "anything but the number above") + "</span></button>";
    h += '<div class="sw-pad-foot">' +
      '<button class="button ghost small" data-act="setdim" data-dim="' + k + at + '" data-v="NM">Not measured</button>' +
      "</div>";
    return h;
  }

  /* Could not measure it at all: a real answer, and the only way a walk on a
     jobsite that is not finished can ever be completed. */
  function notReadyCard(it) {
    var h = '<div class="sw-section"><span class="sw-label">Could not measure this opening</span>';
    if (it.notReady) {
      h += '<div class="card card-pad sw-notready"><span class="badge danger">Not verified · ' + esc(it.notReady) + "</span>" +
        "<p>It prints as a builder response: they tell us when it is ready and we verify it before delivery.</p>" +
        '<button class="button small ghost" data-act="clearnotready">Measure it after all</button></div>';
      return h + "</div>";
    }
    h += '<div class="tech-chips">' + SW.NOT_READY_REASONS.map(function (r) {
      return '<button class="tech-chip" data-act="notready" data-r="' + esc(r) + '">' + esc(r) + "</button>";
    }).join("") + "</div></div>";
    return h;
  }


  /* Accepting a reading that misses the sheet.

     Only offered once the reading has actually failed — an accept button on
     an on-spec dimension is an invitation to wave things through. The reason
     is mandatory and prints on the builder's page, because "Wilson accepted
     this" has to be attributable in six weeks when somebody asks. */
  function acceptRow(it, d) {
    var raw = SW.rawVerdict(it, d.k);
    var accepted = SW.acceptedReason(it, d.k);
    if (raw.state !== "bad" && !accepted) return "";
    if (!accepted) {
      return '<div class="sw-accept"><button class="sw-accept-open" data-act="acceptopen" data-dim="' +
        d.k + '">✓ Accept ' + esc(raw.text) + ' — no correction needed</button></div>';
    }
    if (acceptDim === d.k) {
      return '<div class="sw-accept open"><span class="sw-sublabel">Why is it acceptable?</span>' +
        '<div class="tech-chips">' + SW.ACCEPT_REASONS.map(function (r) {
          return '<button class="tech-chip ' + (accepted === r ? "on" : "") +
            '" data-act="acceptreason" data-dim="' + d.k + '" data-r="' + esc(r) + '">' + esc(r) + "</button>";
        }).join("") + "</div>" +
        '<button class="button ghost small" data-act="acceptclear" data-dim="' + d.k + '">Put it back on the punch list</button></div>';
    }
    return '<div class="sw-accept done"><button class="sw-accept-open" data-act="acceptopen" data-dim="' + d.k + '">' +
      "✓ Accepted · " + esc(accepted) + "</button></div>";
  }

  /* What is physically in the box.

     The check that measurements cannot make. An opening can be a perfect
     24 x 24 x 34 1/2 and still not take a unit, because a gas stub or a
     drain pipe is standing in it. One tap answers it. */
  function obstructionCard(it) {
    if (!SW.planeSize(it) && !SW.needsDims(it)) return "";
    var o = SW.obstructionOf(it);
    var h = '<div class="sw-section"><span class="sw-label">In the opening <em>' +
      (o.state ? "answered" : "not checked") + "</em></span>" +
      '<div class="card card-pad sw-obstruct">' +
      '<p class="sw-obstruct-q">Is anything standing in the opening — pipe, stub, wiring, box?' + needPill(!o.state) + "</p>" +
      '<div class="tech-quick-rating three">' + SW.OBSTRUCTION_STATES.map(function (st) {
        return '<button class="' + st.tone + " " + (o.state === st.k ? "selected" : "") +
          '" data-act="obstruct" data-v="' + st.k + '">' + esc(st.label) + "</button>";
      }).join("") + "</div>";

    if (o.state === "clears" || o.state === "holds") {
      h += '<span class="sw-sublabel" style="margin-top:14px">What is it?</span>' +
        '<div class="tech-chips">' + SW.OBSTRUCTION_KINDS.map(function (kind) {
          return '<button class="tech-chip ' + (o.kind === kind ? "on" : "") +
            '" data-act="obstructkind" data-v="' + esc(kind) + '">' + esc(kind) + "</button>";
        }).join("") + "</div>";
      h += '<span class="sw-sublabel" style="margin-top:14px">How far does it project from the back wall?</span>' +
        '<div class="sw-pad-foot">' +
        '<button class="button ghost small" data-act="keypad" data-dim="obstruction">' +
        (SW.num(o.projectsIn) != null ? esc(SW.fmtIn(SW.num(o.projectsIn))) : "Number pad") + "</button>" +
        (SW.num(o.projectsIn) != null
          ? '<button class="button ghost small" data-act="obstructclear">Clear</button>' : "") +
        '<span class="sw-hint" style="margin:0 0 0 4px">Optional — but it sets the setback.</span></div>';
    }
    if (o.state === "holds") {
      h += '<p class="sw-hint" style="margin-top:12px">Recorded as a correction. The packet asks the builder to recess or relocate it so the unit sits fully back.</p>';
    }
    return h + "</div></div>";
  }

  /* ---------- utilities ----------
     v0.9.59: the spec's type is the default and the picture. The tech
     looks at the wall and says yes or no; the lists are behind the no
     (Cayden, 22 Oct: "it should just say NEMA 14-50R read from the
     specs… a visual of that plug type… a yes or no check box"). Thirty
     spec books say a category only uses two to four types, so the "no"
     list is the category's own, with "Other…" for the rest. */
  var connUI = {};      /* key → { list, more, all } this session */
  function connState(key) { return connUI[key] || (connUI[key] = { list: false, more: false, all: false }); }
  function connPresent(answer) { return answer === "ok" || answer === "misplaced"; }
  /* the short list, with pictures, after "Something else" */
  function utilTypeRow(it, u) {
    var answer = it.utilities[u.key] || "", st = connState(u.key);
    var have = SW.utilTypeOf(it, u), want = SW.requiredUtilType(u, it);
    var types = SW.utilTypesFor(u);
    if (!types.length) return "";
    var open = st.list || (have && have !== want);
    if (!open) return "";
    /* the spec's own type is the Yes button; the list is everything else */
    var list = (st.all ? types : SW.utilTypesShort(it, u)).filter(function (t) { return t.k !== want; });
    var fix = SW.utilTypeFix(it, u);
    return '<div class="sw-utype"><span>' + (want ? "What is there instead?" : "Which one is it? <em>optional</em>") + "</span>" +
      '<div class="sw-plug-chips">' + list.map(function (t) {
        return '<button class="sw-plug-chip' + (have === t.k ? " on" : "") + (t.k === want ? " want" : "") +
          '" data-act="utype" data-u="' + esc(u.key) + '" data-t="' + esc(t.k) + '">' + SW.plugSvg(t.k, 40) + "<span>" + esc(t.label) + "</span></button>";
      }).join("") +
      (st.all || list.length >= types.length - (want ? 1 : 0) ? "" : '<button class="sw-plug-chip other" data-act="utypeall" data-u="' + esc(u.key) + '"><b>…</b><span>Other</span></button>') +
      "</div>" + (fix ? '<p class="sw-utype-fix">' + esc(fix) + "</p>" : "") + "</div>";
  }
  /* the yes/no details nobody had a chip for — GFCI, dedicated, NG/LP… */
  function utilFlagRows(it, u) {
    var flags = SW.utilFlagsFor(u);
    /* the range form measures the stub's projection as a number; do not ask it twice */
    if (SW.formKeyFor(it) === "range") flags = flags.filter(function (f) { return f.k !== "proj"; });
    if (!flags.length) return "";
    return '<div class="sw-uflags">' + flags.map(function (f) {
      var v = SW.utilFlag(it, u, f.k);
      var btns = f.opts ? f.opts.map(function (o) {
        return '<button class="tech-chip' + (v === o[0] ? " on" : "") + '" data-act="utflag" data-u="' + esc(u.key) + '" data-k="' + f.k + '" data-v="' + o[0] + '">' + esc(o[1]) + "</button>";
      }).join("") :
        '<button class="tech-chip' + (v === "yes" ? " on" : "") + '" data-act="utflag" data-u="' + esc(u.key) + '" data-k="' + f.k + '" data-v="yes">Yes</button>' +
        '<button class="tech-chip' + (v === "no" ? " on bad" : "") + '" data-act="utflag" data-u="' + esc(u.key) + '" data-k="' + f.k + '" data-v="no">No</button>';
      return '<div class="sw-uflag' + (f.bad && v === f.bad ? " bad" : "") + '"><span>' + esc(f.q) + "</span><div>" + btns + "</div></div>";
    }).join("") + "</div>";
  }

  /* Every opening gets the question — a panel-ready Perlick the library
     does not know, or a column the office marked wrong, is one tap here
     instead of a trip back to the desk. Library models arrive answered. */
  function panelCard(it) {
    var ready = SW.isPanelReady(it);
    var override = it.panelReady === true || it.panelReady === false;
    if (!ready) {
      return '<div class="sw-section sw-panel-ask"><span class="sw-label">Panel</span>' +
        '<div class="card card-pad sw-panel"><p class="sw-hint" style="margin:0 0 8px">' +
        (override ? "Marked not panel-ready." : "Not a panel-ready model, as far as the office knows.") + "</p>" +
        '<button class="button small ghost" data-act="panelready" data-v="1">This one takes a cabinet panel</button></div></div>';
    }
    var spec = SW.panelText(it);
    var h = '<div class="sw-section"><span class="sw-label">Panel <em>panel-ready unit</em></span>' +
      '<div class="card card-pad sw-panel">';
    var thick = SW.panelThickness(it), pb = SW.panelBasis(it);
    /* the thickness the sheet assumes, the job's panel, and what moves with it */
    if (pb) {
      var opts = [0.625, 0.75, 1, 1.25];
      h += '<span class="sw-sublabel">Panel thickness <em>the sheet assumes ' + esc(SW.fmtIn(pb.assumed)) + (SW.panelRangeText(pb) ? " · this model takes " + esc(SW.panelRangeText(pb)) : "") + "</em></span>" +
        '<div class="tech-chips sw-panel-thick">' + opts.map(function (o) {
          return '<button class="tech-chip' + (thick != null && Math.abs(thick - o) < 1e-6 ? " on" : "") + '" data-act="panelthick" data-v="' + o + '">' + esc(SW.fmtIn(o)) + "</button>";
        }).join("") + '<button class="tech-chip' + (thick != null && opts.every(function (o) { return Math.abs(thick - o) > 1e-6; }) ? " on" : "") + '" data-act="keypad" data-dim="panelthick">' +
        (thick != null && opts.every(function (o) { return Math.abs(thick - o) > 1e-6; }) ? esc(SW.fmtIn(thick)) : "Other…") + "</button></div>" +
        '<p class="sw-hint sw-panel-basis">' + esc(SW.panelBasisText(it)) + "</p>";
    } else if (thick != null) h += '<p class="sw-panel-spec">Panel thickness ' + esc(SW.fmtIn(thick)) + (SW.flushOn(it) ? " — set the cleat back " + esc(SW.fmtIn(thick + 0.125)) + "–" + esc(SW.fmtIn(thick + 0.25)) : "") + "</p>";
    if (spec) h += '<p class="sw-panel-spec">Required panel ' + esc(spec) + "</p>";
    else if (SW.panelSpecMissing(it)) {
      h += '<p class="sw-panel-spec missing">Panel size is not in the library for this model yet — ' +
        "answer the questions below and flag it to the office so the packet carries a number.</p>";
    }
    h += '<span class="sw-sublabel">Who supplies it?' + needPill(!it.panelBy) + "</span>" +
      '<div class="tech-quick-rating three">' + SW.PANEL_BY.map(function (o) {
        return '<button class="' + (o.k === "custom" ? "monitor" : o.k === "wilson" ? "good" : "") + " " +
          (it.panelBy === o.k ? "selected" : "") + '" data-act="panelby" data-v="' + o.k + '">' + esc(o.label) + "</button>";
      }).join("") + "</div>";

    if (it.panelBy === "custom") {
      h += '<span class="sw-sublabel" style="margin-top:14px">Is the panel here?' + needPill(!it.panelState) + "</span>" +
        '<div class="tech-quick-rating three">' + SW.PANEL_STATE.map(function (o) {
          return '<button class="' + o.tone + " " + (it.panelState === o.k ? "selected" : "") +
            '" data-act="panelstate" data-v="' + o.k + '">' + esc(o.label) + "</button>";
        }).join("") + "</div>";
      if (it.panelState === "verified" || it.panelState === "onsite-wrong") {
        h += '<span class="sw-sublabel" style="margin-top:14px">Handle pulls installed?</span>' +
          '<div class="tech-quick-rating two">' +
          '<button class="good ' + (it.panelPulls === "yes" ? "selected" : "") + '" data-act="panelpulls" data-v="yes">Yes</button>' +
          '<button class="poor ' + (it.panelPulls === "no" ? "selected" : "") + '" data-act="panelpulls" data-v="no">Not yet</button>' +
          "</div>";
      }
      if (it.panelState === "absent") {
        h += '<p class="sw-hint" style="margin-top:12px">Recorded as an open item. The packet asks the builder to confirm the panel is built to the size above with pulls on, before the delivery is scheduled — so this does not have to hold up the walk.</p>';
      }
    } else if (it.panelBy === "undecided") {
      h += '<p class="sw-hint" style="margin-top:12px">The packet will ask the builder to confirm who is supplying the panel.</p>';
    }
    h += panelMeasureBlock(it);
    h += '<p class="sw-hint" style="margin-top:12px"><button class="sw-link" data-act="panelready" data-v="0">Not actually panel-ready</button></p>';
    return h + "</div></div>";
  }
  /* The panels, measured. Each one gets a name, a width and a height off the
     pad, the target it should be, and whether it sits flat. Three panels on
     one fridge is normal; "not right" was never enough. */
  function panelMeasureBlock(it) {
    var list = it.panels || [];
    var h = '<div class="sw-panels"><span class="sw-sublabel" style="margin-top:14px">Measure the panels <em>' +
      (list.length ? list.length + " on this opening" : "optional — if they are here") + "</em></span>";
    list.forEach(function (p) {
      var vs = SW.panelVerdicts(p);
      h += '<div class="sw-pnl' + (vs.length ? " bad" : "") + '" data-pid="' + esc(p.id) + '">' +
        '<div class="sw-pnl-head"><strong>' + esc(p.label) + "</strong>" +
        '<button class="remove-button" data-act="pnlremove" data-pid="' + esc(p.id) + '">Remove</button></div>' +
        '<div class="sw-pnl-dims">' +
        ["w", "h"].map(function (k) {
          var tgt = p[k === "w" ? "targetW" : "targetH"], act = p[k];
          var bad = vs.some(function (v) { return v.k === k; });
          return '<button class="sw-pnl-dim' + (act ? " set" : "") + (bad ? " bad" : "") + '" data-act="keypad" data-dim="pnl:' + esc(p.id) + ":" + k + '">' +
            "<span>" + (k === "w" ? "Wide" : "Tall") + (tgt ? " · should be " + esc(SW.fmtIn(SW.num(tgt))) : "") + "</span>" +
            "<strong>" + (act ? esc(SW.fmtIn(SW.num(act))) : "—") + "</strong></button>";
        }).join("") + "</div>" +
        '<div class="tech-quick-rating three">' + SW.PANEL_PLANES.map(function (pl) {
          return '<button class="' + pl.tone + " " + (p.plane === pl.k ? "selected" : "") + '" data-act="pnlplane" data-pid="' + esc(p.id) + '" data-v="' + pl.k + '">' + esc(pl.label) + "</button>";
        }).join("") + "</div>" +
        (vs.length ? '<div class="sw-pnl-fix">' + vs.map(function (v) { return "<div>" + esc(v.fix) + "</div>"; }).join("") + "</div>" : "") +
        "</div>";
    });
    h += '<div class="tech-chips sw-pnl-add">' + SW.PANEL_LABELS.map(function (l) {
      return '<button class="tech-chip" data-act="pnladd" data-l="' + esc(l) + '">+ ' + esc(l) + "</button>";
    }).join("") + "</div></div>";
    return h;
  }

  function basisCard(it) {
    var e = SW.itemEntry(it);
    if (!e) {
      return '<div class="card card-pad sw-basis"><span class="sw-label">Installation basis</span>' +
        "<p>" + (it.model ? "<strong>" + esc(it.model) + "</strong> is not in the spec library." : "No model on this line.") +
        " The office sets the spec dimensions by hand for this one.</p></div>";
    }
    var multi = e.variations.length > 1;
    var chosen = SW.variationOf(e, it.basisKey);
    if (!chosen) {
      return '<div class="card card-pad sw-basis blocked">' +
        '<span class="badge danger">Pick one before you measure</span>' +
        "<p><strong>" + esc(e.brand + " " + e.model) + "</strong> has " + e.variations.length +
        " installation details in the spec package, and the openings are not interchangeable.</p>" +
        '<div class="stack" style="gap:8px">' + e.variations.map(function (v) {
          return '<button class="sw-basis-opt" data-act="basispick" data-k="' + esc(v.key) + '">' +
            "<span><strong>" + esc(v.label) + "</strong>" +
            (SW.hasOpening(v) ? '<span class="sw-basis-open">' + esc(SW.openingText(v)) + "</span>" : "") +
            (v.tells.length ? "<span>" + esc(v.tells[0]) + "</span>" : "") + "</span>" +
            '<b>' + esc(v.page) + "</b></button>";
        }).join("") + "</div></div>";
    }
    var h = '<div class="card card-pad sw-basis">' +
      '<div class="sw-basis-head"><span class="badge info">' + esc(chosen.label.toUpperCase()) + " · " + esc(chosen.page) + "</span>" +
      (multi ? '<button class="button ghost small" data-act="basisclear">Change</button>' : "") + "</div>" +
      (SW.hasOpening(chosen)
        ? '<p class="sw-basis-open">Opening ' + esc(SW.openingText(chosen)) + "</p>"
        : '<p>No rough opening — freestanding or countertop. Record the condition and set the status by judgement.</p>');
    if (multi && chosen.tells.length) {
      h += '<div class="callout info"><strong>What this looks like on site</strong>' +
        "<ul class=\"sw-tells\">" + chosen.tells.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>" +
        '<span class="sw-label">Does the opening match that?</span>' +
        '<div class="tech-quick-rating two">' +
        '<button class="good ' + (it.basisConfirmed === "yes" ? "selected" : "") + '" data-act="basisconfirm" data-v="yes">Yes<span>matches</span></button>' +
        '<button class="poor ' + (it.basisConfirmed === "no" ? "selected" : "") + '" data-act="basisconfirm" data-v="no">No<span>it does not</span></button>' +
        "</div>";
    }
    return h + "</div>";
  }

  function conflictCard(it) {
    var flags = SW.itemFlags(it).filter(function (f) { return f.kind !== "basis-open"; });
    if (!flags.length) return "";
    var fits = SW.fitVariations(it);
    return flags.map(function (f) {
      var h = '<div class="card card-pad sw-conflict"><span class="badge danger">' + esc(f.short) + "</span>" +
        "<p>" + esc(f.text) + "</p>";
      if (f.kind === "basis-conflict" && fits.length) {
        h += '<div class="sw-fits">' + fits.map(function (fit) {
          return '<div class="sw-fit ' + (fit.v.key === it.basisKey ? "chosen" : "") + '">' +
            "<strong>" + esc(fit.v.label) + "</strong><span>" + esc(fit.parts.join("  ")) + "</span></div>";
        }).join("") + "</div>" +
          '<button class="button small" data-act="basispick" data-k="' + esc(fits[0].v.key) + '">Switch basis to ' + esc(fits[0].v.label) + "</button>";
      }
      return h + "</div>";
    }).join("");
  }

  function statusPicker(it) {
    var s = SW.statusOf(it), auto = SW.autoStatus(it);
    var h = '<div class="sw-section"><span class="sw-label">Status' +
      (auto && !it.status ? ' <em>set from the measurements</em>' : "") + "</span>" +
      '<div class="tech-quick-rating four">' + SW.STATUSES.map(function (st) {
        var cls = st.k === "ready" ? "excellent" : st.k === "verify" ? "good" : st.k === "modify" ? "monitor" : "poor";
        return '<button class="' + cls + " " + (s === st.k ? "selected" : "") + '" data-act="status" data-k="' + st.k + '">' +
          "<b>" + esc(st.label) + "</b><span>" + esc(st.hint) + "</span></button>";
      }).join("") + "</div>";
    if (it.status === "ready" && auto && auto !== "ready") {
      h += '<p class="sw-hint">Marked ready over the measurements: every miss on this opening is recorded as <strong>accepted by the installer</strong> — it prints, but nothing goes on the builder\'s list. Say why in the note.</p>';
    } else if (it.status && auto && it.status !== auto) {
      h += '<p class="sw-hint">Overriding the measured result (<strong>' + esc(SW.SK[auto].label) + "</strong>). Say why in the note.</p>";
    }
    return h + "</div>";
  }

  /* ---------- corrections: who does what, and how much it matters ----------
     Chips are the department's own sentences, sorted by the trade that
     does them. A chip with a number in it opens the pad — "reduce to 23 5/8"
     is a correction, "reduce it" is a wish. Every line carries an owner and
     a weight; the defaults are right most of the time and one tap changes
     them. */
  var chipOwnerFilter = "";   /* "" = all trades */
  function ownerTag(k) {
    var o = SW.ownerOf(k);
    return '<em class="sw-own who-' + o.who + '">' + esc(o.label) + "</em>";
  }
  function actionRow(a) {
    var isDerived = !!a.derived;
    var sev = a.severity === "cosmetic";
    return '<div class="sw-act' + (sev ? " cosmetic" : "") + (a.kind === "question" ? " question" : "") + '" data-key="' + esc(a.key || a.id) + '">' +
      '<div class="sw-act-text">' + (a.kind === "question" ? "<b>Q</b> " : "") + esc(a.text) +
      (isDerived ? '<small>from the measurements</small>' : "") + "</div>" +
      '<div class="sw-act-meta">' +
      '<select class="sw-act-owner" data-act="actowner" data-key="' + esc(a.key || a.id) + '" aria-label="Who does this">' +
      SW.OWNERS.map(function (o) {
        return '<option value="' + o.k + '"' + (o.k === a.owner ? " selected" : "") + ">" + esc(o.label) + "</option>";
      }).join("") + "</select>" +
      (a.kind === "question" ? "" :
        '<button class="sw-act-sev' + (sev ? " on" : "") + '" data-act="actsev" data-key="' + esc(a.key || a.id) + '">' +
        (sev ? "Cosmetic" : "Blocks install") + "</button>") +
      (isDerived ? "" : '<button class="remove-button" data-act="unchip" data-id="' + esc(a.id) + '">Remove</button>') +
      "</div></div>";
  }
  function chipRow(it) {
    var s = SW.statusOf(it);
    if (s !== "modify" && s !== "decision") return "";
    var sets = SW.chipsFor(it);
    var list = SW.corrections(it);
    var h = '<div class="sw-section"><span class="sw-label">What has to change here' +
      (list.length ? " <em>" + list.length + "</em>" : "") + "</span>";

    if (list.length) {
      h += '<div class="sw-acts">' + list.map(actionRow).join("") + "</div>";
    }

    /* the chip library, by trade */
    var owners = [];
    var pool = sets.primary.concat(showMoreChips ? sets.more : []);
    pool.forEach(function (c) { if (owners.indexOf(c.owner) < 0) owners.push(c.owner); });
    var order = SW.OWNERS.map(function (o) { return o.k; });
    owners.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    /* Sixty sentences is a wall on a phone. One row per trade, with how
       many are already on this opening; tap a trade to see its chips. The
       trade with the opening's measured problem is opened by default. */
    if (!chipOwnerFilter) {
      var firstDerived = list.filter(function (a) { return a.derived; })[0];
      chipOwnerFilter = firstDerived ? firstDerived.owner : "";
    }
    h += '<p class="sw-hint" style="margin:0 0 6px">Tap a trade to add what it has to do here.</p>';
    h += '<div class="sw-chip-groups">' + owners.map(function (k) {
      var chips = pool.filter(function (c) { return c.owner === k; });
      if (!chips.length) return "";
      var open = chipOwnerFilter === k;
      var onCount = chips.filter(function (c) { return SW.hasAction(it, c.t) || it.actions.some(function (a) { return a.chip === c.id; }); }).length;
      var head = '<button class="sw-chip-head' + (open ? " open" : "") + '" data-act="chipfilter" data-o="' + (open ? "-" : k) + '">' +
        "<strong>" + esc(SW.ownerOf(k).label) + "</strong>" +
        "<span>" + (onCount ? onCount + " on · " : "") + chips.length + "</span><em>" + (open ? "−" : "+") + "</em></button>";
      if (!open) return '<div class="sw-chip-group">' + head + "</div>";
      return '<div class="sw-chip-group open">' + head + "<div class=\"tech-chips\">" +
        chips.map(function (c) {
          var on = SW.hasAction(it, c.t) || (SW.chipHasSlot(c) && it.actions.some(function (a) { return a.chip === c.id; }));
          var label = c.t.replace(/\{n\}/g, "__");
          return '<button class="tech-chip' + (on ? " selected" : "") + (c.kind === "question" ? " q" : "") +
            '" data-act="chip" data-id="' + esc(c.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
            (on ? "✓ " : "+ ") + esc(label) + "</button>";
        }).join("") + "</div></div>";
    }).join("") + "</div>";
    if (sets.more.length) {
      h += '<button class="tech-chip sw-chip-more" data-act="morechips">' + (showMoreChips ? "Fewer" : "More for other appliances…") + "</button>";
    }

    /* the tech's own words, and a question — behind one tap (v0.9.59) */
    if (!ownWordsOpen) {
      h += '<button class="sw-more" data-act="ownwords">Write your own… <em>something else to do, or a question for the builder</em></button>';
    } else {
      h += '<div class="sw-own-line">' +
        '<input class="sw-input" id="sw-custom-act" placeholder="Something else the builder has to do…" enterkeyhint="done">' +
        '<button class="button small" data-act="addcustom">Add</button></div>' +
        '<div class="sw-own-line">' +
        '<input class="sw-input" id="sw-custom-q" placeholder="A question for the builder…" enterkeyhint="done">' +
        '<button class="button small secondary" data-act="addquestion">Ask</button></div>';
    }

    if (s === "decision") h += optionRow(it);
    return h + "</div>";
  }

  function photoRow(it) {
    var h = '<div class="sw-section"><span class="sw-label">Photos <em>' + it.photos.length + "</em></span>";
    if (it.photos.length) {
      h += '<div class="sw-thumbs">' + it.photos.map(function (p, i) {
        return '<figure class="sw-thumb" data-photo="' + esc(p.id) + '">' +
          '<img src="' + p.thumb + '" alt="Site photo">' +
          '<button class="sw-thumb-x" data-act="delphoto" data-i="' + i + '" aria-label="Delete photo">×</button>' +
          "</figure>";
      }).join("") + "</div>";
    }
    h += '<label class="tech-photo-button required-photo">' +
      "<span>▣ " + (it.photos.length ? "Another photo" : "Take a photo of this opening") + "</span>" +
      '<input type="file" accept="image/*" capture="environment" data-act="photoin"></label>';
    return h + "</div>";
  }


  /* ---------- marking a connection on the photograph ---------------------
     Four corner taps calibrate the frame against an opening whose real size
     the tech has just measured; after that, every tap is a measurement. The
     same screen with no photograph behind it is the reference drawing —
     the opening to scale with the sheet's zone on it — so "where is this
     supposed to go?" and "here is where it actually is" are one screen and
     not two. */
  var markFull = { id: "", url: "" };
  /* Used only to draw the reference view, where there is no photograph to
     calibrate against: a straight-on rectangle inset from the edges. */
  var FLAT_AR = 0.75;   /* the reference stage is three wide by four tall */



  /* markSheet retired: the stage is part of the flow now, not a sheet
     behind a button. Its drawing helpers above are still used. */
  var OPTION_PRESETS = [
    "Keep it as specified.", "Substitute the alternate model.",
    "Keep the left hinge.", "Switch to the right hinge.",
    "Builder to modify the opening.", "Wilson to supply a filler or partition."
  ];
  function optionRow(it) {
    var opts = (it.options || []).filter(Boolean);
    var h = '<div class="sw-options"><span class="sw-sublabel">The choices to tick — the packet prints these as boxes</span>';
    if (opts.length) {
      h += '<div class="sw-optlist">' + opts.map(function (o, i) {
        return '<div class="sw-optrow"><span class="sw-cbx"></span><span>' + esc(o) + "</span>" +
          '<button data-act="optdel" data-i="' + i + '" aria-label="Remove">×</button></div>';
      }).join("") + "</div>";
    }
    h += '<div class="tech-chips">' + OPTION_PRESETS.filter(function (p) {
      return opts.indexOf(p) < 0;
    }).map(function (p) {
      return '<button class="tech-chip" data-act="optadd" data-v="' + esc(p) + '">＋ ' + esc(p) + "</button>";
    }).join("") + "</div>";
    h += '<p class="sw-hint">Two is usually right. With none, the packet prints a write-in line.</p>';
    return h + "</div>";
  }

  function noteRow(it) {
    var open = !!it.notes;
    return '<div class="sw-section"><span class="sw-label">Field note <em>optional</em></span>' +
      '<div class="tech-optional-row">' +
      '<button class="tech-optional-toggle ' + (open ? "filled" : "") + '" data-act="togglenote">' +
      (open ? "✓ Note added" : "＋ Note") + "</button></div>" +
      '<div class="tech-note-field ' + (open ? "" : "hidden") + '" id="sw-note-field">' +
      '<textarea class="sw-input" rows="3" data-field="notes" placeholder="Anything the installer or builder needs to know.">' + esc(it.notes || "") + "</textarea></div></div>";
  }

  function renderItem() {
    var w = walk(), it = item();
    if (!it) { go(homeHref()); return; }
    var idx = w.items.indexOf(it);
    var st = SW.fieldState(it);
    var steps = stepsFor(it);
    var i = currentStep(it);
    var step = steps[i] || steps[steps.length - 1];

    var h = '<button class="tech-back-link" data-act="home">← ' + esc(w.project || "Walk") + "</button>";
    h += '<section class="sw-op-head compact">' +
      '<div class="sw-op-head-row">' +
      "<div><span class=\"sw-op-kicker\">" + (SW.itemWhere(it) ? esc(SW.itemWhere(it)) + " · " : "") +
      "opening " + (idx + 1) + " of " + w.items.length +
      /* v0.9.82: the spec package does not say which room; the person standing
         in it does. One tap, here, instead of "Location not set" everywhere. */
      ' <button class="sw-room-btn" data-act="roomopen">' + (it.area ? "change room" : "+ room") + "</button></span>" +
      (roomOpen ? '<div class="sw-room-pick">' + ROOMS.map(function (r) {
        return '<button class="tech-chip' + (it.area === r ? " on" : "") + '" data-act="roomset" data-v="' + esc(r) + '">' + esc(r) + "</button>";
      }).join("") + "</div>" : "") +
      "<h1>" + esc(SW.itemTitle(it)) + "</h1>" +
      '<p class="sw-op-model">' + esc([it.brand, it.model].filter(Boolean).join(" ") || "No model") +
      (it.specRef ? " · " + esc(it.specRef) : "") + "</p></div>" +
      '<span class="tech-autosave' + (savedFlash ? " saved" : "") + '" id="sw-autosave">' +
      (savedFlash ? "✓ Saved" : "Saves as you go") + "</span>" +
      "</div>" +
      '<div class="sw-op-head-tools">' +
      '<span class="tech-status-pill ' + st.code + '">' + esc(st.label) + "</span>" +
      (hasSpecCard(it)
        ? '<button class="sw-spec-btn" data-act="specopen">▤ Spec sheet' +
          (it.specPage && it.specPage.pageNo ? " · p." + esc(String(it.specPage.pageNo)) : "") + "</button>"
        : "") +
      "</div></section>";

    h += stepBar(it, i);
    h += stepBody(it, step.k);

    /* One forward button. On the last step it leaves the opening. The
       button pulses the moment the step on screen is answered, so "what do
       I press now" always has the same answer: the glowing one. */
    var last = i >= steps.length - 1;
    var needs = stepNeeds(it, step.k);
    var stepIsDone = !needs.length;
    /* v0.9.82: the list is a shortcut to the last few things, not a second
       copy of the step. With ten open it repeated the whole screen under
       itself; the rows mark themselves and the forward button counts. */
    if (needs.length && needs.length <= NEEDS_LIST_MAX) {
      h += '<div class="sw-needs"><span>Still needed here:</span>' + needs.map(function (n) {
        return '<button class="sw-need-chip" data-act="needjump" data-sel="' + esc(n.sel) + '">' + esc(n.label) + "</button>";
      }).join("") + "</div>";
    } else if (last) {
      var rest = itemNeeds(it);
      if (rest.length) {
        h += '<div class="sw-needs"><span>Still needed on this opening:</span>' + rest.map(function (n) {
          return '<button class="sw-need-chip" data-act="needstep" data-s="' + n.step + '" data-sel="' + esc(n.sel) + '">' + esc(n.label) + "</button>";
        }).join("") + "</div>";
      }
    }
    var needSub = needs.length ? "<small class=\"warn\">" + needs.length + " still needed here</small>" : "";
    h += '<div class="tech-bottom-actions">' +
      (i > 0
        ? '<button class="button ghost" data-act="stepback">← Back</button>'
        : (idx > 0 ? '<button class="button ghost" data-act="prev">← Previous</button>' : "")) +
      (!last
        ? '<button class="button' + (stepIsDone ? " sw-pulse" : " sw-incomplete") + '" data-act="stepnext">' + esc(steps[i + 1].label) + " →" + needSub + "</button>"
        : (SW.rollup(w).done >= w.items.length && SW.accessAnswered(w)
          ? '<button class="button' + (stepIsDone ? " sw-pulse" : "") + '" data-act="finish">Finish the walk →<small>every opening walked</small></button>'
          : '<button class="button' + (stepIsDone ? " sw-pulse" : "") + '" data-act="home">Done · back to the openings<small>' +
            SW.rollup(w).done + " of " + w.items.length + " walked</small></button>")) +
      "</div>";

    h += keypadSheet(it);
    h += specSheet(it);
    h += markupSheet(w);
    HOST.innerHTML = h;
    loadFullSpec(it);
    if (step.k === "photo") loadFullPhoto(it);
    /* Keep the active step chip on screen — but only when the step
       changed. Doing it on every repaint pulled the page back up to the
       step bar on every tap once the tech had scrolled past it (Cayden,
       22 Oct: "the pages love to default back to the top"). */
    var stepNow = it.id + ":" + step.k;
    var onChip = HOST.querySelector(".sw-step.on");
    if (onChip && onChip.scrollIntoView && stepNow !== lastStepShown) {
      try { onChip.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e2) { }
    }
    if (stepNow !== lastStepShown) scrollKeep = null;      /* a new step starts at its top */
    lastStepShown = stepNow;
  }
  var lastStepShown = "", scrollKeep = null;
  function toTop() { try { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); } }

  /* ---------------- the install sheet, one tap away -----------------------
     "The field tech should be able to easily hit an info button or card on
     their phone while looking at any appliance and the spec page for that
     install should pull up for them to glance at." The measurements are
     pre-loaded; this is the drawing behind them, for when a number on site
     disagrees with a number on the screen and somebody needs the source. */
  function hasSpecCard(it) {
    return !!(it.specPage || SW.itemEntry(it));
  }
  function specSheet(it) {
    if (!specOpen) return "";
    var e = SW.itemEntry(it), v = SW.itemVariation(it);
    var src = (it.specPage && specFull.id === it.specPage.photoId && specFull.url)
      ? specFull.url : (it.specPage ? it.specPage.thumb : "");

    var h = '<div class="sw-spec-sheet" data-act="specclose"><div class="sw-spec-inner" data-stop>' +
      '<div class="sw-spec-head"><div><strong>' + esc([it.brand, it.model].filter(Boolean).join(" ") || SW.itemTitle(it)) + "</strong>" +
      "<span>" + esc([v && ("Walked as " + v.label.toLowerCase()), it.specPage && it.specPage.pageNo ? "p." + it.specPage.pageNo + " of the spec package" +
        (it.specPage.heading ? " (" + it.specPage.heading.toLowerCase() + ")" : "") : (v && v.page)].filter(Boolean).join(" · ")) + "</span></div>" +
      '<button class="sw-spec-x" data-act="specx" aria-label="Close">×</button></div>';

    /* The page is the builder's sheet; the opening may be walked as a
       different install than it draws (CL4250UFD/S: sheet STANDARD, walk
       Flush inset — Cayden, 27 Oct). Say so above the picture, with the
       numbers the walk is actually using and where they come from. */
    var drawn = SW.sheetBasisMismatch(it), barred = e && v ? SW.variationBar(e, v, it.model) : "";
    if (drawn || barred) {
      h += '<div class="sw-spec-warn">' +
        (drawn ? "<strong>This page is the " + esc(drawn.toLowerCase()) + " — the opening is set up as " + esc(v.label.toLowerCase()) + ".</strong>" +
          "The builder's package has no " + esc(v.label.toLowerCase()) + " page. The numbers on this screen are the " + esc(v.label.toLowerCase()) +
          " ones" + (SW.hasOpening(v) ? " (" + esc(SW.openingText(v)) + ")" : "") + ", from " + esc([e.source, v.page].filter(Boolean).join(" ")) + ". " : "") +
        (barred ? "<strong>" + esc(barred) + "</strong> " : "") +
        "<span>Ask the office which install this job is before you mark anything.</span></div>";
    }

    if (src) {
      h += '<div class="sw-spec-page" data-act="speczoom"><img src="' + esc(src) + '" alt="Install sheet"></div>' +
        '<p class="sw-spec-hint">Tap the sheet to zoom. This is the page the office picked at import' +
        (it.specPage && it.specPage.heading ? " — " + esc(it.specPage.heading.toLowerCase()) : "") + ".</p>";
      var extras = it.specPages || [];
      if (extras.length) {
        h += '<p class="sw-spec-hint" style="margin-top:14px"><strong>The rest of this model\'s pages</strong> — ' + extras.length + " more from the spec book.</p>";
        extras.forEach(function (x) {
          var src = (specExtra[x.photoId] || x.thumb || "");
          h += '<p class="sw-spec-hint" style="margin-top:10px"><strong>p.' + esc(String(x.pageNo || "")) + "</strong>" +
            (x.heading ? " — " + esc(x.heading.toLowerCase()) : "") + "</p>" +
            (src ? '<div class="sw-spec-page" data-act="speczoom"><img src="' + esc(src) + '" alt="Sheet page"></div>'
                 : '<div class="sw-spec-page pending"><span class="photo-loading">Fetching the page…</span></div>');
        });
      }
    } else {
      h += '<p class="sw-spec-hint">No install sheet attached to this opening — the numbers below are the spec library\'s. ' +
        "Walks imported from the spec package carry the page itself.</p>";
    }

    /* the numbers it was measured against */
    var dims = SW.dimsFor(it).filter(function (d) { return SW.num(it.spec[d.k]) != null; });
    if (dims.length) {
      h += '<table class="sw-spec-dims"><thead><tr><th>Opening</th><th>Spec</th><th>Rule</th><th>Field</th></tr></thead><tbody>';
      dims.forEach(function (d) {
        var act = SW.num(it.actual[d.k]);
        h += "<tr><td>" + esc(d.label) + "</td><td><strong>" + esc(SW.specText(it, d.k)) + "</strong></td>" +
          "<td>" + esc(SW.RULES[it.rule[d.k] || "min"]) + "</td>" +
          "<td>" + (it.actual[d.k] === "NM" ? "not measured" : (act != null ? esc(SW.fmtIn(act)) : "—")) + "</td></tr>";
      });
      h += "</tbody></table>";
    }
    var need = SW.utilitiesFor(it);
    if (need.length) {
      h += '<div class="sw-spec-utils">' + need.map(function (u) {
        return "<div><strong>" + esc(SW.utilLabel(u)) + "</strong><span>" +
          esc([u.need, u.where].filter(Boolean).join(" — ")) + "</span></div>";
      }).join("") + "</div>";
    }
    if (v && v.notes) h += '<p class="sw-spec-hint">' + esc(v.notes) + "</p>";
    h += '<button class="button sw-spec-done" data-act="specx">Back to the walk</button>';
    return h + "</div></div>";
  }
  function loadFullSpec(it) {
    if (it && specOpen) loadExtraSpec(it);
    var id = it && it.specPage && it.specPage.photoId;
    if (!id || !specOpen || specFull.id === id) return;
    SW.photoUrl(id, { walkId: walkId, portalId: it.specPage.portalId }).then(function (url) {
      if (!url) return;
      specFull = { id: id, url: url };
      if (specOpen) render();
    }).catch(function () { });
  }


  var extraBusy = false;
  function loadExtraSpec(it) {
    if (extraBusy) return;
    var want = (it.specPages || []).filter(function (x) { return x.photoId && !specExtra[x.photoId] && !x.thumb; });
    if (!want.length) return;
    extraBusy = true;
    want.reduce(function (p, x) {
      return p.then(function () {
        return SW.photoUrl(x.photoId, { walkId: walkId, portalId: x.portalId }).then(function (url) {
          if (url) specExtra[x.photoId] = url;
        }).catch(function () { });
      });
    }, Promise.resolve()).then(function () { extraBusy = false; if (specOpen) render(); });
  }

  /* ================= the walk, in the order it happens =====================

     "Walk up to cutout, picture, measure, check plumbing, check elec, extra
     notes, next."

     One step on a screen at a time, in that order. The old card put every
     question up at once and the tech read it as paperwork — and the photo
     marking, which is the most useful thing in here, was hidden behind a
     button nobody pressed. Now the photograph is step one, the corners are
     tapped while it is still on screen, and by the time the plumbing step
     arrives the frame is already calibrated and the only thing to do is
     touch the pipe.

     Steps that do not apply are not shown: no panel step on a unit that
     takes no panel, no plumbing step on a speed oven. */

  var ALL_STEPS = [
    { k: "photo", label: "Photo", n: "1" },
    { k: "measure", label: "Measure", n: "2" },
    { k: "run", label: "Cabinets", n: "2b" },
    { k: "plumbing", label: "Plumbing", n: "3" },
    { k: "electrical", label: "Electrical", n: "4" },
    { k: "other", label: "Vent / air", n: "5" },
    { k: "panel", label: "Panel", n: "6" },
    { k: "notes", label: "Notes", n: "7" }
  ];

  function stepsFor(it) {
    return ALL_STEPS.filter(function (st) {
      if (st.k === "photo" || st.k === "notes") return true;
      if (st.k === "measure") return SW.needsDims(it) > 0 || SW.basisPending(it);
      if (st.k === "run") return hasRun(it);
      if (st.k === "panel") return SW.isPanelReady(it);
      return SW.utilitiesIn(it, st.k).length > 0;
    });
  }

  /* What a step still needs before it counts as done — each one a short
     label and the element to jump to. Cayden (22 Oct): "make it more
     obvious what is required — I find myself clicking back because I
     realised I didn't click something." The step is done when this list
     is empty; the Next button, the step chips and the home cards all read
     from it. */
  function stepNeeds(it, k) {
    var out = [];
    function need(label, sel) { out.push({ label: label, sel: sel }); }
    if (k === "photo") { if (!it.photos.length) need("Photo of the opening", ".tech-photo-button"); return out; }
    if (k === "measure") {
      if (SW.basisPending(it)) { need("Pick the install detail", ".sw-basis"); return out; }
      if (it.notReady) return out;
      SW.dimsFor(it).forEach(function (d) {
        if (!SW.dimNeeded(it, d.k)) return;
        var ok = it.multiPoint ? SW.pointsAnswered(it, d.k) >= 3 : (it.actual[d.k] !== "" && it.actual[d.k] != null);
        if (!ok) need(d.label, '.sw-dim[data-dim="' + d.k + '"]');
      });
      SW.formOf(it).checks.forEach(function (c) { if (!SW.formCheck(it, c.k)) need(c.short || c.q, '[data-act="formcheck"][data-k="' + c.k + '"]'); });
      (it.prep || []).forEach(function (pr) { if (!SW.prepState(it, pr.id)) need(pr.label || SW.prepKind(pr.kind).label, '[data-act="prepstate"][data-p="' + pr.id + '"]'); });
      if ((SW.planeSize(it) || SW.needsDims(it)) && !SW.obstructionAnswered(it)) need("Anything in the opening?", ".sw-obstruct");
      return out;
    }
    if (k === "run") {
      if (SW.isDishwasherish(it)) {
        if (!it.adjacentSide) need("Which side the sink cabinet is on", ".sw-adj-side");
        if (!SW.runGapAnswered(it)) need("Anything between the dishwasher and the sink cabinet?", ".sw-run-gap");
      }
      return out;
    }
    if (k === "panel") { if (!SW.panelAnswered(it)) need(it.panelBy === "custom" ? "Is the panel here?" : "Who supplies the panel", ".sw-panel"); return out; }
    if (k === "notes") return out;                        /* never blocks */
    SW.utilitiesIn(it, k).forEach(function (u) { if (!it.utilities[u.key]) need(SW.utilLabel(u), '.sw-svc[data-conn="' + u.key + '"]'); });
    return out;
  }
  function stepDone(it, k) { return stepNeeds(it, k).length === 0; }
  /* everything still needed on the opening, step by step */
  function itemNeeds(it) {
    var out = [];
    stepsFor(it).forEach(function (st) { stepNeeds(it, st.k).forEach(function (n) { out.push(Object.assign({ step: st.k }, n)); }); });
    return out;
  }
  var NEEDS_LIST_MAX = 4, moreFields = {};
  var ROOMS = ["Kitchen", "Pantry", "Bar", "Laundry", "Outdoor kitchen", "Primary suite", "Guest house", "Garage"], roomOpen = false;
  function needPill(on) { return on ? '&#8288;<em class="sw-need" title="Still needed"><i>needed</i></em>' : ""; }

  /* Where the tech is: wherever they last tapped, otherwise the first thing
     still unanswered, otherwise the end. */
  function currentStep(it) {
    var steps = stepsFor(it);
    if (stepKey) {
      for (var i = 0; i < steps.length; i++) if (steps[i].k === stepKey) return i;
    }
    for (var j = 0; j < steps.length; j++) if (!stepDone(it, steps[j].k)) return j;
    return steps.length - 1;
  }

  function stepBar(it, idx) {
    var steps = stepsFor(it);
    return '<div class="sw-steps">' + steps.map(function (st, i) {
      var needs = stepNeeds(it, st.k), done = !needs.length;
      return '<button class="sw-step' + (i === idx ? " on" : "") + (done ? " done" : " need") +
        '" data-act="gostep" data-s="' + st.k + '">' +
        '<span class="sw-step-dot">' + (done ? "✓" : String(i + 1)) + "</span>" +
        "<span>" + esc(st.label) + (done || st.k === "notes" ? "" : '<b class="sw-step-count">' + needs.length + "</b>") + "</span></button>";
    }).join("") + "</div>";
  }

  /* ---------------- step 1: the photograph ----------------
     The photograph is evidence and context for the builder, printed
     beside the drawing. Nothing is measured on it any more (v0.9.51). */
  function photoStep(it) {
    var ov = it.overlay;
    var hasPhoto = !!(ov && ov.thumb);
    var h = '<div class="sw-step-body' + (hasPhoto ? " has-stage" : "") + '">';
    if (!hasPhoto) {
      h += '<h2 class="sw-step-h">Photograph the opening</h2>' +
        '<p class="sw-step-p">Straight on where you can. This is the picture the builder sees beside the drawing.</p>' +
        '<label class="tech-photo-button required-photo big">' +
        "<span>▣ Take the photo</span>" +
        '<input type="file" accept="image/*" capture="environment" data-act="markphotoin"></label>';
      if (it.photos.length) h += extraThumbs(it);
      return h + "</div>";
    }
    var full = (markFull.id === ov.photoId && markFull.url) ? markFull.url : ov.thumb;
    h += '<h2 class="sw-step-h">Opening photographed</h2>' +
      '<p class="sw-step-p">Add a related photo if something is worth showing — a stub, a vent, the panel next door. Mark up any photo with arrows and words.</p>';
    h += '<div class="sw-photo-main"><img src="' + esc(full) + '" alt="Opening">' + SW.markupSvg(SW.markupOf(mainPhoto(it))) + "</div>";
    h += '<div class="sw-step-acts">';
    h += '<button class="button ghost" data-act="markup" data-p="' + esc(ov.photoId) + '">✎ Mark up this photo</button>';
    h += '<label class="button ghost sw-mark-file">Retake the opening photo' +
      '<input type="file" accept="image/*" capture="environment" data-act="markphotoin"></label>';
    var mainIdx = it.photos.map(function (p) { return p.id; }).indexOf(ov.photoId);
    if (mainIdx >= 0) h += '<button class="button ghost sw-danger-link" data-act="delphoto" data-i="' + mainIdx + '">Delete this photo</button>';
    h += '<label class="button ghost sw-mark-file">＋ Related photo' +
      '<input type="file" accept="image/*" capture="environment" data-act="photoin"></label>';
    h += "</div>";
    h += extraThumbs(it);
    return h + "</div>";
  }
  function mainPhoto(it) {
    var id = it.overlay && it.overlay.photoId;
    return it.photos.filter(function (p) { return p.id === id; })[0] || null;
  }
  function extraThumbs(it) {
    var ov = it.overlay || {};
    var rest = it.photos.filter(function (p) { return p.id !== ov.photoId; });
    if (!rest.length) return "";
    return '<div class="sw-thumbs" style="margin-top:12px">' + rest.map(function (p) {
      var i = it.photos.indexOf(p);
      return '<figure class="sw-thumb"><span class="sw-thumb-pic"><img src="' + p.thumb + '" alt="Site photo">' + SW.markupSvg(SW.markupOf(p)) + "</span>" +
        '<button class="sw-thumb-x" data-act="delphoto" data-i="' + i + '" aria-label="Delete photo">×</button>' +
        '<button class="sw-thumb-mark" data-act="markup" data-p="' + esc(p.id) + '">✎ ' + (SW.hasMarkup(p) ? "Edit marks" : "Mark up") + "</button></figure>";
    }).join("") + "</div>";
  }

  /* The photograph with whatever is known drawn on it. `activeKey` is the
     connection being placed right now; null means corner-tapping. */
  /* A neighbouring cabinet the office drew a connection in: photographed
     and framed exactly like the opening — four corners of its back wall —
     so the drawn box overlays and the pin reads in inches. */


  /* ---------------- step 2: measurements ---------------- */
  function measureStep(it) {
    var h = '<div class="sw-step-body">';
    if (SW.basisPending(it)) return h + basisCard(it) + "</div>";
    if (it.notReady) return h + notReadyCard(it) + "</div>";

    var dims = SW.dimsFor(it);
    if (openDim === null) advance(it);
    h += mergeCard(it);
    h += formPicker(it);
    h += '<h2 class="sw-step-h">' + esc(SW.formOf(it).k === "hood" ? "Measure the hood location" : SW.formOf(it).k === "shroud" ? "Measure the shroud and its cutout" : SW.formOf(it).k === "cooktop" || SW.formOf(it).k === "grill" ? "Measure the cutout" : "Measure the opening") + ' <em>' + SW.dimsAnswered(it) + " of " +
      SW.needsDims(it) + (it.multiPoint ? " · irregular" : "") + "</em></h2>";
    h += '<div class="sw-dims">' + dims.map(function (d, i) { return dimRow(it, d, i); }).join("") + "</div>";
    /* the switches that are on stay in view; the rest wait behind More… (v0.9.59) */
    var onActs = (it.planes4 ? '<button class="button ghost" data-act="toggle4">− Drop the cleat measurement</button>' : "") +
      (SW.flushOn(it) ? '<button class="button ghost" data-act="toggleflush">− Flush inset details</button>' : "") +
      (SW.swingOn(it) ? '<button class="button ghost" data-act="toggleswing">− Door clearance</button>' : "");
    if (onActs) h += '<div class="sw-step-acts">' + onActs + "</div>";
    h += '<p class="sw-hint">Tap the big green number if it is on spec. The pad is there for anything else — you should not need the keyboard.</p>';
    h += hoodStage(it);
    h += formCard(it);
    h += flushCard(it);
    h += swingCard(it);
    h += obstructionCard(it);
    h += prepCard(it);
    h += conflictCard(it);
    /* already raised: stays in view */
    if (SW.specDoubtOf(it)) h += specDoubtCard(it);
    if (it.notReady) h += notReadyCard(it);
    var moreOn = !!moreOpen[it.id];
    var offActs = (it.planes4 ? "" : '<button class="button ghost" data-act="toggle4">＋ Cleat or finished return</button>') +
      (SW.flushOn(it) || (SW.flushLikely(it) && !(it.flush && it.flush.touched)) ? "" : '<button class="button ghost" data-act="toggleflush">＋ Flush inset details</button>') +
      (SW.swingOn(it) ? "" : '<button class="button ghost" data-act="toggleswing">＋ Door clearance</button>');
    h += '<div class="sw-section sw-section-more"><button class="sw-more' + (moreOn ? " open" : "") + '" data-act="moreopen">' + (moreOn ? "− Less" : "More on this opening…") + (moreOn ? "" : " <em>cleats · flush inset · door clearance · spec looks wrong · could not measure</em>") + "</button>";
    if (moreOn) {
      h += '<div class="sw-step-acts">' + offActs + "</div>";
      if (!SW.specDoubtOf(it)) h += specDoubtCard(it);
      if (!it.notReady) h += notReadyCard(it);
    }
    h += "</div>";
    return h + "</div>";
  }

  /* What the cabinet shop was asked to build first — cleats, cutouts,
     clearances, vent paths — drawn by the office off the sheet. Three taps
     per item; a miss carries the numbers to the builder. */
  function prepCard(it) {
    var list = it.prep || [];
    if (!list.length) return "";
    var model = SW.roughInModel(it);
    var h = '<div class="sw-section"><span class="sw-label">Cabinet prep <em>' + list.filter(function (pr) { return SW.prepState(it, pr.id); }).length + " of " + list.length + " checked</em></span>";
    if (model && model.strips && model.strips.length) {
      /* cleats and blocking are solids at their own depth: the box shows
         them standing proud of the walls, which a flat face cannot */
      var bm = SW.boxModel(it, []);
      h += '<div class="sw-prep-draw box">' + (bm ? SW.boxSvg(bm, boxView, { width: "100%" }) : "") + "</div>";
    } else if (model && model.marks.some(function (m) { return m.prep; })) {
      var planes = ["opening"]; model.marks.forEach(function (m) { if (planes.indexOf(m.plane) < 0) planes.push(m.plane); });
      h += '<div class="sw-prep-draw">' + SW.roughInSvg(model, { planes: planes, width: "100%", dims: false }) + "</div>";
    }
    list.forEach(function (pr) {
      var kd = SW.prepKind(pr.kind), st = SW.prepState(it, pr.id), ck = it.prepChecks[pr.id] || {};
      h += '<div class="card card-pad sw-prep-item"><div class="sw-prep-head"><i style="background:' + esc(kd.color) + '"></i><strong>' + esc(pr.label || kd.label) + needPill(!st) + "</strong></div>" +
        '<p class="sw-prep-text">' + esc(SW.prepText(pr, it)) + "</p>" +
        '<div class="tech-quick-rating three">' + SW.PREP_STATES.map(function (ps) {
          return '<button class="' + ps.tone + " " + (st === ps.k ? "selected" : "") + '" data-act="prepstate" data-p="' + esc(pr.id) + '" data-v="' + ps.k + '">' + esc(ps.label) + "</button>";
        }).join("") + "</div>" +
        (SW.isStrip(pr) && st && st !== "missing" ? stripMeasure(it, pr, ck) : "") +
        (st === "wrong" ? '<input class="sw-input" data-prepnote="' + esc(pr.id) + '" value="' + esc(ck.note || "") + '" placeholder="What is there instead — 2\" short, 1\" too far left…" style="margin-top:8px">' : "") +
        "</div>";
    });
    var inter = SW.stripInterior(it);
    if (inter && inter.clear != null) {
      h += '<p class="sw-hint sw-strip-interior"><strong>Between the cleats: ' + esc(SW.fmtIn(inter.clear)) + '</strong> — the ' + esc(SW.fmtIn(inter.w)) + " opening less " + esc(SW.fmtIn(inter.left)) + " on the left and " + esc(SW.fmtIn(inter.right)) + " on the right. The unit body has to fit this, with its reveals.</p>";
    }
    return h + "</div>";
  }
  /* The tape on a cleat, return or block: set back, thick, run — each
     against the sheet's number — and finished or not. One row of keypad
     buttons; the verdict writes itself in the findings. */
  function stripMeasure(it, pr, ck) {
    var s = SW.stripOf(pr), meas = (ck && ck.meas) || {}, fin = SW.prepFoundFinished(it, pr.id);
    var h = '<div class="sw-strip-meas">';
    h += '<div class="sw-flush-grid">' + SW.stripMeasFor(pr).map(function (m) {
      var want = SW.stripTarget(it, pr, m.k), got = SW.num(meas[m.k]);
      var off = want != null && got != null && Math.abs(got - want) > 1 / 8 + 1e-9;
      return '<button class="sw-flush-f' + (got != null ? " set" : "") + (off ? " off" : "") + '" data-act="keypad" data-dim="prep:' + esc(pr.id) + ":" + m.k + '">' +
        "<span>" + esc(m.label) + (want != null ? (SW.panelShift(it, pr, m.k) ? " · " + esc(SW.fmtIn(want)) + " for this panel" : " · sheet " + esc(SW.fmtIn(want))) : "") + "</span>" +
        "<strong>" + (got != null ? esc(SW.fmtIn(got)) : "—") + "</strong></button>";
    }).join("") + "</div>";
    h += '<div class="tech-chips sw-strip-fin"><span class="sw-mini-label">Finish</span>' +
      '<button class="tech-chip' + (fin === "yes" ? " on" : "") + '" data-act="prepfin" data-p="' + esc(pr.id) + '" data-v="yes">Finished to match</button>' +
      '<button class="tech-chip' + (fin === "no" ? " on" : "") + '" data-act="prepfin" data-p="' + esc(pr.id) + '" data-v="no">Unfinished</button>' +
      (SW.prepFinished(pr) ? '<em class="sw-hint">the sheet wants it finished — it shows beside the door</em>' : '<em class="sw-hint">hidden behind the unit — finish does not matter</em>') + "</div>";
    return h + "</div>";
  }

  /* The remedy for a wrong number on the office side (the showroom warming
     drawer typed at 29 3/4 when the sheet says 28 1/2): the tech says so
     here, the opening goes to Verify with nothing on the builder's list,
     the office corrects or confirms the sheet, and the packet is a draft
     until it does. */
  var SPEC_DOUBTS = ["Opening looks right — spec number is off", "Spec is the unit size, not the cutout", "Wrong install detail picked", "Other"];
  function specDoubtCard(it) {
    var d = SW.specDoubtOf(it);
    var h = '<div class="sw-section"><span class="sw-label">Spec looks wrong? <em>send it back to the office</em></span>';
    if (d) {
      return h + '<div class="card card-pad sw-notready"><span class="badge warning">Under review by the office · ' + esc(d.note) + "</span>" +
        "<p>Measure it anyway. This opening prints as Verify with no builder items until the office confirms or corrects the sheet.</p>" +
        '<button class="button small ghost" data-act="cleardoubt">The spec is fine after all</button></div></div>';
    }
    return h + '<div class="tech-chips">' + SPEC_DOUBTS.map(function (r) {
      return '<button class="tech-chip" data-act="specdoubt" data-r="' + esc(r) + '">' + esc(r) + "</button>";
    }).join("") + "</div></div>";
  }

  /* ---------------- the measuring sheet ----------------
     Which form this opening is walked on. Guessed from the category; one
     tap changes it. The form relabels the axes above and adds its own
     fields and checks below. */
  function formPicker(it) {
    var cur = SW.formKeyFor(it);
    if (!formPickOpen) {
      var f0 = SW.FORMS[cur] || SW.FORMS.standard;
      return '<div class="sw-formpick compact"><span>Measuring as <strong>' + esc(f0.short || f0.label) + '</strong></span><button class="sw-link" data-act="formpick">change</button></div>';
    }
    return '<div class="sw-formpick"><span>Measuring as</span><div class="tech-chips">' + SW.FORM_KEYS.map(function (k) {
      var f = SW.FORMS[k];
      return '<button class="tech-chip' + (cur === k ? " on" : "") + '" data-act="form" data-v="' + k + '">' + esc(f.short || f.label) + "</button>";
    }).join("") + "</div></div>";
  }
  /* The hood over the cooking surface: an elevation with the hood (or the
     shroud and its insert) placed from the readings — the height above
     the cooking surface typed in the Height row above, the centre offset
     typed below. Nothing to drag (v0.9.81). A chip row says which kind of
     ventilation this is: a finished hood, or a custom shroud taking an
     insert — and what cooks under it. */
  function hoodStage(it) {
    var w = walk(), m = SW.hoodModel(it, w);
    if (!m) return "";
    var sp = m.spec, isShroud = m.form === "shroud";
    var under = sp.under;
    var h = '<div class="sw-section sw-hood-wrap"><span class="sw-label">' + (isShroud ? "The shroud and its insert over the cooking surface" : "The hood over the cooking surface") +
      " <em>placed from your readings</em></span>" +
      '<div class="sw-adj-side"><span>This is:</span>' +
      '<button class="tech-chip' + (!isShroud ? " on" : "") + '" data-act="hoodkind" data-v="hood">Finished hood</button>' +
      '<button class="tech-chip' + (isShroud ? " on" : "") + '" data-act="hoodkind" data-v="shroud">Custom shroud + insert</button></div>' +
      '<div class="sw-adj-side"><span>Under it:</span>' + SW.HOOD_UNDER.map(function (u) {
        return '<button class="tech-chip' + (under === u.k ? " on" : "") + '" data-act="hoodunder" data-v="' + u.k + '">' + esc(u.label) + "</button>";
      }).join("") + (sp.cooking ? '<small class="sw-muted">' + esc(sp.cooking.title) + " on this walk, " + esc(SW.fmtIn(sp.cookW)) + " wide</small>" : "") + "</div>" +
      '<div class="sw-hood-stage">' + SW.hoodSvg(m, { width: "100%" }) + "</div>";
    if (!m.placed) {
      h += '<p class="sw-draw-key"><strong>Type the ' + (isShroud ? "shroud bottom above the cooking surface" : "height above the cooking surface") + "</strong> in the row above and the " +
        (isShroud ? "shroud" : "hood") + " is placed there" + (sp.bandMin != null ? " — the sheet wants " + esc(SW.fmtIn(sp.bandMin)) + (sp.bandMax != null ? "–" + esc(SW.fmtIn(sp.bandMax)) : " or more") : "") + ".</p>";
    } else {
      h += '<p class="sw-draw-key">' + (m.ceiling == null ? "Type <strong>Countertop to ceiling</strong> below for the ceiling. " : "") +
        (!isShroud && m.space == null ? "Type the <strong>width available</strong> above for the wall cabinets. " : "") +
        "Bottom: <strong>" + esc(SW.fmtIn(m.bottom)) + "</strong> above the cooking surface" + (m.inBand === false ? ' <b style="color:#c8341f">— outside the sheet\'s band</b>' : m.inBand ? ' <b style="color:#1f9d55">— on the sheet</b>' : "") +
        (m.toCeiling != null ? " · <strong>" + esc(SW.fmtIn(Math.max(0, m.toCeiling))) + "</strong> from the top to the ceiling" : "") +
        (Math.abs(m.offset) >= 1 / 16 ? " · <strong>" + esc(SW.fmtIn(Math.abs(m.offset))) + "</strong> off centre to the " + (m.offset > 0 ? "right" : "left") : " · centred") + "</p>";
    }
    if (isShroud) {
      var f = it.form || {};
      h += '<div class="sw-hood-stage sw-shroud-plan-wrap">' + SW.shroudPlanSvg(m, { width: "100%", ductOff: f.ductOff, ductDia: f.ductDia }) + "</div>" +
        '<p class="sw-draw-key">The cutout is the <strong>width</strong> and <strong>depth</strong> rows above; the sheet\'s cutout is dashed. ' +
        (m.shroud.cutOk === false || m.shroud.cutDOk === false ? '<b style="color:#c8341f">The cutout is under the sheet\'s size — the insert will not drop in.</b> ' : "") +
        (m.shroud.innerOk === false ? '<b style="color:#c8341f">The shroud is not tall enough inside for the insert.</b> ' : "") +
        (m.shroud.wideOk === false ? '<b style="color:#c8341f">The shroud is narrower than the cooking surface.</b> ' : "") + "</p>";
    }
    h += "</div>";
    return h;
  }
  function formCard(it) {
    var f = SW.formOf(it);
    if (!f.fields.length && !f.checks.length) return "";
    var h = '<div class="sw-section sw-form"><span class="sw-label">' + esc(f.label) + " <em>" + (SW.formAnswered(it) ? "checked" : "its own readings and checks") + "</em></span>";
    if (f.fields.length) {
      /* v0.9.82: the readings that place and size the thing first; the ones
         that are usually standard (counter at 36, cabinets at 18) sit behind
         one tap unless somebody has already typed them. */
      var shown = f.fields.filter(function (fd) { return !fd.more || moreFields[it.id] || SW.formVal(it, fd.k) != null; });
      var tucked = f.fields.filter(function (fd) { return shown.indexOf(fd) < 0; });
      h += '<div class="sw-flush-grid">' + shown.map(function (fd) {
        var v = SW.formVal(it, fd.k), min = SW.formFieldMin(it, fd), vd = SW.formFieldVerdict(it, fd);
        var side = fd.signed ? ((it.form || {})[fd.k + "Side"] || "right") : "";
        return '<button class="sw-flush-f' + (v != null ? " set" : "") + (vd && vd.state === "bad" ? " bad" : "") + '" data-act="keypad" data-dim="form:' + fd.k + '">' +
          "<span>" + esc(fd.label) + (min != null ? " · spec " + esc(SW.fmtIn(min)) + " min" : (fd.maxIn != null ? " · " + esc(SW.fmtIn(fd.maxIn)) + " max" : "")) + "</span>" +
          "<strong>" + (v != null ? esc(SW.fmtIn(v)) + (fd.signed && v ? " to the " + side : "") : (fd.hint ? "<small>" + esc(fd.hint) + "</small>" : "—")) + "</strong>" +
          (vd ? '<em class="v-' + vd.state + '">' + esc(vd.text) + "</em>" : "") + "</button>" +
          (fd.signed && v ? '<div class="sw-adj-side sw-form-side"><span>Off centre to the:</span>' +
            '<button class="tech-chip' + (side === "left" ? " on" : "") + '" data-act="formside" data-k="' + fd.k + '" data-v="left">Left</button>' +
            '<button class="tech-chip' + (side === "right" ? " on" : "") + '" data-act="formside" data-k="' + fd.k + '" data-v="right">Right</button></div>' : "");
      }).join("") + "</div>";
      if (tucked.length) {
        h += '<button class="sw-more-fields" data-act="morefields"><span>More readings</span><small>' +
          esc(tucked.map(function (fd) { return fd.label.toLowerCase(); }).join(" · ")) + "</small></button>";
      }
    }
    if (f.checks.length) {
      h += '<div class="sw-form-checks">' + f.checks.map(function (c) {
        var a = SW.formCheck(it, c.k);
        return '<div class="sw-form-check' + (a ? " answered" : "") + (a === "no" ? " bad" : "") + '"><p>' + esc(c.q) + needPill(!a) + "</p>" +
          '<div class="tech-quick-rating three">' + SW.CHECK_ANSWERS.map(function (x) {
            return '<button class="' + x.tone + (a === x.k ? " selected" : "") + '" data-act="formcheck" data-k="' + c.k + '" data-v="' + x.k + '">' + esc(x.label) + "</button>";
          }).join("") + "</div>" +
          (a === "no" ? '<span class="sw-form-fix">' + esc(c.fix) + " <b>" + esc(SW.ownerOf(c.owner || "builder").label) + "</b></span>" : "") + "</div>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }

  /* ---------------- a merged opening ----------------
     The units, left to right, the required width and where it came from,
     and the join kit. The kit is Wilson's accessory: not ordered is a
     Wilson item, never the builder's. */
  function mergeCard(it) {
    if (!SW.isMerge(it)) return "";
    var units = SW.mergeUnits(it), n = units.length, ks = SW.kitState(it);
    var h = '<div class="sw-section sw-merge"><span class="sw-label">Merged opening <em>' + n + " units, one cavity</em></span>" +
      '<div class="sw-merge-units">' + units.map(function (u, i) {
        return '<div class="sw-merge-unit"><span class="sw-merge-pos">' + esc(SW.unitPos(i, n)) + "</span>" +
          "<strong>" + esc(u.model || u.appliance || "Unit " + (i + 1)) + "</strong>" +
          "<span>" + esc(u.appliance || "") + (SW.num(u.spec && u.spec.w) != null ? " · " + esc(SW.fmtIn(SW.num(u.spec.w))) + " W" : "") + "</span>" +
          '<span class="sw-merge-move">' +
          (i > 0 ? '<button data-act="unitmove" data-i="' + i + '" data-d="-1" aria-label="move left">◂</button>' : "") +
          (i < n - 1 ? '<button data-act="unitmove" data-i="' + i + '" data-d="1" aria-label="move right">▸</button>' : "") +
          "</span></div>";
      }).join("") + "</div>" +
      '<p class="sw-hint">' + esc(SW.mergeWidthText(it)) + "</p>" +
      /* which way each door hinges: it picks the Sub-Zero kit and the Monogram gap (v0.9.69) */
      '<span class="sw-sublabel" style="margin-top:12px">Door hinges</span>' +
      '<div class="sw-merge-hinges">' + units.map(function (u, i) {
        return '<div class="sw-merge-hinge"><span>' + esc(SW.unitPos(i, n)) + " · " + esc(u.model || "unit " + (i + 1)) + "</span><div>" + SW.HINGE_SIDES.map(function (hs) {
          return '<button class="tech-chip' + (u.hinge === hs.k ? " on" : "") + '" data-act="unithinge" data-i="' + i + '" data-v="' + hs.k + '">' + (hs.k === "left" ? "◀ " : "") + esc(hs.label) + (hs.k === "right" ? " ▶" : "") + "</button>";
        }).join("") + "</div></div>";
      }).join("") + "</div>" +
      (SW.mergeNotes(it).length ? '<ul class="sw-merge-notes">' + SW.mergeNotes(it).map(function (nt) { return "<li>" + esc(nt) + "</li>"; }).join("") + "</ul>" : "") +
      '<span class="sw-sublabel" style="margin-top:12px">Join / merge kit' + (SW.mergeKitHint(it) ? " <em>" + esc(SW.mergeKitHint(it)) + "</em>" : "") + "</span>" +
      '<div class="tech-quick-rating four">' + SW.KIT_STATES.map(function (k) {
        return '<button class="' + k.tone + (ks === k.k ? " selected" : "") + '" data-act="kit" data-v="' + k.k + '">' + esc(k.label) + "</button>";
      }).join("") + "</div>" +
      (ks === "missing" ? '<p class="sw-hint">Goes on the Wilson prep page as an order item — the builder never sees it.</p>' : "") +
      '<div class="sw-pad-foot" style="margin-top:10px"><button class="button ghost small" data-act="unmerge">Unmerge — back to ' + n + " openings</button></div></div>";
    return h;
  }

  /* ---------------- flush inset: what the panel sits against ----------------
     Width and height are the finished opening. The cleats, the header and
     the platform are what a flush panel actually meets, and the notes
     describe them on every flush job: size and how far back from the face
     frame. The side setback is also the fourth plane the verdicts score. */
  function flushCard(it) {
    if (!SW.flushOn(it)) {
      if (SW.flushLikely(it) && !(it.flush && it.flush.touched)) {
        return '<div class="sw-section sw-flush-nudge"><span class="sw-label">Flush inset</span>' +
          '<p class="sw-hint">This install is flush. Record the cleats, header and platform so the cabinet shop gets numbers, not adjectives.</p>' +
          '<button class="button secondary small" data-act="toggleflush">Record the flush details</button></div>';
      }
      return "";
    }
    var f = SW.flushOf(it), spec = SW.num(it.spec && it.spec.c);
    /* the side cleats live under Cabinet prep once the office drew them as
       strips — one place for the tape, not two */
    var hasStrips = (it.prep || []).some(function (pr) { return SW.isStrip(pr) && pr.kind !== "blocking"; });
    var fields = SW.FLUSH_FIELDS.filter(function (fd) { return !(hasStrips && (fd.k === "sideSize" || fd.k === "sideSetback")); });
    var h = '<div class="sw-section sw-flush"><span class="sw-label">Flush inset <em>' + (SW.flushText(it) ? "recorded" : hasStrips ? "header, platform, interior — the cleats are under Cabinet prep" : "size and setback") + "</em></span>" +
      '<div class="sw-flush-grid">' + fields.map(function (fd) {
        var v = SW.num(f[fd.k]);
        var isSetback = fd.k === "sideSetback" && spec != null;
        return '<button class="sw-flush-f' + (v != null ? " set" : "") + '" data-act="keypad" data-dim="flush:' + fd.k + '">' +
          "<span>" + esc(fd.label) + (isSetback ? " · spec " + esc(SW.fmtIn(spec)) : "") + "</span>" +
          "<strong>" + (v != null ? esc(SW.fmtIn(v)) : (fd.hint ? "<small>" + esc(fd.hint) + "</small>" : "—")) + "</strong></button>";
      }).join("") + "</div>" +
      '<p class="sw-hint">Setbacks are from the face frame. A 3/4" panel usually wants the cleat recessed 7/8"–1"; the drawing says which.</p></div>';
    return h;
  }
  /* ---------------- door clearance ----------------
     "hinges right only — not enough room on the left for the door to open."
     The number beside the hinge side, and whether the spec has a minimum. */
  function swingCard(it) {
    if (!SW.swingOn(it)) return "";
    var sw = SW.swingOf(it), c = SW.num(sw.clearanceIn), min = SW.swingMin(it);
    var f = SW.swingFinding(it);
    return '<div class="sw-section sw-swing"><span class="sw-label">Door clearance' + (min != null ? " <em>spec " + esc(SW.fmtIn(min)) + " minimum</em>" : "") + "</span>" +
      '<div class="sw-swing-row"><span>Hinge side</span><div class="tech-quick-rating two">' + SW.SWING_SIDES.map(function (sd) {
        return '<button class="' + (sw.hinge === sd.k ? "selected" : "") + '" data-act="swinghinge" data-v="' + sd.k + '">' + esc(sd.label) + "</button>";
      }).join("") + "</div></div>" +
      '<div class="sw-swing-row"><span>Wall or obstruction on the</span><div class="tech-quick-rating two">' + SW.SWING_SIDES.map(function (sd) {
        return '<button class="' + (sw.wallSide === sd.k ? "selected" : "") + '" data-act="swingwall" data-v="' + sd.k + '">' + esc(sd.label) + "</button>";
      }).join("") + "</div></div>" +
      '<div class="sw-pad-foot"><button class="button ghost small" data-act="keypad" data-dim="swing">' +
      (c != null ? esc(SW.fmtIn(c)) + " beside the door" : "Distance beside the door") + "</button></div>" +
      (f ? '<p class="sw-hint' + (f.kind === "fix" ? " bad" : "") + '">' + esc(f.text) + "</p>" : "") +
      "</div>";
  }

  /* ---------------- connections outside the opening -----------------------
     The Cove pattern. The sheet says "electrical location in adjacent
     cabinet", so the opening photograph has nothing to say about it. The
     flow: open the adjacent cabinet, photograph it, drop one pin per
     connection, then sign each off. The pin locates — it does not measure,
     because there is no calibrated plane in a sink cabinet — and the packet
     says exactly that. */

  /* ---------------- steps 3–5: the connections ----------------
     v0.9.51: the placement surface is the drawing the office made — the
     opening with the cabinets around it, the sheet's zones in colour —
     not the photograph. Tap a plane to drop the pin where the connection
     actually is, nudge or type the inches, then answer. The tool no
     longer computes how far anything has to move; the drawing shows the
     pin against the sheet's area and the answer is the tech's. */
  var pinKey = null;           /* the connection being placed on the drawing */
  var drawZoom = { z: 1, x: 0, y: 0 };
  var boxView = { yaw: SW.BOX_VIEW.yaw, pitch: SW.BOX_VIEW.pitch };
  var flatView = false;        /* the 2D elevation instead of the box */
  /* The face the tech chose to place on: "" lets the tap decide. Zoomed
     into a corner, a tap near the edge of the back wall could land on the
     side wall or the top; choosing the face first takes the guess out
     (Cayden, 21 Oct). */
  var faceLock = "";
  var faceLockFor = null;      /* the connection the choice was made for */
  var boxFull = false;         /* the stage filling the screen, page scroll locked (Cayden, 21 Oct) */
  var hiddenPlanes = {};       /* itemId → {plane: true}: neighbour cabinets the tech set aside, this session */
  var FACE_CHIPS = [["opening", "Back wall"], ["floor", "Floor"], ["ceiling", "Top"], ["wall-left", "Left wall"], ["wall-right", "Right wall"]];
  function faceFor(it, u) {
    if (!u) return "";
    if (faceLockFor !== u.key) { faceLockFor = u.key; faceLock = u.zone ? SW.utilPlane(u) : ""; }
    return faceLock;
  }
  function groupPlanes(it, list) {
    var planes = ["opening"];
    list.forEach(function (u) {
      var pk = SW.utilPlane(u);
      if (pk && planes.indexOf(pk) < 0 && SW.PLANE_DEFAULT[pk]) planes.push(pk);
    });
    (it.prep || []).forEach(function (pr) { var pk = SW.prepPlane(pr); if (planes.indexOf(pk) < 0 && SW.PLANE_DEFAULT[pk]) planes.push(pk); });
    /* a dishwasher always has its sink cabinet beside it on the drawing */
    if (SW.isDishwasherish(it) && planes.indexOf("adjacent") < 0) planes.push("adjacent");
    /* cabinets the tech added to the run on site */
    Object.keys(it.planePhotos || {}).forEach(function (pk) { if (it.planePhotos[pk] && it.planePhotos[pk].added && planes.indexOf(pk) < 0 && SW.PLANE_DEFAULT[pk]) planes.push(pk); });
    var hid = hiddenPlanes[it.id] || {};
    /* no cabinet under a product that stands on the floor, whatever old data says */
    return planes.filter(function (pk) { return !hid[pk] && SW.planeAllowed(it, pk); });
  }
  /* what the sheet put in a neighbour cabinet, in words: "Water (W), Cutout (CU)" */
  function planeMarksText(it, pk) {
    var ri = SW.roughInModel(it);
    if (!ri) return "";
    return (ri.marks || []).filter(function (m) { return m.plane === pk; }).map(function (m) {
      var tag = m.tag || (m.group || "?").charAt(0).toUpperCase();
      return (m.label || m.group) + " (" + tag + ")" + (m.any ? ", anywhere" : "");
    }).join(", ");
  }
  function activePinFor(it, list) {
    if (pinKey && list.some(function (u) { return u.key === pinKey && SW.utilityIsMarkable(it, u); })) return pinKey;
    var next = list.filter(function (u) {
      return SW.utilityIsMarkable(it, u) && !SW.markAt(it, u.key) && it.utilities[u.key] !== "missing" && it.utilities[u.key] !== "na";
    })[0];
    return next ? next.key : null;
  }
  function boxSizeText(it) {
    var pl = SW.planeSize(it), d = SW.depthIn(it);
    return pl ? SW.fmtIn(pl.w) + " × " + SW.fmtIn(pl.h) + (d ? " × " + SW.fmtIn(d) + " deep" : "") : "";
  }
  function stageSvg(it, planes, active) {
    if (flatView) { var m2 = SW.roughInModel(it); return m2 ? SW.roughInSvg(m2, { planes: planes, width: "100%", activePin: active }) : ""; }
    var model = SW.boxModel(it, planes.filter(function (k) { return k !== "opening"; }));
    var au = active ? SW.utilByKey(it, active) : null;
    return model ? SW.boxSvg(model, boxView, { width: "100%", activePin: active, interactive: true, lockFace: au ? faceFor(it, au) : "" }) : "";
  }
  /* the row of faces to place on; neighbour cabinets join it once drawn */
  function faceChips(it, planes, u) {
    if (!u || flatView) return "";
    var lock = faceFor(it, u), drawn = u.zone ? SW.utilPlane(u) : "";
    var chips = [["", "Auto"]].concat(FACE_CHIPS, planes.filter(function (k) { return k !== "opening"; }).map(function (k) { return [k, k === "adjacent" ? "Sink cabinet" : "Cabinet " + k]; }));
    return '<div class="sw-draw-faces"><span>Place on:</span>' + chips.map(function (c) {
      return '<button class="tech-chip' + (lock === c[0] ? " on" : "") + '" data-act="facelock" data-plane="' + c[0] + '">' + esc(c[1]) + (drawn && c[0] === drawn ? " ✎" : "") + "</button>";
    }).join("") + "</div>";
  }
  /* Is there a run to build — neighbour cabinets drawn by the office or
     added on site, or a dishwasher with its sink cabinet? Then the
     Cabinets step exists and the add / hide / remove controls live there,
     and only there (Cayden, 23 Oct: "the options to add or remove
     cabinets still exist in all sections"). */
  function hasRun(it) {
    if (!SW.planeSize(it)) return false;
    if (SW.formKeyFor(it) === "hood") return false;        /* a hood has no cavity and no run — its elevation is on Measure */
    return true;                                            /* every drawn opening: the step is done by default unless a dishwasher */
  }
  function drawingStage(it, list, active, reachOnly, runControls) {
    if (!SW.roughInModel(it)) return '<p class="sw-hint">No opening size on this one yet — type the width and height on the Measure step and the drawing appears here.</p>';
    var planes = groupPlanes(it, list);
    var au = active ? SW.utilByKey(it, active) : null;
    var ADD = { left: "cabinet left", right: "cabinet right", above: "cabinet above", below: "cabinet below", left2: "2nd cabinet left", right2: "2nd cabinet right" };
    if (!SW.planeAllowed(it, "below")) delete ADD.below;     /* nothing under a fridge, a range, a dishwasher */
    function planeLabel(pk) { return ADD[pk] || SW.planeWord(it, pk); }
    var reachWords = planes.filter(function (k) { return k !== "opening"; }).map(function (k) { return SW.planeWord(it, k); });
    var bar = runControls ? "The run as you see it — add or set aside cabinets below; the connections are placed on the next steps"
      : au ? "Tap where the <strong>" + esc(SW.utilLabel(au).toUpperCase()) + "</strong> actually is"
      : reachOnly ? "Nothing to place on this step — the sheet asks for these anywhere in the " + esc(reachWords.join(" / ") || "cabinet beside") + " (shaded)"
      : "Every connection on this step is placed — tap a pin's <em>Re-place</em> to move it";
    var h = '<div class="sw-draw-wrap' + (active ? " placing" : "") + (flatView ? " flat" : " box") + (boxFull ? " full" : "") + '">' +
      '<div class="sw-draw-bar"><span>' + bar + "</span>" +
      '<span class="sw-draw-zoom"><button data-act="drawflat">' + (flatView ? "3D" : "Flat") + '</button><button data-act="drawzoom" data-v="out" aria-label="Zoom out">−</button><button data-act="drawzoom" data-v="fit">fit</button><button data-act="drawzoom" data-v="in" aria-label="Zoom in">+</button>' +
      '<button data-act="drawfull" aria-label="' + (boxFull ? "Leave full screen" : "Full screen") + '">' + (boxFull ? "✕ Done" : "⤢") + "</button></span></div>" +
      faceChips(it, planes, au) +
      '<div class="sw-draw-stage" data-act="drawtap" data-u="' + esc(active || "") + '">' +
      '<div class="sw-draw-pan" style="transform:translate(' + drawZoom.x + "px," + drawZoom.y + "px) scale(" + drawZoom.z + ')">' + stageSvg(it, planes, active) + "</div>" +
      (flatView ? "" : '<div class="sw-draw-turn" aria-label="Turn the cabinet"><button data-act="drawturn" data-v="u" aria-label="Look down into it">▲</button><button data-act="drawturn" data-v="l" aria-label="Turn to the left">◀</button><button data-act="drawturn" data-v="r" aria-label="Turn to the right">▶</button><button data-act="drawturn" data-v="d" aria-label="Look up under it">▼</button></div>') +
      "</div>" +
      '<p class="sw-draw-key">' + (flatView ? "" : "<strong>" + esc(boxSizeText(it)) + "</strong> · Drag or the arrows turn it; pinch to zoom in, then drag to slide. ") + '<i class="z"></i> where the sheet puts it &nbsp; <i class="p"></i> found at the walk &nbsp; <i class="b"></i> found, but missing or in the wrong place &nbsp; <i class="m"></i> W, H, D as measured; red is out of spec, with the figure to build to</p>';
    if (!runControls) return h + "</div>";
    /* the run: add the cabinet next door when the office drew nothing there */
    /* the second cabinet over is offered once the first is on the drawing */
    var addable = Object.keys(ADD).filter(function (pk) { return planes.indexOf(pk) < 0 && (!/2$/.test(pk) || planes.indexOf(pk.replace(/2$/, "")) >= 0); });
    var added = planes.filter(function (pk) { return it.planePhotos && it.planePhotos[pk] && it.planePhotos[pk].added; });
    var drawn = planes.filter(function (pk) { return pk !== "opening" && added.indexOf(pk) < 0; });
    var hid = Object.keys(hiddenPlanes[it.id] || {}).filter(function (pk) { return hiddenPlanes[it.id][pk]; });
    h += '<div class="sw-draw-run">' + drawn.map(function (pk) {
      return '<span class="sw-draw-added"><strong>' + esc(planeLabel(pk)) + "</strong> — from the sheet: " + esc(planeMarksText(it, pk) || "drawn by the office") +
        ' <button class="sw-link" data-act="hideplane" data-plane="' + pk + '">hide</button></span>';
    }).join("") + hid.map(function (pk) {
      return '<button class="tech-chip" data-act="showplane" data-plane="' + pk + '">' + esc(planeLabel(pk)) + " (hidden) — show</button>";
    }).join("") + addable.filter(function (pk) { return hid.indexOf(pk) < 0; }).map(function (pk) {
      return '<button class="tech-chip" data-act="addplane" data-plane="' + pk + '">＋ ' + esc(ADD[pk]) + "</button>";
    }).join("") + added.map(function (pk) {
      var side = /^(left|right)2?$/.test(pk), sz = it.planePhotos[pk].size || {};
      return '<span class="sw-draw-added">' + esc(ADD[pk]) + ' <input class="sw-input" inputmode="text" data-planesize="' + pk + '" data-f="' + (side ? "w" : "h") + '" value="' + esc(side ? (sz.w || "") : (sz.h || "")) + '"> ' + (side ? "wide" : "tall") +
        ' <button class="sw-link" data-act="dropplane" data-plane="' + pk + '">remove</button></span>';
    }).join("") + "</div>";
    return h + "</div>";
  }
  function pinInputs(it, u) {
    var pin = SW.pinOf(it, u.key);
    if (!pin) return "";
    var pk = pin.plane, word = pk === "opening" ? "the opening" : "the " + SW.planeWord(it, pk);
    var side = pk === "wall-left" || pk === "wall-right", flat = pk === "floor" || pk === "ceiling";
    return '<div class="sw-pin-edit"><span>' + (SW.FACE_PLANES[pk] ? "On " : "In ") + esc(word) + ":</span>" +
      '<input class="sw-input" inputmode="text" data-pin="' + esc(u.key) + '" data-f="x" value="' + esc(SW.fmtFrac(pin.x)) + '">' +
      "<span>" + (side ? "back from the front ×" : "in from the left ×") + "</span>" +
      '<input class="sw-input" inputmode="text" data-pin="' + esc(u.key) + '" data-f="y" value="' + esc(SW.fmtFrac(pin.y)) + '">' +
      "<span>" + (flat ? "back from the front" : "up") + " — tape it if it matters</span></div>";
  }
  function connCard(it, u, active) {
    var answer = it.utilities[u.key] || "", v = SW.markVerdict(it, u), st = connState(u.key);
    var markable = SW.utilityIsMarkable(it, u), pinned = !!SW.markAt(it, u.key);
    var reach = !!(u.zone && u.zone.kind === "any"), pk = SW.utilPlane(u);
    var have = SW.utilTypeOf(it, u), want = SW.requiredUtilType(u, it), types = SW.utilTypesFor(u);
    var present = connPresent(answer);
    var yes = present && (want ? have === want : true);
    var other = (present && have && want && have !== want) || st.list;
    var none = answer === "roughed" || answer === "missing";
    var where = u.where ? u.where + (u.note ? " " + u.note : "") : (reach ? "Anywhere in the " + SW.planeWord(it, pk) + ", within reach" : "");
    var h = '<div class="sw-svc' + (answer ? " answered" : "") + (active === u.key ? " placing" : "") + '" data-conn="' + esc(u.key) + '">' +
      '<div class="sw-svc-head">' +
      (types.length ? '<div class="sw-svc-pic">' + SW.plugSvg(have || want, 56) + "</div>" : "") +
      "<div class=\"sw-svc-title\"><strong>" + esc(SW.utilLabel(u)) + needPill(!answer) + "</strong>" +
      (want ? '<span class="sw-svc-spec">' + esc(SW.utilTypeLabel(u, want)) + "</span><small>" + (SW.requiredIsUsual(u, it) ? "usual for a " + esc(SW.kindOf(it) === "dishwasher" ? "dishwasher" : SW.kindOf(it)) + (u.need ? " · the sheet: " + esc(u.need) : "") : "read from the specs") + (where ? " · " + esc(where) : "") + "</small>"
            : (u.need ? '<span class="sw-svc-spec">' + esc(u.need) + "</span>" : "") + (where ? "<small>" + esc(where) + "</small>" : "")) +
      "</div></div>";
    if (answer === "na") {
      h += '<p class="sw-hint">Does not apply to this one. <button class="sw-link" data-act="utilna" data-u="' + esc(u.key) + '">Check it after all</button></p>';
      return h + "</div>";
    }
    /* the one question */
    var qText = want ? (SW.utilTypeGroup(u) === "drain" && SW.kindOf(it) === "dishwasher" ? "Is this where the drain hose will go?" : "Is this what you see?") : "Is it there?";
    h += '<p class="sw-svc-q">' + qText + "</p>" +
      '<div class="tech-quick-rating three util">' +
      '<button class="good ' + (yes ? "selected" : "") + '" data-act="utyes" data-u="' + esc(u.key) + '">' + (want ? "✓ Yes, that's it" : "✓ It's there") + "</button>" +
      (types.length && want ? '<button class="monitor ' + (other ? "selected" : "") + '" data-act="utother" data-u="' + esc(u.key) + '">Something else</button>' : "") +
      '<button class="poor ' + (none ? "selected" : "") + '" data-act="utnone" data-u="' + esc(u.key) + '">Nothing there</button>' +
      "</div>";
    if (none) {
      h += '<div class="sw-svc-sub">' +
        '<button class="tech-chip' + (answer === "roughed" ? " on" : "") + '" data-act="utility" data-u="' + esc(u.key) + '" data-v="roughed">Roughed in — wire or stub only</button>' +
        '<button class="tech-chip' + (answer === "missing" ? " on" : "") + '" data-act="utility" data-u="' + esc(u.key) + '" data-v="missing">Nothing at all</button></div>';
    }
    if (present || st.list) h += utilTypeRow(it, u);
    /* where it is, once it is there */
    if (present && !reach) {
      if (markable) {
        if (v) h += '<p class="sw-mark-read' + (v.out ? " bad" : " good") + '">' + esc(v.text) + "</p>";
        else if (active === u.key) h += '<p class="sw-mark-read target">Tap the drawing above where it actually is' + (SW.zoneOf(it, u) ? " — the coloured box is where the sheet puts it" : "") + ".</p>";
      } else if (SW.FACE_PLANES[pk]) {
        h += '<p class="sw-hint">On the ' + esc(SW.planeWord(it, pk)) + " — type the depth on the Measure step and the box shows that face to tap.</p>";
      }
      h += '<div class="sw-svc-acts">' +
        (markable ? (pinned ? '<button class="tech-chip' + (active === u.key ? " on" : "") + '" data-act="pinplace" data-u="' + esc(u.key) + '">Re-place on the drawing</button>'
                            : (active === u.key ? "" : '<button class="tech-chip" data-act="pinplace" data-u="' + esc(u.key) + '">▣ Place on the drawing</button>')) : "") +
        '<span class="sw-svc-place"><button class="tech-chip' + (answer === "ok" ? " on" : "") + '" data-act="utility" data-u="' + esc(u.key) + '" data-v="ok">Right place ✓</button>' +
        '<button class="tech-chip' + (answer === "misplaced" ? " on bad" : "") + '" data-act="utility" data-u="' + esc(u.key) + '" data-v="misplaced">Wrong place</button></span>' +
        "</div>";
    }
    /* everything else, behind one intentional tap */
    var flagText = SW.utilFlagText(it, u);
    h += '<button class="sw-more' + (st.more ? " open" : "") + '" data-act="utmore" data-u="' + esc(u.key) + '">' + (st.more ? "− Less" : "More…") + (flagText && !st.more ? " <em>" + esc(flagText) + "</em>" : "") + "</button>";
    if (st.more) {
      h += '<div class="sw-svc-more">';
      if (pinned) h += pinInputs(it, u) + '<div class="sw-svc-acts"><button class="tech-chip" data-act="pinclear" data-u="' + esc(u.key) + '">Clear the pin</button></div>';
      h += utilFlagRows(it, u);
      if (u.generic) h += '<div class="sw-svc-acts"><button class="tech-chip" data-act="utilna" data-u="' + esc(u.key) + '">Does not apply</button></div>';
      h += "</div>";
    }
    return h + "</div>";
  }
  function serviceStep(it, group, title) {
    var all = SW.utilitiesIn(it, group);
    var active = activePinFor(it, all);
    var anyDrawn = all.some(function (u) { return SW.utilityIsMarkable(it, u); });
    var h = '<div class="sw-step-body"><h2 class="sw-step-h">' + esc(title) + "</h2>";
    if (anyDrawn || SW.roughInModel(it)) h += drawingStage(it, all, active, !anyDrawn, false);
    /* the reach ones get a photo of that cabinet if the tech wants one */
    var reachPlanes = [];
    all.forEach(function (u) { var pk = SW.utilPlane(u); if (u.zone && u.zone.kind === "any" && reachPlanes.indexOf(pk) < 0) reachPlanes.push(pk); });
    reachPlanes.forEach(function (pk) {
      var word = SW.planeWord(it, pk), pp = it.planePhotos && it.planePhotos[pk];
      h += '<div class="sw-conn sw-plane reach"><div class="sw-conn-head"><strong>In the ' + esc(word) + " — anywhere in it</strong>" +
        "<span>Within reach is all the sheet asks. A photo of that cabinet is welcome, not required.</span></div>" +
        '<label class="tech-chip">＋ Photo of that cabinet<input type="file" accept="image/*" capture="environment" data-act="reachphotoin" data-plane="' + esc(pk) + '" hidden></label>' +
        (pp && pp.thumb ? '<div class="sw-reach-pic"><img src="' + esc(pp.thumb) + '" alt="' + esc(word) + '"></div>' : "") + "</div>";
    });
    all.forEach(function (u) { h += connCard(it, u, active); });
    return h + "</div>";
  }

  /* ---------------- the Cabinets step: build the run you see ----------------
     Everything about what stands beside the opening, in one place, before
     any connection is placed: which side the sink cabinet is on, whether a
     cabinet sits between (and how wide — past 8" Wilson brings extension
     kits), the neighbour cabinets the office drew, the ones the tech adds.
     The connection steps then only place pins (Cayden, 23 Oct). */
  var GAP_WIDTHS = [9, 12, 15, 18, 21, 24];
  function runStep(it) {
    var all = SW.utilitiesFor(it);
    var h = '<div class="sw-step-body"><h2 class="sw-step-h">Build the run you see</h2>' +
      '<p class="sw-step-p">What stands beside the opening. Set it up here once; the next steps only place the connections on it.</p>';
    if (SW.isDishwasherish(it)) {
      var g = SW.runGapOf(it), side = it.adjacentSide || "right";
      h += '<div class="sw-adj-side"><span>The sink cabinet is on the' + needPill(!it.adjacentSide) + "</span>" +
        '<button class="tech-chip' + (it.adjacentSide === "left" ? " on" : "") + '" data-act="adjside" data-v="left">◀ Left</button>' +
        '<button class="tech-chip' + (it.adjacentSide === "right" ? " on" : "") + '" data-act="adjside" data-v="right">Right ▶</button>' +
        (it.adjacentSide ? "" : "<em>drawn on the right until you say</em>") + "</div>";
      h += '<div class="sw-run-gap"><span>Between the dishwasher and the sink cabinet' + needPill(!g.kind) + "</span>" +
        '<div class="tech-quick-rating two">' +
        '<button class="good ' + (g.kind === "none" ? "selected" : "") + '" data-act="rungap" data-v="none">Nothing<span>side by side</span></button>' +
        '<button class="monitor ' + (g.kind === "cabinet" ? "selected" : "") + '" data-act="rungap" data-v="cabinet">A cabinet<span>how wide?</span></button></div>';
      if (g.kind === "cabinet") {
        h += '<div class="tech-chips sw-gap-widths">' + GAP_WIDTHS.map(function (wd) {
          return '<button class="tech-chip' + (SW.num(g.w) === wd ? " on" : "") + '" data-act="rungapw" data-v="' + wd + '">' + wd + '"</button>';
        }).join("") + '<button class="tech-chip' + (SW.num(g.w) != null && GAP_WIDTHS.indexOf(SW.num(g.w)) < 0 ? " on" : "") + '" data-act="keypad" data-dim="gap">' + (SW.num(g.w) != null && GAP_WIDTHS.indexOf(SW.num(g.w)) < 0 ? esc(SW.fmtIn(SW.num(g.w))) : "Other…") + "</button></div>";
        if (SW.needsExtensions(it)) {
          var exts = SW.extensionsOf(it);
          h += '<div class="callout warning sw-ext"><strong>Extension kits needed — Wilson brings them.</strong>' +
            "A " + esc(SW.fmtIn(SW.num(g.w))) + " cabinet between means the dishwasher's own drain hose will not reach the " + esc(side) + " sink cabinet. This goes on the salesperson's list, not the builder's." +
            '<p class="sw-ext-q">Which will not reach? <em>usually just the drain hose</em></p><div class="tech-chips">' + SW.EXTENSION_KINDS.map(function (e) {
              return '<button class="tech-chip' + (exts.indexOf(e.k) >= 0 ? " on" : "") + '" data-act="rungapext" data-v="' + e.k + '">' + (exts.indexOf(e.k) >= 0 ? "✓ " : "") + esc(e.label) + "</button>";
            }).join("") + "</div></div>";
        } else if (SW.num(g.w) != null) {
          h += '<p class="sw-hint">Within ' + SW.EXTENSION_GAP_IN + '" — the hoses and cord that come with the dishwasher reach.</p>';
        }
      }
      h += "</div>";
    }
    if (SW.roughInModel(it)) h += drawingStage(it, all, null, true, true);
    else h += '<p class="sw-hint">Type the width and height on the Measure step and the drawing appears here.</p>';
    return h + "</div>";
  }
  /* the cabinet between, as a plane on the sink's side — sized as typed */
  function applyRunGap(it) {
    var g = SW.runGapOf(it), side = it.adjacentSide || "right";
    it.planePhotos = it.planePhotos || {};
    ["left", "right"].forEach(function (pk) {
      var pp = it.planePhotos[pk];
      if (pp && pp.gap) { delete it.planePhotos[pk]; }
    });
    if (g.kind === "cabinet" && SW.num(g.w) != null) {
      it.planePhotos[side] = Object.assign(it.planePhotos[side] || {}, { added: true, gap: true, size: { w: SW.fmtFrac(SW.num(g.w)) } });
    }
  }

  /* ---------------- step 7: everything else ---------------- */
  function notesStep(it) {
    var h = '<div class="sw-step-body"><h2 class="sw-step-h">Anything else</h2>';
    /* An opening with nothing to measure still has to be closable as "could
       not do it" — the Palomino microwave, whose location nobody could
       identify, has no dimensions and is exactly that case. When there is a
       measure step the escape lives there instead. */
    var hasMeasure = stepsFor(it).some(function (st) { return st.k === "measure"; });
    if (!hasMeasure) h += notReadyCard(it);
    h += statusPicker(it);
    h += chipRow(it);
    h += noteRow(it);
    return h + "</div>";
  }

  function stepBody(it, k) {
    if (k === "photo") return photoStep(it);
    if (k === "measure") return measureStep(it);
    if (k === "run") return runStep(it);
    if (k === "plumbing") return serviceStep(it, "plumbing", "Check the plumbing");
    if (k === "electrical") return serviceStep(it, "electrical", "Check the electrical");
    if (k === "other") return serviceStep(it, "other", "Vent and air");
    if (k === "panel") return '<div class="sw-step-body"><h2 class="sw-step-h">Panel</h2>' +
      panelCard(it) + "</div>";
    return notesStep(it);
  }

  /* ---------------- number pad sheet ---------------- */
  var padState = { open: false, dim: null, point: null, whole: "", frac: null };
  function padLabelPanel(it) {
    var parts = (padState.dim || "").split(":"), p = (it && it.panels || []).filter(function (x) { return x.id === parts[1]; })[0];
    return (p ? p.label + " panel" : "Panel") + " · " + (parts[2] === "w" ? "width" : "height");
  }
  function padLabelForm(it) {
    var k = (padState.dim || "").split(":")[1];
    var f = it ? SW.formOf(it).fields.filter(function (x) { return x.k === k; })[0] : null;
    return f ? f.label : "Reading";
  }
  function padLabelPrep(it) {
    var parts = (padState.dim || "").split(":"), pr = (it && it.prep || []).filter(function (x) { return x.id === parts[1]; })[0];
    var m = SW.STRIP_MEAS.filter(function (x) { return x.k === parts[2]; })[0];
    return (pr ? (pr.label || SW.prepKind(pr.kind).label) : "Prep") + " · " + (m ? m.label.toLowerCase() : "reading");
  }
  function padLabelFlush() {
    var k = (padState.dim || "").split(":")[1];
    var f = SW.FLUSH_FIELDS.filter(function (x) { return x.k === k; })[0];
    return f ? f.label : "Flush detail";
  }
  var acceptDim = null;
  /* ---------------- photo markup ----------------
     Full screen, one photograph, five tools. Marks are vectors on the
     photo (u, v in 0..1) so the original is untouched and the packet draws
     them at print size. Drawing happens on pointer events; only the SVG is
     re-rendered mid-stroke, so a fingertip stays smooth on a phone. */
  function markupSheet(w) {
    if (!mu.open) return "";
    var found = SW.photoById(w, mu.photoId);
    if (!found) { mu.open = false; return ""; }
    var p = found.photo, m = SW.markupOf(p) || SW.blankMarkup();
    var src = mu.url || p.thumb;
    return '<div class="sw-mu" data-stop>' +
      '<div class="sw-mu-bar">' +
      '<div class="sw-mu-tools">' + SW.MARK_TOOLS.map(function (t) {
        return '<button class="' + (mu.tool === t.k ? "on" : "") + '" data-act="mutool" data-v="' + t.k + '">' + esc(t.label) + "</button>";
      }).join("") + "</div>" +
      '<div class="sw-mu-colors">' + SW.MARK_COLORS.map(function (c) {
        return '<button class="' + (mu.color === c.k ? "on" : "") + '" data-act="mucolor" data-v="' + c.k + '" style="background:' + c.c + '" aria-label="' + c.k + '"></button>';
      }).join("") + "</div></div>" +
      (mu.textAt ? '<div class="sw-mu-text"><input type="text" id="sw-mu-input" placeholder="MOVE · 3/4 back · outlet here" maxlength="40" autofocus>' +
        '<button class="button small" data-act="mutextok">Place</button><button class="button ghost small" data-act="mutextcancel">Cancel</button></div>' : "") +
      '<div class="sw-mu-stage" id="sw-mu-stage" data-tool="' + mu.tool + '">' +
      '<span class="sw-mu-pic"><img id="sw-mu-img" src="' + esc(src) + '" alt="Photograph">' + (SW.markupSvg(m, "sw-markup sw-mu-svg") || '<svg class="sw-markup sw-mu-svg" viewBox="0 0 1000 ' + Math.round(1000 * (m.ar || 0.75)) + '" preserveAspectRatio="none"></svg>') + "</span></div>" +
      '<div class="sw-mu-foot">' +
      '<button class="button ghost" data-act="muundo"' + (SW.markupCount(m) ? "" : " disabled") + ">Undo</button>" +
      '<button class="button ghost" data-act="muclear"' + (SW.markupCount(m) ? "" : " disabled") + ">Clear</button>" +
      '<span class="sw-mu-hint">' + esc(mu.tool === "text" ? "Tap where the words go" : mu.tool === "pen" ? "Draw with a finger" : "Drag from corner to corner") + "</span>" +
      '<button class="button" data-act="mudone">Done</button></div></div>';
  }
  function muPhoto() { var f = SW.photoById(walk(), mu.photoId); return f ? f.photo : null; }
  function muEnsure(p) {
    if (!p.markup) {
      var img = document.getElementById("sw-mu-img");
      var ar = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.75;
      p.markup = SW.blankMarkup(ar);
    }
    return SW.markupOf(p);
  }
  function muPoint(e) {
    var img = document.getElementById("sw-mu-img");
    if (!img) return null;
    var r = img.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  }
  function muRedraw(p) {
    var pic = document.querySelector(".sw-mu-pic"), m = SW.markupOf(p);
    if (!pic || !m) return;
    var draftSvg = "";
    if (mu.draft) {
      var tmp = { ar: m.ar, strokes: mu.draft.k === "pen" ? [mu.draft] : [], shapes: mu.draft.k !== "pen" ? [mu.draft] : [], texts: [] };
      draftSvg = SW.markupSvg(tmp, "sw-markup sw-mu-svg draft");
    }
    var old = pic.querySelectorAll("svg"); for (var i = 0; i < old.length; i++) old[i].remove();
    pic.insertAdjacentHTML("beforeend", (SW.markupSvg(m, "sw-markup sw-mu-svg") || '<svg class="sw-markup sw-mu-svg" viewBox="0 0 1000 ' + Math.round(1000 * m.ar) + '" preserveAspectRatio="none"></svg>') + draftSvg);
  }
  /* ---- the drawing on the phone: a tap places, a drag pans, pinch zooms ---- */
  var drawDragged = false, drawPtr = null, drawPinch = null;
  function drawHit(svg, model, e) {
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    var minX = +svg.getAttribute("data-minx"), maxY = +svg.getAttribute("data-maxy"), pad = +svg.getAttribute("data-pad");
    var ix = p.x - pad + minX, iy = maxY - (p.y - pad);          /* inches, y up, opening origin */
    var ks = Object.keys(model.planes), best = null;
    for (var i = 0; i < ks.length; i++) {
      var P = model.planes[ks[i]];
      if (ix >= P.x && ix <= P.x + P.w && iy >= P.y && iy <= P.y + P.h) {
        best = { plane: ks[i], x: Math.round((ix - P.x) * 8) / 8, y: Math.round((iy - P.y) * 8) / 8 };
        if (ks[i] === "opening") break;
      }
    }
    return best;
  }
  function boxTap(svg, it, e, only) {
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    var minX = +svg.getAttribute("data-minx"), minY = +svg.getAttribute("data-miny"), pad = +svg.getAttribute("data-pad");
    /* the very boxes the picture shows — the camera sits on their centre,
       so a model with one cabinet more or less would land the tap wrong */
    var shown = {};
    Array.prototype.forEach.call(svg.querySelectorAll(".sw-box-face"), function (g) { shown[g.getAttribute("data-box")] = true; });
    var model = SW.boxModel(it, Object.keys(shown).filter(function (k) { return k !== "opening"; }));
    if (!model) return null;
    return SW.boxHit(model, boxView, p.x - pad + minX, p.y - pad + minY, only || "");
  }
  var boxRaf = null;
  function redrawBox() {
    if (boxRaf) return;
    boxRaf = requestAnimationFrame(function () {
      boxRaf = null;
      var it = item(), pan = HOST.querySelector(".sw-draw-pan");
      if (!it || !pan) return;
      var all = SW.utilitiesFor(it);
      pan.innerHTML = stageSvg(it, groupPlanes(it, all), activePinFor(it, all));
    });
  }
  /* Gestures on the stage (reworked after the first phone try, 21 Oct —
     "it's really fighting me on almost all fronts"):
       one finger at fit zoom, box view  → turns the cabinet
       one finger once zoomed in          → slides the picture (never turns)
       two fingers                        → pinch zooms about the fingers,
                                            and the pair slides
       the ◀ ▲ ▼ ▶ pad and the face chips → turn it without a drag
     Every pointer is captured by the stage so a finger that wanders off
     it still counts, and touchmove is swallowed so Safari neither scrolls
     the page nor zooms it under the tech's fingers. */
  function drawDown(e) {
    var stage = e.target.closest ? e.target.closest(".sw-draw-stage") : null;
    if (!stage) return;
    if (e.target.closest && e.target.closest(".sw-draw-turn")) return;     /* the pad's buttons are taps */
    try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    if (drawPtr && e.pointerId !== drawPtr.id) {
      /* a second finger: pinch to zoom about the fingers, and the pair slides the picture */
      var r = stage.getBoundingClientRect();
      drawPinch = { id: e.pointerId, x: e.clientX, y: e.clientY, z0: drawZoom.z, px0: drawZoom.x, py0: drawZoom.y,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        d0: Math.hypot(e.clientX - drawPtr.lx, e.clientY - drawPtr.ly), mx0: (e.clientX + drawPtr.lx) / 2, my0: (e.clientY + drawPtr.ly) / 2 };
      stage.classList.add("gesturing");
      return;
    }
    drawPtr = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, x0: drawZoom.x, y0: drawZoom.y, yaw0: boxView.yaw, pitch0: boxView.pitch, moved: false, stage: stage };
    drawDragged = false;
  }
  function drawMove(e) {
    if (!drawPtr) return;
    if (drawPinch && e.pointerId === drawPinch.id) {
      drawPinch.x = e.clientX; drawPinch.y = e.clientY;
      pinchApply(); e.preventDefault(); return;
    }
    if (e.pointerId !== drawPtr.id) return;
    drawPtr.lx = e.clientX; drawPtr.ly = e.clientY;
    if (drawPinch) { pinchApply(); e.preventDefault(); return; }
    var dx = e.clientX - drawPtr.x, dy = e.clientY - drawPtr.y;
    if (!drawPtr.moved && Math.hypot(dx, dy) < 8) return;
    if (!drawPtr.moved && drawPtr.stage) drawPtr.stage.classList.add("gesturing");
    drawPtr.moved = true;
    if (flatView || drawZoom.z > 1) {
      /* zoomed in, one finger slides — turning a zoomed-in box pulled the
         corner the tech was working on out from under the finger */
      drawZoom.x = drawPtr.x0 + dx; drawZoom.y = drawPtr.y0 + dy; applyDrawZoom(); e.preventDefault();
    } else {
      /* one finger turns the cabinet, within limits that keep the open front toward the tech */
      boxView.yaw = Math.max(-55, Math.min(55, drawPtr.yaw0 + dx * 0.35));
      boxView.pitch = Math.max(-35, Math.min(45, drawPtr.pitch0 + dy * 0.25));
      redrawBox(); e.preventDefault();
    }
  }
  /* zoom about the fingers: the picture point under the midpoint stays
     under it as the scale changes, and the midpoint's drift slides it */
  function pinchApply() {
    var P = drawPinch, d = Math.hypot(P.x - drawPtr.lx, P.y - drawPtr.ly);
    var z = Math.max(1, Math.min(5, P.z0 * (d / (P.d0 || 1))));
    var mx = (P.x + drawPtr.lx) / 2, my = (P.y + drawPtr.ly) / 2;
    var ax = P.mx0 - P.cx, ay = P.my0 - P.cy;                         /* the midpoint, from the stage's centre */
    drawZoom.z = z;
    drawZoom.x = ax - (ax - P.px0) * (z / P.z0) + (mx - P.mx0);
    drawZoom.y = ay - (ay - P.py0) * (z / P.z0) + (my - P.my0);
    if (z === 1) { drawZoom.x = 0; drawZoom.y = 0; }
    drawPtr.moved = true; applyDrawZoom();
  }
  function drawUp(e) {
    if (drawPinch && e.pointerId === drawPinch.id) {
      /* the pinch is over; the finger left behind slides from where it is */
      drawPinch = null; drawDragged = true;
      if (drawPtr) { drawPtr.x = drawPtr.lx; drawPtr.y = drawPtr.ly; drawPtr.x0 = drawZoom.x; drawPtr.y0 = drawZoom.y; drawPtr.yaw0 = boxView.yaw; drawPtr.pitch0 = boxView.pitch; }
      return;
    }
    if (!drawPtr || e.pointerId !== drawPtr.id) return;
    drawDragged = drawPtr.moved;
    if (drawPtr.stage) drawPtr.stage.classList.remove("gesturing");
    if (drawPinch) {
      /* the first finger lifted while the second stays: carry on sliding with it */
      drawPtr = { id: drawPinch.id, x: drawPinch.x, y: drawPinch.y, lx: drawPinch.x, ly: drawPinch.y, x0: drawZoom.x, y0: drawZoom.y, yaw0: boxView.yaw, pitch0: boxView.pitch, moved: true, stage: drawPtr.stage };
      drawPinch = null; drawDragged = true; return;
    }
    drawPtr = null; drawPinch = null;
  }
  function applyDrawZoom() {
    var pan = HOST.querySelector(".sw-draw-pan");
    if (pan) pan.style.transform = "translate(" + drawZoom.x + "px," + drawZoom.y + "px) scale(" + drawZoom.z + ")";
  }
  function stageTouch(e) {
    /* non-passive: this is what stops Safari scrolling or zooming the page
       under a drag or a pinch on the stage (touch-action alone is not
       honoured everywhere on iOS, least of all inside a frame) */
    if (e.target.closest && (e.target.closest(".sw-draw-stage") || e.target.closest(".sw-hood-box"))) e.preventDefault();
  }
  function muDown(e) {
    drawDown(e);
    if (!mu.open) return;
    var stage = e.target.closest ? e.target.closest("#sw-mu-stage") : null;
    if (!stage) return;
    var p = muPhoto(); if (!p) return;
    var m = muEnsure(p), pt = muPoint(e); if (!pt) return;
    e.preventDefault();
    if (mu.tool === "text") { mu.textAt = pt; render(); var inp = document.getElementById("sw-mu-input"); if (inp) inp.focus(); return; }
    if (mu.tool === "pen") mu.draft = { k: "pen", c: mu.color, w: 4, pts: [pt], ts: Date.now() };
    else mu.draft = { k: mu.tool, c: mu.color, a: pt, b: pt, ts: Date.now() };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    muRedraw(p);
  }
  function muMove(e) {
    if (!mu.open || !mu.draft) return;
    var pt = muPoint(e); if (!pt) return;
    e.preventDefault();
    if (mu.draft.k === "pen") {
      var last = mu.draft.pts[mu.draft.pts.length - 1];
      if (Math.abs(last[0] - pt[0]) + Math.abs(last[1] - pt[1]) > 0.003) mu.draft.pts.push(pt);
    } else mu.draft.b = pt;
    muRedraw(muPhoto());
  }
  function muUp(e) {
    if (!mu.open || !mu.draft) return;
    var p = muPhoto(), d = mu.draft; mu.draft = null;
    if (!p) return;
    var m = muEnsure(p);
    if (d.k === "pen") { if (d.pts.length > 1) m.strokes.push({ c: d.c, w: d.w, pts: d.pts, ts: d.ts }); }
    else if (Math.abs(d.b[0] - d.a[0]) + Math.abs(d.b[1] - d.a[1]) > 0.01) m.shapes.push({ k: d.k, c: d.c, a: d.a, b: d.b, ts: d.ts });
    autosave(); render();
  }
  function keypadSheet(it) {
    if (!padState.open) return '<div class="tech-keypad-sheet" hidden></div>';
    var d = SW.DIMS.concat([SW.DIM4]).filter(function (x) { return x.k === padState.dim; })[0] || SW.DIMS[0];
    var display = (padState.whole || "0") + (padState.frac ? " " + padState.frac[0] : "");
    var where = padState.dim === "access" ? "Tightest point on the route"
      : padState.dim === "chip"
      ? (padState.chip ? padState.chip.t.replace(/\{n\}/g, "__") : "The number")
      : padState.dim === "flooring" ? "Flooring thickness still to go in"
      : padState.dim === "swing" ? "Clearance beside the door"
      : /^pnl:/.test(padState.dim) ? padLabelPanel(it)
      : /^flush:/.test(padState.dim) ? padLabelFlush()
      : /^prep:/.test(padState.dim) ? padLabelPrep(it)
      : padState.dim === "panelthick" ? "Panel thickness"
      : /^form:/.test(padState.dim) ? padLabelForm(it)
      : padState.dim === "obstruction"
      ? "Projects from the back wall"
      : padState.dim === "gap" ? "The cabinet between — how wide"
      : (padState.point != null ? d.label + " · " + SW.pointLabel(padState.dim, padState.point) : d.label);
    /* The spec sits on the pad too, so a reading that turns out to be on
       spec after all does not need the sheet closed again. */
    var spec = padState.dim && padState.dim.length === 1 && it && it.spec
      ? SW.num(it.spec[padState.dim]) : null;

    return '<div class="tech-keypad-sheet" data-act="padbackdrop"><div class="tech-keypad-inner" data-stop>' +
      '<div class="sw-pad-head"><span>' + esc(where) + '</span><strong class="sw-pad-display">' +
      esc(display) + '"</strong></div>' +
      (spec != null
        ? '<button class="sw-pad-specrow" data-act="padspec" data-v="' + spec + '">On spec — ' +
          esc(SW.fmtIn(spec)) + "</button>"
        : "") +
      '<div class="sw-pad-grid">' +
      '<div class="tech-keypad-keys">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) {
        return '<button class="tech-key" data-act="paddigit" data-n="' + n + '">' + n + "</button>";
      }).join("") +
      '<button class="tech-key" data-act="padclear">Clear</button>' +
      '<button class="tech-key" data-act="paddigit" data-n="0">0</button>' +
      '<button class="tech-key done" data-act="paddone">Done</button>' +
      "</div>" +
      /* Sixteenths down the right-hand side, whole inches at the top. */
      '<div class="sw-pad-fracs">' +
      '<button class="' + (padState.frac ? "" : "on") + '" data-act="padfrac" data-f="">0</button>' +
      FRACTIONS.map(function (f) {
        return '<button class="' + (padState.frac && padState.frac[0] === f[0] ? "on" : "") +
          '" data-act="padfrac" data-f="' + f[0] + '">' + f[0] + "</button>";
      }).join("") + "</div>" +
      "</div></div></div>";
  }

  /* ---------------- events ---------------- */
  function nextPoint(it, k) {
    if (!k || !it.points || !it.points[k]) return null;
    for (var i = 0; i < 3; i++) {
      if (SW.num(it.points[k][i]) == null && it.points[k][i] !== "NM") return i;
    }
    return null;
  }
  /* Within a dimension, walk left -> centre -> right, then move on. */
  function advancePoint(it, k) {
    var next = nextPoint(it, k);
    if (next != null) { openPoint = next; return; }
    openPoint = null;
    advance(it);
    if (openDim) openPoint = nextPoint(it, openDim);
  }
  function advance(it) {
    var next = null;
    SW.DIMS.forEach(function (d) {
      if (next) return;
      if (SW.num(it.spec[d.k]) == null) return;
      var raw = it.actual[d.k];
      if (raw === "" || raw == null) next = d.k;
    });
    openDim = next;
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest("[data-act]") : null;
    var w = walk(), it = item();

    if (padState.open) {
      var inner = e.target.closest ? e.target.closest("[data-stop]") : null;
      if (!inner && t && t.getAttribute("data-act") === "padbackdrop") { padState.open = false; render(); return; }
    }
    if (!t) return;
    var act = t.getAttribute("data-act");

    if (act === "morefields") { moreFields[itemId] = true; render(); return; }
    if (act === "oldoffers") { showOldOffers = !showOldOffers; render(); return; }
    if (act === "refreshoffers") { offers = null; offerMsg = ""; loadOffers(true); render(); return; }
    if (act === "getsheets") { tick(10); sheetsStart(true); return; }
    if (act === "takeoffer") {
      var off = (offers || [])[+t.getAttribute("data-i")];
      if (!off || offerTaking) return;
      /* v0.9.84: the list may hold summaries only; the walk itself comes
         down when it is opened */
      offerTaking = true; t.textContent = "Opening…";
      SW.takeOffer(off).then(function (res) {
        offerTaking = false;
        if (!res.ok) {
          if (res.reason === "mine-newer") ui.toast("Kept your version", "This phone has newer measurements for that walk than the office copy.");
          else ui.toast("Could not open it", "The walk could not be fetched from " + SW.apiUrl("serverName", "the shop server") + ". Check the connection and try again.");
          render(); return;
        }
        tick(14);
        /* Not "it works offline from here" — the legible sheets still have to
           be pulled down, and the walk screen is about to say so. */
        ui.toast("Walk loaded", res.walk.items.length + " openings. Saving the install sheets to this phone now — stay on wifi a moment.");
        sheetWalk = ""; sheetState = null;
        go(SW.nav("field", res.walk.id));
      });
      return;
    }
    if (act === "home") { go(homeHref()); return; }
    if (act === "markup") {
      mu = { open: true, photoId: t.getAttribute("data-p"), tool: "pen", color: "red", url: "", draft: null, textAt: null };
      render();
      var f0 = SW.photoById(w, mu.photoId);
      if (f0) SW.photoUrl(mu.photoId, { walkId: walkId, portalId: f0.photo.portalId || "" }).then(function (url) {
        if (url && mu.open && mu.photoId === f0.photo.id) { mu.url = url; render(); }
      }).catch(function () { });
      return;
    }
    if (act === "mutool") { mu.tool = t.getAttribute("data-v"); mu.textAt = null; render(); return; }
    if (act === "mucolor") { mu.color = t.getAttribute("data-v"); render(); return; }
    if (act === "muundo") { var up = muPhoto(); if (up) { SW.markupUndo(SW.markupOf(up)); autosave(); render(); } return; }
    if (act === "muclear") { var cp = muPhoto(); if (cp && cp.markup) { cp.markup.strokes = []; cp.markup.shapes = []; cp.markup.texts = []; autosave(); render(); } return; }
    if (act === "mutextcancel") { mu.textAt = null; render(); return; }
    if (act === "mutextok") {
      var inp = document.getElementById("sw-mu-input"), tp = muPhoto();
      var txt = inp ? inp.value.trim() : "";
      if (tp && txt && mu.textAt) { muEnsure(tp).texts.push({ at: mu.textAt, t: txt, c: mu.color, s: 44, ts: Date.now() }); autosave(); }
      mu.textAt = null; render(); return;
    }
    if (act === "mudone") { mu.open = false; mu.draft = null; mu.textAt = null; render(); return; }
    if (act === "mergemode") { mergeMode = true; mergeSel = []; render(); return; }
    if (act === "mergecancel") { mergeMode = false; mergeSel = []; render(); return; }
    if (act === "mergepick") {
      var pid = t.getAttribute("data-id"), at = mergeSel.indexOf(pid);
      if (at >= 0) mergeSel.splice(at, 1); else mergeSel.push(pid);
      render(); return;
    }
    if (act === "mergego") {
      var res2 = SW.mergeItems(w, mergeSel);
      if (res2.error) { ui.toast("Cannot merge", res2.error); return; }
      mergeMode = false; mergeSel = []; autosave();
      ui.toast("Merged", SW.mergeUnits(res2.host).length + " units are now one opening. Measure the whole cavity.");
      openDim = null; go(opHref(res2.host.id)); return;
    }
    if (act === "unmerge") {
      if (!it) return;
      SW.unmergeItem(w, it); autosave(); ui.toast("Unmerged", "Each unit is its own opening again."); render(); return;
    }
    if (act === "prereq") { SW.setPrereq(w, t.getAttribute("data-k"), t.getAttribute("data-v")); autosave(); render(); return; }
    if (act === "form") { if (!it) return; SW.setForm(it, t.getAttribute("data-v")); openDim = null; formPickOpen = false; autosave(); render(); return; }
    if (act === "formpick") { formPickOpen = !formPickOpen; render(); return; }
    if (act === "rungap" && it) {
      tick();
      var gk = t.getAttribute("data-v"), g0 = SW.runGapOf(it);
      SW.setRunGap(it, g0.kind === gk ? "" : gk, gk === "cabinet" ? g0.w : "");
      applyRunGap(it); autosave(); render(); return;
    }
    if (act === "rungapext" && it) { tick(); SW.toggleExtension(it, t.getAttribute("data-v")); autosave(); render(); return; }
    if (act === "rungapw" && it) {
      tick();
      SW.setRunGap(it, "cabinet", t.getAttribute("data-v"));
      applyRunGap(it); autosave(); render(); return;
    }
    if (act === "needjump") {
      var nj = HOST.querySelector(t.getAttribute("data-sel") || "");
      if (nj) { if (/^\.sw-dim\[/.test(t.getAttribute("data-sel"))) { openDim = nj.getAttribute("data-dim"); render(); nj = HOST.querySelector(t.getAttribute("data-sel")); } if (nj && nj.scrollIntoView) nj.scrollIntoView({ block: "center", behavior: "smooth" }); nj.classList.add("sw-flash"); setTimeout(function () { nj.classList.remove("sw-flash"); }, 1600); }
      return;
    }
    if (act === "needstep") {
      stepKey = t.getAttribute("data-s"); var nsel = t.getAttribute("data-sel"); render();
      var ne = HOST.querySelector(nsel || ""); if (ne && ne.scrollIntoView) { ne.scrollIntoView({ block: "center" }); ne.classList.add("sw-flash"); setTimeout(function () { ne.classList.remove("sw-flash"); }, 1600); }
      return;
    }
    if (act === "moreopen" && it) { moreOpen[it.id] = !moreOpen[it.id]; render(); return; }
    if (act === "ownwords") { ownWordsOpen = !ownWordsOpen; render(); if (ownWordsOpen) { var oi = document.getElementById("sw-custom-act"); if (oi) oi.focus(); } return; }
    if (act === "formcheck") { if (!it) return; SW.setFormCheck(it, t.getAttribute("data-k"), t.getAttribute("data-v")); autosave(); render(); return; }
    if (act === "unitmove") { if (!it) return; SW.moveUnit(it, +t.getAttribute("data-i"), +t.getAttribute("data-d")); autosave(); render(); return; }
    if (act === "unithinge") { if (!it) return; tick(); SW.setUnitHinge(it, +t.getAttribute("data-i"), t.getAttribute("data-v")); autosave(); render(); return; }
    if (act === "kit") {
      if (!it || !SW.isMerge(it)) return;
      var kv = t.getAttribute("data-v");
      it.merge.kit.state = it.merge.kit.state === kv ? "" : kv; autosave(); render(); return;
    }
    if (act === "open") { openDim = null; openPoint = null; showMoreChips = false; chipOwnerFilter = ""; go(opHref(t.getAttribute("data-id"))); return; }
    if (act === "prev" || act === "next") {
      var i = w.items.indexOf(it) + (act === "next" ? 1 : -1);
      if (w.items[i]) {
        openDim = null; openPoint = null; showMoreChips = false; stepKey = null; chipOwnerFilter = "";
        go(opHref(w.items[i].id));
      }
      return;
    }
    if (act === "save") { SW.saveNow(); ui.toast("Saved", "The walk is stored on this device."); render(); return; }
    if (act === "finish") {
      SW.saveNow();
      if (!SW.accessAnswered(w)) {
        ui.toast("Jobsite access first",
          "Record how the appliances get in and photograph the route — " +
          SW.accessMissing(w).join(", ") + ".");
        go(accessHref());
        return;
      }
      var r = SW.rollup(w);
      if (r.done < r.total) {
        ui.toast("Still open", (r.total - r.done) + " opening" + (r.total - r.done > 1 ? "s" : "") + " have not been walked. The packet will show them as open.");
      } else {
        ui.toast("Walk complete", "All " + r.total + " openings walked. The office can compile the packet.");
      }
      SW.goto(SW.nav("packet", w.id));
      return;
    }

    if (act === "opendim") {
      var k = t.getAttribute("data-dim");
      openDim = openDim === k ? null : k;
      openPoint = (openDim && it && it.multiPoint) ? nextPoint(it, openDim) : null;
      render(); return;
    }
    if (act === "openpoint" && it) {
      var pk = t.getAttribute("data-dim"), pi = +t.getAttribute("data-i");
      openDim = pk;
      openPoint = openPoint === pi ? null : pi;
      render(); return;
    }
    if (act === "setdim" && it) {
      var dk = t.getAttribute("data-dim"), val = t.getAttribute("data-v");
      var stored = val === "" ? "" : (val === "NM" ? "NM" : SW.fmtFrac(parseFloat(val)));
      if (t.hasAttribute("data-i")) {
        it.points[dk][+t.getAttribute("data-i")] = stored;
        SW.syncPoints(it);
        advancePoint(it, dk);
      } else {
        it.actual[dk] = stored;
        if (val === "") openDim = dk; else advance(it);
      }
      tick();
      autosave(); render(); return;
    }
    if (act === "multipoint" && it) {
      it.multiPoint = true;
      /* Carry the reading already taken in as the centre point rather than
         throwing it away -- it is usually the one at the face. */
      SW.DIMS.forEach(function (d) {
        var had = SW.num(it.actual[d.k]);
        if (had != null && !SW.pointsAnswered(it, d.k)) it.points[d.k][1] = SW.fmtFrac(had);
      });
      SW.syncPoints(it);
      openPoint = nextPoint(it, openDim);
      autosave(); render(); return;
    }
    if (act === "singlepoint" && it) {
      it.multiPoint = false;
      SW.DIMS.forEach(function (d) {
        var g = SW.governing(it, d.k);
        if (g != null) it.actual[d.k] = SW.fmtFrac(g);
        it.points[d.k] = ["", "", ""];
      });
      openPoint = null; autosave(); render(); return;
    }
    if (act === "pinplace" && it) { pinKey = pinKey === t.getAttribute("data-u") ? null : t.getAttribute("data-u"); render(); return; }
    if (act === "pinclear" && it) {
      SW.clearPin(it, t.getAttribute("data-u"));
      if (it.utilities[t.getAttribute("data-u")] === "ok") it.utilities[t.getAttribute("data-u")] = "";
      autosave(); render(); return;
    }
    if (act === "drawflat") { flatView = !flatView; drawZoom = { z: 1, x: 0, y: 0 }; render(); return; }
    if (act === "hoodunder" && it) {
      it.hood = it.hood || {}; it.hood.under = t.getAttribute("data-v");
      tick(); autosave(); render(); return;
    }
    if (act === "roomopen") { roomOpen = !roomOpen; render(); return; }
    if (act === "roomset" && it) {
      var room = t.getAttribute("data-v");
      it.area = it.area === room ? "" : room; roomOpen = false;
      tick(); autosave(); render(); return;
    }
    if (act === "formside" && it) {
      it.form = it.form || {}; it.form[t.getAttribute("data-k") + "Side"] = t.getAttribute("data-v");
      tick(); autosave(); render(); return;
    }
    if (act === "hoodkind" && it) {
      /* finished hood or custom shroud + insert: the form follows, and so
         does what the library's hood block is taken to be */
      var kind = t.getAttribute("data-v");
      it.hood = it.hood || {}; it.hood.type = kind === "shroud" ? "insert" : (it.hood.type === "insert" ? "wall" : it.hood.type || "wall");
      SW.setForm(it, kind);
      tick(); autosave(); render(); return;
    }
    if (act === "adjside" && it) {
      var sv = t.getAttribute("data-v");
      it.adjacentSide = it.adjacentSide === sv ? "" : sv;
      applyRunGap(it);                       /* the cabinet between follows the sink's side */
      tick(); autosave(); render(); return;
    }
    if (act === "drawfull") {
      boxFull = !boxFull; drawZoom = { z: 1, x: 0, y: 0 };
      document.body.classList.toggle("sw-draw-locked", boxFull);
      render(); return;
    }
    if (act === "hideplane" && it) {
      var hpk = t.getAttribute("data-plane");
      /* not while a connection drawn in there still waits to be placed */
      var needs = SW.utilitiesFor(it).filter(function (u) { return SW.utilPlane(u) === hpk && SW.utilityIsMarkable(it, u) && !SW.markAt(it, u.key) && it.utilities[u.key] !== "missing" && it.utilities[u.key] !== "na"; });
      if (needs.length) { ui.toast("Still needed", "The " + SW.utilLabel(needs[0]).toLowerCase() + " goes in the " + SW.planeWord(it, hpk) + " — place it or answer it first."); return; }
      hiddenPlanes[it.id] = hiddenPlanes[it.id] || {}; hiddenPlanes[it.id][hpk] = true;
      render(); return;
    }
    if (act === "showplane" && it) {
      var spk = t.getAttribute("data-plane");
      if (hiddenPlanes[it.id]) delete hiddenPlanes[it.id][spk];
      render(); return;
    }
    if (act === "drawturn") {
      var tv = t.getAttribute("data-v");
      if (tv === "l") boxView.yaw = Math.max(-55, boxView.yaw - 12);
      if (tv === "r") boxView.yaw = Math.min(55, boxView.yaw + 12);
      if (tv === "u") boxView.pitch = Math.min(45, boxView.pitch + 10);
      if (tv === "d") boxView.pitch = Math.max(-35, boxView.pitch - 10);
      redrawBox(); return;
    }
    if (act === "facelock") {
      faceLock = t.getAttribute("data-plane") || "";
      if (faceLock) boxView = SW.boxViewFor(boxView, faceLock);   /* turn the box so the face shows */
      render(); return;
    }
    if (act === "addplane" && it) {
      var apk = t.getAttribute("data-plane"), side = /^(left|right)2?$/.test(apk);
      it.planePhotos = it.planePhotos || {};
      it.planePhotos[apk] = Object.assign({ photoId: "", portalId: "", thumb: "", corners: [], marks: {} }, it.planePhotos[apk] || {}, { added: true, size: side ? { w: "24" } : { h: "30" } });
      tick(); autosave(); render(); return;
    }
    if (act === "dropplane" && it) {
      var dpk = t.getAttribute("data-plane");
      if (it.planePhotos && it.planePhotos[dpk]) { if (it.planePhotos[dpk].photoId) { it.planePhotos[dpk].added = false; it.planePhotos[dpk].size = {}; } else delete it.planePhotos[dpk]; }
      SW.utilitiesFor(it).forEach(function (u) { var pin = SW.pinOf(it, u.key); if (pin && pin.plane === dpk) SW.clearPin(it, u.key); });
      autosave(); render(); return;
    }
    if (act === "drawzoom") {
      var dv = t.getAttribute("data-v");
      if (dv === "fit") drawZoom = { z: 1, x: 0, y: 0 };
      else drawZoom.z = Math.max(1, Math.min(4, drawZoom.z * (dv === "in" ? 1.5 : 1 / 1.5)));
      if (drawZoom.z === 1) { drawZoom.x = 0; drawZoom.y = 0; }
      render(); return;
    }
    if (act === "drawtap" && it) {
      /* a drag to pan is not a tap; the stage's pointer handlers set this */
      if (drawDragged) { drawDragged = false; return; }
      var key = t.getAttribute("data-u");
      if (!key) return;
      var svg = t.querySelector("svg.sw-roughin, svg.sw-box");
      if (!svg) return;
      var u = SW.utilByKey(it, key), want = u ? SW.utilPlane(u) : "opening";
      var only = flatView ? "" : faceFor(it, u);
      var hit = flatView ? drawHit(svg, SW.roughInModel(it), e) : boxTap(svg, it, e, only);
      if (!hit) { if (only) ui.toast("Not on that face", "Tap on the " + (only === "opening" ? "back wall" : SW.planeWord(it, only)) + ", or choose another face above."); return; }
      /* a connection drawn for one cabinet is pinned in that cabinet; a tap
         on another plane is taken as that plane only when nothing was drawn
         — or when the tech chose that face on purpose */
      if (u && u.zone && hit.plane !== want && !only) { ui.toast("Other cabinet", "The sheet puts the " + SW.utilLabel(u).toLowerCase() + " in the " + (want === "opening" ? "opening" : SW.planeWord(it, want)) + " — tap there, or choose the face above."); return; }
      if (hit.clamped) ui.toast("On the edge", "Taken at the edge of the " + (hit.plane === "opening" ? "back wall" : SW.planeWord(it, hit.plane)) + ".");
      SW.setPin(it, key, hit.plane, hit.x, hit.y);
      if (u && !u.zone) { u.plane = hit.plane; u.offPlane = hit.plane !== "opening"; }   /* nothing drawn: the pin says which face */
      if (it.utilities[key] === "missing" || it.utilities[key] === "na") it.utilities[key] = "";
      SW.syncUtilities(it);
      pinKey = null;
      tick();
      autosave(); render(); return;
    }
    if (act === "acceptopen" && it) {
      var ad = t.getAttribute("data-dim");
      acceptDim = acceptDim === ad ? null : ad;
      if (!SW.acceptedReason(it, ad)) {
        /* First tap accepts with the default reason so one tap is enough;
           the chip row is then open to change it. */
        it.accepted[ad] = SW.ACCEPT_REASONS[0];
        acceptDim = ad;
        autosave();
      }
      render(); return;
    }
    if (act === "acceptreason" && it) {
      it.accepted[t.getAttribute("data-dim")] = t.getAttribute("data-r");
      acceptDim = null;
      autosave(); render(); return;
    }
    if (act === "acceptclear" && it) {
      it.accepted[t.getAttribute("data-dim")] = "";
      acceptDim = null;
      autosave(); render(); return;
    }
    if (act === "obstruct" && it) {
      tick();
      var os = SW.obstructionOf(it), ov = t.getAttribute("data-v");
      os.state = os.state === ov ? "" : ov;
      if (os.state === "none" || !os.state) { os.kind = ""; os.projectsIn = ""; }
      autosave(); render(); return;
    }
    if (act === "obstructkind" && it) {
      var ok2 = SW.obstructionOf(it), kv = t.getAttribute("data-v");
      ok2.kind = ok2.kind === kv ? "" : kv;
      autosave(); render(); return;
    }
    if (act === "obstructclear" && it) {
      SW.obstructionOf(it).projectsIn = "";
      autosave(); render(); return;
    }
    if (act === "optadd" && it) {
      it.options = (it.options || []).concat([t.getAttribute("data-v")]);
      autosave(); render(); return;
    }
    if (act === "optdel" && it) {
      it.options.splice(+t.getAttribute("data-i"), 1);
      autosave(); render(); return;
    }
    if (act === "gostep") { stepKey = t.getAttribute("data-s"); openDim = null; render(); toTop(); return; }
    if (act === "stepnext" && it) {
      var ss = stepsFor(it), ci = currentStep(it);
      stepKey = (ss[ci + 1] || ss[ci]).k;
      openDim = null; autosave(); render(); toTop(); return;
    }
    if (act === "stepback" && it) {
      var ss2 = stepsFor(it), ci2 = currentStep(it);
      stepKey = (ss2[ci2 - 1] || ss2[0]).k;
      openDim = null; render(); toTop(); return;
    }
    if (act === "toggle4" && it) {
      it.planes4 = !it.planes4;
      if (!it.planes4) { it.actual.c = ""; it.accepted.c = ""; it.points.c = ["", "", ""]; }
      openDim = it.planes4 ? "c" : null;
      autosave(); render(); return;
    }
    if (act === "utilna" && it) {
      var nk = t.getAttribute("data-u");
      it.utilities[nk] = it.utilities[nk] === "na" ? "" : "na";
      if (it.overlay && it.overlay.marks) delete it.overlay.marks[nk];
      autosave(); render(); return;
    }
    if (act === "utility" && it) {
      var uk = t.getAttribute("data-u"), uv = t.getAttribute("data-v");
      /* "right place" and "wrong place" are a pair — one is always on once it is there */
      it.utilities[uk] = (it.utilities[uk] === uv && !connPresent(uv)) ? "" : uv;
      /* "Not found" with a pin on the drawing is a contradiction */
      if (it.utilities[uk] === "missing") SW.clearPin(it, uk);
      tick();
      autosave(); render(); return;
    }
    if (act === "specopen") { specOpen = true; render(); loadFullSpec(it); return; }
    if (act === "specx") { specOpen = false; render(); return; }
    if (act === "specclose") {
      /* the backdrop closes; anything inside the sheet does not */
      if (e.target === t) { specOpen = false; render(); }
      return;
    }
    if (act === "speczoom") { t.classList.toggle("zoomed"); return; }
    if (act === "pnladd" && it) { tick(); SW.addPanel(it, t.getAttribute("data-l")); autosave(); render(); return; }
    if (act === "pnlremove" && it) { SW.removePanel(it, t.getAttribute("data-pid")); autosave(); render(); return; }
    if (act === "pnlplane" && it) {
      tick();
      var pid = t.getAttribute("data-pid"), pv2 = t.getAttribute("data-v");
      (it.panels || []).forEach(function (p) { if (p.id === pid) p.plane = p.plane === pv2 ? "" : pv2; });
      autosave(); render(); return;
    }
    if (act === "utype" && it) {
      tick();
      var uu = SW.utilitiesFor(it).filter(function (x) { return x.key === t.getAttribute("data-u"); })[0];
      if (uu) {
        var tk = t.getAttribute("data-t");
        SW.setUtilType(it, uu, SW.utilTypeOf(it, uu) === tk ? "" : tk);
        /* naming what is there says it is there */
        if (!connPresent(it.utilities[uu.key])) it.utilities[uu.key] = "ok";
        connState(uu.key).list = false;
      }
      autosave(); render(); return;
    }
    if (act === "utyes" && it) {
      tick();
      var uy = SW.utilByKey(it, t.getAttribute("data-u"));
      if (uy) {
        var wantY = SW.requiredUtilType(uy, it);
        if (wantY) SW.setUtilType(it, uy, wantY);
        if (!connPresent(it.utilities[uy.key])) it.utilities[uy.key] = "ok";
        var csY = connState(uy.key); csY.list = !wantY && !SW.utilTypeOf(it, uy) && SW.utilTypesFor(uy).length > 0; csY.all = false;
      }
      autosave(); render(); return;
    }
    if (act === "utother" && it) {
      tick();
      var uo = SW.utilByKey(it, t.getAttribute("data-u"));
      if (uo) {
        var cso = connState(uo.key);
        cso.list = !cso.list; cso.all = false;
        /* the spec's type was the answer; "something else" withdraws it */
        if (cso.list && SW.utilTypeOf(it, uo) === SW.requiredUtilType(uo, it)) SW.setUtilType(it, uo, "");
      }
      autosave(); render(); return;
    }
    if (act === "utypeall" && it) { connState(t.getAttribute("data-u")).all = true; render(); return; }
    if (act === "utnone" && it) {
      tick();
      var un = t.getAttribute("data-u");
      if (it.utilities[un] === "roughed" || it.utilities[un] === "missing") it.utilities[un] = "";
      else { it.utilities[un] = "missing"; SW.clearPin(it, un); }
      connState(un).list = false;
      autosave(); render(); return;
    }
    if (act === "utmore" && it) { var cm = connState(t.getAttribute("data-u")); cm.more = !cm.more; render(); return; }
    if (act === "utflag" && it) {
      tick();
      var uf = SW.utilByKey(it, t.getAttribute("data-u"));
      if (uf) { var fk = t.getAttribute("data-k"), fv = t.getAttribute("data-v"); SW.setUtilFlag(it, uf, fk, SW.utilFlag(it, uf, fk) === fv ? "" : fv); }
      autosave(); render(); return;
    }
    if (act === "toggleflush" && it) {
      var fo = SW.flushOf(it); fo.on = !fo.on; fo.touched = true;
      if (fo.on && !it.planes4 && SW.num(fo.sideSetback) != null) SW.syncFlush(it);
      autosave(); render(); return;
    }
    if (act === "toggleswing" && it) { var so = SW.swingOf(it); so.on = !so.on; autosave(); render(); return; }
    if (act === "swinghinge" && it) { var s1 = SW.swingOf(it); s1.hinge = s1.hinge === t.getAttribute("data-v") ? "" : t.getAttribute("data-v"); autosave(); render(); return; }
    if (act === "swingwall" && it) { var s2 = SW.swingOf(it); s2.wallSide = s2.wallSide === t.getAttribute("data-v") ? "" : t.getAttribute("data-v"); autosave(); render(); return; }
    if (act === "flooring") {
      var flw = SW.flooringOf(w); var fv = t.getAttribute("data-v");
      flw.pending = fv === "pending"; flw.answered = true;
      if (!flw.pending) flw.thicknessIn = "";
      tick(); autosave(); render(); return;
    }
    if (act === "panelready" && it) {
      tick();
      it.panelReady = t.getAttribute("data-v") === "1";
      if (!it.panelReady) { it.panelBy = ""; it.panelState = ""; it.panelPulls = ""; }
      autosave(); render(); return;
    }
    if (act === "panelby" && it) {
      tick();
      var pv = t.getAttribute("data-v");
      it.panelBy = it.panelBy === pv ? "" : pv;
      if (it.panelBy !== "custom") { it.panelState = ""; it.panelPulls = ""; }
      autosave(); render(); return;
    }
    if (act === "panelstate" && it) {
      var ps = t.getAttribute("data-v");
      it.panelState = it.panelState === ps ? "" : ps;
      if (it.panelState === "absent") it.panelPulls = "";
      autosave(); render(); return;
    }
    if (act === "panelpulls" && it) {
      var pp = t.getAttribute("data-v");
      it.panelPulls = it.panelPulls === pp ? "" : pp;
      autosave(); render(); return;
    }
    if (act === "notready" && it) {
      it.notReady = t.getAttribute("data-r");
      it.status = "";
      openDim = null; openPoint = null;
      autosave(); render(); return;
    }
    if (act === "prepstate" && it) {
      tick();
      var ppid = t.getAttribute("data-p"), pv2 = t.getAttribute("data-v");
      it.prepChecks = it.prepChecks || {};
      var cur = it.prepChecks[ppid] || {};
      it.prepChecks[ppid] = Object.assign({}, cur, { state: cur.state === pv2 ? "" : pv2, note: cur.note || "" });
      autosave(); render(); return;
    }
    if (act === "panelthick" && it) {
      tick();
      var ptv = +t.getAttribute("data-v"), ptCur = SW.panelThickness(it);
      it.panelThicknessIn = ptCur != null && Math.abs(ptCur - ptv) < 1e-6 ? "" : SW.fmtFrac(ptv);   /* second tap clears it */
      autosave(); render(); return;
    }
    if (act === "prepfin" && it) {
      tick();
      SW.setPrepFoundFinished(it, t.getAttribute("data-p"), t.getAttribute("data-v"));
      autosave(); render(); return;
    }
    if (act === "specdoubt" && it) {
      tick();
      var dr = t.getAttribute("data-r");
      if (dr === "Other") { dr = window.prompt("What looks wrong with the spec?") || ""; if (!dr) return; }
      SW.setSpecDoubt(it, dr, w.walkedBy || "");
      it.status = "";
      autosave(); render(); return;
    }
    if (act === "cleardoubt" && it) { tick(); SW.setSpecDoubt(it, ""); autosave(); render(); return; }
    if (act === "clearnotready" && it) {
      it.notReady = "";
      openDim = null; openPoint = null;
      autosave(); render(); return;
    }
    if (act === "keypad") {
      padState = { open: true, dim: t.getAttribute("data-dim"),
        point: t.hasAttribute("data-i") ? +t.getAttribute("data-i") : null, whole: "", frac: null };
      render(); return;
    }
    if (act === "paddigit") {
      if (padState.whole.length < 4) padState.whole += t.getAttribute("data-n");
      render(); return;
    }
    if (act === "padfrac") {
      var f = t.getAttribute("data-f");
      padState.frac = f ? FRACTIONS.filter(function (x) { return x[0] === f; })[0] : null;
      render(); return;
    }
    if (act === "padclear") { padState.whole = ""; padState.frac = null; render(); return; }
    if (act === "padspec" && it) {
      var sv = t.getAttribute("data-v");
      if (padState.point != null) {
        it.points[padState.dim][padState.point] = SW.fmtFrac(SW.num(sv));
        SW.syncPoints(it);
        advancePoint(it, padState.dim);
      } else {
        it.actual[padState.dim] = SW.fmtFrac(SW.num(sv));
        advance(it);
      }
      padState.open = false; autosave(); render(); return;
    }
    if (act === "paddone") {
      tick();
      var whole = parseInt(padState.whole || "0", 10);
      var total = whole + (padState.frac ? padState.frac[1] : 0);
      if (padState.whole || padState.frac) {
        if (padState.dim === "access") {
          /* The access screen has no opening, so this branch runs before
             anything reaches for one. */
          SW.accessOf(w).tightestIn = SW.fmtFrac(total);
        } else if (padState.dim === "flooring") {
          SW.flooringOf(w).thicknessIn = SW.fmtFrac(total);
        } else if (!it) {
          padState.open = false; render(); return;
        } else if (padState.dim === "chip") {
          var ch = padState.chip;
          if (ch) SW.addAction(it, SW.chipText(ch, total), { owner: ch.owner, kind: ch.kind || "fix", chip: ch.id });
        } else if (padState.dim === "swing") {
          SW.swingOf(it).clearanceIn = SW.fmtFrac(total);
        } else if (/^pnl:/.test(padState.dim)) {
          var pp = padState.dim.split(":");
          (it.panels || []).forEach(function (p) { if (p.id === pp[1]) p[pp[2]] = SW.fmtFrac(total); });
        } else if (padState.dim === "panelthick") {
          it.panelThicknessIn = SW.fmtFrac(total);
        } else if (/^prep:/.test(padState.dim)) {
          var pq = padState.dim.split(":");
          SW.setPrepMeas(it, pq[1], pq[2], SW.fmtFrac(total));
        } else if (/^flush:/.test(padState.dim)) {
          var fk = padState.dim.split(":")[1];
          SW.flushOf(it)[fk] = SW.fmtFrac(total);
          SW.syncFlush(it);
        } else if (/^form:/.test(padState.dim)) {
          SW.setFormVal(it, padState.dim.split(":")[1], total);
        } else if (padState.dim === "obstruction") {
          /* Same pad, different destination: how far the pipe or stub stands
             out of the back wall. */
          SW.obstructionOf(it).projectsIn = SW.fmtFrac(total);
        } else if (padState.dim === "gap") {
          SW.setRunGap(it, "cabinet", SW.fmtFrac(total)); applyRunGap(it);
        } else if (padState.point != null) {
          it.points[padState.dim][padState.point] = SW.fmtFrac(total);
          SW.syncPoints(it);
          advancePoint(it, padState.dim);
        } else {
          it.actual[padState.dim] = SW.fmtFrac(total);
          advance(it);
        }
        autosave();
      }
      padState.open = false; render(); return;
    }

    if (act === "basispick" && it) {
      tick();
      SW.applyBasis(it, t.getAttribute("data-k"));
      openDim = null; advance(it); autosave(); render(); return;
    }
    if (act === "basisclear" && it) { it.basisKey = ""; it.basisConfirmed = ""; autosave(); render(); return; }
    if (act === "basisconfirm" && it) {
      var v = t.getAttribute("data-v");
      it.basisConfirmed = it.basisConfirmed === v ? "" : v;
      autosave(); render(); return;
    }
    if (act === "status" && it) {
      tick();
      var sk = t.getAttribute("data-k");
      SW.setStatus(it, sk);
      if (!it.conclusion) it.conclusion = "";
      autosave(); render(); return;
    }
    if (act === "chip" && it) {
      tick();
      var cid = t.getAttribute("data-id");
      var chip = SW.CHIP_BY[cid] || SW.chipsFor(it).primary.concat(SW.chipsFor(it).more).filter(function (c) { return c.id === cid; })[0];
      if (!chip) return;
      /* already on: take it off, whatever number it was filled with */
      var existing = it.actions.filter(function (a) { return a.chip === cid || a.text === chip.t; })[0];
      if (existing) { SW.removeAction(it, existing.id); autosave(); render(); return; }
      if (SW.chipHasSlot(chip)) {
        padState = { open: true, dim: "chip", point: null, whole: "", frac: null, chip: chip };
        render(); return;
      }
      SW.addAction(it, chip.t, { owner: chip.owner, kind: chip.kind || "fix", chip: chip.id });
      autosave(); render(); return;
    }
    if (act === "chipfilter") { chipOwnerFilter = t.getAttribute("data-o") || ""; if (chipOwnerFilter === "-") chipOwnerFilter = "none"; render(); return; }
    if (act === "unchip" && it) {
      SW.removeAction(it, t.getAttribute("data-id"));
      autosave(); render(); return;
    }
    if (act === "actsev" && it) {
      tick();
      var sk2 = t.getAttribute("data-key");
      var row = SW.corrections(it).filter(function (a) { return (a.key || a.id) === sk2; })[0];
      if (!row) return;
      var next = row.severity === "cosmetic" ? "blocks" : "cosmetic";
      if (row.derived) SW.setFixMeta(it, row.key, { severity: next });
      else it.actions.forEach(function (a) { if (a.id === sk2) a.severity = next; });
      autosave(); render(); return;
    }
    if (act === "addcustom" && it) {
      var inp = document.getElementById("sw-custom-act");
      var txt = inp ? inp.value.trim() : "";
      if (!txt) return;
      SW.addAction(it, txt, { owner: "builder" });
      tick(); autosave(); render(); return;
    }
    if (act === "addquestion" && it) {
      var inq = document.getElementById("sw-custom-q");
      var q = inq ? inq.value.trim() : "";
      if (!q) return;
      SW.addAction(it, q, { owner: "builder", kind: "question" });
      tick(); autosave(); render(); return;
    }
    if (act === "morechips") { showMoreChips = !showMoreChips; render(); return; }
    if (act === "togglenote") {
      var f2 = document.getElementById("sw-note-field");
      if (f2) {
        f2.classList.toggle("hidden");
        var ta = f2.querySelector("textarea");
        if (ta && !f2.classList.contains("hidden")) ta.focus();
      }
      return;
    }
    if (act === "delphoto" && it) {
      var pi = +t.getAttribute("data-i");
      var gone = it.photos.splice(pi, 1)[0];
      if (gone) SW.removePhoto(gone.id);
      /* The marks are measured against that frame; without it they mean
         nothing, so they go with it. */
      if (gone && it.overlay && it.overlay.photoId === gone.id) it.overlay = null;
      autosave(); render(); return;
    }
  }


  /* The thumbnail is enough to place a pin, but not enough to see a
     receptacle: swap the archive frame in as soon as it comes back. */
  function loadFullPhoto(it) {
    var id = it.overlay && it.overlay.photoId;
    if (!id || markFull.id === id) return;
    var p0 = (it.photos || []).filter(function (p) { return p.id === id; })[0];
    SW.photoUrl(id, { walkId: walkId, portalId: p0 && p0.portalId }).then(function (url) {
      if (!url) return;
      markFull = { id: id, url: url };
      render();
    }).catch(function () { });
  }

  function onChange(e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute("data-act") === "actowner") {
      var it0 = item(); if (!it0) return;
      var key0 = el.getAttribute("data-key");
      var row0 = SW.corrections(it0).filter(function (a) { return (a.key || a.id) === key0; })[0];
      if (!row0) return;
      if (row0.derived) SW.setFixMeta(it0, row0.key, { owner: el.value });
      else it0.actions.forEach(function (a) { if (a.id === key0) a.owner = el.value; });
      autosave(); render(); return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "accessphotoin") {
      var af = el.files && el.files[0];
      el.value = "";
      if (!af) return;
      var aw = walk();
      SW.putPhoto(af, { walkId: walkId, itemId: "", checkName: "Jobsite access", technician: aw.walkedBy })
        .then(function (stored) {
          SW.accessOf(aw).photos.push({ id: stored.id, portalId: stored.portalId || "",
            thumb: stored.thumb, caption: "", checkName: "Jobsite access" });
          autosave(); SW.drainPhotos(); render();
        })
        .catch(function () { ui.toast("Photo not saved", "That image could not be read. Try again."); render(); });
      return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "reachphotoin") {
      var pf = el.files && el.files[0], pplane = el.getAttribute("data-plane");
      el.value = "";
      if (!pf) return;
      var pit = item(), pold = SW.planeOverlay(pit, pplane);
      SW.putPhoto(pf, { walkId: walkId, itemId: pit.id, checkName: SW.itemTitle(pit) + " — " + SW.planeWord(pit, pplane), technician: walk().walkedBy })
        .then(function (stored) {
          if (pold && pold.photoId) { SW.removePhoto(pold.photoId); pit.photos = pit.photos.filter(function (p) { return p.id !== pold.photoId; }); }
          pit.photos.push({ id: stored.id, portalId: stored.portalId || "", thumb: stored.thumb, caption: "", checkName: SW.itemTitle(pit) + " — " + SW.planeWord(pit, pplane) });
          pit.planePhotos = pit.planePhotos || {};
          pit.planePhotos[pplane] = { photoId: stored.id, portalId: stored.portalId || "", thumb: stored.thumb, corners: [], marks: {}, size: (pold && pold.size) || {} };
          tick(12);
          autosave(); SW.drainPhotos(); render();
        })
        .catch(function () { ui.toast("Photo not saved", "That image could not be read. Try again."); render(); });
      return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "markphotoin") {
      var mf = el.files && el.files[0];
      el.value = "";
      if (!mf) return;
      var mit = item();
      SW.putPhoto(mf, { walkId: walkId, itemId: mit.id, checkName: SW.itemTitle(mit) + " — opening", technician: walk().walkedBy })
        .then(function (stored) {
          /* a retake replaces the frame — the wrong one does not linger as
             a "related" photo */
          if (mit.overlay && mit.overlay.photoId) {
            var oldId = mit.overlay.photoId;
            mit.photos = mit.photos.filter(function (p) { return p.id !== oldId; });
            SW.removePhoto(oldId);
          }
          /* The same frame the packet prints: one photograph, marked. */
          mit.photos.push({ id: stored.id, portalId: stored.portalId || "", thumb: stored.thumb,
            caption: "", checkName: SW.itemTitle(mit) + " — opening face" });
          mit.overlay = { photoId: stored.id, thumb: stored.thumb, corners: [], marks: {} };
          markFull = { id: "", url: "" };
          loadFullPhoto(mit);
          autosave(); SW.drainPhotos(); render();
        })
        .catch(function () { ui.toast("Photo not saved", "That image could not be read. Try again."); render(); });
      return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "photoin") {
      /* An extra photograph never displaces the calibrated frame. */
      var f = el.files && el.files[0];
      el.value = "";
      if (!f) return;
      var it = item();
      var label = el.closest("label");
      if (label) label.querySelector("span").textContent = "Saving photo…";
      SW.putPhoto(f, { walkId: walkId, itemId: it.id, checkName: SW.itemTitle(it), technician: walk().walkedBy })
        .then(function (stored) {
          it.photos.push({ id: stored.id, portalId: stored.portalId || "", thumb: stored.thumb, caption: "", checkName: SW.itemTitle(it) });
          autosave(); SW.drainPhotos(); render();
        })
        .catch(function () { ui.toast("Photo not saved", "That image could not be read. Try again."); render(); });
    }
  }

  function onInput(e) {
    var psEl = e.target;
    if (psEl.getAttribute && psEl.getAttribute("data-pin")) {
      /* the inches under a pin, typed over: the pin moves on the drawing */
      var pIt = item(); if (!pIt) return;
      var pk = psEl.getAttribute("data-pin"), pin = SW.pinOf(pIt, pk), pv = SW.num(psEl.value);
      if (!pin || pv == null) return;
      SW.setPin(pIt, pk, pin.plane, psEl.getAttribute("data-f") === "x" ? pv : pin.x, psEl.getAttribute("data-f") === "y" ? pv : pin.y);
      SW.syncUtilities(pIt); autosave(); redrawBox();
      return;
    }
    if (psEl.getAttribute && psEl.getAttribute("data-planesize")) {
      /* the size the tech typed for a cabinet added to the run */
      var sIt = item(); if (!sIt) return;
      var spk = psEl.getAttribute("data-planesize"), spp = sIt.planePhotos && sIt.planePhotos[spk];
      if (!spp) return;
      spp.size = spp.size || {}; spp.size[psEl.getAttribute("data-f")] = psEl.value;
      autosave(); redrawBox();
      return;
    }
    var pnEl = e.target;
    if (pnEl.getAttribute && pnEl.getAttribute("data-prepnote")) {
      var pnIt = item(); if (!pnIt) return;
      pnIt.prepChecks = pnIt.prepChecks || {};
      var pnId = pnEl.getAttribute("data-prepnote");
      pnIt.prepChecks[pnId] = Object.assign({}, pnIt.prepChecks[pnId] || { state: "wrong" }, { note: pnEl.value });
      autosave(); return;
    }
    var el = e.target, field = el.getAttribute && el.getAttribute("data-field");
    if (!field) return;
    if (field === "accessnote") {
      var w = walk();
      if (w) { SW.accessOf(w).note = el.value; autosave(); }
      return;
    }
    var it = item();
    if (!it) return;
    it[field] = el.value;
    autosave();
  }

  /* ---------- the walk the office already set up --------------------------
     "It is not intuitive how to get a site walk to load at all." That was
     August, and the answer then was a path through the office screen —
     which works on one device and not at all on a phone that has never
     seen the walk. The office now builds walks from the spec package, so
     the phone's first screen has to be the list of walks waiting for it. */
  var offers = null, offerBusy = false, offerMsg = "", offerHeld = null;

  function loadOffers(force) {
    if (offerBusy || (offers && !force)) return;
    offerBusy = true;
    SW.pullWalks().then(function (res) {
      offerBusy = false;
      offers = res.ok ? res.offers : [];
      offerHeld = res.ok ? res.held : null;
      if (!res.ok) offerMsg = res.reason === "no portal"
        ? "This build carries its walks in the link itself — ask the office to send you the current link."
        : "Cannot reach " + SW.apiUrl("serverName", "the shop server") + " from here. A walk already on this phone still works offline.";
      render();
    }).catch(function () { offerBusy = false; offers = []; render(); });
  }

  /* A walk someone means to do: it has openings, and its walk date, its
     last edit or its arrival is within two weeks. Anything else is history
     and folds under "Earlier". */
  var OFFER_FRESH_DAYS = 14, showOldOffers = false, offerTaking = false;
  function offerCurrent(o) {
    if (!(+o.openings > 0)) return false;
    var cut = new Date(Date.now() - OFFER_FRESH_DAYS * 864e5).toISOString().slice(0, 10);
    return [(o.walk && o.walk.walkDate) || o.walkDate, o.updatedAt, o.syncedAt].some(function (d) { return d && String(d).slice(0, 10) >= cut; });
  }
  function walkMeta(jobNo, builder, walkDate, tail) {
    return [jobNo, builder, walkDate ? ui.shortDate(walkDate) : "", tail].filter(Boolean).join(" · ");
  }
  function offerRow(o) {
    var i = offers.indexOf(o), st = SW.offerState(o), w = { walkDate: (o.walk && o.walk.walkDate) || o.walkDate || "" };
    var label = st.kind === "new" ? "Open"
      : st.kind === "same" ? "On this phone"
      : st.kind === "mine-newer" ? "This phone is newer"
      : "Replace with office copy";
    var tone = st.kind === "mine-newer" ? " warn" : (st.kind === "same" ? " done" : "");
    var title = o.project || o.jobNo || "Untitled walk";
    return '<div class="sw-offer' + tone + '">' +
      "<div><strong>" + esc(title) + "</strong>" +
      "<span>" + esc(walkMeta(o.project ? o.jobNo : "", o.builder, w.walkDate, o.openings + " opening" + (+o.openings === 1 ? "" : "s"))) + "</span>" +
      (o.address ? '<span class="sw-offer-addr">' + esc(o.address) + "</span>" : "") + "</div>" +
      (st.kind === "same" || st.kind === "mine-newer"
        ? "<em>" + esc(label) + "</em>"
        : '<button class="button small" data-act="takeoffer" data-i="' + i + '" aria-label="Open ' + esc(title) + ' on this phone">' + esc(label) + "</button>") +
      "</div>";
  }

  function pickerScreen() {
    var mine = SW.walks();
    var h = '<section class="tech-visit-head"><span class="eyebrow">Pre-delivery site walk</span>' +
      "<h1>Pick up a walk</h1>" +
      "<p>Walks the office has set up for you, plus anything already on this phone.</p></section>";

    if (mine.length) {
      h += '<section class="tech-area"><div class="tech-area-heading"><div><h2>On this phone</h2>' +
        "<p>Already here — works with no signal.</p></div></div>" +
        '<div class="stack" style="gap:8px">' + mine.map(function (w) {
          var r = SW.rollup(w);
          return '<a class="sw-pick" href="' + SW.nav("field", w.id) + '">' +
            "<span><strong>" + esc(w.project || w.jobNo || "Untitled walk") + "</strong>" +
            "<em>" + esc(walkMeta(w.project ? w.jobNo : "", w.builder, w.walkDate, r.done + " of " + r.total + " walked")) + "</em></span>" +
            "<b>Open →</b></a>";
        }).join("") + "</div></section>";
    }

    h += '<section class="tech-area"><div class="tech-area-heading"><div><h2>From the office</h2>' +
      "<p>" + (offerBusy ? "Checking " + esc(SW.apiUrl("serverName", "the shop server")) + "…" : "Set up at the desk from the spec package.") +
      "</p></div>" +
      '<button class="button ghost small" data-act="refreshoffers">Refresh</button></div>';

    if (offers === null || offerBusy) {
      h += '<div class="card card-pad" style="color:var(--muted);font-size:13px">Looking…</div>';
    } else if (!offers.length) {
      /* say what the server holds, so "nothing waiting" can be told apart
         from "the office's walk never arrived" (22 Oct) */
      var hd = offerHeld, why = "";
      if (hd && !offerMsg) {
        why = hd.total ? " This server holds " + hd.total + " walk" + (hd.total === 1 ? "" : "s") + " in all" +
          (hd.packetSent ? ", " + hd.packetSent + " already sent as packets" : "") + (hd.noDocument ? ", " + hd.noDocument + " without a walk document" : "") +
          (hd.lastSyncedAt ? "; the last arrived " + esc(String(hd.lastSyncedAt).replace("T", " ").slice(0, 16)) : "") + "."
          : " This server has never received a walk — check the office page's bottom banner: if it says Could not send, the office is talking to a different server or none.";
      }
      h += '<div class="card card-pad" style="color:var(--muted);font-size:13px">' +
        esc(offerMsg || "Nothing waiting. When the office builds a walk from a spec package it appears here.") + why +
        "</div>";
    } else {
      /* v0.9.82: the walks to do, then everything else folded away. On
         9 Nov thirteen of sixteen cards were October's test walks, each with
         a full-width button, and none said which job or which day. */
      var cur = offers.filter(offerCurrent), old = offers.filter(function (o) { return !offerCurrent(o); });
      cur.sort(function (a, b) {
        var da = (a.walk && a.walk.walkDate) || a.walkDate || "9999", db = (b.walk && b.walk.walkDate) || b.walkDate || "9999";
        return da < db ? -1 : da > db ? 1 : 0;
      });
      if (cur.length) h += '<div class="stack sw-offer-list">' + cur.map(offerRow).join("") + "</div>";
      else h += '<div class="card card-pad" style="color:var(--muted);font-size:13px">Nothing new from the office in the last two weeks.</div>';
      if (old.length) {
        var openOld = showOldOffers || !cur.length;
        h += '<button class="sw-offer-old" data-act="oldoffers" aria-expanded="' + openOld + '">' +
          "<span>Earlier · " + old.length + " walk" + (old.length === 1 ? "" : "s") + "</span><b>" + (openOld ? "Hide" : "Show") + "</b></button>" +
          (openOld ? '<div class="stack sw-offer-list">' + old.map(offerRow).join("") + "</div>" : "");
      }
    }
    h += "</section>";

    if (!mine.length && (!offers || !offers.length)) {
      h += '<div class="card card-pad" style="margin-top:14px">' +
        '<p style="margin:0;color:var(--muted);font-size:13px">Nothing to walk yet. The office loads the job\'s Steel Cod spec package, ' +
        "verifies the openings, and the walk lands here with every install sheet attached.</p></div>";
    }
    return h;
  }

  function render() {
    route();
    var w = walk();
    if (!w || pickView) {
      loadOffers();
      HOST.innerHTML = pickerScreen();
      return;
    }
    /* a repaint is not a navigation: the page stays where the tech left it */
    scrollKeep = window.scrollY || window.pageYOffset || 0;
    if (accessView) renderAccess();
    else if (itemId) renderItem();
    else renderHome();
    if (scrollKeep != null) { var yk = scrollKeep; try { window.scrollTo({ top: yk, left: 0, behavior: "instant" }); } catch (e) { try { window.scrollTo(0, yk); } catch (e2) { } } }
    /* After the paint, not before: sheetsStart calls render() itself when it
       has something new to say, and starting it first would recurse. */
    if (sheetWalk !== w.id) sheetsStart(false);
  }

  function mount(host) {
    HOST = host;
    document.body.classList.add("tech-mode");
    host.addEventListener("click", onClick);
    host.addEventListener("change", onChange, true);
    host.addEventListener("input", onInput, true);
    host.addEventListener("pointerdown", function (e) { muDown(e); });
    host.addEventListener("pointermove", function (e) { drawMove(e); muMove(e); });
    host.addEventListener("pointerup", function (e) { drawUp(e); muUp(e); });
    host.addEventListener("pointercancel", function (e) { drawUp(e); muUp(e); });
    host.addEventListener("touchmove", stageTouch, { passive: false });
    host.addEventListener("gesturestart", stageTouch, { passive: false });
    host.addEventListener("gesturechange", stageTouch, { passive: false });
    host.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.id === "sw-mu-input") { e.preventDefault(); var b = HOST.querySelector('[data-act="mutextok"]'); if (b) b.click(); }
    });
    window.addEventListener("hashchange", function () {
      var before = itemId;
      route();
      if (before !== itemId) {
        openDim = null; openPoint = null; showMoreChips = false; acceptDim = null;
        stepKey = null; pinKey = null; drawZoom = { z: 1, x: 0, y: 0 }; boxView = { yaw: SW.BOX_VIEW.yaw, pitch: SW.BOX_VIEW.pitch }; boxFull = false; document.body.classList.remove("sw-draw-locked"); padState.open = false; markFull = { id: "", url: "" };
        specOpen = false; specFull = { id: "", url: "" };
      }
      render();
      window.scrollTo(0, 0);
    });
    render();
    /* v0.9.83: "launch the walk on a phone" is a link to it. A phone that has
       never held the walk fetches it and keeps its own copy — the copy is what
       lets the walk go on with no signal — without a separate Load step. The
       install sheets start coming down the same way they do after Load. */
    SW.whoAmI();
    SW.tidyHeld();          /* walks already sent, with nothing here to send, reopen from the server */
    offlineCheck();
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.addEventListener("controllerchange", function () { offlineCheck(); render(); });
      navigator.serviceWorker.ready.then(function () { setTimeout(function () { var was = offlineState; offlineCheck(); if (was !== offlineState) render(); }, 600); }).catch(function () { });
    }
    if (offlineState) render();
    var asked = new URLSearchParams(location.search).get("walk");
    if (asked && SW.hasPortal() && !SW.walk(asked)) {
      SW.ensureWalk(asked).then(function (got) {
        if (!got) return;
        ui.toast("Walk loaded", got.items.length + " openings. Saving the install sheets to this phone now — stay connected a moment.");
        sheetWalk = ""; sheetState = null;
        render();
      });
    }
  }

  window.WILSON_SW_FIELD = { mount: mount, render: render };
})();
