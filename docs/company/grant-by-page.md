# Grant by page (User Admin)

*Added 11/6. The reverse of the per-person permission card: pick a page, tick the people, apply once.*

On **User Admin → Team** the toggle next to "+ Add teammate" switches between **By person** (the usual table and cards) and **By page**. By page shows every manageable page grouped the same way as the cards, with a count of how many accounts have it (`6/13`). Click a page to see every non-disabled account with a checkbox; tick or untick, use Everyone / No one / Reset, search for a person, then **Apply**. Changed rows are highlighted and the line under the Apply button says what will happen ("grant 3 · remove 1") — nothing is saved until Apply.

Executives are listed but can't be changed here — they already see every page. Invited (not yet verified) accounts can be granted so the page is there when they first sign in.

Under the hood `POST /api/admin/permissions/by-page` `{ pagePath, grants: [{ userId, granted }] }` writes the same `user_page_permissions` rows the per-person Save writes, one `permissions_updated` audit row per person, plus one `permissions_updated_by_page` row naming the page and the counts. The two views read the same data, so the counts and the cards always agree.
