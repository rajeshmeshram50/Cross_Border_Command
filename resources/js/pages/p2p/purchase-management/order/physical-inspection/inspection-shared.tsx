import type { ReactNode } from 'react';
import type { OrderRow } from '../po-list/Order';

export type Verdict = 'correct' | 'damaged' | 'mismatched';

export type ProofFile = {
  name: string;
  size: number;
  kind: 'image' | 'video' | 'file';
  url: string;
  thumb?: string;
};

export type InspectionLine = {
  verdict: Verdict | '';
  files: ProofFile[];
};

export type InspectionDraft = {
  lines: Record<string, InspectionLine>;
  note: string;
  noteFiles: ProofFile[];
};

export type InspectionRecord = {
  by: string;
  role: string;
  at: string;
  lines: Record<string, InspectionLine>;
  note: string;
  noteFiles: ProofFile[];
};

export type InspectionProduct = {
  code: string;
  name: string;
  hsn: string;
  qty: number;
  gst: number;
  price: number;
  uom: string;
  uomShort: string;
  segment: string;
  condition: string;
  packaging: string;
  brand: string;
  desc: string;
};

export const INSPECTOR = { name: 'Rajesh Healthcare', role: 'Branch User' };

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

const SEED_FILES: ProofFile[] = [
  { name: 'batch-seal-closeup.jpg', size: 214000, kind: 'image', url: '' },
  { name: 'delivery-label.jpg', size: 168500, kind: 'image', url: '' },
  { name: 'quality-certificate.pdf', size: 96400, kind: 'file', url: '' },
];

export function seedDraft(): InspectionDraft {
  return {
    lines: { [INSPECTION_PRODUCTS[0].code]: { verdict: 'correct', files: SEED_FILES.map((f) => ({ ...f })) } },
    note: '',
    noteFiles: [],
  };
}

export function seedRecord(row: OrderRow): InspectionRecord {
  const lines: Record<string, InspectionLine> = {};
  INSPECTION_PRODUCTS.forEach((p, i) => {
    lines[p.code] = { verdict: 'correct', files: i === 0 ? SEED_FILES.map((f) => ({ ...f })) : [] };
  });
  const t = Date.parse(row.poDate + 'T10:30:00');
  return {
    by: INSPECTOR.name,
    role: INSPECTOR.role,
    at: new Date(Number.isNaN(t) ? Date.now() : t + 12 * 86400000).toISOString(),
    lines,
    note: '',
    noteFiles: [],
  };
}

export function fileSize(b: number): string {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const THUMB_PX = 80;

async function makeThumb(file: File): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.72));
    return blob ? URL.createObjectURL(blob) : '';
  } catch {
    return '';
  }
}

export async function toProofFiles(list: FileList | null): Promise<ProofFile[]> {
  const files = list ? Array.from(list) : [];
  return Promise.all(files.map(async (f): Promise<ProofFile> => {
    const isImg = /^image\//.test(f.type);
    const isVid = /^video\//.test(f.type);
    const url = isImg ? URL.createObjectURL(f) : '';
    const thumb = isImg ? await makeThumb(f) : '';
    return { name: f.name, size: f.size, kind: isVid ? 'video' : isImg ? 'image' : 'file', url, thumb };
  }));
}

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

export const VERDICTS: { k: Verdict; t: string; ico: ReactNode }[] = [
  { k: 'correct', t: 'Correct', ico: <svg {...ic} strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg> },
  {
    k: 'damaged', t: 'Damaged',
    ico: (
      <svg {...ic} strokeWidth={2.4}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  { k: 'mismatched', t: 'Mismatched', ico: <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> },
];

const ICON_DOC = <svg {...ic} strokeWidth={2.2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const ICON_VID = <svg {...ic} strokeWidth={2.2}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>;
const ICON_EYE = <svg {...ic} strokeWidth={2.4}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>;
const ICON_DL = <svg {...ic} strokeWidth={2.4}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
const ICON_X = <svg {...ic} strokeWidth={2.8}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;

export function ProofChip({ file, onView, onDownload, onRemove }: {
  file: ProofFile; onView: () => void; onDownload: () => void; onRemove?: () => void;
}) {
  return (
    <div className="pins-chip">
      {file.thumb
        ? <span className="pins-chip__thumb pins-chip__thumb--img"><img src={file.thumb} alt="" decoding="async" /></span>
        : <span className="pins-chip__thumb">{file.kind === 'video' ? ICON_VID : ICON_DOC}</span>}
      <span className="pins-chip__meta">
        <b title={file.name}>{file.name}</b>
        <i>{fileSize(file.size)}</i>
      </span>
      <span className="pins-chip__acts">
        <button type="button" className="pins-chip__act pins-chip__act--view" title={`View ${file.name}`} onClick={onView}>{ICON_EYE}</button>
        <button type="button" className="pins-chip__act pins-chip__act--dl" title={`Download ${file.name}`} onClick={onDownload}>{ICON_DL}</button>
      </span>
      {onRemove && (
        <button type="button" className="pins-chip__x" title="Remove" onClick={onRemove}>{ICON_X}</button>
      )}
    </div>
  );
}

export function openFile(file: ProofFile): boolean {
  if (!file.url) return false;
  try { window.open(file.url, '_blank'); return true; } catch { return false; }
}

export function downloadFile(file: ProofFile): boolean {
  if (!file.url) return false;
  try {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch { return false; }
}
