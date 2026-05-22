import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';

/* ─────────────────────────────────────────────────────────────────────────
 * Central CLM → Authority Master.
 *
 * Faithful port of the prototype's Authority page. Tenant-scoped, code
 * follows the AUTH-001 sequence (allocated server-side). Each row has a
 * name (FSSAI, DGFT, …) and a long description (Food Safety & Standards
 * Authority of India).
 * ───────────────────────────────────────────────────────────────────────── */

type Authority = {
  id:          number;
  code:        string;
  name:        string;
  description: string;
  status:      'active' | 'inactive';
};

export default function ClmAuthorityPage() {
  const toast = useToast();

  const [rows, setRows]       = useState<Authority[]>([]);
  const [count, setCount]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);

  const [editing, setEditing]     = useState<Authority | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Authority | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ status: boolean; data: Authority[]; count: number }>('/clm/authorities')
      .then(({ data }) => { setRows(data.data ?? []); setCount(data.count ?? 0); })
      .catch(() => toast.error('Load failed', 'Could not load authorities'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: { name: string; description: string }, id?: number) => {
    try {
      if (id) {
        await api.put(`/clm/authorities/${id}`, form);
        toast.success('Updated', `${form.name} saved`);
      } else {
        await api.post('/clm/authorities', form);
        toast.success('Added', `${form.name} added`);
      }
      setModalOpen(false);
      setEditing(null);
      reload();
    } catch (e: any) {
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save authority');
    }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(`/clm/authorities/${pendingDelete.id}`);
      toast.success('Deleted', `${pendingDelete.name} removed`);
      setPendingDelete(null);
      reload();
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete');
    }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      {/* ── Header ── */}
      <div className="clm-head-card">
        <div className="clm-head-left">
          <div className="clm-head-ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </div>
          <div>
            <div className="clm-crumb">Central CLM · Compliance &amp; Regulatory</div>
            <div className="clm-head-title">Authority Master</div>
            <div className="clm-head-sub">Manage issuing, certifying, and regulatory authorities used across contracts and compliance workflows.</div>
          </div>
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Authority
        </button>
      </div>

      {/* ── Toolbar + table ── */}
      <div className="clm-body-card">
        <div className="clm-tabs">
          <span className="clm-total-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Total Authorities · <b>{count}</b>
          </span>
          <div className="clm-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input type="text" placeholder="Search by authority name, ID or description…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        <div className="clm-table-wrap">
          <table className="clm-table">
            <thead>
              <tr>
                <th style={{ width: 52,  textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>AUTHORITY ID</th>
                <th style={{ width: 220 }}>AUTHORITY NAME</th>
                <th>DESCRIPTION</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="clm-status">Loading authorities…</td></tr>}
              {!loading && slice.length === 0 && (
                <tr>
                  <td colSpan={5} className="clm-empty">
                    <div className="clm-empty-ico">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    </div>
                    <div className="clm-empty-title">No authorities yet</div>
                    <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add Authority to create the first record.' : 'No results match the current search.'}</div>
                  </td>
                </tr>
              )}
              {!loading && slice.map((r, i) => (
                <tr key={r.id}>
                  <td className="clm-td-num">{start + i + 1}</td>
                  <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                  <td className="clm-td-name">{r.name}</td>
                  <td className="clm-td-desc">{r.description}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="clm-actions">
                      <button className="clm-act clm-act-edit" title="Edit authority" onClick={() => { setEditing(r); setModalOpen(true); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button className="clm-act clm-act-del" title="Delete authority" onClick={() => setPendingDelete(r)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" /><path d="M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && (
            <div className="clm-pag">
              <span className="clm-pag-info">
                Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b> record{filtered.length === 1 ? '' : 's'}
              </span>
              <div className="clm-pag-btns">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <AuthorityModal
          existing={editing}
          nextCode={`AUTH-${String(rows.length + 1).padStart(3, '0')}`}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form) => onSave(form, editing?.id)}
        />
      )}

      {pendingDelete && createPortal((
        <div className="clm-conf-bd" onClick={() => setPendingDelete(null)}>
          <div className="clm-conf" onClick={e => e.stopPropagation()}>
            <div className="clm-conf-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </div>
            <div className="clm-conf-title">Delete authority?</div>
            <div className="clm-conf-sub"><strong>{pendingDelete.name}</strong> ({pendingDelete.code}) will be removed.</div>
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

/* ── Modal ── */

function AuthorityModal(props: {
  existing: Authority | null;
  nextCode: string;
  onClose: () => void;
  onSave: (form: { name: string; description: string }) => void;
}) {
  const { existing, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;

  const [name, setName] = useState(existing?.name ?? '');
  const [desc, setDesc] = useState(existing?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Authority name is required';
    if (!desc.trim()) next.desc = 'Description is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ name: name.trim(), description: desc.trim() })); }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Authority' : 'Add New Authority'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the authority details below.' : 'Register a regulatory or certifying authority for trade and compliance use.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
            </div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Authority Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}>
              <span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}
            </div>
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Authority Name <span className="clm-req">*</span></label>
            <input type="text" className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. FSSAI, DGFT, BIS" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Description <span className="clm-req">*</span></label>
            <input type="text" className={`clm-input ${errors.desc ? 'clm-input-err' : ''}`} placeholder="e.g. Food Safety & Standards Authority of India" value={desc} onChange={e => { setDesc(e.target.value); setErrors(p => ({ ...p, desc: '' })); }} />
            {errors.desc && <div className="clm-err">{errors.desc}</div>}
          </div>
        </div>

        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Authority' : 'Save Authority')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
