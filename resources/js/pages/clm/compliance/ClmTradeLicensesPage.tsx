import { useEffect, useMemo, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import { MasterMultiSelect } from '../../../components/ui/MasterMultiSelect';
import { ClmSkeletonRows, SimpleDescModal, useScrollLock } from '../shared/clmCommon';

/* Central CLM → Trade Licences Master. 3-card faithful port. */

// `authority` holds comma-joined authority IDs; `authority_names` is the
// resolved display string returned by the API.
type Tl = { id: number; code: string; name: string; authority: string; authority_names?: string; status: 'active'|'inactive'; in_use?: boolean; used_in?: string[] };
type Authority = { id: number; code: string; name: string };

export default function ClmTradeLicensesPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Tl[]>([]);
  const [count, setCount]       = useState(0);
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(true); // start true so the shimmer shows from frame 1 (not the empty-state icon)
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  // Dynamic pagination: rows-per-page auto-fits the visible table height.
  const [rpp, setRpp]           = useState(PER_PAGE);
  const autoFitRef              = useRef(true);
  const [fillH, setFillH]       = useState<number | undefined>(undefined);
  const scrollRef               = useRef<HTMLDivElement | null>(null);
  const rootRef                 = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing]   = useState<Tl | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen); // lock html+body while the custom Add/Edit modal is open
  const [pendingDelete, setPendingDelete] = useState<Tl | null>(null);
  const [deleting, setDeleting] = useState(false);
  // All-authorities popover — opened from the +N badge in the ISSUING
  // AUTHORITY column (same pattern as the DCP authorities popover).
  const [authPop, setAuthPop] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  // Close the fixed-positioned authorities popover on scroll/resize so it can't
  // drift away from its badge (capture:true catches ancestor + table scrolls).
  useEffect(() => {
    if (!authPop) return;
    const close = () => setAuthPop(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [authPop]);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Tl[]; count: number }>('/clm/trade-licenses'),
      api.get<{ status: boolean; data: Authority[] }>('/clm/authorities'),
    ]).then(([k, a]) => { setRows(k.data.data ?? []); setCount(k.data.count ?? 0); setAuths(a.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load trade licences'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || (r.authority_names ?? '').toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page, rpp);

  // Dynamic pagination: pick the rows-per-page that fits between the table's
  // top and the bottom of the viewport, and stretch the card to cover the page.
  // Mirrors the Segment / Authority / QC / KYC / DD pages.
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const THEAD = 40, ROW = 46, FOOTER = 96;
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    // Not observing the page root: the "What We Are Doing Here" box animates its
    // height on expand/collapse, so observing the root fired this recompute every
    // animation frame and visibly disturbed the layout. Recompute only on mount
    // and on genuine window resizes instead.
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
  }, [filtered.length]);

  const onSave = async (form: { name: string; authority: string }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/trade-licenses/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/trade-licenses', form);     toast.success('Added',   `${form.name} added`); }
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) {
      const status = e?.response?.status;
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      // 422 field-validation errors are shown inline below the field by the
      // modal — don't ALSO toast (avoids the same message appearing twice).
      if (!(status === 422 && err && Object.keys(err).length)) {
        toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save');
      }
      throw e;   // let the modal surface field-level (422) errors below the field
    }
  };
  const onDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try { await api.delete(`/clm/trade-licenses/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="clm-root" ref={rootRef}>
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={5} />}

      <ClmPageHeader
        icon={ICO.hTl}
        title="Trade Licences Master"
        sub="Manage statutory, regulatory, and operational trade licences."
        addLabel="Add Trade Licence"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bDoc}
        label="Trade Licences Master"
        sub="Manage trade licence structures and regulatory approval requirements."
        steps={[
          { n: '01', title: 'Create Licence Record',  desc: 'Add statutory and regulatory licences.',              icon: ICO.doc },
          { n: '02', title: 'Map Authority',          desc: 'Define licence issuing authority details.',           icon: ICO.shield },
          { n: '03', title: 'Set Validity & Renewal', desc: 'Define licence validity and renewal period.',         icon: ICO.calendar },
          { n: '04', title: 'Enable Usage',           desc: 'Use licences across compliance and trade workflows.', icon: ICO.check },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
          <div className="clm-search clm-search-fixed">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" placeholder="Search trade licences…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="clm-total">
            <div className="clm-total-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="12" y2="13"/></svg></div>
            <div className="clm-total-lbl">Total Trade Licences</div>
            <div className="clm-total-num">{count}</div>
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 && !loading ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bDoc}</div>
              <div className="clm-empty-title">No trade licences yet</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add Trade Licence to create the first record.' : 'No results match.'}</div>
            </div>
          ) : (
            <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
              <table className="clm-table">
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 130, textAlign: 'center' }}>TRADE LICENCE CODE</th>
                  <th>LICENCE NAME</th>
                  <th>ISSUING AUTHORITY</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <ClmSkeletonRows cols={5} />}
                  {!loading && slice.map((r, i) => (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <Tooltip label={r.name}><td className="clm-td-name clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.name}</div></td></Tooltip>
                      <td className="clm-td-desc">
                        {(() => {
                          const list = (r.authority_names ?? '').split(',').map(s => s.trim()).filter(Boolean);
                          if (list.length === 0) return <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>;
                          const extra = list.length - 1;
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span className="clm-badge clm-badge-teal">{list[0]}</span>
                              {extra > 0 && (
                                <Tooltip label="View all authorities"><button
                                  type="button"
                                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setAuthPop(authPop?.id === r.id ? null : { id: r.id, names: list, x: b.left, y: b.bottom + 4 }); }}
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)' }}>
                                  +{extra}
                                </button></Tooltip>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="clm-actions">
                          <Tooltip label="Edit"><button type="button" aria-label="Edit" className="clm-act clm-act-edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></Tooltip>
                          <Tooltip label={r.in_use ? `In use by ${(r.used_in || []).join(', ')} — can't delete` : 'Delete'}><button type="button" aria-label="Delete" className="clm-act clm-act-del" aria-disabled={r.in_use || undefined} onClick={() => { if (r.in_use) return; setPendingDelete(r); }} style={r.in_use ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtered.length > 0 && (
                <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
              )}
            </div>
          )}
        </div>
      </div>

      {modalOpen && <TlModal existing={editing} authorities={auths} nextCode={`TL-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete Trade Licence"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This trade licence will be permanently removed. The action cannot be undone."
        loading={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={onDelete}
      />

      {/* All-authorities popover (opened from the +N badge in the ISSUING AUTHORITY column) */}
      {authPop && createPortal(
        <>
          <div onClick={() => setAuthPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(authPop.x, window.innerWidth - 230), top: authPop.y, zIndex: 601, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Authorities ({authPop.names.length})</div>
            {authPop.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export function TlModal(props: { existing: Tl | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: { name: string; authority: string }) => void; }) {
  const { existing, authorities: initialAuthorities, nextCode, onClose, onSave } = props;
  const toast = useToast();
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  // Issuing authority is now multi-select. Stored on the backend as a single
  // comma-joined string (the `authority` column, max 255) — split on load,
  // join on save, so no backend/schema change is needed.
  const [authList, setAuthList] = useState<string[]>(
    existing?.authority ? existing.authority.split(',').map(s => s.trim()).filter(Boolean) : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [authorities, setAuthorities] = useState<Authority[]>(initialAuthorities);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  useEffect(() => { setAuthorities(initialAuthorities); }, [initialAuthorities]);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Licence name is required';
    else if (name.trim().length > 255) next.name = 'Name must not be greater than 255 characters';
    if (authList.length === 0) next.auth = 'Select at least one authority';
    const joined = authList.join(', ');
    if (joined.length > 255) next.auth = 'Too many authorities selected (max 255 characters combined)';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ name: name.trim(), authority: joined })); }
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
      setAuthList(prev => prev.includes(String(created.id)) ? prev : [...prev, String(created.id)]);
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
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Trade Licence' : 'Add Trade Licence'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update trade licence details.' : 'Register a statutory trade licence record.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'TL Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Licence Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. GST Registration, IEC Certificate" maxLength={255} value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{name.length}/255</div>
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Issuing Authority <span className="clm-req">*</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MasterMultiSelect
                  values={authList}
                  invalid={!!errors.auth}
                  placeholder="— Select Authorities —"
                  options={[
                    ...authorities.map(a => ({ value: String(a.id), label: a.name })),
                    // keep any already-selected authority that's no longer in the
                    // master list so it stays toggle-able (e.g. renamed/removed).
                    ...authList.filter(v => !authorities.find(a => String(a.id) === v)).map(v => ({ value: v, label: v })),
                  ]}
                  onChange={(next) => { setAuthList(next); setErrors(p => ({ ...p, auth: '' })); }}
                />
              </div>
              <Tooltip label="Add new authority"><button type="button" className="clm-quick-add-btn" onClick={() => setQuickAddOpen(true)} aria-label="Add new authority">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button></Tooltip>
            </div>
            <div className="clm-field-hint">Pulls from Authority Master — click + to add a new authority.</div>
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
          onSave={(f) => onAddNewAuthority(f)}
        />
      )}
    </div>
  ), document.body);
}
