import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import WorklistPager from '../../components/ui/WorklistPager';
import { resolveFileUrl } from '../../utils/resolveFileUrl';

/* ─────────────────────────────────────────────────────────────────────────
 * CLM Command Center → Regulatory Defense File (RDF)
 *
 * Faithful cyan/sky-themed port of the `render('ev')` view from the
 * CLM_Diagnosis_and_RegulatoryDefense prototype. A read-only regulatory
 * defense file repository spanning three tabs:
 *
 *   · With Shipment ID    — shipment-linked RDF records (buyer/consignee/supplier)
 *   · Without Shipment ID  — procurement-wise RDF records + compliance progress
 *   · Case to Case         — per-deal agreement RDF records
 *
 * Each row's "Evidence Vault" action opens a READ-ONLY grouped document
 * repository (card / list view) — view + download only, no send/sign/track.
 * ───────────────────────────────────────────────────────────────────────── */

type RdfTab = 'with' | 'without' | 'c2c';
type Frac = [number, number];

/** An Evidence-Vault party the row's documents can be pulled for. */
type VaultTarget = { key: string; label: string; type: string; id: number };

type Supplier = { name: string; code: string; id: number };
type ProcLine = { proc: string; suppliers: Supplier[]; po: string };
type WithRow = { rdf: string; ship: string; opp: string; customer: string; consignee: string; pi: string; procs: ProcLine[]; vault: VaultTarget[] };
type WithoutRow = { rdf: string; proc: string; supplier: string; po: string; vti: string; kyc: Frac; dd: Frac; tl: Frac; td: Frac; agr: Frac; vault: VaultTarget[] };
type C2cRow = { rdf: string; ctc: string; title: string; counterparty: string; role: 'Buyer' | 'Supplier' | 'Partner'; vault: VaultTarget[] };


const TABS: { id: RdfTab; label: string; icon: JSX.Element }[] = [
  { id: 'with',    label: 'With Shipment ID RDF',    icon: <><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></> },
  { id: 'without', label: 'Without Shipment ID RDF', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></> },
  { id: 'c2c',     label: 'Case to Case RDF',        icon: <><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></> },
];

const ROLE_CFG: Record<C2cRow['role'], { color: string; bg: string; border: string }> = {
  Buyer:    { color: '#4f46e5', bg: '#eef0ff', border: '#c7d2fe' },
  Supplier: { color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
  Partner:  { color: '#9333ea', bg: '#faf5ff', border: '#e9d5ff' },
};
const referredAs = (r: C2cRow['role']) => (r === 'Buyer' ? 'Supplier' : r === 'Supplier' ? 'Buyer' : 'Partner');

const pct = ([d, t]: Frac) => (t === 0 ? 0 : Math.round((d / t) * 100));
const fracColor = (f: Frac) => (pct(f) === 100 ? '#059669' : pct(f) > 0 ? '#d97706' : '#dc2626');
const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
/* Map an API {d,t} object to a [done,total] tuple. */
const frac = (o: any): Frac => [Number(o?.d) || 0, Number(o?.t) || 0];

/* ── read-only document repository (Evidence Vault) ──────────────────────── */
const SECTION_META: { key: 'company_dd' | 'owner_kyc' | 'trade_licenses' | 'trade_documents'; name: string; sub: string }[] = [
  { key: 'company_dd',      name: 'Company Due Diligence', sub: 'Registration · Tax · Identity' },
  { key: 'owner_kyc',       name: 'Owner KYC Details',     sub: 'Identity & ownership' },
  { key: 'trade_licenses',  name: 'Trade Licenses',        sub: 'Permits & registrations' },
  { key: 'trade_documents', name: 'Trade Documents',       sub: 'Declarations & undertakings' },
];

type VaultDoc = { name?: string; reference?: string; status?: string; attachment?: string | null; attachment_url?: string | null };

const FileIco = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
);
const EyeIco = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>);
const DlIco = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>);

function VaultDrawer({ title, targets, onClose }: { title: string; targets: VaultTarget[]; onClose: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<'card' | 'list'>('card');
  const [active, setActive] = useState(0);
  const [data, setData] = useState<Record<string, VaultDoc[]>>({});
  const [loading, setLoading] = useState(true);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const target = targets[active];
  useEffect(() => {
    if (!target) { setData({}); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.get(`/segment-uploads/${target.type}/${target.id}/vault`)
      .then((res) => {
        if (!alive) return;
        const d = res.data?.data ?? {};
        setData({
          company_dd: d.company_dd ?? [], owner_kyc: d.owner_kyc ?? [],
          trade_licenses: d.trade_licenses ?? [], trade_documents: d.trade_documents ?? [],
        });
      })
      .catch(() => { if (alive) toast.error('Load failed', 'Could not load vault documents.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [target?.type, target?.id, toast]);

  const sections = SECTION_META.map((m) => ({ ...m, docs: data[m.key] ?? [] })).filter((s) => s.docs.length > 0);

  const docOpen = (doc: VaultDoc) => {
    const url = resolveFileUrl(doc.attachment_url || doc.attachment || '');
    if (url) window.open(url, '_blank', 'noopener');
    else toast.info('Not uploaded', `${doc.name ?? 'This document'} has not been uploaded yet.`);
  };
  const statusTok = (s?: string) => (s === 'Verified'
    ? { color: '#059669', bg: 'linear-gradient(135deg,#ecfdf5,#d1fae5)', border: '#a7f3d0', dot: '#10b981' }
    : { color: '#d97706', bg: 'linear-gradient(135deg,#fffbeb,#fef3c7)', border: '#fcd34d', dot: '#f59e0b' });

  return createPortal(
    <div className="rdf-overlay" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="rdf-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="rdf-drawer-head">
          <div>
            <div className="rdf-drawer-eyebrow">Regulatory Defense File · Evidence Vault</div>
            <div className="rdf-drawer-title">{title}</div>
          </div>
          <button className="rdf-drawer-x" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="rdf-drawer-toolbar">
          {targets.length > 1 ? (
            <div className="rdf-view-toggle">
              {targets.map((t, i) => (
                <button key={t.key} className={active === i ? 'on' : ''} onClick={() => setActive(i)}>{t.label}</button>
              ))}
            </div>
          ) : (
            <span className="rdf-readonly">🔒 Read-only repository · view &amp; download only</span>
          )}
          <div className="rdf-toolbar-right">
            <div className="rdf-view-toggle">
              <button className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                Card
              </button>
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                List
              </button>
            </div>
          </div>
        </div>
        <div className="rdf-drawer-body">
          {loading ? (
            <div className="rdf-vault-empty">Loading documents…</div>
          ) : sections.length === 0 ? (
            <div className="rdf-vault-empty">{target ? 'No documents on record for this party yet.' : 'No linked party to show documents for.'}</div>
          ) : sections.map((g) => (
            <div key={g.key} className="rdf-sec">
              <span className="rdf-sec-accent" />
              <div className="rdf-sec-hd">
                <div className="rdf-sec-ico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                </div>
                <div>
                  <div className="rdf-sec-name">{g.name}</div>
                  <div className="rdf-sec-sub">{g.sub}</div>
                </div>
                <span className="rdf-sec-count">{g.docs.length} files</span>
              </div>
              {view === 'card' ? (
                <div className="rdf-grid">
                  {g.docs.map((doc, i) => {
                    const st = statusTok(doc.status);
                    return (
                      <div key={i} className="rdf-file">
                        <span className="rdf-file-top-bar" />
                        <div className="rdf-file-top">
                          <span className="rdf-file-ico"><FileIco /><i className="rdf-pdf">PDF</i></span>
                          <div className="rdf-file-body">
                            <div className="rdf-file-name" title={doc.name}>{doc.name ?? doc.reference ?? 'Document'}</div>
                            <div className="rdf-file-meta" style={{ color: st.color, background: st.bg, borderColor: st.border }}><i className="rdf-dot" style={{ background: st.dot }} /> {doc.status ?? 'Pending'}</div>
                          </div>
                        </div>
                        <div className="rdf-file-acts">
                          <button className="rdf-act view" title="View" onClick={() => docOpen(doc)}><EyeIco /></button>
                          <button className="rdf-act dl" title="Download" onClick={() => docOpen(doc)}><DlIco /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rdf-list">
                  {g.docs.map((doc, i) => {
                    const st = statusTok(doc.status);
                    return (
                      <div key={i} className="rdf-row">
                        <span className="rdf-row-ico"><FileIco /></span>
                        <span className="rdf-row-name" title={doc.name}>{doc.name ?? doc.reference ?? 'Document'}</span>
                        <span className="rdf-row-status" style={{ color: st.color, background: st.bg, borderColor: st.border }}><i className="rdf-dot" style={{ background: st.dot }} /> {doc.status ?? 'Pending'}</span>
                        <span className="rdf-file-acts">
                          <button className="rdf-act view" title="View" onClick={() => docOpen(doc)}><EyeIco /></button>
                          <button className="rdf-act dl" title="Download" onClick={() => docOpen(doc)}><DlIco /></button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function VaultBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="rdf-vault-btn" onClick={onClick}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
      Evidence Vault
    </button>
  );
}

function ProgressCell({ f }: { f: Frac }) {
  const c = fracColor(f);
  return (
    <div className="rdf-prog">
      <span style={{ color: c, fontWeight: 800, fontSize: 11.5 }}>{f[0]}/{f[1]}</span>
      <span style={{ color: c, fontWeight: 600, fontSize: 8 }}>{pct(f)}%</span>
    </div>
  );
}

export default function ClmRegulatoryDefenseFilePage() {
  const toast = useToast();
  const [tab, setTab] = useState<RdfTab>('with');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [vault, setVault] = useState<{ title: string; targets: VaultTarget[] } | null>(null);
  const [withRows, setWithRows] = useState<WithRow[]>([]);
  const [withoutRows, setWithoutRows] = useState<WithoutRow[]>([]);
  const [c2cRows, setC2cRows] = useState<C2cRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/clm/regulatory-defense');
        if (!alive) return;
        const d = res.data?.data ?? {};
        setWithRows((d.with_shipment ?? []).map((r: any): WithRow => ({
          rdf: r.rdf, ship: r.ship ?? '—', opp: r.opp ?? '—',
          customer: r.customer ?? '—', consignee: r.consignee ?? '—', pi: r.pi ?? '—',
          procs: Array.isArray(r.procs) ? r.procs.map((p: any): ProcLine => ({
            proc: p.proc ?? '—', po: p.po ?? '—',
            suppliers: Array.isArray(p.suppliers) ? p.suppliers.map((s: any): Supplier => ({ name: s.name ?? '—', code: s.code ?? '', id: Number(s.id) || 0 })) : [],
          })) : [],
          vault: Array.isArray(r.vault) ? r.vault : [],
        })));
        setWithoutRows((d.without_shipment ?? []).map((r: any): WithoutRow => ({
          rdf: r.rdf, proc: r.proc ?? '—', supplier: r.supplier ?? '—', po: r.po ?? '—', vti: r.vti ?? '—',
          kyc: frac(r.kyc), dd: frac(r.dd), tl: frac(r.tl), td: frac(r.td), agr: frac(r.agr),
          vault: Array.isArray(r.vault) ? r.vault : [],
        })));
        setC2cRows((d.case_to_case ?? []).map((r: any): C2cRow => ({
          rdf: r.rdf, ctc: r.ctc ?? '—', title: r.title ?? '—', counterparty: r.counterparty ?? '—',
          role: (['Buyer', 'Supplier', 'Partner'].includes(r.role) ? r.role : 'Partner') as C2cRow['role'],
          vault: Array.isArray(r.vault) ? r.vault : [],
        })));
      } catch {
        if (alive) toast.error('Load failed', 'Could not load Regulatory Defense File data.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [toast]);

  const placeholder = tab === 'with'
    ? 'Search by RDF, Shipment, Customer, Supplier, PI/PO…'
    : tab === 'without'
      ? 'Search by RDF, Procurement, Supplier, PO/VTI…'
      : 'Search by RDF, CTC, Agreement, Counterparty…';

  const q = search.trim().toLowerCase();
  const withF = useMemo(() => withRows.filter((r) => {
    if (!q) return true;
    const sup = r.procs.flatMap((p) => [p.proc, ...p.suppliers.map((s) => `${s.name} ${s.code}`)]).join(' ');
    return `${r.rdf} ${r.ship} ${r.opp} ${r.customer} ${r.consignee} ${r.pi} ${sup}`.toLowerCase().includes(q);
  }), [q, withRows]);
  const withoutF = useMemo(() => withoutRows.filter((r) => !q || `${r.rdf} ${r.proc} ${r.supplier} ${r.po} ${r.vti}`.toLowerCase().includes(q)), [q, withoutRows]);
  const c2cF = useMemo(() => c2cRows.filter((r) => !q || `${r.rdf} ${r.ctc} ${r.title} ${r.counterparty}`.toLowerCase().includes(q)), [q, c2cRows]);

  const rows = tab === 'with' ? withF : tab === 'without' ? withoutF : c2cF;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const switchTab = (t: RdfTab) => { setTab(t); setPage(1); setSearch(''); };

  const sectionTitle = tab === 'with' ? 'With Shipment ID — Regulatory Defense Files' : tab === 'without' ? 'Without Shipment ID — Regulatory Defense Files' : 'Case to Case — Regulatory Defense Files';
  const sectionSub = tab === 'with' ? 'Shipment-linked RDF records mapped across buyer, consignee & supplier.' : tab === 'without' ? 'Procurement-wise RDF records mapped to suppliers & compliance progress.' : 'Per-deal agreement RDF records mapped to counterparties.';

  return (
    <div className="rdf-root">
      <style>{SCOPED_CSS}</style>

      <div className="rdf-head">
        <span className="rdf-head-accent" />
        <div className="rdf-head-left">
          <div className="rdf-head-ico">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
            <i className="rdf-head-dot" />
          </div>
          <div>
            <h1 className="rdf-title">Regulatory Defense File</h1>
            <p className="rdf-sub">Regulatory defense files across With Shipment ID, Without Shipment ID, and Case to Case shipments.</p>
          </div>
        </div>
        <div className="rdf-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`rdf-tab ${tab === t.id ? 'active' : ''}`} onClick={() => switchTab(t.id)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">{t.icon}</svg>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rdf-card">
        <div className="rdf-card-hd">
          <div className="rdf-card-hd-ico">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          </div>
          <div className="rdf-card-hd-txt">
            <div className="rdf-card-title">{sectionTitle}</div>
            <div className="rdf-card-sub">{sectionSub}</div>
          </div>
          <div className="rdf-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0e7490" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input value={search} placeholder={placeholder} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <span className="rdf-rec-badge">{rows.length} RDF Records</span>
        </div>

        <div className="rdf-table-wrap">
          {tab === 'with' && (
            <table className="rdf-table">
              <thead><tr><th>Sr</th><th>RDF ID</th><th>Shipment ID</th><th>Opportunity ID</th><th>Procurement ID</th><th className="l">Customer</th><th className="l">Consignee</th><th className="l">Supplier</th><th>PI Number</th><th>PO Number</th><th>Action</th></tr></thead>
              <tbody>
                {(pageRows as WithRow[]).map((r, i) => (
                  <tr key={r.rdf + r.ship}>
                    <td style={{ verticalAlign: 'top' }}>{(safePage - 1) * pageSize + i + 1}</td>
                    <td style={{ verticalAlign: 'top' }}><span className="rdf-pill purple">{r.rdf}</span></td>
                    <td style={{ verticalAlign: 'top' }}><span className="rdf-pill cyan">{r.ship}</span></td>
                    <td style={{ verticalAlign: 'top' }}><span className="rdf-pill indigo">{r.opp}</span></td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="rdf-stack">
                        {r.procs.length ? r.procs.map((p, k) => <span key={k} className="rdf-sup-line"><span className="rdf-pill teal">{p.proc}</span></span>) : <span className="rdf-muted">—</span>}
                      </div>
                    </td>
                    <td className="l" style={{ verticalAlign: 'top' }}><Party name={r.customer} grad="#6366f1,#818cf8" /></td>
                    <td className="l" style={{ verticalAlign: 'top' }}><Party name={r.consignee} grad="#059669,#10b981" /></td>
                    <td className="l" style={{ verticalAlign: 'top' }}>
                      <div className="rdf-stack">
                        {r.procs.length ? r.procs.map((p, k) => (
                          <div key={k} className="rdf-sup-line">
                            {p.suppliers.length
                              ? p.suppliers.map((s) => <Party key={s.id} name={s.name} code={s.code} grad="#0891b2,#06b6d4" />)
                              : <span className="rdf-muted">—</span>}
                          </div>
                        )) : <span className="rdf-muted">—</span>}
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top' }}><span className="rdf-pill sky">{r.pi}</span></td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="rdf-stack">
                        {r.procs.length ? r.procs.map((p, k) => <span key={k} className="rdf-sup-line"><span className="rdf-pill orange">{p.po}</span></span>) : <span className="rdf-muted">—</span>}
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top' }}><VaultBtn onClick={() => setVault({ title: `${r.rdf} · ${r.ship}`, targets: r.vault })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'without' && (
            <table className="rdf-table">
              <thead><tr><th>Sr</th><th>RDF ID</th><th>Procurement ID</th><th className="l">Supplier</th><th>PO Number</th><th>VTI Number</th><th>KYC</th><th>Due Diligence</th><th>Trade Licenses</th><th>Trade Documents</th><th>Agreements</th><th>Action</th></tr></thead>
              <tbody>
                {(pageRows as WithoutRow[]).map((r, i) => (
                  <tr key={r.rdf + r.proc}>
                    <td>{(safePage - 1) * pageSize + i + 1}</td>
                    <td><span className="rdf-pill purple">{r.rdf}</span></td>
                    <td><span className="rdf-pill teal">{r.proc}</span></td>
                    <td className="l"><Party name={r.supplier} grad="#0891b2,#06b6d4" /></td>
                    <td><span className="rdf-pill orange">{r.po}</span></td>
                    <td><span className="rdf-pill indigo">{r.vti}</span></td>
                    <td><ProgressCell f={r.kyc} /></td>
                    <td><ProgressCell f={r.dd} /></td>
                    <td><ProgressCell f={r.tl} /></td>
                    <td><ProgressCell f={r.td} /></td>
                    <td><ProgressCell f={r.agr} /></td>
                    <td><VaultBtn onClick={() => setVault({ title: `${r.rdf} · ${r.proc} · ${r.supplier}`, targets: r.vault })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'c2c' && (
            <table className="rdf-table">
              <thead><tr><th>Sr</th><th>RDF ID</th><th>CTC ID</th><th className="l">Agreement Title</th><th className="l">Counterparty</th><th>Referred as in Agreement</th><th>Action</th></tr></thead>
              <tbody>
                {(pageRows as C2cRow[]).map((r, i) => {
                  const rc = ROLE_CFG[r.role];
                  return (
                    <tr key={r.rdf}>
                      <td>{(safePage - 1) * pageSize + i + 1}</td>
                      <td><span className="rdf-pill purple">{r.rdf}</span></td>
                      <td><span className="rdf-pill teal">{r.ctc}</span></td>
                      <td className="l strong">{r.title}</td>
                      <td className="l">
                        <span className="rdf-party">
                          <span className="rdf-ava" style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)' }}>{initials(r.counterparty)}</span>
                          {r.counterparty}
                          <span className="rdf-role" style={{ color: rc.color, background: rc.bg, border: `1px solid ${rc.border}` }}>{r.role}</span>
                        </span>
                      </td>
                      <td><span className="rdf-referred">{referredAs(r.role)}</span></td>
                      <td><VaultBtn onClick={() => setVault({ title: `${r.rdf} · ${r.ctc} · ${r.title}`, targets: r.vault })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {pageRows.length === 0 && <div className="rdf-empty">{loading ? 'Loading…' : 'No RDF records match your search.'}</div>}
        </div>

        <WorklistPager
          total={rows.length}
          page={safePage}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>

      {vault && <VaultDrawer title={vault.title} targets={vault.targets} onClose={() => setVault(null)} />}
    </div>
  );
}

function Party({ name, grad, code }: { name: string; grad: string; code?: string }) {
  return (
    <span className="rdf-party" title={code ? `${name} (${code})` : name}>
      <span className="rdf-ava" style={{ background: `linear-gradient(135deg,${grad})` }}>{initials(name)}</span>
      <span className="rdf-party-col">
        <span className="rdf-party-name">{name}</span>
        {code && <span className="rdf-party-code">{code}</span>}
      </span>
    </span>
  );
}

const SCOPED_CSS = `
.rdf-root { font-family:'DM Sans',system-ui,sans-serif; background:#f8fafc; padding:14px 18px 26px; margin:-1rem -0.75rem; min-height:calc(100vh - 70px); color:#0f172a; display:flex; flex-direction:column; gap:13px; }
.rdf-root *,.rdf-root *::before,.rdf-root *::after { box-sizing:border-box; }

.rdf-head { position:relative; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:10px 18px; border-radius:13px; overflow:hidden; background:linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%); border:1px solid rgba(6,182,212,.2); box-shadow:0 2px 12px rgba(8,145,178,.08); }
.rdf-head-accent { position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(180deg,#22d3ee,#0891b2,#0e7490); }
.rdf-head-left { display:flex; align-items:center; gap:13px; }
.rdf-head-ico { position:relative; width:42px; height:42px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#06b6d4,#0891b2,#0e7490); box-shadow:0 0 0 3px rgba(6,182,212,.22),0 4px 12px rgba(8,145,178,.4); }
.rdf-head-dot { position:absolute; right:-3px; bottom:-3px; width:11px; height:11px; border-radius:50%; background:linear-gradient(135deg,#4ade80,#22c55e); border:2px solid #cef8ff; }
.rdf-title { font-size:16px; font-weight:800; color:#0c4a6e; letter-spacing:-.4px; margin:0; line-height:1.15; }
.rdf-sub { font-size:11px; font-weight:500; color:#0e7490; opacity:.9; margin:3px 0 0; }
.rdf-tabs { display:flex; gap:3px; padding:3px; background:rgba(255,255,255,.6); border:1.5px solid rgba(6,182,212,.25); border-radius:11px; }
.rdf-tab { display:inline-flex; align-items:center; gap:7px; padding:0 14px; height:40px; border:none; border-radius:9px; background:transparent; color:#0e7490; font-family:inherit; font-size:11.5px; font-weight:700; cursor:pointer; transition:all .15s; }
.rdf-tab:hover { background:rgba(6,182,212,.1); color:#0c4a6e; }
.rdf-tab.active { background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%); color:#fff; box-shadow:0 3px 12px rgba(6,182,212,.4); }

.rdf-card { background:#fff; border:1.5px solid #a5f3fc; border-radius:14px; overflow:hidden; box-shadow:0 4px 20px rgba(8,145,178,.1),0 1px 4px rgba(0,0,0,.04); }
.rdf-card-hd { display:flex; align-items:center; gap:12px; padding:13px 18px; background:linear-gradient(110deg,#f0fdff,#e8fbfd); border-bottom:1px solid #a5f3fc; flex-wrap:wrap; }
.rdf-card-hd-ico { width:30px; height:30px; border-radius:9px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#06b6d4,#0891b2,#0e7490); }
.rdf-card-hd-txt { margin-right:auto; }
.rdf-card-title { font-size:13px; font-weight:800; color:#0c4a6e; letter-spacing:-.2px; }
.rdf-card-sub { font-size:10px; color:#0e7490; opacity:.85; margin-top:1px; }
.rdf-search { position:relative; display:flex; align-items:center; width:380px; max-width:46%; }
.rdf-search svg { position:absolute; left:12px; }
.rdf-search input { width:100%; padding:8px 12px 8px 34px; border:1.5px solid rgba(6,182,212,.3); border-radius:9px; font-family:inherit; font-size:12px; color:#0c4a6e; background:#fff; outline:none; }
.rdf-search input:focus { border-color:#0891b2; box-shadow:0 0 0 3.5px rgba(8,145,178,.14); }
.rdf-rec-badge { font-size:10px; font-weight:700; color:#0e7490; background:rgba(6,182,212,.12); border:1px solid rgba(6,182,212,.28); border-radius:20px; padding:5px 12px; white-space:nowrap; }

/* Recolor the shared WorklistPager to the cyan table-head palette (scoped to
   this page so the global violet pager used elsewhere is untouched). */
.rdf-card .wl-pager { background:linear-gradient(90deg,#f0fdff 0%,#e8fbfd 40%,#f0fdff 100%); border-top:2px solid #a5f3fc; }
.rdf-card .tc-wl-info, .rdf-card .tc-wl-rows, .rdf-card .tc-wl-btn { color:#0e7490; border-color:#a5f3fc; background:rgba(255,255,255,.85); }
.rdf-card .tc-wl-info .tc-wl-hl { color:#0891b2; }
.rdf-card .tc-wl-rows select { color:#0891b2; }
.rdf-card .tc-wl-range { background:linear-gradient(135deg,#22d3ee 0%,#0891b2 55%,#0e7490 100%); box-shadow:0 3px 12px rgba(8,145,178,.4),0 1px 0 rgba(255,255,255,.2) inset; }
.rdf-card .tc-wl-btn:hover:not(:disabled) { background:#fff; border-color:#0891b2; box-shadow:0 4px 12px rgba(8,145,178,.25); }

.rdf-table-wrap { overflow-x:auto; scrollbar-width:thin; scrollbar-color:#a5f3fc transparent; }
.rdf-table-wrap::-webkit-scrollbar { width:9px; height:9px; }
.rdf-table-wrap::-webkit-scrollbar-track { background:transparent; }
.rdf-table-wrap::-webkit-scrollbar-thumb { background:#a5f3fc; border-radius:8px; border:2px solid transparent; background-clip:content-box; }
.rdf-table-wrap::-webkit-scrollbar-thumb:hover { background:#67e8f9; background-clip:content-box; }
.rdf-table { width:100%; border-collapse:collapse; min-width:920px; }
.rdf-table thead tr { background:linear-gradient(90deg,#155e75 0%,#0e7490 25%,#0891b2 55%,#06b6d4 80%,#22d3ee 100%); box-shadow:0 2px 10px rgba(8,145,178,.3); }
.rdf-table th { padding:10px 8px; font-size:8px; font-weight:700; letter-spacing:.07em; color:#fff; text-transform:uppercase; white-space:nowrap; text-align:center; text-shadow:0 1px 3px rgba(0,0,0,.2); border-bottom:none; }
.rdf-table th.l { text-align:left; }
.rdf-table td { padding:8px; font-size:11px; text-align:center; border-bottom:1px solid #ecfeff; white-space:nowrap; }
.rdf-table td.l { text-align:left; }
.rdf-table td.strong { font-weight:700; color:#0f172a; }
.rdf-table tbody tr { transition:background .12s; }
.rdf-table tbody tr:nth-child(even) { background:#f7fffe; }
.rdf-table tbody tr:last-child td { border-bottom:none; }
.rdf-table tbody tr:hover { background:#ecfeff; }

.rdf-pill { display:inline-flex; align-items:center; padding:2px 9px; border-radius:6px; font-size:9.5px; font-weight:700; font-family:ui-monospace,monospace; white-space:nowrap; }
.rdf-pill.purple { color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; }
.rdf-pill.cyan   { color:#0891b2; background:#ecfeff; border:1px solid #a5f3fc; }
.rdf-pill.indigo { color:#4f46e5; background:#eef0ff; border:1px solid #c7d2fe; }
.rdf-pill.teal   { color:#0d9488; background:#f0fdfa; border:1px solid #99f6e4; }
.rdf-pill.sky    { color:#0369a1; background:#eff6ff; border:1px solid #bfdbfe; }
.rdf-pill.orange { color:#9a3412; background:#fff7ed; border:1px solid #fed7aa; }
.rdf-party { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:700; color:#0f172a; max-width:200px; }
.rdf-party-col { display:flex; flex-direction:column; min-width:0; line-height:1.2; }
.rdf-party-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rdf-party-code { font-size:8.5px; font-weight:700; color:#0e7490; font-family:ui-monospace,monospace; }
.rdf-ava { width:26px; height:26px; border-radius:7px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:800; color:#fff; }
.rdf-stack { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
.rdf-sup-line { display:flex; flex-wrap:wrap; gap:6px; min-height:26px; align-items:center; }
.rdf-muted { color:#94a3b8; }
.rdf-role { padding:2px 8px; border-radius:20px; font-size:8.5px; font-weight:800; text-transform:uppercase; letter-spacing:.02em; }
.rdf-referred { display:inline-block; padding:3px 10px; border-radius:20px; font-size:9.5px; font-weight:700; color:#0369a1; background:#eff6ff; border:1.5px solid #bfdbfe; }
.rdf-prog { display:flex; flex-direction:column; align-items:center; line-height:1.2; }
.rdf-vault-btn { display:inline-flex; align-items:center; gap:5px; padding:7px 13px; border:none; border-radius:9px; font-family:inherit; font-size:10px; font-weight:700; color:#fff; cursor:pointer; white-space:nowrap; background:linear-gradient(135deg,#22d3ee,#06b6d4 55%,#0891b2); }
.rdf-vault-btn:hover { transform:translateY(-1px); box-shadow:0 5px 16px rgba(6,182,212,.5); }

.rdf-empty { padding:28px; text-align:center; color:#64748b; font-size:12px; }

/* Evidence Vault drawer */
.rdf-overlay { position:fixed; inset:0; z-index:100001; height:100vh; background:rgba(15,23,42,.5); display:flex; justify-content:flex-end; }
.rdf-drawer { width:100%; max-width:920px; height:100vh; max-height:100vh; overflow:hidden; background:linear-gradient(180deg,#f0f9ff,#f8fafc); display:flex; flex-direction:column; box-shadow:-20px 0 60px rgba(8,145,178,.25); }
.rdf-drawer-head, .rdf-drawer-toolbar { flex-shrink:0; }
.rdf-drawer-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 22px; color:#fff; background:linear-gradient(125deg,#0c4a6e,#0e7490 55%,#0891b2); }
.rdf-drawer-eyebrow { font-size:8.5px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; color:#7dd3fc; }
.rdf-drawer-title { font-size:16px; font-weight:800; margin-top:2px; }
.rdf-drawer-x { width:30px; height:30px; border-radius:50%; border:none; background:rgba(255,255,255,.2); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.rdf-drawer-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 22px; background:#fff; border-bottom:1px solid #a5f3fc; flex-wrap:wrap; }
.rdf-readonly { font-size:11px; font-weight:700; color:#0e7490; background:#ecfeff; border:1px solid #a5f3fc; border-radius:20px; padding:5px 12px; }
.rdf-toolbar-right { display:flex; align-items:center; gap:10px; }
.rdf-view-toggle { display:flex; gap:3px; padding:3px; background:#ecfeff; border:1px solid #a5f3fc; border-radius:10px; }
.rdf-view-toggle button { display:inline-flex; align-items:center; gap:5px; padding:6px 11px; border:none; border-radius:7px; background:transparent; color:#0891b2; font-family:inherit; font-size:11px; font-weight:700; cursor:pointer; }
.rdf-view-toggle button.on { background:linear-gradient(135deg,#06b6d4,#0891b2); color:#fff; box-shadow:0 2px 8px rgba(8,145,178,.3); }
.rdf-zip-btn { display:inline-flex; align-items:center; gap:7px; padding:9px 16px; border:none; border-radius:11px; font-family:inherit; font-size:11px; font-weight:800; color:#fff; cursor:pointer; background:linear-gradient(135deg,#0ea5e9,#06b6d4 50%,#0891b2); box-shadow:0 6px 18px rgba(8,145,178,.42); }
.rdf-zip-btn:hover { transform:translateY(-1.5px); }
.rdf-drawer-body { flex:1; min-height:0; overflow-y:auto; padding:14px 18px 24px; display:flex; flex-direction:column; gap:12px; }
.rdf-vault-empty { margin:auto; padding:40px; text-align:center; font-size:13px; font-weight:600; color:#0e7490; }
.rdf-drawer-body::-webkit-scrollbar { width:10px; }
.rdf-drawer-body::-webkit-scrollbar-thumb { background:#7dd3fc; border-radius:6px; border:2px solid transparent; background-clip:padding-box; }
.rdf-drawer-body::-webkit-scrollbar-thumb:hover { background:#0891b2; background-clip:padding-box; }
.rdf-drawer-body::-webkit-scrollbar-track { background:transparent; }

.rdf-sec { position:relative; flex:0 0 auto; border:1px solid #d6eef5; border-radius:14px; overflow:hidden; background:#fff; box-shadow:0 1px 3px rgba(8,145,178,.05),0 8px 24px rgba(6,182,212,.06); }
.rdf-sec-accent { position:absolute; left:0; top:0; bottom:0; width:4px; background:linear-gradient(180deg,#67e8f9,#0891b2,#0e7490); z-index:2; }
.rdf-sec-hd { display:flex; align-items:center; gap:11px; padding:9px 16px 9px 18px; background:linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%); border-bottom:1px solid #a5f3fc; }
.rdf-sec-ico { width:36px; height:36px; border-radius:11px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%); }
.rdf-sec-name { font-size:12px; font-weight:800; color:#0c4a6e; letter-spacing:-.2px; }
.rdf-sec-sub { font-size:8px; font-weight:700; color:#0e7490; text-transform:uppercase; letter-spacing:.09em; margin-top:3px; }
.rdf-sec-count { margin-left:auto; font-size:9px; font-weight:800; color:#0e7490; background:rgba(6,182,212,.1); border:1px solid #a5f3fc; border-radius:20px; padding:3.5px 12px; }

.rdf-grid { display:grid; grid-template-columns:repeat(4,1fr); padding:5px; background:linear-gradient(180deg,#f0f9ff,#f8fafc); }
@media (max-width:1280px){ .rdf-grid { grid-template-columns:repeat(3,1fr); } }
@media (max-width:980px){ .rdf-grid { grid-template-columns:repeat(2,1fr); } }
.rdf-file { position:relative; display:flex; flex-direction:column; gap:9px; padding:11px; margin:6px; background:#fff; border:1.5px solid #e4eff5; border-radius:11px; box-shadow:0 1px 4px rgba(15,23,42,.04); transition:all .16s; }
.rdf-file:hover { border-color:#67e8f9; box-shadow:0 6px 18px rgba(6,182,212,.14); transform:translateY(-2px); }
.rdf-file-top-bar { position:absolute; top:0; left:0; right:0; height:3px; border-radius:11px 11px 0 0; background:linear-gradient(90deg,#06b6d4,#0891b2); }
.rdf-file-top { display:flex; align-items:center; gap:9px; }
.rdf-file-ico { position:relative; width:32px; height:32px; border-radius:9px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:linear-gradient(150deg,#fff5f5,#ffe4e4 55%,#ffd9d9); color:#ef4444; }
.rdf-pdf { position:absolute; bottom:-5px; left:50%; transform:translateX(-50%); font-size:5px; font-weight:900; font-style:normal; color:#fff; background:linear-gradient(135deg,#f43f5e,#dc2626); padding:1.5px 3.5px; border-radius:4px; }
.rdf-file-body { min-width:0; flex:1; }
.rdf-file-name { font-size:11px; font-weight:800; color:#0f172a; letter-spacing:-.2px; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rdf-file-meta { display:inline-flex; align-items:center; gap:5px; font-size:7px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; margin-top:5px; color:#059669; background:linear-gradient(135deg,#ecfdf5,#d1fae5); border:1px solid #a7f3d0; padding:2px 7px 2px 5px; border-radius:20px; }
.rdf-dot { width:4px; height:4px; border-radius:50%; background:#10b981; box-shadow:0 0 0 2px rgba(16,185,129,.22); }
.rdf-file-acts { display:flex; align-items:center; gap:6px; }
.rdf-act { width:27px; height:27px; border-radius:8px; border:1px solid; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all .16s; background:#fff; }
.rdf-act.view { color:#0891b2; background:linear-gradient(135deg,#f0fdff,#e0f9ff); border-color:#bdf1fb; }
.rdf-act.view:hover { background:linear-gradient(135deg,#06b6d4,#0891b2); color:#fff; border-color:#0891b2; transform:translateY(-1px); }
.rdf-act.dl { color:#0e7490; background:linear-gradient(135deg,#ecfeff,#cffafe); border-color:#a5f3fc; }
.rdf-act.dl:hover { background:linear-gradient(135deg,#0891b2,#0e7490); color:#fff; border-color:#0e7490; transform:translateY(-1px); }

.rdf-list { display:flex; flex-direction:column; gap:7px; padding:10px 12px; background:linear-gradient(180deg,#f0f9ff,#f8fafc); }
.rdf-row { display:flex; align-items:center; gap:11px; padding:8px 11px; background:#fff; border:1.5px solid #e4eff5; border-radius:10px; box-shadow:0 1px 3px rgba(15,23,42,.04); transition:all .16s; }
.rdf-row:hover { border-color:#67e8f9; box-shadow:0 4px 14px rgba(6,182,212,.13); transform:translateX(2px); }
.rdf-row-ico { position:relative; width:28px; height:28px; border-radius:8px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:linear-gradient(150deg,#fff5f5,#ffe4e4 55%,#ffd9d9); color:#ef4444; }
.rdf-row-name { flex:1; min-width:0; font-size:11px; font-weight:800; color:#0f172a; letter-spacing:-.2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rdf-row-status { flex-shrink:0; display:inline-flex; align-items:center; gap:4px; font-size:7px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:#059669; background:linear-gradient(135deg,#ecfdf5,#d1fae5); border:1px solid #a7f3d0; padding:2px 8px 2px 6px; border-radius:20px; }

/* ── dark mode (page surfaces; vibrant gradient header + Evidence Vault
      slide-over stay as designed — they read fine on either background) ──── */
[data-bs-theme="dark"] .rdf-root { background:#0f0b1a; color:#e2e8f0; }
[data-bs-theme="dark"] .rdf-head { background:linear-gradient(110deg,#0c2231 0%,#0e2e3c 45%,#0a2028 100%); border-color:rgba(6,182,212,.28); box-shadow:none; }
[data-bs-theme="dark"] .rdf-title { color:#e0f9fd; }
[data-bs-theme="dark"] .rdf-sub { color:#67e8f9; }
[data-bs-theme="dark"] .rdf-head-dot { border-color:#0c2231; }
[data-bs-theme="dark"] .rdf-tabs { background:rgba(255,255,255,.06); border-color:rgba(6,182,212,.3); }
[data-bs-theme="dark"] .rdf-tab { color:#7dd3fc; }
[data-bs-theme="dark"] .rdf-tab:hover { background:rgba(6,182,212,.15); color:#e0f9fd; }
[data-bs-theme="dark"] .rdf-card { background:#161226; border-color:rgba(148,163,184,.18); box-shadow:none; }
[data-bs-theme="dark"] .rdf-card-hd { background:rgba(255,255,255,.03); border-bottom-color:rgba(148,163,184,.18); }
[data-bs-theme="dark"] .rdf-card-title { color:#7dd3fc; }
[data-bs-theme="dark"] .rdf-card-sub { color:#94a3b8; }
[data-bs-theme="dark"] .rdf-search input { background:rgba(255,255,255,.05); border-color:rgba(148,163,184,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .rdf-rec-badge { color:#67e8f9; background:rgba(6,182,212,.14); border-color:rgba(6,182,212,.3); }
[data-bs-theme="dark"] .rdf-card .wl-pager { background:linear-gradient(90deg,rgba(6,182,212,.08),rgba(6,182,212,.14),rgba(6,182,212,.08)); border-top-color:rgba(6,182,212,.3); }
[data-bs-theme="dark"] .rdf-card .tc-wl-info, [data-bs-theme="dark"] .rdf-card .tc-wl-rows, [data-bs-theme="dark"] .rdf-card .tc-wl-btn { background:rgba(255,255,255,.06); border-color:rgba(6,182,212,.3); color:#67e8f9; }
[data-bs-theme="dark"] .rdf-card .tc-wl-info .tc-wl-hl, [data-bs-theme="dark"] .rdf-card .tc-wl-rows select { color:#a5f3fc; }
[data-bs-theme="dark"] .rdf-table thead tr { background:linear-gradient(90deg,#0c3a4a,#0e5066 30%,#0891b2 70%,#06b6d4); box-shadow:0 2px 10px rgba(0,0,0,.3); }
[data-bs-theme="dark"] .rdf-table th { color:#fff; }
[data-bs-theme="dark"] .rdf-table td { color:#cbd5e1; border-bottom-color:rgba(148,163,184,.12); }
[data-bs-theme="dark"] .rdf-table td.strong { color:#f1f5f9; }
[data-bs-theme="dark"] .rdf-table tbody tr:nth-child(even) { background:rgba(255,255,255,.03); }
[data-bs-theme="dark"] .rdf-table tbody tr:hover { background:rgba(6,182,212,.1); }
[data-bs-theme="dark"] .rdf-pill.purple { background:rgba(124,58,237,.18); border-color:rgba(124,58,237,.42); color:#c4b5fd; }
[data-bs-theme="dark"] .rdf-pill.cyan   { background:rgba(6,182,212,.16); border-color:rgba(6,182,212,.4); color:#67e8f9; }
[data-bs-theme="dark"] .rdf-pill.indigo { background:rgba(79,70,229,.18); border-color:rgba(79,70,229,.42); color:#a5b4fc; }
[data-bs-theme="dark"] .rdf-pill.teal   { background:rgba(13,148,136,.16); border-color:rgba(13,148,136,.4); color:#5eead4; }
[data-bs-theme="dark"] .rdf-pill.sky    { background:rgba(3,105,161,.2); border-color:rgba(56,189,248,.4); color:#7dd3fc; }
[data-bs-theme="dark"] .rdf-pill.orange { background:rgba(154,52,18,.22); border-color:rgba(251,146,60,.4); color:#fdba74; }
[data-bs-theme="dark"] .rdf-party { color:#e2e8f0; }
[data-bs-theme="dark"] .rdf-party-code { color:#67e8f9; }
[data-bs-theme="dark"] .rdf-referred { background:rgba(3,105,161,.2); border-color:rgba(56,189,248,.4); color:#7dd3fc; }
[data-bs-theme="dark"] .rdf-empty { color:#94a3b8; }
`;
