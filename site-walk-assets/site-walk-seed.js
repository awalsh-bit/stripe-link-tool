/* Wilson Site Walk — demo seed.

   NOT LOADED AUTOMATICALLY ANY MORE.

   This was seeding a walk called "1415 Palomino" dated 2026-08-10, carried over
   from the manual August packet with its field measurements already filled in.
   On a fresh phone that is the first thing the tech sees, and it looks exactly
   like a live walk: eleven openings, statuses set, dimensions populated.

   A tech who opens it and starts measuring is typing over August's numbers, and
   every opening they do not touch still carries August's reading and still
   counts as walked. The packet would then go to a builder with today's date on a
   mix of today's and August's measurements. There is no way to spot that from
   the document.

   So the demo is now opt-in: the office queue offers "Load the example walk"
   when the queue is empty. A blank queue is the correct state for a tool whose
   whole job is to be trusted. */
window.WILSON_SW_DEMO =  {
 "walks": [
  {
   "id": "walk_palomino",
   "jobNo": "S00063887",
   "project": "1415 Palomino",
   "builder": "Palomino Custom Homes",
   "builderContact": "Site Superintendent",
   "builderEmail": "",
   "address": "1415 Palomino",
   "walkDate": "2026-08-10",
   "walkedBy": "Cayden Mayfield",
   "specSource": "Steel Cod Full Spec Package S00063887 v3.3",
   "note": "Example walk carried over from the manual 1415 Palomino packet and bound to the Steel Cod spec book, so every installation basis is on record. Delete it once your first live walk is loaded.",
   "packageModels": [
    {
     "model": "DEU2450CI/L",
     "pages": "pp.4-7"
    },
    {
     "model": "DW2451",
     "pages": "pp.8-17"
    },
    {
     "model": "SPO3050TE/S/T",
     "pages": "pp.18-21"
    },
    {
     "model": "WM6500HWA",
     "pages": "pp.22-25"
    },
    {
     "model": "DLEX6500W",
     "pages": "pp.26-30"
    },
    {
     "model": "CL4850SID/O",
     "pages": "pp.31-45"
    },
    {
     "model": "WKEX300HBA",
     "pages": "pp.46-52"
    },
    {
     "model": "MSER0990S",
     "pages": "pp.53-54"
    },
    {
     "model": "TUR-24-L-OP-C",
     "pages": "pp.55-56"
    },
    {
     "model": "TUF-24-R-OP-C",
     "pages": "pp.57-58"
    }
   ],
   "items": [
    {
     "id": "op_wt",
     "area": "Main house",
     "location": "First-floor laundry closet",
     "brand": "LG",
     "model": "WKEX300HBA",
     "appliance": "WashTower",
     "installType": "Freestanding / closet",
     "specRef": "pp.46\u201352",
     "category": "laundry_center",
     "spec": {
      "w": "",
      "d": "",
      "h": ""
     },
     "actual": {
      "w": "",
      "d": "",
      "h": ""
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "freestanding",
     "basisConfirmed": "",
     "status": "decision",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Confirm the model selection so the unit can be released for delivery."
     ],
     "question": "Which WashTower do you want set in the first-floor closet?",
     "options": [
      "Keep WKEX300HBA \u2014 sits about 3 1/8\" proud of the cabinet faces.",
      "Switch to WKEX200HBA \u2014 about 7/8\" proud, saves 2 1/4\"; washer is 4.5 cu. ft."
     ],
     "notes": "Cabinet depth to the faces is 32 1/2\". An unused gas line stub projects 3\" from the back wall and establishes the appliance setback.\nDryer exhaust is recessed; top and sides are open.",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_cl48",
     "area": "Main house",
     "location": "Kitchen run",
     "brand": "Sub-Zero",
     "model": "CL4850SID/O",
     "appliance": "48\" refrigerator",
     "installType": "Flush inset",
     "specRef": "p.33",
     "category": "refrigeration",
     "spec": {
      "w": "50",
      "d": "26 3/16",
      "h": "84"
     },
     "actual": {
      "w": "50",
      "d": "26 3/4",
      "h": "83 3/4"
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "flush-inset",
     "basisConfirmed": "yes",
     "status": "verify",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Remove floor protection and remeasure before set.",
      "Confirm the water supply lands in the illustrated floor zone."
     ],
     "question": "",
     "options": [],
     "notes": "Electrical box sits roughly 7\" to 11\" below the top of the opening \u2014 lower than the illustrated upper-right zone.\nThe extra opening depth may carry both connections; confirm routing at set.",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_dwl",
     "area": "Main house",
     "location": "Sink cabinet \u2014 left",
     "brand": "Cove",
     "model": "DW2451",
     "appliance": "Dishwasher (left)",
     "installType": "24\" install",
     "specRef": "p.11",
     "category": "dishwasher",
     "spec": {
      "w": "24",
      "d": "24",
      "h": "34 1/2"
     },
     "actual": {
      "w": "24",
      "d": "25",
      "h": "34 3/4"
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "24in",
     "basisConfirmed": "yes",
     "status": "ready",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Route plumbing and electrical through the adjacent cabinet."
     ],
     "question": "",
     "options": [],
     "notes": "Panel width 23 3/4\". The 60 cm detail on p.9 wants a 23 5/8\" opening and must not be used here.",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_dwr",
     "area": "Main house",
     "location": "Sink cabinet \u2014 right",
     "brand": "Cove",
     "model": "DW2451",
     "appliance": "Dishwasher (right)",
     "installType": "24\" install",
     "specRef": "p.11",
     "category": "dishwasher",
     "spec": {
      "w": "24",
      "d": "24",
      "h": "34 1/2"
     },
     "actual": {
      "w": "24",
      "d": "25",
      "h": "34 3/4"
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "24in",
     "basisConfirmed": "yes",
     "status": "ready",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Route plumbing and electrical through the adjacent cabinet."
     ],
     "question": "",
     "options": [],
     "notes": "",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_mw",
     "area": "Main house",
     "location": "Location not identified",
     "brand": "LG",
     "model": "MSER0990S",
     "appliance": "Countertop microwave",
     "installType": "Countertop",
     "specRef": "pp.53\u201354",
     "category": "microwave",
     "spec": {
      "w": "",
      "d": "",
      "h": ""
     },
     "actual": {
      "w": "",
      "d": "",
      "h": ""
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "countertop",
     "basisConfirmed": "",
     "status": "decision",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Confirm the outlet location \u2014 none found in the adjacent cabinet."
     ],
     "question": "Where does the countertop microwave land, and is the dedicated outlet confirmed?",
     "options": [],
     "notes": "Countertop model, no trim kit. Exterior 18\" W x 11\" H x 14 1/2\" D; keep 4\" clearance top, sides and back.",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_spo",
     "area": "Apartment",
     "location": "Bar wall",
     "brand": "Wolf",
     "model": "SPO3050TE/S/T",
     "appliance": "Speed oven",
     "installType": "Flush inset",
     "specRef": "p.19",
     "category": "ovens",
     "spec": {
      "w": "30 1/8",
      "d": "24",
      "h": "18 1/8"
     },
     "actual": {
      "w": "30 1/8",
      "d": "23 1/2",
      "h": "18 1/4"
     },
     "rule": {
      "w": "min",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "flush",
     "basisConfirmed": "yes",
     "status": "modify",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Remove or omit the cabinet back to gain depth.",
      "Add the dedicated 240/208 VAC 15 A supply, NEMA 6-20R, inside the opening.",
      "Add finished cleats inside the opening \u2014 they are visible and must match the cabinetry."
     ],
     "question": "",
     "options": [],
     "notes": "Verified against the FLUSH detail (p.19). The standard detail on p.21 wants a 22 1/8\" x 23\" x 17 11/16\" cutout and does not apply to this opening.",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_deu",
     "area": "Apartment",
     "location": "Bar undercounter",
     "brand": "Sub-Zero",
     "model": "DEU2450CI/L",
     "appliance": "Undercounter refrigerator",
     "installType": "Standard",
     "specRef": "p.5",
     "category": "refrigeration",
     "spec": {
      "w": "24",
      "d": "24",
      "h": "34 1/2"
     },
     "actual": {
      "w": "24",
      "d": "24 1/4",
      "h": "34 3/4"
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "standard",
     "basisConfirmed": "yes",
     "status": "decision",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Confirm the hinge direction before the unit is ordered."
     ],
     "question": "Confirm the left hinge on the DEU2450CI/L.",
     "options": [
      "Keep the left hinge \u2014 door opens away from the adjacent wall.",
      "Switch to the right hinge."
     ],
     "notes": "",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_adw",
     "area": "Apartment",
     "location": "Sink cabinet",
     "brand": "Cove",
     "model": "DW2451",
     "appliance": "Dishwasher",
     "installType": "24\" install",
     "specRef": "p.11",
     "category": "dishwasher",
     "spec": {
      "w": "24",
      "d": "24",
      "h": "34 1/2"
     },
     "actual": {
      "w": "24",
      "d": "24 1/4",
      "h": "35"
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "24in",
     "basisConfirmed": "yes",
     "status": "ready",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Route plumbing and electrical through the adjacent cabinet."
     ],
     "question": "",
     "options": [],
     "notes": "",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_alaun",
     "area": "Apartment",
     "location": "Laundry wall",
     "brand": "LG",
     "model": "WM6500HWA + DLEX6500W",
     "appliance": "Side-by-side laundry",
     "installType": "Freestanding / closet",
     "specRef": "pp.22\u201330",
     "category": "washer",
     "spec": {
      "w": "",
      "d": "",
      "h": ""
     },
     "actual": {
      "w": "",
      "d": "",
      "h": ""
     },
     "rule": {
      "w": "exact",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "freestanding",
     "basisConfirmed": "",
     "status": "verify",
     "conclusion": "",
     "punch": "",
     "actions": [
      "Confirm the standpipe and floor drain arrangement."
     ],
     "question": "",
     "options": [],
     "notes": "Wall run measures 60\" wide with 33\" of depth and 40\" of height available. Units are freestanding \u2014 no rough opening applies.",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_tur",
     "area": "Apartment",
     "location": "Bar undercounter \u2014 right",
     "brand": "True",
     "model": "TUR-24-L-OP-C",
     "appliance": "24\" overlay undercounter refrigerator",
     "installType": "Overlay / integrated",
     "specRef": "p.56",
     "category": "refrigeration",
     "spec": {
      "w": "24",
      "d": "24",
      "h": "34 1/2"
     },
     "actual": {
      "w": "",
      "d": "",
      "h": ""
     },
     "rule": {
      "w": "min",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "overlay",
     "basisConfirmed": "",
     "status": "",
     "conclusion": "",
     "punch": "",
     "actions": [],
     "question": "",
     "options": [],
     "notes": "",
     "photos": [],
     "pageBreak": "own"
    },
    {
     "id": "op_tuf",
     "area": "Apartment",
     "location": "Bar undercounter \u2014 far right",
     "brand": "True",
     "model": "TUF-24-R-OP-C",
     "appliance": "24\" overlay undercounter freezer",
     "installType": "Overlay / integrated",
     "specRef": "p.58",
     "category": "refrigeration",
     "spec": {
      "w": "24",
      "d": "24",
      "h": "34 1/2"
     },
     "actual": {
      "w": "",
      "d": "",
      "h": ""
     },
     "rule": {
      "w": "min",
      "d": "min",
      "h": "min"
     },
     "tol": "",
     "basisKey": "overlay",
     "basisConfirmed": "",
     "status": "",
     "conclusion": "",
     "punch": "",
     "actions": [],
     "question": "",
     "options": [],
     "notes": "",
     "photos": [],
     "pageBreak": "own"
    }
   ],
   "sentAt": "",
   "sentTo": "",
   "createdAt": "2026-08-10T14:00:00.000Z",
   "updatedAt": "2026-08-10T18:20:00.000Z"
  }
 ]
};
