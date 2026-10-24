import { Suspense, useEffect, useRef, useState } from 'react';

const DdModal = lazyPage(() => import('./ClmDdModal'));
import WorklistPager from "../../../components/ui/WorklistPager";
import api from '../../../api';
import ClmDocImportExport from '../shared/ClmDocImportExport';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import AuthorityBadges from './AuthorityBadges';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, useAutoFitRows } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ClmSubHead, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import { ClmSkeletonRows, TruncCell, useScrollLock } from '../shared/clmCommon';
import SearchClear from '../../../components/ui/SearchClear';
import { lazyPage } from '../../../utils/lazyPage';

export type Dd = { id: number; code: string; name: string; authority: string; authority_names?: string; status: 'active'|'inactive'; in_use?: boolean; used_in?: string[] };
export type Authority = { id: number; code: string; name: string };

export default function ClmDdPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Dd[]>([]);
  const [count, setCount]       = useState(0);
  const [nextCode, setNextCode] = useState('');
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(true);
  const [booted, setBooted]     = useState(false);
  useEffect(() => { if (!loading) setBooted(true); }, [loading]);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [rpp, setRpp]           = useState(PER_PAGE);
  const autoFitRef              = useRef(true);

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const reqRef = useRef(0);
  const scrollRef               = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing]   = useState<Dd | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen);
  const [pendingDelete, setPendingDelete] = useState<Dd | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    setLoading(true);
    const token = ++reqRef.current;
    api.get<{ status: boolean; data: Dd[]; count: number; total?: number; next_code?: string }>('/clm/dd-documents', {
      params: { page, per_page: rpp, ...(debouncedSearch ? { search: debouncedSearch } : {}) },
    })
      .then(({ data }) => {
        if (token !== reqRef.current) return;
        setRows(data.data ?? []);
        setCount(Number(data.total ?? data.count ?? 0));
        if (data.next_code) setNextCode(data.next_code);
      })
      .catch(() => toast.error('Load failed', 'Could not load DD documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const t = setTimeout(() => { reload(); }, 60);
    return () => clearTimeout(t);
  }, [page, rpp, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1); }, [debouncedSearch, rpp]);

  useEffect(() => {
    api.get<{ status: boolean; data: Authority[] }>('/clm/authorities', { params: { view: 'options' } })
      .then(({ data }) => setAuths(data.data ?? []))
      .catch(() => {});
  }, []);

  const start = (page - 1) * rpp;
  const isEmpty = !loading && rows.length === 0;

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
      if (!(status === 422 && err && Object.keys(err).length)) {
        toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save');
      }
      throw e;
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
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      {loading && !booted && <ShimmerClmMaster cols={5} />}
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
        {/* Heading, then the search, then the actions. Sample Sheet / Import /
            Export used to share the heading's wrapper, so they ran up against
            the subtitle and split the row into three. */}
        <div className="clm-tabs-bar">
          <ClmSubHead title="Due Diligence Documents" count={count}
            sub="Risk verification records and the checks each party has to clear." />
          <div className="clm-search clm-search-fixed">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input autoComplete="off" type="text" placeholder="Search DD documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
          </div>
          <ClmDocImportExport
            endpoint="/clm/dd-documents"
            fileStem="DD_Documents"
            nameLabel="DD Document Name"
            validityLabel="Expiry"
            authorities={auths}
            samples={[{ name: 'Company Profile', validity: 'N/A' }, { name: 'Bank Reference Letter', validity: '6 Months' }]}
            search={debouncedSearch}
            onImported={reload}
          />
        </div>

        <div className="clm-tab-body has-data">
            {/* minHeight, the same floor every other CLM list uses — see the
                note on the KYC master. The pinned card plus an inner
                .clm-rows-scroll gave the rows a second scrollbar that no other
                CLM list has. */}
            <div className={`clm-table-wrap clm-table-fill ${isEmpty ? 'clm-fill-empty' : ''}`} ref={scrollRef} style={{ minHeight: fillH }}>
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
                  {!loading && rows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <TruncCell value={r.name} />
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
              {isEmpty && (
                <div className="clm-empty" style={{ flex: 1 }}>
                  <div className="clm-empty-ico">{ICO.bDoc}</div>
                  <div className="clm-empty-title">{debouncedSearch ? 'No matching DD documents' : 'No DD documents yet'}</div>
                  <div className="clm-empty-sub">{debouncedSearch ? 'No results match the current search.' : 'Click + Add DD Document to create the first record.'}</div>
                </div>
              )}
              {!loading && count > 0 && (
                <WorklistPager total={count} page={page} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
              )}
            </div>
        </div>
      </div>

      {modalOpen && (
        <Suspense fallback={null}>
          <DdModal existing={editing} authorities={auths} nextCode={nextCode} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />
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
