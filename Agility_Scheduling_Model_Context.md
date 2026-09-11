# Agility Scheduling Platform — Product & Data Model Context

**Status:** Working product / architecture context  
**Platform:** Agility (internal application)  
**Primary business system:** NetSuite  
**Primary database target:** PostgreSQL  
**Purpose:** Describe the scheduling model Agility is intended to implement without hard-coding today’s operating constants, thresholds, capability names, or route limits.

---

# 1. Executive Summary

Agility is intended to be a scheduling and dispatch platform that improves on conventional route scheduling by optimizing **when work should occur**, not merely the sequence of stops after a day has already been assigned.

Traditional systems often answer:

> Given the work already assigned to Tuesday, what is the best Tuesday route?

Agility should instead answer:

> Given all feasible work across the scheduling horizon, which date and route should each piece of work belong to so that the company uses fewer physical visits, spends less time driving, respects customer commitments, and keeps available resources productive?

The core operating model separates five concepts that should never be collapsed into one object:

1. **Commercial record** — invoice / work order / ERP accounting truth.
2. **Dispatch work** — operational work headers such as delivery, installation, repair/service, HVAC, cabinet/modification.
3. **Visit** — a physical crew-arrival event at a service location.
4. **Route** — a collection and sequence of visits for a day.
5. **Resources** — vehicle(s) and named people assigned to execute the route.

The route is the object being optimized.  
Vehicles and people are resources attached to the route.  
A visit may be associated with more than one route when multiple crews converge at the same job.

The first version should be **recommendation-driven**, not autonomous. Agility should show dispatchers why one date, route, truck, or staffing assignment is better, but should not silently move customer work.

---

# 2. Core Scheduling Problem

## 2.1 Problem with fixed zone days

Rigid zone-day systems can create geographic efficiency but are customer-hostile and routinely overridden.

Example:

> “We only go to your area Wednesday and Friday.”

This creates three problems:

- Customers may not accept the available days.
- Staff eventually override the rule anyway.
- The schedule stops reflecting actual demand patterns.

## 2.2 Soft geographic gravity

Agility should allow geographic clusters to emerge dynamically.

Instead of defining a permanent “west side = Wednesday” rule:

- evaluate all feasible candidate dates;
- calculate the additional travel burden of inserting the work;
- favor dates where the location fits naturally with existing work.

No separate “geographic attraction score” is required. If insertion cost near existing stops is low, clustering emerges naturally.

A day may become north-heavy this week and west-heavy next week.

---

# 3. Optimization Philosophy

The order of operations should be:

1. Determine whether the work is eligible to schedule.
2. Determine which dates are feasible.
3. Identify same-location / same-project consolidation opportunities.
4. Minimize the number of additional crew-arrival events.
5. Minimize incremental route minutes.
6. Respect customer date preferences and commitments.
7. Build / sequence the final route.
8. Attach feasible vehicle and people resources.
9. Surface warnings when capacity or business rules are stretched.

## 3.1 Transparent marginal-burden model

Agility should **not** begin with an opaque multi-factor score.

For each candidate date, expose understandable metrics such as:

- Is a new visit required?
- Is there already compatible work at the same location?
- Can this work be consolidated into an existing visit?
- How many incremental route minutes does the work add?
- How much route capacity remains after insertion?
- Does the proposed route have a compatible vehicle?
- Does it have enough qualified people?
- Does it remain within the normal route-duration threshold?
- What customer commitment would be affected?

A dispatcher should be able to understand the recommendation without reverse-engineering a score.

## 3.2 Lexicographic preference

A practical initial recommendation order is:

```text
1. Feasible
2. Consolidatable into an existing visit
3. Lowest incremental physical-visit burden
4. Lowest incremental route minutes
5. Customer preference / commitment fit
```

Later versions may add capacity rationing between competing jobs, but that should remain distinct from the date-selection problem.

---

# 4. Revenue Philosophy

Revenue is operationally important but should not be used as the primary date-selection variable for a single job because the job's revenue is constant across candidate dates.

Using revenue directly in date selection could create undesirable behavior, such as continually deprioritizing lower-dollar repair work.

Revenue should instead be:

- visible at route level;
- visible at department/day level;
- visible at company/day level;
- additive across dispatch work;
- used as a route-quality diagnostic;
- available later for scarce-capacity prioritization.

The scheduling engine should make it easy to see:

> Is this route economically meaningful?

without turning revenue into an opaque date-selection score.

---

# 5. Three Truth Layers

Agility must preserve three independent truths.

| Layer | Meaning |
|---|---|
| **Commercial truth** | Invoice / work-order accounting from NetSuite |
| **Dispatch truth** | Operational work that must be completed |
| **Physical truth** | Actual crew-arrival events and routes |

This distinction is foundational.

A single invoice may contain product lines, installation labor, fees, and other service lines.

The invoice should not equal one dispatch appointment.

---

# 6. Commercial Record → Dispatch Work

## 6.1 Department

Department is derived from the invoice / transaction type or equivalent ERP classification.

Examples may include:

- appliance installation / delivery operations;
- repair/service;
- HVAC;
- cabinet / modification;
- other future departments.

Department and Work Type are separate dimensions.

## 6.2 Line classification

Items begin with a default operational interpretation and are then reclassified using item/service catalog attributes.

The catalog should define concepts such as:

- physical product / delivery;
- installation service;
- repair labor;
- delivery-fee revenue;
- non-dispatch revenue or fee;
- other service classifications.

NetSuite remains the source of truth for item identity and attributes.

## 6.3 Derived work headers

An invoice may generate multiple dispatch headers.

Illustrative example:

```text
Invoice 12345
│
├── Delivery Header
│   ├── Refrigerator
│   ├── Range
│   └── Delivery-related revenue
│
└── Installation Header
    ├── Refrigerator installation
    └── Range installation
```

These work headers can:

- share the same requested date;
- be scheduled together;
- be split to different dates;
- remain separate for KPI reporting;
- attach to the same physical visit when performed by the same arriving crew.

This is critical because the company wants to know whether delivery and installation are truly being completed together or whether the company is returning unnecessarily.

---

# 7. Work, Visit, Route, Vehicle, People

## 7.1 Dispatch Work

`dispatch_work` represents a coherent operational obligation.

Examples:

- deliver appliance products;
- install appliance products;
- diagnose / repair an appliance;
- HVAC work;
- cabinet or modification work.

A work header should carry:

- source commercial identifiers;
- project;
- service location;
- department;
- work type;
- requested / preferred / scheduled dates;
- status;
- mobility state;
- attributed revenue;
- estimated duration;
- duration snapshot;
- human override information;
- requirement metadata.

## 7.2 Visit

A **visit is a crew-arrival event**, not simply an address/date combination.

If an appliance delivery crew arrives in the morning and a separate cabinet crew arrives in the afternoon, that is two visits even if:

- the address is the same;
- the project is the same;
- the work occurs on the same date.

This preserves truthful consolidation KPIs.

## 7.3 Route

A route is a dated, sequenced set of visits.

A route should exist independently of:

- the exact vehicle;
- the exact people assigned to it.

This makes it possible to create a route first and finalize resource assignments later.

A route should contain:

- date;
- department / operating context;
- planned sequence;
- planned work minutes;
- planned travel minutes;
- planned break guidance;
- start/end location assumptions;
- revenue total;
- current resource assignments;
- warnings / feasibility state.

## 7.4 Vehicle

The vehicle is an assignable resource.

The vehicle can remain `TBD` until close to execution if needed.

A vehicle almost always supports only one route per day; multi-route vehicle sharing does not need to be a first-class v0.1 feature.

Vehicle data should support:

- active / unavailable state;
- capacity points;
- maximum crew capacity;
- vehicle class;
- equipment attributes;
- driver/insurance restrictions if applicable;
- future specialty attributes.

## 7.5 People

People are individually assigned to routes.

Do not use a monolithic “crew” object as the only labor concept.

Each person may carry:

- department;
- capabilities;
- driver eligibility;
- availability;
- optional proficiency / duration adjustment;
- employment status;
- future certifications.

A route can have several named people assigned up to the vehicle's crew limit.

One assigned person must satisfy the route's driving requirement when a driver is required.

---

# 8. Multi-Route Convergence

Agility must support multiple routes converging at one job.

Example:

- Appliance installation route arrives.
- Cabinet / modification route arrives at the same job.
- The cabinet installer contributes a specialty skill.
- Both routes continue independently afterward.

Do not duplicate the underlying job merely to support this.

Use a route-to-visit assignment model such as:

```text
route_visit_assignment
----------------------
route_id
visit_id
assignment_role
expected_minutes
```

Possible roles:

- `PRIMARY`
- `ASSIST`
- `SPECIALIST`

The same `visit` or related job context may therefore appear on multiple routes while retaining one canonical business object.

This model is also useful for:

- heavy-item assistance;
- specialist support;
- two-truck coordination;
- unusually difficult access.

---

# 9. Work Duration Model

Duration should be built from configurable standards rather than code constants.

## 9.1 Components

Potential components:

```text
stop_duration
    = delivery_base_time
    + product_handling_time
    + labor/service_standard_time
    + location/access modifiers
    ± human override
```

Not every work type uses every component.

## 9.2 Delivery base time

Delivery headers carry a delivery/service level or delivery type.

That type provides the base stop time required for:

- parking;
- customer contact;
- protection;
- paperwork;
- normal setup / staging.

The exact delivery types and minutes are configuration data.

## 9.3 Product handling time

Product items carry handling minutes.

Handling time can use a fallback chain such as:

```text
item override
→ item/category default
→ class default
→ hard fallback
```

Store which level answered so standards can be audited.

## 9.4 Labor / service time

Labor and service lines carry standard minutes.

The labor/service catalog should be a controlled reference dataset sourced from NetSuite or an approved fixed catalog.

## 9.5 Location/access modifiers

Persistent physical conditions should attach primarily to the service location, because they repeat across future visits.

Examples:

- stairs;
- elevator;
- long carry;
- doorway removal;
- crane / hoist;
- limited access;
- unusual staging requirements.

Modifiers should support:

- per-stop minutes;
- per-item minutes;
- notes;
- verification date;
- header-level override.

## 9.6 Duration override

Dispatchers need a controlled manual override.

Store:

- override value;
- reason;
- user;
- timestamp.

Overrides are also calibration data.

## 9.7 Snapshot and actual duration

Keep distinct:

```text
estimated_duration_minutes
duration_snapshot_minutes
duration_override_minutes
actual_duration_minutes
```

Meaning:

- **estimated** — what current standards calculate now;
- **snapshot** — what was believed when scheduled;
- **override** — human correction;
- **actual** — what happened.

This supports historical integrity and continuous improvement.

---

# 10. Item Standards & NetSuite Integration

NetSuite is the source of truth for item identity.

Use NetSuite internal IDs as keys.

Never key items by display name.

Recommended integration principles:

- stage raw exports before transform;
- preserve inactive items for history;
- never hard-delete missing items automatically;
- allow unknown/new items to resolve through fallback rules;
- flag unknowns for review rather than failing scheduling;
- store hashes / change detection on reference rows;
- keep item/reference data refresh separate from high-frequency demand refresh.

Demand data such as:

- invoices;
- work orders;
- schedule dates;
- statuses;
- route assignments;

should refresh much more frequently than low-change item master data.

---

# 11. Readiness

Agility should not infer inventory readiness automatically unless the business later chooses to add that capability.

Operational readiness is a human assertion.

Only work in approved readiness statuses should produce scheduling candidates.

Status transitions should be logged with:

- prior status;
- new status;
- timestamp;
- user.

If a visit later fails because product was not actually ready, the exception should be recorded and attributed back to the process.

---

# 12. Appointment Mobility

Keep mobility states simple.

Recommended conceptual states:

```text
FLEXIBLE
PREFERRED
COMMITTED
```

Meaning:

### FLEXIBLE
The work can be moved across feasible dates without customer intervention.

### PREFERRED
A particular date/range is preferred. Movement is still possible but should be surfaced as a compromise.

### COMMITTED
The customer has been given a meaningful commitment. Agility may recommend a change but should never automatically move it.

Customer commitments should become increasingly difficult to disturb as fulfillment approaches.

---

# 13. Route Lifecycle

Agility should support an explicit route lifecycle.

A likely conceptual flow:

```text
DRAFT
→ PLANNED
→ REVIEWED
→ CONFIRMED
→ STAGED
→ CUSTOMER_COMMITTED
→ IN_PROGRESS
→ COMPLETED
```

Exact names are configurable.

Important operational idea:

- routes are built before execution;
- warehouse pick/stage occurs before the route date;
- customer arrival windows are confirmed in advance;
- after staging and customer confirmation, the cost of schedule changes becomes much higher.

The lifecycle should be auditable.

---

# 14. Time Capacity

Route capacity is primarily a combination of:

- work minutes;
- drive minutes;
- break guidance.

A configurable normal route-duration threshold should produce a warning rather than automatically blocking dispatch.

The application should distinguish:

```text
planned_work_minutes
planned_drive_minutes
planned_break_minutes
planned_total_minutes
```

## 14.1 Break guidance

Break recommendations should be driven by configurable ranges of work + drive time.

Conceptually:

- short route → no break recommendation;
- normal full route → lunch recommendation;
- unusually long route → lunch + additional break recommendation.

Single jobs that are themselves unusually long should not have artificial break minutes added to their service duration. Breaks should instead appear as advisory schedule guidance.

All break thresholds and durations should be stored as business configuration, not embedded constants.

---

# 15. Vehicle Capacity Model

Vehicle capacity should be expressed in configurable **points** rather than relying on cubic feet alone.

## 15.1 Item points

Products / inventory classes may carry:

- outbound delivery points;
- haul-away points;
- packaging / trash factor.

The exact values may live at:

```text
item
→ category
→ inventory class
→ fallback
```

## 15.2 Running load, not day total

Vehicle capacity should be evaluated along the route.

At route start:

```text
load = all products loaded
```

At each visit:

```text
load -= product delivered
load += haul-away
load += packaging / trash retained
```

The route is feasible only if the vehicle remains within capacity at every point in the route.

This catches scenarios where:

- the truck starts within capacity;
- deliveries reduce outbound load;
- old appliances and packaging accumulate;
- the truck later exceeds usable capacity.

## 15.3 Haul-away

Haul-away should be represented explicitly and generally linked one-for-one with the relevant appliance/item.

It should increase return load.

## 15.4 Packaging / trash

Packaging load should be estimated from the delivered item using a configurable factor.

This does not need perfect volumetric modeling. It needs enough precision to identify obviously overloaded routes.

---

# 16. Vehicle Attributes

Initial vehicle attributes should support at least:

```text
vehicle_id
vehicle_class
capacity_points
max_crew_capacity
active
availability_status
```

Future optional attributes may include:

- liftgate;
- ramp;
- trailer;
- special equipment;
- height restrictions;
- 4WD;
- specialty appliance equipment.

Only add attributes that create an actual feasibility distinction.

---

# 17. Person / Capability Model

Capabilities should be data, not columns hard-coded onto the employee table.

Use:

```text
capability
employee_capability
```

rather than:

```text
employee.can_install_x
employee.can_install_y
```

This allows the capability catalog to evolve.

## 17.1 Capability philosophy

Capabilities may represent broad skill levels rather than every possible SKU.

For appliance operations, concepts may include levels such as:

- basic drop-off;
- connect-and-level;
- complex installation;
- specialty / built-in installation.

Exact labels are configuration data.

Capabilities may or may not be hierarchical. The system should support either:

- explicit hierarchy; or
- independent capabilities.

## 17.2 Driver eligibility

Driving eligibility should be an explicit attribute/capability because insurance or policy restrictions may prevent some employees from driving.

A route requiring a vehicle must have at least one assigned person who is eligible to drive it.

## 17.3 Department staffing patterns

Different departments use different typical crew sizes.

The model must support:

- single-person routes;
- two-person routes;
- three/four-person routes;
- variable crew sizes.

The exact ranges are operational configuration, not schema constants.

---

# 18. Job / Route Requirements

Capabilities only become useful when work expresses what it requires.

A requirement model should be able to define:

```text
required_capability
minimum_people
vehicle_class
special_equipment
driver_required
```

Requirements may come from:

- item;
- item category;
- install/service type;
- department;
- location/access modifier;
- manual header override.

Example:

> A normal refrigerator delivery may require a basic delivery capability and two people, while a difficult-access built-in refrigerator may require a specialty capability, additional people, and a different vehicle.

The requirement engine should aggregate all work on a route and determine whether the assigned people and vehicle satisfy the full route.

---

# 19. People Assignment

The route should support multiple named people.

Data should allow:

```text
route_person_assignment
-----------------------
route_id
person_id
role
is_driver
assigned_at
assigned_by
```

Potential roles:

- lead;
- helper;
- driver;
- specialist;
- technician.

Exact role labels are configurable.

A route's people may be reassigned without rebuilding the route.

When a person is swapped:

- recompute capability coverage;
- recompute any person-specific duration adjustments;
- flag if the route becomes infeasible.

---

# 20. Vehicle Assignment

Use a separate assignment object:

```text
route_vehicle_assignment
------------------------
route_id
vehicle_id
assigned_at
assigned_by
```

A vehicle swap should trigger:

- capacity check;
- crew-capacity check;
- required-attribute check.

The route itself remains unchanged.

---

# 21. Service Location & Travel Node

## 21.1 Service location

A `service_location` represents a place where work occurs.

It supports:

- unique-address KPIs;
- persistent access modifiers;
- project association;
- customer history;
- physical-stop analysis.

## 21.2 Travel node

A `travel_node` represents the point used for travel calculations.

This separates **travel cost** from **stop identity**.

Examples:

- several apartment units may be separate service locations but one travel node;
- several nearby builder addresses may optionally share one travel node for routing approximation;
- a large campus may have multiple travel nodes even under one commercial customer.

Do not auto-merge service locations solely because geocoded coordinates are close.

Ambiguous matches should be reviewable by a person.

---

# 22. Project

Project should be a first-class object.

Especially in builder / construction work, one project may include:

- many invoices;
- many releases;
- delivery work;
- installation work;
- cabinet/modification work;
- staged fulfillment over weeks or months.

Potential structure:

```text
project
-------
id
name
customer / builder
primary_service_location_id
status
```

Project identity enables meaningful duplicate-stop and consolidation reporting.

---

# 23. Work Relationships & Lineage

Work may be split, deferred, replaced, or followed up.

Do not infer lineage only from matching invoice number or address.

Use an explicit relationship model:

```text
dispatch_work_relationship
--------------------------
work_id
related_work_id
relationship_type
```

Possible relationships:

- `SAME_INVOICE`
- `DELIVERY_FOR`
- `INSTALL_FOR`
- `SPLIT_FROM`
- `REMAINDER_OF`
- `FOLLOWUP_TO`
- `REPLACEMENT_FOR`

This preserves history and supports better KPI attribution.

---

# 24. Split / Remaining Work

Humans will continue to:

- invoice work manually;
- identify incomplete work;
- split remaining work;
- create follow-up work.

Agility should support that process rather than attempt to eliminate it.

When work is split, require a reason.

Potential categories:

- customer-requested;
- product not ready;
- site not ready;
- crew capacity;
- access issue;
- damage / replacement;
- partial order;
- technical follow-up;
- internal scheduling;
- other.

Reason values should be configurable.

Split reasons create the basis for the **Avoidable Duplicate-Stop Rate**.

---

# 25. Candidate Date Evaluation

Do not persist every candidate-date row indefinitely.

Candidates become stale whenever the schedule changes.

Instead:

1. Generate candidate dates on demand.
2. Evaluate feasibility.
3. Calculate marginal metrics.
4. Present recommendations.
5. Persist the final decision and a snapshot of alternatives.

Useful candidate metrics:

```text
candidate_date
eligible
exclusion_reason
same_location_work_exists
same_project_work_exists
consolidation_possible
existing_visit_id
incremental_physical_visit
incremental_route_minutes
remaining_capacity
customer_preference_fit
vehicle_feasibility_summary
people_feasibility_summary
```

---

# 26. Incremental Route Minutes

The external routing service does not need to solve the full scheduling problem.

It only needs to answer:

> How much route time does inserting this visit add?

If the route contains:

```text
A → B
```

and candidate `X` is inserted:

```text
insertion_cost =
    time(A, X)
  + time(X, B)
  - time(A, B)
```

Evaluate possible insertion positions and take the lowest feasible incremental cost.

This gives an objective, explainable geographic burden.

---

# 27. External Geographic Data

Most operational intelligence is internal.

External data is mainly needed for:

- address validation / geocoding;
- travel time;
- travel distance;
- optional traffic-aware duration.

Agility should keep its own stable internal IDs and treat external geographic data as enrichment rather than business identity.

Potential travel cache:

```text
travel_matrix
-------------
origin_node_id
destination_node_id
day_of_week
time_bucket
duration_seconds
distance_meters
provider
cached_at
expires_at
```

Provider-specific storage/licensing rules must be respected.

---

# 28. Route Construction

A route can be built before vehicle and people assignment is final.

Conceptual sequence:

```text
eligible work
→ choose candidate dates
→ group into routes
→ sequence visits
→ calculate work + drive + break guidance
→ check route requirements
→ attach compatible vehicle
→ attach compatible people
→ review / confirm
```

This separation is important because the work can be operationally grouped before dispatch knows the exact truck or team.

---

# 29. Recommendation-Only Philosophy

Early versions should not automatically move customer work.

Agility should:

- identify better candidate dates;
- flag consolidation opportunities;
- identify route imbalance;
- identify unnecessary travel;
- identify capability gaps;
- identify truck capacity problems;
- identify staffing swaps that improve feasibility.

A dispatcher chooses whether to act.

Examples:

> Moving this flexible job to another date removes one additional visit and reduces incremental drive time.

> Swapping another vehicle onto this route resolves a capacity warning.

> This route requires a specialty capability not currently represented among assigned people.

> This route is over the normal daily threshold.

No automatic changes should occur without explicit policy added later.

---

# 30. Customer Windows

Customers receive arrival windows shortly before fulfillment.

The route planning process should be able to:

- sequence visits;
- estimate arrival windows;
- support a configured customer-facing window length;
- track whether the customer has been contacted;
- track how the customer was contacted;
- treat the confirmed window as a stronger commitment.

Channels may include:

- call;
- text;
- email.

Exact timing and window size are business configuration.

---

# 31. Warehouse Pick / Stage Dependency

Warehouse operations prepare routes ahead of fulfillment.

This creates a meaningful scheduling cutoff.

Agility should understand:

- route planned;
- route confirmed;
- products staged;
- customer window communicated.

Once product is staged and customers are committed, recommendations to move work should become increasingly conservative.

The system should expose route readiness to warehouse users and avoid silently changing staged routes.

---

# 32. Route Quality Dashboard

A dispatcher should be able to determine whether a route is good at a glance.

Core measures:

- route revenue;
- work minutes;
- drive minutes;
- break guidance;
- total planned minutes;
- number of visits;
- capability coverage;
- vehicle capacity;
- people count;
- driver coverage;
- consolidation count;
- warnings.

Route revenue should be visible but should not dominate scheduling logic.

---

# 33. Day / Department / Company Dashboard

Revenue and operational KPIs should roll up cleanly.

Useful levels:

### Route
- revenue;
- visits;
- work minutes;
- drive minutes;
- utilization;
- capacity warnings.

### Department / Day
- total revenue;
- route count;
- physical visits;
- unique service locations;
- duplicate / repeat visits;
- work minutes;
- drive minutes;
- staffing coverage.

### Company / Day
- total scheduled revenue;
- department split;
- total visits;
- utilization;
- consolidation metrics;
- exception counts.

---

# 34. KPI Model

## 34.1 Gross Scheduled Revenue

Revenue attached to dispatch work, segmented by:

- department;
- work type;
- route;
- date.

## 34.2 Unique Service Locations

Distinct service locations over the relevant period or project context.

## 34.3 Physical Visits

Actual crew-arrival events.

## 34.4 Duplicate / Repeat Visits

A simple starting concept:

```text
physical_visits - unique_project_locations
```

But reporting should consider `project + service_location` so legitimate future service calls do not automatically look like scheduling failures.

## 34.5 Revenue per Physical Visit

```text
field_revenue / physical_visits
```

Useful as a diagnostic, not an optimization target.

## 34.6 Revenue per Unique Location

Shows the economic relationship between customer/project value and repeated field activity.

## 34.7 Stop Efficiency

```text
unique_project_locations / physical_visits
```

Useful for trend analysis.

## 34.8 Delivery + Installation Consolidation Rate

Measure how often related delivery and installation work is completed during one compatible crew-arrival event.

## 34.9 Avoidable Duplicate-Visit Rate

Use split / exception reasons to distinguish:

- customer-driven;
- inventory-driven;
- site-driven;
- operationally avoidable;
- legitimate technical follow-up.

This KPI is more actionable than raw repeat-visit count.

---

# 35. Revenue Attribution

Revenue should live on `dispatch_work`, not on `visit`.

Conceptually:

- product revenue → delivery work;
- installation labor revenue → installation work;
- repair labor → service work;
- delivery-related fees → delivery work;
- other revenue → configured attribution rule.

A visit may contain multiple work headers, but revenue is not duplicated because each revenue amount belongs to exactly one dispatch-work header.

This makes route and day revenue additive.

Edge cases such as discounts, freight, warranty, tax, haul-away charges, and miscellaneous fees should use explicit configuration.

---

# 36. Suggested Core Tables

This is conceptual, not a final physical schema.

```text
project

service_location
travel_node
location_modifier

commercial_transaction
commercial_line

dispatch_work
dispatch_work_line
dispatch_work_relationship

visit
visit_dispatch_work

route
route_visit_assignment

vehicle
route_vehicle_assignment

person
capability
person_capability
route_person_assignment

work_requirement

item_standard
service_standard
delivery_type_standard

split_reason
dispatch_split

route_status_history
work_status_history

travel_matrix

schedule_decision
```

---

# 37. Schedule Decision Record

Persist the decision, not every transient candidate.

Example conceptual structure:

```text
schedule_decision
-----------------
id
dispatch_work_id
chosen_date
chosen_route_id
incremental_route_minutes
incremental_physical_visit
consolidation_possible
existing_visit_id
remaining_capacity
recommendation_reason
alternatives_snapshot
decided_by
decided_at
```

Potential recommendation reasons:

- consolidation;
- lowest insertion cost;
- only feasible date;
- customer preference;
- capacity constraint;
- manual selection.

This produces useful historical/training data later.

---

# 38. Auditability

Nearly every meaningful manual intervention should be auditable.

Examples:

- status changes;
- date changes;
- route changes;
- vehicle swaps;
- person swaps;
- capability overrides;
- duration overrides;
- split reasons;
- hard-constraint overrides;
- customer commitment changes.

Store:

- previous value;
- new value;
- user;
- timestamp;
- reason where appropriate.

The system should be easy to explain after the fact.

---

# 39. Configuration vs Code

Operational constants should be configuration wherever practical.

Examples:

- normal route-duration threshold;
- break ranges;
- break durations;
- customer window length;
- item/category point standards;
- capability definitions;
- delivery-type base minutes;
- service standard minutes;
- service area rules;
- route warning thresholds;
- fallback values.

The schema should encode concepts.  
The database/configuration should encode current operating values.

---

# 40. ERP / Import Strategy

Agility will consume ERP exports and other internal feeds.

The import model should:

1. land raw data;
2. retain import metadata;
3. transform into normalized internal objects;
4. derive dispatch work;
5. preserve source IDs;
6. identify changed rows;
7. never depend on mutable display names;
8. support replay / reprocessing after mapping changes.

The existing ERP export can be attached as implementation context, but Agility should not simply mirror its shape.

The export is a source payload, not the application domain model.

---

# 41. Refresh Cadence

Different data has different urgency.

### High-frequency operational data
Refresh frequently:

- invoices/work orders;
- readiness status;
- requested/scheduled dates;
- route assignments;
- cancellations;
- customer changes.

### Lower-frequency reference data
Can update less frequently:

- item standards;
- category defaults;
- capability catalog;
- vehicle master;
- employee master.

Avoid making dispatchers operate against a stale demand picture.

---

# 42. Hard Constraints vs Warnings

This distinction is important.

## Hard exclusions

Dates/resources should be excluded when genuinely impossible.

Examples:

- not operationally ready;
- employee unavailable;
- required capability absent;
- vehicle physically incapable;
- route closed / unavailable;
- outside supported service area;
- committed elsewhere.

## Warnings / overridable conditions

Examples:

- route longer than normal;
- route revenue looks light;
- capacity buffer is small;
- unusual drive burden;
- preferred date compromised;
- human duration override needed.

Warnings should not masquerade as hard constraints.

---

# 43. Exception Handling

The product should assume exceptions are normal.

Common operational changes include:

- customer becomes unready;
- scope changes;
- customer wants delivery without installation;
- person calls out;
- vehicle problem;
- job runs long;
- product issue;
- access/site condition differs from expected;
- another department is needed for support.

Agility should make these changes easy while preserving history.

---

# 44. Department Independence with Shared Infrastructure

Repair/service, HVAC, cabinet/modification, and appliance delivery/install are operationally distinct but should share the same underlying abstractions:

```text
work
visit
route
vehicle
people
capability
duration
status
project
location
```

Departments may have different:

- typical people count;
- vehicle type;
- capability rules;
- duration standards;
- revenue model;
- route density;
- customer scheduling behavior.

Avoid building separate scheduling systems for each department.

Use one model with configurable departmental rules.

---

# 45. UI Mental Model

A dispatcher should be able to think in three swappable columns:

```text
[ ROUTE ] [ VEHICLE ] [ PEOPLE ]
```

The route contains the work.

Vehicle and people can be swapped independently, subject to feasibility.

Example route card:

```text
WEST ROUTE
--------------------------------
Visits:          6
Revenue:         $...
Work minutes:    ...
Drive minutes:   ...
Break guidance:  ...
Total:           ...

Vehicle:         [assigned / TBD] [swap]
People:          [names]          [swap]

Warnings:
- capability
- vehicle capacity
- duration
- driver
- customer commitment
```

This should be a central interaction pattern.

---

# 46. Recommendation Examples

Agility should produce recommendations like:

> **Consolidation opportunity**  
> This installation can be completed during an existing delivery visit at the same location.

> **Route improvement**  
> Moving this flexible work to another date eliminates one additional crew arrival and reduces incremental drive time.

> **Capability warning**  
> This route contains work requiring a capability that none of the assigned people currently have.

> **Vehicle warning**  
> The assigned vehicle is projected to exceed capacity after planned haul-away and packaging are added.

> **Driver warning**  
> No assigned person is currently eligible to drive the vehicle.

> **Duration warning**  
> Planned work + drive + breaks exceed the normal route threshold.

Recommendations should explain the underlying facts.

---

# 47. Non-Goals for Early Versions

Do not initially attempt to:

- autonomously move committed customer work;
- autonomously reassign people;
- autonomously reassign vehicles;
- build a black-box optimization score;
- infer inventory readiness;
- perfectly predict traffic minute-by-minute;
- create a complete AI scheduling optimizer;
- replace human exception handling;
- model every unusual vehicle/equipment attribute before needed.

The goal is to improve dispatcher decisions first.

---

# 48. Future Optimization Opportunities

Once enough historical data exists, Agility may later support:

- capacity rationing based on economic value;
- learned duration calibration;
- suggested capability changes;
- staffing forecasts;
- route-template learning;
- probability of job overrun;
- probability customer/site is not ready;
- automated customer rescheduling offers;
- smarter vehicle-load forecasting;
- automated route construction;
- historical route-quality benchmarking;
- ML-assisted recommendations.

These should build on the transparent data model rather than replace it.

---

# 49. Historical Data Value

The architecture should deliberately preserve data that becomes useful later:

- scheduled duration vs actual duration;
- recommended date vs chosen date;
- incremental route cost at decision time;
- route changes;
- resource swaps;
- capability overrides;
- split reasons;
- customer readiness failures;
- product-readiness failures;
- vehicle overload warnings;
- repeat visits;
- recommendation acceptance rates.

This makes later optimization evidence-driven.

---

# 50. Implementation Philosophy for Codex

Codex should treat this document as the domain model and product intent, not as a directive to hard-code operating values.

Key principles:

1. **Keep route, vehicle, and people separate.**
2. **Keep invoice, dispatch work, visit, and route separate.**
3. **Do not equate same address/date with one physical visit.**
4. **Support one visit/job context appearing on multiple routes for convergence.**
5. **Use transparent marginal metrics rather than an opaque score.**
6. **Use configuration tables for thresholds and standards.**
7. **Preserve source ERP IDs and audit history.**
8. **Use internal stable IDs for projects, service locations, and work.**
9. **Generate transient schedule candidates on demand.**
10. **Persist the final scheduling decision and alternatives snapshot.**
11. **Treat human overrides as valid operational inputs and valuable calibration data.**
12. **Keep revenue additive at the dispatch-work level.**
13. **Model vehicle capacity as a changing load across route sequence.**
14. **Aggregate work requirements to determine route resource feasibility.**
15. **Begin recommendation-only; do not silently change schedules.**

---

# 51. Minimum v0.1 Functional Spine

A useful first implementation should be able to:

1. Import ERP source data.
2. Normalize transactions, lines, locations, and projects.
3. Derive dispatch-work headers.
4. Calculate work duration from standards.
5. Identify work eligible for scheduling.
6. Generate candidate dates.
7. Detect consolidation opportunities.
8. Calculate incremental route minutes.
9. Create / edit routes.
10. Assign visits to routes.
11. Support multi-route convergence at a job.
12. Assign / swap vehicles.
13. Assign / swap named people.
14. Validate capability coverage.
15. Validate driver eligibility.
16. Calculate work + drive + break guidance.
17. Calculate running vehicle capacity.
18. Display route / department / company revenue.
19. Warn instead of auto-rejecting soft operational limits.
20. Record split reasons and manual overrides.
21. Persist schedule decisions and audit history.
22. Provide route-quality and consolidation KPIs.

---

# 52. Open Configuration Areas

These need business values later but do not change the conceptual model:

- exact department mappings;
- exact delivery/service types;
- exact duration values;
- exact product point values;
- exact packaging factors;
- exact vehicle capacities;
- exact people capacities;
- exact capability names and hierarchy;
- exact daily route threshold;
- exact break rules;
- exact customer window duration;
- exact readiness status values;
- exact route lifecycle names;
- exact customer mobility behavior;
- exact service-area rules;
- exact routing-provider configuration;
- exact reason-code lists;
- exact revenue attribution edge cases.

These should be implemented as configuration, not baked into application logic.

---

# 53. Desired End State

Agility should eventually let a dispatcher look at the business as a set of swappable, explainable components:

```text
WORK
  ↓
VISITS
  ↓
ROUTES
  ↓
┌───────────────┬───────────────┐
│    VEHICLE    │    PEOPLE     │
└───────────────┴───────────────┘
        ↓
  FEASIBILITY
        ↓
  RECOMMENDATIONS
        ↓
 HUMAN DECISION
```

The system should make better operational decisions easier without hiding the logic from the people who run the business.

The guiding principle is:

> **Use data to expose the operational consequence of a scheduling choice, while keeping humans in control of customer commitments and exceptions.**
