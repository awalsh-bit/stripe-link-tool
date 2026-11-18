# How a spec book is read

Cayden asked on 17 Nov 2026: is the tool ready to read spec books on its own, does it need to fire a model and spend tokens, how does it work now, and what would be the most accurate way to run it in Agility. This is the answer, for both of you.

## What happens today

Nothing here calls a model. No tokens are spent when a book is read, on the standalone tool or on Agility. The whole read happens in the browser, in `site-walk-assets/site-walk-specpkg.js`, using pdf.js to take the text out of the PDF.

| Step | What reads it | Function | How sure it is |
|---|---|---|---|
| The contents block: every model and its page range | Code, from the PDF's text | `parsePackage` | Reliable on Steel Cod Full Spec Packages. A book with no contents block says so and models are added by hand |
| Job number, project, salesperson | Code, from the quote pages | `parseQuote` | Reliable on Steel Cod quotes |
| Which install each sheet draws (standard, flush inset, …) | Code, from the page headings | `basisFromHeadings` | Picks an install only when the model's pages name exactly one the library knows. Two, none, or a heading it cannot place is left for a person (rule LIB-2) |
| Numbers printed as text on a sheet (cutouts, some connections) | Code | `parseCutouts`, `parseConnHints` | Offered as a starting point, never as an answer |
| **The opening's width, depth and height** | **A person**, looking at the sheet | `verifyScreen` | See below |

The opening dimensions are the part that matters and the part code cannot read. On most manufacturer sheets they live in a drawing: the numbers are in the PDF's text, but nothing in the text says which number is the width and which is a hinge clearance. So the tool does not guess. For each model it shows the install sheet beside three boxes, fills the boxes from the best source it has, marks them unconfirmed, and a person confirms them against the page, unless a person already has for that printing of the sheet. The sources, in order:

1. Numbers somebody already confirmed for that model and install, with the sheet and date they came from (`rememberedDims`). As of v0.9.85 these are shared: confirmed once at any desk, they stand at every desk. They count as confirmed for a later job when its sheet carries the same date (or neither carries one); if the sheet has been re-cut since, the tool asks for a fresh look (`dimStatus`). The packet names the person who actually looked.
2. The built-in library: 332 entries read from the Sub-Zero, Wolf and Cove design guides and from manufacturer sheets, each citing its page.
3. Numbers printed as text on the sheet.
4. Nothing: the person types them.

Every packet then says where an opening's numbers came from, and says so plainly when nobody checked them against a sheet for that job (`verifiedLine`).

## Is it ready to run on its own?

Yes for reading the book: it needs nobody but the person at the desk and it needs no model.

No for deciding dimensions unattended, and it is built that way on purpose. A wrong number here moves a cabinet. The tool's rule is that every opening's numbers have been confirmed by a person against the manufacturer's sheet, that printing of it, before a walk is built. That stays.

What that costs in practice depends on how much of a job is already in the library. Against three years of sales, the built-in library covers about 68% of the units that need a site walk. The rest is spread over 197 models. For those, somebody types three numbers off a sheet the first time the model is sold; after that it is in the shared library.

## What would make it more accurate, and less work

In the order I would do them.

**1. Fill the library ahead of the jobs (no code, available now).** The library screen has "Add a spec book to the library": drop a book in, check each model against its sheet, save, with no walk. Reading the sheets for the 197 missing models once takes that 68% close to all of it, and from then on a job's setup is a row of ticks. This is the largest gain for the least risk.

**2. Have a model propose the numbers (step two, needs a decision).** For a model the library does not know, a server route could send the picture of the chosen install sheet to a vision model and put its answer in the three boxes as a proposal, unconfirmed, exactly like a remembered number. The person still confirms. What it needs:

- An API key for the model on the Agility server, and a small route (for example `POST /api/site-walk/spec-read`) that takes a page image and returns `{ w, d, h, rule, min/max, the words it read each number from }`. The browser already renders the page it would send (`renderPage`).
- A budget. Each read is paid for by the page. It would run only for models not already in the library, so the spend falls as the library fills. I have not put a figure on it; it depends on the model chosen and the image size, and should be measured on a dozen real sheets before anyone commits.

To make such a read as accurate as it can be:

- **Read twice, independently, and only fill the boxes when both reads agree.** This is how the built-in library was read. A disagreement shows the person both and fills neither.
- **Check every proposed number against the page's own text.** pdf.js gives the exact numbers printed on that page. A proposed value that is not among them is dropped. This costs nothing and stops an invented figure.
- **Use the sheet's two unit systems.** Most sheets print inches and millimetres. A width whose inch figure times 25.4 is not its millimetre figure is flagged.
- **Never let it confirm.** A proposal is a starting point with its source shown. The person's tick is what makes it a number a walk can use.

**3. Not recommended: reading unattended.** No setup I would trust removes the person. The checks above make a wrong proposal rare and visible; they do not make it impossible, and the cost of one is a cabinet rebuilt.

## What is not in the code

How the 332 built-in entries were made: Claude read each design guide or sheet in a working session, quoted the text each number came from, read each a second time blind, and compared inches against millimetres. That was done by hand, once, before the entries were typed into `MODELS` in `site-walk-core.js`. It is not something the tool does when it runs.
