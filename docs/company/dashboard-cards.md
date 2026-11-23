# Dashboard cards: smaller, and 2 to 8 of them

*Changed 11/22. Andrew: "People are used to these cards. I think we can reduce the size by 33% and give people the option to switch from 2-8 tiles"*

The cards at the top of everyone's dashboard (Send Payment Link, Ordering Report and so on) work as before. They're smaller, and each person chooses how many.

## Smaller

About a third smaller: less padding, a smaller title and blurb, and tighter gaps. The blurb is cut off after two lines so a row of cards stays even.

Measured on the default four cards:

| Screen | Before | After |
|---|---|---|
| Phone (390 px), the stack of four cards | 642 px tall | 416 px (35% less) |
| Desktop, the 2 × 2 block | 288 px tall | 205 px (29% less) |

## 2 to 8 cards

1. Press **Customize cards**.
2. Pick a number next to **Cards** (2 to 8). It starts on however many you have now.
   - More cards adds empty ones at the end. Your current picks stay.
   - Fewer cards drops them from the end.
3. Choose a page for each card and press **Save**.

**Rules:**

- **Every card needs a page,** and no page twice. Save says which rule wasn't met.
- **Nobody is offered more cards than the pages they can open.**
- **Someone who never customized still gets the usual 4.**
- **Losing access to a page drops its card,** as before.

**How they're laid out:**

| Cards | Desktop | Tablet | Phone |
|---|---|---|---|
| 2 or 4 | two across (the familiar 2 × 2 for 4) | two across | one column |
| 3, 5 or 6 | three across | two across | one column |
| 7 or 8 | four across | two across | one column |

## Checked before delivery

The real `server.js` ran on a local test database; 17 of 17 checks passed.

- The default 4.
- The picker offering 2–8 and starting on the current count.
- Adding cards (picks kept, new ones empty), and the empty-card and same-page warnings.
- Saving 6, 8 and 3, kept after a reload, with the layout above at desktop, tablet and phone widths.
- Cancel.
- The server keeping at most 8 and still refusing a page you can't open.
- No page errors.

## For developers

- **`dashboard.html`:**
  - The hero-card script: `MAX_SLOTS` 8, `MIN_SLOTS` 2, `DEFAULT_COUNT` 4.
  - `#cardsCount` in `.nav-grid-tools`, shown only while customizing.
  - `draft` keeps picks across count changes.
  - `#navGrid[data-count]` drives the columns.
  - The card CSS: `.nav-card`, `.nav-card-title`, `.nav-card-text`, and the 900 px and 560 px breakpoints.
- **`server.js`:** `POST /api/me/dashboard-slots` keeps up to 8 slots (was 4). They're stored, as before, in the user's `preferences.dashboardSlots`.
- **The module cards further down** (up to three) are a separate setting and are unchanged.
