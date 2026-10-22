import { useCallback, useEffect, useMemo, useState } from 'react';
import { SegmentNameBadge } from '../../../../components/ui/SegmentBadge';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { truncSegment } from '../../../../utils/segmentLabel';
import AddConsigneeModal, { type ConsigneeRow } from '../consignee/AddConsigneeModal';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { useTheme } from '../../../../contexts/ThemeContext';
import SearchClear from '../../../../components/ui/SearchClear';


export interface CustomerLite {
  id: string;
  db_id: number;
  company: string;
  country?: string;
}

interface Props {
  open: boolean;
  customer: CustomerLite | null;
  onClose: () => void;
  title?: string;
}

const ROWS_PER_PAGE = 5;

export default function CustomerConsigneesModal({ open, customer, onClose, title = 'Consignees' }: Props) {
  const toast = useToast();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const pk = {
    card:          isDark ? '#0f1420' : '#ffffff',
    text:          isDark ? '#e2e8f0' : '#334155',
    textMuted:     isDark ? '#94a3b8' : '#6b7280',
    border:        isDark ? 'rgba(148,163,184,.20)' : '#e5e7eb',
    choiceBg:      isDark ? 'rgba(13,148,136,.14)' : '#f0fdfa',
    choiceBorder:  isDark ? 'rgba(13,148,136,.35)' : '#ccfbf1',
    btnBg:         isDark ? '#1b2233' : '#ffffff',
    label:         isDark ? '#cbd5e1' : '#334155',
  };
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ConsigneeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ConsigneeRow | null>(null);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [allConsignees, setAllConsignees] = useState<any[]>([]);
  const [mapSelectId, setMapSelectId] = useState('');
  const [mapping, setMapping] = useState(false);
  const [page, setPage] = useState(1);
  const [segOpen, setSegOpen] = useState<{ id: string | number; names: string[]; x: number; y: number } | null>(null);

  const fetchRows = useCallback(async () => {
    if (!customer?.db_id) return;
    setLoading(true);
    try {
      const r = await api.get('/consignees', { params: { customer_id: customer.db_id } });
      const data: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
      setRows(data.map((d: any): ConsigneeRow => ({
        id:             String(d.id ?? ''),
        db_id:          typeof d.db_id === 'number' ? d.db_id : undefined,
        customerId:     String(d.customer_code ?? d.customer_id ?? ''),
        customer_db_id: typeof d.customer_id === 'number' ? d.customer_id : undefined,
        company:        d.company ?? '',
        segment:        d.segment ?? '',
        risk:           d.riskLevel ?? 'Low',
        contact:        d.contact ?? '',
        email:          d.email ?? '',
        phone:          d.phone ?? '',
        country:        d.country ?? '',
        countryDetail:  d.city ?? '',
        same_as_customer: !!d.same_as_customer,
      })));
    } catch (e: any) {
      toast.error('Failed to load consignees', e?.response?.data?.message ?? 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [customer?.db_id]);

  useEffect(() => {
    if (open) fetchRows();
    else { setQ(''); setRows([]); setChooseOpen(false); setMapOpen(false); }
  }, [open, fetchRows]);
  const custDomestic = (customer?.country ?? '').trim() === 'India';
  const mappableConsignees = useMemo(
    () => allConsignees.filter(c =>
      !c.same_as_customer
      && !rows.some(r => r.db_id === c.db_id)
      && (((c.country ?? '').trim() === 'India') === custDomestic)
    ),
    [allConsignees, rows, custDomestic],
  );

  const openMapFlow = async () => {
    setChooseOpen(false);
    setMapSelectId('');
    setMapOpen(true);
    try {
      const r = await api.get('/consignees');
      setAllConsignees(Array.isArray(r.data?.data) ? r.data.data : []);
    } catch { setAllConsignees([]); }
  };

  const doMap = async () => {
    if (!mapSelectId || !customer?.db_id) return;
    setMapping(true);
    try {
      await api.post(`/consignees/${mapSelectId}/map-customer`, { customer_id: customer.db_id });
      toast.success('Consignee mapped', 'The consignee is now linked to this customer.');
      setMapOpen(false);
      fetchRows();
    } catch (e: any) {
      toast.error('Map failed', e?.response?.data?.message ?? 'Please try again.');
    } finally { setMapping(false); }
  };

  const filtered = useMemo(() => {
    if (!q) return rows;
    const lo = q.toLowerCase();
    return rows.filter(c =>
      c.company.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.contact.toLowerCase().includes(lo) ||
      c.email.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo) ||
      c.country.toLowerCase().includes(lo) ||
      String(c.risk).toLowerCase().includes(lo),
    );
  }, [q, rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  useEffect(() => { setPage(1); }, [q, rows]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageRows = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  if (!open || !customer) return null;

  return createPortal(
    <>
      <div className="ccm-overlay" onMouseDown={onClose}>
        <style>{SCOPED_CSS}</style>
        <div className="ccm-card" onMouseDown={e => e.stopPropagation()}>
          <div className="ccm-header">
            <div className="ccm-header-left">
              <div className="ccm-header-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="ccm-header-text">
                <div className="ccm-title">{title}</div>
                <div className="ccm-sub">Manage consignee identity, shipment delivery ownership, compliance readiness &amp; customer-linked destination mapping</div>
              </div>
            </div>
            <div className="ccm-header-right">
             
              <div className="ccm-link-chip">
                <span className="ccm-link-chip-lbl">Consignees for</span>
                <div className="ccm-link-chip-row">
                  <span className="ccm-link-chip-code">{customer.id}</span>
                  <span className="ccm-link-chip-name" title={customer.company}>{customer.company}</span>
                  {customer.country && <span className="ccm-link-chip-country">{customer.country}</span>}
                </div>
              </div>
              <button type="button" className="ccm-close" onClick={onClose} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div className="ccm-toolbar">
            <div className="ccm-search ui-search-abs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                type="search"
                autoComplete="off"
                placeholder="Search consignees…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              <SearchClear show={q} onClear={() => { setQ(''); }} />
            </div>
            <div className="ccm-toolbar-right">
              <span className="ccm-count">{filtered.length} {filtered.length === 1 ? 'consignee' : 'consignees'}</span>
              <button
                type="button"
                className="ccm-add-btn"
                onClick={() => setChooseOpen(true)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Or Map Consignee
              </button>
            </div>
          </div>

          <div className="ccm-body">
            <div className="ccm-tablecard">
            <div className="ccm-table-wrap">
              <table className="ccm-table">
                <thead>
                  <tr>
                    <th>SR NO</th>
                    <th>CONSIGNEE ID</th>
                    <th>COMPANY NAME</th>
                    <th>SEGMENT</th>
                    <th>RISK LEVEL</th>
                    <th>SAME AS CUSTOMER</th>
                    <th>CONTACT PERSON</th>
                    <th>EMAIL</th>
                    <th>CONTACT NO</th>
                    <th>LOCATION</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, r) => (
                      <tr key={`skel-${r}`} className="ccm-skel-row">
                        {Array.from({ length: 11 }).map((__, c) => (
                          <td key={c}>
                            <span className={`ccm-skel ${c === 2 ? 'ccm-skel-lg' : c === 0 ? 'ccm-skel-xs' : 'ccm-skel-md'}`} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr className="ccm-empty">
                      <td colSpan={11}>
                        {q ? 'No consignees match your search.' : <>No consignees mapped to <strong>{customer.id}</strong> yet. Click <strong>+ Add Consignee</strong> to create the first one.</>}
                      </td>
                    </tr>
                  ) : pageRows.map((c, i) => {
                    const riskColor = String(c.risk).toLowerCase() === 'high'
                      ? 'ccm-pill-high'
                      : String(c.risk).toLowerCase() === 'medium'
                        ? 'ccm-pill-med'
                        : 'ccm-pill-low';
                    const location = [c.countryDetail, c.country].filter(Boolean).join(', ') || '—';
                    return (
                      <tr key={c.id}>
                        <td><span className="ccm-srno">{(page - 1) * ROWS_PER_PAGE + i + 1}</span></td>
                        <td><span className="ccm-id-chip">{c.id}</span></td>
                        <td className="ccm-company">{c.company || '—'}</td>
                        <td>
                          {(() => {
                            const segList = String(c.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
                            if (segList.length === 0) return '—';
                            const extra = segList.length - 1;
                            return (
                              <span className="d-inline-flex align-items-center" style={{ gap: 4 }}>
                                <Tooltip label={segList[0]} disabled={segList[0].length <= 14}><span className="ccm-seg" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{truncSegment(segList[0])}<SegmentNameBadge name={segList[0]} style={{ marginLeft: 0, flexShrink: 0 }} /></span></Tooltip>
                                {extra > 0 && (
                                  <Tooltip label={`View ${extra} more`}>
                                    <button
                                      type="button"
                                      className="ccm-seg-more"
                                      onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegOpen(prev => prev?.id === c.id ? null : { id: c.id, names: segList, x: b.left, y: b.bottom + 4 }); }}
                                    >+{extra}</button>
                                  </Tooltip>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td><span className={`ccm-pill ${riskColor}`}>{c.risk || '—'}</span></td>
                        <td><span className={`ccm-sac ${c.same_as_customer ? 'is-yes' : 'is-no'}`}>{c.same_as_customer ? 'Yes' : 'No'}</span></td>
                        <td>{c.contact || '—'}</td>
                        <td className="ccm-email">{c.email || '—'}</td>
                        <td className="ccm-mono">{c.phone || '—'}</td>
                        <td>{location}</td>
                        <td>
                          <div className="ccm-row-actions">
                            <Tooltip label="Edit Consignee">
                              <button
                                type="button"
                                className="ccm-row-btn"
                                aria-label="Edit"
                                onClick={() => { setEditing(c); setAddOpen(true); }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <div className="ccm-pag">
                <WorklistPager
                  total={filtered.length}
                  page={page}
                  pageSize={ROWS_PER_PAGE}
                  onPage={setPage}
                />
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      <AddConsigneeModal
        open={addOpen}
        consignee={editing}
        preselectedCustomerId={customer.id}
        existingMirrorCount={rows.filter(r => r.same_as_customer).length}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSaved={() => fetchRows()}
      />

      {chooseOpen && createPortal(
        <div onMouseDown={() => setChooseOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1096, background: 'rgba(46,16,101,.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: pk.card, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
            <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg,#0e9f86,#14b8a6)', color: '#fff' }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Add or Map Consignee</div>
              <div style={{ fontSize: 12.5, opacity: .9, marginTop: 2 }}>Create a brand-new consignee, or map an existing one to <strong>{customer.id}</strong>.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 18 }}>
              <button type="button" onClick={() => { setChooseOpen(false); setEditing(null); setAddOpen(true); }} style={{ textAlign: 'left', border: `1.5px solid ${pk.choiceBorder}`, borderRadius: 12, padding: 14, background: pk.choiceBg, cursor: 'pointer' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#0d9488,#0f766e)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(13,148,136,.35)' }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </div>
                <div style={{ fontWeight: 800, color: isDark ? '#5eead4' : '#0f766e', marginTop: 8 }}>Add New</div>
                <div style={{ fontSize: 11.5, color: pk.textMuted, marginTop: 2 }}>Create a new consignee under this customer.</div>
              </button>
              <button type="button" onClick={openMapFlow} style={{ textAlign: 'left', border: `1.5px solid ${pk.choiceBorder}`, borderRadius: 12, padding: 14, background: pk.choiceBg, cursor: 'pointer' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#0d9488,#0f766e)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(13,148,136,.35)' }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                </div>
                <div style={{ fontWeight: 800, color: isDark ? '#5eead4' : '#0f766e', marginTop: 8 }}>Map Existing</div>
                <div style={{ fontSize: 11.5, color: pk.textMuted, marginTop: 2 }}>Link an existing consignee to this customer.</div>
              </button>
            </div>
            <div style={{ padding: '0 18px 16px', textAlign: 'right' }}>
              <button type="button" onClick={() => setChooseOpen(false)} style={{ border: `1px solid ${pk.border}`, background: pk.btnBg, color: pk.text, borderRadius: 9, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {mapOpen && createPortal(
        <div onMouseDown={() => !mapping && setMapOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1096, background: 'rgba(46,16,101,.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: pk.card, borderRadius: 16, overflow: 'visible', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
            <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg,#0e9f86,#14b8a6)', color: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Map Existing Consignee</div>
              <div style={{ fontSize: 12.5, opacity: .92, marginTop: 2 }}>Link a consignee to <strong>{customer.company}</strong> ({customer.id}). Its segments update with this customer's.</div>
            </div>
            <div style={{ padding: 18 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: pk.label, textTransform: 'uppercase', letterSpacing: .4, display: 'block', marginBottom: 6 }}>Consignee</label>
              <MasterSelect
                value={mapSelectId}
                onChange={(v) => setMapSelectId(v)}
                placeholder="Select a consignee to map…"
                options={mappableConsignees.map(c => {
                  const country = (c.country ?? '').trim();
                  return {
                    value: String(c.db_id),
                    label: `${c.id} — ${c.company}`,
                    badge: country
                      ? (country === 'India'
                        ? { text: 'Domestic', tone: 'green' as const, title: 'India — domestic consignee' }
                        : { text: 'International', tone: 'violet' as const, title: `${country} — international consignee` })
                      : undefined,
                  };
                })}
              />
              {mappableConsignees.length === 0 && (
                <div style={{ fontSize: 12, color: pk.textMuted, marginTop: 8 }}>No other consignees available to map.</div>
              )}
            </div>
            <div style={{ padding: '0 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setMapOpen(false)} disabled={mapping} style={{ border: `1px solid ${pk.border}`, background: pk.btnBg, color: pk.text, borderRadius: 9, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={doMap} disabled={!mapSelectId || mapping} style={{ border: 'none', background: mapSelectId && !mapping ? 'linear-gradient(135deg,#0d9488,#065f46)' : (isDark ? 'rgba(13,148,136,.28)' : '#cdeee8'), color: mapSelectId && !mapping ? '#fff' : (isDark ? '#5eead4' : '#0f766e'), borderRadius: 9, padding: '8px 18px', fontWeight: 700, cursor: mapSelectId && !mapping ? 'pointer' : 'not-allowed' }}>{mapping ? 'Mapping…' : 'Map Consignee'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {segOpen && (() => {
        const ROWS_MAX_H = 108;
        const estH = Math.min(24 + ROWS_MAX_H + 16, 40 + segOpen.names.length * 34);
        const left = Math.max(8, Math.min(segOpen.x, window.innerWidth - 340));
        const top  = Math.max(8, Math.min(segOpen.y, window.innerHeight - estH - 8));
        return createPortal(
          <>
            <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1090 }} />
            <div className="ccm-seg-pop" style={{ position: 'fixed', left, top, zIndex: 1091, width: 320, borderRadius: 12, padding: 8 }}>
              <div className="ccm-seg-pop-title">Segments ({segOpen.names.length})</div>
              <div style={{ maxHeight: ROWS_MAX_H, overflowY: 'auto' }}>
                {segOpen.names.map((name, i) => (
                  <div key={i} className={`ccm-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                    <Tooltip label={name} disabled={name.length <= 14}>
                      <span className="ccm-seg">{truncSegment(name)}</span>
                    </Tooltip>
                    <SegmentNameBadge name={name} style={{ marginLeft: 'auto', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body,
        );
      })()}

    </>,
    document.body,
  );
}

const SCOPED_CSS = `
.ccm-overlay {
  position: fixed; inset: 0;
  background: rgba(46, 16, 101, .50);
  backdrop-filter: blur(6px);
  z-index: 1090;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  font-family: var(--font-sans);
}
.ccm-card {
  width: min(1460px, 97vw);
  max-height: calc(100vh - 48px);
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(46, 16, 101, .30);
}
.ccm-header {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: linear-gradient(135deg, #064e3b 0%, #047857 50%, #059669 100%);
  color: #fff;
  overflow: hidden;
}
.ccm-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse at 15% 50%, rgba(52,211,153,0.28) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 50%, rgba(139,92,246,0.18) 0%, transparent 55%);
}
.ccm-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1 1 auto; position: relative; z-index: 1; }
.ccm-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.18); color: #fff;
  border: 1.5px solid rgba(255,255,255,.30);
  flex-shrink: 0;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
}
.ccm-header-text { min-width: 0; }
.ccm-title { font-size: 17px; font-weight: 700; letter-spacing: -.2px; line-height: 1.2; }
.ccm-sub   { font-size: 12px; font-weight: 500; color: rgba(255,255,255,.80); margin-top: 3px; max-width: 520px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccm-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; position: relative; z-index: 1; }
.ccm-link-chip {
  display: inline-flex; flex-direction: row; align-items: center; gap: 10px;
  padding: 6px 10px 6px 14px;
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: 999px;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  color: #fff;
}
.ccm-link-chip-lbl  { font-weight: 700; letter-spacing: .08em; font-size: 9.5px; opacity: .80; text-transform: uppercase; white-space: nowrap; }
.ccm-link-chip-row  { display: inline-flex; align-items: center; gap: 7px; }
.ccm-link-chip-code,
.ccm-link-chip-name,
.ccm-link-chip-country {
  display: inline-flex; align-items: center;
  padding: 3px 11px; border-radius: 999px;
  background: rgba(255,255,255,.16);
  border: 1px solid rgba(255,255,255,.35);
  font-weight: 700; font-size: 11px; white-space: nowrap;
}
.ccm-link-chip-code { font-family: ui-monospace, 'JetBrains Mono', monospace; font-weight: 800; }
.ccm-link-chip-name { max-width: 240px; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.ccm-link-chip-country { font-weight: 600; }
.ccm-close {
  width: 34px; height: 34px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.12); color: #fff;
  border: 1.5px solid rgba(255,255,255,.30);
  cursor: pointer; transition: all .25s;
}
.ccm-close:hover { background: rgba(255,255,255,.28); transform: rotate(90deg); }

.ccm-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  background: #f0fdf9;
  border-bottom: 1px solid #e9d5ff;
}
.ccm-search {
  flex: 1; max-width: 380px; position: relative;
  display: flex; align-items: center;
}
.ccm-search svg { position: absolute; left: 12px; color: #9ca3af; }
.ccm-search input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: 1px solid #d1d5db; border-radius: 10px;
  font-size: 13px; font-weight: 500; background: #fff;
}
.ccm-search input:focus { outline: none; border-color: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,.15); }
.ccm-toolbar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.ccm-count {
  font-size: 11.5px; color: #047857; font-weight: 600;
  padding: 6px 12px;
  background: #f5f3ff; border: 1px solid rgba(52,211,153,.40);
  border-radius: 999px;
}
.ccm-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #059669 0%, #065f46 100%);
  color: #fff;
  border: none; border-radius: 10px;
  font-weight: 700; font-size: 11.5px;
  cursor: pointer; transition: all .15s ease;
  box-shadow: 0 4px 10px rgba(5,150,105,.30);
}
.ccm-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(5,150,105,.40); }

.ccm-body { flex: 1; overflow: auto; padding: 0; background: #fafafd; }
.ccm-tablecard {
  margin: 12px 18px 18px;
  background: #fff;
  border: 1px solid #d1fae5;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(4,120,87,.06);
}
.ccm-table-wrap { overflow-x: auto; padding: 0; }
.ccm-table {
  width: 100%; border-collapse: separate; border-spacing: 0;
  font-size: 11.5px; color: #1f2937;
  background: #fff;
}
.ccm-table thead tr { background: transparent; }
.ccm-table tbody td:not(:last-child),
.ccm-table tbody td:not(:last-child) *:not(i):not(svg):not(svg *) {
  font-size: 11.5px !important;
  font-weight: 500 !important;
}
.ccm-table tbody td:not(:last-child) .ccm-srno.ccm-srno { font-size: 11px !important; font-weight: 800 !important; }
.ccm-table tbody td:not(:last-child) .ccm-id-chip.ccm-id-chip,
.ccm-table tbody td:not(:last-child) .ccm-cust-chip.ccm-cust-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace !important;
  font-size: 11px !important;
  font-weight: 600 !important;
}
.ccm-table tbody td:not(:last-child) .seg-reg-badge.seg-reg-badge { font-size: 10px !important; font-weight: 600 !important; }
.ccm-table tbody td:not(:last-child) .ccm-seg-more.ccm-seg-more { font-size: 10px !important; font-weight: 800 !important; }
.ccm-table thead th {
  padding: 11px 9px;
  text-align: left;
  font-weight: 800; font-size: 9.5px; letter-spacing: .07em;
  color: #306865; text-transform: uppercase;
  white-space: nowrap;
  border-bottom: 0;
  background: linear-gradient(180deg, #f6fefb, #e3f8ef);
  box-shadow: inset 0 1px 0 #d6f5e8, inset 0 -1.5px 0 #bdf0da;
}
.ccm-table tbody tr { background: #ffffff; }
.ccm-table tbody tr:nth-child(even) { background: #f6fefb; }
.ccm-table tbody td {
  padding: 13px 9px;
  border-bottom: 1px solid #dcf5ec;
  vertical-align: middle;
  white-space: nowrap;
  color: #064e3b;
  background: transparent;
}
.ccm-table th:nth-child(1), .ccm-table td:nth-child(1),
.ccm-table th:nth-child(2), .ccm-table td:nth-child(2),
.ccm-table th:nth-child(4), .ccm-table td:nth-child(4),
.ccm-table th:nth-child(5), .ccm-table td:nth-child(5),
.ccm-table th:nth-child(6), .ccm-table td:nth-child(6),
.ccm-table th:nth-child(9), .ccm-table td:nth-child(9),
.ccm-table th:nth-child(11), .ccm-table td:nth-child(11) { text-align: center; }
.ccm-table tbody tr:last-child td { border-bottom: none; }
.ccm-table tbody tr:hover { background: #ecfdf5; }
.ccm-srno {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #059669, #065f46);
  color: #fff; font-weight: 800; font-size: 11px;
  box-shadow: 0 2px 6px rgba(4,120,87,0.30);
}
.ccm-seg {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; color: #065f46;
  background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 20px;
  padding: 3px 10px; white-space: nowrap;
}
.ccm-seg::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.ccm-seg-more {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 20px;
  border: 0; cursor: pointer; flex-shrink: 0;
  font-size: 10px; font-weight: 800; color: #fff; font-family: inherit;
  background: linear-gradient(135deg, #059669, #047857);
  box-shadow: 0 2px 8px rgba(5,150,105,.35);
}
.ccm-seg-more:hover { filter: brightness(1.06); }
.ccm-seg-pop {
  background: #fff; border: 1.5px solid #a7f3d0;
  box-shadow: 0 16px 40px rgba(0,0,0,.18);
  font-family: var(--font-sans);
}
.ccm-seg-pop .ccm-seg-pop-row .ccm-seg {
  font-family: var(--font-sans) !important;
  font-size: 11.5px !important;
  font-weight: 500 !important;
}
.ccm-seg-pop .ccm-seg-pop-row .seg-reg-badge { font-size: 10px !important; font-weight: 600 !important; }
.ccm-seg-pop-title {
  font-family: var(--font-sans);
  font-size: 9.5px !important; font-weight: 800 !important; letter-spacing: .07em; text-transform: uppercase;
  color: #047857; padding: 4px 8px 7px;
}
.ccm-seg-pop-row { display: flex; align-items: center; padding: 6px 8px; border-radius: 8px; }
.ccm-seg-pop-row.alt { background: #f0fdf9; }
[data-bs-theme="dark"] .ccm-seg-pop { background: #0f2a24; border-color: rgba(52,211,153,.30); box-shadow: 0 16px 40px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .ccm-seg-pop-title { color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-seg-pop-row.alt { background: rgba(255,255,255,.04); }
.ccm-empty td {
  text-align: center;
  padding: 48px 16px !important;
  color: #6b7280; font-size: 12.5px; font-weight: 600;
  white-space: normal;
  background: #fff;
}
.ccm-empty td strong { color: #047857; }
.ccm-empty-state { display: inline-flex; align-items: center; gap: 10px; color: #047857; font-weight: 600; }
.ccm-skel-row td { padding-top: 14px; padding-bottom: 14px; }
.ccm-skel-row:hover td { background: transparent !important; }
.ccm-skel {
  display: inline-block; height: 10px; border-radius: 4px; vertical-align: middle;
  background: linear-gradient(90deg, #d1fae5 0%, #ecfdf5 50%, #d1fae5 100%);
  background-size: 200% 100%;
  animation: ccm-shimmer 1.1s ease-in-out infinite;
}
.ccm-skel-xs { width: 24px; }
.ccm-skel-md { width: 70px; }
.ccm-skel-lg { width: 130px; }
@keyframes ccm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .ccm-skel { animation: none; } }
[data-bs-theme="dark"] .ccm-skel {
  background: linear-gradient(90deg, #0f3b2e 0%, #14523d 50%, #0f3b2e 100%);
  background-size: 200% 100%;
}
.ccm-empty-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2.5px solid rgba(5,150,105,0.22);
  border-top-color: #059669;
  animation: ccm-spin .8s linear infinite;
}
@keyframes ccm-spin { to { transform: rotate(360deg); } }
.ccm-id-chip {
  display: inline-block; padding: 3px 10px; border-radius: 6px;
  background: #ecfdf5; color: #047857;
  border: 1px solid rgba(16,185,129,.30);
  font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
}
.ccm-cust-chip {
  display: inline-block; padding: 3px 10px; border-radius: 6px;
  background: #d1fae5; color: #047857;
  border: 1px solid rgba(52,211,153,.40);
  font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
}
.ccm-company { font-weight: 700; color: #111827; }
.ccm-email   { color: #2563eb; }
.ccm-mono    { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11.5px; }
.ccm-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; border: 1px solid transparent;
}
.ccm-pill::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.ccm-sac { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.ccm-sac.is-yes { background: rgba(16,185,129,.14); color: #059669; }
.ccm-sac.is-no  { background: rgba(100,116,139,.12); color: #64748b; }
.ccm-pill-low  { background: #ecfdf5; color: #047857; border-color: #6ee7b7; }
.ccm-pill-med  { background: #fffbeb; color: #b45309; border-color: #fed7aa; }
.ccm-pill-high { background: #fef2f2; color: #b91c1c; border-color: #fca5a5; }

.ccm-row-actions { display: inline-flex; gap: 6px; }
.ccm-row-btn {
  width: 28px; height: 28px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ecfdf5; color: #0d9488;
  border: 1.5px solid #5eead4;
  cursor: pointer; transition: all .18s cubic-bezier(.22,1,.36,1);
}
.ccm-row-btn:hover {
  background: linear-gradient(135deg, #0d9488, #065f46); color: #fff; border-color: transparent;
  box-shadow: 0 4px 14px rgba(13,148,136,.4); transform: translateY(-2px) scale(1.08);
}
.ccm-row-btn-del:hover { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }

[data-bs-theme="dark"] .ccm-overlay { background: rgba(0,0,0,.65); }
[data-bs-theme="dark"] .ccm-card { background: linear-gradient(165deg, #0b1220 0%, #11182a 45%, #131c30 100%); border: 1px solid rgba(52,211,153,0.20); }
[data-bs-theme="dark"] .ccm-body { background: #0c1322; }
[data-bs-theme="dark"] .ccm-toolbar { background: #11182a; border-bottom-color: rgba(52,211,153,.20); }
[data-bs-theme="dark"] .ccm-search input { background: #131c33; border-color: rgba(52,211,153,.40); color: #d1fae5; }
[data-bs-theme="dark"] .ccm-search input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .ccm-search svg { color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-count { background: rgba(5,150,105,.20); border-color: rgba(52,211,153,.35); color: #a7f3d0; }
[data-bs-theme="dark"] .ccm-tablecard { background: #1a2236; border-color: rgba(52,211,153,0.22); box-shadow: 0 4px 18px rgba(0,0,0,0.45); }
[data-bs-theme="dark"] .ccm-table { background: #1a2236; }
[data-bs-theme="dark"] .ccm-table thead tr { background: transparent; }
[data-bs-theme="dark"] .ccm-table thead th {
  color: rgba(167,243,208,.85); border-bottom: 0;
  background: rgba(5,150,105,.12);
  box-shadow: inset 0 1px 0 rgba(52,211,153,.18), inset 0 -1.5px 0 rgba(52,211,153,.28);
}
[data-bs-theme="dark"] .ccm-table tbody tr { background: transparent; }
[data-bs-theme="dark"] .ccm-table tbody tr:nth-child(even) { background: rgba(52,211,153,.05); }
[data-bs-theme="dark"] .ccm-table tbody td { color: #d1fae5; border-bottom-color: rgba(52,211,153,.12); }
[data-bs-theme="dark"] .ccm-table tbody tr:hover { background: rgba(52,211,153,.10); }
[data-bs-theme="dark"] .ccm-seg { background: rgba(5,150,105,.16); color: #6ee7b7; border-color: rgba(52,211,153,.30); }
[data-bs-theme="dark"] .ccm-empty td { color: #94a3b8; background: #1a2236; }
[data-bs-theme="dark"] .ccm-empty td strong { color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-empty-state { color: #6ee7b7; }

.ccm-pag { display: flex; }
.ccm-pag .wl-pager {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 10px 14px;
  border-top: 2px solid #a7f3d0;
  border-radius: 0;
  background: linear-gradient(90deg, #f0fdf9 0%, #e7fbf3 40%, #f0fdf9 100%);
}
[data-bs-theme="dark"] .ccm-pag .wl-pager {
  border-top-color: rgba(52, 211, 153, .32);
  background: linear-gradient(90deg, rgba(16, 185, 129, .08), rgba(16, 185, 129, .14), rgba(16, 185, 129, .08));
}
.ccm-pag .wl-pager {
  --tcwl-accent: #059669;
  --tcwl-text: #047857;
  --tcwl-border: #a7f3d0;
  --tcwl-range-bg: linear-gradient(135deg, #10b981 0%, #059669 55%, #047857 100%);
  --tcwl-glow: rgba(5, 150, 105, .4);
}
[data-bs-theme="dark"] .ccm-pag .wl-pager {
  --tcwl-text-dark: #6ee7b7;
  --tcwl-border-dark: rgba(16, 185, 129, .35);
  --tcwl-band-dark: none;
}
[data-bs-theme="dark"] .ccm-empty-spinner { border-color: rgba(52,211,153,0.30); border-top-color: #34d399; }
[data-bs-theme="dark"] .ccm-id-chip { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .ccm-cust-chip { background: rgba(52,211,153,.20); color: #6ee7b7; border-color: rgba(52,211,153,.40); }
[data-bs-theme="dark"] .ccm-company { color: #ffffff; }
[data-bs-theme="dark"] .ccm-email { color: #93c5fd; }
[data-bs-theme="dark"] .ccm-pill-low  { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-pill-med  { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .ccm-pill-high { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .ccm-row-btn { background: rgba(255,255,255,0.04); border-color: rgba(52,211,153,.25); color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-row-btn:hover { background: rgba(5,150,105,.22); border-color: #34d399; color: #fff; }
[data-bs-theme="dark"] .ccm-row-btn-del:hover { background: rgba(239,68,68,.20); border-color: #fca5a5; color: #fca5a5; }

@media (max-width: 1024px) {
  .ccm-overlay { padding: 12px; }
  .ccm-card { max-height: calc(100vh - 24px); }
  .ccm-link-chip-name { max-width: 140px; }
}
@media (max-width: 640px) {
  .ccm-overlay { padding: 0; align-items: stretch; }
  .ccm-card {
    border-radius: 0;
    max-height: 100vh;
    height: 100vh;
    width: 100vw;
  }
  .ccm-header { flex-direction: column; align-items: stretch; gap: 12px; padding: 14px 16px; }
  .ccm-header-left { align-items: flex-start; }
  .ccm-title { font-size: 16px; }
  .ccm-sub   { font-size: 11.5px; }
  .ccm-header-right { width: 100%; flex-wrap: wrap; gap: 8px; }
  .ccm-link-chip { flex: 1 1 auto; min-width: 0; flex-wrap: wrap; }
  .ccm-link-chip-name { max-width: 100%; }
  .ccm-close { position: absolute; top: 12px; right: 12px; }
  .ccm-toolbar { flex-direction: column; align-items: stretch; gap: 10px; padding: 12px; }
  .ccm-search { max-width: 100%; }
  .ccm-toolbar-right { width: 100%; justify-content: space-between; }
  .ccm-add-btn { flex: 0 0 auto; padding: 8px 14px; font-size: 12.5px; }
  .ccm-table { font-size: 11.5px; }
  .ccm-table thead th, .ccm-table tbody td { padding: 10px 8px; }
}
`;
