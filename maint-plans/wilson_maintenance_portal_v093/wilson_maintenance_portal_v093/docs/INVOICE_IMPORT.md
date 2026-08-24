# Wilson Sales-Invoice Import — v0.3

## Source format

The parser targets the Wilson invoice PDF layout supplied for development. It uses the text-based table columns and therefore does not require OCR for these files.

Expected elements:

- Top-right invoice number such as `S00063887` or `S00063887-1`
- Ship To block
- Columns: `QTY`, `MODEL #`, `DESCRIPTION`, `PRICE`, `EXT PRICE`
- Optional area headings formatted like `***** MAIN HOUSE *****`
- Manufacturer/product classification line below the description
- Optional `Serial # :` line

Upload all split PDFs together. The parser combines them but never assumes an area that is not printed. Products from an unsectioned split invoice are assigned to `Unassigned — Review`.

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
| Washer | Washer | Washer |
| Dryer | Dryer | Dryer |
| WashTower / washer-dryer combo / laundry center | Laundry Center / WashTower | Expanded to Washer + Dryer and flagged for review |

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
- Other accessory-classified lines

## Production notes

- Persist the original invoice file only under an approved retention policy.
- Store an import batch, source filename, invoice number, parser version, raw extracted line, classification result, user edits, and who approved the import.
- Keep the internal exact type separate from the customer-facing broad category.
- Version the classification rules so reprocessing an old invoice does not silently change historical assets.
- Add model-master lookup when the NetSuite product catalog becomes available; model lookup should outrank description heuristics.
