# Wilson Sales-Invoice Import — v0.9.4

## Source format

The parser targets the Wilson invoice PDF layout. It uses the text-based table columns and therefore does not require OCR for these files.

Verified against the real `S00063887`, `S00063887-1` and `S00064425` invoices: 20 products classified and 62 support lines excluded, with no unknown customer category emitted. `_qa/verify-invoice-parser.py` holds the regression suite; it runs on synthetic fixtures (`_qa/invoice_fixtures.py`) because real invoices carry customer PII, and can additionally be pointed at a folder of real invoices via `WILSON_REAL_INVOICES`.

An unreadable file — empty, truncated, or not a PDF — is skipped with a named warning rather than failing the whole upload, so one corrupt file in a split-invoice batch no longer discards the good ones.

Expected elements:

- Top-right invoice number such as `S00063887` or `S00063887-1`
- Ship To block
- Columns: `QTY`, `MODEL #`, `DESCRIPTION`, `PRICE`, `EXT PRICE`
- Optional area headings formatted like `***** MAIN HOUSE *****`
- Manufacturer/product classification line below the description
- Optional `Serial # :` line

Upload all split PDFs together. The parser combines them but never assumes an area that is not printed. Products from an unsectioned split invoice are assigned to `Unassigned — Review`.

## Where the product table ends

Every Wilson invoice closes with a terms-and-totals block. Layout extraction
emits its lines with alignment padding, so the parser matches footer markers
against **whitespace-collapsed** text rather than raw strings:

```
EXTENDED WARRANTY        YES     NO     REMOVAL OF OLD UNITS     YES     NO
*      Above order confirmed with  no changes.
*      Please refer to owners manual/installation guides for important details.
*      All authorized returned products will be subject to a 25% restocking charge.
```

**Why this is called out (v0.9.29).** The previous guard tested
`startswith("*Above order")` and never fired on a real invoice, because the
asterisk is followed by six spaces. The whole block was therefore appended to the
**last product's description** — and "owners manual/installation guides" contains
`install`, which is an exclusion phrase. On a customer-pickup invoice, where the
final line is a product rather than an install line, that silently dropped a real
dryer.

The fixtures could not have caught it: none of them emitted a footer at all.
`_qa/invoice_fixtures.py` now writes the terms block **by default**, in the
asterisk-then-spaces shape, so every case in the suite runs against an invoice
shaped like a real one.

Exclusion phrases are matched on word boundaries. That is defence in depth rather
than the fix — with the footer no longer reaching the description, `install` has
nothing to collide with. Note also that the phrase list holds only forms a real
Wilson invoice has been seen to use: `installed` was tried and removed, because
`Pre-Installed Water Line` is product copy.

## Product mapping

| Invoice evidence | Internal exact type | Customer category |
|---|---|---|
| Built-in, column, undercounter, wine, beverage, freezer, commercial/floral refrigeration | Specific refrigerator/freezer/wine/commercial type | Refrigeration |
| Dedicated clear-ice/nugget icemaker | Icemaker (IMUC) | Icemaker |
| Cooktop or rangetop | Cooktop / Rangetop | Cooktop / Rangetop |
| Dual-fuel, gas, electric, or professional range | Range | Range |
| Dishwasher classification | Dishwasher | Dishwasher |
| Hood liner, hood insert, vent hood, or downdraft | Hood Insert / Vent Hood | Ventilation |
| Microwave or speed oven | Microwave / Speed Oven | Microwave |
| Wall, steam, single, double, or combination oven | Wall Oven | Ovens |
| Warming/proofing drawer | Warming Drawer | Warming Drawer |
| Built-in coffee system | Built-In Coffee Maker | Built-In Coffee |
| Outdoor grill, BBQ, kamado, built-in grill | Outdoor Grill | Outdoor Grill (functional inspection only — Wilson never cleans grills) |
| Washer | Washer | Washer |
| Dryer | Dryer | Dryer |
| WashTower / washer-dryer combo / laundry center | Laundry Center / WashTower | Expanded to Washer + Dryer and flagged for review |

Each half of a split WashTower is an independent maintained asset: its own customer category, its own appliance type, and therefore its own inspection protocol — the five-check washer protocol on the washer and the five-check dryer protocol on the dryer. Before v0.9.4 both halves inherited the combined `laundry_center` exact type and the technician got the combined `laundry` protocol on both. The display label still names the WashTower so the office can see the two records are one physical product.

## Lines filtered out

The prototype excludes:

- Installation and delivery
- Payment and credit lines
- Promotional/remodel-program credits
- Decorative panels, mounting kits, toe kicks, knob/bezel kits
- Dishwasher kits, washer hoses, dryer cords/steam kits/vent kits
- Gas flex lines
- Anti-condensation pads
- Standalone hood blower accessories
- Gas conversion kits
- Cabinetry and outdoor millwork
- Other accessory-classified lines

Outdoor grills are **not** excluded — since v0.9.5 they classify to the `Outdoor Grill` category and are inspected for function and safety only. Wilson does not clean grills on any visit or any plan; condition is rated because it feeds the health score, and reported for the customer to act on. Other outdoor equipment (pizza ovens, power burners) still reaches the review queue.

## Production notes

- Persist the original invoice file only under an approved retention policy.
- Store an import batch, source filename, invoice number, parser version, raw extracted line, classification result, user edits, and who approved the import.
- Keep the internal exact type separate from the customer-facing broad category.
- Version the classification rules so reprocessing an old invoice does not silently change historical assets.
- Add model-master lookup when the NetSuite product catalog becomes available; model lookup should outrank description heuristics.
