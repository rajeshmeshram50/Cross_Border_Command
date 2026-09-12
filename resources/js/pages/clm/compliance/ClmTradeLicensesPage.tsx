import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

/* The Add/Edit form is code-split: its chunk downloads the first time a
   user opens it, not on the list's first paint. Same pattern the Customer
   and Supplier masters use for their heavy modals. */
const TlModal = lazy(() => import('./ClmTlModal'));
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, useAutoFitRows } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import { MasterMultiSelect } from '../../../components/ui/MasterMultiSelect';
import { ClmSkeletonRows, SimpleDescModal, useScrollLock } from '../shared/clmCommon';
import SearchClear from '../../../components/ui/SearchClear';

/* Central CLM → Trade Licences Master. 3-card faithful port. */

// `authority` holds comma-joined authority IDs; `authority_names` is the
// resolved display string returned by the API.
export type Tl = { id: number; code: string; name: string; authority: string; authority_names?: string; status: 'active'|'inactive'; in_use?: boolean; used_in?: string[] };
export type Authority = { id: number; code: string; name: string };

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
  const [editing, setEditing]   = useState<Tl | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen); // lock html+body while the custom Add/Edit modal is open
  const [pendingDelete, setPendingDelete] = useState<Tl | null>(null);
  const [deleting, setDeleting] = useState(false);
  // All-authorities popover — opened from the +N badge in the ISSUING
  // AUTHORITY column (same pattern as the DCP authorities popover).
  // flipUp/maxH keep the popover inside the viewport — same clamp as the CLM
  // document-master lists (QA #4).
  const [authPop, setAuthPop] = useState<{ id: number; names: string[]; x: number; y: number; flipUp: boolean; maxH: number } | null>(null);
  // Close the fixed-positioned authorities popover on scroll/resize so it can't
  // drift away from its badge (capture:true catches ancestor + table scrolls).
  useEffect(() => {
    if (!authPop) return;
    const close = () => setAuthPop(null);
    // A scroll inside the popover must not close it, or a long list is unscrollable.
    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('.clm-pop')) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
  }, [authPop]);

  const reload = () => {
    setLoading(true);
    const token = ++reqRef.current;
    api.get<{ status: boolean; data: Tl[]; count: number; total?: number }>('/clm/trade-licenses', {
      params: { page, per_page: rpp, ...(debouncedSearch ? { search: debouncedSearch } : {}) },
    })
      .then(({ data }) => {
        if (token !== reqRef.current) return;
        setRows(data.data ?? []);
        setCount(Number(data.total ?? data.count ?? 0));
      })
      .catch(() => toast.error('Load failed', 'Could not load trade licences'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, [page, rpp, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <input autoComplete="off" type="text" placeholder="Search trade licences…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
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
            <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ height: fillH, maxHeight: fillH, overflow: 'hidden' }}>
              <div className="clm-rows-scroll">
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
                                  onClick={e => {
                                    if (authPop?.id === r.id) { setAuthPop(null); return; }
                                    const b = e.currentTarget.getBoundingClientRect();
                                    const estH = Math.min(280, 34 + list.length * 30);
                                    const below = window.innerHeight - b.bottom - 12;
                                    const above = b.top - 12;
                                    const flipUp = below < estH && above > below;
                                    setAuthPop({ id: r.id, names: list, x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp, maxH: Math.max(120, Math.min(280, flipUp ? above : below)) });
                                  }}
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
          <TlModal existing={editing} authorities={auths} nextCode={`TL-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />
        </Suspense>
      )}
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
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(authPop.x, window.innerWidth - 230), top: authPop.flipUp ? undefined : authPop.y, bottom: authPop.flipUp ? (window.innerHeight - authPop.y) : undefined, zIndex: 601, width: 210, maxHeight: authPop.maxH, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
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
