import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

/* The Add/Edit form is code-split: its chunk downloads the first time a
   user opens it, not on the list's first paint. Same pattern the Customer
   and Supplier masters use for their heavy modals. */
const DdModal = lazy(() => import('./ClmDdModal'));
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import AuthorityBadges from './AuthorityBadges';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, useAutoFitRows } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import { MasterMultiSelect } from '../../../components/ui/MasterMultiSelect';
import { ClmSkeletonRows, SimpleDescModal, useScrollLock } from '../shared/clmCommon';
import SearchClear from '../../../components/ui/SearchClear';

/* Central CLM → Due Diligence Master. 3-card faithful port. */

// `authority` holds comma-joined authority IDs; `authority_names` is the
// resolved display string returned by the API.
export type Dd = { id: number; code: string; name: string; authority: string; authority_names?: string; status: 'active'|'inactive'; in_use?: boolean; used_in?: string[] };
export type Authority = { id: number; code: string; name: string };

export default function ClmDdPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Dd[]>([]);
  const [count, setCount]       = useState(0);
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(true); // start true so the shimmer shows from frame 1 (not the empty-state icon)
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  // Dynamic pagination: rows-per-page auto-fits the visible table height.
  const [rpp, setRpp]           = useState(PER_PAGE);
  const autoFitRef              = useRef(true);

  /* Typing is not a request — one fetch per pause, not per keystroke. */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  /* Newest-request token. A page move, a size change and a debounced
     search can each be in flight together; only the newest may paint. */
  const reqRef = useRef(0);
  const scrollRef               = useRef<HTMLDivElement | null>(null);
  const rootRef                 = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing]   = useState<Dd | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen); // lock html+body while the custom Add/Edit modal is open
  const [pendingDelete, setPendingDelete] = useState<Dd | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    setLoading(true);
    const token = ++reqRef.current;
    api.get<{ status: boolean; data: Dd[]; count: number; total?: number }>('/clm/dd-documents', {
      params: { page, per_page: rpp, ...(debouncedSearch ? { search: debouncedSearch } : {}) },
    })
      .then(({ data }) => {
        if (token !== reqRef.current) return;
        setRows(data.data ?? []);
        setCount(Number(data.total ?? data.count ?? 0));
      })
      .catch(() => toast.error('Load failed', 'Could not load DD documents'))
      .finally(() => setLoading(false));
  };
  /* Coalesced, not fired per change.
     On mount this effect runs with the default rows-per-page, and a moment
     later useAutoFitRows measures the viewport and changes it — so every page
     load used to cost TWO requests, one of which was thrown away. That was
     free while paging happened in the browser; now that the row count is a
     query parameter it is a second round trip, and on a slow server it
     doubles the time to first table.
     A short timer lets the count settle before anything is asked for, and it
     also absorbs fast clicks through the pager. */
  useEffect(() => {
    const t = setTimeout(() => { reload(); }, 60);
    return () => clearTimeout(t);
  }, [page, rpp, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Back to page 1 when the result SET changes rather than the position
     in it — staying on page 9 of a search with two pages shows nothing. */
  useEffect(() => { setPage(1); }, [debouncedSearch, rpp]);

  /* Authority options for the Add/Edit form's picker — mount ONLY.
     reload() runs after every save and every delete, and it used to
     Promise.all this alongside the list, so saving one row also
     re-downloaded the whole authority master for a dropdown whose
     contents had not changed. */
  useEffect(() => {
    api.get<{ status: boolean; data: Authority[] }>('/clm/authorities', { params: { view: 'options' } })
      .then(({ data }) => setAuths(data.data ?? []))
      .catch(() => { /* the list's own failure toast already covers a dead API */ });
  }, []);

  /* `rows` IS the page — the endpoint sorted, searched and sliced it.
     The client-side filter that used to live here would now be
     re-filtering ten already-filtered rows, and reporting its own page
     size as the result count. */
  const slice     = rows;
  const start     = (page - 1) * rpp;
  const safePage  = page;
  const pageCount = Math.max(1, Math.ceil(count / rpp));

  /* Dynamic rows-per-page — the shared hook, floored at PER_PAGE (10).
     The inline copy this replaces floored at 4, so a short viewport
     served four-row pages and the same tenant looked different on every
     machine. It is also debounced against settled resizes, which matters
     now that a size change is a refetch, not a re-slice. */
  const fillH = useAutoFitRows(scrollRef, autoFitRef, setRpp, [count]);

  const onSave = async (form: { name: string; authority: string }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/dd-documents/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/dd-documents', form);     toast.success('Added',   `${form.name} added`); }
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) {
      const status = e?.response?.status;
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      // 422 field-validation errors are shown inline below the field by the
      // modal — don't ALSO toast (was showing the same message twice).
      if (!(status === 422 && err && Object.keys(err).length)) {
        toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save');
      }
      throw e;   // let the modal surface field-level (422) errors below the field
    }
  };
  const onDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try { await api.delete(`/clm/dd-documents/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="clm-root" ref={rootRef}>
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={5} />}
      {/* Add DD Document — same springy hover affordance as the Add Client button:
          lift + slight scale + brightness on hover, press-down on active. */}
      <style>{`
        button.clm-add-ddfx {
          transition: transform 180ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 180ms ease, filter 180ms ease;
        }
        button.clm-add-ddfx:hover {
          transform: translateY(-1px) scale(1.02);
          filter: brightness(1.08);
          box-shadow: 0 8px 22px rgba(8,145,178,.40), inset 0 1px 0 rgba(255,255,255,.18);
        }
        button.clm-add-ddfx:active {
          transform: translateY(0) scale(0.99);
          box-shadow: 0 4px 12px rgba(8,145,178,.30), inset 0 1px 0 rgba(255,255,255,.18);
        }
      `}</style>

      <ClmPageHeader
        icon={ICO.hDd}
        title="Due Diligence Master"
        sub="Manage due diligence documents, verification records, and risk validation requirements."
        addLabel="Add DD Document"
        addClassName="clm-add-ddfx"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bDoc}
        label="Due Diligence Master"
        sub="Manage due diligence document structures and risk verification requirements."
        steps={[
          { n: '01', title: 'Create DD Record', desc: 'Add due diligence and verification documents.',               icon: ICO.doc },
          { n: '02', title: 'Map Authority',    desc: 'Define document issuing authority details.',                  icon: ICO.shield },
          { n: '03', title: 'Set Expiry Rules', desc: 'Define expiry applicability and validity.',                   icon: ICO.calendar },
          { n: '04', title: 'Enable Usage',     desc: 'Use DD documents across onboarding and compliance workflows.', icon: ICO.check },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
          <div className="clm-search clm-search-fixed">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input autoComplete="off" type="text" placeholder="Search DD documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
          </div>
          <div className="clm-total">
            <div className="clm-total-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div className="clm-total-lbl">Total DD Documents</div>
            <div className="clm-total-num">{count}</div>
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 && !loading ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bDoc}</div>
              <div className="clm-empty-title">No DD documents yet</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add DD Document to create the first record.' : 'No results match the current search.'}</div>
            </div>
          ) : (
            <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ height: fillH, maxHeight: fillH, overflow: 'hidden' }}>
              <div className="clm-rows-scroll">
              <table className="clm-table">
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 110, textAlign: 'center' }}>DD CODE</th>
                  <th>DD DOCUMENT NAME</th>
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
                      <td className="clm-td-desc"><AuthorityBadges value={r.authority_names} /></td>
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
              </div>
              {!loading && count > 0 && (
                <WorklistPager total={count} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
              )}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <Suspense fallback={null}>
          <DdModal existing={editing} authorities={auths} nextCode={`DD-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />
        </Suspense>
      )}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete DD Document"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This Due Diligence document will be permanently removed. The action cannot be undone."
        loading={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
