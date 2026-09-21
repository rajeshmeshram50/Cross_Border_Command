// Sample inspection products for the Payment Request page until it is wired
// to the PO API. The Physical Inspection popup reads the PO's real lines.
import type { InspectionProduct } from '../../purchase-management/order/physical-inspection/inspection-shared';

export const INSPECTION_PRODUCTS: InspectionProduct[] = [
  {
    code: 'P-002', name: 'Whole Wheat Flour 50kg', hsn: '11010000', qty: 150, gst: 5,
    price: 1650, uom: 'Bag', uomShort: 'BAG', segment: 'Food Grains', condition: 'New', packaging: 'Laminated PP Sack',
    brand: 'Chakki-milled whole wheat atta · 50 kg laminated PP sack with food-grade liner · Moisture below 12% · FSSAI licensed mill',
    desc: 'Stone-ground whole wheat flour milled from hard red wheat sourced through contracted farms in Madhya Pradesh and Rajasthan. The grain is cleaned, de-stoned and tempered before milling, then passed through a chakki mill that keeps the bran and germ intact for a higher fibre content and the nutty aroma expected in Indian kitchens. Each batch is tested for moisture, gluten strength and falling number, with a certificate of analysis issued against the lot number. Packed in 50 kg laminated polypropylene sacks with an inner food-grade liner, printed with the mill date, lot code and FSSAI licence number. Shelf life is six months from the mill date when stored below 25°C in a dry, well-ventilated warehouse away from strong odours. Supplied on heat-treated pallets of 20 bags, shrink-wrapped for container loading, with pallet labels carrying batch and quantity for scanning at the receiving dock.',
  },
  {
    code: 'P-003', name: 'GreenBoost Organic Fertilizer', hsn: '31010000', qty: 50, gst: 5,
    price: 900, uom: 'Bag', uomShort: 'BAG', segment: 'Agri Inputs', condition: 'New', packaging: 'HDPE Bag',
    brand: 'GreenBoost · Granular NPK 4-3-3 · Organic carbon above 18% · FCO registered · 25 kg HDPE bag',
    desc: 'Granular organic NPK fertilizer produced from composted press mud, neem cake and rock phosphate, enriched with beneficial microbes to improve nutrient uptake in the root zone. The granules are uniformly sized between 2 and 4 mm, which allows even broadcasting through standard spreaders without segregation or dust loss during application. Nutrient content is guaranteed at 4-3-3 with organic carbon above 18 percent, verified batch-wise by an accredited soil laboratory. The product carries an FCO registration and is approved for use on certified organic farms, with residue testing performed on every production lot. Recommended application is 200 to 250 kg per hectare, split between basal dressing and the first top dressing depending on crop and soil condition. Supplied in 25 kg HDPE bags with an inner liner, palletised 40 bags per pallet and shrink-wrapped, with a twelve-month shelf life when stored under cover and clear of standing water.',
  },
  {
    code: 'P-004', name: 'Organic Mango Pulp', hsn: '20079100', qty: 100, gst: 12,
    price: 2400, uom: 'Carton', uomShort: 'CTN', segment: 'Processed Food', condition: 'New', packaging: 'Aseptic Tin',
    brand: 'Alphonso mango pulp · Brix 16–18° · No added sugar or preservative · 12 × 3.1 kg aseptic tins per carton',
    desc: 'Aseptic Alphonso mango pulp processed within twenty-four hours of harvest from orchards in the Ratnagiri and Devgad belt, preserving the varietal aroma, deep saffron colour and natural sweetness the cultivar is known for. Fruit is ripened under controlled conditions, washed, de-stoned and pulped, then passed through a tubular steriliser and filled aseptically into pre-sterilised bags under nitrogen. Brix is standardised between 16 and 18 degrees with acidity held at 0.4 to 0.6 percent, and every batch is tested for pH, consistency and microbiological load before release. The product is free from added sugar, colour and preservative, and complies with FSSAI, US FDA and EU import requirements, with a phytosanitary certificate issued per consignment. Packed in 3.1 kg food-grade aseptic tins, twelve tins to a carton, suitable for direct use in beverages, dairy, bakery and retail packing lines. Shelf life is eighteen months at ambient temperature in unopened condition; refrigerate and use within seventy-two hours once opened.',
  },
  {
    code: 'P-005', name: 'Quality Testing Service', hsn: '999899', qty: 1, gst: 18,
    price: 18500, uom: 'Job', uomShort: 'JOB', segment: 'Services', condition: 'Not applicable', packaging: 'Not applicable',
    brand: 'NABL-accredited laboratory network · Physical, chemical and microbiological panel · 5 working day turnaround',
    desc: 'Third-party quality testing and certification service covering incoming raw material, in-process control and finished goods, delivered through a NABL-accredited laboratory network with sample collection at the supplier site. The scope includes physical parameters, proximate analysis, heavy metals, pesticide residue and microbiological screening, with the exact panel agreed against the product specification before sampling begins. Sampling follows documented plans so that results are defensible for both regulatory filing and commercial dispute, and retained samples are held for six months against any re-test request. Standard turnaround is five working days from sample receipt, with a forty-eight hour expedited option available at a premium for shipments already at the port. Results are issued as a certificate of analysis carrying the lot number, test methods, instrument identifiers and the analyst signature, and are uploaded directly to the buyer portal on release. Any out-of-specification result triggers an immediate notification to the nominated quality contact, followed by a root-cause discussion and a re-test protocol at no additional charge.',
  },
];
