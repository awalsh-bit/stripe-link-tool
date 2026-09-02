# Wilson Maintenance Portal v0.6 decisions

## Refrigeration field protocol

The refrigerator / refrigeration health protocol is intentionally capped at five field checkpoints:

1. Compartment temperature performance
2. Evaporator frost pattern
3. Condenser temperature and coil service
4. Components and operating sound
5. Airflow and filter status

The technician must record age, a serial-tag photo, every required checkpoint, primary-compartment actual temperature and set point, and both ambient and condenser-coil surface temperature before completing the appliance. Other checkpoint photos are optional.

Condenser reference guidance supplied for the prototype: surface temperature typically about 15–30°F above room ambient and generally under roughly 110–120°F. The tool calculates the temperature differential but does not diagnose a refrigerant leak from condenser temperature alone.

Typical temperature guidance shown to the tech: fresh-food 35–38°F and freezer close to 0°F; specialty refrigeration is compared with its actual set point.

## Lifecycle

Health scoring remains 75% current-condition vitals and 25% lifecycle age. Draft lifecycle labels are Early Life, Mid Life, Mature, and Replacement Planning. Product tier and appliance category control the draft expected service life.

## Refrigeration filter service

Every refrigeration appliance on the customer-facing enrollment can independently opt into Wilson Filter Service, even on a per-appliance plan. Estate Concierge automatically includes the service. No new flat filter price was invented in v0.6: filter materials are labeled as billed at service after Wilson verifies the actual filter type / part number.
