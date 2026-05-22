import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf } from './clmCommon';

/* Central CLM → Document Control Panel.
 *
 * Lists Segment Rules — one per (segment × regulatory tier) configuration
 * with per-category document-count badges. The Add/Edit modal is a 2-stage
 * flow: Stage 1 picks segment + auto-maps authorities, Stage 2 toggles
 * Mandatory/Optional per document across KYC/DD/TL/TD/QC.
 */

type DocSel = Record<string, 'M' | 'O'>;
type DocSelections = { kyc?: DocSel; dd?: DocSel; tl?: DocSel; td?: DocSel; qc?: DocSel };

type SegRule = {
  id: number; rule_code: string; segment_id: number | null;
  segment_code: string; regulatory_status: 'highly' | 'less';
  auths_json: string[] | null;
  doc_selections: DocSelections;
  mandatory_count: number; optional_count: number;
};

type Counts = { all: number; highly: number; less: number };

type Segment   = { id: number; code: string; name: string; regulatory_status: 'highly'|'less'; buyer_consignee: 'allowed'|'not_allowed' };
type Authority = { id: number; code: string; name: string; description: string };
type DocItem   = { id: number; code: string; name: string; authority?: string; issued_by?: string; title?: string };

type Bootstrap = {
  segments: Segment[]; authorities: Authority[];
  kyc: DocItem[]; dd: DocItem[]; tl: DocItem[]; td: DocItem[]; qc: DocItem[];
};

const CAT_KEYS: Array<keyof DocSelections> = ['kyc', 'dd', 'tl', 'td', 'qc'];
const CAT_LABELS: Record<keyof DocSelections, string> = {
  kyc: 'KYC', dd: 'Due Diligence', tl: 'Trade Licenses', td: 'Trade Documents', qc: 'Quality & Compliance',
};

/* Hardcoded segment→authority mapping mirrors the prototype's
 * _srGetAuthsForSeg lookup so the auto-mapping behavior is identical. */
const SEG_AUTH_MAP: Record<string, string[]> = {
  // Highly regulated
  'S-011': ['AUTH-002','AUTH-003','AUTH-004','AUTH-010'],
  'S-012': ['AUTH-002','AUTH-003','AUTH-004','AUTH-010'],
  'S-013': ['AUTH-003','AUTH-004','AUTH-002'],
  'S-014': ['AUTH-003','AUTH-004','AUTH-005'],
  'S-015': ['AUTH-003','AUTH-004','AUTH-008'],
  'S-016': ['AUTH-001','AUTH-002','AUTH-003'],
  'S-017': ['AUTH-001','AUTH-003'],
  'S-018': ['AUTH-006','AUTH-007','AUTH-002'],
  'S-019': ['AUTH-003','AUTH-002','AUTH-005'],
  'S-020': ['AUTH-003','AUTH-002','AUTH-008'],
  // Less regulated
  'S-001': ['AUTH-002','AUTH-012'], 'S-002': ['AUTH-002','AUTH-012'],
  'S-003': ['AUTH-002','AUTH-003'], 'S-004': ['AUTH-002','AUTH-012'],
  'S-005': ['AUTH-002','AUTH-006'], 'S-006': ['AUTH-002','AUTH-012'],
  'S-007': ['AUTH-002','AUTH-012'], 'S-008': ['AUTH-002','AUTH-012'],
  'S-009': ['AUTH-002','AUTH-006'], 'S-010': ['AUTH-002','AUTH-012'],
};

function authsForSegment(segCode: string, allAuths: Authority[]): Authority[] {
  const codes = SEG_AUTH_MAP[segCode] ?? ['AUTH-002', 'AUTH-012'];
  return allAuths.filter(a => codes.includes(a.code));
}

export default function ClmDcpPage() {
  const toast = useToast();

  const [rows, setRows]       = useState<SegRule[]>([]);
  const [counts, setCounts]   = useState<Counts>({ all: 0, highly: 0, less: 0 });
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState<'all'|'highly'|'less'>('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);

  const [boot, setBoot]       = useState<Bootstrap | null>(null);
  const [editing, setEditing] = useState<SegRule | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SegRule | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: SegRule[]; counts: Counts }>('/clm/segment-rules'),
      api.get<{ status: boolean; data: Bootstrap }>('/clm/segment-rules/bootstrap'),
    ]).then(([r, b]) => {
      setRows(r.data.data ?? []); setCounts(r.data.counts ?? { all: 0, highly: 0, less: 0 });
      setBoot(b.data.data);
    }).catch(() => toast.error('Load failed', 'Could not load segment rules'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const base = tab === 'all' ? rows : rows.filter(r => r.regulatory_status === tab);
    if (!search.trim()) return base;
    const s = search.toLowerCase();
    return base.filter(r => r.rule_code.toLowerCase().includes(s) || r.segment_code.toLowerCase().includes(s));
  }, [rows, tab, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: { segment_code: string; regulatory_status: 'highly'|'less'; auths: string[]; doc_selections: DocSelections }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/segment-rules/${id}`, form); toast.success('Updated', `${form.segment_code} rules saved`); }
      else    { await api.post('/clm/segment-rules', form);     toast.success('Added',   `${form.segment_code} rules created`); }
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/segment-rules/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.rule_code); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      <ClmPageHeader
        icon={ICO.hDcp}
        title="Document Control Panel"
        sub="Manage segment-wise document rules, authorities, and compliance document mapping."
        addLabel="Add Segment Rule"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bDcp}
        label="Document Control Panel"
        sub="Configure which KYC, DD, Trade License, Trade Documents and Quality & Compliance documents are required for each business segment."
        steps={[
          { n: '01', title: 'Select Segment',      desc: 'Pick a segment — all segments from Segment Master are available.', icon: ICO.grid },
          { n: '02', title: 'Auto-Load Masters',   desc: 'KYC, DD, TL, TD & QC masters auto-load in sequence.',              icon: ICO.refresh },
          { n: '03', title: 'Set Requirements',    desc: 'Toggle each document as Mandatory, Optional, or Not Required.',     icon: ICO.doc },
          { n: '04', title: 'Save & Persist',      desc: 'Rules are saved per segment — settings remembered across visits.',  icon: ICO.users },
          { n: '05', title: 'Used in CLM',         desc: 'Saved rules auto-apply across CLM workflows and validations.',      icon: ICO.check },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-bar">
          <button className={`clm-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => { setTab('all'); setPage(1); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            All Segments <span className="clm-tab-count">{counts.all}</span>
          </button>
          <button className={`clm-tab ${tab === 'highly' ? 'active' : ''}`} onClick={() => { setTab('highly'); setPage(1); }}>
            <span className="clm-tab-dot" style={{ background: '#ef4444', boxShadow: '0 0 5px rgba(239,68,68,.5)' }} />
            Highly Regulated <span className="clm-tab-count">{counts.highly}</span>
          </button>
          <button className={`clm-tab ${tab === 'less' ? 'active' : ''}`} onClick={() => { setTab('less'); setPage(1); }}>
            <span className="clm-tab-dot" style={{ background: '#22c55e', boxShadow: '0 0 5px rgba(34,197,94,.5)' }} />
            Less Regulated <span className="clm-tab-count">{counts.less}</span>
          </button>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <div className="clm-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" placeholder="Search segment rules…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bDcp}</div>
              <div className="clm-empty-title">No Segment Rules Yet</div>
              <div className="clm-empty-sub">Click "+ Add Segment Rule" to create your first rule.</div>
            </div>
          ) : (
            <div className="clm-table-wrap">
              <table className="clm-table" style={{ minWidth: 1100 }}>
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 90, textAlign: 'center' }}>RULE ID</th>
                  <th style={{ width: 90, textAlign: 'center' }}>SEGMENT</th>
                  <th>SEGMENT NAME</th>
                  <th style={{ width: 110, textAlign: 'center' }}>REGULATORY</th>
                  <th style={{ width: 60, textAlign: 'center' }}>KYC</th>
                  <th style={{ width: 60, textAlign: 'center' }}>DD</th>
                  <th style={{ width: 60, textAlign: 'center' }}>TL</th>
                  <th style={{ width: 60, textAlign: 'center' }}>TD</th>
                  <th style={{ width: 60, textAlign: 'center' }}>QC</th>
                  <th style={{ width: 80, textAlign: 'center' }}>TOTAL</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={12} className="clm-status">Loading rules…</td></tr>}
                  {!loading && slice.map((r, i) => {
                    const seg = boot?.segments.find(s => s.code === r.segment_code);
                    const isHigh = r.regulatory_status === 'highly';
                    const segCount = (cat: keyof DocSelections) => Object.values(r.doc_selections?.[cat] ?? {}).filter(Boolean).length;
                    return (
                      <tr key={r.id}>
                        <td className="clm-td-num">{start + i + 1}</td>
                        <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.rule_code}</span></td>
                        <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.segment_code}</span></td>
                        <td className="clm-td-name">{seg?.name ?? r.segment_code}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`clm-badge ${isHigh ? 'clm-badge-red' : 'clm-badge-green'}`}><span className="clm-badge-dot" />{isHigh ? 'High' : 'Less'}</span>
                        </td>
                        {CAT_KEYS.map(c => (
                          <td key={c} style={{ textAlign: 'center', fontWeight: 700, color: segCount(c) ? '#0891b2' : '#94a3b8' }}>
                            {segCount(c) || '—'}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#0c4a6e' }}>
                          <span style={{ color: '#dc2626' }}>{r.mandatory_count}M</span> · <span style={{ color: '#d97706' }}>{r.optional_count}O</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="clm-actions">
                            <button className="clm-act clm-act-edit" title="Edit rule" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                            <button className="clm-act clm-act-del" title="Delete rule" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && filtered.length > 0 && (
                <div className="clm-pag">
                  <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b> rule{filtered.length === 1 ? '' : 's'}</span>
                  <div className="clm-pag-btns">
                    {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {modalOpen && boot && (
        <SegmentRuleModal
          existing={editing}
          boot={boot}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form) => onSave(form, editing?.id)}
        />
      )}
      {pendingDelete && createPortal((
        <div className="clm-conf-bd" onClick={() => setPendingDelete(null)}>
          <div className="clm-conf" onClick={e => e.stopPropagation()}>
            <div className="clm-conf-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></div>
            <div className="clm-conf-title">Delete segment rule?</div>
            <div className="clm-conf-sub"><strong>{pendingDelete.rule_code}</strong> for {pendingDelete.segment_code} will be removed.</div>
            <div className="clm-conf-btns">
              <button className="clm-btn-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="clm-btn-del" onClick={() => void onDelete()}>Delete</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

/* ─── 2-stage Segment Rule modal ─── */

function SegmentRuleModal(props: {
  existing: SegRule | null; boot: Bootstrap;
  onClose: () => void;
  onSave: (f: { segment_code: string; regulatory_status: 'highly'|'less'; auths: string[]; doc_selections: DocSelections }) => void;
}) {
  const { existing, boot, onClose, onSave } = props;
  const isEdit = !!existing;
  const [stage, setStage]     = useState<1 | 2>(1);
  const [reg, setReg]         = useState<'highly'|'less'|null>(existing?.regulatory_status ?? null);
  const [segCode, setSegCode] = useState<string>(existing?.segment_code ?? '');
  const [docSel, setDocSel]   = useState<DocSelections>(existing?.doc_selections ?? {});
  const [activeCat, setActiveCat] = useState<keyof DocSelections>('kyc');
  const [saving, setSaving]   = useState(false);

  const segments = useMemo(() => reg ? boot.segments.filter(s => s.regulatory_status === reg) : [], [reg, boot.segments]);
  const selSeg   = useMemo(() => boot.segments.find(s => s.code === segCode) ?? null, [segCode, boot.segments]);
  const auths    = useMemo(() => selSeg ? authsForSegment(selSeg.code, boot.authorities) : [], [selSeg, boot.authorities]);

  const goStage2 = () => {
    if (!reg)     { alert('Please select a Regulatory Status to continue.'); return; }
    if (!segCode) { alert('Please select a Segment to continue.'); return; }
    setStage(2);
  };

  const setDocReq = (cat: keyof DocSelections, code: string, val: 'M' | 'O' | null) => {
    setDocSel(prev => {
      const next = { ...prev, [cat]: { ...(prev[cat] ?? {}) } };
      if (val === null) delete next[cat]![code];
      else next[cat]![code] = val;
      return next;
    });
  };

  const catData: Record<keyof DocSelections, DocItem[]> = {
    kyc: boot.kyc, dd: boot.dd, tl: boot.tl, td: boot.td, qc: boot.qc,
  };
  const totalSel = (cat: keyof DocSelections) => Object.values(docSel[cat] ?? {}).filter(Boolean).length;
  const mandCount = (cat: keyof DocSelections) => Object.values(docSel[cat] ?? {}).filter(v => v === 'M').length;
  const optCount  = (cat: keyof DocSelections) => Object.values(docSel[cat] ?? {}).filter(v => v === 'O').length;
  const grandTotal = CAT_KEYS.reduce((sum, c) => sum + totalSel(c), 0);

  const handleSave = async () => {
    if (!reg || !segCode) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
        segment_code: segCode,
        regulatory_status: reg,
        auths: auths.map(a => a.code),
        doc_selections: docSel,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" style={{ maxWidth: 1080, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Segment Rule' : 'Add Segment Rule'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update document rules for this segment across CLM workflows.' : 'Configure document rules for a business segment across CLM workflows.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>

        {/* Stage tabs */}
        <div style={{ background: '#fff', padding: '10px 18px', borderBottom: '1px solid rgba(6,182,212,.09)', display: 'flex', alignItems: 'center', gap: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 11, background: stage === 1 ? 'linear-gradient(135deg, #0891b2, #0e7490)' : stage > 1 ? 'rgba(240,253,250,.9)' : 'rgba(241,245,249,.7)', border: stage > 1 ? '1.5px solid rgba(34,197,94,.28)' : 'none', cursor: stage > 1 ? 'pointer' : 'default' }} onClick={() => stage > 1 && setStage(1)}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: stage === 1 ? 'rgba(255,255,255,.18)' : stage > 1 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#e2e8f0', border: stage === 1 ? '1.5px solid rgba(255,255,255,.32)' : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>
              {stage > 1 ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8"><polyline points="20 6 9 17 4 12"/></svg> : '1'}
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: stage === 1 ? '#fff' : stage > 1 ? '#15803d' : '#94a3b8' }}>Segment & Authority</div>
              <div style={{ fontSize: 9, color: stage === 1 ? 'rgba(255,255,255,.7)' : stage > 1 ? '#16a34a' : '#b0bec5' }}>Regulatory status, segment & authorities</div>
            </div>
          </div>
          <div style={{ width: 32, height: 2, background: 'linear-gradient(90deg, #0891b2, rgba(6,182,212,.3))', margin: '0 8px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 11, background: stage === 2 ? 'linear-gradient(135deg, #0891b2, #0e7490)' : 'rgba(241,245,249,.7)' }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: stage === 2 ? 'rgba(255,255,255,.18)' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: stage === 2 ? '#fff' : '#94a3b8' }}>2</div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: stage === 2 ? '#fff' : '#94a3b8' }}>CLM Documents</div>
              <div style={{ fontSize: 9, color: stage === 2 ? 'rgba(255,255,255,.7)' : '#b0bec5' }}>Assign document requirements per category</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 9.5, fontWeight: 700, color: '#0891b2', background: 'rgba(8,145,178,.07)', border: '1px solid rgba(8,145,178,.16)', borderRadius: 20, padding: '3px 9px' }}>Step {stage} of 2</div>
        </div>

        <div className="clm-modal-body" style={{ maxHeight: '70vh' }}>
          {stage === 1 ? (
            <>
              {/* Card 1: Regulatory Status + Segment Select */}
              <div style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Segment Regulatory Status</span>
                  <span className="clm-req">*</span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
                  {(['highly','less'] as const).map(v => {
                    const on = reg === v;
                    const hi = v === 'highly';
                    return (
                      <label key={v} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${on ? (hi ? 'rgba(239,68,68,.38)' : 'rgba(34,197,94,.32)') : 'rgba(203,213,225,.38)'}`, background: on ? (hi ? 'rgba(254,242,242,.45)' : 'rgba(240,253,244,.45)') : 'rgba(248,250,252,.5)', cursor: 'pointer', transition: 'all .15s' }}
                        onClick={() => { setReg(v); setSegCode(''); }}>
                        <input type="radio" checked={on} onChange={() => {}} style={{ accentColor: hi ? '#ef4444' : '#16a34a', width: 14, height: 14 }} />
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: hi ? '#ef4444' : '#22c55e' }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: on ? (hi ? '#991b1b' : '#166534') : '#1e293b' }}>{hi ? 'High Regulatory' : 'Less Regulatory'}</div>
                          <div style={{ fontSize: 9, color: on ? (hi ? '#b91c1c' : '#15803d') : '#94a3b8', marginTop: 2 }}>{hi ? 'Requires specific segment & compliance review' : 'Applicable to all standard segments by default'}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {reg && (
                  <div style={{ margin: '0 12px 12px', padding: '11px 12px', background: reg === 'highly' ? 'linear-gradient(110deg, rgba(239,68,68,.03), rgba(254,242,242,.4))' : 'linear-gradient(110deg, rgba(22,163,74,.03), rgba(240,253,244,.4))', border: `1px solid ${reg === 'highly' ? 'rgba(239,68,68,.15)' : 'rgba(22,163,74,.15)'}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 8.5, fontWeight: 800, color: reg === 'highly' ? '#dc2626' : '#15803d', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 7 }}>Select Segment <span className="clm-req">*</span></div>
                    <select className="clm-select" value={segCode} onChange={e => setSegCode(e.target.value)}>
                      <option value="">— Choose a {reg === 'highly' ? 'Highly' : 'Less'} Regulated Segment —</option>
                      {segments.map(s => <option key={s.id} value={s.code}>{s.name} ({s.code})</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Card 2 + 3: Segment Details + Authorities */}
              {selSeg && (
                <>
                  <div style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Segment Details</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 0 }}>
                      <div style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                        <div style={{ fontSize: 7.5, fontWeight: 800, color: '#0891b2', opacity: .5, textTransform: 'uppercase', marginBottom: 4 }}>Segment ID</div>
                        <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 14, fontWeight: 800, color: '#0c4a6e' }}>{selSeg.code}</div>
                      </div>
                      <div style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                        <div style={{ fontSize: 7.5, fontWeight: 800, color: '#0891b2', opacity: .5, textTransform: 'uppercase', marginBottom: 4 }}>Segment Name</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0c4a6e' }}>{selSeg.name}</div>
                      </div>
                      <div style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                        <div style={{ fontSize: 7.5, fontWeight: 800, color: '#0891b2', opacity: .5, textTransform: 'uppercase', marginBottom: 5 }}>Regulatory</div>
                        <span className={`clm-badge ${reg === 'highly' ? 'clm-badge-red' : 'clm-badge-emerald'}`}><span className="clm-badge-dot" />{reg === 'highly' ? 'High' : 'Less'}</span>
                      </div>
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ fontSize: 7.5, fontWeight: 800, color: '#0891b2', opacity: .5, textTransform: 'uppercase', marginBottom: 5 }}>Buyer ≠ Consignee</div>
                        <span className={`clm-badge ${selSeg.buyer_consignee === 'allowed' ? 'clm-badge-green' : 'clm-badge-red'}`}>{selSeg.buyer_consignee === 'allowed' ? 'Allowed' : 'Not Allowed'}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Mapped Authorities</span>
                      <span style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 500 }}>(auto-selected)</span>
                      <span className="clm-badge clm-badge-teal" style={{ marginLeft: 'auto', padding: '1px 7px' }}>{auths.length}</span>
                    </div>
                    <div style={{ padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {auths.map((a, i) => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, background: 'rgba(8,145,178,.05)', border: '1px solid rgba(6,182,212,.2)' }}>
                          <div style={{ width: 18, height: 18, borderRadius: 5, background: 'rgba(8,145,178,.11)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span style={{ fontSize: 8, fontWeight: 800, color: '#0891b2' }}>{i + 1}</span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#0c4a6e' }}>{a.name}</div>
                            <div style={{ fontSize: 9, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</div>
                          </div>
                          <span className="clm-code-pill" style={{ fontSize: 9 }}>{a.code}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            // Stage 2: Document selection per category
            <div>
              <div style={{ display: 'flex', gap: 2, padding: 4, background: 'rgba(240,253,255,.9)', border: '1.5px solid rgba(6,182,212,.15)', borderRadius: 13, overflowX: 'auto' }}>
                {CAT_KEYS.map(c => {
                  const on = activeCat === c;
                  const cnt = totalSel(c);
                  return (
                    <button key={c} className={`clm-tab ${on ? 'active' : ''}`} onClick={() => setActiveCat(c)} style={{ flexShrink: 0 }}>
                      {CAT_LABELS[c]}
                      {cnt > 0 && <span className="clm-tab-count">{cnt}</span>}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: 8, background: '#fff', border: '1.5px solid rgba(6,182,212,.15)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'linear-gradient(110deg, #0891b2, #0e7490)', color: '#fff' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.25px' }}>{CAT_LABELS[activeCat]} Documents</div>
                    <div style={{ fontSize: 9.5, opacity: .7 }}>{catData[activeCat].length} documents available to configure</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {mandCount(activeCat) > 0 && <span className="clm-badge" style={{ background: 'rgba(6,182,212,.25)', color: '#fff', border: '1px solid rgba(255,255,255,.28)' }}>Mandatory · {mandCount(activeCat)}</span>}
                    {optCount(activeCat) > 0 && <span className="clm-badge" style={{ background: 'rgba(251,191,36,.28)', color: '#fff', border: '1px solid rgba(251,191,36,.35)' }}>Optional · {optCount(activeCat)}</span>}
                  </div>
                </div>
                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="clm-table">
                    <tbody>
                      {catData[activeCat].map((d, i) => {
                        const sel = docSel[activeCat]?.[d.code];
                        const isM = sel === 'M', isO = sel === 'O';
                        return (
                          <tr key={d.id}>
                            <td className="clm-td-num">{String(i + 1).padStart(2, '0')}</td>
                            <td style={{ width: 100 }}><span className="clm-code-pill">{d.code}</span></td>
                            <td className="clm-td-name">{d.name || d.title}</td>
                            <td className="clm-td-desc">{d.authority || d.issued_by || '—'}</td>
                            <td style={{ width: 200, textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', borderRadius: 9, overflow: 'hidden', border: `1.5px solid ${isM ? 'rgba(6,182,212,.35)' : isO ? 'rgba(245,158,11,.35)' : 'rgba(203,213,225,.4)'}` }}>
                                <button onClick={() => setDocReq(activeCat, d.code, isM ? null : 'M')} style={{ padding: '5px 14px', border: 'none', borderRight: '1px solid rgba(203,213,225,.35)', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: isM ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : 'rgba(248,250,252,.8)', color: isM ? '#fff' : '#94a3b8' }}>Mandatory</button>
                                <button onClick={() => setDocReq(activeCat, d.code, isO ? null : 'O')} style={{ padding: '5px 14px', border: 'none', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: isO ? 'linear-gradient(135deg, #fbbf24, #d97706)' : 'rgba(248,250,252,.8)', color: isO ? '#fff' : '#94a3b8' }}>Optional</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="clm-modal-foot" style={{ justifyContent: 'space-between' }}>
          <div>
            {stage === 2 && <button className="clm-btn-cancel" onClick={() => setStage(1)}>← Back</button>}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="clm-btn-cancel" onClick={onClose}>Cancel</button>
            {stage === 1
              ? <button className="clm-btn-save" onClick={goStage2}>Next: CLM Documents →</button>
              : <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  {saving ? 'Saving…' : (isEdit ? `Update Rule (${grandTotal} docs)` : `Save Rule (${grandTotal} docs)`)}
                </button>}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
