"""One rule for linking an open ticket to the back catalogue, shared by buildlinks.py and buildhistory.py.

Cayden 9/17: a Do-Not-Service flag on Sammie Baird (156 White Rock Ct) surfaced on Leah Baird (4946 FM 165)
— same surname, same ZIP, no connection. The old fallback was surname+zip and it was wrong more often than
right (2,222 of 4,264 catalogue rows it attached sat at a different house number).

So the link is the ADDRESS, and only the address:

  address      normalised street + zip5 equals a household on file                   -> linked
  name+house   same surname, same house number, same zip (a spelling variant)        -> linked
  (nothing)    same surname somewhere else in the zip                                -> NOT linked;
               offered as `maybe` — a list the office can look at, never a flag

and a Do-Not-Service flag only travels when BOTH the address and the last name match. A DNS account at
the same address under a different name (a previous owner) is carried as `dns_other` so the drawer can
mention it in passing; it is not a banner and it does not block booking.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "repo", "phase0"))   # in the repo: ../phase0
from wilson_service.importers.history import address_key, surname_key, house_number, same_house   # noqa: E402


def _sur(name):
    """First word of a surname, the way surname_key does it: 'KLEPAC-UECKER RHONDA' -> 'KLEPAC'."""
    return surname_key(name or "", "00000").split("|")[0] if name else ""


class Index:
    def __init__(self, db):
        self.by_addr, self.by_sur, by_cid = {}, {}, {}
        rows = db.fetchall("SELECT c.customer_id, c.household_key, c.last_name, c.display_name, c.service_count,"
                           " c.do_not_service, c.last_service FROM customer c WHERE c.service_count>0")
        for c in rows:
            rec = {"cid": c["customer_id"], "last": _sur(c["last_name"]), "name": c["display_name"] or "",
                   "visits": c["service_count"] or 0, "dns": 1 if c["do_not_service"] else 0,
                   "hk": c["household_key"] or "", "lastsvc": c["last_service"] or ""}
            by_cid[rec["cid"]] = rec
            if c["household_key"]:
                self.by_addr.setdefault(c["household_key"], []).append(rec)
                if rec["last"] and "|" in c["household_key"]:
                    self.by_sur.setdefault(f"{rec['last']}|{c['household_key'].split('|')[1]}", []).append(rec)
        # secondary addresses on file (the address table) count as the household's address too
        for a in db.fetchall("SELECT a.customer_id, a.address_key FROM address a JOIN customer c"
                             " ON c.customer_id=a.customer_id WHERE a.address_key IS NOT NULL AND c.service_count>0"):
            rec = by_cid.get(a["customer_id"])
            if rec and a["address_key"] != rec["hk"]:
                lst = self.by_addr.setdefault(a["address_key"], [])
                if all(r["cid"] != rec["cid"] for r in lst):
                    lst.append(dict(rec, hk=a["address_key"]))

    def resolve(self, addr, zip_code, name):
        """-> dict(cid, how, dns, dns_other, maybe, accounts). cid None when nothing at the address."""
        ak, sk, sur = address_key(addr, zip_code), surname_key(name or "", zip_code), _sur(name)
        cands, how = list(self.by_addr.get(ak, ())), "address"
        if not cands and sk:
            cands = [r for r in self.by_sur.get(sk, ()) if same_house(addr, r["hk"])]
            how = "name+house"
        if cands:
            named = [r for r in cands if sur and r["last"] == sur]
            pick = max(named or cands, key=lambda r: (r["visits"], r["lastsvc"]))
            if named:
                how = "address+name" if how == "address" else how
            dns = 1 if any(r["dns"] for r in named) else 0
            other = next((r["name"] for r in cands if r["dns"] and r not in named), "")
            return {"cid": pick["cid"], "how": how, "dns": dns, "dns_other": other, "maybe": [],
                    "accounts": [{"cid": r["cid"], "name": r["name"], "visits": r["visits"]} for r in cands]}
        maybe = sorted(self.by_sur.get(sk, ()), key=lambda r: -r["visits"])[:3] if sk else []
        return {"cid": None, "how": "", "dns": 0, "dns_other": "", "accounts": [],
                "maybe": [{"cid": r["cid"], "name": r["name"], "street": r["hk"].split("|")[0].title(),
                           "visits": r["visits"]} for r in maybe]}
