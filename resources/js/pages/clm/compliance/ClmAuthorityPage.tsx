import { useEffect, useMemo, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, paginate } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import {
  CLM_NAME_MAX,
  CLM_DESC_MAX,
  sanitizeClmName,
  sanitizeClmDescription,
  isMeaningfulClmValue,
  findClmDuplicate,
  useScrollLock,
  ClmSkeletonRows,
} from '../shared/clmCommon';

/* Central CLM → Authority Master. 3-card faithful port of the prototype. */

type Authority = { id: number; code: string; name: string; description: string; status: 'active'|'inactive'; in_use?: boolean };

/**
 * Mirrors the backend allocator in ClmAuthorityController::nextCode — walks
 * past max(existing AUTH-### suffix) + 1, skipping any taken codes. The
 * naive `rows.length + 1` preview drifts whenever the sequence has gaps
 * (after deletes, or after legacy data was consolidated).
 */
function nextAuthorityCode(rows: { code: string }[]): string {
  let maxN = 0;
  const taken = new Set<string>();
  for (const r of rows) {
    const m = /^AUTH-(\d+)$/.exec(r.code ?? '');
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
    code = `AUTH-${String(n).padStart(3, '0')}`;
  } while (taken.has(code));
  return code;
}

export default function ClmAuthorityPage() {
  const toast = useToast();

  const [rows, setRows]       = useState<Authority[]>([]);
  const [count, setCount]     = useState(0);
  const [loading, setLoading] = useState(true); // start true so the shimmer shows from frame 1 (not the empty-state icon)
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  // Fixed pagination — exactly 5 rows per page, consistent across next/back.
  const rpp = 5;
  // fillH stretches the table card to fill the viewport so the table footer
  // (pagination) sits at the bottom of the card, like the other CLM masters.
  const [fillH, setFillH]     = useState<number | undefined>(undefined);
  const scrollRef             = useRef<HTMLDivElement | null>(null);
  const rootRef               = useRef<HTMLDivElement | null>(null);

  const [editing, setEditing]     = useState<Authority | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen); // lock html+body while the custom Add/Edit modal is open
  const [pendingDelete, setPendingDelete] = useState<Authority | null>(null);
  const [deleting, setDeleting] = useState(false);

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
  const { slice, start, pageCount, safePage } = paginate(filtered, page, rpp);

  // Stretch the table card to fill the viewport — pushes the table footer
  // (pagination) to the bottom of the card even with few rows. Rows stay fixed.
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
  }, [filtered.length]);

  const onSave = async (form: { name: string; description: string }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/authorities/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/authorities', form);     toast.success('Added',   `${form.name} added`); }
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
    try { await api.delete(`/clm/authorities/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="clm-root" ref={rootRef}>
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={5} />}
      <style>{`
        /* Figma-match: fixed-width search on the left (not flex-grow); the
           Total badge stays right via the toolbar's space-between. */
        .clm-root .clm-tabs-bar .auth-search {
          flex: 0 0 auto; width: 500px; max-width: 100%;
          transition: width .18s ease, border-color .15s ease, box-shadow .15s ease;
        }
        .clm-root .clm-tabs-bar .auth-search:focus-within { width: 580px; }
        @media (max-width: 1280px) { .clm-root .clm-tabs-bar .auth-search { width: 360px; } }
        @media (max-width: 760px)  { .clm-root .clm-tabs-bar .auth-search { width: 100%; } }
      `}</style>

      <ClmPageHeader
        icon={ICO.hAuth}
        title="Authority Master"
        sub="Manage issuing, certifying, and regulatory authorities used across contracts and compliance workflows."
        addLabel="Add Authority"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bShield}
        label="Authority Master"
        sub="Manage regulatory and certifying authority records for trade and compliance operations."
        steps={[
          { n: '01', title: 'Create Authority', desc: 'Add regulatory or certifying authorities.',     icon: ICO.shield },
          { n: '02', title: 'Define Scope',     desc: 'Define authority role and compliance coverage.', icon: ICO.info },
          { n: '03', title: 'Map Usage',        desc: 'Use authorities across segments and documents.', icon: ICO.zap },
          { n: '04', title: 'Enable Usage',     desc: 'Use authorities in contracts and workflows.',    icon: ICO.check },
        ]}
      />

      {/* ── Card 3: Toolbar + Table ── */}
      <div className="clm-page-card">
        <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
          <div className="clm-search auth-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" placeholder="Search by authority name, ID or description…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="clm-total">
            <div className="clm-total-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg></div>
            <div className="clm-total-lbl">Total Authorities</div>
            <div className="clm-total-num">{count}</div>
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 && !loading ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bShield}</div>
              <div className="clm-empty-title">No authorities yet</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add Authority to create the first record.' : 'No results match the current search.'}</div>
            </div>
          ) : (
            <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
              <table className="clm-table">
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 110, textAlign: 'center' }}>AUTHORITY ID</th>
                  <th style={{ width: 220 }}>AUTHORITY NAME</th>
                  <th>DESCRIPTION</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <ClmSkeletonRows cols={5} />}
                  {!loading && slice.map((r, i) => (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <td className="clm-td-name">{r.name}</td>
                      <td className="clm-td-desc">{r.description}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="clm-actions">
                          <Tooltip label="Edit authority">
                            <button type="button" aria-label="Edit authority" className="clm-act clm-act-edit" onClick={() => { setEditing(r); setModalOpen(true); }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                          </Tooltip>
                          <Tooltip label={r.in_use ? 'In use elsewhere — remove those references to delete' : 'Delete authority'}>
                            <button
                              type="button"
                              aria-label="Delete authority"
                              className="clm-act clm-act-del"
                              style={r.in_use ? { opacity: 0.32, cursor: 'not-allowed' } : undefined}
                              onClick={() => {
                                if (r.in_use) { toast.warning('Authority locked', 'This authority is used in other records and cannot be deleted. Remove those references first.'); return; }
                                setPendingDelete(r);
                              }}
                            >
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
                <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} />
              )}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <AuthorityModal
          existing={editing}
          nextCode={nextAuthorityCode(rows)}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form) => onSave(form, editing?.id)}
        />
      )}

      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete Authority"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This authority will be permanently removed. The action cannot be undone."
        loading={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}

function AuthorityModal(props: { existing: Authority | null; nextCode: string; onClose: () => void; onSave: (f: { name: string; description: string }) => void; }) {
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
    catch (e: any) {
      const apiErrors = e?.response?.data?.errors as Record<string, string[] | string> | undefined;
      if (apiErrors) {
        const keyMap: Record<string, string> = { description: 'desc' };   // backend field → inline field
        setErrors(p => ({ ...p, ...Object.fromEntries(Object.entries(apiErrors).map(([k, v]) => [keyMap[k] ?? k, Array.isArray(v) ? v[0] : String(v)])) }));
      }
    }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal">
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Authority' : 'Add New Authority'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the authority details below.' : 'Register a regulatory or certifying authority for trade and compliance use.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Authority Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Authority Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. FSSAI, DGFT, BIS" value={name} maxLength={CLM_NAME_MAX} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Description <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.desc ? 'clm-input-err' : ''}`} placeholder="e.g. Food Safety & Standards Authority of India" value={desc} maxLength={CLM_DESC_MAX} onChange={e => { setDesc(e.target.value); setErrors(p => ({ ...p, desc: '' })); }} />
            {errors.desc && <div className="clm-err">{errors.desc}</div>}
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Authority' : 'Save Authority')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
