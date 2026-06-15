import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';

/* ─────────────────────────────────────────────────────────────────────────
 * CLM Command Center → Diagnosis & Resolution Center
 *
 * Faithful cyan/sky-themed port of the `ctwr*` view from the
 * CLM_Diagnosis_and_RegulatoryDefense prototype. Combines the former
 * "Diagnosis View" + "Resolution Center" leaves into one surface:
 *
 *   · A header strip with 3 diagnosis sub-tabs (Buyer / Supplier / Case to
 *     Case Contracts).
 *   · Per-tab KPI "Analytics Overview" cards that double as quick filters.
 *   · A compliance grid (KYC / DD / Trade Licenses / Trade Docs / Agreements)
 *     with progress cells + search + pagination.
 *   · A click-through Diagnosis & Resolution detail modal (Blocked vs Fully
 *     Compliant) and a Resolution Center escalation modal.
 * ───────────────────────────────────────────────────────────────────────── */

type SubTab = 'buyer' | 'supplier' | 'ctc';

type Frac = [number, number];                       // [done, total]

type ComplianceRow = {
  id: string;
  name: string;
  segment: string;
  country: string;
  consignees: number;
  shipments: number;
  kyc: Frac; dd: Frac; tl: Frac; td: Frac; agr: Frac;
};

type CtcRow = {
  id: string;
  ctc: string;
  title: string;
  counterparty: string;
  role: 'Buyer' | 'Supplier' | 'Partner';
  status: 'signed' | 'inprogress' | 'clarify' | 'rejected';
};

const PER_PAGE = 6;

/* Map an API {d,t} object to a [done,total] tuple. */
const frac = (o: any): Frac => [Number(o?.d) || 0, Number(o?.t) || 0];

/* Map a buyer / supplier profile row to the page's ComplianceRow. Buyers carry
 * `seg` (array) + `cn` (consignee count) + `country`; suppliers carry a `seg`
 * string + `state` (used as the locale column) and no consignees. */
function mapCompliance(rows: any[]): ComplianceRow[] {
  return rows.map((r) => ({
    id: r.id ?? '—',
    name: r.name ?? '—',
    segment: Array.isArray(r.seg) ? r.seg.join(', ') : (r.seg ?? '—'),
    country: r.country ?? r.state ?? '—',
    consignees: Number(r.cn) || 0,
    shipments: Number(r.ship) || 0,
    kyc: frac(r.kyc), dd: frac(r.dd), tl: frac(r.tl), td: frac(r.td), agr: frac(r.agr),
  }));
}

const ZONES: { id: SubTab; label: string; icon: JSX.Element }[] = [
  { id: 'buyer',    label: 'Buyer Side Overview',             icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></> },
  { id: 'supplier', label: 'Supplier Side Overview',          icon: <><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></> },
  { id: 'ctc',      label: 'Case to Case Contracts Overview', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></> },
];

const STATUS_CFG: Record<CtcRow['status'], { label: string; color: string; bg: string; border: string }> = {
  signed:     { label: 'Signed',              color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  inprogress: { label: 'In Progress',         color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
  clarify:    { label: 'Under Clarification', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  rejected:   { label: 'Rejected',            color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
};

const ROLE_CFG: Record<CtcRow['role'], { color: string; bg: string; border: string }> = {
  Buyer:    { color: '#4f46e5', bg: '#eef0ff', border: '#c7d2fe' },
  Supplier: { color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
  Partner:  { color: '#9333ea', bg: '#faf5ff', border: '#e9d5ff' },
};

/* ── helpers ─────────────────────────────────────────────────────────────── */
const pct = ([d, t]: Frac) => (t === 0 ? 0 : Math.round((d / t) * 100));
const fracColor = (f: Frac) => (pct(f) === 100 ? '#059669' : pct(f) > 0 ? '#d97706' : '#dc2626');
const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function ProgressCell({ f }: { f: Frac }) {
  const c = fracColor(f);
  return (
    <div className="dr-prog">
      <span className="dr-prog-badge" style={{ color: c, background: `${c}14`, border: `1px solid ${c}40` }}>{f[0]}/{f[1]}</span>
      <span className="dr-prog-bar"><i style={{ width: `${pct(f)}%`, background: `linear-gradient(90deg, ${c}99, ${c})` }} /></span>
    </div>
  );
}

export default function ClmDiagnosisResolutionPage() {
  const toast = useToast();
  const [tab, setTab] = useState<SubTab>('buyer');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [cardFilter, setCardFilter] = useState<'all' | 'compliant' | 'pending'>('all');
  const [diag, setDiag] = useState<{ row: ComplianceRow } | null>(null);
  const [escalate, setEscalate] = useState<{ name: string; ref: string } | null>(null);
  const [buyerRows, setBuyerRows] = useState<ComplianceRow[]>([]);
  const [supRows, setSupRows] = useState<ComplianceRow[]>([]);
  const [ctcRows, setCtcRows] = useState<CtcRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/clm/diagnosis-resolution');
        if (!alive) return;
        const d = res.data?.data ?? {};
        setBuyerRows(mapCompliance(d.buyer?.buyers ?? []));
        setSupRows(mapCompliance([
          ...(d.supplier?.ws_mat ?? []), ...(d.supplier?.ws_logi ?? []),
          ...(d.supplier?.wos_svc ?? []), ...(d.supplier?.wos_mat ?? []), ...(d.supplier?.wos_logi ?? []),
        ]));
        setCtcRows((d.ctc ?? []).map((r: any): CtcRow => ({
          id: r.id, ctc: r.ctc ?? r.id, title: r.title ?? '—',
          counterparty: r.counterparty ?? '—',
          role: (['Buyer', 'Supplier', 'Partner'].includes(r.role) ? r.role : 'Partner') as CtcRow['role'],
          status: (['signed', 'inprogress', 'clarify', 'rejected'].includes(r.status) ? r.status : 'inprogress') as CtcRow['status'],
        })));
      } catch {
        if (alive) toast.error('Load failed', 'Could not load diagnosis data.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [toast]);

  const partyRows = tab === 'supplier' ? supRows : buyerRows;
  const isCompliant = (r: ComplianceRow) => [r.kyc, r.dd, r.tl, r.td, r.agr].every((f) => pct(f) === 100);

  /* KPI counts for the active compliance tab */
  const kpis = useMemo(() => {
    const total = partyRows.length;
    const compliant = partyRows.filter(isCompliant).length;
    const pend = (sel: (r: ComplianceRow) => Frac) => partyRows.filter((r) => pct(sel(r)) < 100).length;
    return { total, compliant, kyc: pend((r) => r.kyc), dd: pend((r) => r.dd), tl: pend((r) => r.tl), td: pend((r) => r.td), agr: pend((r) => r.agr) };
  }, [partyRows]);

  const filtered = useMemo(() => {
    let rows = partyRows;
    if (cardFilter === 'compliant') rows = rows.filter(isCompliant);
    if (cardFilter === 'pending') rows = rows.filter((r) => !isCompliant(r));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.id} ${r.name} ${r.segment} ${r.country}`.toLowerCase().includes(q));
    return rows;
  }, [partyRows, cardFilter, search]);

  const ctcFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ctcRows.filter((r) => `${r.id} ${r.ctc} ${r.title} ${r.counterparty}`.toLowerCase().includes(q)) : ctcRows;
  }, [search, ctcRows]);

  const rowsForPage = tab === 'ctc' ? ctcFiltered : filtered;
  const totalPages = Math.max(1, Math.ceil(rowsForPage.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rowsForPage.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const switchTab = (t: SubTab) => { setTab(t); setPage(1); setSearch(''); setCardFilter('all'); };

  const ctcKpis = useMemo(() => ({
    total: ctcRows.length,
    signed: ctcRows.filter((r) => r.status === 'signed').length,
    inprogress: ctcRows.filter((r) => r.status === 'inprogress').length,
    clarify: ctcRows.filter((r) => r.status === 'clarify').length,
    rejected: ctcRows.filter((r) => r.status === 'rejected').length,
  }), [ctcRows]);

  return (
    <div className="dr-root">
      <style>{SCOPED_CSS}</style>

      {/* ── Header strip ─────────────────────────────────────────────────── */}
      <div className="dr-head">
        <span className="dr-head-accent" />
        <div className="dr-head-left">
          <div className="dr-head-ico">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6M8 11h6" /></svg>
            <i className="dr-head-dot" />
          </div>
          <div>
            <h1 className="dr-title">CLM Diagnosis &amp; Resolution Center</h1>
            <p className="dr-sub">Real-time diagnosis of contract risks, compliance gaps, and resolution actions.</p>
          </div>
        </div>
        <div className="dr-zone-tabs">
          {ZONES.map((z) => (
            <button key={z.id} className={`dr-zone ${tab === z.id ? 'active' : ''}`} onClick={() => switchTab(z.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">{z.icon}</svg>
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Analytics overview ──────────────────────────────────────────── */}
      <div className="dr-analytics">
        <div className="dr-an-head">
          <div className="dr-an-ico">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
          </div>
          <span className="dr-an-tag">{tab === 'supplier' ? 'Supplier' : tab === 'ctc' ? 'Contracts' : 'Buyer'}</span>
          <span className="dr-an-divider" />
          <span className="dr-an-title">Analytics Overview</span>
          <span className="dr-an-count">{tab === 'ctc' ? '5 metrics' : '7 metrics'}</span>
          <span className="dr-an-note">Live snapshot of compliance status, pending actions and document health.</span>
        </div>

        {tab === 'ctc' ? (
          <div className="dr-kpi-grid">
            {kpiCard('Total CTC Contracts', ctcKpis.total, 'TOTAL', '#0891b2', cardFilter === 'all', () => setCardFilter('all'))}
            {kpiCard('Fully Signed / Compliant', ctcKpis.signed, 'COMPLETED', '#16a34a', false, () => toast.info('Filter', 'Signed contracts'))}
            {kpiCard('In Progress Contracts', ctcKpis.inprogress, 'IN PROGRESS', '#0891b2', false, () => toast.info('Filter', 'In progress'))}
            {kpiCard('Under Clarification', ctcKpis.clarify, 'CLARIFY', '#d97706', false, () => toast.info('Filter', 'Under clarification'))}
            {kpiCard('Rejected Contracts', ctcKpis.rejected, 'REJECTED', '#dc2626', false, () => toast.info('Filter', 'Rejected'))}
          </div>
        ) : (
          <div className="dr-kpi-grid">
            {kpiCard(`Total ${tab === 'supplier' ? 'Suppliers' : 'Buyers'}`, kpis.total, 'TOTAL', '#0891b2', cardFilter === 'all', () => { setCardFilter('all'); setPage(1); })}
            {kpiCard(`Fully Compliant ${tab === 'supplier' ? 'Suppliers' : 'Buyers'}`, kpis.compliant, 'COMPLETED', '#16a34a', cardFilter === 'compliant', () => { setCardFilter('compliant'); setPage(1); })}
            {kpiCard('KYC Pending', kpis.kyc, 'PENDING', '#dc2626', false, () => { setCardFilter('pending'); setPage(1); })}
            {kpiCard('Due Diligence Pending', kpis.dd, 'PENDING', '#dc2626', false, () => { setCardFilter('pending'); setPage(1); })}
            {kpiCard('Trade Licenses Pending', kpis.tl, 'PENDING', '#dc2626', false, () => { setCardFilter('pending'); setPage(1); })}
            {kpiCard('Trade Documents Pending', kpis.td, 'PENDING', '#dc2626', false, () => { setCardFilter('pending'); setPage(1); })}
            {kpiCard('Agreements Pending', kpis.agr, 'PENDING', '#dc2626', false, () => { setCardFilter('pending'); setPage(1); })}
          </div>
        )}
      </div>

      {/* ── List card ───────────────────────────────────────────────────── */}
      <div className="dr-list-card">
        <div className="dr-list-head">
          <div className="dr-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0e7490" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input value={search} placeholder={`Search ${tab === 'ctc' ? 'contracts' : tab === 'supplier' ? 'suppliers' : 'buyers'}...`} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <span className="dr-rec-badge">{rowsForPage.length} records</span>
        </div>

        <div className="dr-table-wrap">
          {tab === 'ctc' ? (
            <table className="dr-table">
              <thead><tr><th>Sr</th><th>RDF ID</th><th>CTC ID</th><th className="l">Agreement Title</th><th className="l">Counterparty</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {(pageRows as CtcRow[]).map((r, i) => {
                  const sc = STATUS_CFG[r.status]; const rc = ROLE_CFG[r.role];
                  return (
                    <tr key={r.id}>
                      <td>{(safePage - 1) * PER_PAGE + i + 1}</td>
                      <td><span className="dr-pill purple">{r.id}</span></td>
                      <td><span className="dr-pill teal">{r.ctc}</span></td>
                      <td className="l strong">{r.title}</td>
                      <td className="l"><span className="dr-party"><span className="dr-ava" style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)' }}>{initials(r.counterparty)}</span>{r.counterparty}</span></td>
                      <td><span className="dr-role" style={{ color: rc.color, background: rc.bg, border: `1px solid ${rc.border}` }}>{r.role}</span></td>
                      <td><span className="dr-status" style={{ color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}><i style={{ background: sc.color }} />{sc.label}</span></td>
                      <td><button className="dr-act-btn" onClick={() => setEscalate({ name: r.title, ref: r.id })}>Escalate</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="dr-table">
              <thead>
                <tr>
                  <th>Sr</th><th>{tab === 'supplier' ? 'Supplier ID' : 'Customer ID'}</th><th className="l">Company Name</th><th>Segment</th><th>Country</th>
                  {tab === 'buyer' && <th>Consignees</th>}
                  <th>KYC</th><th>Due Diligence</th><th>Trade Licenses</th><th>Trade Docs</th><th>Shipments</th><th>Agreements</th>
                </tr>
              </thead>
              <tbody>
                {(pageRows as ComplianceRow[]).map((r, i) => (
                  <tr key={r.id} className="clickable" onClick={() => setDiag({ row: r })}>
                    <td>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td><span className={`dr-pill ${tab === 'supplier' ? 'darkteal' : 'teal'}`}>{r.id}</span></td>
                    <td className="l strong">{r.name}</td>
                    <td><span className="dr-seg">{r.segment}</span></td>
                    <td>{r.country}</td>
                    {tab === 'buyer' && <td><span className="dr-count">{r.consignees}</span></td>}
                    <td><ProgressCell f={r.kyc} /></td>
                    <td><ProgressCell f={r.dd} /></td>
                    <td><ProgressCell f={r.tl} /></td>
                    <td><ProgressCell f={r.td} /></td>
                    <td><span className="dr-count alt">{r.shipments}</span></td>
                    <td><ProgressCell f={r.agr} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pageRows.length === 0 && <div className="dr-empty">{loading ? 'Loading…' : 'No records match your search.'}</div>}
        </div>

        <div className="dr-foot">
          <span>Showing {rowsForPage.length === 0 ? 0 : (safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, rowsForPage.length)} of {rowsForPage.length} records</span>
          <div className="dr-pager">
            <button disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Prev</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} className={p === safePage ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</button>
          </div>
        </div>
      </div>

      {diag && <DiagnosisModal row={diag.row} compliant={isCompliant(diag.row)} onClose={() => setDiag(null)} onEscalate={() => { setEscalate({ name: diag.row.name, ref: diag.row.id }); setDiag(null); }} />}
      {escalate && <EscalateModal name={escalate.name} reference={escalate.ref} onClose={() => setEscalate(null)} onSubmit={async (payload) => {
        try {
          await api.post('/clm/diagnosis-resolution/escalate', { reference: escalate.ref, ...payload });
          toast.success('Escalated', 'A formal escalation has been raised and logged.');
        } catch {
          toast.error('Failed', 'Could not raise the escalation.');
        } finally {
          setEscalate(null);
        }
      }} />}
    </div>
  );

  function kpiCard(label: string, value: number, badge: string, color: string, active: boolean, onClick: () => void) {
    return (
      <button key={label} className={`dr-kpi ${active ? 'active' : ''}`} style={active ? { borderColor: color } : undefined} onClick={onClick}>
        <span className="dr-kpi-bar" style={{ background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
        <div className="dr-kpi-top">
          <span className="dr-kpi-badge" style={{ color, background: `${color}14`, border: `1px solid ${color}38` }}>{badge}</span>
        </div>
        <div className="dr-kpi-num">{value}</div>
        <div className="dr-kpi-lbl">{label}</div>
      </button>
    );
  }
}

/* ── Diagnosis & Resolution detail modal ─────────────────────────────────── */
function DiagnosisModal({ row, compliant, onClose, onEscalate }: { row: ComplianceRow; compliant: boolean; onClose: () => void; onEscalate: () => void }) {
  const pending = [
    { f: row.kyc, label: 'KYC' }, { f: row.dd, label: 'Due Diligence' }, { f: row.tl, label: 'Trade Licenses' },
    { f: row.td, label: 'Trade Documents' }, { f: row.agr, label: 'Agreements' },
  ].filter((x) => pct(x.f) < 100);

  return (
    <div className="dr-overlay" onClick={onClose}>
      <div className={`dr-modal ${compliant ? 'ok' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className={`dr-modal-head ${compliant ? 'ok' : ''}`}>
          <button className="dr-modal-x" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className="dr-modal-eyebrow">Diagnosis &amp; Resolution · {compliant ? 'Status' : 'Issue Detail'}</div>
          <div className="dr-modal-title">{row.name}</div>
          <div className="dr-modal-badges">
            <span className="dr-mb light">{row.id}</span>
            <span className="dr-mb soft">{row.segment} · {row.country}</span>
            {compliant
              ? <span className="dr-mb ok">✓ FULLY COMPLIANT</span>
              : <span className="dr-mb danger">⚠ {pending.length} BLOCKER{pending.length > 1 ? 'S' : ''}</span>}
          </div>
        </div>

        {compliant ? (
          <div className="dr-ok-body">
            <div className="dr-ok-ico">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div className="dr-ok-title">No action required</div>
            <p className="dr-ok-sub">This record is completed &amp; fully compliant across KYC, Due Diligence, Trade Licenses, Trade Documents and Agreements. No blockers or pending work.</p>
            <button className="dr-ok-close" onClick={onClose}>Close</button>
          </div>
        ) : (
          <div className="dr-modal-body">
            <div className="dr-diag-label">🔍 Diagnosis Summary</div>
            <div className="dr-diag-grid">
              <DiagCard accent="#dc2626" bg="#fef5f5" icon="🔴" title="Why it is blocked"
                lead={`${pending.length} compliance area(s) remain incomplete, blocking record progression.`}
                rows={[['Pending Items', String(pending.length), '#dc2626'], ['Progression', 'Blocked', '#dc2626']]} />
              <DiagCard accent="#d97706" bg="#fffbf2" icon="📍" title="Where it is blocked"
                lead={pending.map((p) => p.label).join(', ')}
                rows={[['Blocked At', pending[0]?.label ?? '—', '#d97706'], ['Validation', 'Failed', '#dc2626'], ['Reference', row.id, '#0f172a']]} />
              <DiagCard accent="#d97706" bg="#fffbf2" icon="⏱" title="When it is blocked"
                rows={[['Started', '12 days ago', '#0f172a'], ['Due By', 'Overdue', '#dc2626'], ['Delay', '4d', '#dc2626']]} />
              <DiagCard accent="#7c3aed" bg="#f8f6ff" icon="🔗" title="Dependency details"
                lead="Waiting on counterparty document submission before the next stage can open."
                rows={[['Blocked By', 'Compliance', '#7c3aed'], ['Next Stage Ready', '✖ Not ready', '#dc2626']]} />
              <DiagCard accent="#ea580c" bg="#fff8f3" icon="⚡" title="Action required"
                lead={`Re-collect & validate ${pending[0]?.label ?? 'pending'} documents, then advance the record.`}
                rows={[['Assign To', 'Trade Compliance', '#0f172a'], ['Priority', 'High', '#dc2626']]} />
              <DiagCard accent="#059669" bg="#f1fdf8" icon="🧭" title="Root cause & ownership"
                lead="Incomplete onboarding documents pending counterparty action."
                rows={[['Responsible Dept.', 'Compliance', '#0f172a'], ['Status', 'Open · Unresolved', '#dc2626']]} />
            </div>
            <div className="dr-modal-actions">
              <button className="dr-btn ghost" onClick={onClose}>Close</button>
              <button className="dr-btn danger" onClick={onEscalate}>⚠ Escalate Issue</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiagCard({ accent, bg, icon, title, lead, rows }: { accent: string; bg: string; icon: string; title: string; lead?: string; rows: [string, string, string][] }) {
  return (
    <div className="dr-dcard" style={{ background: bg, borderColor: `${accent}33` }}>
      <div className="dr-dcard-hd"><span className="dr-dcard-ico" style={{ background: accent }}>{icon}</span><span style={{ color: accent }}>{title}</span></div>
      {lead && <div className="dr-dcard-lead">{lead}</div>}
      <div className="dr-dcard-rows">
        {rows.map(([k, v, c], i) => (
          <div key={i} className="dr-dcard-row"><span>{k}</span><b style={{ color: c }}>{v}</b></div>
        ))}
      </div>
    </div>
  );
}

/* ── Resolution Center · Escalation modal ────────────────────────────────── */
type EscalatePayload = { escalate_to: string; issue_type: string; priority: string; message: string; notify_via: string[] };

function EscalateModal({ name, reference, onClose, onSubmit }: { name: string; reference: string; onClose: () => void; onSubmit: (p: EscalatePayload) => void }) {
  const [priority, setPriority] = useState('high');
  const [escalateTo, setEscalateTo] = useState('Trade Compliance');
  const [issueType, setIssueType] = useState('Hard Block');
  const [message, setMessage] = useState(`${reference} compliance gap — SLA at risk. Requires immediate attention.`);
  const [notify, setNotify] = useState<Record<string, boolean>>({ Email: true, WhatsApp: false, Slack: false, 'System Notification': true });
  const [saving, setSaving] = useState(false);
  const PRIOS = [
    { k: 'critical', label: '🔴 Critical', c: '#dc2626' },
    { k: 'high',     label: '🟠 High',     c: '#d97706' },
    { k: 'medium',   label: '🔵 Medium',   c: '#0891b2' },
    { k: 'low',      label: '🟢 Low',      c: '#059669' },
  ];
  const toggleNotify = (k: string) => setNotify((n) => ({ ...n, [k]: !n[k] }));
  const submit = () => {
    if (!message.trim()) return;
    setSaving(true);
    onSubmit({ escalate_to: escalateTo, issue_type: issueType, priority, message: message.trim(), notify_via: Object.keys(notify).filter((k) => notify[k]) });
  };
  return (
    <div className="dr-overlay" onClick={onClose}>
      <div className="dr-esc" onClick={(e) => e.stopPropagation()}>
        <div className="dr-esc-head">
          <button className="dr-modal-x" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className="dr-esc-eyebrow">🚨 Resolution Center · Escalation</div>
          <div className="dr-esc-title">Escalate Issue</div>
          <div className="dr-esc-subtitle">Raising a formal escalation for <b>{reference}</b> — {name}</div>
        </div>
        <div className="dr-esc-body">
          <div className="dr-esc-alert">⚠️ Escalation will create an audit log, notify the target, and mark this issue as Escalated in the system.</div>
          <div className="dr-esc-grid2">
            <label className="dr-field"><span>Escalate To <i>*</i></span>
              <select value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)}><option>Trade Compliance</option><option>Sales Department</option><option>Purchase &amp; Procurement</option><option>Finance &amp; Accounts</option><option>Legal &amp; Contracts</option><option>Management / CXO</option></select>
            </label>
            <label className="dr-field"><span>Issue Type <i>*</i></span>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value)}><option>Hard Block</option><option>Compliance Gap</option><option>Document Pending</option><option>SLA Breach</option><option>Approval Delay</option><option>Other</option></select>
            </label>
          </div>
          <div className="dr-field"><span>Priority</span>
            <div className="dr-prio-row">
              {PRIOS.map((p) => (
                <button key={p.k} type="button" className={`dr-prio ${priority === p.k ? 'on' : ''}`} style={priority === p.k ? { borderColor: p.c, background: `${p.c}14`, color: p.c } : undefined} onClick={() => setPriority(p.k)}>{p.label}</button>
              ))}
            </div>
          </div>
          <label className="dr-field"><span>Reason / Message <i>*</i></span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="dr-field"><span>Notify Via</span>
            <div className="dr-notify">
              {(['Email', 'WhatsApp', 'Slack', 'System Notification'] as const).map((k) => (
                <label key={k}><input type="checkbox" checked={notify[k]} onChange={() => toggleNotify(k)} /> {k === 'Email' ? '📧' : k === 'WhatsApp' ? '💬' : k === 'Slack' ? '💼' : '🔔'} {k}</label>
              ))}
            </div>
          </div>
        </div>
        <div className="dr-esc-foot">
          <span>All fields marked * are required</span>
          <div>
            <button className="dr-btn ghost" onClick={onClose}>Cancel</button>
            <button className="dr-btn danger" disabled={saving} onClick={submit}>⚠ Confirm Escalation</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.dr-root { font-family:'DM Sans',system-ui,sans-serif; background:#f8fafc; padding:14px 18px 26px; margin:-1rem -0.75rem; min-height:calc(100vh - 70px); color:#0f172a; display:flex; flex-direction:column; gap:13px; }
.dr-root *,.dr-root *::before,.dr-root *::after { box-sizing:border-box; }

.dr-head { position:relative; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:10px 18px; border-radius:13px; overflow:hidden; background:linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%); border:1px solid rgba(6,182,212,.2); box-shadow:0 2px 12px rgba(8,145,178,.08); }
.dr-head-accent { position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(180deg,#22d3ee,#0891b2,#0e7490); }
.dr-head-left { display:flex; align-items:center; gap:13px; }
.dr-head-ico { position:relative; width:42px; height:42px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#06b6d4,#0891b2,#0e7490); box-shadow:0 0 0 3px rgba(6,182,212,.22),0 4px 12px rgba(8,145,178,.4); }
.dr-head-dot { position:absolute; right:-3px; bottom:-3px; width:11px; height:11px; border-radius:50%; background:linear-gradient(135deg,#4ade80,#22c55e); border:2px solid #cef8ff; }
.dr-title { font-size:17px; font-weight:800; color:#0c4a6e; letter-spacing:-.4px; margin:0; line-height:1.15; }
.dr-sub { font-size:11px; font-weight:500; color:#0e7490; opacity:.92; margin:3px 0 0; }
.dr-zone-tabs { display:flex; gap:3px; padding:3px; background:rgba(255,255,255,.6); border:1.5px solid rgba(6,182,212,.25); border-radius:11px; }
.dr-zone { display:inline-flex; align-items:center; gap:7px; padding:0 15px; height:42px; border:none; border-radius:9px; background:transparent; color:#0e7490; font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; }
.dr-zone:hover { background:rgba(6,182,212,.1); color:#0c4a6e; }
.dr-zone.active { background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%); color:#fff; box-shadow:0 3px 12px rgba(6,182,212,.4); }

.dr-analytics { background:#fff; border:1px solid #cffafe; border-radius:13px; padding:13px 15px; box-shadow:0 1px 4px rgba(6,182,212,.06); }
.dr-an-head { display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin-bottom:11px; }
.dr-an-ico { width:34px; height:34px; border-radius:9px; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#06b6d4,#0891b2); box-shadow:0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3); }
.dr-an-tag { font-size:11px; font-weight:800; color:#0891b2; }
.dr-an-divider { width:1px; height:18px; background:#a5e8f5; }
.dr-an-title { font-size:13px; font-weight:800; color:#0c4a6e; }
.dr-an-count { font-size:8.5px; font-weight:800; color:#0891b2; background:rgba(6,182,212,.1); border:1px solid #a5f3fc; border-radius:20px; padding:2px 8px; letter-spacing:.04em; }
.dr-an-note { font-size:10px; font-weight:500; color:#0e7490; margin-left:auto; }

.dr-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; }
.dr-kpi { position:relative; text-align:left; overflow:hidden; padding:11px 12px 12px; border:1.5px solid #a5f3fc; border-radius:9px; background:#fff; cursor:pointer; transition:all .16s; box-shadow:0 1px 3px rgba(6,182,212,.07); font-family:inherit; }
.dr-kpi:hover { transform:translateY(-2px); box-shadow:0 6px 16px rgba(8,145,178,.16); }
.dr-kpi.active { background:#ecfeff; box-shadow:0 4px 14px rgba(8,145,178,.22); }
.dr-kpi-bar { position:absolute; left:0; top:0; right:0; height:3px; }
.dr-kpi-top { display:flex; justify-content:flex-end; margin-bottom:5px; }
.dr-kpi-badge { font-size:8px; font-weight:800; letter-spacing:.05em; padding:2px 7px; border-radius:6px; }
.dr-kpi-num { font-size:24px; font-weight:900; color:#0c4a6e; line-height:1; }
.dr-kpi-lbl { font-size:10px; font-weight:700; color:#0891b2; margin-top:4px; }

.dr-list-card { background:#fff; border:1px solid #cffafe; border-radius:13px; overflow:hidden; box-shadow:0 1px 4px rgba(6,182,212,.06); }
.dr-list-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; background:linear-gradient(110deg,#f0fdff,#e8fbfd); border-bottom:1px solid #a5f3fc; }
.dr-search { position:relative; display:flex; align-items:center; flex:1; max-width:420px; }
.dr-search svg { position:absolute; left:11px; }
.dr-search input { width:100%; padding:8px 12px 8px 33px; border:1.5px solid rgba(6,182,212,.3); border-radius:9px; font-family:inherit; font-size:12px; color:#0c4a6e; background:#fff; outline:none; }
.dr-search input:focus { border-color:#0891b2; box-shadow:0 0 0 3px rgba(8,145,178,.14); }
.dr-rec-badge { font-size:10px; font-weight:700; color:#0e7490; background:rgba(6,182,212,.12); border:1px solid rgba(6,182,212,.28); border-radius:20px; padding:5px 12px; white-space:nowrap; }

.dr-table-wrap { overflow-x:auto; }
.dr-table { width:100%; border-collapse:collapse; }
.dr-table th { padding:9px 8px; font-size:8px; font-weight:800; letter-spacing:.06em; color:#0e7490; text-transform:uppercase; white-space:nowrap; text-align:center; background:linear-gradient(180deg,#f0fdff,#e8fbfd); border-bottom:2px solid #a5f3fc; }
.dr-table th.l { text-align:left; }
.dr-table td { padding:8px; font-size:11px; text-align:center; border-bottom:1px solid rgba(6,182,212,.08); white-space:nowrap; }
.dr-table td.l { text-align:left; }
.dr-table td.strong { font-weight:700; color:#0f172a; }
.dr-table tbody tr:nth-child(even) { background:rgba(240,253,255,.45); }
.dr-table tr.clickable { cursor:pointer; }
.dr-table tr.clickable:hover { background:#ecfeff; }

.dr-pill { display:inline-flex; align-items:center; padding:2px 9px; border-radius:6px; font-size:9.5px; font-weight:700; font-family:ui-monospace,monospace; }
.dr-pill.teal { color:#0891b2; background:#ecfeff; border:1px solid #a5f3fc; }
.dr-pill.darkteal { color:#0e7490; background:#f0fdfa; border:1px solid #99f6e4; }
.dr-pill.purple { color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; }
.dr-seg { display:inline-block; padding:2px 9px; border-radius:6px; font-size:9.5px; font-weight:700; color:#0369a1; background:#eff6ff; border:1px solid #bfdbfe; }
.dr-count { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; border-radius:50%; font-size:10px; font-weight:800; color:#0891b2; background:#ecfeff; border:1px solid #a5f3fc; }
.dr-count.alt { border-radius:7px; color:#4f46e5; background:#eef0ff; border-color:#c7d2fe; }
.dr-party { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:700; color:#0f172a; }
.dr-ava { width:24px; height:24px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:800; color:#fff; }
.dr-role { display:inline-block; padding:2px 9px; border-radius:20px; font-size:8.5px; font-weight:800; text-transform:uppercase; letter-spacing:.02em; }
.dr-status { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:20px; font-size:9.5px; font-weight:800; }
.dr-status i { width:5px; height:5px; border-radius:50%; }
.dr-act-btn { padding:6px 13px; border:none; border-radius:8px; font-size:10px; font-weight:700; color:#fff; cursor:pointer; background:linear-gradient(135deg,#22d3ee,#06b6d4 55%,#0891b2); }
.dr-act-btn:hover { transform:translateY(-1px); box-shadow:0 5px 14px rgba(6,182,212,.4); }

.dr-prog { display:flex; flex-direction:column; align-items:center; gap:3px; }
.dr-prog-badge { padding:1px 7px; border-radius:20px; font-size:10px; font-weight:900; }
.dr-prog-bar { display:block; width:54px; height:5px; border-radius:3px; background:rgba(6,182,212,.1); overflow:hidden; }
.dr-prog-bar i { display:block; height:100%; border-radius:3px; }

.dr-empty { padding:28px; text-align:center; color:#64748b; font-size:12px; }
.dr-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 16px; border-top:1px solid #eef6f9; background:#fafdff; flex-wrap:wrap; }
.dr-foot > span { font-size:10.5px; color:#64748b; }
.dr-pager { display:flex; gap:5px; }
.dr-pager button { min-width:28px; height:28px; padding:0 9px; border:1.5px solid rgba(6,182,212,.2); border-radius:7px; background:#fff; color:#0891b2; font-family:inherit; font-size:11px; font-weight:700; cursor:pointer; }
.dr-pager button:disabled { opacity:.45; cursor:not-allowed; }
.dr-pager button.active { background:linear-gradient(135deg,#06b6d4,#0891b2); color:#fff; border-color:transparent; box-shadow:0 2px 8px rgba(8,145,178,.3); }

/* modals */
.dr-overlay { position:fixed; inset:0; z-index:100001; background:rgba(15,23,42,.55); display:flex; align-items:center; justify-content:center; padding:24px; }
.dr-modal { width:100%; max-width:860px; max-height:90vh; background:#fff; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(8,145,178,.35); }
.dr-modal-head { position:relative; padding:13px 22px 12px; color:#fff; background:linear-gradient(125deg,#0c4a6e 0%,#0e7490 55%,#0891b2 100%); }
.dr-modal-head.ok { background:linear-gradient(120deg,#065f46,#059669,#10b981); }
.dr-modal-x { position:absolute; top:12px; right:14px; width:28px; height:28px; border-radius:50%; border:none; background:rgba(255,255,255,.2); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.dr-modal-eyebrow { font-size:8.5px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; color:#7dd3fc; }
.dr-modal-head.ok .dr-modal-eyebrow { color:#bbf7d0; }
.dr-modal-title { font-size:19px; font-weight:800; letter-spacing:-.4px; margin-top:2px; }
.dr-modal-badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.dr-mb { font-size:9.5px; font-weight:800; padding:3px 10px; border-radius:20px; letter-spacing:.03em; }
.dr-mb.light { background:#fff; color:#0c4a6e; }
.dr-mb.soft { background:rgba(255,255,255,.16); color:#e0f2fe; }
.dr-mb.ok { background:rgba(255,255,255,.2); color:#fff; }
.dr-mb.danger { background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; }
.dr-modal-body { padding:14px 20px 18px; background:#fbfdff; overflow-y:auto; }
.dr-diag-label { font-size:11px; font-weight:800; color:#0c4a6e; padding-bottom:7px; margin-bottom:11px; border-bottom:2px solid; border-image:linear-gradient(90deg,#cdeef5,transparent) 1; }
.dr-diag-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px; }
.dr-dcard { border:1px solid; border-radius:10px; padding:10px 12px; }
.dr-dcard-hd { display:flex; align-items:center; gap:7px; font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
.dr-dcard-ico { width:20px; height:20px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; }
.dr-dcard-lead { font-size:10.5px; color:#475569; line-height:1.4; margin-bottom:7px; }
.dr-dcard-rows { display:flex; flex-direction:column; }
.dr-dcard-row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:10.5px; padding:3px 0; border-top:1px dashed rgba(15,23,42,.08); }
.dr-dcard-row span { color:#64748b; }
.dr-dcard-row b { font-weight:800; }
.dr-modal-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:14px; }
.dr-btn { padding:9px 18px; border-radius:10px; font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; border:none; }
.dr-btn.ghost { background:#fff; border:1.5px solid #e2e8f0; color:#475569; }
.dr-btn.danger { background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; box-shadow:0 7px 20px rgba(220,38,38,.4); }
.dr-btn.danger:hover { transform:translateY(-1px); }

.dr-ok-body { padding:38px 28px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:11px; }
.dr-ok-ico { width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#059669,#10b981); box-shadow:0 0 0 6px rgba(16,185,129,.15); }
.dr-ok-title { font-size:17px; font-weight:800; color:#065f46; }
.dr-ok-sub { font-size:13px; font-weight:500; color:#475569; max-width:420px; line-height:1.6; margin:0; }
.dr-ok-close { margin-top:6px; padding:10px 22px; border:none; border-radius:10px; background:linear-gradient(135deg,#059669,#10b981); color:#fff; font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; }

/* escalation */
.dr-esc { width:100%; max-width:640px; max-height:92vh; background:#fff; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(220,38,38,.3); }
.dr-esc-head { position:relative; padding:14px 24px; color:#fff; background:linear-gradient(125deg,#7f1d1d 0%,#b91c1c 35%,#dc2626 70%,#ef4444 100%); }
.dr-esc-eyebrow { font-size:8px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:#fecaca; }
.dr-esc-title { font-size:19px; font-weight:800; line-height:1.05; margin-top:2px; }
.dr-esc-subtitle { font-size:10.5px; font-weight:600; color:#fee2e2; margin-top:4px; }
.dr-esc-body { padding:14px 24px; overflow-y:auto; display:flex; flex-direction:column; gap:13px; }
.dr-esc-alert { font-size:11px; color:#991b1b; line-height:1.45; background:linear-gradient(90deg,#fef2f2,#fff7f7); border:1px solid #fecaca; border-left:3px solid #ef4444; border-radius:8px; padding:9px 12px; }
.dr-esc-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.dr-field { display:flex; flex-direction:column; gap:6px; }
.dr-field > span { font-size:9.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#475569; }
.dr-field i { color:#ef4444; font-style:normal; }
.dr-field select, .dr-field textarea { width:100%; padding:9px 13px; border:1.5px solid #fcd9d9; border-radius:11px; background:#fffafa; font-family:inherit; font-size:12.5px; font-weight:600; color:#0f172a; outline:none; }
.dr-field textarea { min-height:70px; resize:vertical; }
.dr-prio-row { display:flex; gap:8px; }
.dr-prio { flex:1; height:40px; border:1.5px solid #e2e8f0; border-radius:11px; background:#fff; font-family:inherit; font-size:11.5px; font-weight:700; color:#475569; cursor:pointer; }
.dr-notify { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.dr-notify label { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; color:#334155; }
.dr-esc-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 24px; border-top:1px solid #fde0e0; background:linear-gradient(180deg,#fff,#fffafa); }
.dr-esc-foot > span { font-size:10px; color:#94a3b8; }
.dr-esc-foot > div { display:flex; gap:9px; }

/* ── dark mode (page surfaces; vibrant gradient header + popup modals stay
      as designed — they read fine on either background) ─────────────────── */
[data-bs-theme="dark"] .dr-root { background:#0f0b1a; color:#e2e8f0; }
[data-bs-theme="dark"] .dr-head { background:linear-gradient(110deg,#0c2231 0%,#0e2e3c 45%,#0a2028 100%); border-color:rgba(6,182,212,.28); box-shadow:none; }
[data-bs-theme="dark"] .dr-title { color:#e0f9fd; }
[data-bs-theme="dark"] .dr-sub { color:#67e8f9; }
[data-bs-theme="dark"] .dr-head-dot { border-color:#0c2231; }
[data-bs-theme="dark"] .dr-zone-tabs { background:rgba(255,255,255,.06); border-color:rgba(6,182,212,.3); }
[data-bs-theme="dark"] .dr-zone { color:#7dd3fc; }
[data-bs-theme="dark"] .dr-zone:hover { background:rgba(6,182,212,.15); color:#e0f9fd; }
[data-bs-theme="dark"] .dr-analytics,
[data-bs-theme="dark"] .dr-list-card { background:#161226; border-color:rgba(148,163,184,.18); box-shadow:none; }
[data-bs-theme="dark"] .dr-an-tag { color:#67e8f9; }
[data-bs-theme="dark"] .dr-an-title { color:#7dd3fc; }
[data-bs-theme="dark"] .dr-an-note { color:#94a3b8; }
[data-bs-theme="dark"] .dr-an-divider { background:rgba(148,163,184,.25); }
[data-bs-theme="dark"] .dr-an-count { background:rgba(6,182,212,.16); border-color:rgba(6,182,212,.35); color:#67e8f9; }
[data-bs-theme="dark"] .dr-kpi { background:#1c1733; border-color:rgba(148,163,184,.18); box-shadow:none; }
[data-bs-theme="dark"] .dr-kpi.active { background:rgba(6,182,212,.12); }
[data-bs-theme="dark"] .dr-kpi-num { color:#f1f5f9; }
[data-bs-theme="dark"] .dr-kpi-lbl { color:#67e8f9; }
[data-bs-theme="dark"] .dr-list-head { background:rgba(255,255,255,.03); border-bottom-color:rgba(148,163,184,.18); }
[data-bs-theme="dark"] .dr-search input { background:rgba(255,255,255,.05); border-color:rgba(148,163,184,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dr-rec-badge { color:#67e8f9; background:rgba(6,182,212,.14); border-color:rgba(6,182,212,.3); }
[data-bs-theme="dark"] .dr-table th { background:rgba(255,255,255,.04); color:#67e8f9; border-bottom-color:rgba(148,163,184,.22); }
[data-bs-theme="dark"] .dr-table td { color:#cbd5e1; border-bottom-color:rgba(148,163,184,.12); }
[data-bs-theme="dark"] .dr-table td.strong { color:#f1f5f9; }
[data-bs-theme="dark"] .dr-table tbody tr:nth-child(even) { background:rgba(255,255,255,.025); }
[data-bs-theme="dark"] .dr-table tr.clickable:hover { background:rgba(6,182,212,.1); }
[data-bs-theme="dark"] .dr-seg { background:rgba(59,130,246,.16); border-color:rgba(59,130,246,.35); color:#93c5fd; }
[data-bs-theme="dark"] .dr-count { background:rgba(6,182,212,.16); border-color:rgba(6,182,212,.35); color:#67e8f9; }
[data-bs-theme="dark"] .dr-count.alt { background:rgba(79,70,229,.18); border-color:rgba(79,70,229,.4); color:#a5b4fc; }
[data-bs-theme="dark"] .dr-pill.teal { background:rgba(6,182,212,.16); border-color:rgba(6,182,212,.4); color:#67e8f9; }
[data-bs-theme="dark"] .dr-pill.darkteal { background:rgba(13,148,136,.16); border-color:rgba(13,148,136,.4); color:#5eead4; }
[data-bs-theme="dark"] .dr-pill.purple { background:rgba(124,58,237,.18); border-color:rgba(124,58,237,.42); color:#c4b5fd; }
[data-bs-theme="dark"] .dr-prog-bar { background:rgba(148,163,184,.15); }
[data-bs-theme="dark"] .dr-empty { color:#94a3b8; }
[data-bs-theme="dark"] .dr-foot { background:rgba(255,255,255,.03); border-top-color:rgba(148,163,184,.18); }
[data-bs-theme="dark"] .dr-foot > span { color:#94a3b8; }
[data-bs-theme="dark"] .dr-pager button { background:rgba(255,255,255,.05); border-color:rgba(148,163,184,.22); color:#67e8f9; }
[data-bs-theme="dark"] .dr-pager button.active { background:linear-gradient(135deg,#06b6d4,#0891b2); color:#fff; border-color:transparent; }
`;
