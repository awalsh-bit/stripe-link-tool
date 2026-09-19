"""Turn the real 9/17 SV export (+ the 9/10 DispatchTrack snapshot) into the sample data the three prototypes use.

    python3 realdata.py            -> writes realdata.json with {jobs, blocks, zips, techs, meta}

Sources
  ExportInvoice_20260917_current_sv.xlsx   615 open SV tickets (was 460 on 9/15 — this pull also carries the WAR4 /
                                           WARADMIN / WARPROBLEM warranty-admin queue): status, route (SP), sched
                                           date, customer, address, zip, map zone, balance/total, model/serial/brand,
                                           units, priorities.
  route_order_0917.json                    the stop order the dispatchers left in ePASS Routing for 9/17 and 9/18,
                                           transcribed from screenshots — the export has no sequence column.
  DispatchTrackDetail_20260910_220003.csv  the 9/10 routing snapshot: ePASS category code, problem text, gate/access
                                           notes and lat/lng for the 170 tickets still open — joined on SV.

What is real and what is derived is recorded per job in `src` so the prototypes can say so.
"""
from __future__ import annotations

import collections
import csv
import datetime as _dt
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "repo", "reference")
EI = os.path.join(REF, "data", "ExportInvoice_20260917_current_sv.xlsx")
ORDER = os.path.join(REF, "route_order_0917.json")
DT = os.path.join(REF, "data", "DispatchTrackDetail_20260910_220003.csv")
TODAY = _dt.date(2026, 9, 17)
WEEK = [(TODAY - _dt.timedelta(days=3) + _dt.timedelta(days=i)).isoformat() for i in range(5)]  # Mon 9/14 .. Fri 9/18

# ---------------------------------------------------------------- appliance category
# ePASS category codes (DispatchTrack 'Order Detail' first token) -> (label, install type)
CODE = {
    "REFRE": ("refrigerator", "free"), "REALL": ("refrigerator", "free"), "RESXS": ("side-by-side refrigerator", "free"),
    "REBFD": ("french-door refrigerator", "free"), "RETOP": ("top-freezer refrigerator", "free"), "REBOT": ("bottom-freezer refrigerator", "free"),
    "REBIS": ("built-in refrigerator", "built"), "REBIF": ("built-in refrigerator", "built"), "REBIR": ("built-in refrigerator", "built"),
    "REBIC": ("refrigerator column", "built"), "REBIB": ("built-in refrigerator", "built"), "REUC": ("undercounter refrigerator", "built"),
    "REDRA": ("refrigerator drawers", "built"), "REFWI": ("wine refrigerator", "built"), "FREEZ": ("freezer", "free"),
    "IMUC": ("undercounter ice maker", "built"), "ICEMK": ("ice maker", "built"), "IMFS": ("ice maker", "free"),
    "DW": ("dishwasher", "built"), "DISHW": ("dishwasher", "built"), "DWDRA": ("dishwasher drawers", "built"),
    "WASHF": ("front-load washer", "free"), "WASHT": ("top-load washer", "free"), "WASH": ("washer", "free"), "WDCOM": ("washer-dryer combo", "free"),
    "DRELE": ("electric dryer", "free"), "DRGAS": ("gas dryer", "free"), "DRYER": ("dryer", "free"), "LAUND": ("laundry center", "free"),
    "RADF": ("dual-fuel range", "free"), "RAGAS": ("gas range", "free"), "RAELE": ("electric range", "free"), "RAPRO": ("pro range", "free"),
    "RANGE": ("range", "free"), "RATOP": ("rangetop", "built"),
    "OVELE": ("wall oven", "built"), "OVDBL": ("double wall oven", "built"), "OVSTE": ("steam oven", "built"), "OVSPE": ("speed oven", "built"),
    "OVMW": ("microwave oven", "built"), "MW": ("microwave", "free"), "MWDR": ("microwave drawer", "built"), "MWOTR": ("over-range microwave", "built"),
    "CTIND": ("induction cooktop", "built"), "CTELE": ("electric cooktop", "built"), "CTGAS": ("gas cooktop", "built"), "CTDD": ("downdraft cooktop", "built"),
    "VHOOD": ("vent hood", "built"), "VHBLO": ("hood blower", "built"), "VHINS": ("hood insert", "built"), "VHDD": ("downdraft vent", "built"),
    "COFFE": ("coffee system", "built"), "WARMD": ("warming drawer", "built"), "TRASH": ("trash compactor", "built"), "DISPO": ("disposal", "built"),
    "GROUT": ("pot filler", "built"), "SPOUT": ("pot filler", "built"), "STAT": ("thermostat", "hvac"),
    "ACCON": ("condenser", "hvac"), "ACAH": ("air handler", "hvac"), "ACFUR": ("furnace", "hvac"), "ACMIN": ("mini-split", "hvac"),
}
# brand code -> readable brand
BRAND = {
    "SZ": "Sub-Zero", "WOLF": "Wolf", "COVE": "Cove", "MIELE": "Miele", "THERM": "Thermador", "BOSCH": "Bosch", "GAGG": "Gaggenau",
    "KA": "KitchenAid", "WP": "Whirlpool", "MTAG": "Maytag", "JA": "Jenn-Air", "GE": "GE", "MGRAM": "Monogram", "CAFE": "Café",
    "PROF": "GE Profile", "LG": "LG", "SAMS": "Samsung", "FRIG": "Frigidaire", "ELEC": "Electrolux", "SPEED": "Speed Queen",
    "FP": "Fisher & Paykel", "VIKING": "Viking", "VIK": "Viking", "DACOR": "Dacor", "ZEPH": "Zephyr", "SCOT": "Scotsman",
    "ULINE": "U-Line", "TRUE": "True", "LIEB": "Liebherr", "BLUE": "BlueStar", "LACOR": "La Cornue", "BEST": "Best",
    "TRANE": "Trane", "CARR": "Carrier", "AMER": "American Standard", "GOODM": "Goodman", "RHEEM": "Rheem", "DAIKIN": "Daikin",
    "MITS": "Mitsubishi", "LENN": "Lennox", "KEN": "Kenmore", "ASKO": "Asko", "SMEG": "Smeg", "AGA": "AGA", "PERL": "Perlick",
    "MARV": "Marvel", "MARVE": "Marvel", "SUBZ": "Sub-Zero", "VAH": "Vent-A-Hood", "GNR": "General", "FULGO": "Fulgor Milano",
    "COYOT": "Coyote", "BSH": "Bosch", "CORFE": "La Cornue", "TFLAM": "Twin Eagles", "FABR": "Faber", "GAGGE": "Gaggenau",
    "TRADE": "Trade", "HEST": "Hestan", "SHARP": "Sharp", "BROAN": "Broan", "VENTA": "Ventahood", "XO": "XO", "FABER": "Faber", "HOSH": "Hoshizaki",
}
# model-prefix rules per brand, tried longest first. (prefix, category label, install type)
MODEL_RULES = {
    "SUB-ZERO": [("700", "built-in refrigerator", "built"), ("600", "built-in refrigerator", "built"), ("BI", "built-in refrigerator", "built"), ("IT", "refrigerator column", "built"), ("IC", "built-in refrigerator", "built"),
                 ("CL", "built-in refrigerator", "built"), ("ID", "refrigerator drawers", "built"), ("DEC", "wine refrigerator", "built"),
                 ("DEU", "undercounter refrigerator", "built"), ("UC", "undercounter refrigerator", "built"), ("UW", "wine refrigerator", "built"),
                 ("PRO", "pro refrigerator", "built"), ("BW", "wine refrigerator", "built")],
    "WOLF": [("SPO", "wall oven", "built"), ("DF", "dual-fuel range", "free"), ("GR", "gas range", "free"), ("IR", "induction range", "free"), ("SRT", "rangetop", "built"),
             ("CG", "gas cooktop", "built"), ("CT", "cooktop", "built"), ("CI", "induction cooktop", "built"), ("SO", "wall oven", "built"),
             ("CSO", "steam oven", "built"), ("DO", "double wall oven", "built"), ("MDD", "microwave drawer", "built"), ("MW", "microwave", "built"),
             ("PW", "vent hood", "built"), ("OG", "outdoor grill", "free"), ("WWD", "warming drawer", "built")],
    "COVE": [("DW", "dishwasher", "built")],
    "MIELE": [("CVA", "coffee system", "built"), ("CS", "cooktop", "built"), ("H4", "wall oven", "built"), ("H8", "wall oven", "built"), ("G7", "dishwasher", "built"), ("G6", "dishwasher", "built"), ("G5", "dishwasher", "built"),
              ("G4", "dishwasher", "built"), ("DG", "steam oven", "built"), ("H6", "wall oven", "built"), ("H7", "wall oven", "built"),
              ("H2", "wall oven", "built"), ("KM", "cooktop", "built"), ("KF", "refrigerator", "built"), ("K7", "refrigerator", "built"),
              ("K2", "refrigerator", "built"), ("F", "freezer", "built"), ("W1", "front-load washer", "free"), ("WW", "front-load washer", "free"),
              ("WX", "front-load washer", "free"), ("TW", "dryer", "free"), ("TX", "dryer", "free"), ("T1", "dryer", "free"),
              ("DA", "vent hood", "built"), ("PUR", "vent hood", "built"), ("29", "coffee system", "built")],
    "THERMADOR": [("PRD", "dual-fuel range", "free"), ("PRG", "gas range", "free"), ("PRO", "pro range", "free"), ("T36", "built-in refrigerator", "built"),
                  ("T30", "refrigerator column", "built"), ("T24", "undercounter refrigerator", "built"), ("T18", "refrigerator column", "built"),
                  ("DWHD", "dishwasher", "built"), ("DW", "dishwasher", "built"), ("ME", "wall oven", "built"), ("MED", "double wall oven", "built"),
                  ("POD", "wall oven", "built"), ("MC", "speed oven", "built"), ("CIT", "induction cooktop", "built"), ("CET", "electric cooktop", "built"),
                  ("SGS", "gas cooktop", "built"), ("PCG", "gas cooktop", "built"), ("HMWB", "microwave", "built"), ("VC", "vent hood", "built"),
                  ("HD", "vent hood", "built"), ("WD", "warming drawer", "built")],
    "BOSCH": [("SHX", "dishwasher", "built"), ("SHE", "dishwasher", "built"), ("SHP", "dishwasher", "built"), ("SHV", "dishwasher", "built"),
              ("SGV", "dishwasher", "built"), ("SGX", "dishwasher", "built"), ("SPE", "dishwasher", "built"), ("SPX", "dishwasher", "built"),
              ("HMC", "speed oven", "built"), ("HMB", "microwave", "built"), ("HBL", "wall oven", "built"), ("HBN", "wall oven", "built"),
              ("HBE", "wall oven", "built"), ("HSL", "range", "free"), ("HGI", "gas range", "free"), ("HEI", "electric range", "free"),
              ("B36", "built-in refrigerator", "built"), ("B30", "built-in refrigerator", "built"), ("B24", "undercounter refrigerator", "built"),
              ("B21", "built-in refrigerator", "built"), ("T36", "refrigerator column", "built"), ("T24", "refrigerator column", "built"),
              ("T18", "refrigerator column", "built"), ("KGN", "refrigerator", "free"), ("NIT", "induction cooktop", "built"),
              ("NET", "electric cooktop", "built"), ("NGM", "gas cooktop", "built"), ("WAT", "front-load washer", "free"), ("WTG", "dryer", "free"),
              ("WAW", "front-load washer", "free"), ("DHD", "vent hood", "built"), ("HUI", "vent hood", "built")],
    "KITCHENAID": [("KRFF", "french-door refrigerator", "free"), ("KRMF", "french-door refrigerator", "free"), ("KRSF", "side-by-side refrigerator", "free"),
                   ("KRSC", "side-by-side refrigerator", "free"), ("KRBR", "bottom-freezer refrigerator", "free"), ("KBSD", "built-in refrigerator", "built"),
                   ("KBSN", "built-in refrigerator", "built"), ("KBFN", "built-in refrigerator", "built"), ("KBBR", "refrigerator column", "built"),
                   ("KUDF", "refrigerator drawers", "built"), ("KUIX", "undercounter ice maker", "built"), ("KUIC", "undercounter ice maker", "built"),
                   ("KUID", "undercounter ice maker", "built"), ("KUWL", "wine refrigerator", "built"), ("KUWR", "wine refrigerator", "built"),
                   ("KDTE", "dishwasher", "built"), ("KDTM", "dishwasher", "built"), ("KDFE", "dishwasher", "built"), ("KDPM", "dishwasher", "built"),
                   ("KDPE", "dishwasher", "built"), ("KDFM", "dishwasher", "built"), ("KOCE", "speed oven", "built"), ("KOSE", "wall oven", "built"),
                   ("KODE", "double wall oven", "built"), ("KOED", "double wall oven", "built"), ("KOST", "wall oven", "built"),
                   ("KMBP", "microwave", "built"), ("KMHC", "over-range microwave", "built"), ("KMMF", "microwave drawer", "built"),
                   ("KFGG", "gas range", "free"), ("KSGB", "gas range", "free"), ("KFID", "induction range", "free"), ("KFED", "electric range", "free"),
                   ("KSEB", "electric range", "free"), ("KFDC", "pro range", "free"), ("KCGS", "gas cooktop", "built"), ("KECC", "electric cooktop", "built"),
                   ("KCIG", "induction cooktop", "built"), ("KVWB", "vent hood", "built"), ("KVUB", "vent hood", "built"), ("KXW", "vent hood", "built"),
                   ("KTTS", "trash compactor", "built"), ("KUCS", "undercounter refrigerator", "built")],
    "WHIRLPOOL": [("WTW", "top-load washer", "free"), ("WFW", "front-load washer", "free"), ("WED", "electric dryer", "free"), ("WGD", "gas dryer", "free"),
                  ("WDT", "dishwasher", "built"), ("WDF", "dishwasher", "built"), ("WDP", "dishwasher", "built"), ("WRF", "french-door refrigerator", "free"),
                  ("WRS", "side-by-side refrigerator", "free"), ("WRX", "french-door refrigerator", "free"), ("WRB", "bottom-freezer refrigerator", "free"),
                  ("WRT", "top-freezer refrigerator", "free"), ("GSS", "side-by-side refrigerator", "free"), ("GSF", "refrigerator", "free"),
                  ("WFE", "electric range", "free"), ("WFG", "gas range", "free"), ("WUI", "undercounter ice maker", "built"),
                  ("WMH", "over-range microwave", "built"), ("WML", "microwave", "free"), ("WVU", "vent hood", "built"), ("INLT", "vent hood", "built")],
    "MAYTAG": [("MVW", "top-load washer", "free"), ("MHW", "front-load washer", "free"), ("MED", "electric dryer", "free"), ("MGD", "gas dryer", "free"),
               ("MDB", "dishwasher", "built"), ("MDP", "dishwasher", "built"), ("MFI", "french-door refrigerator", "free"),
               ("MFF", "french-door refrigerator", "free"), ("MRT", "top-freezer refrigerator", "free"), ("MSS", "side-by-side refrigerator", "free"),
               ("MER", "electric range", "free"), ("MGR", "gas range", "free"), ("MMV", "over-range microwave", "built")],
    "JENN-AIR": [("JMC", "microwave", "built"), ("JGD", "downdraft cooktop", "built"), ("JGRP", "pro gas range", "free"), ("JGR", "gas range", "free"), ("JDRP", "dual-fuel range", "free"), ("JIS", "induction range", "free"),
                 ("JES", "electric range", "free"), ("JDPS", "dishwasher", "built"), ("JDTS", "dishwasher", "built"), ("JDB", "dishwasher", "built"),
                 ("JFFCC", "french-door refrigerator", "free"), ("JFC", "french-door refrigerator", "free"), ("JFX", "french-door refrigerator", "free"),
                 ("JS4", "built-in refrigerator", "built"), ("JS48", "built-in refrigerator", "built"), ("JB", "wall oven", "built"),
                 ("JJW", "wall oven", "built"), ("JMW", "speed oven", "built"), ("JIC", "induction cooktop", "built"), ("JGC", "gas cooktop", "built"),
                 ("JED", "electric cooktop", "built"), ("JXT", "vent hood", "built"), ("JUB", "undercounter refrigerator", "built"),
                 ("JUC", "undercounter refrigerator", "built"), ("JUG", "wine refrigerator", "built")],
    "GE": [("GFW", "front-load washer", "free"), ("GTW", "top-load washer", "free"), ("PFQ", "front-load washer", "free"),
           ("GTD", "electric dryer", "free"), ("GFD", "electric dryer", "free"), ("PTD", "electric dryer", "free"), ("GUD", "laundry center", "free"),
           ("GDT", "dishwasher", "built"), ("GDF", "dishwasher", "built"), ("PDT", "dishwasher", "built"), ("CDT", "dishwasher", "built"),
           ("ZDT", "dishwasher", "built"), ("GFE", "french-door refrigerator", "free"), ("GNE", "french-door refrigerator", "free"),
           ("PFE", "french-door refrigerator", "free"), ("PVD", "french-door refrigerator", "free"), ("CFE", "french-door refrigerator", "free"),
           ("GSS", "side-by-side refrigerator", "free"), ("GSE", "side-by-side refrigerator", "free"), ("GTS", "top-freezer refrigerator", "free"),
           ("FUF", "freezer", "free"), ("FCM", "freezer", "free"), ("ZIS", "built-in refrigerator", "built"), ("ZIC", "built-in refrigerator", "built"),
           ("ZIK", "refrigerator column", "built"), ("ZIR", "refrigerator column", "built"), ("ZIF", "refrigerator column", "built"),
           ("ZDP", "pro range", "free"), ("ZGP", "pro range", "free"), ("ZTD", "wall oven", "built"), ("ZET", "wall oven", "built"),
           ("ZTS", "wall oven", "built"), ("JTS", "wall oven", "built"), ("JT", "wall oven", "built"), ("CTS", "wall oven", "built"),
           ("PTS", "wall oven", "built"), ("JGB", "gas range", "free"), ("JGS", "gas range", "free"), ("JB", "electric range", "free"),
           ("JS", "electric range", "free"), ("PGS", "gas range", "free"), ("PHS", "induction range", "free"), ("CGS", "gas range", "free"),
           ("CGY", "gas range", "free"), ("PVM", "over-range microwave", "built"), ("JVM", "over-range microwave", "built"),
           ("ZVW", "vent hood", "built"), ("UVW", "vent hood", "built"), ("PP", "electric cooktop", "built"), ("JP", "electric cooktop", "built"),
           ("ZHU", "induction cooktop", "built"), ("CHP", "induction cooktop", "built"), ("PHP", "induction cooktop", "built"),
           ("JGP", "gas cooktop", "built"), ("ZGU", "gas cooktop", "built"), ("UCC", "undercounter ice maker", "built"), ("UNC", "undercounter ice maker", "built"),
           ("ZDI", "undercounter ice maker", "built"), ("PSB", "speed oven", "built"), ("CSB", "speed oven", "built"), ("ZSC", "speed oven", "built")],
    "LG": [("WM", "front-load washer", "free"), ("WT", "top-load washer", "free"), ("DL", "dryer", "free"), ("LD", "dishwasher", "built"),
           ("LR", "refrigerator", "free"), ("LF", "french-door refrigerator", "free"), ("LM", "refrigerator", "free"), ("LS", "range", "free"),
           ("LT", "range", "free"), ("LRS", "side-by-side refrigerator", "free"), ("LRF", "french-door refrigerator", "free"),
           ("LRE", "electric range", "free"), ("LRG", "gas range", "free"), ("LMV", "over-range microwave", "built"), ("LSS", "cooktop", "built")],
    "SAMSUNG": [("WF", "front-load washer", "free"), ("WA", "top-load washer", "free"), ("DV", "dryer", "free"), ("DW", "dishwasher", "built"),
                ("RF", "french-door refrigerator", "free"), ("RS", "side-by-side refrigerator", "free"), ("RT", "top-freezer refrigerator", "free"),
                ("NE", "electric range", "free"), ("NX", "gas range", "free"), ("ME", "over-range microwave", "built")],
    "SPEED QUEEN": [("TR", "top-load washer", "free"), ("TC", "top-load washer", "free"), ("AWN", "top-load washer", "free"),
                    ("FF", "front-load washer", "free"), ("FR", "front-load washer", "free"), ("DR", "electric dryer", "free"),
                    ("DC", "electric dryer", "free"), ("DF", "electric dryer", "free"), ("ADE", "electric dryer", "free"), ("AD", "dryer", "free"),
                    ("SF", "stacked laundry", "free"), ("ST", "stacked laundry", "free")],
    "FISHER & PAYKEL": [("DD", "dish drawer", "built"), ("DW", "dishwasher", "built"), ("RF", "french-door refrigerator", "free"),
                        ("RS", "built-in refrigerator", "built"), ("RB", "refrigerator drawers", "built"), ("OR", "range", "free"),
                        ("OB", "wall oven", "built"), ("CG", "gas cooktop", "built"), ("CI", "induction cooktop", "built"),
                        ("WH", "front-load washer", "free"), ("DH", "dryer", "free"), ("HC", "vent hood", "built"), ("HP", "vent hood", "built")],
    "MONOGRAM": [("ZDT", "dishwasher", "built"), ("ZDP", "pro range", "free"), ("ZGP", "pro range", "free"), ("ZIS", "built-in refrigerator", "built"),
                 ("ZIC", "built-in refrigerator", "built"), ("ZIK", "refrigerator column", "built"), ("ZIF", "refrigerator column", "built"),
                 ("ZIR", "refrigerator column", "built"), ("ZTD", "wall oven", "built"), ("ZET", "wall oven", "built"), ("ZSC", "speed oven", "built"),
                 ("ZHU", "induction cooktop", "built"), ("ZGU", "gas cooktop", "built"), ("ZDI", "undercounter ice maker", "built"),
                 ("ZVW", "vent hood", "built"), ("ZKD", "warming drawer", "built"), ("ZWL", "wine refrigerator", "built")],
    "CAFÉ": [("CDT", "dishwasher", "built"), ("CFE", "french-door refrigerator", "free"), ("CGS", "gas range", "free"), ("CHS", "induction range", "free"),
             ("CES", "electric range", "free"), ("CSB", "speed oven", "built"), ("CTS", "wall oven", "built"), ("CVM", "over-range microwave", "built"),
             ("CWE", "french-door refrigerator", "free"), ("CHP", "induction cooktop", "built")],
    "GE PROFILE": [("UNC", "undercounter ice maker", "built"), ("UCC", "undercounter ice maker", "built"), ("PFW", "front-load washer", "free"), ("PDT", "dishwasher", "built"), ("PFE", "french-door refrigerator", "free"), ("PVD", "french-door refrigerator", "free"),
                   ("PGS", "gas range", "free"), ("PHS", "induction range", "free"), ("PSB", "speed oven", "built"), ("PTD", "electric dryer", "free"),
                   ("PFQ", "front-load washer", "free"), ("PTS", "wall oven", "built"), ("PVM", "over-range microwave", "built"),
                   ("PHP", "induction cooktop", "built"), ("PP", "electric cooktop", "built")],
    "FRIGIDAIRE": [("FF", "refrigerator", "free"), ("FG", "french-door refrigerator", "free"), ("FR", "refrigerator", "free"),
                   ("FC", "electric range", "free"), ("GC", "gas range", "free"), ("FD", "dishwasher", "built"), ("GD", "dishwasher", "built")],
    "SCOTSMAN": [("", "ice machine", "built")],
    "U-LINE": [("", "undercounter refrigerator", "built")],
    "TRUE": [("", "refrigerator column", "built")],
    "LIEBHERR": [("", "built-in refrigerator", "built")],
    "PERLICK": [("", "undercounter refrigerator", "built")],
    "MARVEL": [("", "undercounter refrigerator", "built")],
    "MARVE": [("", "undercounter refrigerator", "built")],
    "BLUESTAR": [("", "pro range", "free")],
    "LA CORNUE": [("", "pro range", "free")],
    "AGA": [("", "range", "free")],
    "BEST": [("", "vent hood", "built")],
    "ZEPHYR": [("", "vent hood", "built")],
    "BROAN": [("", "vent hood", "built")],
    "VENTAHOOD": [("", "vent hood", "built")],
    "FABER": [("", "vent hood", "built")],
    "XO": [("", "vent hood", "built")],
    "HOSHIZAKI": [("", "ice machine", "built")],
    "ASKO": [("D", "dishwasher", "built"), ("W", "front-load washer", "free"), ("T", "dryer", "free")],
    "KENMORE": [("106", "refrigerator", "free"), ("110", "washer", "free"), ("665", "dishwasher", "built"), ("790", "range", "free")],
    "VIKING": [("VDR", "dual-fuel range", "free"), ("VGR", "gas range", "free"), ("VCR", "range", "free"), ("VDW", "dishwasher", "built"),
               ("VCSB", "built-in refrigerator", "built"), ("VCBB", "built-in refrigerator", "built"), ("VSO", "wall oven", "built")],
    "DACOR": [("DOP", "wall oven", "built"), ("DRF", "french-door refrigerator", "free"), ("DDW", "dishwasher", "built"), ("DTI", "induction cooktop", "built")],
    "SMEG": [("", "range", "free")],
}
HVAC_BRANDS = {"TRANE", "CARRIER", "AMERICAN STANDARD", "GOODMAN", "RHEEM", "DAIKIN", "MITSUBISHI", "LENNOX"}
HVAC_RULES = [("4TW", "heat pump"), ("5TW", "heat pump"), ("2TW", "condenser"), ("4TT", "condenser"), ("TAM", "air handler"),
              ("TEM", "air handler"), ("4TX", "air handler"), ("S9", "furnace"), ("S8", "furnace"), ("TUD", "furnace"),
              ("XR", "condenser"), ("XV", "condenser"), ("XL", "condenser")]

SEALED = {"built-in refrigerator", "refrigerator column", "wine refrigerator", "undercounter refrigerator", "refrigerator drawers",
          "undercounter ice maker", "ice machine", "pro refrigerator"}


def brand_of(code, model=""):
    c = str(code or "").strip().upper()
    if c in BRAND:
        return BRAND[c]
    return c.title() if c else ""


def classify(dt_detail, brand, model, qual):
    """-> (category label, install type, source). DispatchTrack's ePASS code wins; then a model-prefix rule; then the brand."""
    if dt_detail:
        m = re.match(r"^([A-Z0-9]{2,6})\s", dt_detail.strip())
        if m and m.group(1) in CODE:
            lab, inst = CODE[m.group(1)]
            return lab, inst, "epass"
    b, mo = brand_of(brand).upper(), re.sub(r"[^A-Z0-9]", "", (model or "").upper())
    if b in HVAC_BRANDS or (qual or "").upper() == "HVAC":
        for pre, lab in HVAC_RULES:
            if mo.startswith(pre):
                return lab, "hvac", "model"
        return "HVAC system", "hvac", "brand"
    for pre, lab, inst in sorted(MODEL_RULES.get(b, []), key=lambda r: -len(r[0])):
        if pre and mo.startswith(pre):
            return lab, inst, "model"
    only = MODEL_RULES.get(b, [])
    if len(only) == 1 and only[0][0] == "":
        return only[0][1], only[0][2], "brand"
    return "appliance", "free", "none"


# ---------------------------------------------------------------- read sources
def read_ei(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb[wb.sheetnames[0]].iter_rows(min_row=3, values_only=True))
    wb.close()
    hdr = [str(h).strip() if h is not None else "" for h in rows[0]]
    return [dict(zip(hdr, r)) for r in rows[1:] if r[6]]


def read_dt(path):
    out, geo = {}, collections.defaultdict(list)
    with open(path, encoding="cp1252", newline="") as f:
        for r in csv.DictReader(f):
            o = (r.get("Order Number") or "").strip()
            lat, lng = r.get("Latitude"), r.get("Longitude")
            try:
                lat, lng = float(lat), float(lng)
            except (TypeError, ValueError):
                lat = lng = None
            z = (r.get("Ship Zip") or "").strip()[:5]
            if lat and lng and z:
                geo[z].append((lat, lng))
            if o.startswith("SV") and o not in out:
                out[o] = {"detail": r.get("Order Detail") or "", "lat": lat, "lng": lng,
                          "dir": (r.get("Directions") or "").strip(), "zone": (r.get("Map Zone") or "").strip(),
                          # the invoice export carries no phone at all — Phone1/2/3 only exist in the DT feed
                          "phones": [x for x in ((r.get("Phone1") or "").strip(), (r.get("Phone2") or "").strip(),
                                                 (r.get("Phone3") or "").strip()) if x],
                          "dt_email": (r.get("Email") or "").strip()}
    zips = {z: [round(sum(a) / len(a), 4), round(sum(b) / len(b), 4)] for z, pts in geo.items()
            for a, b in [([p[0] for p in pts], [p[1] for p in pts])]}
    return out, zips


def problem_from(detail, limit=88):
    """'DW MGRAM ZDT925SPNSS DA851209 WTY new dishwasher also stumbling...' -> the customer's words, tidied:
    ePASS notes are typed in caps half the time and run on; cut at a sentence or word boundary, never mid-word."""
    m = re.match(r"^(?:\S+\s+){3}\S+\s+(?:SV|WTY)\s+(.*)$", (detail or "").strip(), re.S)
    t = re.sub(r"\s+", " ", (m.group(1) if m else "").strip())
    t = re.sub(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", "", t)
    t = re.sub(r"\b(TECH FOUND|TECH|NEEDS?|ORDERED|PARTS? ORDERED|WAITING ON)\b.*$", "", t) if t.isupper() and len(t) > limit else t
    t = t.strip(" .-,;/")
    if not t:
        return ""
    # de-shout: if more than two thirds of the letters are capitals, sentence-case it
    letters = [c for c in t if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.66:
        t = t.capitalize()
    if len(t) > limit:
        cut = t[:limit]
        stop = max(cut.rfind(". "), cut.rfind("; "))
        t = (cut[:stop] if stop > limit * 0.4 else cut[:cut.rfind(" ")] if " " in cut else cut).rstrip(" .,-") + "…"
    return t


def title(s):
    s = re.sub(r"\s+", " ", str(s or "").strip())
    small = {"and", "of", "the", "at", "on", "&"}
    return " ".join(w.lower() if (w.lower() in small and i) else
                    re.sub(r"^(Mc)(\w)", lambda m: m.group(1) + m.group(2).upper(), w.capitalize())
                    for i, w in enumerate(s.split(" ")))


BIZ = re.compile(r"\b(LLC|INC|ENTERPRISES?|PROPERT|MANAGEMENT|WARRANTY|SERVICES?|HOMES?|BUILDERS?|CONSTRUCTION|REALTY|GROUP|ASSOC|APARTMENT|RANCH|HOA|CLUB|HOTEL|RESORT|CHURCH|SCHOOL|CAFE|RESTAURANT|BAR |KITCHEN)\b")


def cust_name(raw):
    """'HUCKABY NEAL & ELAINE' (ePASS writes last name first) -> ('Huckaby, Neal & Elaine', 'Huckaby').
    Businesses and already-punctuated names are left as one string."""
    n = re.sub(r"[*]+", " ", str(raw or ""))
    n = re.sub(r"\s*,\s*", " ", n)
    n = re.sub(r"\s+", " ", n).strip(" -/")
    if not n:
        return "(no name)", ""
    if BIZ.search(n.upper()) or len(n.split(" ")) == 1:
        return title(n), title(n.split(" ")[0])
    parts = n.split(" ")
    last, rest = parts[0], " ".join(parts[1:])
    return f"{title(last)}, {title(rest)}", title(last)


# spec §11 duration.defaults: diag_appliance 60, diag_hvac 90, diag_builtin_refrig 75, install_default 60,
# multi_unit_add 30, sealed_factor 1.25
DUR = {"diag": 60, "diag_hvac": 90, "diag_builtin_refrig": 75, "install": 60, "multi": 30, "sealed": 1.25}


def duration(cat, inst, status, units):
    if status in ("SO6", "SO4PRE", "SO5"):
        base = DUR["install"]
    elif inst == "hvac":
        base = DUR["diag_hvac"]
    elif cat in SEALED and "refrigerator" in cat:
        base = DUR["diag_builtin_refrig"]
    else:
        base = DUR["diag"]
    if cat in SEALED:
        base = int(base * DUR["sealed"])
    return min(base + DUR["multi"] * max(0, min(int(units or 1), 4) - 1), 240)


def read_order(path):
    """sv -> (day, tech, seq or None, below_divider). seq counts from 1 above the divider; rows under the
    'routed' comment get seq None and below=True — the tech has to go back into them."""
    out = {}
    if not os.path.exists(path):
        return out
    for day, techs in json.load(open(path))["days"].items():
        for tech, r in techs.items():
            for i, sv in enumerate(r.get("routed", []), 1):
                out[sv] = (day, tech, i, False)
            for sv in r.get("below", []):
                out[sv] = (day, tech, None, True)
    return out


def main():
    ei, (dt, zipgeo) = read_ei(EI), read_dt(DT)
    order = read_order(ORDER)
    ordered_days = {d for d, _, _, _ in order.values()}
    jobs, unmatched = [], collections.Counter()
    src = collections.Counter()
    for r in ei:
        sv = str(r.get("Invoice #") or "").strip()
        st = str(r.get("Job Status") or "").strip().upper()
        sched = str(r.get("* Sched Date") or "")[:10]
        tech = str(r.get("SP") or r.get("Route") or "").strip().upper()
        tech = {"KJB2": "KJB", "VJ": "VWJ"}.get(tech, tech)
        zip5 = str(r.get("Zip Code") or "").strip()[:5]
        d = dt.get(sv, {})
        brand = brand_of(r.get("Service Brand"), r.get("Service Model"))
        model = str(r.get("Service Model") or "").strip()
        cat, inst, how = classify(d.get("detail"), r.get("Service Brand"), model, r.get("Qualification"))
        src[how] += 1
        if how == "none":
            unmatched[f"{r.get('Service Brand')} {model[:14]}"] += 1
        prio = str(r.get("Priorities") or "").upper()
        wty = "WTY" in prio
        units = r.get("Units") if isinstance(r.get("Units"), (int, float)) else 1
        cust, last = cust_name(r.get("Name"))
        dow = _dt.date.fromisoformat(sched).weekday() if re.match(r"\d{4}-\d\d-\d\d$", sched) else 9
        parked = dow >= 5
        jobs.append({
            "sv": sv, "st": st, "tech": tech or None, "day": None if parked else (sched or None), "parked_on": sched if parked else None,
            "cust": cust, "last": last, "addr": title(r.get("Address")), "zip": zip5,
            "zone": str(r.get("Map Zone") or "").strip(), "brand": brand, "model": model,
            "brand_code": str(r.get("Service Brand") or "").strip().upper(),
            "serial": str(r.get("Service Serial") or "").strip(), "cat": cat, "inst": inst, "cat_src": how,
            "problem": problem_from(d.get("detail")), "problem_full": problem_from(d.get("detail"), 400), "gate": d.get("dir", "")[:60],
            "phones": d.get("phones", []), "dt_email": d.get("dt_email", ""),
            "ll": [d["lat"], d["lng"]] if d.get("lat") else None,
            "wty": wty, "rcall": "RCALL" in prio, "pay": str(r.get("Payment Type Code") or "").strip(),
            "bal": float(r.get("Balance") or 0), "total": float(r.get("Total") or 0), "units": int(units or 1),
            "qual": str(r.get("Qualification") or "").strip(), "created": str(r.get("Date Created") or "")[:10],
            "finish": str(r.get("Finish Date") or "")[:10], "email": str(r.get("Bill To Email") or "").strip(),
            "billto": title(r.get("Bill To Customer Name")), "po": str(r.get("PO #") or "").strip(),
            "ref": str(r.get("Reference") or "").strip(),
            "dur": duration(cat, inst, st, units),
            "type": "hvac" if inst == "hvac" else ("sealed" if cat in SEALED else "appliance"),
            # ePASS stop order (screenshots 9/17): seq above the 'routed' divider, below=True under it.
            # Only when the export still agrees on day and tech — three 'below' rows had already been
            # moved to the following week by the time the export ran, which is the divider doing its job.
            "eseq": order[sv][2] if sv in order and order[sv][:2] == (sched, tech) else None,
            "below": order[sv][3] if sv in order and order[sv][:2] == (sched, tech) else False,
            "ordered_day": (sched in ordered_days) and bool(tech),
        })
    hit = sum(1 for j in jobs if j["eseq"] or j["below"])
    moved = [j["sv"] for j in jobs if j["sv"] in order and order[j["sv"]][:2] != (j["day"], j["tech"])]
    print(f"ePASS stop order: {hit} of {len(order)} screenshot rows applied; "
          f"{len(moved)} already moved to another day between the screenshot and the export: {', '.join(moved) or '—'}")
    meta = {"generated": _dt.datetime.now().isoformat(timespec="seconds"), "source_ei": os.path.basename(EI), "source_dt": os.path.basename(DT),
            "source_order": os.path.basename(ORDER), "ordered_days": sorted(ordered_days),
            "today": TODAY.isoformat(), "week": WEEK, "tickets": len(jobs), "category_source": dict(src),
            "unmatched_top": unmatched.most_common(12)}
    json.dump({"jobs": jobs, "zips": zipgeo, "meta": meta}, open(os.path.join(HERE, "realdata.json"), "w"), indent=0)
    print(json.dumps(meta, indent=1)[:1200])


if __name__ == "__main__":
    main()
