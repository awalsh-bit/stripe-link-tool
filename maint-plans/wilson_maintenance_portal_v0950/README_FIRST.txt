WILSON MAINTENANCE PORTAL v0.9.20 - START HERE

WINDOWS / DESKTOP - DEMO ON ONE COMPUTER
1. Extract the ZIP completely.
2. Double-click OPEN_WILSON_PORTAL.bat.
3. Keep the black command window open while using the prototype.

This serves the tool to that computer and nowhere else. Nothing on the
network can reach it, and no passcode is needed. Demo data only.

PHONE TESTING, AND ANY REAL CUSTOMER STOP
1. Double-click SET_PASSCODE.bat once, on the computer that will hold the
   data. Type a passcode twice. It is stored as a hash, never as itself.
2. Put the phone and the computer on the same Wi-Fi/network.
3. Double-click OPEN_FOR_PHONES.bat on the computer.
4. The black window prints two addresses:
   - Computer: http://127.0.0.1:PORT/index.html
   - Phone (same Wi-Fi/LAN): http://YOUR-PC-IP:PORT/index.html
5. Type the Phone address into Safari/Chrome on the phone and enter the
   passcode. It lasts 12 hours per phone.
6. If Windows Firewall asks about Python, allow Private networks only.

Without a passcode, OPEN_FOR_PHONES.bat refuses to start and says so. That
is deliberate: once a real stop has been run, this folder holds a customer's
name, address, phone number and photographs of the inside of their house.

PHOTOGRAPHS
Photos taken on a phone are saved on that phone first, then uploaded to the
computer running the tool -- into .\photo-store -- as soon as it is
reachable. The field tool says either "all photographs are on the shop
machine" or how many are still waiting. Do not clear a phone's browser while
it still says waiting. See docs/PILOT_READINESS.md before the first real
stop, and print docs/FIELD_CARD.pdf for the van.

If the phone cannot connect, the Wi-Fi may isolate devices from each other. A personal hotspot or a normal private Wi-Fi network is usually the easiest test environment. Do not expose this prototype through router port-forwarding or the public internet.

FIELD VISIT SAFETY
The tech tool no longer guesses a residence when opened without a visit ID. Open a household record and use the Launch appliance visit button in that household's Appliance Maintenance section. HVAC is displayed separately and does not enter the appliance field workflow.

WHAT IS NEW IN v0.9.19 - FOR THE TECHS
Conditions you judge by eye now count toward the health score, and every answer
shows what it is worth right on the button. Cloudy or incomplete ice is a 3 of
5, not producing is a 1, full clear cubes is a 5. No guessing what the tool did
with your answer.

The answers changed with it. "Good / wear noted / needs attention" is gone --
every list now describes what you are actually looking at ("transition crushed,
kinked, or off" rather than "needs attention"), because two people can agree on
what they see and cannot agree on a number out of five.

Dirt is still free. Every "cleaned at this visit" answer is a 5 of 5, the same
as spotless. We do not dock a customer for how their appliance looked before you
got there, and you can see that on the button.

"Could not get to it" scores nothing and is never held against the appliance.
Use it rather than guessing.

The numbers behind all this are a draft. If one is wrong, say which and what it
should be -- see the protocol review page.

WHAT WAS NEW IN v0.9.18 - FOR THE TECHS
Every question now matches what you are actually measuring. The number pad only
opens where a number is the answer -- it used to open on nearly every check,
including door seals. The oven asks for the set point AND the measured
temperature and works out the difference for you. "Codes present" makes you
record the code. Conditions you judge by eye (filter and sump, door boot, lint
path, baffles, bin) are their own checks with a photograph, asked BEFORE you
clean, and the cleaning itself is a chip at the bottom of the protocol.

Every pick-one list now has a "could not see it / could not test it" answer.
Use it. It scores nothing and it is a better record than a guess.

If a control still does not fit what you are doing, say so -- see the protocol
review page. That is the argument we want to have.

WHAT WAS NEW IN v0.9.17 - FOR THE TECHS
There is nothing to type during a protocol. Readings go in on a number pad
inside the app, appliance age is a decade button then a year button (or
"Cannot establish it", which is a real answer), and maintenance is a row of
chips - "Condenser coil vacuumed", "Water filter replaced" - that write the
customer's note for you. Free-text notes are still there, per appliance, for
your own words.

Two things the tool will now refuse to do, on purpose:
- It will not show a score or a letter grade before you have measured
  something. A dash means nothing has been measured yet, not zero.
- Work you performed and conditions you judged by eye are recorded, printed
  and photographed, but they do not move the health score. Only measured
  performance does. The customer's report shows all three separately.

Age is 25% of the score on both the appliance and the HVAC side, and the
expected-life figures behind it now cite published sources (ASHRAE, the NAHB
component study, DOE/AHRI, and the manufacturers' own statements). Five rows
are still Wilson estimates and say so on the report.
