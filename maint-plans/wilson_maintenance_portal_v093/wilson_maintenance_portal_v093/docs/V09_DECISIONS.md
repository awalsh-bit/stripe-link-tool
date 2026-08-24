# Wilson Maintenance Portal v0.9 decisions

## Exact visit routing
The field tool never falls back to a sample household. A launch must carry the exact visit ID. The visit record is authoritative for household ID and a mismatched household/visit pair is blocked.

## Household program separation
Residence profiles expose separate Appliance Maintenance and HVAC Maintenance modules. The appliance launch points only to the next open appliance interval. The HVAC module is separate and its field launch remains disabled until the HVAC workflow is implemented.

## Field ratings
The slider is removed. Each checkpoint uses five large tap targets: 1 Poor, 2 Concern, 3 Monitor, 4 Good, 5 Excellent. Ratings 1-2 remain follow-up/action, 3 remains monitor, 4-5 pass.

## Phone testing
The local development server binds to the computer's LAN interfaces and prints a phone URL. It should only be used on a trusted private LAN for prototype testing; it is not production hosting.
