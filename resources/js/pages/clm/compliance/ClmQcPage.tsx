import { Suspense, useEffect, useRef, useState } from 'react';

const QcModal = lazyPage(() => import('./ClmQcModal'));
import WorklistPager from "../../../components/ui/WorklistPager";
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, useAutoFitRows } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import AuthorityBadges from './AuthorityBadges';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import { clip, ClmSkeletonRows, useScrollLock } from '../shared/clmCommon';
import SearchClear from '../../../components/ui/SearchClear';
import { lazyPage } from '../../../utils/lazyPage';

export type Qc = {
  id: number; code: string; name: string; purpose: string; issued_by: string; issued_by_names?: string;
  doc_type: 'cert'|'comp'; qa_params: string | null; min_criteria: string | null;
  status: 'active'|'inactive';
  in_use?: boolean; used_in?: string[];
};
export type Authority = { id: number; code: string; name: string };

export default function ClmQcPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Qc[]>([]);
  const [count, setCount]       = useState(0);
  const [nextCode, setNextCode] = useState('');
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(true);
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
  const [editing, setEditing]   = useState<Qc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen);
  const [pendingDelete, setPendingDelete] = useState<Qc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    setLoading(true);
    const token = ++reqRef.current;
    api.get<{ status: boolean; data: Qc[]; count?: number; total?: number; next_code?: string }>('/clm/qc-documents', {
      params: { page, per_page: rpp, ...(debouncedSearch ? { search: debouncedSearch } : {}) },
    })
      .then(({ data }) => {
        if (token !== reqRef.current) return;
        setRows(data.data ?? []);
        setCount(Number(data.total ?? data.count ?? 0));
        if (data.next_code) setNextCode(data.next_code);
      })
      .catch(() => toast.error('Load failed', 'Could not load QC documents'))
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

  const fillH = useAutoFitRows(scrollRef, autoFitRef, setRpp, [count]);

  const onSave = async (form: Omit<Qc, 'id'|'code'|'status'>, id?: number) => {
    try {
      if (id) { await api.put(`/clm/qc-documents/${id}`, form); toast.success('Updated', `${clip(form.name)} saved`); }
      else    { await api.post('/clm/qc-documents', form);     toast.success('Added',   `${clip(form.name)} added`); }
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
    try { await api.delete(`/clm/qc-documents/${pendingDelete.id}`); toast.success('Deleted', `${clip(pendingDelete.name)} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={6} />}

      <ClmPageHeader
        icon={ICO.hQc}
        title="Quality & Compliance Documents"
        sub="Manage QC certificates, testing documents, and compliance verification records."
        addLabel="Add QC Document"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bCheck}
        label="Quality & Compliance Docs"
        sub="Manage quality certificates, testing standards, and compliance document structures."
        steps={[
          { n: '01', title: 'Create QC Record',       desc: 'Add quality and compliance certificates.',           icon: ICO.check },
          { n: '02', title: 'Define QC Purpose',      desc: 'Set testing and compliance objectives.',             icon: ICO.info },
          { n: '03', title: 'Map Authority',          desc: 'Link QC documents with issuing authorities.',        icon: ICO.shield },
          { n: '04', title: 'Configure QC Standards', desc: 'Define testing parameters and acceptance criteria.', icon: ICO.zap },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
          <div className="clm-search clm-search-fixed">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input autoComplete="off" type="text" placeholder="Search QC documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
          </div>
          <div className="clm-total">
            <div className="clm-total-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
            <div className="clm-total-lbl">Total QC Documents</div>
            <div className="clm-total-num">{count}</div>
          </div>
        </div>

        <div className={`clm-tab-body ${rows.length > 0 ? 'has-data' : ''}`}>
          {rows.length === 0 && !loading ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bCheck}</div>
              <div className="clm-empty-title">{debouncedSearch ? 'No matching QC documents' : 'No QC documents yet'}</div>
              <div className="clm-empty-sub">{debouncedSearch ? 'No results match the current search.' : 'Click + Add QC Document to create the first record.'}</div>
            </div>
          ) : (
            <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ height: fillH, maxHeight: fillH, overflow: 'hidden' }}>
              <div className="clm-rows-scroll">
              <table className="clm-table">
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 110, textAlign: 'center' }}>QC ID</th>
                  <th>QC DOCUMENT NAME</th>
                  <th>PURPOSE</th>
                  <th style={{ width: 200, textAlign: 'left' }}>ISSUED BY</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <ClmSkeletonRows cols={6} />}
                  {!loading && rows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <Tooltip label={r.name}><td className="clm-td-name clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.name}</div></td></Tooltip>
                      <Tooltip label={r.purpose}><td className="clm-td-desc clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.purpose}</div></td></Tooltip>
                      <td style={{ textAlign: 'left' }}>
                        <AuthorityBadges value={r.issued_by_names} />
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
                <WorklistPager total={count} page={page} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
              )}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <Suspense fallback={null}>
          <QcModal existing={editing} authorities={auths} nextCode={nextCode} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />
        </Suspense>
      )}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete QC Document"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This QC document will be permanently removed. The action cannot be undone."
        loading={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
