import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { MasterSelect } from '../../components/ui/MasterSelect';

/* Central CLM → Segment Master.
 * Faithful 3-card port of the CLM-Master.html prototype:
 *   Card 1 — cyan gradient header strip with Add Segment
 *   Card 2 — expandable "What We Are Doing Here" steps
 *   Card 3 — tabs (All/Highly/Less) + search + table + pagination
 */

export type Reg = 'highly' | 'less';
export type BC  = 'allowed' | 'not_allowed';
export type SegStatus = 'active' | 'inactive';

export type Segment = {
  id: number; code: string; name: string;
  regulatory_status: Reg; buyer_consignee: BC; status: SegStatus;
};
type Counts = { all: number; highly: number; less: number };

export type SegmentForm = {
  name: string;
  regulatory_status: Reg;
  buyer_consignee: BC;
  status: SegStatus;
};

export type SaveResult = { ok: true } | { ok: false; fieldErrors?: Record<string, string> };

/**
 * Mirrors the backend allocator in ClmSegmentController::nextCode — walks
 * past max(existing S-### suffix) + 1, skipping any taken codes. Naive
 * `rows.length + 1` previews drift whenever the sequence has gaps (after
 * deletes or after the consolidate-segments migration merged legacy rows).
 */
export function nextSegmentCode(rows: { code: string }[]): string {
  let maxN = 0;
  const taken = new Set<string>();
  for (const r of rows) {
    const m = /^S-(\d+)$/.exec(r.code ?? '');
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
    if (r.code) taken.add(r.code);
  }
  let n = maxN;
  let code: string;
  do {
    n++;
    code = `S-${String(n).padStart(3, '0')}`;
  } while (taken.has(code));
  return code;
}

export default function ClmSegmentPage() {
  const toast = useToast();

  const [rows, setRows]       = useState<Segment[]>([]);
  const [counts, setCounts]   = useState<Counts>({ all: 0, highly: 0, less: 0 });
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState<'all'|'highly'|'less'>('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);

  const [editing, setEditing]     = useState<Segment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Segment | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ status: boolean; data: Segment[]; counts: Counts }>('/clm/segments')
      .then(({ data }) => { setRows(data.data ?? []); setCounts(data.counts ?? { all: 0, highly: 0, less: 0 }); })
      .catch(() => toast.error('Load failed', 'Could not load segments'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const base = tab === 'all' ? rows : tab === 'highly' ? rows.filter(r => r.regulatory_status === 'highly') : rows.filter(r => r.regulatory_status === 'less');
    if (!search.trim()) return base;
    const s = search.toLowerCase();
    return base.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, tab, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: SegmentForm, id?: number): Promise<SaveResult> => {
    try {
      if (id) { await api.put(`/clm/segments/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/segments', form);     toast.success('Added',   `${form.name} added`); }
      setModalOpen(false); setEditing(null); reload();
      return { ok: true };
    } catch (e: any) {
      const status = e?.response?.status as number | undefined;
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      const message = first ?? e?.response?.data?.message ?? 'Could not save';
      toast.error('Save failed', message);
      // Surface duplicate-name conflict back to the modal so it can highlight
      // the Name field inline instead of relying on the transient toast.
      if (status === 409 && /already exists/i.test(message)) {
        return { ok: false, fieldErrors: { name: message } };
      }
      if (err?.name?.[0]) {
        return { ok: false, fieldErrors: { name: err.name[0] } };
      }
      return { ok: false };
    }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/segments/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      <ClmPageHeader
        icon={ICO.hSeg}
        title="Segment Master"
        sub="Manage business segments, regulatory classifications, and trade compliance structures."
        addLabel="Add Segment"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bSeg}
        label="Segment Master"
        sub="Manage segment-wise trade, regulatory, and operational structures."
        steps={[
          { n: '01', title: 'Create Segment',                       desc: 'Create business or trade segments to classify operations and contracts.', icon: ICO.grid },
          { n: '02', title: 'Set Regulatory Status',                desc: 'Define the regulatory classification applicable to this segment.',       icon: ICO.shield },
          { n: '03', title: 'Configure Buyer & Consignee Rule',     desc: 'Define whether Buyer ≠ Consignee is allowed for this segment.',          icon: ICO.users },
          { n: '04', title: 'Enable Operational Usage',             desc: 'Activate segment for use across contracts and operational workflows.',   icon: ICO.check },
        ]}
      />

      {/* ── Card 3: Tabs + Table ── */}
      <div className="clm-page-card">
        <div className="clm-tabs-wrap">
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
              <span className="clm-tab-dot" style={{ background: '#0d9488', boxShadow: '0 0 5px rgba(13,148,136,.5)' }} />
              Less Regulated <span className="clm-tab-count">{counts.less}</span>
            </button>
              <div className="clm-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input type="text" placeholder="Search segments…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <div className="clm-total">
            <div className="clm-total-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg></div>
            <div className="clm-total-lbl">Total Segments</div>
            <div className="clm-total-num">{2}</div>
          </div>
          </div>

          <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
            {slice.length === 0 ? (
              <div className="clm-empty">
                <div className="clm-empty-ico">{ICO.bSeg}</div>
                <div className="clm-empty-title">
                  {tab === 'all'    && 'No Segments Yet'}
                  {tab === 'highly' && 'No Highly Regulated Segments'}
                  {tab === 'less'   && 'No Less Regulated Segments'}
                </div>
                <div className="clm-empty-sub">{rows.length === 0 ? 'Click "+ Add Segment" to create your first segment entry.' : 'No segments match the current tab / search.'}</div>
              </div>
            ) : (
              <div className="clm-table-wrap">
                <table className="clm-table">
                  <thead><tr>
                    <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                    <th style={{ width: 110, textAlign: 'center' }}>SEGMENT ID</th>
                    <th>SEGMENT NAME</th>
                    <th style={{ width: 170, textAlign: 'center' }}>REGULATORY STATUS</th>
                    <th style={{ width: 150, textAlign: 'center' }}>BUYER ≠ CONSIGNEE</th>
                    <th style={{ width: 90,  textAlign: 'center' }}>ACTIONS</th>
                  </tr></thead>
                  <tbody>
                    {loading && <tr><td colSpan={6} className="clm-status">Loading segments…</td></tr>}
                    {!loading && slice.map((r, i) => (
                      <tr key={r.id}>
                        <td className="clm-td-num">{start + i + 1}</td>
                        <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                        <td className="clm-td-name">{r.name}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`clm-badge ${r.regulatory_status === 'highly' ? 'clm-badge-red' : 'clm-badge-emerald'}`}>
                            <span className="clm-badge-dot" />
                            {r.regulatory_status === 'highly' ? 'Highly Regulated' : 'Less Regulated'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`clm-badge ${r.buyer_consignee === 'allowed' ? 'clm-badge-green' : 'clm-badge-red'}`}>
                            <span className="clm-badge-dot" />
                            {r.buyer_consignee === 'allowed' ? 'Allowed' : 'Not Allowed'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="clm-actions">
                            <Tooltip label="Edit segment">
                              <button type="button" aria-label="Edit segment" className="clm-act clm-act-edit" onClick={() => { setEditing(r); setModalOpen(true); }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete segment">
                              <button type="button" aria-label="Delete segment" className="clm-act clm-act-del" onClick={() => setPendingDelete(r)}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && filtered.length > 0 && (
                  <div className="clm-pag">
                    <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b> record{filtered.length === 1 ? '' : 's'}</span>
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
      </div>

      {modalOpen && (
        <SegmentModal
          existing={editing}
          nextCode={nextSegmentCode(rows)}
          existingNames={rows
            .filter(r => r.id !== editing?.id)
            .map(r => r.name)}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form) => onSave(form, editing?.id)}
        />
      )}

      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete Segment"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This segment will be permanently removed. The action cannot be undone."
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}

export function SegmentModal(props: { existing: Segment | null; nextCode: string; existingNames?: string[]; onClose: () => void; onSave: (f: SegmentForm) => SaveResult | Promise<SaveResult> | void | Promise<void>; }) {
  const { existing, nextCode, existingNames = [], onClose, onSave } = props;
  const isEdit = !!existing;

  const [name, setName]     = useState(existing?.name ?? '');
  const [reg, setReg]       = useState<Reg | ''>(existing?.regulatory_status ?? '');
  const [bc, setBc]         = useState<BC  | ''>(existing?.buyer_consignee   ?? '');
  // Status is no longer user-editable in the modal — preserve the existing
  // value on edit, default to 'active' on add. Backend still receives it.
  const status: SegStatus = existing?.status ?? 'active';
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    const next: Record<string, string> = {};
    if (!trimmed) next.name = 'Name is required';
    else {
      const lower = trimmed.toLowerCase();
      if (existingNames.some(n => n.trim().toLowerCase() === lower)) {
        next.name = `A segment named "${trimmed}" already exists. Pick a different name.`;
      }
    }
    if (!reg) next.reg = 'Regulatory status is required';
    if (!bc)  next.bc  = 'Buyer / Consignee rule is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const result = await Promise.resolve(onSave({
        name: trimmed,
        regulatory_status: reg as Reg,
        buyer_consignee: bc as BC,
        status,
      }));
      if (result && result.ok === false && result.fieldErrors) {
        setErrors(prev => ({ ...prev, ...result.fieldErrors }));
      }
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">{isEdit ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            )}</div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Segment' : 'Add New Segment'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the segment details below.' : 'Define a business or trade segment with regulatory classification and buyer-consignee rules.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Segment Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Segment Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. Tobacco, Rice, Food Grade Ethanol" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && (
              /already exists/i.test(errors.name) ? (
                <div role="alert" style={{
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: 12,
                  lineHeight: 1.4,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span><strong>Duplicate segment.</strong> {errors.name}</span>
                </div>
              ) : (
                <div className="clm-err">{errors.name}</div>
              )
            )}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Regulatory Status <span className="clm-req">*</span></label>
            <MasterSelect
              value={reg}
              invalid={!!errors.reg}
              placeholder="— Select —"
              options={[
                { value: 'highly', label: 'Highly Regulated' },
                { value: 'less',   label: 'Less Regulated' },
              ]}
              onChange={(v) => { setReg(v as Reg); setErrors(p => ({ ...p, reg: '' })); }}
            />
            {errors.reg && <div className="clm-err">{errors.reg}</div>}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Buyer ≠ Consignee <span className="clm-req">*</span></label>
            <MasterSelect
              value={bc}
              invalid={!!errors.bc}
              placeholder="— Select —"
              options={[
                { value: 'allowed',     label: 'Allowed' },
                { value: 'not_allowed', label: 'Not Allowed' },
              ]}
              onChange={(v) => { setBc(v as BC); setErrors(p => ({ ...p, bc: '' })); }}
            />
            {errors.bc && <div className="clm-err">{errors.bc}</div>}
          </div>

        </div>

        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Segment' : 'Save Segment')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
