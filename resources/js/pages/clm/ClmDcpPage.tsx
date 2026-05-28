import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { MasterSelect } from '../../components/ui/MasterSelect';

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
  const [viewDocs, setViewDocs] = useState<{ rule: SegRule; cat: keyof DocSelections | 'all' } | null>(null);

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
    } catch (e: any) {
      // 409: another rule already exists for this segment — refresh rows
      // so the modal pivots into edit-mode on next open.
      if (e?.response?.status === 409) { toast.info('Already exists', e.response.data?.message ?? 'A rule already exists for this segment.'); reload(); return; }
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    }
  };

  /* Bulk save — used by the Less-Regulatory multi-select. Fires one PUT
   * or POST per picked segment, then closes + reloads once at the end so
   * the table refreshes a single time regardless of selection size. The
   * 409 path still runs per segment to handle race conditions cleanly. */
  const onBulkSave = async (rows: Array<{ form: { segment_code: string; regulatory_status: 'highly'|'less'; auths: string[]; doc_selections: DocSelections }; ruleId?: number }>) => {
    let created = 0, updated = 0;
    const failed: string[] = [];
    for (const { form, ruleId } of rows) {
      try {
        if (ruleId) { await api.put(`/clm/segment-rules/${ruleId}`, form); updated++; }
        else        { await api.post('/clm/segment-rules', form);          created++; }
      } catch (e: any) {
        if (e?.response?.status === 409) { failed.push(`${form.segment_code} (already exists)`); continue; }
        failed.push(`${form.segment_code} (${e?.response?.data?.message ?? 'error'})`);
      }
    }
    if (created || updated) toast.success('Saved', `${created} created · ${updated} updated${failed.length ? ` · ${failed.length} skipped` : ''}`);
    if (failed.length && !created && !updated) toast.error('Save failed', failed.join('; '));
    else if (failed.length) toast.info('Some skipped', failed.join('; '));
    setModalOpen(false); setEditing(null); reload();
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/segment-rules/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.rule_code); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS + DCP_PAGE_CSS}</style>

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
            <div className="clm-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" placeholder="Search segment rules…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
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
                        {CAT_KEYS.map(c => {
                          const n = segCount(c);
                          return (
                            <td key={c} style={{ textAlign: 'center' }}>
                              {n > 0 ? (
                                <button
                                  type="button"
                                  className="clm-count-btn"
                                  onClick={() => setViewDocs({ rule: r, cat: c })}
                                  title={`View ${CAT_LABELS[c]} documents`}
                                >{n}</button>
                              ) : (
                                <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'center' }}>
                          {(r.mandatory_count + r.optional_count) > 0 ? (
                            <button
                              type="button"
                              className="clm-total-btn"
                              onClick={() => setViewDocs({ rule: r, cat: 'all' })}
                              title="View all documents"
                            >
                              <span style={{ color: '#dc2626' }}>{r.mandatory_count}M</span>
                              <span style={{ opacity: .5, margin: '0 3px' }}>·</span>
                              <span style={{ color: '#d97706' }}>{r.optional_count}O</span>
                            </button>
                          ) : (
                            <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>
                          )}
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
          existingRules={rows}
          boot={boot}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form, ruleId) => onSave(form, ruleId ?? editing?.id)}
          onBulkSave={onBulkSave}
        />
      )}
      {viewDocs && boot && (
        <DocListPopup
          rule={viewDocs.rule}
          cat={viewDocs.cat}
          boot={boot}
          onClose={() => setViewDocs(null)}
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
  existing: SegRule | null; existingRules: SegRule[]; boot: Bootstrap;
  onClose: () => void;
  onSave: (f: { segment_code: string; regulatory_status: 'highly'|'less'; auths: string[]; doc_selections: DocSelections }, ruleId?: number) => void;
  /** Bulk save — used when the Less-Regulatory multi-select mode picks
   *  multiple segments. Parent loops the API calls and triggers a single
   *  reload + close on completion. Optional: when omitted the modal
   *  falls back to looping the single onSave (with N reloads). */
  onBulkSave?: (rows: Array<{ form: { segment_code: string; regulatory_status: 'highly'|'less'; auths: string[]; doc_selections: DocSelections }; ruleId?: number }>) => void;
}) {
  const { existing, existingRules, boot, onClose, onSave, onBulkSave } = props;
  const [stage, setStage]     = useState<1 | 2>(1);
  const [reg, setReg]         = useState<'highly'|'less'|null>(existing?.regulatory_status ?? null);
  /* Multi-select segment codes. Always an array internally; in edit mode
   * and in High-Regulatory create mode the UI forces it to length ≤ 1.
   * In Less-Regulatory create mode the user can pick many — each becomes
   * its own SR-NNN row at save time, all sharing the Stage 2 doc rules. */
  const [segCodes, setSegCodes] = useState<string[]>(existing?.segment_code ? [existing.segment_code] : []);
  const [docSel, setDocSel]   = useState<DocSelections>(existing?.doc_selections ?? {});
  const [activeCat, setActiveCat] = useState<keyof DocSelections>('kyc');
  const [saving, setSaving]   = useState(false);

  /* Less-Regulatory create-mode flips on multi-select. Edit mode locks to
   * single because each edit targets exactly one rule, and High keeps a
   * single-select dropdown by design (high-regulated segments need per-
   * segment review and tend to be configured one at a time). */
  const isMulti = !existing && reg === 'less';
  const segCode = segCodes[0] ?? '';

  /* In single-segment mode (edit / high / single-less) the matched-rule
   * banner pivots Add → Edit for the picked segment. In multi mode every
   * already-configured segment in the picked set is collected so the
   * banner can list them and the save handler can PUT them individually. */
  const matchedRules = useMemo(
    () => existingRules.filter(r => r.id !== existing?.id && segCodes.includes(r.segment_code)),
    [existingRules, segCodes, existing?.id]
  );
  const matchedRule = matchedRules[0] ?? null;
  const isEdit = !!existing || (!isMulti && !!matchedRule);

  /* Hydrate state from the matched rule the first time it's encountered so
   * the user can immediately see and tweak the existing requirements. Only
   * runs in single-segment mode — multi-select keeps a fresh blank Stage 2
   * since the user is explicitly batching new rules. */
  useEffect(() => {
    if (!existing && !isMulti && matchedRule) {
      setReg(matchedRule.regulatory_status);
      setDocSel(matchedRule.doc_selections ?? {});
    }
  }, [matchedRule, existing, isMulti]);

  const segments = useMemo(() => reg ? boot.segments.filter(s => s.regulatory_status === reg) : [], [reg, boot.segments]);
  const selSeg   = useMemo(() => segCodes.length === 1 ? (boot.segments.find(s => s.code === segCodes[0]) ?? null) : null, [segCodes, boot.segments]);

  const toggleSegCode = (code: string, on: boolean) => {
    setSegCodes(prev => on ? Array.from(new Set([...prev, code])) : prev.filter(c => c !== code));
  };
  const selectAllSegments = () => setSegCodes(segments.map(s => s.code));
  const clearAllSegments  = () => setSegCodes([]);

  const goStage2 = () => {
    if (!reg)              { alert('Please select a Regulatory Status to continue.'); return; }
    if (segCodes.length === 0) { alert(isMulti ? 'Pick at least one segment to continue.' : 'Please select a Segment to continue.'); return; }
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
    if (!reg || segCodes.length === 0) return;
    setSaving(true);
    try {
      /* Build one payload per picked segment. Each rule gets its own
       * segment-specific authority list (auto-mapped from the prototype
       * lookup) while sharing the Stage 2 doc selections — that's the
       * "configure once, apply to many" semantics the multi-select is
       * for. Pre-existing rules in the selection become PUTs; new ones
       * POSTs. */
      const rows = segCodes.map(code => {
        const segAuths = authsForSegment(code, boot.authorities).map(a => a.code);
        const existingRow = existingRules.find(r => r.id !== existing?.id && r.segment_code === code);
        return {
          form: { segment_code: code, regulatory_status: reg, auths: segAuths, doc_selections: docSel },
          ruleId: existing?.id && existing.segment_code === code ? existing.id : existingRow?.id,
        };
      });
      if (rows.length > 1 && onBulkSave) {
        await Promise.resolve(onBulkSave(rows));
      } else {
        // Single-segment OR no bulk handler: fall through to per-row onSave.
        // Multi without onBulkSave still works but the parent will reload N
        // times — acceptable as a fallback, never hit in our current wiring.
        for (const r of rows) await Promise.resolve(onSave(r.form, r.ruleId));
      }
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal" style={{ maxWidth: 1080, width: '100%' }}>
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
        <div className="dcp-stage-strip" style={{ background: '#fff', padding: '10px 18px', borderBottom: '1px solid rgba(6,182,212,.09)', display: 'flex', alignItems: 'center', gap: 0 }}>
          <div className={`dcp-stage-tile ${stage === 1 ? 'dcp-stage-tile-active' : stage > 1 ? 'dcp-stage-tile-done' : 'dcp-stage-tile-pending'}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 11, background: stage === 1 ? 'linear-gradient(135deg, #0891b2, #0e7490)' : stage > 1 ? 'rgba(240,253,250,.9)' : 'rgba(241,245,249,.7)', border: stage > 1 ? '1.5px solid rgba(34,197,94,.28)' : 'none', cursor: stage > 1 ? 'pointer' : 'default' }} onClick={() => stage > 1 && setStage(1)}>
            <div className={stage === 1 ? 'dcp-stage-tile-num-active' : stage > 1 ? 'dcp-stage-tile-num-done' : 'dcp-stage-tile-num-pending'} style={{ width: 26, height: 26, borderRadius: 7, background: stage === 1 ? 'rgba(255,255,255,.18)' : stage > 1 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#e2e8f0', border: stage === 1 ? '1.5px solid rgba(255,255,255,.32)' : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>
              {stage > 1 ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8"><polyline points="20 6 9 17 4 12"/></svg> : '1'}
            </div>
            <div>
              <div className="dcp-stage-tile-title" style={{ fontSize: 11.5, fontWeight: 800, color: stage === 1 ? '#fff' : stage > 1 ? '#15803d' : '#94a3b8' }}>Segment & Authority</div>
              <div className="dcp-stage-tile-sub" style={{ fontSize: 9, color: stage === 1 ? 'rgba(255,255,255,.7)' : stage > 1 ? '#16a34a' : '#b0bec5' }}>Regulatory status, segment & authorities</div>
            </div>
          </div>
          <div style={{ width: 32, height: 2, background: 'linear-gradient(90deg, #0891b2, rgba(6,182,212,.3))', margin: '0 8px' }} />
          <div className={`dcp-stage-tile ${stage === 2 ? 'dcp-stage-tile-active' : 'dcp-stage-tile-pending'}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 11, background: stage === 2 ? 'linear-gradient(135deg, #0891b2, #0e7490)' : 'rgba(241,245,249,.7)' }}>
            <div className={stage === 2 ? 'dcp-stage-tile-num-active' : 'dcp-stage-tile-num-pending'} style={{ width: 26, height: 26, borderRadius: 7, background: stage === 2 ? 'rgba(255,255,255,.18)' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: stage === 2 ? '#fff' : '#94a3b8' }}>2</div>
            <div>
              <div className="dcp-stage-tile-title" style={{ fontSize: 11.5, fontWeight: 800, color: stage === 2 ? '#fff' : '#94a3b8' }}>CLM Documents</div>
              <div className="dcp-stage-tile-sub" style={{ fontSize: 9, color: stage === 2 ? 'rgba(255,255,255,.7)' : '#b0bec5' }}>Assign document requirements per category</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="dcp-step-badge" style={{ fontSize: 9.5, fontWeight: 700, color: '#0891b2', background: 'rgba(8,145,178,.07)', border: '1px solid rgba(8,145,178,.16)', borderRadius: 20, padding: '3px 9px' }}>Step {stage} of 2</div>
        </div>

        <div className="clm-modal-body" style={{ maxHeight: '70vh' }}>
          {stage === 1 ? (
            <>
              {/* Card 1: Regulatory Status + Segment Select */}
              <div className="dcp-modal-card" style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                <div className="dcp-modal-card-head" style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Segment Regulatory Status</span>
                  <span className="clm-req">*</span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
                  {(['highly','less'] as const).map(v => {
                    const on = reg === v;
                    const hi = v === 'highly';
                    return (
                      <label key={v} className={`dcp-radio-label ${on ? (hi ? 'dcp-radio-label-on-highly' : 'dcp-radio-label-on-less') : ''}`} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${on ? (hi ? 'rgba(239,68,68,.38)' : 'rgba(34,197,94,.32)') : 'rgba(203,213,225,.38)'}`, background: on ? (hi ? 'rgba(254,242,242,.45)' : 'rgba(240,253,244,.45)') : 'rgba(248,250,252,.5)', cursor: existing ? 'not-allowed' : 'pointer', opacity: existing && !on ? 0.55 : 1, transition: 'all .15s' }}
                        onClick={() => { if (existing) return; setReg(v); setSegCodes([]); }}>
                        <input type="radio" checked={on} onChange={() => {}} disabled={!!existing} style={{ accentColor: hi ? '#ef4444' : '#16a34a', width: 14, height: 14 }} />
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: hi ? '#ef4444' : '#22c55e' }} />
                        <div>
                          <div className="dcp-radio-title" style={{ fontSize: 12, fontWeight: 700, color: on ? (hi ? '#991b1b' : '#166534') : '#1e293b' }}>{hi ? 'High Regulatory' : 'Less Regulatory'}</div>
                          <div className="dcp-radio-sub" style={{ fontSize: 9, color: on ? (hi ? '#b91c1c' : '#15803d') : '#94a3b8', marginTop: 2 }}>{hi ? 'Requires specific segment & compliance review' : 'Pick one or many — each becomes its own rule row'}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {reg && (
                  <div className={reg === 'highly' ? 'dcp-select-seg-highly' : 'dcp-select-seg-less'} style={{ margin: '0 12px 12px', padding: '11px 12px', background: reg === 'highly' ? 'linear-gradient(110deg, rgba(239,68,68,.03), rgba(254,242,242,.4))' : 'linear-gradient(110deg, rgba(22,163,74,.03), rgba(240,253,244,.4))', border: `1px solid ${reg === 'highly' ? 'rgba(239,68,68,.15)' : 'rgba(22,163,74,.15)'}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                      <div style={{ fontSize: 8.5, fontWeight: 800, color: reg === 'highly' ? '#dc2626' : '#15803d', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {isMulti ? 'Select Segments (multi)' : 'Select Segment'} <span className="clm-req">*</span>
                      </div>
                      {isMulti && segments.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: '#15803d' }}>
                          <span style={{ fontWeight: 700 }}>{segCodes.length} of {segments.length} picked</span>
                          <button type="button" onClick={selectAllSegments} style={{ background: 'transparent', border: '1px solid rgba(22,163,74,.32)', color: '#15803d', fontWeight: 700, fontSize: 9.5, borderRadius: 5, padding: '2px 7px', cursor: 'pointer' }}>Select all</button>
                          <button type="button" onClick={clearAllSegments} disabled={segCodes.length === 0} style={{ background: 'transparent', border: '1px solid rgba(148,163,184,.32)', color: '#64748b', fontWeight: 700, fontSize: 9.5, borderRadius: 5, padding: '2px 7px', cursor: segCodes.length === 0 ? 'not-allowed' : 'pointer', opacity: segCodes.length === 0 ? 0.5 : 1 }}>Clear</button>
                        </div>
                      )}
                    </div>

                    {isMulti ? (
                      segments.length === 0 ? (
                        <div style={{ padding: '12px', fontSize: 11, color: '#64748b', background: 'rgba(248,250,252,.6)', borderRadius: 7, border: '1px dashed rgba(148,163,184,.4)' }}>
                          No less-regulated segments configured yet. Add them in <em>CLM → Segment Master</em> first.
                        </div>
                      ) : (
                        <div className="dcp-multi-seg-list" style={{ maxHeight: 168, overflowY: 'auto', background: '#fff', border: '1px solid rgba(22,163,74,.18)', borderRadius: 8, padding: 4 }}>
                          {segments.map(s => {
                            const checked = segCodes.includes(s.code);
                            const has = existingRules.some(r => r.segment_code === s.code);
                            return (
                              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 6, cursor: 'pointer', background: checked ? 'rgba(22,163,74,.07)' : 'transparent', border: `1px solid ${checked ? 'rgba(22,163,74,.22)' : 'transparent'}`, marginBottom: 2 }}>
                                <input type="checkbox" checked={checked} onChange={e => toggleSegCode(s.code, e.target.checked)} style={{ accentColor: '#16a34a', width: 14, height: 14 }} />
                                <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, fontWeight: 700, color: '#0c4a6e', minWidth: 48 }}>{s.code}</span>
                                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{s.name}</span>
                                {has && <span style={{ fontSize: 8.5, fontWeight: 800, color: '#92400e', background: 'rgba(217,119,6,.12)', border: '1px solid rgba(217,119,6,.28)', padding: '1px 6px', borderRadius: 4 }}>HAS RULE</span>}
                              </label>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <MasterSelect
                        value={segCode}
                        onChange={(v) => setSegCodes(v ? [v] : [])}
                        disabled={!!existing}
                        placeholder={`— Choose a ${reg === 'highly' ? 'Highly' : 'Less'} Regulated Segment —`}
                        options={segments.map(s => ({ value: s.code, label: `${s.name} (${s.code})` }))}
                      />
                    )}

                    {!existing && matchedRules.length > 0 && (
                      <div style={{ marginTop: 9, display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', background: 'linear-gradient(110deg, rgba(251,191,36,.10), rgba(254,243,199,.55))', border: '1.5px solid rgba(217,119,6,.32)', borderRadius: 9 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <div style={{ fontSize: 11, color: '#92400e', lineHeight: 1.45 }}>
                          {isMulti
                            ? <><strong style={{ color: '#78350f' }}>{matchedRules.length} of the picked segments already have a rule</strong> ({matchedRules.map(r => `${r.segment_code} → ${r.rule_code}`).join(', ')}). Those will be updated; the rest will be created as new rows.</>
                            : <><strong style={{ color: '#78350f' }}>A rule already exists for this segment ({matchedRule!.rule_code}).</strong> One rule per segment is allowed — you're now editing that rule. Save will update it instead of creating a new one.</>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Card 2: Segment Details */}
              {selSeg && (
                <div className="dcp-modal-card" style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                  <div className="dcp-modal-card-head" style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Segment Details</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 0 }}>
                    <div className="dcp-segdtl-cell" style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Segment ID</div>
                      <div className="dcp-segdtl-val" style={{ fontFamily: "'Geist Mono', monospace", fontSize: 14, fontWeight: 800, color: '#0c4a6e' }}>{selSeg.code}</div>
                    </div>
                    <div className="dcp-segdtl-cell" style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Segment Name</div>
                      <div className="dcp-segdtl-val" style={{ fontSize: 12, fontWeight: 700, color: '#0c4a6e' }}>{selSeg.name}</div>
                    </div>
                    <div className="dcp-segdtl-cell" style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Regulatory</div>
                      <span className={`clm-badge ${reg === 'highly' ? 'clm-badge-red' : 'clm-badge-emerald'}`}><span className="clm-badge-dot" />{reg === 'highly' ? 'High' : 'Less'}</span>
                    </div>
                    <div style={{ padding: '10px 14px' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Buyer ≠ Consignee</div>
                      <span className={`clm-badge ${selSeg.buyer_consignee === 'allowed' ? 'clm-badge-green' : 'clm-badge-red'}`}>{selSeg.buyer_consignee === 'allowed' ? 'Allowed' : 'Not Allowed'}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Stage 2: Document selection per category
            <div>
              <div className="dcp-cat-tabs" style={{ display: 'flex', gap: 2, padding: 4, background: 'rgba(240,253,255,.9)', border: '1.5px solid rgba(6,182,212,.15)', borderRadius: 13, overflowX: 'auto' }}>
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

              <div className="dcp-doc-card" style={{ marginTop: 8, border: '1.5px solid rgba(6,182,212,.15)', borderRadius: 14, overflow: 'hidden' }}>
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
                    <thead>
                      <tr className="dcp-thead-row" style={{ background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1.5px solid rgba(6,182,212,.12)' }}>
                        <th style={{ width: 36, padding: '9px 4px 9px 14px', textAlign: 'left' }}></th>
                        <th style={{ width: 36, padding: '9px 4px', textAlign: 'center' }}></th>
                        <th style={{ width: 100, padding: '9px 8px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Code</span></th>
                        <th style={{ padding: '9px 12px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Document Name</span></th>
                        <th style={{ padding: '9px 12px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Authority / Type</span></th>
                        <th style={{ width: 200, padding: '9px 16px', textAlign: 'right' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Requirement</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {catData[activeCat].map((d, i) => {
                        const sel = docSel[activeCat]?.[d.code];
                        const isM = sel === 'M', isO = sel === 'O';
                        const checked = isM || isO;
                        return (
                          <tr key={d.id}>
                            <td className="clm-td-num">{String(i + 1).padStart(2, '0')}</td>
                            <td style={{ width: 36, textAlign: 'center', padding: '6px 4px' }}>
                              <label className="clm-doc-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => setDocReq(activeCat, d.code, e.target.checked ? (sel ?? 'M') : null)}
                                />
                                <span className="clm-doc-check-box">
                                  {checked && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                  )}
                                </span>
                              </label>
                            </td>
                            <td style={{ width: 100 }}><span className="clm-code-pill">{d.code}</span></td>
                            <td className="clm-td-name">{d.name || d.title}</td>
                            <td className="clm-td-desc">{d.authority || d.issued_by || '—'}</td>
                            <td style={{ width: 200, textAlign: 'right' }}>
                              <div className={`dcp-req-group ${isM ? 'dcp-req-group-mand' : isO ? 'dcp-req-group-opt' : ''}`} style={{ display: 'inline-flex', borderRadius: 9, overflow: 'hidden', border: `1.5px solid ${isM ? 'rgba(6,182,212,.35)' : isO ? 'rgba(245,158,11,.35)' : 'rgba(203,213,225,.4)'}` }}>
                                <button className={isM ? 'dcp-req-btn-on' : 'dcp-req-btn-off'} onClick={() => setDocReq(activeCat, d.code, isM ? null : 'M')} style={{ padding: '5px 14px', border: 'none', borderRight: '1px solid rgba(203,213,225,.35)', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: isM ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : 'rgba(248,250,252,.8)', color: isM ? '#fff' : '#94a3b8' }}>Mandatory</button>
                                <button className={isO ? 'dcp-req-btn-on' : 'dcp-req-btn-off'} onClick={() => setDocReq(activeCat, d.code, isO ? null : 'O')} style={{ padding: '5px 14px', border: 'none', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: isO ? 'linear-gradient(135deg, #fbbf24, #d97706)' : 'rgba(248,250,252,.8)', color: isO ? '#fff' : '#94a3b8' }}>Optional</button>
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

/* ─── Per-page CSS for count/total buttons ─── */
const DCP_PAGE_CSS = `
.clm-count-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 26px; padding: 0 9px;
  font-family: inherit; font-size: 11px; font-weight: 800;
  color: #0891b2; background: rgba(8,145,178,.08);
  border: 1.5px solid rgba(6,182,212,.22); border-radius: 14px;
  cursor: pointer; transition: all .14s;
}
.clm-count-btn:hover {
  background: rgba(8,145,178,.18); transform: scale(1.07);
  box-shadow: 0 3px 10px rgba(6,182,212,.22);
}
.clm-total-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 11px; font-family: inherit; font-size: 11px; font-weight: 800;
  color: #0c4a6e; background: rgba(239,68,68,.05);
  border: 1.5px solid rgba(239,68,68,.22); border-radius: 18px;
  cursor: pointer; transition: all .14s; white-space: nowrap;
}
.clm-total-btn:hover {
  background: rgba(239,68,68,.12); transform: scale(1.05);
  box-shadow: 0 3px 10px rgba(239,68,68,.18);
}
.clm-doc-check {
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none;
}
.clm-doc-check input { position: absolute; opacity: 0; width: 0; height: 0; }
.clm-doc-check-box {
  width: 18px; height: 18px; border-radius: 5px;
  border: 1.5px solid rgba(203,213,225,.7);
  background: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .14s;
}
.clm-doc-check:hover .clm-doc-check-box { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.12); }
.clm-doc-check input:checked + .clm-doc-check-box {
  background: linear-gradient(135deg,#06b6d4,#0891b2);
  border-color: #0891b2;
  box-shadow: 0 2px 6px rgba(8,145,178,.28);
}

/* DocListPopup — section header strip (Mandatory / Optional) and rows.
   Defined as classes so dark mode can override the light gradient bg
   that otherwise renders as a stark white strip on the dark theme. */
.dcp-sec-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 22px;
  border-top: 1px solid rgba(6,182,212,.1);
  border-bottom: 1px solid rgba(6,182,212,.12);
}
.dcp-sec-head.mandatory {
  background: linear-gradient(110deg,#f0fdff,#e8f9fd);
  color: #0891b2;
}
.dcp-sec-head.optional {
  background: linear-gradient(110deg,#fffbeb,#fef9ee);
  border-top-color: rgba(245,158,11,.1);
  border-bottom-color: rgba(245,158,11,.12);
  color: #d97706;
}
.dcp-sec-head-label { font-size: 8px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: inherit; }
.dcp-sec-head-count {
  font-size: 9px; font-weight: 800; color: #fff;
  padding: 1px 7px; border-radius: 9px;
}
.dcp-sec-head.mandatory .dcp-sec-head-count { background: linear-gradient(135deg,#06b6d4,#0891b2); }
.dcp-sec-head.optional  .dcp-sec-head-count { background: linear-gradient(135deg,#fbbf24,#d97706); }

.dcp-doc-name { font-size: 13px; font-weight: 700; color: #0c4a6e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcp-doc-auth { font-size: 10px; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcp-doc-idx  { font-size: 10px; font-weight: 700; color: #c0d4e0; width: 22px; text-align: right; flex-shrink: 0; }

.dcp-foot-text { font-size: 11px; color: #0891b2; opacity: .75; }
.dcp-foot-text b { color: #0c4a6e; font-weight: 700; opacity: 1; }

/* Dark mode — recolour the strips and text so nothing is a stark white
   slab against the navy modal body. */
[data-bs-theme="dark"] .dcp-sec-head.mandatory {
  background: linear-gradient(110deg, rgba(8,145,178,.18), rgba(8,145,178,.10));
  border-top-color: rgba(6,182,212,.22);
  border-bottom-color: rgba(6,182,212,.22);
  color: #67e8f9;
}
[data-bs-theme="dark"] .dcp-sec-head.optional {
  background: linear-gradient(110deg, rgba(245,158,11,.18), rgba(245,158,11,.10));
  border-top-color: rgba(245,158,11,.22);
  border-bottom-color: rgba(245,158,11,.22);
  color: #fbbf24;
}
[data-bs-theme="dark"] .dcp-doc-row { border-bottom-color: rgba(255,255,255,.06) !important; }
[data-bs-theme="dark"] .dcp-doc-name { color: #e2e8f0; }
[data-bs-theme="dark"] .dcp-doc-auth { color: #94a3b8; }
[data-bs-theme="dark"] .dcp-doc-idx  { color: #64748b; }
[data-bs-theme="dark"] .dcp-foot-text { color: #67e8f9; }
[data-bs-theme="dark"] .dcp-foot-text b { color: #e2e8f0; }
`;

/* ─── DocListPopup — opens when a count or total cell is clicked ─── */

function DocListPopup(props: {
  rule: SegRule;
  cat: keyof DocSelections | 'all';
  boot: Bootstrap;
  onClose: () => void;
}) {
  const { rule, cat, boot, onClose } = props;
  const isAll = cat === 'all';

  const seg = boot.segments.find(s => s.code === rule.segment_code);
  const segName = seg?.name ?? rule.segment_code;
  const catData: Record<keyof DocSelections, DocItem[]> = {
    kyc: boot.kyc, dd: boot.dd, tl: boot.tl, td: boot.td, qc: boot.qc,
  };

  /* Flatten selected docs across one (or all) categories. In all-mode each
   * row is tagged with its source category so the popup can show a pill. */
  type Row = DocItem & { __cat: keyof DocSelections; __req: 'M' | 'O' };
  const mand: Row[] = [];
  const opt: Row[]  = [];
  const cats: Array<keyof DocSelections> = isAll ? CAT_KEYS : [cat as keyof DocSelections];
  for (const c of cats) {
    const sel = rule.doc_selections?.[c] ?? {};
    for (const d of catData[c]) {
      const v = sel[d.code];
      if (v === 'M') mand.push({ ...d, __cat: c, __req: 'M' });
      else if (v === 'O') opt.push({ ...d, __cat: c, __req: 'O' });
    }
  }
  const totalSel = mand.length + opt.length;
  const universe = isAll
    ? CAT_KEYS.reduce((n, c) => n + catData[c].length, 0)
    : catData[cat as keyof DocSelections].length;

  const catLabel = isAll ? 'All' : CAT_LABELS[cat as keyof DocSelections];

  const renderRow = (d: Row, idx: number, isLast: boolean) => (
    <div key={`${d.__cat}-${d.code}`} className="dcp-doc-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 22px', borderBottom: isLast ? 'none' : '1px solid rgba(6,182,212,.07)' }}>
      <span className="dcp-doc-idx">{String(idx + 1).padStart(2, '0')}</span>
      <span className="clm-code-pill" style={{ flexShrink: 0 }}>{d.code}</span>
      {isAll && (
        <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 8.5, fontWeight: 800, color: '#4f46e5', background: 'rgba(99,102,241,.08)', padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(99,102,241,.2)', whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '.05em', textTransform: 'uppercase' }}>
          {CAT_LABELS[d.__cat]}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="dcp-doc-name">{d.name || d.title}</div>
        <div className="dcp-doc-auth">{d.authority || d.issued_by || '—'}</div>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        background: d.__req === 'M' ? 'rgba(8,145,178,.09)' : 'rgba(245,158,11,.09)',
        color: d.__req === 'M' ? '#0891b2' : '#d97706',
        border: `1.5px solid ${d.__req === 'M' ? 'rgba(6,182,212,.28)' : 'rgba(245,158,11,.28)'}`
      }}>
        {d.__req === 'M' ? 'Mandatory' : 'Optional'}
      </span>
    </div>
  );

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose} style={{ zIndex: 200000 }}>
      <div className="clm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '100%' }}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }}>{segName}</div>
              <div className="clm-modal-head-title">{catLabel} Documents</div>
              <div className="clm-modal-head-sub">{totalSel} document{totalSel === 1 ? '' : 's'} configured</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {mand.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'rgba(6,182,212,.28)', border: '1px solid rgba(255,255,255,.3)', padding: '5px 13px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {mand.length} Mandatory
              </span>
            )}
            {opt.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'rgba(251,191,36,.28)', border: '1px solid rgba(251,191,36,.32)', padding: '5px 13px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="5"/></svg>
                {opt.length} Optional
              </span>
            )}
            <button className="clm-modal-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="dcp-doc-card" style={{ flex: 1, overflowY: 'auto', maxHeight: '60vh' }}>
          {totalSel === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '48px 24px' }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, background: 'rgba(8,145,178,.07)', border: '1.5px solid rgba(6,182,212,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0891b2' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e' }}>No documents configured</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center' }}>No {isAll ? '' : catLabel + ' '}documents have been assigned<br/>for this segment rule.</div>
            </div>
          ) : (
            <>
              {mand.length > 0 && (
                <>
                  <div className="dcp-sec-head mandatory">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span className="dcp-sec-head-label">Mandatory</span>
                    <span className="dcp-sec-head-count">{mand.length}</span>
                  </div>
                  {mand.map((d, i) => renderRow(d, i, i === mand.length - 1))}
                </>
              )}
              {opt.length > 0 && (
                <>
                  <div className="dcp-sec-head optional">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/></svg>
                    <span className="dcp-sec-head-label">Optional</span>
                    <span className="dcp-sec-head-count">{opt.length}</span>
                  </div>
                  {opt.map((d, i) => renderRow(d, i, i === opt.length - 1))}
                </>
              )}
            </>
          )}
        </div>

        <div className="clm-modal-foot" style={{ justifyContent: 'space-between' }}>
          <span className="dcp-foot-text">
            <b>{totalSel}</b> of <b>{universe}</b> documents configured
          </span>
          <button className="clm-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}