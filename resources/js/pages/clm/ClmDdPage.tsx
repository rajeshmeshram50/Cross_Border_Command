import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';

/* Central CLM → Due Diligence master. */

type Dd = { id: number; code: string; name: string; authority: string; expiry: string; status: 'active'|'inactive'; };
type Authority = { id: number; code: string; name: string };

export default function ClmDdPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Dd[]>([]);
  const [count, setCount]       = useState(0);
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [editing, setEditing]   = useState<Dd | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Dd | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Dd[]; count: number }>('/clm/dd-documents'),
      api.get<{ status: boolean; data: Authority[] }>('/clm/authorities'),
    ]).then(([k, a]) => { setRows(k.data.data ?? []); setCount(k.data.count ?? 0); setAuths(a.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load DD documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.authority.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: { name: string; authority: string; expiry: string }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/dd-documents/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/dd-documents', form);     toast.success('Added',   `${form.name} added`); }
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) {
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save');
    }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/dd-documents/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      <div className="clm-head-card">
        <div className="clm-head-left">
          <div className="clm-head-ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </div>
          <div>
            <div className="clm-crumb">Central CLM · Compliance &amp; Regulatory</div>
            <div className="clm-head-title">Due Diligence Documents</div>
            <div className="clm-head-sub">Entity-level diligence — incorporation certificate, board resolutions, financials, credit bureau reports.</div>
          </div>
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add DD Document
        </button>
      </div>

      <div className="clm-body-card">
        <div className="clm-tabs">
          <span className="clm-total-pill">Total DD Documents · <b>{count}</b></span>
          <div className="clm-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input type="text" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="clm-table-wrap">
          <table className="clm-table">
            <thead><tr>
              <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
              <th style={{ width: 110, textAlign: 'center' }}>DD ID</th>
              <th>DD DOCUMENT NAME</th>
              <th>ISSUING AUTHORITY</th>
              <th style={{ width: 110, textAlign: 'center' }}>EXPIRY</th>
              <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="clm-status">Loading…</td></tr>}
              {!loading && slice.length === 0 && (
                <tr><td colSpan={6} className="clm-empty">
                  <div className="clm-empty-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>
                  <div className="clm-empty-title">No DD documents yet</div>
                  <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add DD Document to create the first record.' : 'No results match the current search.'}</div>
                </td></tr>
              )}
              {!loading && slice.map((r, i) => (
                <tr key={r.id}>
                  <td className="clm-td-num">{start + i + 1}</td>
                  <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                  <td className="clm-td-name">{r.name}</td>
                  <td className="clm-td-desc">{r.authority}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`clm-badge ${r.expiry === 'N/A' ? 'clm-badge-green' : r.expiry === 'Varies' ? 'clm-badge-amber' : 'clm-badge-red'}`}>{r.expiry}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="clm-actions">
                      <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                      <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length > 0 && (
            <div className="clm-pag">
              <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b> record{filtered.length === 1 ? '' : 's'}</span>
              <div className="clm-pag-btns">{Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
              ))}</div>
            </div>
          )}
        </div>
      </div>

      {modalOpen && <DdModal existing={editing} authorities={auths} nextCode={`DD-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal((
        <div className="clm-conf-bd" onClick={() => setPendingDelete(null)}>
          <div className="clm-conf" onClick={e => e.stopPropagation()}>
            <div className="clm-conf-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg></div>
            <div className="clm-conf-title">Delete DD document?</div>
            <div className="clm-conf-sub"><strong>{pendingDelete.name}</strong> ({pendingDelete.code}) will be removed.</div>
            <div className="clm-conf-btns"><button className="clm-btn-cancel" onClick={() => setPendingDelete(null)}>Cancel</button><button className="clm-btn-del" onClick={() => void onDelete()}>Delete</button></div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function DdModal(props: { existing: Dd | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: { name: string; authority: string; expiry: string }) => void; }) {
  const { existing, authorities, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [auth, setAuth] = useState(existing?.authority ?? '');
  const [expiryMode, setExpiryMode] = useState<'N/A'|'Varies'|'date'>(existing?.expiry === 'N/A' || !existing ? 'N/A' : existing.expiry === 'Varies' ? 'Varies' : 'date');
  const [expiry, setExpiry] = useState(existing && existing.expiry !== 'N/A' && existing.expiry !== 'Varies' ? existing.expiry : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Document name is required';
    if (!auth.trim()) next.auth = 'Authority is required';
    if (expiryMode === 'date' && !expiry.trim()) next.expiry = 'Pick an expiry (MM/YYYY)';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    const expiryValue = expiryMode === 'date' ? expiry.trim() : expiryMode;
    try { await Promise.resolve(onSave({ name: name.trim(), authority: auth.trim(), expiry: expiryValue })); }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit DD Document' : 'Add DD Document'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update due diligence document details.' : 'Register a due diligence document for entity verification.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'DD Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>

          <div className="clm-field">
            <label className="clm-field-label">DD Document Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. Audited Financials, Board Resolution" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Issuing Authority <span className="clm-req">*</span></label>
            <select className={`clm-select ${errors.auth ? 'clm-input-err' : ''}`} value={auth} onChange={e => { setAuth(e.target.value); setErrors(p => ({ ...p, auth: '' })); }}>
              <option value="">— Select Authority —</option>
              {authorities.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              {auth && !authorities.find(a => a.name === auth) && <option value={auth}>{auth}</option>}
            </select>
            <div className="clm-field-hint">Pulls from Authority Master.</div>
            {errors.auth && <div className="clm-err">{errors.auth}</div>}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Expiry</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setExpiryMode('N/A')}    className={`clm-tab ${expiryMode === 'N/A'    ? 'active' : ''}`}>N/A</button>
              <button type="button" onClick={() => setExpiryMode('Varies')} className={`clm-tab ${expiryMode === 'Varies' ? 'active' : ''}`}>Varies</button>
              <button type="button" onClick={() => setExpiryMode('date')}   className={`clm-tab ${expiryMode === 'date'   ? 'active' : ''}`}>Specific (MM/YYYY)</button>
            </div>
            {expiryMode === 'date' && (
              <input type="text" pattern="\d{2}/\d{4}" placeholder="MM/YYYY" className={`clm-input ${errors.expiry ? 'clm-input-err' : ''}`} value={expiry} onChange={e => { setExpiry(e.target.value); setErrors(p => ({ ...p, expiry: '' })); }} style={{ marginTop: 6 }} />
            )}
            {errors.expiry && <div className="clm-err">{errors.expiry}</div>}
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
