import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import CreatePoWizard from './CreatePoWizard';
import TradeDocsModal from './TradeDocsModal';
import PoPaymentModal from './PoPaymentModal';
import WorklistPager from '../../../../components/ui/WorklistPager';
import './purchase-order.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Purchase Order (PO) — Procure to Pay (P2P) → Procurement Management.
 *
 * Frontend-only React port of the IDIMS "Purchase Order (PO)" page. It mirrors
 * the prototype's list view exactly: teal hero strip, collapsible "What We Are
 * Doing Here" reference box, two segmented tabs (With / Without Shipment ID),
 * search, a paginated table with status + Zohobook pills, a per-row action
 * cluster, the "More actions" popover, and the Zoho sync confirmation dialog.
 *
 * All data here is static demo data lifted from the prototype — there is no API
 * yet. Actions that open other pages (Create PO wizard, Edit, Email, Trade
 * Documents vault, PO Payment) surface a toast placeholder until those flows
 * are ported. `Zoho Sync` is fully wired against local state so the pill flips
 * to "Synced" after the confirm dialog, matching the source behaviour.
 * ───────────────────────────────────────────────────────────────────────── */

type PoRow = {
  id?: number;
  vendor_id?: number | null;
  po: string;
  date: string;
  type: string;
  doc: string;
  ship?: string;
  opp: string;
  proc: string;
  cust?: string;
  supCode: string;
  supName: string;
  edd: string;
  status: string;
  zoho: string;
  /** True once the PO is e-signed (completed Zoho-Sign request). Gates the
   *  Zoho Books sync — you must sign the PO before you can sync it. */
  is_signed?: boolean;
};

const PAGE_SIZE = 10;
const DOC_TYPES = ['Domestics', 'International'];
const PO_TYPES = ['Material / Goods', 'Services', 'FFD / Transporter'];

const INITIAL_WITH_SHIP: PoRow[] = [
  { po: 'PO/2025-26/001', date: '2026-06-19', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-001', opp: 'OPP-001', proc: 'PRC-001', cust: 'Apollo Hospitals', supCode: 'S-001', supName: 'Reliance Industries', edd: '2026-07-05', status: 'Draft', zoho: 'Sync' },
  { po: 'PO/2025-26/004', date: '2026-06-10', type: 'Material / Goods', doc: 'International', ship: 'SHP-014', opp: 'OPP-006', proc: 'PRC-009', cust: 'Fortis Healthcare', supCode: 'S-003', supName: 'Adani Enterprises', edd: '2026-07-22', status: 'Sent for Sign', zoho: 'Not Sync' },
  { po: 'PO/2025-26/007', date: '2026-05-28', type: 'Services', doc: 'Domestics', ship: 'SHP-021', opp: 'OPP-011', proc: 'PRC-015', cust: 'Max Healthcare', supCode: 'S-004', supName: 'Mahindra Logistics', edd: '2026-06-30', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/009', date: '2026-06-21', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-025', opp: 'OPP-013', proc: 'PRC-018', cust: 'Manipal Hospitals', supCode: 'S-008', supName: 'JSW Steel', edd: '2026-07-15', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/012', date: '2026-06-05', type: 'FFD / Transporter', doc: 'International', ship: 'SHP-031', opp: 'OPP-017', proc: 'PRC-022', cust: 'Narayana Health', supCode: 'S-009', supName: 'Vedanta Ltd', edd: '2026-08-01', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/014', date: '2026-05-30', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-034', opp: 'OPP-019', proc: 'PRC-026', cust: 'Medanta Medicity', supCode: 'S-010', supName: 'Bharat Forge', edd: '2026-07-09', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/016', date: '2026-06-12', type: 'Services', doc: 'Domestics', ship: 'SHP-038', opp: 'OPP-022', proc: 'PRC-029', cust: 'Care Hospitals', supCode: 'S-006', supName: 'Infosys Ltd', edd: '2026-07-18', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/018', date: '2026-06-01', type: 'Material / Goods', doc: 'International', ship: 'SHP-041', opp: 'OPP-024', proc: 'PRC-033', cust: 'Aster DM Healthcare', supCode: 'S-012', supName: 'UltraTech Cement', edd: '2026-08-05', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/021', date: '2026-05-22', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-045', opp: 'OPP-027', proc: 'PRC-037', cust: 'KIMS Hospitals', supCode: 'S-014', supName: 'Hindalco Industries', edd: '2026-06-28', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/023', date: '2026-06-16', type: 'FFD / Transporter', doc: 'International', ship: 'SHP-049', opp: 'OPP-030', proc: 'PRC-040', cust: 'Rainbow Hospitals', supCode: 'S-015', supName: 'Bosch India', edd: '2026-08-12', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/025', date: '2026-06-08', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-052', opp: 'OPP-033', proc: 'PRC-044', cust: 'Yashoda Hospitals', supCode: 'S-002', supName: 'Tata Steel', edd: '2026-07-20', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/028', date: '2026-05-26', type: 'Services', doc: 'Domestics', ship: 'SHP-056', opp: 'OPP-036', proc: 'PRC-048', cust: 'Columbia Asia', supCode: 'S-007', supName: 'Wipro Ltd', edd: '2026-07-02', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/030', date: '2026-06-18', type: 'Material / Goods', doc: 'International', ship: 'SHP-060', opp: 'OPP-039', proc: 'PRC-051', cust: 'Wockhardt Hospitals', supCode: 'S-009', supName: 'Vedanta Ltd', edd: '2026-08-08', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/033', date: '2026-06-03', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-064', opp: 'OPP-042', proc: 'PRC-055', cust: 'Global Hospitals', supCode: 'S-011', supName: 'Asian Paints', edd: '2026-07-11', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/035', date: '2026-05-19', type: 'FFD / Transporter', doc: 'International', ship: 'SHP-068', opp: 'OPP-045', proc: 'PRC-059', cust: 'Lilavati Hospital', supCode: 'S-005', supName: 'Larsen & Toubro', edd: '2026-08-15', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/038', date: '2026-06-14', type: 'Material / Goods', doc: 'Domestics', ship: 'SHP-072', opp: 'OPP-048', proc: 'PRC-063', cust: 'Kokilaben Hospital', supCode: 'S-016', supName: 'Cipla Ltd', edd: '2026-07-25', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/040', date: '2026-06-07', type: 'Services', doc: 'Domestics', ship: 'SHP-076', opp: 'OPP-051', proc: 'PRC-067', cust: 'Tata Memorial Centre', supCode: 'S-018', supName: 'Havells India', edd: '2026-07-06', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/043', date: '2026-05-24', type: 'Material / Goods', doc: 'International', ship: 'SHP-080', opp: 'OPP-054', proc: 'PRC-071', cust: 'Sterling Hospitals', supCode: 'S-017', supName: "Dr Reddy's Labs", edd: '2026-08-19', status: 'Signed', zoho: 'Sync' },
];

const INITIAL_WITHOUT_SHIP: PoRow[] = [
  { po: 'PO/2025-26/002', date: '2026-06-15', type: 'Material / Goods', doc: 'Domestics', opp: 'OPP-002', proc: 'PRC-002', cust: 'Apollo Hospitals', supCode: 'S-002', supName: 'Tata Steel', edd: '2026-07-12', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/005', date: '2026-06-02', type: 'Services', doc: 'Domestics', opp: 'OPP-008', proc: 'PRC-011', cust: 'Fortis Healthcare', supCode: 'S-005', supName: 'Larsen & Toubro', edd: '2026-07-01', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/008', date: '2026-06-20', type: 'Material / Goods', doc: 'International', opp: 'OPP-012', proc: 'PRC-016', cust: 'Max Healthcare', supCode: 'S-003', supName: 'Adani Enterprises', edd: '2026-07-28', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/011', date: '2026-06-04', type: 'FFD / Transporter', doc: 'Domestics', opp: 'OPP-015', proc: 'PRC-020', cust: 'Manipal Hospitals', supCode: 'S-008', supName: 'JSW Steel', edd: '2026-07-16', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/013', date: '2026-05-29', type: 'Material / Goods', doc: 'Domestics', opp: 'OPP-018', proc: 'PRC-024', cust: 'Narayana Health', supCode: 'S-001', supName: 'Reliance Industries', edd: '2026-07-08', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/015', date: '2026-06-11', type: 'Services', doc: 'Domestics', opp: 'OPP-021', proc: 'PRC-028', cust: 'Medanta Medicity', supCode: 'S-006', supName: 'Infosys Ltd', edd: '2026-07-19', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/017', date: '2026-06-06', type: 'Material / Goods', doc: 'International', opp: 'OPP-023', proc: 'PRC-032', cust: 'Care Hospitals', supCode: 'S-012', supName: 'UltraTech Cement', edd: '2026-08-03', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/020', date: '2026-05-21', type: 'Material / Goods', doc: 'Domestics', opp: 'OPP-026', proc: 'PRC-036', cust: 'Aster DM Healthcare', supCode: 'S-013', supName: 'Godrej Industries', edd: '2026-06-27', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/022', date: '2026-06-17', type: 'FFD / Transporter', doc: 'International', opp: 'OPP-029', proc: 'PRC-039', cust: 'KIMS Hospitals', supCode: 'S-014', supName: 'Hindalco Industries', edd: '2026-08-10', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/024', date: '2026-06-09', type: 'Material / Goods', doc: 'Domestics', opp: 'OPP-032', proc: 'PRC-043', cust: 'Rainbow Hospitals', supCode: 'S-004', supName: 'Mahindra Logistics', edd: '2026-07-21', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/027', date: '2026-05-27', type: 'Services', doc: 'Domestics', opp: 'OPP-035', proc: 'PRC-047', cust: 'Yashoda Hospitals', supCode: 'S-007', supName: 'Wipro Ltd', edd: '2026-07-03', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/029', date: '2026-06-13', type: 'Material / Goods', doc: 'International', opp: 'OPP-038', proc: 'PRC-050', cust: 'Columbia Asia', supCode: 'S-015', supName: 'Bosch India', edd: '2026-08-06', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/032', date: '2026-06-02', type: 'Material / Goods', doc: 'Domestics', opp: 'OPP-041', proc: 'PRC-054', cust: 'Wockhardt Hospitals', supCode: 'S-011', supName: 'Asian Paints', edd: '2026-07-13', status: 'Sent for Sign', zoho: 'Sync' },
  { po: 'PO/2025-26/034', date: '2026-05-18', type: 'FFD / Transporter', doc: 'International', opp: 'OPP-044', proc: 'PRC-058', cust: 'Global Hospitals', supCode: 'S-009', supName: 'Vedanta Ltd', edd: '2026-08-17', status: 'Signed', zoho: 'Sync' },
  { po: 'PO/2025-26/037', date: '2026-06-15', type: 'Material / Goods', doc: 'Domestics', opp: 'OPP-047', proc: 'PRC-062', cust: 'Lilavati Hospital', supCode: 'S-016', supName: 'Cipla Ltd', edd: '2026-07-24', status: 'Draft', zoho: 'Not Sync' },
  { po: 'PO/2025-26/039', date: '2026-06-08', type: 'Services', doc: 'Domestics', opp: 'OPP-050', proc: 'PRC-066', cust: 'Kokilaben Hospital', supCode: 'S-018', supName: 'Havells India', edd: '2026-07-07', status: 'Sent for Sign', zoho: 'Sync' },
];

/* ── Inline icon helpers (match the prototype's stroke SVGs) ────────────── */
const Ico = {
  doc: (s = 17) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>),
  docPlain: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
  plus: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>),
  chevron: (s = 10) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>),
  search: (s = 16) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>),
  truck: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>),
  box: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>),
  edit: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>),
  mail: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,6 12,13 2,6" /></svg>),
  vault: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>),
  pay: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>),
  kebab: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>),
  sync: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" /><polyline points="21 3 18.7 6 15.6 5.4" /><polyline points="3 21 5.3 18 8.4 18.6" /></svg>),
  spin: (s = 15) => (<svg className="pomore-spin" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>),
  eye: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>),
  down: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>),
  fileSm: (s = 11) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
};

/* Custom filter dropdown — master-style panel, kept in the page's teal palette */
function FilterDd({ value, options, onChange }: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const cur = options.find(o => o.v === value) || options[0];
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = Math.min(280, options.length * 38 + 12);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: Math.max(r.width, 180), top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as HTMLElement; if (wrapRef.current && !wrapRef.current.contains(t) && !t.closest?.('.pof-dd-pop')) setOpen(false); };
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="polist-filter" ref={wrapRef}>
      <button type="button" ref={btnRef} className={`polist-filtersel ${open ? 'is-open' : ''}`} onClick={() => setOpen(o => !o)}>{cur.label}</button>
      {Ico.chevron(11)}
      {open && (
        <div className="pof-dd-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.map(o => (
            <div key={o.v} className={`pof-dd-pop__opt ${o.v === value ? 'is-sel' : ''}`} onClick={() => { onChange(o.v); setOpen(false); }}>
              <span>{o.label}</span>
              <svg className="pof-dd-pop__ck" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Reference-box steps */
const BREF_STEPS = [
  { n: 'Step 01', title: 'Link Supplier Details', desc: 'Link the supplier and verify their basic details.', ico: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 11l-3 3-2-2" /></svg>) },
  { n: 'Step 02', title: 'Product Details', desc: 'Add products with quantities and pricing.', ico: Ico.box(11) },
  { n: 'Step 03', title: 'Terms & Conditions', desc: 'Define the rules and conditions for the order.', ico: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>) },
  { n: 'Step 04', title: 'Post-PO Trade Document Management', desc: 'Send for e-signature and track via Zoho Sign.', ico: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>) },
  { n: 'Step 05', title: 'Payment Management', desc: 'Complete payment and maintain records.', ico: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>) },
];

type MoreState = { po: string; supName?: string; left: number; top: number; open: boolean };
type SyncState = { id: number; po: string; supName?: string; busy: boolean };

export default function PurchaseOrder() {
  const toast = useToast();

  const [tab, setTab] = useState<'with' | 'without'>('with');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [query, setQuery] = useState('');
  const [docFilter, setDocFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [brefCollapsed, setBrefCollapsed] = useState(true);

  const [more, setMore] = useState<MoreState | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [wizard, setWizard] = useState<{ editRow: PoRow | null } | null>(null);
  const [tradeDoc, setTradeDoc] = useState<PoRow | null>(null);
  const [payTarget, setPayTarget] = useState<PoRow | null>(null);
  const [emailing, setEmailing] = useState<Record<number, boolean>>({});

  // ── Server-driven data (branch_id is auto-injected on GETs → branch isolation) ──
  const [rows, setRows] = useState<PoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ with: 0, without: 0 });
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  const [debQuery, setDebQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebQuery(query), 300); return () => clearTimeout(t); }, [query]);

  // ── Auto-fit rows to a fixed-height table (My Workplace pattern) ── show
  // exactly as many rows as fill the scroll area so big screens don't leave a
  // gap and small ones don't overflow. Picking a Rows-per-page value in the
  // pager overrides auto-fit (autoFitRef → false).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoFitRef = useRef(true);
  const totalRef = useRef(total);
  totalRef.current = total;
  const recomputeFit = useCallback(() => {
    if (!autoFitRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const avail = el.clientHeight;
    if (avail <= 0) return;
    const thead = el.querySelector('thead') as HTMLElement | null;
    const bodyRow = el.querySelector('tbody tr:not(.polist-skel-row)') as HTMLElement | null;
    const THEAD = thead?.offsetHeight || 42;
    // Measure a real data row when present; the empty-state row is taller, so
    // fall back to a sane constant until rows render.
    const ROW = (totalRef.current > 0 && bodyRow) ? bodyRow.offsetHeight : 56;
    const fit = Math.max(5, Math.floor((avail - THEAD) / ROW));
    setPageSize(prev => (prev === fit ? prev : fit));
  }, []);
  // Observe the scroll area's SIZE once — the observer isn't rebuilt on every
  // data fetch (only genuine resizes fire it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recomputeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeFit]);
  // Re-measure when the data changes (new rows may have a different height).
  useEffect(() => { recomputeFit(); }, [total, rows, recomputeFit]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/p2p/purchase-orders', { params: { tab, page: safePage, per_page: pageSize, q: debQuery || undefined, document_type: docFilter !== 'all' ? docFilter : undefined, po_type: typeFilter !== 'all' ? typeFilter : undefined } })
      .then(r => { if (cancelled) return; setRows((r.data?.data ?? []) as PoRow[]); setTotal(r.data?.pagination?.total ?? 0); })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, safePage, pageSize, debQuery, docFilter, typeFilter, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/p2p/purchase-orders', { params: { tab: 'with', per_page: 1 } }).then(r => r.data?.pagination?.total ?? 0).catch(() => 0),
      api.get('/p2p/purchase-orders', { params: { tab: 'without', per_page: 1 } }).then(r => r.data?.pagination?.total ?? 0).catch(() => 0),
    ]).then(([w, wo]) => { if (!cancelled) setCounts({ with: w, without: wo }); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const handleSaved = () => { setWizard(null); setPage(1); reload(); };

  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const morePopRef = useRef<HTMLDivElement | null>(null);

  const switchTab = (t: 'with' | 'without') => { setTab(t); setPage(1); setQuery(''); setDocFilter('all'); setTypeFilter('all'); };

  // ── More-actions popover: measure + position once mounted, then animate in
  useLayoutEffect(() => {
    if (!more || more.open) return;
    const btn = moreBtnRef.current;
    const pop = morePopRef.current;
    if (!btn || !pop) return;
    const rect = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 6, pad = 8;
    let left = rect.right - pw;
    if (left < pad) left = pad;
    if (left + pw > window.innerWidth - pad) left = window.innerWidth - pad - pw;
    let top = rect.bottom + gap;
    if (top + ph > window.innerHeight - pad) {
      const above = rect.top - gap - ph;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - pad - ph);
    }
    setMore(m => (m ? { ...m, left, top, open: true } : m));
  }, [more]);

  // ── Dismiss popover on Escape, scroll or resize
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(null); };
    const close = () => setMore(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [more]);

  // ── Lock background scroll while any PO popup (wizard / trade docs / sync) is open
  useEffect(() => {
    if (!(wizard || tradeDoc || sync)) return;
    const b = document.body.style.overflow, h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [wizard, tradeDoc, sync]);

  const openMore = (e: React.MouseEvent<HTMLButtonElement>, r: PoRow) => {
    e.preventDefault();
    e.stopPropagation();
    moreBtnRef.current = e.currentTarget;
    setMore({ po: r.po, supName: r.supName, left: -9999, top: -9999, open: false });
  };

  const stub = (label: string) => toast.info(label, 'Coming in a later phase');

  const openZohoConfirm = (r: PoRow) => {
    if (r.zoho.toLowerCase() === 'sync') { toast.success(`${r.po} is already synced with Zohobook`); return; }
    if (!r.id) return;
    // Gate: the PO must be e-signed before it can be pushed to Zoho Books. The
    // backend enforces the same rule; this surfaces the validation up-front
    // instead of after the confirm dialog.
    if (!r.is_signed) {
      toast.warning('Sign the PO first', 'This purchase order must be e-signed via Zoho Sign before it can be synced to Zoho Books.');
      return;
    }
    setMore(null);
    setSync({ id: r.id, po: r.po, supName: r.supName, busy: false });
  };

  const doEmail = (r: PoRow) => {
    if (!r.id || emailing[r.id]) return;
    const id = r.id;
    setEmailing(m => ({ ...m, [id]: true }));
    toast.info(`Emailing ${r.po} to supplier…`);
    api.post(`/p2p/purchase-orders/${id}/email`)
      .then(res => toast.success(res.data?.message || `Purchase Order emailed — ${r.po}`))
      .catch(err => {
        const msg = err?.response?.data?.message;
        if (err?.response?.status === 422) toast.error('Cannot send email', msg || 'No valid supplier email address.');
        else toast.error('Email failed', msg || 'Please try again.');
      })
      .finally(() => setEmailing(m => { const n = { ...m }; delete n[id]; return n; }));
  };

  // PO PDF (same render as the PI PDF) — with/without signature. Used by the
  // list-row "More" menu's View & Download actions.
  const poPdfBlob = (id: number, withSign: boolean) =>
    api.get(`/p2p/purchase-orders/${id}/pdf`, { params: { signature: withSign ? 1 : 0 }, responseType: 'blob' });
  const viewPoPdf = (withSign: boolean) => {
    const r = rows.find(x => x.po === more?.po); setMore(null);
    if (!r?.id) return;
    const w = window.open('', '_blank');
    toast.info(`Preparing PO PDF${withSign ? ' (signed)' : ' (without signature)'}…`);
    poPdfBlob(r.id, withSign)
      .then(res => { const url = URL.createObjectURL(res.data as Blob); if (w) w.location.href = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); })
      .catch(() => { if (w) w.close(); toast.error('Could not open PO PDF', 'Please try again.'); });
  };
  const downloadPoPdf = (withSign: boolean) => {
    const r = rows.find(x => x.po === more?.po); setMore(null);
    if (!r?.id) return;
    toast.info(`Downloading PO PDF${withSign ? ' (signed)' : ' (without signature)'}…`);
    poPdfBlob(r.id, withSign)
      .then(res => {
        const url = URL.createObjectURL(res.data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PO-${r.po.replace(/[^A-Za-z0-9_-]/g, '_')}${withSign ? '_signed' : '_unsigned'}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      })
      .catch(() => toast.error('Could not download PO PDF', 'Please try again.'));
  };

  const doSync = () => {
    if (!sync) return;
    const { id, po } = sync;
    setSync(s => (s ? { ...s, busy: true } : s));
    toast.info(`Syncing ${po} with Zohobook…`);
    api.post(`/p2p/purchase-orders/${id}/sync`).then((res) => {
      setSync(null);
      toast.success(res?.data?.message || `${po} synced with Zohobook successfully`);
      reload();
    }).catch((e) => {
      setSync(null);
      toast.error('Sync failed', e?.response?.data?.message || 'Please try again.');
    });
  };

  const heads = tab === 'with'
    ? ['Sr. No', 'PO Number', 'PO Type', 'Document Type', 'Shipment ID', 'Opportunity ID', 'Procurement ID', 'Customer Name', 'Supplier Name', 'Expected Delivery Date', 'Zohobook Status', 'Action']
    : ['Sr. No', 'PO Number', 'PO Type', 'Document Type', 'Procurement ID', 'Supplier Name', 'Expected Delivery Date', 'Zohobook Status', 'Action'];

  const Pill = ({ v }: { v?: string }) => <span className="polist-pill">{v}</span>;
  const DocPill = ({ d }: { d: string }) => (
    <span className={`polist-cat ${d.toLowerCase().indexOf('inter') > -1 ? 'polist-cat--intl' : 'polist-cat--dom'}`}>{d}</span>
  );
  const ZohoPill = ({ z }: { z: string }) => {
    const s = z.toLowerCase() === 'sync';
    return <span className={`polist-status polist-status--${s ? 'sync' : 'notsync'}`}><span className="d" />{s ? 'Sync' : 'Not Sync'}</span>;
  };

  return (
    <div className="pom polist-page" style={{ margin: '-6px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* ── HEADER STRIP ─────────────────────────────────────────────── */}
      <div className="cstrip cstrip--teal">
        <span className="cstrip__accent" />
        <span className="cstrip__glow" />
        <span className="cstrip__sheen" />
        <div className="cstrip__left">
          <div className="cstrip__avatar-wrap">
            <div className="cstrip__avatar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
            </div>
            <span className="cstrip__online-dot" />
          </div>
          <div>
            <div className="cstrip__title">Purchase Order (PO)</div>
            <div className="cstrip__sub">Create and manage purchase orders to suppliers — from PO generation to e-signed documents and payment.</div>
          </div>
        </div>
        <div className="cstrip__right">
          <button type="button" className="cstrip__action-btn" onClick={() => setWizard({ editRow: null })}>
            <span className="cstrip__action-btn-sheen" />
            {Ico.plus(13)}
            Create PO
          </button>
        </div>
      </div>

      {/* ── WHAT WE ARE DOING HERE ───────────────────────────────────── */}
      <div className={`bref-box bref-box--teal ${brefCollapsed ? 'is-collapsed' : ''}`}>
        <div className="bref-box__header" onClick={() => setBrefCollapsed(v => !v)}>
          <div className="bref-box__header-ico">{Ico.docPlain(13)}</div>
          <div className="bref-box__header-mid">
            <div className="bref-box__header-row">
              <div className="bref-box__header-label">Purchase Order</div>
              <div className="bref-box__header-sep" />
              <div className="bref-box__header-title">What We Are Doing Here</div>
            </div>
            <div className="bref-box__header-sub">Link the supplier, add products and terms, manage post-PO trade documents with e-signature, and complete payment — end to end in one place.</div>
          </div>
          <div className="bref-box__header-right">
            <div className="bref-box__toggle">{Ico.chevron(10)}</div>
          </div>
        </div>
        <div className="bref-box__body">
          {BREF_STEPS.map(s => (
            <div className="bref-item" key={s.n}>
              <div className="bref-item__top">
                <div className="bref-item__ico">{s.ico}</div>
                <span className="bref-item__num">{s.n}</span>
              </div>
              <div className="bref-item__title">{s.title}</div>
              <div className="bref-item__desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PO LIST WITH TABS ────────────────────────────────────────── */}
      <div className="polist-wrap">
        <div className="polist-top">
          <div className="polist-seg">
            <button type="button" className={`polist-seg__tab ${tab === 'with' ? 'is-active' : ''}`} onClick={() => switchTab('with')}>
              {Ico.truck(15)} With Shipment ID PO <span className="polist-seg__cnt">{counts.with}</span>
            </button>
            <button type="button" className={`polist-seg__tab ${tab === 'without' ? 'is-active' : ''}`} onClick={() => switchTab('without')}>
              {Ico.box(15)} Without Shipment ID PO <span className="polist-seg__cnt">{counts.without}</span>
            </button>
          </div>
          <div className="polist-tools">
            <FilterDd
              value={docFilter}
              options={[{ v: 'all', label: 'All Document Types' }, ...DOC_TYPES.map(d => ({ v: d, label: d }))]}
              onChange={v => { setDocFilter(v); setPage(1); }}
            />
            <FilterDd
              value={typeFilter}
              options={[{ v: 'all', label: 'All PO Types' }, ...PO_TYPES.map(t => ({ v: t, label: t }))]}
              onChange={v => { setTypeFilter(v); setPage(1); }}
            />
            <div className="polist-search">
              {Ico.search(16)}
              <input type="text" placeholder="Search PO, supplier, ID or status..." value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
            </div>
          </div>
        </div>

        <div className="polist-body">
          <div className={`polist-scroll ${!loading && total === 0 ? 'is-empty' : ''}`} ref={scrollRef}>
            {!loading && total === 0 ? (
              <div className="polist-empty-center">
                <div className="polist-empty-ico">{Ico.doc(30)}</div>
                <div className="polist-empty-t">No purchase orders found</div>
                <div className="polist-empty-s">{query ? `Nothing matches "${query}".` : 'There are no purchase orders in this category yet.'}</div>
              </div>
            ) : (
            <table className="polist-tbl">
              <thead><tr>{heads.map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => (
                    <tr key={`sk-${i}`} className="polist-skel-row">
                      {heads.map((h, j) => <td key={h}><span className="polist-skel" style={{ width: j === 0 ? 18 : `${55 + ((i + j) % 4) * 12}%` }} /></td>)}
                    </tr>
                  ))
                ) : pageRows.map((r, i) => {
                  const synced = r.zoho.toLowerCase() === 'sync';
                  return (
                    <tr key={r.po}>
                      <td>{start + i + 1}</td>
                      <td>
                        <div className="polist-pocell">
                          <Pill v={r.po} />
                          {r.date && <span className="polist-podate">{r.date}</span>}
                        </div>
                      </td>
                      <td>{r.type}</td>
                      <td><DocPill d={r.doc} /></td>
                      {tab === 'with' ? (
                        <>
                          <td><Pill v={r.ship} /></td>
                          <td><Pill v={r.opp} /></td>
                          <td><Pill v={r.proc} /></td>
                          <td>{r.cust || '—'}</td>
                        </>
                      ) : (
                        <td>{r.proc ? <Pill v={r.proc} /> : '—'}</td>
                      )}
                      <td>{r.supName}</td>
                      <td>{r.edd}</td>
                      <td><ZohoPill z={r.zoho} /></td>
                      <td>
                        <div className="polist-act">
                          {synced ? (
                            <button type="button" className="polist-zoho is-synced" disabled title="Already synced with Zohobook">{Ico.sync(14)}<span>Synced</span></button>
                          ) : (
                            <button type="button" className="polist-zoho" title="Sync with Zohobook" onClick={() => openZohoConfirm(r)}>{Ico.sync(14)}<span>Zoho Sync</span></button>
                          )}
                          <button
                            type="button"
                            className="polist-ico"
                            title={synced ? 'Locked — already synced to Zoho Books' : 'Edit PO'}
                            disabled={synced}
                            style={synced ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                            onClick={() => { if (!synced) setWizard({ editRow: r }); }}
                          >{Ico.edit(15)}</button>
                          <button type="button" className="polist-ico" title="Send PO Via Email" disabled={!!(r.id && emailing[r.id])} onClick={() => doEmail(r)}>{Ico.mail(15)}</button>
                          <button type="button" className="polist-ico" title="Trade Documents & Agreements" onClick={() => setTradeDoc(r)}>{Ico.vault(15)}</button>
                          <button type="button" className="polist-ico" title="PO Payment" onClick={() => setPayTarget(r)}>{Ico.pay(15)}</button>
                          <button type="button" className="polist-ico" title="More Actions" onClick={e => openMore(e, r)}>{Ico.kebab(15)}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>

          {total > 0 && (
            <WorklistPager
              total={total}
              page={safePage}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={n => { autoFitRef.current = false; setPageSize(n); setPage(1); }}
            />
          )}
        </div>
      </div>

      {/* ── MORE-ACTIONS POPOVER ─────────────────────────────────────── */}
      {more && (
        <>
          <div className="pomore-backdrop" onClick={() => setMore(null)} />
          <div ref={morePopRef} className={`pomore-pop ${more.open ? 'is-open' : ''}`} style={{ left: more.left, top: more.top }}>
            <div className="pomore-hd">
              <span className="pomore-hd__ico">{Ico.kebab(15)}</span>
              <span className="pomore-hd__txt">
                <span className="pomore-hd__t">More Actions</span>
                <span className="pomore-hd__chip">{Ico.fileSm(11)}<b>{more.po}</b></span>
                {more.supName && <span className="pomore-hd__sup">Supplier: <b>{more.supName}</b></span>}
              </span>
              <button type="button" className="pomore-x" onClick={() => setMore(null)} aria-label="Close">✕</button>
            </div>
            <button type="button" className="pomore-item pomore-item--sync" onClick={() => { const r = rows.find(x => x.po === more.po); if (r) openZohoConfirm(r); }}>
              <span className="pomore-item__ico pomore-item__ico--sync">{Ico.sync(15)}</span>Sync with Zohobook
            </button>
            <div className="pomore-divider" />
            <div className="pomore-sec pomore-sec--view">{Ico.eye(15)} View</div>
            <button type="button" className="pomore-item" onClick={() => viewPoPdf(true)}><span className="pomore-item__ico pomore-item__ico--view">{Ico.eye(15)}</span>With Signature</button>
            <button type="button" className="pomore-item" onClick={() => viewPoPdf(false)}><span className="pomore-item__ico pomore-item__ico--view">{Ico.eye(15)}</span>Without Signature</button>
            <div className="pomore-sec pomore-sec--dl">{Ico.down(15)} Download</div>
            <button type="button" className="pomore-item" onClick={() => downloadPoPdf(true)}><span className="pomore-item__ico pomore-item__ico--dl">{Ico.down(15)}</span>With Signature</button>
            <button type="button" className="pomore-item" onClick={() => downloadPoPdf(false)}><span className="pomore-item__ico pomore-item__ico--dl">{Ico.down(15)}</span>Without Signature</button>
          </div>
        </>
      )}

      {/* ── ZOHO SYNC CONFIRM DIALOG ─────────────────────────────────── */}
      {sync && (
        <div className="pocfm-overlay is-open" onClick={e => { if (e.target === e.currentTarget && !sync.busy) setSync(null); }}>
          <div className="pocfm-card" role="dialog" aria-modal="true">
            <div className="pocfm-bd">
              <div className="pocfm-ico">{Ico.sync(26)}</div>
              <div className="pocfm-t">Sync with Zohobook?</div>
              <div className="pocfm-msg">This will push the latest purchase order data to your Zohobook account and update its sync status.</div>
              <div className="pocfm-chip"><span className="po">{sync.po}</span>{sync.supName && <span className="sup">· {sync.supName}</span>}</div>
            </div>
            <div className="pocfm-actions">
              <button type="button" className="pocfm-btn pocfm-btn--ghost" disabled={sync.busy} onClick={() => setSync(null)}>Cancel</button>
              <button type="button" className="pocfm-btn pocfm-btn--go" disabled={sync.busy} onClick={doSync}>
                {sync.busy ? <>{Ico.spin(15)} Syncing…</> : 'Yes, Sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE / EDIT PO WIZARD ──────────────────────────────────── */}
      {wizard && (
        <CreatePoWizard editRow={wizard.editRow} onClose={() => setWizard(null)} onSaved={handleSaved} />
      )}

      {/* ── TRADE DOCUMENTS & AGREEMENTS MODAL ───────────────────────── */}
      {tradeDoc && (
        <TradeDocsModal po={tradeDoc.po} poId={tradeDoc.id} supName={tradeDoc.supName} supCode={tradeDoc.supCode} supplierId={tradeDoc.vendor_id} onClose={() => setTradeDoc(null)} />
      )}

      {/* ── PAYMENT SUMMARY AGAINST PO MODAL — data loads per PO id ───── */}
      <PoPaymentModal
        open={!!payTarget}
        poId={payTarget?.id ?? null}
        onClose={() => setPayTarget(null)}
        onChanged={() => setReloadKey(k => k + 1)}
      />
    </div>
  );
}
