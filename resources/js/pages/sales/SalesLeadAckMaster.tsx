import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Lead Acknowledgement Master
 *
 * React port of the IDIMS Lead Acknowledgement Master design. Three tabs —
 * Qualified / Disqualified / Clarity Pending — each backed by a row in
 * `lead_ack_reasons` (opportunity_type column). Only the Disqualified tab
 * carries a dq_status (Positive/Negative) — the column appears for that tab
 * only and the modal exposes the picker only for that opportunity type.
 *
 * Perm-gated on sales.lead_ack_master per the Sales Matrix permission sheet.
 * The trash icon flips status to inactive (PUT) rather than deleting — same
 * semantics as the source design.
 * ──────────────────────────────────────────────────────────────────────── */

type OppType = 'qualified' | 'disqualified' | 'clarity_pending';
type Status  = 'active' | 'inactive';
type DQ      = 'positive' | 'negative';

type Reason = {
  id: number;
  opportunity_type: OppType;
  reason: string;
  status: Status;
  dq_status: DQ | null;
};

type GroupedReasons = {
  qualified: Reason[];
  disqualified: Reason[];
  clarity_pending: Reason[];
};

const TAB_KEYS: OppType[] = ['qualified', 'disqualified', 'clarity_pending'];
const TAB_LABELS: Record<OppType, string> = {
  qualified: 'Qualified Opportunity',
  disqualified: 'Disqualified Opportunity',
  clarity_pending: 'Clarity Pending Opportunity',
};
const COLUMN_HEADERS: Record<OppType, string> = {
  qualified: 'Reason For Qualified Opportunity',
  disqualified: 'Reason For Disqualified Opportunity',
  clarity_pending: 'Reason For Clarity Pending Opportunity',
};

export default function SalesLeadAckMaster() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.lead_ack_master'];
  const canView   = isSuperAdmin || !!perm?.can_view;
  const canAdd    = isSuperAdmin || !!perm?.can_add;
  const canEdit   = isSuperAdmin || !!perm?.can_edit;
  const canDelete = isSuperAdmin || !!perm?.can_delete;

  // Data
  const [data, setData] = useState<GroupedReasons>({ qualified: [], disqualified: [], clarity_pending: [] });
  const [loading, setLoading] = useState(true);

  // UI state
  const [tab, setTab]   = useState<OppType>('qualified');
  const [q, setQ]       = useState('');
  const [rpp, setRpp]   = useState(10);
  const [page, setPage] = useState(1);

  // Modals
  const [oppSelectorOpen, setOppSelectorOpen] = useState(false);
  const [formOpen, setFormOpen]               = useState(false);
  const [editingId, setEditingId]             = useState<number | null>(null);
  const [pendingType, setPendingType]         = useState<OppType | null>(null); // type for a fresh add

  // Form state
  const [formReason, setFormReason]     = useState('');
  const [formStatus, setFormStatus]     = useState<Status>('active');
  const [formDQ, setFormDQ]             = useState<DQ>('positive');
  const [formError, setFormError]       = useState('');
  const [saving, setSaving]             = useState(false);

  // Inject Google Fonts (DM Sans) once on mount.
  useEffect(() => {
    const id = 'sm-lam-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  // Fetch on mount if user can view.
  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.get('/sales/lead-ack-reasons')
      .then(res => {
        if (cancelled) return;
        setData({
          qualified: res.data.qualified || [],
          disqualified: res.data.disqualified || [],
          clarity_pending: res.data.clarity_pending || [],
        });
      })
      .catch(() => { if (!cancelled) toast.error('Failed to load', 'Could not fetch lead acknowledgement reasons'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // toast is stable from the provider; canView depends on user (fetched once on login)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  // Filter + paginate
  const filtered = useMemo(() => {
    const rows = data[tab] || [];
    if (!q) return rows;
    const lo = q.toLowerCase();
    return rows.filter(r => r.reason.toLowerCase().includes(lo));
  }, [data, tab, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;
  const rows = filtered.slice(startIdx, startIdx + rpp);

  // Tab switch resets page + clears search (matches HTML behaviour).
  const switchTab = (next: OppType) => { setTab(next); setPage(1); setQ(''); };

  // ── Modal actions ──
  const openAdd = () => {
    if (!canAdd) return;
    setOppSelectorOpen(true);
    setPendingType(null);
    setEditingId(null);
  };

  const selectOpp = (t: OppType) => {
    setPendingType(t);
    setOppSelectorOpen(false);
    setFormReason('');
    setFormStatus('active');
    setFormDQ('positive');
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (row: Reason) => {
    if (!canEdit) return;
    setEditingId(row.id);
    setPendingType(row.opportunity_type);
    setFormReason(row.reason);
    setFormStatus(row.status);
    setFormDQ(row.dq_status ?? 'positive');
    setFormError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setPendingType(null);
  };

  const save = async () => {
    const reason = formReason.trim();
    if (!reason) { setFormError('⚠  Reason is required.'); return; }
    if (!pendingType) { setFormError('Internal error: opportunity type missing.'); return; }
    setFormError('');
    setSaving(true);
    try {
      if (editingId !== null) {
        // Edit
        const payload: any = { reason, status: formStatus };
        if (pendingType === 'disqualified') payload.dq_status = formDQ;
        const res = await api.put(`/sales/lead-ack-reasons/${editingId}`, payload);
        setData(prev => ({
          ...prev,
          [pendingType]: prev[pendingType].map(r => r.id === editingId ? res.data : r),
        }));
        toast.success('Saved', 'Reason updated successfully');
      } else {
        // Create
        const payload: any = {
          opportunity_type: pendingType,
          reason,
          status: formStatus,
        };
        if (pendingType === 'disqualified') payload.dq_status = formDQ;
        const res = await api.post('/sales/lead-ack-reasons', payload);
        setData(prev => ({ ...prev, [pendingType]: [...prev[pendingType], res.data] }));
        setTab(pendingType);
        setPage(1);
        toast.success('Added', `Reason added to ${TAB_LABELS[pendingType]}`);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to save reason';
      setFormError(msg);
      toast.error('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  // Trash button — flips status to inactive (matches HTML "Mark Inactive").
  const markInactive = async (row: Reason) => {
    if (!canDelete) return;
    if (row.status === 'inactive') {
      toast.info('Already inactive', `${row.reason}`);
      return;
    }
    try {
      const res = await api.put(`/sales/lead-ack-reasons/${row.id}`, { status: 'inactive' });
      setData(prev => ({
        ...prev,
        [row.opportunity_type]: prev[row.opportunity_type].map(r => r.id === row.id ? res.data : r),
      }));
      toast.info('Marked as Inactive', row.reason);
    } catch (err: any) {
      toast.error('Update failed', err?.response?.data?.message || 'Could not mark inactive');
    }
  };

  /* ─── No-access early return ─── */
  if (!canView) {
    return (
      <div className="lam-root">
        <style>{SCOPED_CSS}</style>
        <div className="lam-no-access">
          <div className="lam-no-access-title">No access</div>
          <div className="lam-no-access-sub">You don't have permission to view Lead Acknowledgement Master. Ask your branch admin to grant <strong>can_view</strong> on Sales Matrix → Lead Acknowledgement Master.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="lam-root">
      <style>{SCOPED_CSS}</style>

      {/* Header */}
      <div className="lam-header">
        <span className="lam-header-glow1" />
        <span className="lam-header-glow2" />
        <button
          type="button"
          onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/sales'); }}
          aria-label="Back"
          title="Back"
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,255,255,0.18)',
            border: '1px solid rgba(255,255,255,0.30)',
            color: '#fff', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginRight: 6,
          }}
        >
          <i className="ri-arrow-left-line" style={{ fontSize: 17 }} />
        </button>
        <div className="lam-header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <div className="lam-header-text">
          <div className="lam-header-title">Lead Acknowledgement Master</div>
          <div className="lam-header-sub">Manage qualification, disqualification, and clarity pending reasons for the sales pipeline</div>
        </div>
        {canAdd && (
          <button className="lam-add-btn" onClick={openAdd}>
            <IconPlus />
            Add New Reason
          </button>
        )}
      </div>

      {/* Tabs + Search */}
      <div className="lam-tabs-row">
        <div className="lam-tabs">
          {TAB_KEYS.map(t => (
            <button
              key={t}
              className={`lam-tab ${tab === t ? 'lam-tab-active' : ''}`}
              onClick={() => switchTab(t)}
            >
              {t === 'qualified'       && <IconCheckCircle />}
              {t === 'disqualified'    && <IconXCircle />}
              {t === 'clarity_pending' && <IconInfoCircle />}
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="lam-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by reason…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Table card */}
      <div className="lam-table-card">
        <div className="lam-table-wrap">
          <table className="lam-table" style={{ tableLayout: 'fixed', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 56 }}>Sr No</th>
                <th>{COLUMN_HEADERS[tab]}</th>
                {tab === 'disqualified' && <th style={{ width: 110 }}>DQ Status</th>}
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 90, textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={tab === 'disqualified' ? 5 : 4} className="lam-empty">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={tab === 'disqualified' ? 5 : 4} className="lam-empty">No reasons found</td></tr>
              )}
              {!loading && rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="lam-td-sr">
                    <span className="lam-sr-pill">{startIdx + i + 1}</span>
                  </td>
                  <td className="lam-td-reason">{r.reason}</td>
                  {tab === 'disqualified' && (
                    <td>
                      {r.dq_status === 'positive'
                        ? <span className="lam-badge lam-positive">↑ Positive</span>
                        : <span className="lam-badge lam-negative">↓ Negative</span>}
                    </td>
                  )}
                  <td>
                    {r.status === 'active'
                      ? <span className="lam-badge lam-active"><span className="lam-dot" style={{ background:'#15803d' }} />Active</span>
                      : <span className="lam-badge lam-inactive"><span className="lam-dot" style={{ background:'#94a3b8' }} />Inactive</span>}
                  </td>
                  <td>
                    <div className="lam-actions">
                      {canEdit && (
                        <Tooltip label="Edit">
                          <button aria-label="Edit" className="lam-ab lam-edit" onClick={() => openEdit(r)}>
                            <IconEdit />
                          </button>
                        </Tooltip>
                      )}
                      {canDelete && (
                        <Tooltip label={r.status === 'inactive' ? 'Already inactive' : 'Mark Inactive'}>
                          <button
                            aria-label={r.status === 'inactive' ? 'Already inactive' : 'Mark Inactive'}
                            className={`lam-ab lam-del ${r.status === 'inactive' ? 'lam-ab-muted' : ''}`}
                            onClick={() => markInactive(r)}
                            disabled={r.status === 'inactive'}
                          >
                            <IconTrash />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="lam-pagination">
          <span className="lam-pag-info">
            {total === 0
              ? 'No records found'
              : <>Showing <strong>{startIdx + 1}–{Math.min(startIdx + rpp, total)}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="lam-pag-right">
            <div className="lam-rpp">
              Rows:
              <select value={rpp} onChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            <span className="lam-pag-range">{safePage} / {pages}</span>
            <div className="lam-pag-btns">
              <button className="lam-pag-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button className="lam-pag-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Opportunity-type selector modal */}
      {oppSelectorOpen && (
        <div className="lam-overlay" onMouseDown={() => setOppSelectorOpen(false)}>
          <div className="lam-modal lam-modal-md" onMouseDown={e => e.stopPropagation()}>
            <div className="lam-modal-header">
              <div className="lam-modal-hicon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              </div>
              <div className="lam-modal-htext">
                <div className="lam-modal-title">Select Opportunity Type</div>
                <div className="lam-modal-sub">Choose where to store this reason</div>
              </div>
              <button className="lam-modal-close" onClick={() => setOppSelectorOpen(false)}><IconX /></button>
            </div>
            <div className="lam-modal-body">
              <p className="lam-modal-helper">Select the opportunity type for which you want to add a new reason:</p>
              <div className="lam-opp-options">
                <button className="lam-opp lam-opp-qualified" onClick={() => selectOpp('qualified')}>
                  <div className="lam-opp-icon"><IconCheckCircle large /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Qualified Opportunity</div>
                    <div className="lam-opp-sub">Add reason for qualifying a lead</div>
                  </div>
                  <IconChevronRight />
                </button>
                <button className="lam-opp lam-opp-disqualified" onClick={() => selectOpp('disqualified')}>
                  <div className="lam-opp-icon"><IconXCircle large /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Disqualified Opportunity</div>
                    <div className="lam-opp-sub">Add reason for disqualifying a lead</div>
                  </div>
                  <IconChevronRight />
                </button>
                <button className="lam-opp lam-opp-clarity" onClick={() => selectOpp('clarity_pending')}>
                  <div className="lam-opp-icon"><IconInfoCircle large /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Clarity Pending Opportunity</div>
                    <div className="lam-opp-sub">Add reason for pending clarification</div>
                  </div>
                  <IconChevronRight />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {formOpen && pendingType && (
        <div className="lam-overlay" onMouseDown={closeForm}>
          <div className="lam-modal lam-modal-lg" onMouseDown={e => e.stopPropagation()}>
            <div className="lam-modal-header">
              <div className="lam-modal-hicon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              </div>
              <div className="lam-modal-htext">
                <div className="lam-modal-title">{editingId !== null ? 'Edit Reason' : `Add ${pendingType === 'qualified' ? 'Qualified' : pendingType === 'disqualified' ? 'Disqualified' : 'Clarity Pending'} Reason`}</div>
                <div className="lam-modal-sub">{TAB_LABELS[pendingType]}</div>
              </div>
              <button className="lam-modal-close" onClick={closeForm}><IconX /></button>
            </div>
            <div className="lam-modal-body">
              {/* Reason */}
              <div className="lam-field">
                <label className="lam-label">Reason <span className="lam-req">*</span></label>
                <textarea
                  className="lam-textarea"
                  placeholder="Enter reason (max 500 characters)"
                  maxLength={500}
                  rows={3}
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                />
                <div className="lam-char-count">
                  <span>{formReason.length}</span>
                  <span className="lam-char-max">/500</span>
                </div>
              </div>

              {/* Status + DQ */}
              <div className={`lam-form-grid ${pendingType === 'disqualified' ? 'two' : 'one'}`}>
                <div className="lam-field">
                  <label className="lam-label">Status <span className="lam-req">*</span></label>
                  <div className="lam-select-wrap">
                    <select className="lam-select" value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <svg className="lam-select-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
                {pendingType === 'disqualified' && (
                  <div className="lam-field">
                    <label className="lam-label">DQ Status <span className="lam-req">*</span></label>
                    <div className="lam-select-wrap">
                      <select className="lam-select" value={formDQ} onChange={e => setFormDQ(e.target.value as DQ)}>
                        <option value="positive">↑ Positive</option>
                        <option value="negative">↓ Negative</option>
                      </select>
                      <svg className="lam-select-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </div>
                )}
              </div>

              {formError && <div className="lam-error">{formError}</div>}
            </div>

            <div className="lam-modal-footer">
              <div className="lam-footer-hint">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                Fields marked <span className="lam-req">*</span> are required
              </div>
              <div className="lam-footer-actions">
                <button className="lam-btn lam-btn-light" onClick={closeForm} disabled={saving}>Cancel</button>
                <button className="lam-btn lam-btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    Save Reason
                  </>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Icons ─── */
const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const IconCheckCircle = ({ large = false }: { large?: boolean }) => (
  <svg width={large ? 18 : 11} height={large ? 18 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
);
const IconXCircle = ({ large = false }: { large?: boolean }) => (
  <svg width={large ? 18 : 11} height={large ? 18 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
);
const IconInfoCircle = ({ large = false }: { large?: boolean }) => (
  <svg width={large ? 18 : 11} height={large ? 18 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);
const IconChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
);
const IconX = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const IconEdit = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
);
const IconTrash = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
);

/* ─── Scoped CSS ─── */
const SCOPED_CSS = `
.lam-root {
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  background: #f5f3ff;
  padding: 14px 18px 20px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 8px;
  color: #111827;
  font-size: 13.5px;
}
.lam-root *, .lam-root *::before, .lam-root *::after { box-sizing: border-box; }

.lam-no-access {
  background: #fff; border: 1.5px solid #e9e3ff; border-radius: 12px;
  padding: 28px 24px; text-align: center;
  box-shadow: 0 2px 10px rgba(124,58,237,.07);
}
.lam-no-access-title { font-size: 16px; font-weight: 800; color: #6d28d9; }
.lam-no-access-sub   { font-size: 12px; color: #6b7280; margin-top: 8px; line-height: 1.55; max-width: 540px; margin-left: auto; margin-right: auto; }

/* ─── Header ─── */
.lam-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  background: linear-gradient(100deg, #f5f3ff 0%, #ede9fe 55%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 12px;
  padding: 12px 16px 12px 20px;
  box-shadow: 0 2px 10px rgba(139,92,246,.12);
}
.lam-header-glow1 {
  position: absolute; right: -10px; top: -10px;
  width: 90px; height: 90px; border-radius: 50%;
  background: rgba(139,92,246,.08); pointer-events: none;
}
.lam-header-glow2 {
  position: absolute; left: 30%; bottom: -20px;
  width: 120px; height: 120px; border-radius: 50%;
  background: rgba(109,40,217,.05); pointer-events: none;
}
.lam-header-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; z-index: 1;
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.lam-header-text { flex: 1 1 220px; min-width: 0; z-index: 1; }
.lam-header-title { font-size: 15px; font-weight: 800; color: #4c1d95; letter-spacing: -.3px; line-height: 1.2; }
.lam-header-sub   { font-size: 11px; color: #7c3aed; margin-top: 2px; font-weight: 500; opacity: .85; }
.lam-add-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 9px; border: none;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; flex-shrink: 0; z-index: 1; white-space: nowrap;
  box-shadow: 0 4px 14px rgba(124,58,237,.4);
  transition: transform .15s, box-shadow .15s;
}
.lam-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(124,58,237,.50); }

/* ─── Tabs + Search ─── */
.lam-tabs-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.lam-tabs {
  display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
  background: #f5f3ff; padding: 4px; border-radius: 10px; border: 1.5px solid #ddd6fe;
}
.lam-tab {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: none;
  padding: 6px 14px; border-radius: 7px;
  font-family: inherit; font-size: 12px; font-weight: 600;
  color: #7c3aed; cursor: pointer; transition: all .15s; white-space: nowrap;
}
.lam-tab:hover { background: rgba(124,58,237,.06); }
.lam-tab-active {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed) !important;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(124,58,237,.35);
}
.lam-search {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1.5px solid #ddd6fe; border-radius: 9px;
  padding: 7px 13px; max-width: 260px;
}
.lam-search:focus-within { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,.10); }
.lam-search input {
  border: none; background: transparent; outline: none;
  font-family: inherit; font-size: 11.5px; color: #1e293b; width: 100%;
}
.lam-search input::placeholder { color: #c4b5fd; font-weight: 400; }

/* ─── Table card ─── */
.lam-table-card {
  background: #fff; border: 1.5px solid #e9e3ff; border-radius: 10px;
  overflow: hidden; box-shadow: 0 2px 10px rgba(124,58,237,.07);
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.lam-table-wrap { flex: 1; overflow: auto; }
.lam-table { width: 100%; border-collapse: collapse; }
.lam-table thead tr {
  background: linear-gradient(120deg, #4c1d95 0%, #7c3aed 55%, #8b5cf6 100%);
}
.lam-table thead th {
  padding: 10px 12px; text-align: left; white-space: nowrap;
  color: rgba(255,255,255,.92);
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
}
.lam-table thead th:first-child { padding-left: 16px; }
.lam-table tbody tr {
  border-bottom: 1px solid #f5f3ff;
  background: #fff;
  transition: background .1s;
}
.lam-table tbody tr:nth-child(even) { background: #fdfcff; }
.lam-table tbody tr:hover { background: #faf5ff; }
.lam-table tbody tr:last-child { border-bottom: none; }
.lam-table tbody td {
  padding: 9px 12px; font-size: 11.5px; vertical-align: middle;
  color: #334155;
}
.lam-table tbody td:first-child { padding-left: 16px; }
.lam-td-reason { font-weight: 500; color: #334155; line-height: 1.5; }
.lam-empty { text-align: center; padding: 32px !important; color: #94a3b8; font-style: italic; }

.lam-sr-pill {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  color: #7c3aed; font-size: 10px; font-weight: 800;
  border: 1px solid #c4b5fd;
}

/* Badges */
.lam-badge {
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 20px; padding: 3px 9px;
  font-size: 10.5px; font-weight: 700;
}
.lam-active   { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.lam-inactive { background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0; }
.lam-positive { background: #dbeafe; color: #1d4ed8; border: 1px solid #bfdbfe; }
.lam-negative { background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; }
.lam-dot { width: 5px; height: 5px; border-radius: 50%; }

.lam-actions { display: flex; gap: 4px; justify-content: center; }
.lam-ab {
  width: 26px; height: 26px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; cursor: pointer; transition: all .15s;
}
.lam-edit { background: #eef2ff; color: #6366f1; }
.lam-edit:hover { background: #6366f1; color: #fff; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(99,102,241,.30); }
.lam-del  { background: #fff1f2; color: #f43f5e; }
.lam-del:hover:not(:disabled)  { background: #f43f5e; color: #fff; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(244,63,94,.30); }
.lam-ab:disabled { cursor: not-allowed; }
.lam-ab-muted { opacity: .40; background: #f1f5f9 !important; color: #94a3b8 !important; }
.lam-ab-muted:hover { transform: none !important; box-shadow: none !important; background: #f1f5f9 !important; color: #94a3b8 !important; }

/* ─── Pagination ─── */
.lam-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 16px; border-top: 2px solid #ede9fe;
  background: linear-gradient(90deg, #faf5ff, #f5f3ff);
  flex-wrap: wrap; gap: 8px;
}
.lam-pag-info {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 500; color: #6d28d9;
  background: #fff; border: 1.5px solid #ddd6fe;
  padding: 4px 13px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(139,92,246,.08);
}
.lam-pag-info strong { color: #7c3aed; font-weight: 800; }
.lam-pag-right { display: flex; align-items: center; gap: 8px; }
.lam-rpp {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #6d28d9; font-weight: 500;
  background: #fff; border: 1.5px solid #ddd6fe;
  padding: 3px 12px; border-radius: 20px;
}
.lam-rpp select {
  border: none; background: transparent;
  font-family: inherit; font-size: 11.5px; color: #7c3aed; font-weight: 700;
  cursor: pointer; outline: none;
}
.lam-pag-range {
  font-size: 11.5px; font-weight: 700; color: #0f172a;
  background: linear-gradient(135deg, #ede9fe, #f5f3ff);
  border: 1.5px solid #c4b5fd;
  padding: 4px 14px; border-radius: 20px; white-space: nowrap;
}
.lam-pag-btns { display: flex; gap: 4px; }
.lam-pag-btn {
  width: 30px; height: 30px; border-radius: 50%;
  border: 1.5px solid #ddd6fe; background: #fff;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #7c3aed; transition: all .2s;
}
.lam-pag-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed) !important;
  color: #fff !important; border-color: transparent !important;
}
.lam-pag-btn:disabled { opacity: .4; cursor: default; }

/* ─── Modals ─── */
.lam-overlay {
  position: fixed; inset: 0;
  background: rgba(15,23,42,.55); backdrop-filter: blur(6px);
  z-index: 9200;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: lam-fade-in .20s ease;
}
@keyframes lam-fade-in { from { opacity: 0; } to { opacity: 1; } }
.lam-modal {
  background: #fff; border-radius: 16px; overflow: hidden;
  box-shadow: 0 4px 24px rgba(124,58,237,.18), 0 24px 60px rgba(15,23,42,.16);
  display: flex; flex-direction: column;
  max-height: 90vh;
}
.lam-modal-md { width: min(92vw, 440px); }
.lam-modal-lg { width: min(92vw, 500px); }
.lam-modal-header {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 60%, #6d28d9 100%);
  padding: 20px 22px;
  display: flex; align-items: center; gap: 13px;
  flex-shrink: 0;
}
.lam-modal-header::before {
  content: ''; position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,.08) 1px, transparent 0);
  background-size: 18px 18px; pointer-events: none;
}
.lam-modal-hicon {
  position: relative; z-index: 1;
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,.12);
}
.lam-modal-htext { flex: 1; min-width: 0; padding-right: 36px; position: relative; z-index: 1; }
.lam-modal-title { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; position: relative; z-index: 1; }
.lam-modal-sub   { font-size: 11px; color: rgba(255,255,255,.75); margin-top: 3px; position: relative; z-index: 1; }
.lam-modal-close {
  position: absolute; right: 22px; top: 50%; transform: translateY(-50%);
  z-index: 2;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255,255,255,.18); color: #fff; border: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.lam-modal-close:hover { background: rgba(255,255,255,.30); }

.lam-modal-body { padding: 22px 22px 16px; background: #f8f7ff; overflow-y: auto; flex: 1; }
.lam-modal-helper { font-size: 12px; color: #64748b; margin-bottom: 16px; line-height: 1.7; }

/* Opportunity-type selector buttons */
.lam-opp-options { display: flex; flex-direction: column; gap: 10px; }
.lam-opp {
  display: flex; align-items: center; gap: 13px;
  padding: 14px 16px; border-radius: 12px;
  cursor: pointer; text-align: left; width: 100%;
  font-family: inherit; transition: transform .15s, background .15s;
}
.lam-opp:hover { transform: translateY(-1px); }
.lam-opp-icon {
  width: 40px; height: 40px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; border: 1.5px solid;
}
.lam-opp-text { flex: 1; min-width: 0; }
.lam-opp-title { font-size: 13px; font-weight: 700; line-height: 1.3; }
.lam-opp-sub   { font-size: 11px; margin-top: 3px; font-weight: 500; }

.lam-opp-qualified    { background: #f0fdf4; border: 1.5px solid #86efac; }
.lam-opp-qualified:hover { background: #dcfce7; }
.lam-opp-qualified .lam-opp-icon { background: #dcfce7; border-color: #bbf7d0; color: #16a34a; }
.lam-opp-qualified .lam-opp-title { color: #15803d; }
.lam-opp-qualified .lam-opp-sub   { color: #4ade80; }
.lam-opp-qualified > svg { stroke: #15803d; }

.lam-opp-disqualified    { background: #fff7ed; border: 1.5px solid #fdba74; }
.lam-opp-disqualified:hover { background: #ffedd5; }
.lam-opp-disqualified .lam-opp-icon { background: #ffedd5; border-color: #fed7aa; color: #ea580c; }
.lam-opp-disqualified .lam-opp-title { color: #c2410c; }
.lam-opp-disqualified .lam-opp-sub   { color: #fb923c; }
.lam-opp-disqualified > svg { stroke: #c2410c; }

.lam-opp-clarity    { background: #eff6ff; border: 1.5px solid #93c5fd; }
.lam-opp-clarity:hover { background: #dbeafe; }
.lam-opp-clarity .lam-opp-icon { background: #dbeafe; border-color: #bfdbfe; color: #2563eb; }
.lam-opp-clarity .lam-opp-title { color: #1d4ed8; }
.lam-opp-clarity .lam-opp-sub   { color: #60a5fa; }
.lam-opp-clarity > svg { stroke: #1d4ed8; }

/* Form fields */
.lam-field { display: flex; flex-direction: column; }
.lam-field + .lam-field { margin-top: 14px; }
.lam-label {
  display: block;
  font-size: 10px; font-weight: 800; color: #7c3aed;
  letter-spacing: .08em; text-transform: uppercase;
  margin-bottom: 7px;
}
.lam-req { color: #e11d48; }
.lam-textarea {
  width: 100%; box-sizing: border-box;
  border: 1.5px solid #ddd6fe; border-radius: 10px;
  padding: 11px 13px;
  font-family: inherit; font-size: 12.5px; color: #1e293b;
  background: #fff; outline: none; resize: vertical;
  min-height: 90px; line-height: 1.6;
  transition: border-color .15s, box-shadow .15s;
}
.lam-textarea:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,.12); }
.lam-char-count { font-size: 10.5px; color: #94a3b8; text-align: right; margin-top: 3px; }
.lam-char-max   { color: #ddd6fe; }
.lam-form-grid { display: grid; gap: 14px; margin-top: 14px; }
.lam-form-grid.one { grid-template-columns: 1fr; }
.lam-form-grid.two { grid-template-columns: 1fr 1fr; }
.lam-select-wrap { position: relative; }
.lam-select {
  width: 100%; box-sizing: border-box;
  border: 1.5px solid #ddd6fe; border-radius: 9px;
  padding: 9px 32px 9px 12px;
  font-family: inherit; font-size: 12.5px; color: #334155;
  background: #fff; outline: none; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  transition: border-color .15s;
}
.lam-select:focus { border-color: #8b5cf6; }
.lam-select-caret {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  pointer-events: none;
}
.lam-error { font-size: 11.5px; color: #e11d48; margin-top: 10px; font-weight: 600; }

.lam-modal-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; border-top: 1.5px solid #ede9fe;
  background: #fff; flex-shrink: 0;
}
.lam-footer-hint {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: #94a3b8;
}
.lam-footer-actions { display: flex; gap: 8px; }
.lam-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 20px; border-radius: 8px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  border: 1.5px solid transparent;
}
.lam-btn-light {
  background: #fff; color: #64748b; border-color: #e2e8f0;
}
.lam-btn-light:hover:not(:disabled) { border-color: #ddd6fe; color: #7c3aed; }
.lam-btn-primary {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border: none;
  box-shadow: 0 3px 10px rgba(139,92,246,.40);
}
.lam-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(139,92,246,.50); }
.lam-btn:disabled { opacity: .60; cursor: not-allowed; }

/* ─── Dark mode ─── */
[data-bs-theme="dark"] .lam-root { background: #14101d; color: #d4d1de; }
[data-bs-theme="dark"] .lam-no-access {
  background: #1a1530; border-color: rgba(167,139,250,.30);
  box-shadow: 0 2px 10px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .lam-no-access-title { color: #c4b5fd; }
[data-bs-theme="dark"] .lam-no-access-sub   { color: #9aa0b4; }
[data-bs-theme="dark"] .lam-header {
  background: linear-gradient(100deg, #1c1432 0%, #221839 55%, #2a1d49 100%);
  border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .lam-header-title { color: #e9d5ff; }
[data-bs-theme="dark"] .lam-header-sub   { color: #c4b5fd; }

[data-bs-theme="dark"] .lam-tabs   { background: rgba(255,255,255,.04); border-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .lam-tab    { color: #c4b5fd; }
[data-bs-theme="dark"] .lam-tab:hover { background: rgba(167,139,250,.10); }
[data-bs-theme="dark"] .lam-search { background: rgba(255,255,255,.04); border-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .lam-search input        { color: #e9d5ff; }
[data-bs-theme="dark"] .lam-search input::placeholder { color: #7a6b9a; }

[data-bs-theme="dark"] .lam-table-card {
  background: #1a1530; border-color: rgba(167,139,250,.25);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .lam-table thead tr {
  background: linear-gradient(120deg, #4c2d8a 0%, #5b21b6 55%, #6d28d9 100%);
}
[data-bs-theme="dark"] .lam-table tbody tr           { background: #1a1530; border-bottom-color: rgba(167,139,250,.15); }
[data-bs-theme="dark"] .lam-table tbody tr:nth-child(even) { background: rgba(28,20,50,.50); }
[data-bs-theme="dark"] .lam-table tbody tr:hover     { background: rgba(76,45,138,.25); }
[data-bs-theme="dark"] .lam-table tbody td           { color: #d4d1de; }
[data-bs-theme="dark"] .lam-td-reason                { color: #e9d5ff; }
[data-bs-theme="dark"] .lam-sr-pill {
  background: linear-gradient(135deg, rgba(76,45,138,.40), rgba(45,27,86,.50));
  color: #c4b5fd; border-color: rgba(167,139,250,.40);
}
[data-bs-theme="dark"] .lam-active   { background: rgba(34,197,94,.18); color: #86efac; border-color: rgba(34,197,94,.30); }
[data-bs-theme="dark"] .lam-inactive { background: rgba(148,163,184,.18); color: #cbd5e1; border-color: rgba(148,163,184,.20); }
[data-bs-theme="dark"] .lam-positive { background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.30); }
[data-bs-theme="dark"] .lam-negative { background: rgba(239,68,68,.18); color: #fca5a5; border-color: rgba(239,68,68,.30); }
[data-bs-theme="dark"] .lam-empty    { color: #7a6b9a; }
[data-bs-theme="dark"] .lam-edit     { background: rgba(99,102,241,.18); color: #a5b4fc; }
[data-bs-theme="dark"] .lam-del      { background: rgba(244,63,94,.18); color: #fda4af; }
[data-bs-theme="dark"] .lam-pagination {
  background: linear-gradient(90deg, #14101d, #1a1530);
  border-top-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .lam-pag-info,
[data-bs-theme="dark"] .lam-rpp {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .lam-rpp select        { color: #e9d5ff; }
[data-bs-theme="dark"] .lam-pag-info strong   { color: #e9d5ff; }
[data-bs-theme="dark"] .lam-pag-range {
  background: linear-gradient(135deg, rgba(76,45,138,.40), rgba(45,27,86,.55));
  border-color: rgba(167,139,250,.35);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .lam-pag-btn { background: rgba(255,255,255,.04); border-color: rgba(167,139,250,.25); color: #c4b5fd; }

[data-bs-theme="dark"] .lam-modal           { background: #1a1530; }
[data-bs-theme="dark"] .lam-modal-body      { background: #14101d; }
[data-bs-theme="dark"] .lam-modal-helper    { color: #9aa0b4; }
[data-bs-theme="dark"] .lam-textarea,
[data-bs-theme="dark"] .lam-select {
  background: #0f0c19; color: #e9d5ff; border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .lam-textarea::placeholder { color: #7a6b9a; }
[data-bs-theme="dark"] .lam-char-count   { color: #7a6b9a; }
[data-bs-theme="dark"] .lam-char-max     { color: #4a4663; }
[data-bs-theme="dark"] .lam-modal-footer { background: #1a1530; border-top-color: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .lam-footer-hint  { color: #7a6b9a; }
[data-bs-theme="dark"] .lam-btn-light    { background: #1a1530; color: #c4b5fd; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lam-btn-light:hover:not(:disabled) { border-color: rgba(167,139,250,.50); color: #e9d5ff; }
[data-bs-theme="dark"] .lam-ab-muted {
  background: rgba(148,163,184,.12) !important;
  color: #6b7280 !important;
}
[data-bs-theme="dark"] .lam-ab-muted:hover {
  background: rgba(148,163,184,.12) !important;
  color: #6b7280 !important;
}

/* ─── Responsive ─── */
@media (max-width: 720px) {
  .lam-root { padding: 12px 12px 16px; font-size: 13px; }
  .lam-header { padding: 12px 14px; gap: 10px; }
  .lam-header-title { font-size: 14px; }
  .lam-header-sub   { font-size: 10.5px; }
  .lam-add-btn { width: 100%; justify-content: center; }
  .lam-tabs-row { flex-direction: column; align-items: stretch; }
  .lam-tabs { width: 100%; justify-content: flex-start; overflow-x: auto; }
  .lam-tab { padding: 6px 11px; }
  .lam-search { max-width: 100%; }
  .lam-pagination { padding: 9px 12px; }
  .lam-pag-info, .lam-pag-range, .lam-rpp { padding-left: 10px; padding-right: 10px; }
}
@media (max-width: 520px) {
  .lam-form-grid.two { grid-template-columns: 1fr; }
  .lam-modal-header { padding: 16px 18px; }
  .lam-modal-body   { padding: 18px 16px 14px; }
  .lam-modal-footer { padding: 12px 16px; flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .lam-modal-close  { right: 14px; }
  .lam-modal-htext  { padding-right: 30px; }
  .lam-footer-actions { width: 100%; justify-content: flex-end; }
  .lam-footer-hint { font-size: 10.5px; }
  .lam-pag-right { flex-wrap: wrap; }
}
`;
