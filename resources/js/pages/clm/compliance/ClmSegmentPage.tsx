import { useEffect, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { CLM_CSS, usePagedList, useAutoFitRows } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import Tooltip from '../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { ClmSkeletonRows, useScrollLock } from '../shared/clmCommon';
import { bustCustomerMasterBundle } from '../../sales/core-masters/customer/customerBundleCache';
import { bustProductMasterBundle } from '../../p2p/p2p-master-management/product-management/productBundleCache';
import { bustVendorMasterBundle } from '../../p2p/p2p-master-management/supplier-management/vendorBundleCache';
import SearchClear from '../../../components/ui/SearchClear';

function bustSegmentConsumerBundles(): void {
  bustCustomerMasterBundle();
  bustProductMasterBundle();
  bustVendorMasterBundle();
}

const clipName = (s?: string | null, n = 40) => (s && s.length > n ? s.slice(0, n) + '…' : (s ?? ''));

export type Reg = 'highly' | 'less';
export type BC  = 'allowed' | 'not_allowed';
export type SegStatus = 'active' | 'inactive';

export type Segment = {
  id: number; code: string; name: string;
  regulatory_status: Reg; buyer_consignee: BC; status: SegStatus;
  in_use?: boolean; used_in?: string[];
};
type Counts = { all: number; highly: number; less: number };

export type SegmentForm = {
  name: string;
  regulatory_status: Reg;
  buyer_consignee: BC;
  status: SegStatus;
};

export type SaveResult = { ok: true } | { ok: false; fieldErrors?: Record<string, string> };

export function nextSegmentCode(rows: { code: string }[]): string {
  let maxN = 0;
  const taken = new Set<string>();
  for (const r of rows) {
    const m = /^SG?-(\d+)$/.exec(r.code ?? '');
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
    code = `SG-${String(n).padStart(3, '0')}`;
  } while (taken.has(code));
  return code;
}

export default function ClmSegmentPage() {
  const toast = useToast();
  const confirm  = useConfirm();
  const navigate = useNavigate();

  const [tab, setTab]           = useState<'all'|'highly'|'less'>('all');
  const [bcFilter, setBcFilter] = useState<'all'|'allowed'|'not'>('all');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  const params = {
    ...(tab !== 'all' ? { regulatory_status: tab } : {}),
    ...(bcFilter !== 'all' ? { buyer_consignee: bcFilter } : {}),
  };
  const { rows, total, loading, replacing, search, setSearch, page, setPage, rpp, setRpp, meta } =
    usePagedList<Segment, { counts: Counts }>('/clm/segments', reloadKey, params);
  const counts: Counts = meta.counts ?? { all: 0, highly: 0, less: 0 };
  const narrowed = !!search.trim() || bcFilter !== 'all';
  const isEmpty = !loading && rows.length === 0;

  const [booted, setBooted] = useState(false);
  useEffect(() => { if (!loading) setBooted(true); }, [loading]);

  const firstLoad  = loading && (rows.length === 0 || replacing);
  const refreshing = loading && !firstLoad;
  const start      = (page - 1) * rpp;
  const autoFitRef = useRef(true);
  const scrollRef  = useRef<HTMLDivElement | null>(null);
  const fillH      = useAutoFitRows(scrollRef, autoFitRef, setRpp, [total, tab], '/clm/segments');

  const topCodesRef = useRef<{ code: string }[]>([]);
  useEffect(() => {
    if (page === 1 && tab === 'all' && bcFilter === 'all' && !search.trim() && rows.length) topCodesRef.current = rows;
  }, [page, tab, bcFilter, search, rows]);

  useEffect(() => {
    if (!loading && rows.length === 0 && total > 0 && page > 1) setPage(Math.ceil(total / rpp));
  }, [loading, rows.length, total, page, rpp, setPage]);

  const [editing, setEditing]     = useState<Segment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  useScrollLock(modalOpen);
  const [pendingDelete, setPendingDelete] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const onSave = async (form: SegmentForm, id?: number): Promise<SaveResult> => {
    try {
      let created: { id: number; name: string; code?: string } | null = null;
      if (id) { await api.put(`/clm/segments/${id}`, form); toast.success('Updated', `${clipName(form.name)} saved`); }
      else {
        const res = await api.post('/clm/segments', form);
        const row = res.data?.data;
        if (row?.id) created = { id: Number(row.id), name: String(row.name ?? form.name), code: row.code ? String(row.code) : undefined };
        toast.success('Added', `${clipName(form.name)} added`);
      }
      bustSegmentConsumerBundles();
      setModalOpen(false); setEditing(null); reload();

      if (created) {
        const go = await confirm({
          tone: 'teal',
          icon: 'file-list-3-line',
          title: 'Add a document rule?',
          message: (
            <>
              <b>{clipName(created.name)}</b> is saved. Set up its document rule now —
              the KYC, Due Diligence, Trade Licenses and Quality &amp; Compliance
              documents this segment requires?
            </>
          ),
          confirmLabel: 'Yes, add rule',
          cancelLabel: 'Not now',
        });
        if (go) {
          navigate('/clm/document-panel', { state: { openRuleForSegment: created } });
        }
      }
      return { ok: true };
    } catch (e: any) {
      const status = e?.response?.status as number | undefined;
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      const message = first ?? e?.response?.data?.message ?? 'Could not save';
      toast.error('Save failed', message);
      if (status === 409 && /already exists/i.test(message)) {
        return { ok: false, fieldErrors: { name: message } };
      }
      if (err?.name?.[0]) {
        return { ok: false, fieldErrors: { name: err.name[0] } };
      }
      return { ok: false };
    }
  };
  const onDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try { await api.delete(`/clm/segments/${pendingDelete.id}`); bustSegmentConsumerBundles(); toast.success('Deleted', `${clipName(pendingDelete.name)} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      {loading && !booted && <ShimmerClmMaster cols={6} />}
      <style>{`
        .clm-root .clm-tabs-bar .seg-toolbar {
          margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        /* 500px — the width every other CLM list search uses. This bar was
           300px, which next to the Authority or KYC search on the same module
           read as a different control. The filter select beside it simply sits
           200px further left; the tab rail ends well clear of it. */
        .clm-root .clm-tabs-bar .seg-search {
          flex: 0 0 auto; width: 500px; max-width: 100%;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .clm-root .seg-filter-ms { flex: 0 0 auto; }
        .clm-root .seg-filter-ms .master-select-toggle {
          /* 40px, the height of the tabs and the search it shares the row with. */
          height: 48px; padding: 0 12px;
          border: 1.5px solid rgba(6,182,212,.22); border-radius: 8px;
          background: #fff; color: #0c4a6e; font-size: 12px; font-weight: 600;
          box-shadow: 0 1px 4px rgba(6,182,212,.07);
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .clm-root .seg-filter-ms .master-select-value { color: #0c4a6e; }
        .clm-root .seg-filter-ms .master-select-toggle:hover:not(:disabled) { border-color: rgba(8,145,178,.45); box-shadow: 0 1px 4px rgba(6,182,212,.12); }
        .clm-root .seg-filter-ms .master-select-wrap.show .master-select-toggle { border-color: #0891b2 !important; box-shadow: 0 0 0 3px rgba(8,145,178,.12) !important; }
        .clm-root .seg-filter-ms .master-select-chev { font-size: 16px; color: #94a3b8; }
        .clm-root .seg-filter-ms .master-select-wrap.show .master-select-chev { color: #0891b2; }
        div.master-select-menu.dropdown-menu.seg-filter-menu { border: 1.5px solid rgba(6,182,212,.22) !important; border-radius: 8px !important; box-shadow: 0 10px 24px rgba(8,145,178,.14), 0 2px 6px rgba(15,23,42,.05) !important; }
        .seg-filter-menu .master-select-item { font-size: 12px !important; color: #0c4a6e !important; }
        .seg-filter-menu .master-select-item:hover, .seg-filter-menu .master-select-item:focus { background: rgba(6,182,212,.08) !important; color: #0e7490 !important; }
        .seg-filter-menu .master-select-item.active { background: rgba(6,182,212,.12) !important; color: #0891b2 !important; }
        [data-bs-theme="dark"] .clm-root .seg-filter-ms .master-select-toggle { background: #1e293b; border-color: rgba(6,182,212,.25); color: #e2e8f0; }
        [data-bs-theme="dark"] .clm-root .seg-filter-ms .master-select-value { color: #e2e8f0; }
        [data-bs-theme="dark"] div.master-select-menu.dropdown-menu.seg-filter-menu { background-color: #1e293b !important; border-color: rgba(6,182,212,.25) !important; }
        [data-bs-theme="dark"] .seg-filter-menu .master-select-item { color: #e2e8f0 !important; }
        [data-bs-theme="dark"] .seg-filter-menu .master-select-item:hover, [data-bs-theme="dark"] .seg-filter-menu .master-select-item:focus { background: rgba(6,182,212,.16) !important; color: #a5f3fc !important; }
        [data-bs-theme="dark"] .seg-filter-menu .master-select-item.active { background: rgba(6,182,212,.22) !important; color: #67e8f9 !important; }
        @media (max-width: 1280px) { .clm-root .clm-tabs-bar .seg-search { width: 360px; } }
        @media (max-width: 760px)  {
          .clm-root .clm-tabs-bar .seg-toolbar { width: 100%; margin-left: 0; }
          .clm-root .clm-tabs-bar .seg-search { width: 100%; }
          .clm-root .seg-filter-ms { flex: 1 1 auto; width: auto !important; }
        }
      `}</style>

      <ClmPageHeader
        icon={ICO.hSeg}
        title="Segment Master"
        sub="Manage business segments, regulatory classifications, and trade compliance structures."
        addLabel="Add Segment"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bSeg}
        label="Segment Master"
        sub="Manage segment-wise trade, regulatory, and operational structures."
        steps={[
          { n: '01', title: 'Create Segment',                       desc: 'Create business or trade segments to classify operations and contracts.', icon: ICO.grid },
          { n: '02', title: 'Set Regulatory Status',                desc: 'Define the regulatory classification applicable to this segment.',       icon: ICO.shield },
          { n: '03', title: 'Configure Customer & Consignee Rule',  desc: 'Define whether Customer ≠ Consignee is allowed for this segment.',       icon: ICO.users },
          { n: '04', title: 'Enable Operational Usage',             desc: 'Activate segment for use across contracts and operational workflows.',   icon: ICO.check },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-wrap">
          <div className="clm-tabs-bar">
            <div className="clm-tabrail">
            <button className={`clm-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => { setTab('all'); setPage(1); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              All Segments <span className="clm-tab-count">{counts.all}</span>
            </button>
            <button className={`clm-tab ${tab === 'highly' ? 'active' : ''}`} onClick={() => { setTab('highly'); setPage(1); }}>
              <span className="clm-tab-dot" style={{ background: '#ef4444', boxShadow: '0 0 5px rgba(239,68,68,.5)' }} />
              Highly Regulated Segments <span className="clm-tab-count">{counts.highly}</span>
            </button>
            <button className={`clm-tab ${tab === 'less' ? 'active' : ''}`} onClick={() => { setTab('less'); setPage(1); }}>
              <span className="clm-tab-dot" style={{ background: '#0d9488', boxShadow: '0 0 5px rgba(13,148,136,.5)' }} />
              Less Regulated Segments <span className="clm-tab-count">{counts.less}</span>
            </button>
            </div>
              <div className="seg-toolbar">
                <div className="seg-filter-ms" style={{ width: 216 }}>
                  <MasterSelect
                    value={bcFilter}
                    placeholder="Customer ≠ Consignee"
                    options={[
                      { value: 'all',     label: 'Customer ≠ Consignee: All' },
                      { value: 'allowed', label: 'Allowed' },
                      { value: 'not',     label: 'Not Allowed' },
                    ]}
                    onChange={(v) => { setBcFilter((v || 'all') as 'all'|'allowed'|'not'); setPage(1); }}
                    searchable={false}
                    menuClassName="seg-filter-menu"
                  />
                </div>
                <div className="clm-search seg-search">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input autoComplete="off" type="text" placeholder="Search segments…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
                  <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
                </div>
              </div>
          </div>

          <div className="clm-tab-body has-data">
              <div className={`clm-table-wrap clm-table-fill ${isEmpty ? 'clm-fill-empty' : ''}`} ref={scrollRef} style={{ minHeight: fillH }}>
                <table className="clm-table" style={{ tableLayout: 'fixed', width: '100%', opacity: refreshing ? 0.5 : 1, transition: 'opacity .15s ease' }}>
                  <thead><tr>
                    <th style={{ width: '6%', textAlign: 'center' }}>SR. NO</th>
                    <th style={{ width: '12%', textAlign: 'center' }}>SEGMENT ID</th>
                    <th style={{ width: '28%' }}>SEGMENT NAME</th>
                    <th style={{ width: '19%', textAlign: 'center' }}>REGULATORY STATUS</th>
                    <th style={{ width: '20%', textAlign: 'center' }}>CUSTOMER ≠ CONSIGNEE</th>
                    <th style={{ width: '15%', textAlign: 'center' }}>ACTIONS</th>
                  </tr></thead>
                  <tbody>
                    {firstLoad && <ClmSkeletonRows rows={rpp} cols={6} />}
                    {!firstLoad && rows.map((r, i) => (
                      <tr key={r.id}>
                        <td className="clm-td-num">{start + i + 1}</td>
                        <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                        <Tooltip label={r.name}><td className="clm-td-name clm-td-trunc-cell" style={{ maxWidth: 'none' }}><div className="clm-td-name-trunc">{clipName(r.name, 35)}</div></td></Tooltip>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`clm-badge ${r.regulatory_status === 'highly' ? 'clm-badge-red' : 'clm-badge-emerald'}`}>
                            <span className="clm-badge-dot" />
                            {r.regulatory_status === 'highly' ? 'Highly Regulated' : 'Less Regulated'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`clm-badge ${r.buyer_consignee === 'allowed' ? 'clm-badge-green' : 'clm-badge-red'}`}>
                            <span className="clm-badge-dot" />
                            {r.buyer_consignee === 'allowed' ? 'Allowed' : 'Not Allowed'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="clm-actions">
                            <Tooltip label="Edit segment">
                              <button type="button" aria-label="Edit segment" className="clm-act clm-act-edit" onClick={() => { setEditing(r); setModalOpen(true); }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            </Tooltip>
                            <Tooltip label={r.in_use
                              ? `In use by ${(r.used_in || []).join(', ')} — can't delete`
                              : 'Delete segment'}>
                              <button
                                type="button"
                                aria-label="Delete segment"
                                className="clm-act clm-act-del"
                                aria-disabled={r.in_use || undefined}
                                onClick={() => { if (r.in_use) return; setPendingDelete(r); }}
                                style={r.in_use ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
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
                {isEmpty && (
                  <div className="clm-empty" style={{ flex: 1 }}>
                    <div className="clm-empty-ico">{ICO.bSeg}</div>
                    <div className="clm-empty-title">
                      {narrowed ? 'No Matching Segments' : <>
                        {tab === 'all'    && 'No Segments Yet'}
                        {tab === 'highly' && 'No Highly Regulated Segments'}
                        {tab === 'less'   && 'No Less Regulated Segments'}
                      </>}
                    </div>
                    <div className="clm-empty-sub">{!narrowed && counts.all === 0 ? 'Click "+ Add Segment" to create your first segment entry.' : 'No segments match the current tab / search.'}</div>
                  </div>
                )}
                {!loading && total > 0 && (
                  <WorklistPager total={total} page={page} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
                )}
              </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <SegmentModal
          existing={editing}
          nextCode={nextSegmentCode(topCodesRef.current)}
          existingSegments={rows.filter(r => r.id !== editing?.id)}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={(form) => onSave(form, editing?.id)}
        />
      )}

      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete Segment"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This segment will be permanently removed. The action cannot be undone."
        loading={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}

export function SegmentModal(props: { existing: Segment | null; nextCode: string; existingSegments?: { name: string; regulatory_status?: string }[]; onClose: () => void; onSave: (f: SegmentForm) => SaveResult | Promise<SaveResult> | void | Promise<void>; }) {
  const { existing, nextCode, existingSegments = [], onClose, onSave } = props;
  const isEdit = !!existing;

  const [name, setName]     = useState(existing?.name ?? '');
  const [reg, setReg]       = useState<Reg | ''>(existing?.regulatory_status ?? '');
  const [bc, setBc]         = useState<BC  | ''>(existing?.buyer_consignee   ?? '');
  const status: SegStatus = existing?.status ?? 'active';
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const inUse = isEdit && !!existing?.in_use;

  const handleSave = async () => {
    if (saving) return;
    const trimmed = name.trim();
    const next: Record<string, string> = {};
    if (!trimmed) next.name = 'Name is required';
    else if (trimmed.length > 255) next.name = 'Segment Name must be 255 characters or fewer';
    else if (/[<>]/.test(trimmed)) next.name = 'Segment Name cannot contain HTML characters (< or >)';
    else if (/(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/i.test(trimmed)) {
      next.name = 'Segment Name contains disallowed patterns (possible SQL/JS injection)';
    }
    else if (!/[A-Za-z0-9]/.test(trimmed)) next.name = 'Segment Name must contain meaningful text (letters or numbers, not only symbols)';
    else if (!/^[A-Za-z0-9\s\-.,()&/'%]+$/.test(trimmed)) {
      next.name = "Segment Name may only contain letters, numbers, spaces, and . , - ( ) & / ' %";
    }
    else {
      const lower = trimmed.toLowerCase();
      if (reg && existingSegments.some(s => s.name.trim().toLowerCase() === lower && s.regulatory_status === reg)) {
        next.name = `"${clipName(trimmed)}" already exists as ${reg === 'highly' ? 'Highly' : 'Less'} Regulated. Pick a different name or regulatory status.`;
      }
    }
    if (!reg) next.reg = 'Regulatory status is required';
    else if (inUse && reg !== existing?.regulatory_status) next.reg = "This segment is in use — its regulatory status can't be changed.";
    if (!bc)  next.bc  = 'Customer / Consignee rule is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const result = await Promise.resolve(onSave({
        name: trimmed,
        regulatory_status: reg as Reg,
        buyer_consignee: bc as BC,
        status,
      }));
      if (result && result.ok === false && result.fieldErrors) {
        setErrors(prev => ({ ...prev, ...result.fieldErrors }));
      }
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal">
        {saving && <div className="clm-saving-veil" aria-hidden />}
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">{isEdit ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            )}</div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Segment' : 'Add New Segment'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the segment details below.' : 'Define a business or trade segment with regulatory classification and customer-consignee rules.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Segment Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>

          <div className="clm-modal-divider" />

          <div className="clm-field">
            <label className="clm-field-label">Segment Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. Tobacco, Rice, Food Grade Ethanol" maxLength={255} value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} readOnly={inUse} tabIndex={inUse ? -1 : undefined} style={inUse ? { background: 'var(--vz-secondary-bg)', color: 'var(--vz-secondary-color)', cursor: 'not-allowed' } : undefined} autoFocus={!inUse} />
            {inUse
              ? <div style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', marginTop: 4 }}>Segment name is locked because this segment is in use{(existing?.used_in?.length) ? ` by ${existing.used_in.join(', ')}` : ''} — renaming would break those records.</div>
              : <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{name.length}/255</div>}
            {errors.name && (
              /already exists/i.test(errors.name) ? (
                <div role="alert" style={{
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: 12,
                  lineHeight: 1.4,
                  minWidth: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}><strong>Duplicate segment.</strong> {errors.name}</span>
                </div>
              ) : (
                <div className="clm-err">{errors.name}</div>
              )
            )}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Regulatory Status <span className="clm-req">*</span></label>
            <MasterSelect
              value={reg}
              invalid={!!errors.reg}
              disabled={inUse}
              placeholder="— Select —"
              options={[
                { value: 'highly', label: 'Highly Regulated' },
                { value: 'less',   label: 'Less Regulated' },
              ]}
              onChange={(v) => { setReg(v as Reg); setErrors(p => ({ ...p, reg: '' })); }}
            />
            {inUse && <div className="clm-field-hint">Regulatory status is locked because this segment is in use{(existing?.used_in?.length) ? ` by ${existing.used_in.join(', ')}` : ''} — re-classifying would break those records.</div>}
            {errors.reg && <div className="clm-err">{errors.reg}</div>}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Customer ≠ Consignee <span className="clm-req">*</span></label>
            <MasterSelect
              value={bc}
              invalid={!!errors.bc}
              placeholder="— Select —"
              options={[
                { value: 'allowed',     label: 'Allowed' },
                { value: 'not_allowed', label: 'Not Allowed' },
              ]}
              onChange={(v) => { setBc(v as BC); setErrors(p => ({ ...p, bc: '' })); }}
            />
            {errors.bc && <div className="clm-err">{errors.bc}</div>}
          </div>

        </div>

        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Segment' : 'Save Segment')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
