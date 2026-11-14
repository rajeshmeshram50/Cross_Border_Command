/* ─────────────────────────────────────────────────────────────────────────
 * Sourcing Management Tracker — types and DUMMY data (design build).
 *
 * The screen is designed on this fixture first; the API is wired in after the
 * design is signed off. Keep the field names here as the contract the API
 * will be asked to return, so wiring it in is a swap of the data source and
 * nothing else.
 *
 * The fixture mirrors the Figma: the signed-in user is Parth Lakare, who
 * created 15 targets and is assigned 15 others.
 * ───────────────────────────────────────────────────────────────────────── */

export type SourceType = 'Product Master' | 'Manual Entry';

export type SourcingTarget = {
  /** ST-001 — per-client sequential. */
  code: string;
  /** Start date, ISO yyyy-mm-dd. Always the day the target was created. */
  startDate: string;
  /** Sourcing TAT — the due date, ISO yyyy-mm-dd. */
  dueDate: string;
  /** Where the products came from; a target can hold both. */
  sources: SourceType[];
  createdBy: string;
  assignedTo: string;
  /** First product's name, shown as "Flow Meter DN50 +13". */
  firstProduct: string;
  /** Products on the target. */
  totalProducts: number;
  /** Products with at least one supplier mapped (= sourced). */
  completedProducts: number;
  /** Suppliers mapped across all of the target's products. */
  mappedSuppliers: number;
};

/** The signed-in user in the fixture. */
export const ME = 'Parth Lakare';

/** "Today" for the fixture, so Overdue reads the same as the Figma. */
export const TODAY = '2026-11-13';

const PM: SourceType[] = ['Product Master'];
const MAN: SourceType[] = ['Manual Entry'];

const t = (
  code: string, startDate: string, dueDate: string, sources: SourceType[],
  createdBy: string, assignedTo: string, firstProduct: string,
  totalProducts: number, completedProducts: number, mappedSuppliers: number,
): SourcingTarget => ({
  code, startDate, dueDate, sources, createdBy, assignedTo,
  firstProduct, totalProducts, completedProducts, mappedSuppliers,
});

export const DUMMY_TARGETS: SourcingTarget[] = [
  // Created by me (Parth Lakare)
  t('ST-001', '2026-01-05', '2026-03-31', PM, ME, 'Arjun Mehta', 'Flow Meter DN50', 14, 14, 14),
  t('ST-003', '2026-02-01', '2026-04-15', PM, ME, 'Priya Sharma', 'Hydraulic Cylinder 50T', 18, 11, 11),
  t('ST-004', '2026-03-01', '2026-04-30', MAN, ME, 'Rohan Kulkarni', 'GI Bolts M12', 12, 5, 5),
  t('ST-007', '2026-03-05', '2026-05-01', PM, ME, 'Karan Singh', 'PLC Module I/O', 15, 0, 0),
  t('ST-010', '2026-03-20', '2026-05-20', PM, ME, 'Sneha Patil', 'Flow Meter DN50', 13, 10, 10),
  t('ST-012', '2026-01-12', '2026-04-02', PM, ME, 'Vikram Patel', 'Hydraulic Cylinder 50T', 20, 14, 14),
  t('ST-014', '2026-02-08', '2026-04-22', MAN, ME, 'Ananya Gupta', 'Carbon Steel Flange', 11, 11, 11),
  t('ST-016', '2026-02-18', '2026-05-05', PM, ME, 'Karan Singh', 'PLC Module I/O', 17, 12, 12),
  t('ST-018', '2026-03-02', '2026-05-12', PM, ME, 'Meera Krishnan', 'Aluminium Sheet 3mm', 10, 3, 3),
  t('ST-021', '2026-03-10', '2026-05-28', MAN, ME, 'Ananya Gupta', 'Hydraulic Cylinder 50T', 16, 0, 0),
  t('ST-020', '2026-04-18', '2026-07-01', PM, ME, 'Priya Sharma', 'Control Valve 3"', 8, 3, 4),
  t('ST-024', '2026-06-10', '2026-08-25', PM, ME, 'Rohan Kulkarni', 'Steel Pipes 2"', 16, 9, 10),
  t('ST-026', '2026-07-14', '2026-09-30', PM, ME, 'Vikram Patel', 'Bearing SKF 6205', 10, 2, 2),
  t('ST-028', '2026-09-01', '2026-11-30', PM, ME, 'Ananya Gupta', 'Hydraulic Cylinder 50T', 7, 1, 1),
  t('ST-030', '2026-10-20', '2026-12-31', PM, ME, 'Karan Singh', 'Gate Valve 2"', 12, 0, 0),

  // Assigned to me (Parth Lakare)
  t('ST-002', '2026-01-05', '2026-03-31', PM, 'Admin', ME, 'Ball Valve 1.5"', 13, 8, 8),
  t('ST-005', '2026-02-15', '2026-03-15', PM, 'Meera Krishnan', ME, 'Carbon Steel Flange', 10, 10, 10),
  t('ST-008', '2026-03-10', '2026-05-10', MAN, 'Aarav Sharma', ME, 'Pneumatic Valve FRL', 16, 11, 11),
  t('ST-011', '2026-01-20', '2026-04-10', PM, 'Admin', ME, 'Ball Valve 1.5"', 14, 4, 4),
  t('ST-013', '2026-02-02', '2026-04-18', PM, 'Priya Nair', ME, 'GI Bolts M12', 12, 6, 6),
  t('ST-015', '2026-02-22', '2026-05-02', MAN, 'Admin', ME, 'Temperature Sensor PT100', 15, 15, 15),
  t('ST-017', '2026-03-04', '2026-05-14', PM, 'Rohan Mehta', ME, 'Pneumatic Valve FRL', 18, 13, 13),
  t('ST-019', '2026-03-12', '2026-05-22', PM, 'Aarav Sharma', ME, 'Gate Valve 2"', 11, 0, 0),
  t('ST-033', '2026-04-08', '2026-06-20', PM, 'Meera Krishnan', ME, 'Flow Meter DN50', 9, 9, 9),
  t('ST-023', '2026-05-02', '2026-07-12', PM, 'Admin', ME, 'Pressure Gauge 100mm', 7, 4, 5),
  t('ST-025', '2026-06-01', '2026-08-15', MAN, 'Priya Nair', ME, 'Copper Wire 4mm', 5, 5, 6),
  t('ST-027', '2026-07-09', '2026-09-24', PM, 'Rohan Mehta', ME, 'PLC Module I/O', 13, 6, 6),
  t('ST-029', '2026-08-20', '2026-11-05', PM, 'Aarav Sharma', ME, 'Control Valve 3"', 10, 7, 8),
  t('ST-031', '2026-10-01', '2026-12-15', MAN, 'Admin', ME, 'Solenoid Valve 24V', 14, 3, 3),
  t('ST-032', '2026-10-28', '2027-01-10', PM, 'Meera Krishnan', ME, 'Bearing SKF 6205', 8, 0, 0),
];

/* ── Derived state (never stored) ─────────────────────────────────────── */

export const isComplete = (r: SourcingTarget) => r.totalProducts > 0 && r.completedProducts >= r.totalProducts;

export const progressPct = (r: SourcingTarget) =>
  r.totalProducts ? Math.round((Math.min(r.completedProducts, r.totalProducts) / r.totalProducts) * 100) : 0;


/* ── data.ts chya shevti he paste kara (existing code la haat lavu naka) ── */

/** Product Master la dummy rows — API aalyavar hech field names return kele jatil. */
export type MasterProduct = { code: string; name: string; segment: string; hsn: string };

export const MASTER_PRODUCTS: MasterProduct[] = [
  { code: 'P-001', name: 'Premium Basmati Rice 1121 Sella (25kg)', segment: 'Rice', hsn: '10063020' },
  { code: 'P-002', name: 'Flow Meter DN50', segment: 'Instruments', hsn: '90261010' },
  { code: 'P-003', name: 'Hydraulic Cylinder 50T', segment: 'Hydraulics', hsn: '84122100' },
  { code: 'P-004', name: 'GI Bolts M12', segment: 'Fasteners', hsn: '73181500' },
  { code: 'P-005', name: 'PLC Module I/O', segment: 'Automation', hsn: '85371000' },
  { code: 'P-006', name: 'Carbon Steel Flange', segment: 'Piping', hsn: '73079100' },
  { code: 'P-007', name: 'Gate Valve 2"', segment: 'Valves', hsn: '84818030' },
  { code: 'P-008', name: 'Bearing SKF 6205', segment: 'Bearings', hsn: '84821090' },
];

/** "Assign To" dropdown (API: users of the client). */
export const ASSIGNEES = [
  'Arjun Mehta', 'Priya Sharma', 'Rohan Kulkarni', 'Karan Singh',
  'Sneha Patil', 'Vikram Patel', 'Ananya Gupta', 'Meera Krishnan',
];

/** Popup madhla ek product row (save hoin paryant). */
export type DraftProduct = {
  key: string;
  source: SourceType;
  code: string;      // Manual la '—'
  name: string;
  segment: string;
  hsn: string;
  targetPrice: string;   // required
  clarity: string;       // optional
};

/** Next ST-0xx — per-client sequential. */
export const nextCode = (all: SourcingTarget[]) => {
  const max = all.reduce((m, r) => Math.max(m, parseInt(r.code.replace(/\D/g, ''), 10) || 0), 0);
  return `ST-${String(max + 1).padStart(3, '0')}`;
};

/** Aajchi khari tarikh, local, yyyy-mm-dd (TODAY fixture nahi — to fakt Overdue sathi). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
