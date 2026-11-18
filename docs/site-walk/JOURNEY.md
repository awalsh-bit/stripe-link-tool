# The journey of a site walk

As Cayden described it on 16 Nov 2026, and as the drop-in does it. `acceptance/verify-agility-journey.mjs` walks this whole page in a browser, 46 checks.

| # | What happens | Who | Screen | Stage on the server |
|---|---|---|---|---|
| 1 | Upload the Steel Cod spec book for the job. The tool reads the models and fills each opening from the spec library. Pick the install type where the book offers more than one (flush or standard), and type any number the sheet did not give. | Sales / office | `site-walk-office.html` | `setup` |
| 2 | When every opening has its spec and its install type, the walk is ready. The office page shows **Open this walk on a phone**: a link and a QR code. | Sales / office | `site-walk-office.html` | `ready-to-walk` |
| 3 | The project manager opens the link on a phone. The phone fetches the walk, keeps its own copy and the install sheets, and says when it is ready for the field. | Project manager | `site-walk.html?walk=<id>` | `ready-to-walk` |
| 4 | They walk the job: jobsite access, then each opening (photo, measurements, connections, notes). Each change is sent about 1.5 seconds after it is made. Every screen that has the walk open picks it up within 15 seconds. | Project manager | `site-walk.html` | `in-field` from the first thing recorded |
| 5 | Every opening walked and the access answered. | — | — | `ready-to-send` |
| 6 | The project manager cleans up the notes and **signs off**. The server records who and when, from the login. | Project manager | `site-walk-report.html?walk=<id>` | `ready-to-send`, signed off |
| 7 | **Email the builder** appears. Clicking it opens a draft on the user's machine and records the send. | Whoever sends | `site-walk-report.html` | `sent` |

## Why the phone keeps its own copy

It is what lets the walk go on in a house with no signal. In the standalone tool that was a visible step ("Load onto this phone"). Here it is not a step: opening the walk makes the copy. With no signal the page reopens from the phone, the walk is there, and what is recorded is held and sent when the phone can reach Agility again. The office view then shows the time it last heard from the phone.

On 9 Nov 2026 the first field test failed because the page was served from an address that could not keep an offline copy. So the walk screen now says which state the phone is in before anyone leaves the shop:

- **Ready for the field — this page and all N install sheets are on this phone**
- **Saving this page to the phone** (a few seconds, first visit)
- **This page is not saved on this phone** (the address cannot keep an offline copy)

Agility's `https://` address is what makes the first of these possible.

## The one gate

Nothing goes to a builder until the person who walked the job has signed off. That is enforced on the server (`canSend` in `lib/site-walk-rules.js`): `POST …/sent` answers `409` before a sign-off, whatever a page claims. A sign-off can be taken back (`…/reopen`) until the packet is sent.

The salesperson does not approve the packet. They are told about anything the walker handed to them as a spec decision (`WALK_SALES_ITEM` in `GET /api/site-walk/notifications`).

## Who is the walker

The first signed-in person to record something at the house. Their display name goes on the walk as `walkedBy`, and the packet's sign-off prompt names them. The sign-off itself is recorded under whoever clicks it.

The same goes for the desk: whoever is signed in when the walk is built is recorded as the person who verified its dimensions against the sheets. The salesperson named in the spec book is never used for that.

## Two devices, one walk

Newest wins, by the walk's own revision stamp (`decideWrite`). A phone that was offline and posts an older copy late is ignored and told so; it changes nothing. A device with unsent work is never overwritten by the server's copy.

## Taking a walk out of the lists

A test walk, or a job that fell through, is **archived** from the walk's setup screen at the desk. It leaves the queue and the phones' list for everyone. Nothing is deleted, and `POST …/restore` puts it back. There is no screen for restoring yet; ask Andrew, or call the route.

## The same job twice

Importing a spec package whose job number already has a walk shows that walk, with a link, before anything is built. Building a second walk for the same job is still possible and the button says that is what it does.

## What "live" means

There is no socket. Each open page asks the server for the queue every 15 seconds (`live` in `site-walk-assets/site-walk-agility.js`) and fetches a walk only when its revision moved. A page somebody is typing into waits until they leave the field before repainting.

## The spec library

Every desk reads one library. The built-in entries ship in `site-walk-core.js`; what people change sits on top of them, on the server:

- **A model corrected or added** on the library screen (Spec library, from the queue) replaces the built-in of the same model number for everybody. Revert puts the built-in back for everybody.
- **Numbers confirmed against a sheet**, at a walk's setup or from a spec book added to the library, are kept with the book, the page, the sheet's date and who confirmed. They stand for every later job whose sheet carries the same date; when the manufacturer's sheet has been re-cut, the tool asks for a fresh look. The packet names the person who looked. They can be corrected or removed on the library screen.
- **Add a spec book to the library** reads a book with no walk at the end of it: open each model, check its numbers against its sheet, save the ones that were checked.

A change made while the server cannot be reached is kept in the browser and sent when it can be.

## What the builder gets

Page one is the punch list and nothing else: how many things have to change, then one numbered row per change, grouped by the trade that does it, with the page its drawing is on. Every item is on it; a long list runs onto a second sheet. Page two lists every opening with its status and page. Then the openings that need work, each leading with what to change and a drawing with the measurements on it (a miss in red, with the figure to build to), then the openings that need nothing, then the reference basis.

Wilson's own prep list shows on screen at the end of the packet and is left out of what prints and what downloads.
