import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Central CLM → Segment Master.
 *
 * Faithful port of the CLM-Master.html prototype's Segment section
 * (legacy lines ~680-1000). Design system: cyan/teal accents, two-tier
 * regulatory tag (Highly Regulated / Less Regulated), buyer-consignee
 * rule (Allowed / Not Allowed), card+table layout with 3 stat tabs.
 *
 * Backed by /clm/segments (tenant-scoped CRUD).
 * ───────────────────────────────────────────────────────────────────────── */

type Reg = 'highly' | 'less';
type BC  = 'allowed' | 'not_allowed';

type Segment = {
  id:                number;
  code:              string;
  name:              string;
  regulatory_status: Reg;
  buyer_consignee:   BC;
  status:            'active' | 'inactive';
};

type Counts = { all: number; highly: number; less: number };

const PER_PAGE = 10;

export default function ClmSegmentPage() {
  const toast = useToast();

  const [rows, setRows]       = useState<Segment[]>([]);
  const [counts, setCounts]   = useState<Counts>({ all: 0, highly: 0, less: 0 });
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState<'all' | 'highly' | 'less'>('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);

  // Modal state
  const [editing, setEditing] = useState<Segment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Delete confirm state
  const [pendingDelete, setPendingDelete] = useState<Segment | null>(null);

  /* ── Load ────────────────────────────────────────────────────── */
  const reload = () => {
    setLoading(true);
    api.get<{ status: boolean; data: Segment[]; counts: Counts }>('/clm/segments')
      .then(({ data }) => {
        setRows(data.data ?? []);
        setCounts(data.counts ?? { all: 0, highly: 0, less: 0 });
      })
      .catch(() => toast.error('Load failed', 'Could not load segments'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Tab + search + paginate ─────────────────────────────────── */
  const filtered = useMemo(() => {
    const base = tab === 'all' ? rows
      : tab === 'highly' ? rows.filter(r => r.regulatory_status === 'highly')
      : rows.filter(r => r.regulatory_status === 'less');
    if (!search.trim()) return base;
    const s = search.toLowerCase();
    return base.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, tab, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage  = Math.min(page, pageCount);
  const start     = (safePage - 1) * PER_PAGE;
  const slice     = filtered.slice(start, start + PER_PAGE);

  /* ── Save handler (create + update) ──────────────────────────── */
  const onSave = async (form: { name: string; regulatory_status: Reg; buyer_consignee: BC }, id?: number) => {
    try {
      if (id) {
        await api.put(`/clm/segments/${id}`, form);
        toast.success('Updated', `${form.name} saved`);
      } else {
        await api.post('/clm/segments', form);
        toast.success('Added', `${form.name} added`);
      }
      setModalOpen(false);
      setEditing(null);
      reload();
    } catch (e: any) {
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save segment');
    }
  };

  const onDelete = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(`/clm/segments/${pendingDelete.id}`);
      toast.success('Deleted', `${pendingDelete.name} removed`);
      setPendingDelete(null);
      reload();
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete segment');
    }
  };

  return (
    <div className="seg-root">
      <style>{CSS}</style>

      {/* ── Header card ── */}
      <div className="seg-head-card">
        <div className="seg-head-left">
          <div className="seg-head-ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <div>
            <div className="seg-crumb">Central CLM · Compliance &amp; Regulatory</div>
            <div className="seg-head-title">Segment Master</div>
            <div className="seg-head-sub">Define trade segments with regulatory tier and buyer / consignee rules.</div>
          </div>
        </div>
        <button className="seg-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Segment
        </button>
      </div>

      {/* ── Body card ── */}
      <div className="seg-body-card">
        {/* Tabs */}
        <div className="seg-tabs">
          <button className={`seg-tab ${tab === 'all' ? 'active' : ''}`}    onClick={() => { setTab('all');    setPage(1); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>All Segments</span>
            <span className="seg-tab-count">{counts.all}</span>
          </button>
          <button className={`seg-tab ${tab === 'highly' ? 'active' : ''}`} onClick={() => { setTab('highly'); setPage(1); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Highly Regulated</span>
            <span className="seg-tab-count">{counts.highly}</span>
          </button>
          <button className={`seg-tab ${tab === 'less' ? 'active' : ''}`}   onClick={() => { setTab('less');   setPage(1); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>Less Regulated</span>
            <span className="seg-tab-count">{counts.less}</span>
          </button>

          <div className="seg-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search segments…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Table */}
        <div className="seg-table-wrap">
          <table className="seg-table">
            <thead>
              <tr>
                <th style={{ width: 52,  textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>SEGMENT ID</th>
                <th>SEGMENT NAME</th>
                <th style={{ width: 180, textAlign: 'center' }}>REGULATORY STATUS</th>
                <th style={{ width: 150, textAlign: 'center' }}>BUYER ≠ CONSIGNEE</th>
                <th style={{ width: 90,  textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="seg-status">Loading segments…</td></tr>
              )}
              {!loading && slice.length === 0 && (
                <tr>
                  <td colSpan={6} className="seg-empty">
                    <div className="seg-empty-ico">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                      </svg>
                    </div>
                    <div className="seg-empty-title">
                      {tab === 'all'    && 'No segments yet'}
                      {tab === 'highly' && 'No highly regulated segments'}
                      {tab === 'less'   && 'No less regulated segments'}
                    </div>
                    <div className="seg-empty-sub">
                      {rows.length === 0 ? 'Click + Add Segment to create the first record.' : 'No segments match the current tab / search.'}
                    </div>
                  </td>
                </tr>
              )}
              {!loading && slice.map((r, i) => {
                const n = start + i + 1;
                return (
                  <tr key={r.id}>
                    <td className="seg-td-num">{n}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="seg-code-pill">{r.code}</span>
                    </td>
                    <td className="seg-td-name">{r.name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`seg-reg-pill seg-reg-${r.regulatory_status}`}>
                        <span className="seg-reg-dot" />
                        {r.regulatory_status === 'highly' ? 'Highly Regulated' : 'Less Regulated'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`seg-bc seg-bc-${r.buyer_consignee}`}>
                        {r.buyer_consignee === 'allowed' ? 'Allowed' : 'Not Allowed'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="seg-actions">
                        <button className="seg-act seg-act-edit" title="Edit segment"
                          onClick={() => { setEditing(r); setModalOpen(true); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button className="seg-act seg-act-del" title="Delete segment"
                          onClick={() => setPendingDelete(r)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" /><path d="M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && (
            <div className="seg-pag">
              <span className="seg-pag-info">
                Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b> record{filtered.length === 1 ? '' : 's'}
              </span>
              <div className="seg-pag-btns">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    disabled={p === safePage}
                    className={`seg-pag-btn ${p === safePage ? 'on' : ''}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Edit modal ── */}
      {modalOpen && (
        <SegmentModal
          existing={editing}
          nextCode={`S-${String(rows.length + 1).padStart(3, '0')}`}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form) => onSave(form, editing?.id)}
        />
      )}

      {/* ── Delete confirm ── */}
      {pendingDelete && createPortal((
        <div className="seg-conf-bd" onClick={() => setPendingDelete(null)}>
          <div className="seg-conf" onClick={e => e.stopPropagation()}>
            <div className="seg-conf-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </div>
            <div className="seg-conf-title">Delete segment?</div>
            <div className="seg-conf-sub">
              <strong>{pendingDelete.name}</strong> ({pendingDelete.code}) will be removed.
              This action cannot be undone.
            </div>
            <div className="seg-conf-btns">
              <button className="seg-btn-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="seg-btn-del" onClick={() => void onDelete()}>Delete</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Add / Edit modal
 * ───────────────────────────────────────────────────────────────────────── */

function SegmentModal(props: {
  existing: Segment | null;
  nextCode: string;
  onClose: () => void;
  onSave: (form: { name: string; regulatory_status: Reg; buyer_consignee: BC }) => void;
}) {
  const { existing, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;

  const [name, setName]       = useState(existing?.name ?? '');
  const [reg, setReg]         = useState<Reg | ''>(existing?.regulatory_status ?? '');
  const [bc, setBc]           = useState<BC  | ''>(existing?.buyer_consignee   ?? '');
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!reg)         next.reg  = 'Regulatory status is required';
    if (!bc)          next.bc   = 'Buyer / Consignee rule is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({ name: name.trim(), regulatory_status: reg as Reg, buyer_consignee: bc as BC }));
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="seg-modal-bd" onClick={onClose}>
      <div className="seg-modal" onClick={e => e.stopPropagation()}>
        <div className="seg-modal-head">
          <div className="seg-modal-head-left">
            <div className="seg-modal-head-ico">
              {isEdit ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
              )}
            </div>
            <div>
              <div className="seg-modal-head-title">{isEdit ? 'Edit Segment' : 'Add New Segment'}</div>
              <div className="seg-modal-head-sub">
                {isEdit
                  ? 'Update the segment details below.'
                  : 'Define a business or trade segment with regulatory classification and buyer-consignee rules.'}
              </div>
            </div>
          </div>
          <button className="seg-modal-close" onClick={onClose} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="seg-modal-body">
          {/* Auto / Edit code strip */}
          <div className="seg-autocode">
            <div className="seg-autocode-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div className="seg-autocode-text">
              <div className="seg-autocode-label">{isEdit ? 'Segment Code' : 'Auto Generated Code'}</div>
              <div className="seg-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`seg-autocode-badge ${isEdit ? 'seg-autocode-badge-edit' : ''}`}>
              <span className="seg-autocode-dot" />
              {isEdit ? 'Edit' : 'Auto'}
            </div>
          </div>

          <div className="seg-field">
            <label className="seg-field-label">Segment Name <span className="seg-req">*</span></label>
            <input
              type="text"
              className={`seg-input ${errors.name ? 'seg-input-err' : ''}`}
              placeholder="e.g. Tobacco, Rice, Food Grade Ethanol"
              value={name}
              onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
              autoFocus
            />
            {errors.name && <div className="seg-err">{errors.name}</div>}
          </div>

          <div className="seg-field">
            <label className="seg-field-label">Regulatory Status <span className="seg-req">*</span></label>
            <select
              className={`seg-input ${errors.reg ? 'seg-input-err' : ''}`}
              value={reg}
              onChange={e => { setReg(e.target.value as Reg); setErrors(p => ({ ...p, reg: '' })); }}
            >
              <option value="">— Select —</option>
              <option value="highly">Highly Regulated</option>
              <option value="less">Less Regulated</option>
            </select>
            {errors.reg && <div className="seg-err">{errors.reg}</div>}
          </div>

          <div className="seg-field">
            <label className="seg-field-label">Buyer ≠ Consignee <span className="seg-req">*</span></label>
            <select
              className={`seg-input ${errors.bc ? 'seg-input-err' : ''}`}
              value={bc}
              onChange={e => { setBc(e.target.value as BC); setErrors(p => ({ ...p, bc: '' })); }}
            >
              <option value="">— Select —</option>
              <option value="allowed">Allowed</option>
              <option value="not_allowed">Not Allowed</option>
            </select>
            {errors.bc && <div className="seg-err">{errors.bc}</div>}
          </div>
        </div>

        <div className="seg-modal-foot">
          <button className="seg-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="seg-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
            </svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Segment' : 'Save Segment')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const CSS = `
.seg-root {
  padding: 18px; max-width: 1280px; margin: 0 auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  color: #0F172A;
}

/* ── Header card ── */
.seg-head-card {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  padding: 16px 20px; margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.seg-head-left { display: flex; align-items: center; gap: 14px; }
.seg-head-ico {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(8,145,178,.30);
}
.seg-crumb { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: #0891b2; text-transform: uppercase; }
.seg-head-title { font-size: 18px; font-weight: 800; color: #0c4a6e; margin-top: 2px; }
.seg-head-sub   { font-size: 12px; color: #64748b; margin-top: 3px; }
.seg-add-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border: none; cursor: pointer;
  border-radius: 10px; font-size: 12.5px; font-weight: 700;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  box-shadow: 0 4px 14px rgba(8,145,178,.32);
  transition: filter .15s, transform .12s;
}
.seg-add-btn:hover  { filter: brightness(1.08); transform: translateY(-1px); }

/* ── Body card ── */
.seg-body-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 3px rgba(15,23,42,.04);
}

/* Tabs */
.seg-tabs {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 18px; border-bottom: 1px solid #e0f2fe;
  background: linear-gradient(110deg, #f0fdff, #fff);
  flex-wrap: wrap;
}
.seg-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 10px;
  border: 1.5px solid rgba(6,182,212,.20);
  background: #fff; color: #0891b2;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: all .15s;
}
.seg-tab:hover { background: rgba(6,182,212,.06); }
.seg-tab.active {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  border-color: transparent; color: #fff;
  box-shadow: 0 3px 10px rgba(8,145,178,.30);
}
.seg-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 7px;
  border-radius: 999px;
  background: rgba(6,182,212,.10); color: #0891b2;
  font-size: 10.5px; font-weight: 800;
}
.seg-tab.active .seg-tab-count {
  background: rgba(255,255,255,.22); color: #fff;
}
.seg-search {
  margin-left: auto; display: flex; align-items: center; gap: 7px;
  padding: 0 12px; height: 34px;
  border: 1.5px solid rgba(6,182,212,.20); border-radius: 10px;
  background: #fff; min-width: 240px;
  transition: border-color .15s, box-shadow .15s;
}
.seg-search:focus-within { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.16); }
.seg-search input { flex: 1; border: none; outline: none; font-size: 12px; background: transparent; color: #0f172a; font-family: inherit; }

/* Table */
.seg-table-wrap { overflow-x: auto; }
.seg-table { width: 100%; border-collapse: collapse; min-width: 880px; }
.seg-table thead th {
  padding: 11px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-bottom: 1.5px solid rgba(6,182,212,.18);
  font-size: 9px; font-weight: 800; letter-spacing: .12em;
  color: #0891b2; text-transform: uppercase; opacity: .85;
  white-space: nowrap; text-align: left;
}
.seg-table tbody tr {
  border-bottom: 1px solid rgba(6,182,212,.06);
  transition: background .12s, box-shadow .12s;
}
.seg-table tbody tr:nth-child(even) { background: rgba(240,253,255,.55); }
.seg-table tbody tr:hover { background: rgba(6,182,212,.07); box-shadow: inset 3px 0 0 #0891b2; }
.seg-table tbody td { padding: 11px 16px; font-size: 12.5px; color: #0c4a6e; vertical-align: middle; }
.seg-td-num  { text-align: center; color: #b0c4d4; font-weight: 600; }
.seg-td-name { font-weight: 700; color: #0c4a6e; letter-spacing: -.15px; }

.seg-code-pill {
  display: inline-block;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 800; letter-spacing: .05em;
  color: #0891b2;
  background: linear-gradient(135deg, rgba(8,145,178,.10), rgba(6,182,212,.06));
  padding: 4px 9px; border-radius: 7px;
  border: 1px solid rgba(6,182,212,.25);
}
.seg-reg-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px; border-radius: 20px;
  font-size: 10.5px; font-weight: 700;
  border: 1px solid; white-space: nowrap;
}
.seg-reg-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.seg-reg-highly { background: rgba(220,38,38,.07); color: #dc2626; border-color: rgba(220,38,38,.22); }
.seg-reg-less   { background: rgba(13,148,136,.07); color: #0d9488; border-color: rgba(13,148,136,.22); }
.seg-bc { font-size: 12px; font-weight: 600; }
.seg-bc-allowed     { color: #16a34a; font-weight: 700; }
.seg-bc-not_allowed { color: #ef4444; }

.seg-actions { display: inline-flex; align-items: center; gap: 6px; }
.seg-act {
  width: 30px; height: 30px; border-radius: 7px; cursor: pointer;
  border: 1.5px solid; background: transparent;
  display: flex; align-items: center; justify-content: center;
  opacity: .72; transition: all .15s;
}
.seg-act:hover { opacity: 1; transform: translateY(-1px); }
.seg-act-edit { color: #0891b2; border-color: rgba(6,182,212,.25); background: rgba(240,253,255,.8); }
.seg-act-edit:hover { background: #e0f9fd; border-color: #0891b2; box-shadow: 0 2px 8px rgba(8,145,178,.22); }
.seg-act-del  { color: #ef4444; border-color: rgba(239,68,68,.22); background: rgba(255,245,245,.8); }
.seg-act-del:hover  { background: #fff0f0; border-color: #ef4444; box-shadow: 0 2px 8px rgba(239,68,68,.20); }

.seg-status { text-align: center; padding: 28px 12px; color: #94a3b8; font-style: italic; font-size: 12.5px; }
.seg-empty { text-align: center; padding: 32px 16px; }
.seg-empty-ico {
  width: 46px; height: 46px; border-radius: 12px;
  background: rgba(6,182,212,.08); margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
}
.seg-empty-title { font-size: 13.5px; font-weight: 700; color: #0c4a6e; }
.seg-empty-sub   { font-size: 11.5px; color: #64748b; margin-top: 3px; }

.seg-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: linear-gradient(110deg, #f0fdff, #e8fbfd);
  border-top: 1.5px solid rgba(6,182,212,.12);
}
.seg-pag-info { font-size: 11.5px; color: #0891b2; opacity: .8; }
.seg-pag-info b { color: #0c4a6e; font-weight: 700; opacity: 1; }
.seg-pag-btns { display: flex; gap: 4px; }
.seg-pag-btn {
  min-width: 30px; height: 30px; padding: 0 8px;
  border-radius: 7px; border: 1.5px solid rgba(6,182,212,.20);
  background: rgba(240,253,255,.7); color: #0891b2;
  font-size: 12px; font-weight: 600; cursor: pointer;
  font-family: inherit; transition: all .15s;
}
.seg-pag-btn:hover:not(:disabled) { background: rgba(6,182,212,.10); }
.seg-pag-btn.on {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  border-color: transparent; color: #fff; font-weight: 800;
  box-shadow: 0 3px 10px rgba(8,145,178,.32);
  cursor: not-allowed;
}

/* ── Add/Edit modal ── */
.seg-modal-bd {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px; animation: seg-fade .15s ease-out;
}
@keyframes seg-fade { from { opacity: 0 } to { opacity: 1 } }
.seg-modal {
  width: min(520px, 100%); max-height: 92vh;
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(8,145,178,.20), 0 8px 24px rgba(0,0,0,.10);
  animation: seg-pop .18s cubic-bezier(.22,1,.36,1);
}
@keyframes seg-pop { from { transform: scale(.96); opacity: 0 } to { transform: scale(1); opacity: 1 } }

.seg-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
}
.seg-modal-head-left { display: flex; align-items: center; gap: 12px; }
.seg-modal-head-ico {
  width: 40px; height: 40px; border-radius: 11px;
  background: rgba(255,255,255,.18);
  display: flex; align-items: center; justify-content: center;
}
.seg-modal-head-title { font-size: 16px; font-weight: 700; }
.seg-modal-head-sub   { font-size: 11.5px; opacity: .85; margin-top: 2px; }
.seg-modal-close {
  width: 28px; height: 28px; border-radius: 8px; cursor: pointer; border: none;
  background: rgba(255,255,255,.18); color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.seg-modal-close:hover { background: rgba(255,255,255,.30); }

.seg-modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }

.seg-autocode {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 11px;
  background: linear-gradient(110deg, rgba(8,145,178,.06), rgba(6,182,212,.03));
  border: 1.5px solid rgba(6,182,212,.16);
}
.seg-autocode-ico {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.seg-autocode-text { flex: 1; min-width: 0; }
.seg-autocode-label { font-size: 9px; font-weight: 800; letter-spacing: .08em; color: #0891b2; text-transform: uppercase; opacity: .75; }
.seg-autocode-val {
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px; font-weight: 800; color: #0c4a6e; margin-top: 2px; letter-spacing: .04em;
}
.seg-autocode-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  background: rgba(6,182,212,.10); border: 1px solid rgba(6,182,212,.20);
  font-size: 9.5px; font-weight: 800; color: #0891b2;
  text-transform: uppercase; letter-spacing: .04em;
}
.seg-autocode-badge-edit { background: rgba(245,158,11,.10); border-color: rgba(245,158,11,.22); color: #d97706; }
.seg-autocode-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #0891b2;
  box-shadow: 0 0 0 3px rgba(6,182,212,.18);
}
.seg-autocode-badge-edit .seg-autocode-dot { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }

.seg-field { display: flex; flex-direction: column; gap: 4px; }
.seg-field-label { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; color: #0891b2; text-transform: uppercase; }
.seg-req { color: #ef4444; }
.seg-input {
  height: 38px; padding: 0 12px;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  font-size: 13px; color: #0c4a6e; font-family: inherit;
  background: #fff; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
select.seg-input { appearance: auto; }
.seg-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.16); }
.seg-input-err { border-color: #ef4444; }
.seg-err { font-size: 10.5px; color: #ef4444; }

.seg-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;
}
.seg-btn-cancel {
  padding: 9px 18px; border-radius: 9px;
  border: 1.5px solid #cbd5e1; background: #fff; color: #475569;
  font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .15s;
}
.seg-btn-cancel:hover:not(:disabled) { background: #f1f5f9; }
.seg-btn-save {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 22px; border-radius: 9px;
  border: none; cursor: pointer; font-family: inherit;
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  font-size: 12.5px; font-weight: 700;
  box-shadow: 0 4px 14px rgba(8,145,178,.32);
  transition: filter .15s, transform .12s;
}
.seg-btn-save:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.seg-btn-cancel:disabled, .seg-btn-save:disabled { opacity: .55; cursor: not-allowed; }

/* ── Delete confirm ── */
.seg-conf-bd {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.seg-conf {
  width: min(380px, 100%); background: #fff; border-radius: 14px;
  padding: 22px 22px 18px; text-align: center;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  animation: seg-pop .18s cubic-bezier(.22,1,.36,1);
}
.seg-conf-ico {
  width: 52px; height: 52px; margin: 0 auto 12px;
  background: rgba(239,68,68,.10); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.seg-conf-title { font-size: 15px; font-weight: 800; color: #0c4a6e; margin-bottom: 6px; }
.seg-conf-sub   { font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 16px; }
.seg-conf-btns { display: flex; justify-content: center; gap: 8px; }
.seg-btn-del {
  padding: 8px 18px; border: none; cursor: pointer; border-radius: 9px;
  background: #ef4444; color: #fff;
  font-size: 12.5px; font-weight: 700; font-family: inherit;
  box-shadow: 0 3px 10px rgba(239,68,68,.30);
  transition: filter .15s, transform .12s;
}
.seg-btn-del:hover { filter: brightness(1.08); transform: translateY(-1px); }

/* ── Dark mode ── */
[data-bs-theme="dark"] .seg-root { color: #e2e8f0; }
[data-bs-theme="dark"] .seg-head-card,
[data-bs-theme="dark"] .seg-body-card { background: #0f172a; border-color: #1e293b; }
[data-bs-theme="dark"] .seg-head-title { color: #67e8f9; }
[data-bs-theme="dark"] .seg-head-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .seg-tabs { background: linear-gradient(110deg, rgba(8,145,178,.10), #0f172a); border-bottom-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .seg-tab { background: #1e293b; color: #67e8f9; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .seg-search { background: #1e293b; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .seg-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .seg-table thead th { background: rgba(8,145,178,.14); color: #67e8f9; border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .seg-table tbody tr { border-bottom-color: rgba(6,182,212,.10); }
[data-bs-theme="dark"] .seg-table tbody tr:nth-child(even) { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .seg-table tbody tr:hover { background: rgba(8,145,178,.16); }
[data-bs-theme="dark"] .seg-table tbody td  { color: #e2e8f0; }
[data-bs-theme="dark"] .seg-td-name { color: #f1f5f9; }
[data-bs-theme="dark"] .seg-pag { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .seg-pag-info b { color: #67e8f9; }
[data-bs-theme="dark"] .seg-pag-btn { background: #1e293b; color: #67e8f9; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .seg-modal { background: #0f172a; }
[data-bs-theme="dark"] .seg-modal-body { background: #0f172a; }
[data-bs-theme="dark"] .seg-modal-foot { background: #1e293b; border-top-color: #334155; }
[data-bs-theme="dark"] .seg-input { background: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .seg-btn-cancel { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .seg-autocode { background: rgba(8,145,178,.10); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .seg-autocode-val { color: #67e8f9; }
[data-bs-theme="dark"] .seg-conf { background: #0f172a; }
[data-bs-theme="dark"] .seg-conf-title { color: #67e8f9; }

@media (max-width: 720px) {
  .seg-head-card { flex-direction: column; align-items: stretch; gap: 12px; }
  .seg-tabs { flex-direction: column; align-items: stretch; }
  .seg-search { width: 100%; margin-left: 0; }
  .seg-tab { justify-content: space-between; }
}
`;
