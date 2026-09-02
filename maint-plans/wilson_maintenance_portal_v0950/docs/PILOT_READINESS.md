# Running real stops: what changed, and what is still open

This is the checklist for taking the prototype from demo data to five real
maintenance stops. It exists because the two things that made the demo safe --
invented customers and a machine nobody else could reach -- both stop being
true the moment a real stop is run.

## Before the first real stop

1. **Set the shop passcode, on the machine that will hold the data.**

       python serve_portal.py --set-passcode        (or SET_PASSCODE.bat)

   It is stored as a salted PBKDF2 hash in `.wilson-passcode`, which is
   excluded from git and from the package. The passcode itself is never
   written anywhere.

2. **Start it for phones with `OPEN_FOR_PHONES.bat`** (or
   `python serve_portal.py --lan`). Without a passcode this refuses to start,
   which is the one rule worth having in code rather than in a document:
   there is no flag combination that serves customer data to a network
   unauthenticated.

   `OPEN_WILSON_PORTAL.bat` still exists and is now **loopback only** -- that
   machine and nothing else. Use it for demos.

3. **Print the field card** (`docs/FIELD_CARD.pdf`) -- one page, both columns,
   for the van. It covers the six things that are easy to get wrong on the
   first few stops and the four things this tool will not say about a
   customer's equipment.

4. **Check the photo line at the end of the first stop.** The field tool says
   either *all photographs are on the shop machine* or how many are still
   waiting. That sentence is the whole trust model for photo evidence, so it
   is worth watching once with your own eyes.

## What is now true that was not

- **Nothing is served off the machine without a passcode.** Sessions last 12
  hours, the cookie is HttpOnly and SameSite, and repeated wrong guesses lock
  an address out for a minute at a time.
- **Photographs leave the phone.** `assets/photo-sync.js` drains what
  `WILSON_PHOTOS.pendingUpload()` holds to `POST /api/photos`, and a photo is
  marked as uploaded *only* after the server confirms it wrote the file. They
  land in `./photo-store/<visit>/`, each with a sidecar recording which
  appliance and which check it is evidence of.
- **The local copy is never deleted.** Uploading is a second copy, not a move:
  the report renders images from the phone that took them, and one bad server
  response must not be able to lose the only copy.
- **Failures are visible rather than silent.** A dead network or an expired
  session stops the run and leaves the queue alone. A file the server refuses
  is retried three times, then skipped with its reason kept on the record, so
  one bad photo cannot block the queue behind it or hammer the machine.

Both are covered by `_qa/verify-server-auth.py` (52 checks, the real server in
a subprocess) and `_qa/verify-photo-sync.py` (39 checks, the real browser
against the real server, verified against the server's disk rather than the
page's opinion).

## Still open, and worth knowing before you rely on it

- **The passcode is one shared secret, not accounts.** Everyone who has it is
  "the shop". Per-user identity and roles belong to the main dashboard.
- **No HTTPS.** Traffic on the shop LAN is in the clear. That is a fair risk
  on a private network and not one on a guest network -- do not run this on
  public Wi-Fi, which is also why loopback is the default.
- **`photo-store/` is not backed up.** It is a folder on one machine. Whatever
  backs up that machine is what backs up the job photographs.
- **The customer's copy of a report is still Print / Save PDF from the
  browser.** It paginates correctly and prints cleanly; emailing it is a
  manual step until the merge.
- **Protocol bands are still drafts** where the worksheets say so, and every
  report labels them as drafts. Refrigerant charge stays a technician rating
  until the superheat and subcooling bands are set.

## Cleaning up after a pilot

Real customer material lives in exactly two places: `photo-store/` on the
serving machine, and the browser storage of each phone that was used
(`localStorage` for the field data, IndexedDB for the images). Clearing site
data on a phone removes its copy; deleting `photo-store/` removes the
uploaded set. Neither is in the package, and neither is in git.
