// Static product lines for Step 02, mirroring the prototype's sample PI.
// Frontend-only data — replaced by the PI / product APIs later.
export type ProductLine = {
  code: string;
  name: string;
  hsn: string;
  /** Full GST rate for the product; split into CGST / SGST on the row. */
  gst: number;
  qtyPi: number;
  rate: number;
  description: string;
};

export const PI_PRODUCTS: ProductLine[] = [
  {
    code: 'P-002', name: 'Whole Wheat Flour 50kg', hsn: '11010000', gst: 5, qtyPi: 150, rate: 220,
    description: 'Stone-ground whole wheat flour milled from hard red wheat sourced through contracted farms in Madhya Pradesh and Rajasthan. The grain is cleaned, de-stoned and tempered before milling, then passed through a chakki mill that keeps the bran and germ intact for a higher fibre content. Each batch is tested for moisture, gluten strength and falling number, with a certificate of analysis issued against the lot number. Packed in 50 kg laminated polypropylene sacks with an inner food-grade liner.',
  },
  {
    code: 'P-003', name: 'GreenBoost Organic Fertilizer', hsn: '31010000', gst: 5, qtyPi: 50, rate: 188,
    description: 'Granular organic NPK fertilizer produced from composted press mud, neem cake and rock phosphate, enriched with beneficial microbes to improve nutrient uptake in the root zone. The granules are uniformly sized between 2 and 4 mm, which allows even broadcasting through standard spreaders without dust loss. Nutrient content is guaranteed at 4-3-3 with organic carbon above 18 percent, verified batch-wise by an accredited soil laboratory.',
  },
  {
    code: 'P-004', name: 'Organic Mango Pulp', hsn: '20079100', gst: 12, qtyPi: 100, rate: 75,
    description: 'Aseptic Alphonso mango pulp processed within twenty-four hours of harvest from orchards in the Ratnagiri and Devgad belt, preserving the varietal aroma and colour. Fruit is washed, sorted and de-stoned before pulping, then pasteurised and filled hot into sterile bags inside steel drums. Brix is held between 15 and 17 degrees with acidity under 0.5 percent.',
  },
  {
    code: 'P-005', name: 'Quality Testing Service', hsn: '999899', gst: 18, qtyPi: 1, rate: 3200,
    description: 'Third-party quality testing and certification service covering incoming raw material, in-process control and finished goods, carried out by an NABL-accredited laboratory. The scope includes moisture, microbiological load, pesticide residue and heavy metals, with reports issued against each lot number within three working days.',
  },
];

// What the PO-side picker can choose from.
export const PRODUCT_CATALOGUE: ProductLine[] = [
  ...PI_PRODUCTS,
  { code: 'P-006', name: 'Basmati Rice 25kg', hsn: '10063020', gst: 5, qtyPi: 0, rate: 1850, description: 'Aged long-grain basmati rice, sortex cleaned and packed in 25 kg jute bags.' },
  { code: 'P-007', name: 'Refined Sunflower Oil 15L', hsn: '15121110', gst: 5, qtyPi: 0, rate: 1620, description: 'Refined sunflower oil in 15 litre food-grade tins, cold-filtered and winterised.' },
];

export const productOption = (p: ProductLine) => `${p.code} — ${p.name}`;

/** Within the same state the tax splits 9 / 9; across states it is half each. */
export function gstSplit(gst: number, stateCode: string): { cgst: number; sgst: number } {
  if (stateCode === '27') return { cgst: 9, sgst: 9 };
  const half = gst / 2;
  return { cgst: half, sgst: half };
}
