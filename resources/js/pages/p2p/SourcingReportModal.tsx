import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import MapSupplierModal from './MapSupplierModal';
import MappedSuppliersModal from './MappedSuppliersModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Sourcing Report — read-only(ish) report for a sourcing target (static port).
 * Products are generated deterministically from the row (seeded RNG matching
 * the prototype) so a given SRC id always shows the same product mix.
 * Status pills toggle locally; Map Supplier / supplier-count open later flows.
 * ───────────────────────────────────────────────────────────────────────── */

export type ReportRow = { id: string; source: string; start: string; due: string; createdBy: string; assignee: string; products: number; completed: number };

const PM_PRODUCTS = [
  { name: 'Steel Pipes 2"', code: 'P-001', segment: 'Raw Material', hsn: '73042990', price: 4200 },
  { name: 'Copper Wire 6mm', code: 'P-002', segment: 'Electrical', hsn: '85444200', price: 890 },
  { name: 'PVC Conduit 25mm', code: 'P-003', segment: 'Electrical', hsn: '39172390', price: 310 },
  { name: 'GI Bolts M12', code: 'P-004', segment: 'Fasteners', hsn: '73181590', price: 125 },
  { name: 'Aluminium Sheet 3mm', code: 'P-005', segment: 'Raw Material', hsn: '76061290', price: 7800 },
  { name: 'SS Fasteners Set', code: 'P-006', segment: 'Fasteners', hsn: '73181590', price: 540 },
  { name: 'HDPE Pipe 50mm', code: 'P-007', segment: 'Piping', hsn: '39172390', price: 680 },
  { name: 'Rubber Gasket 10"', code: 'P-008', segment: 'Sealing', hsn: '40169390', price: 220 },
  { name: 'Carbon Steel Flange', code: 'P-009', segment: 'Piping', hsn: '73079990', price: 3100 },
  { name: 'Gate Valve 2"', code: 'P-010', segment: 'Valves', hsn: '84815000', price: 2800 },
  { name: 'Pressure Gauge 100mm', code: 'P-011', segment: 'Instrumentation', hsn: '90262090', price: 1650 },
  { name: 'Level Sensor 4-20mA', code: 'P-012', segment: 'Instrumentation', hsn: '90261090', price: 8400 },
  { name: 'Flow Meter DN50', code: 'P-013', segment: 'Instrumentation', hsn: '90261010', price: 14500 },
  { name: 'Temperature Sensor RTD', code: 'P-014', segment: 'Instrumentation', hsn: '90251990', price: 3200 },
  { name: 'Solenoid Valve 24V', code: 'P-015', segment: 'Valves', hsn: '84818090', price: 4800 },
  { name: 'Circuit Breaker 32A', code: 'P-016', segment: 'Electrical', hsn: '85362090', price: 1850 },
  { name: 'Control Valve 3"', code: 'P-017', segment: 'Valves', hsn: '84815000', price: 18500 },
  { name: 'Ball Valve 1.5"', code: 'P-018', segment: 'Valves', hsn: '84815000', price: 2100 },
  { name: 'PLC Module I/O', code: 'P-019', segment: 'Automation', hsn: '85371090', price: 22000 },
  { name: 'VFD Drive 5HP', code: 'P-020', segment: 'Electrical', hsn: '85044090', price: 16800 },
  { name: 'Bearing SKF 6205', code: 'P-021', segment: 'Mechanical', hsn: '84821090', price: 480 },
  { name: 'Gearbox Ratio 1:20', code: 'P-022', segment: 'Mechanical', hsn: '84834090', price: 12500 },
  { name: 'Hydraulic Cylinder 50T', code: 'P-023', segment: 'Hydraulics', hsn: '84121900', price: 38000 },
  { name: 'Pneumatic Valve FRL', code: 'P-024', segment: 'Pneumatics', hsn: '84812090', price: 3400 },
];
const ME_PRODUCTS = [
  { name: 'Custom Sensor Bracket', code: 'P-025', price: 1200 },
  { name: 'Special Alloy Rod 40mm', code: 'P-026', price: 8500 },
  { name: 'Non-Standard Fitting 3"', code: 'P-027', price: 3200 },
  { name: 'Bespoke Gasket Set', code: 'P-028', price: 750 },
  { name: 'Custom Cable Assembly', code: 'P-029', price: 4600 },
  { name: 'Modified Valve Seat', code: 'P-030', price: 2800 },
  { name: 'Special Seal Ring 75mm', code: 'P-031', price: 980 },
  { name: 'Fabricated Support Frame', code: 'P-032', price: 15000 },
  { name: 'Custom Hose Assembly 1m', code: 'P-033', price: 2200 },
  { name: 'Modified Pump Impeller', code: 'P-034', price: 9800 },
  { name: 'Bespoke Control Panel', code: 'P-035', price: 42000 },
  { name: 'Custom Wire Harness', code: 'P-036', price: 6500 },
  { name: 'Special Mounting Plate', code: 'P-037', price: 3400 },
  { name: 'Modified Flange 150mm', code: 'P-038', price: 7200 },
  { name: 'Custom Insulation Sleeve', code: 'P-039', price: 1800 },
];

export type GenProduct = { type: 'master' | 'manual'; name: string; code: string; segment?: string; hsn?: string; price: string; status: 'Completed' | 'In Progress' };

// Seeded generator — mirrors the prototype's genProducts so output is stable.
export function genProducts(srcId: string, total: number, completed: number, srcType: string): GenProduct[] {
  let seed = srcId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (n: number) => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return Math.abs(seed) % n; };
  const masterCount = srcType === 'Manual Entry' ? Math.floor(total * 0.25) : Math.ceil(total * 0.75);
  const out: GenProduct[] = [];
  let completedLeft = completed;
  for (let i = 0; i < total; i++) {
    const isMaster = i < masterCount;
    const isDone = completedLeft > 0; if (isDone) completedLeft--;
    if (isMaster) {
      const p = PM_PRODUCTS[rand(PM_PRODUCTS.length)];
      const variation = rand(500) - 200;
      out.push({ type: 'master', name: p.name, code: p.code, segment: p.segment, hsn: p.hsn, price: '₹' + (p.price + variation).toLocaleString('en-IN'), status: isDone ? 'Completed' : 'In Progress' });
    } else {
      const m = ME_PRODUCTS[rand(ME_PRODUCTS.length)];
      const variation = rand(1000) - 400;
      out.push({ type: 'manual', name: m.name, code: m.code, price: '₹' + (m.price + variation).toLocaleString('en-IN'), status: isDone ? 'Completed' : 'In Progress' });
    }
  }
  return out;
}

const fmt = (s: string) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const genDate = () => { const d = new Date(); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };

const I = (children: React.ReactNode) => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const REF_ICO = {
  id: I(<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>),
  type: I(<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />),
  cal: I(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
  clock: I(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>),
  user: I(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  users: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
};

export default function SourcingReportModal({ row, onClose }: { row: ReportRow; onClose: () => void }) {
  const toast = useToast();
  const products = useMemo(() => genProducts(row.id, row.products || 0, row.completed || 0, row.source), [row]);
  const [statuses, setStatuses] = useState<('Completed' | 'In Progress')[]>(() => products.map(p => p.status));
  const masterCount = products.filter(p => p.type === 'master').length;
  const [tab, setTab] = useState<'master' | 'manual'>(masterCount > 0 ? 'master' : 'manual');
  // Per-product supplier mapping override (index → { count, name }).
  const [mapped, setMapped] = useState<Record<number, { count: number; name: string }>>({});
  const [mapIdx, setMapIdx] = useState<number | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const supCountOf = (gi: number) => mapped[gi]?.count ?? (statuses[gi] === 'Completed' ? 1 : 0);

  const total = products.length;
  const done = statuses.filter(s => s === 'Completed').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  const toggle = (gi: number) => setStatuses(s => s.map((x, i) => i === gi ? (x === 'Completed' ? 'In Progress' : 'Completed') : x));

  // rows for the active tab, carrying their global index (for status toggle)
  const tabRows = products.map((p, gi) => ({ p, gi })).filter(x => x.p.type === tab);

  return createPortal(
    <div id="srpt-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="srpt-box">
        <div className="srpt-header">
          <div className="srpt-hrow">
            <div className="srpt-title-wrap">
              <div className="srpt-hicon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /><path d="M3 20h18" /></svg></div>
              <div className="srpt-title-block">
                <div className="srpt-title-line">
                  <h3 className="srpt-title">Sourcing Report</h3>
                  <span className="srpt-id-pill">{row.id}</span>
                  <span className={`srpt-badge ${allDone ? 'done' : 'prog'}`}><span className="srpt-bdot" />{allDone ? 'Completed' : 'In Progress'}</span>
                </div>
                <p className="srpt-sub">Business Reference &nbsp;·&nbsp; Generated {genDate()}</p>
              </div>
            </div>
            <button className="srpt-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>

          <div className="srpt-refcards">
            {([
              ['Sourcing ID', row.id, 'cyan', REF_ICO.id], ['Source Type', row.source, '', REF_ICO.type], ['Start Date', fmt(row.start), '', REF_ICO.cal],
              ['Due Date', fmt(row.due), 'amber', REF_ICO.clock], ['Created By', row.createdBy, '', REF_ICO.user], ['Assigned To', row.assignee, 'green', REF_ICO.users],
            ] as const).map(([lbl, val, cls, ico]) => (
              <div className="srpt-refcard" key={lbl}>
                <div className="srpt-rclbl">{ico}{lbl}</div>
                <div className={`srpt-rcval ${cls}`}>{val}</div>
              </div>
            ))}
          </div>

          <div className="srpt-statsbar">
            <div className="srpt-sbaritem"><div className="srpt-sbarlbl">Total Products</div><div className="srpt-sbarval white">{total}</div></div>
            <div className="srpt-sbardiv" />
            <div className="srpt-sbaritem"><div className="srpt-sbarlbl">Completed</div><div className="srpt-sbarval green">{done}</div></div>
            <div className="srpt-sbardiv" />
            <div className="srpt-sbaritem"><div className="srpt-sbarlbl">Pending</div><div className="srpt-sbarval amber">{total - done}</div></div>
            <div className="srpt-sbardiv" />
            <div className="srpt-sbaritem srpt-sbaritem--prog">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <div className="srpt-sbarlbl">Overall Progress</div>
                <div className="srpt-sbarval green" style={{ fontSize: 13 }}>{pct}%</div>
              </div>
              <div className="srpt-pbar"><div className="srpt-pfill" style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="srpt-tabs">
          <button className={`srpt-tab ${tab === 'master' ? 'active' : ''}`} onClick={() => setTab('master')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
            Product Master<span className="srpt-tab-cnt">{masterCount}</span>
          </button>
          <button className={`srpt-tab ${tab === 'manual' ? 'active' : ''}`} onClick={() => setTab('manual')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
            Manual Product Entry<span className="srpt-tab-cnt">{total - masterCount}</span>
          </button>
        </div>

        <div className="srpt-body">
          {tabRows.length === 0 ? (
            <div className="srpt-empty-tab"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg><p>No {tab === 'master' ? 'Product Master' : 'Manual Entry'} products</p></div>
          ) : (
            <table className="srpt-table">
              <thead><tr>
                <th style={{ width: 40 }}>#</th>
                {tab === 'master' && <th>Product Code</th>}
                <th style={{ textAlign: 'left' }}>Product Name</th>
                {tab === 'master' && <th>Segment</th>}
                {tab === 'master' && <th>HSN Code</th>}
                <th>Target Price</th><th>Product Clarity</th><th>Sourcing Status</th><th>Supplier Count</th>
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr></thead>
              <tbody>
                {tabRows.map(({ p, gi }, i) => {
                  const st = statuses[gi];
                  const doneP = st === 'Completed';
                  const supCount = supCountOf(gi);
                  return (
                    <tr className="srpt-row" key={gi}>
                      <td style={{ textAlign: 'center' }}><span className="srpt-sno">{i + 1}</span></td>
                      {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="srpt-code">{p.code}</span></td>}
                      <td style={{ textAlign: 'left' }}><div className="srpt-pname">{p.name}</div></td>
                      {tab === 'master' && <td style={{ textAlign: 'center' }}><span className={`srpt-seg ${(p.segment || 'General').replace(/ /g, '-')}`}>{p.segment}</span></td>}
                      {tab === 'master' && <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>{p.hsn}</td>}
                      <td style={{ textAlign: 'center' }} className="srpt-price">{p.price}</td>
                      <td style={{ textAlign: 'center' }}><span className="srpt-attach-dash">—</span></td>
                      <td style={{ textAlign: 'center' }}><span className={`srpt-status ${doneP ? 'done' : 'prog'}`} onClick={() => toggle(gi)} title="Click to toggle status" style={{ cursor: 'pointer' }}><span className="srpt-sdot" />{doneP ? 'Completed' : 'In Progress'}</span></td>
                      <td style={{ textAlign: 'center' }}>{supCount > 0
                        ? <span className="srpt-sup-count has-sup srpt-sup-clickable" title="View mapped suppliers" onClick={() => setViewIdx(gi)}>{supCount}</span>
                        : <span className="srpt-sup-count">0</span>}</td>
                      <td style={{ textAlign: 'center' }}><button className="srpt-map-btn" onClick={() => setMapIdx(gi)}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>Map Supplier Directory</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {mapIdx !== null && (
        <MapSupplierModal
          product={{ name: products[mapIdx].name, code: products[mapIdx].code, segment: products[mapIdx].segment, price: products[mapIdx].price, supplierCount: supCountOf(mapIdx) }}
          onClose={() => setMapIdx(null)}
          onMapped={(name) => {
            const gi = mapIdx!;
            setMapped(m => { const cur = m[gi]?.count ?? (statuses[gi] === 'Completed' ? 1 : 0); return { ...m, [gi]: { count: cur + 1, name } }; });
            setMapIdx(null);
            toast.success('Supplier mapped', name);
          }}
        />
      )}
      {viewIdx !== null && (
        <MappedSuppliersModal
          product={{ name: products[viewIdx].name, code: products[viewIdx].code, segment: products[viewIdx].segment, price: products[viewIdx].price, supplierCount: supCountOf(viewIdx), mappedName: mapped[viewIdx]?.name }}
          recordId={row.id}
          recordSource={row.source}
          onClose={() => setViewIdx(null)}
          onAddSupplier={() => { const gi = viewIdx!; setViewIdx(null); setMapIdx(gi); }}
        />
      )}
    </div>,
    document.body,
  );
}

const CSS = `
#srpt-overlay{position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:rgba(8,20,40,.62);backdrop-filter:blur(10px);padding:20px;box-sizing:border-box;font-family:'DM Sans','Inter',system-ui,sans-serif;}
.srpt-box{background:#fff;border-radius:20px;width:min(1280px,calc(100vw - 24px));max-height:calc(100vh - 40px);display:flex;flex-direction:column;box-shadow:0 32px 80px -12px rgba(0,30,60,.4),0 0 0 1px rgba(8,145,178,.15);overflow:hidden;}
.srpt-header{background:linear-gradient(150deg,#062d3d 0%,#0a4d66 45%,#0e7490 100%);padding:0;flex-shrink:0;}
.srpt-hrow{display:flex;align-items:center;justify-content:space-between;padding:18px 24px 14px;}
.srpt-title-wrap{display:flex;align-items:center;gap:14px;}
.srpt-hicon{width:44px;height:44px;border-radius:13px;background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 14px rgba(0,0,0,.2),0 1px 0 rgba(255,255,255,.18) inset;}
.srpt-title-block{display:flex;flex-direction:column;gap:4px;}
.srpt-title-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.srpt-title{font-size:17px;font-weight:500;color:#fff;margin:0;letter-spacing:-.3px;text-shadow:0 1px 6px rgba(0,0,0,.3);}
.srpt-id-pill{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:500;color:#67e8f9;background:rgba(103,232,249,.14);border:1px solid rgba(103,232,249,.35);border-radius:7px;padding:3px 9px;}
.srpt-sub{font-size:11px;color:rgba(180,230,255,.7);margin:0;font-weight:500;}
.srpt-badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:500;padding:4px 12px;border-radius:999px;}
.srpt-badge.done{background:rgba(52,211,153,.22);color:#6ee7b7;border:1.5px solid rgba(52,211,153,.42);}
.srpt-badge.prog{background:rgba(251,191,36,.18);color:#fde68a;border:1.5px solid rgba(251,191,36,.4);}
.srpt-bdot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;}
.srpt-close{width:34px;height:34px;border-radius:10px;border:1.5px solid rgba(255,255,255,.25);background:rgba(255,255,255,.12);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .15s;flex-shrink:0;}
.srpt-close:hover{background:rgba(239,68,68,.7);}
.srpt-refcards{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:0 24px 16px;}
.srpt-refcard{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.13);border-radius:11px;padding:9px 13px;display:flex;flex-direction:column;gap:5px;}
.srpt-rclbl{display:flex;align-items:center;gap:4px;font-size:8px;font-weight:500;color:rgba(160,220,255,.6);text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}
.srpt-rcval{font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.srpt-rcval.cyan{color:#67e8f9;font-family:ui-monospace,Menlo,monospace;}
.srpt-rcval.amber{color:#fcd34d;}
.srpt-rcval.green{color:#6ee7b7;}
.srpt-statsbar{display:flex;align-items:center;padding:11px 24px 15px;border-top:1px solid rgba(255,255,255,.09);gap:0;}
.srpt-sbaritem{display:flex;flex-direction:column;gap:4px;padding:0 22px;}
.srpt-sbaritem:first-child{padding-left:0;}
.srpt-sbaritem--prog{flex:1;}
.srpt-sbardiv{width:1px;height:38px;background:rgba(255,255,255,.13);flex-shrink:0;align-self:center;}
.srpt-sbarlbl{font-size:8.5px;font-weight:500;color:rgba(160,220,255,.62);text-transform:uppercase;letter-spacing:.09em;white-space:nowrap;}
.srpt-sbarval{font-size:22px;font-weight:500;line-height:1.1;}
.srpt-sbarval.white{color:#fff;}
.srpt-sbarval.green{color:#6ee7b7;text-shadow:0 0 14px rgba(110,231,183,.4);}
.srpt-sbarval.amber{color:#fcd34d;text-shadow:0 0 14px rgba(252,211,77,.35);}
.srpt-pbar{width:100%;height:9px;background:rgba(0,0,0,.3);border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,.07);}
.srpt-pfill{height:100%;background:linear-gradient(90deg,#34d399,#22d3ee,#38bdf8);border-radius:999px;transition:width .5s cubic-bezier(.4,0,.2,1);box-shadow:0 0 8px rgba(34,211,238,.4);}
.srpt-tabs{display:flex;gap:0;background:#f0fdff;border-bottom:1px solid #cdeef5;flex-shrink:0;}
.srpt-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;font-size:12.5px;font-weight:500;color:#5b7585;background:transparent;border:none;border-bottom:2.5px solid transparent;padding:12px 14px;cursor:pointer;transition:all .15s;}
.srpt-tab:hover{color:#0e7490;background:#e8fbfd;}
.srpt-tab.active{color:#0891b2;background:#fff;border-bottom-color:#0891b2;}
.srpt-tab-cnt{font-size:10px;font-weight:500;color:#0e7490;background:#e0fbff;border:1px solid #bdf0f7;border-radius:999px;padding:1px 7px;min-width:18px;}
.srpt-tab.active .srpt-tab-cnt{background:linear-gradient(135deg,#22d3ee,#0891b2);color:#fff;border-color:transparent;}
.srpt-body{flex:1;overflow-y:auto;padding:0;scrollbar-width:thin;scrollbar-color:rgba(8,145,178,.3) transparent;}
.srpt-body::-webkit-scrollbar{width:6px;}
.srpt-body::-webkit-scrollbar-thumb{background:rgba(8,145,178,.3);border-radius:999px;}
.srpt-table{width:100%;border-collapse:collapse;}
.srpt-table thead tr{background:linear-gradient(180deg,#f0fdff,#e8f9fc);position:sticky;top:0;z-index:2;}
.srpt-table thead th{padding:9px 12px;font-size:8.5px;font-weight:500;color:#5b9fae;text-transform:uppercase;letter-spacing:.09em;text-align:center;border-bottom:1px solid #b2ebf2;white-space:nowrap;}
.srpt-table tbody tr{border-bottom:1px solid #f0f9ff;transition:background .12s;}
.srpt-table tbody tr:hover{background:#f8fdff;}
.srpt-table td{padding:9px 12px;font-size:11.5px;color:#334155;vertical-align:middle;white-space:nowrap;}
.srpt-sno{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#f0fdff,#e0f7fa);color:#0891b2;font-size:10px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;border:1px solid #b2ebf2;}
.srpt-code{font-size:11px;color:#0891b2;font-weight:500;font-family:ui-monospace,monospace;}
.srpt-pname{font-weight:500;color:#0f172a;font-size:11.5px;}
.srpt-price{font-weight:500;color:#0e7490;font-size:12px;}
.srpt-seg{display:inline-block;font-size:9.5px;font-weight:500;padding:2px 8px;border-radius:999px;white-space:nowrap;}
.srpt-seg.Mechanical{background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;}
.srpt-seg.Electrical,.srpt-seg.Automation{background:#fffbeb;color:#b45309;border:1px solid #fde68a;}
.srpt-seg.Hydraulics{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;}
.srpt-seg.Pneumatics{background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;}
.srpt-seg.Instrumentation{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;}
.srpt-seg.Valves,.srpt-seg.Piping,.srpt-seg.Sealing{background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;}
.srpt-seg.Fasteners,.srpt-seg.Raw-Material{background:#fdf4ff;color:#7e22ce;border:1px solid #e9d5ff;}
.srpt-status{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:500;padding:4px 10px;border-radius:999px;cursor:pointer;transition:transform .12s;white-space:nowrap;user-select:none;}
.srpt-status:hover{transform:scale(1.04);}
.srpt-status.done{background:linear-gradient(135deg,#dcfce7,#bbf7d0);color:#15803d;border:1px solid #86efac;}
.srpt-status.prog{background:linear-gradient(135deg,#fff7ed,#fed7aa);color:#c2410c;border:1px solid #fdba74;}
.srpt-sdot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;}
.srpt-attach-dash{font-size:14px;color:#cbd5e1;font-weight:500;letter-spacing:.05em;}
.srpt-sup-count{min-width:26px;height:26px;border-radius:8px;background:#f0fdff;border:1.5px solid #b2ebf2;color:#0891b2;font-size:12px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;}
.srpt-sup-count.has-sup{background:linear-gradient(135deg,#22d3ee,#0891b2);border-color:#0891b2;color:#fff;}
.srpt-sup-count.srpt-sup-clickable{cursor:pointer;transition:transform .15s,box-shadow .15s,filter .15s;}
.srpt-sup-count.srpt-sup-clickable:hover{transform:scale(1.18);box-shadow:0 4px 12px rgba(8,145,178,.45);filter:brightness(1.1);}
.srpt-map-btn{display:inline-flex;align-items:center;gap:5px;font-family:inherit;font-size:10.5px;font-weight:500;color:#fff;background:linear-gradient(135deg,#22d3ee,#0891b2 55%,#0e7490);border:none;border-radius:8px;padding:7px 11px;cursor:pointer;white-space:nowrap;box-shadow:0 3px 9px -2px rgba(8,145,178,.5);transition:transform .15s,filter .14s;}
.srpt-map-btn:hover{transform:translateY(-1px);filter:brightness(1.07);}
.srpt-empty-tab{display:flex;flex-direction:column;align-items:center;gap:10px;padding:54px 20px;color:#94a3b8;font-size:12.5px;font-weight:500;}
@media(max-width:760px){.srpt-refcards{grid-template-columns:repeat(2,1fr);}.srpt-statsbar{flex-wrap:wrap;gap:10px;}}
`;
