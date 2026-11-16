# Org Chart

*Added 11/16. The company's reporting structure, drawn between job codes. Whoever holds a job code reports to whoever holds the job code above it, so Reports to on every profile, and the routing of time off, follow the chart without anyone setting them person by person.*

**HR → Org Chart** (`org-chart.html`). Grant it on the Users page; it's in the HR group. Whoever holds the page can see and change the chart. Executives always can. It is separate from Employee Profiles: holding one doesn't open the other.

## How it works

The boxes are **job codes** (E10, NE20), not people. Each box shows the title, the code, and everyone currently holding it, or *Vacant*. Job codes and titles are still created in User Admin; this page only arranges them.

Each job code has **one solid line**, to the job code it reports to. From that, each person's Reports to is worked out:

1. Start at the box above theirs.
2. If exactly one person holds it, that person is their manager.
3. If nobody holds it, skip it and look at the next box up. This is the "shortest solid line": the nearest filled seat.
4. If two or more people hold it, the chart **does not guess**. The person is flagged *needs a pick* and HR chooses on their profile.
5. If there's nothing filled above them, they report to nobody (the top of the chart).

Because it's computed from who holds which code, the chart keeps itself current: hire a General Manager and everyone under that box starts reporting to them; when someone leaves and is archived their seat empties and their reports climb to the next seat; change a person's job title and they move to the new box.

## Building it

Every job code starts under **Not on the chart yet**.

- Drag the top job onto **Top of the chart**.
- Drag each other job onto the box it reports to. A box moves with everything under it.
- Drag a box back onto *Not on the chart yet* to take it off. The boxes under it move up to its boss.
- A box can't be dropped under one of its own reports (that would be a loop).

After every change a green line says what happened and whose Reports to changed, for example *Sales Manager (E10) now reports to Operations Manager (E5). Reports to changed for 1 person: Morgan Mills (nobody → Andrew Walsh).*

**Without dragging** (phones, or if you'd rather): tap or click a box. A panel opens with the people in that job and who each reports to, a **Reports to (solid line)** menu with a Move button, the dotted lines with an × on each and a menu to add one, and **Take off the chart**. Enter or Space opens a box from the keyboard; Escape closes the panel.

**Outline view** lists the chart as an indented outline instead of a tree. Phones start in it. In the tree, three or more jobs that have nothing under them hang in a column under their boss so the chart doesn't sprawl sideways.

## Dotted lines

Switch the toggle to **Dotted line** and drag a box onto another job, or add one from the panel. A job code can have several. A dotted line is drawn in purple and:

- does **not** change Reports to, and the dotted-line manager does **not** approve anything;
- means the people holding the dotted-line job get a dashboard notice when that person's time off is approved (*Pat Example will be out Dec 14 – Dec 18*), and another if it's cancelled. Names and dates only, never the kind of time off or the note;
- shows on the person's profile as a *Dotted line to …* tag.

A dotted line to a vacant job simply reaches nobody; it doesn't climb. A dotted line that would duplicate the solid line is refused, and is dropped if a move makes it a duplicate.

## The Reports to box on a profile

On Employee Profiles the box now says where its value came from:

- **Filled in by the Org Chart** names the job it came through, and any vacant jobs it climbed past.
- **Needs a pick** names the people sharing the job above. Choosing one marks it **Picked by HR**. The pick lasts while that job is still shared; once one person holds it, the chart takes over again.
- Choosing someone other than the chart's answer marks it **Set by hand**. That sticks, through any chart change, until someone presses **Put back to automatic** (on the profile, or in the list at the bottom of the Org Chart).
- People whose job code isn't on the chart, whose title has no job code, or who have no title aren't touched by the chart; the box works as it did before.

Saving a profile without touching the box never creates an override.

While a job above is shared and nobody has picked: a person stays with their current manager if that manager is one of the people in the shared job. If their stored manager is someone else (a leftover from where the box used to sit), it's cleared, so their time off goes to HR until someone picks.

## The lists under the chart

- **Needs a pick**: each flagged person, who the choice is between, and a link to their profile.
- **Set by hand**: each override, what the chart would say instead, and *Put back to automatic*.
- **Job titles with no job code**: these can't be placed until an executive gives them a code in User Admin.
- **People with no job title**.

## Time off

Nothing changed about who approves: it is still the person in Reports to, with HR as the fallback. What changed is that Reports to is now kept current by the chart, and it is re-checked at the moment a request is sent. Dotted lines add the notices described above.

## Data

`lib/org-chart-postgres.js` creates `org_chart_nodes` (`job_code`, `parent_code`, where `''` is the top of the chart; a row means the code is on the chart) and `org_chart_dotted` (`job_code`, `to_code`). Both key on `job_titles.code`, the permanent code, so renaming a title never moves a box. `employee_profile_details.reports_to_mode` records where a stored Reports to came from: `''` follows the chart, `pick` is HR's choice for a shared job, `override` is set by hand.

`syncOrgReportsTo()` writes the chart's answer into `reports_to_code` for everyone it applies to. It runs after every chart change and every profile save, and (at most every 30 seconds) when the Org Chart, Employee Profiles or Time Off pages load and when a time-off request is sent, which is how title changes and archiving done in User Admin are picked up.

Routes, behind the Org Chart grant: `GET /api/org-chart`; `PUT /api/org-chart/nodes/:code` with `{ parent }` (`""` for the top) or `{ onChart: false }`; `POST /api/org-chart/nodes/:code/dotted` with `{ to }`; `DELETE /api/org-chart/nodes/:code/dotted/:to`. `POST /api/employee-profiles/:code/reports-to-auto` is open to either the Org Chart or the Employee Profiles grant.

Audit actions: `org_chart_moved`, `org_chart_removed`, `org_chart_dotted_added`, `org_chart_dotted_removed` (each with how many people were re-routed) and `employee_reports_to_automatic`.

## Not built

Dragging individual people (the chart is job codes only), a printable or exportable chart, and a read-only view for everyone.
