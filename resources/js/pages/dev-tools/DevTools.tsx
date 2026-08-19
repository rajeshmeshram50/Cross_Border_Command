import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import LoadTesting from './LoadTesting';
import WorklistPager from '../../components/ui/WorklistPager';
import { useAuth } from '../../contexts/AuthContext';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import '../developers/shipment-360.css';

/**
 * Dev Tools — a read-only inspector for the Zoho Books data we STORE in our DB
 * but never surface in the normal UI. Styled like the Shipment 360 list (teal
 * `.s360m` scope): a hero strip, tab pills, and the `.rvtbl` journey table.
 *
 * One tab per Zoho entity type (+ Payments Made), showing the local record and
 * the Zoho id / sync state stamped on it. Only rows that carry a Zoho id are
 * listed. Admin-only + permission-gated; a super_admin sees rows across clients.
 */

type Row = Record<string, string | number | null>;
type Col = { key: string; label: string; kind?: 'code' | 'money' | 'when' | 'pdf' | 'status' | 'against'; primary?: boolean };
type Tab = { key: string; label: string; type: string; cols: Col[] };

const TABS: Tab[] = [
  {
    key: 'items', label: 'Items', type: 'items',
    cols: [
      { key: 'code', label: 'Product Code', kind: 'code', primary: true },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'zoho_id', label: 'Zoho Item ID', kind: 'code' },
      { key: 'updated_at', label: 'Updated', kind: 'when' },
    ],
  },
  {
    key: 'vendors', label: 'Vendors', type: 'vendors',
    cols: [
      { key: 'code', label: 'Vendor Code', kind: 'code', primary: true },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'zoho_id', label: 'Zoho Contact ID', kind: 'code' },
      { key: 'updated_at', label: 'Updated', kind: 'when' },
    ],
  },
  {
    key: 'purchase-orders', label: 'Purchase Orders', type: 'purchase-orders',
    cols: [
      { key: 'code', label: 'PO Code', kind: 'code', primary: true },
      { key: 'supplier', label: 'Supplier' },
      { key: 'zoho_id', label: 'Zoho PO ID', kind: 'code' },
      { key: 'bill_id', label: 'Bill ID', kind: 'code' },
      { key: 'bill_number', label: 'Bill #', kind: 'code' },
      { key: 'zoho_status', label: 'Status', kind: 'status' },
      { key: 'synced_at', label: 'Synced', kind: 'when' },
      { key: 'pdf', label: 'Zoho PDF', kind: 'pdf' },
    ],
  },
  {
    key: 'vendor-credits', label: 'Vendor Credits', type: 'vendor-credits',
    cols: [
      { key: 'code', label: 'DN Code', kind: 'code', primary: true },
      { key: 'supplier', label: 'Supplier' },
      { key: 'zoho_id', label: 'Zoho Credit ID', kind: 'code' },
      { key: 'credit_number', label: 'Credit #', kind: 'code' },
      { key: 'applied_amount', label: 'Applied', kind: 'money' },
      { key: 'synced_at', label: 'Synced', kind: 'when' },
    ],
  },
  {
    key: 'bills', label: 'Bills', type: 'bills',
    cols: [
      { key: 'code', label: 'SPI Code', kind: 'code', primary: true },
      { key: 'invoice_no', label: 'Invoice No', kind: 'code' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'zoho_id', label: 'Zoho Bill ID', kind: 'code' },
      { key: 'bill_number', label: 'Bill #', kind: 'code' },
      { key: 'zoho_status', label: 'Status', kind: 'status' },
      { key: 'synced_at', label: 'Synced', kind: 'when' },
      { key: 'pdf', label: 'Zoho PDF', kind: 'pdf' },
    ],
  },
  {
    key: 'payments', label: 'Payments Made', type: 'payments',
    cols: [
      { key: 'against', label: 'Against', kind: 'against' },
      { key: 'source', label: 'PO / SPI', kind: 'code', primary: true },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'applied', label: 'Applied to Bill', kind: 'money' },
      { key: 'bank', label: 'Bank' },
      { key: 'ref', label: 'UTR / Cheque', kind: 'code' },
      { key: 'date', label: 'Date' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'zoho_id', label: 'Zoho Payment ID', kind: 'code' },
    ],
  },
];

const inr = (n: number | null | undefined) =>
  '₹' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Map a status string onto the Shipment-360 yes/warn/no palette.
const ynClass = (s: string) => {
  const t = s.toLowerCase();
  if (['sync', 'cleared', 'completed', 'signed', 'active'].includes(t)) return 's360-yn is-yes';
  if (t.includes('declin') || t.includes('recall') || t === 'not sync' || t.includes('fail')) return 's360-yn is-warn';
  if (t.includes('pend') || t.includes('progress') || t.includes('sent') || t.includes('view') || t.includes('draft')) return 's360-yn is-warn';
  return 's360-yn is-no';
};

const IcoWrench = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z" /></svg>
);
const IcoRefresh = ({ spin }: { spin?: boolean }) => (
  <svg className={spin ? 'dvt-spin' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
);
const IcoSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

export default function DevTools() {
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  // Top-level section. Zoho Books is the original inspector; Load Testing is a
  // per-page profiler. They share only the hero strip, so they switch here
  // rather than becoming another row of tab pills inside the list shell.
  const [section, setSection] = useState<'zoho' | 'load'>('zoho');
  const [active, setActive] = useState(TABS[0].key);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);

  const tab = useMemo(() => TABS.find(t => t.key === active) ?? TABS[0], [active]);
  const cols = useMemo<Col[]>(
    () => (isSuperAdmin ? [{ key: 'client_id', label: 'Client', kind: 'code' as const }, ...tab.cols] : tab.cols),
    [tab, isSuperAdmin],
  );

  const load = () => {
    setLoading(true);
    setError(null);
    setRows([]);
    api.get<{ status: boolean; data: Row[] }>(`/dev-tools/zoho/${tab.type}`)
      .then(({ data: r }) => setRows(r.data ?? []))
      .catch((e: any) => setError(e?.response?.data?.message ?? 'Could not load Dev Tools data.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setQ(''); setPage(1); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active]);

  // Simple client-side filter over the visible values.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(needle)));
  }, [rows, q]);

  // Client-side pagination over the filtered rows.
  const totalPages = Math.max(1, Math.ceil(filtered.length / rpp));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * rpp, safePage * rpp);
  const srBase = (safePage - 1) * rpp;

  const cell = (row: Row, c: Col) => {
    const v = row[c.key];
    if (v === null || v === undefined || v === '') return <span className="rvtbl-dash">—</span>;
    if (c.kind === 'money') return <strong>{inr(Number(v))}</strong>;
    if (c.kind === 'code') return <span className={`s360-pill${c.primary ? ' is-primary' : ''}`}>{String(v)}</span>;
    if (c.kind === 'status') return <span className={ynClass(String(v))}>{String(v)}</span>;
    if (c.kind === 'against') return <span className="s360-tag is-inco">{String(v)}</span>;
    if (c.kind === 'pdf') {
      const url = resolveFileUrl(String(v));
      return url ? <a className="s360-tag is-inco dvt-pdf" href={url} target="_blank" rel="noreferrer">↗ PDF</a> : <span className="rvtbl-dash">—</span>;
    }
    return <span className="rvtbl-clip">{String(v)}</span>;
  };

  return (
    <div className="s360m">
      <style>{EXTRA}</style>

      {/* ── Hero strip ── */}
      <div className="cstrip cstrip--teal">
        <span className="cstrip__accent" /><span className="cstrip__glow" /><span className="cstrip__sheen" />
        <div className="cstrip__left">
          <div className="cstrip__avatar-wrap">
            <div className="cstrip__avatar"><IcoWrench /></div>
            <span className="cstrip__online-dot" />
          </div>
          <div>
            <div className="cstrip__title">Dev Tools · {section === 'zoho' ? 'Zoho Books' : 'Performance Lens'}</div>
            <div className="cstrip__sub">
              {section === 'zoho'
                ? 'Read-only view of the Zoho Books data we store — ids & sync state stamped on each record.'
                : 'Replay a page\u2019s API calls to see timing, database cost, payload size, the files it loads and where each endpoint is used.'}
            </div>
          </div>
        </div>
        <div className="cstrip__right">
          {/* Section switcher — sits before Refresh, which only applies to the
              Zoho list; Load Testing has its own Run button. */}
          <div className="dt-sections">
            {([['zoho', 'Zoho Books'], ['load', 'Performance Lens']] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={`dt-section ${section === k ? 'is-active' : ''}`}
                onClick={() => setSection(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
          {section === 'zoho' && (
            <button className="cstrip__action-btn" onClick={load} disabled={loading}>
              <span className="cstrip__action-btn-sheen" />
              <IcoRefresh spin={loading} />{loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {section === 'load' && (
        <div className="s360-list s360-panel"><LoadTesting /></div>
      )}

      {/* ── List shell ── */}
      {section === 'zoho' && (
      <div className="s360-list s360-panel">
        <div className="s360-toolbar">
          <div className="s360-tabs">
            {TABS.map(t => (
              <button key={t.key} className={`s360-tab ${active === t.key ? 'is-active' : ''}`} onClick={() => setActive(t.key)}>
                {t.label}
                {active === t.key && <span className="s360-tab__cnt">{loading ? '…' : filtered.length}</span>}
              </button>
            ))}
          </div>
          <div className="s360-search">
            <IcoSearch />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder={`Search ${tab.label.toLowerCase()}…`} />
          </div>
        </div>

        <div className="rvtbl-wrap">
          <table className="rvtbl">
            <thead>
              <tr>
                <th className="rvtbl-sr">SR&nbsp;NO</th>
                {cols.map(c => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="rvtbl-empty" colSpan={cols.length + 1}>Loading…</td></tr>
              ) : error ? (
                <tr><td className="rvtbl-empty" colSpan={cols.length + 1} style={{ color: '#dc2626' }}>{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="rvtbl-empty" colSpan={cols.length + 1}>No {tab.label.toLowerCase()} synced to Zoho Books yet.</td></tr>
              ) : pageRows.map((row, i) => (
                <tr className="rvtbl-row" key={srBase + i}>
                  <td className="rvtbl-sr">{srBase + i + 1}</td>
                  {cols.map(c => <td key={c.key} className={c.kind ? '' : 'rvtbl-txt'}>{cell(row, c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !error && filtered.length > 0 && (
          <WorklistPager
            total={filtered.length}
            page={safePage}
            pageSize={rpp}
            onPage={setPage}
            onPageSize={n => { setRpp(n); setPage(1); }}
            pageSizeOptions={[10, 25, 50, 100]}
          />
        )}
      </div>
      )}
    </div>
  );
}

const EXTRA = `
.s360m .dvt-pdf{text-decoration:none;cursor:pointer;}
.s360m .dvt-spin{animation:dvt-spin .9s linear infinite;transform-origin:center;}
@keyframes dvt-spin{to{transform:rotate(360deg);}}
.s360m .rvtbl tbody td{padding-top:14px;padding-bottom:14px;}
.s360m .rvtbl tbody tr.rvtbl-row{height:52px;}
/* Section switcher in the hero strip. Sits on the teal gradient, so it uses
   translucent white rather than a card background — a solid pill would read as
   a detached control floating on the banner. */
.dt-sections{display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:rgba(8,47,73,.28);border:1px solid rgba(255,255,255,.38);margin-right:10px;}
.dt-section{border:none;background:transparent;color:#fff;font-size:12.5px;font-weight:700;letter-spacing:.01em;padding:6px 15px;border-radius:8px;cursor:pointer;white-space:nowrap;text-shadow:0 1px 2px rgba(8,47,73,.45);transition:background .15s ease,color .15s ease;}
.dt-section:hover{color:#fff;background:rgba(255,255,255,.12);}
.dt-section.is-active{background:#fff;color:#0b5e73;text-shadow:none;font-weight:800;box-shadow:0 2px 8px rgba(8,47,73,.28);}
@media (max-width:720px){.dt-sections{margin-right:0;}}
`;
