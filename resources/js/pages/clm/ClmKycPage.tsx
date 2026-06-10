import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS } from './clmShared';

/* This list paginates at 6 rows/page (vs the shared 10) so it mirrors the
 * customer list — a compact first page that pages through the rest. */
const KYC_PER_PAGE = 6;
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { MasterMultiSelect } from '../../components/ui/MasterMultiSelect';
import { SimpleDescModal } from './clmCommon';

/* Central CLM → KYC Documents Master. 3-card faithful port. */

type Kyc = { id: number; code: string; name: string; authority: string; status: 'active'|'inactive' };
type Authority = { id: number; code: string; name: string };

export default function ClmKycPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Kyc[]>([]);
  const [count, setCount]       = useState(0);
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [editing, setEditing]   = useState<Kyc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Kyc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Kyc[]; count: number }>('/clm/kyc-documents'),
      api.get<{ status: boolean; data: Authority[] }>('/clm/authorities'),
    ])
      .then(([k, a]) => { setRows(k.data.data ?? []); setCount(k.data.count ?? 0); setAuths(a.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load KYC documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.authority.toLowerCase().includes(s));
  }, [rows, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / KYC_PER_PAGE));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const start     = (safePage - 1) * KYC_PER_PAGE;
  const slice     = filtered.slice(start, start + KYC_PER_PAGE);

  const onSave = async (form: { name: string; authority: string }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/kyc-documents/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/kyc-documents', form);     toast.success('Added',   `${form.name} added`); }
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) {
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save');
      throw e;   // let the modal surface field-level (422) errors below the field
    }
  };
  const onDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try { await api.delete(`/clm/kyc-documents/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      <ClmPageHeader
        icon={ICO.hKyc}
        title="KYC Master"
        sub="Manage KYC documents, issuing authorities, and verification requirements."
        addLabel="Add KYC Document"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bKyc}
        label="KYC Master"
        sub="Manage KYC document structures and identity verification requirements."
        steps={[
          { n: '01', title: 'Create KYC Record', desc: 'Add KYC and verification documents.',            icon: ICO.grid },
          { n: '02', title: 'Map Authority',     desc: 'Define issuing authority details.',              icon: ICO.shield },
          { n: '03', title: 'Enable Usage',      desc: 'Use KYC documents across onboarding workflows.', icon: ICO.check },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
          <div className="clm-search clm-search-grow">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" placeholder="Search KYC documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="clm-total">
            <div className="clm-total-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg></div>
            <div className="clm-total-lbl">Total KYC Documents</div>
            <div className="clm-total-num">{count}</div>
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bKyc}</div>
              <div className="clm-empty-title">No KYC documents yet</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add KYC Document to create the first record.' : 'No results match the current search.'}</div>
            </div>
          ) : (
            <div className="clm-table-wrap">
              <table className="clm-table">
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 110, textAlign: 'center' }}>KYC ID</th>
                  <th>KYC DOCUMENT NAME</th>
                  <th>ISSUING AUTHORITY</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={5} className="clm-status">Loading…</td></tr>}
                  {!loading && slice.map((r, i) => (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <td className="clm-td-name">{r.name}</td>
                      <td className="clm-td-desc">{r.authority}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="clm-actions">
                          <Tooltip label="Edit"><button type="button" aria-label="Edit" className="clm-act clm-act-edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></Tooltip>
                          <Tooltip label="Delete"><button type="button" aria-label="Delete" className="clm-act clm-act-del" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtered.length > 0 && (
                <div className="clm-pag">
                  <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + KYC_PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b> record{filtered.length === 1 ? '' : 's'}</span>
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

      {modalOpen && <KycModal existing={editing} authorities={auths} nextCode={`KYC-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete KYC Document"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This KYC document will be permanently removed. The action cannot be undone."
        loading={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}

export function KycModal(props: { existing: Kyc | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: { name: string; authority: string }) => void; }) {
  const { existing, authorities: initialAuthorities, nextCode, onClose, onSave } = props;
  const toast = useToast();
  const isEdit = !!existing;
  // Authorities are stored as a comma-joined string on the record; the form
  // works with an array so one KYC document can map to multiple authorities.
  const splitAuth = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  const [name, setName] = useState(existing?.name ?? '');
  const [authList, setAuthList] = useState<string[]>(existing ? splitAuth(existing.authority) : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Local copy seeded from the parent so the + button can append a new
  // authority and have it appear in the dropdown immediately.
  const [authorities, setAuthorities] = useState<Authority[]>(initialAuthorities);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  useEffect(() => { setAuthorities(initialAuthorities); }, [initialAuthorities]);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Document name is required';
    if (!authList.length) next.auth = 'At least one authority is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ name: name.trim(), authority: authList.join(', ') })); }
    catch (e: any) {
      const apiErrors = e?.response?.data?.errors as Record<string, string[] | string> | undefined;
      if (apiErrors) {
        const keyMap: Record<string, string> = { authority: 'auth' };   // backend field → inline field
        setErrors(p => ({ ...p, ...Object.fromEntries(Object.entries(apiErrors).map(([k, v]) => [keyMap[k] ?? k, Array.isArray(v) ? v[0] : String(v)])) }));
      }
    }
    finally { setSaving(false); }
  };

  const onAddNewAuthority = async (form: { name: string; description: string }) => {
    try {
      const r = await api.post<{ status: boolean; data: Authority }>('/clm/authorities', form);
      const created = r.data.data;
      setAuthorities(prev => [...prev, created]);
      setAuthList(prev => prev.includes(created.name) ? prev : [...prev, created.name]);
      setErrors(p => ({ ...p, auth: '' }));
      setQuickAddOpen(false);
      toast.success('Added', created.name);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not add authority');
    }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal">
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit KYC Document' : 'Add KYC Document'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update KYC document details.' : 'Register a new KYC document for onboarding and verification.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'KYC Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">KYC Document Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. PAN Card, Aadhaar Card, GST Certificate" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Issuing Authorities <span className="clm-req">*</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MasterMultiSelect
                  values={authList}
                  invalid={!!errors.auth}
                  placeholder="— Select Authorities —"
                  options={[
                    ...authorities.map(a => ({ value: a.name, label: a.name })),
                    ...authList.filter(a => !authorities.find(x => x.name === a)).map(a => ({ value: a, label: a })),
                  ]}
                  onChange={(vals) => { setAuthList(vals); setErrors(p => ({ ...p, auth: '' })); }}
                />
              </div>
              <button type="button" className="clm-quick-add-btn" onClick={() => setQuickAddOpen(true)} aria-label="Add new authority" title="Add new authority">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            <div className="clm-field-hint">Pulls from Authority Master — select one or more, or click + to add a new authority.</div>
            {errors.auth && <div className="clm-err">{errors.auth}</div>}
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
      {quickAddOpen && (
        <SimpleDescModal
          title="Add New Authority"
          namePlaceholder="e.g. Income Tax Department, DGFT, GSTN"
          descPlaceholder="What this authority issues / regulates"
          code={`A-${String(authorities.length + 1).padStart(3, '0')}`}
          isEdit={false}
          initialName=""
          initialDesc=""
          onClose={() => setQuickAddOpen(false)}
          onSave={(f) => void onAddNewAuthority(f)}
        />
      )}
    </div>
  ), document.body);
}
