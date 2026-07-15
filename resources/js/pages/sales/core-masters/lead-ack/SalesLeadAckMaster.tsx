import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import Tooltip from '../../../../components/ui/Tooltip';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import { MasterSelect } from '../../../../components/ui/MasterSelect';

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
 * semantics as the source design. The mark-inactive action is routed through
 * the project's DeleteConfirmModal (with a "Mark Inactive" verb) so a stray
 * click can't silently disable a reason.
 *
 * Visual recipe matches the wider Sales module — violet hero strip, KPI
 * ribbon, pill-style tabs, sticky lavender table header, dark-mode aware.
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
const TAB_SHORT: Record<OppType, string> = {
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  clarity_pending: 'Clarity Pending',
};
const COLUMN_HEADERS: Record<OppType, string> = {
  qualified: 'Reason For Qualified Opportunity',
  disqualified: 'Reason For Disqualified Opportunity',
  clarity_pending: 'Reason For Clarity Pending Opportunity',
};

export default function SalesLeadAckMaster() {
  const toast = useToast();
  const { user } = useAuth();
  // Active branch (from the switcher) so writes are scoped to the SAME branch
  // the list is showing — the Axios interceptor only injects branch_id on GETs,
  // so POST/PUT must pass it explicitly to keep reasons branch-isolated.
  const branchParam = (): { branch_id?: number } => {
    try {
      const s = user?.id ? localStorage.getItem(`cbc_selected_branch_id_${user.id}`) : null;
      const n = s ? Number(s) : NaN;
      return Number.isFinite(n) && n > 0 ? { branch_id: n } : {};
    } catch { return {}; }
  };
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

  // ── Auto-fit rows ──
  // Rather than a fixed page size that leaves a gap on big screens, measure the
  // scroll area and show exactly as many rows as fit. Picking a value from the
  // Rows-per-page dropdown turns auto-fit off (manual override).
  const wrapRef     = useRef<HTMLDivElement>(null);
  // Auto-fit was deriving rows-per-page from the container height, which
  // produced an unpredictable "random" number (e.g. 13, 17) that changed
  // with the viewport and made the pagination footer read as broken. Keep
  // rows-per-page at the stable default (10) so "Showing 1–10 of N" and the
  // page count stay consistent; the user can still override via the dropdown.
  const autoFitRef  = useRef(false);
  const APPROX_THEAD = 46;   // sticky header height (px)
  const APPROX_ROW   = 38;   // one compact row height (px)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const recompute = () => {
      if (!autoFitRef.current) return;
      const avail = el.clientHeight;
      if (avail <= 0) return;
      const fit = Math.max(5, Math.floor((avail - APPROX_THEAD) / APPROX_ROW));
      setRpp(prev => (prev === fit ? prev : fit));
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    recompute();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transient shimmer flags. All three tabs are fetched once on mount, so a
  // tab switch is instant — we flash the table skeleton briefly on switch so
  // the change reads as a deliberate "loading the new tab" transition. The
  // form modal flashes a field skeleton on open before the inputs settle in.
  const [formLoading, setFormLoading] = useState(false);
  const formTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (formTimer.current) window.clearTimeout(formTimer.current);
  }, []);

  // Modals
  const [oppSelectorOpen, setOppSelectorOpen] = useState(false);
  const [formOpen, setFormOpen]               = useState(false);
  const [editingId, setEditingId]             = useState<number | null>(null);
  const [pendingType, setPendingType]         = useState<OppType | null>(null);

  // Form state
  const [formReason, setFormReason] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formDQ,     setFormDQ]     = useState<DQ>('positive');
  const [formError,  setFormError]  = useState('');
  const [saving,     setSaving]     = useState(false);

  // Mark-inactive confirmation. Routes the trash button through
  // DeleteConfirmModal so a stray click can't silently disable a reason.
  const [inactivateTarget, setInactivateTarget] = useState<Reason | null>(null);
  const [inactivating, setInactivating]         = useState(false);

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

  // Escape closes whichever modal is open (form takes priority over the
  // type selector, matching the open/stack order). Saving disables the
  // shortcut so a stray key press can't abandon an in-flight request.
  useEffect(() => {
    if (!oppSelectorOpen && !formOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formOpen) { if (!saving) closeForm(); return; }
      if (oppSelectorOpen) setOppSelectorOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [oppSelectorOpen, formOpen, saving]);

  // Lock scroll while any modal is open — lock BOTH <html> and <body> so the
  // page behind can't scroll regardless of which owns the viewport scroll.
  useEffect(() => {
    const open = oppSelectorOpen || formOpen;
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [oppSelectorOpen, formOpen]);

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

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  // Tab switch is instant — all three tabs' reasons are already fetched on
  // mount, so there's nothing to load. (Previously this flashed a 450ms fake
  // skeleton "so the swap reads as a fresh load", which just added lag.)
  const switchTab = (next: OppType) => {
    if (next === tab) return;
    setTab(next); setPage(1); setQ('');
  };

  // ── Modal actions ──
  const openAdd = () => {
    if (!canAdd) return;
    setOppSelectorOpen(true);
    setPendingType(null);
    setEditingId(null);
  };

  // Flash the form field skeleton briefly whenever the Add/Edit modal opens,
  // so the form materialises with the same shimmer language as the table.
  const flashFormSkeleton = () => {
    setFormLoading(true);
    if (formTimer.current) window.clearTimeout(formTimer.current);
    formTimer.current = window.setTimeout(() => setFormLoading(false), 400);
  };

  const selectOpp = (t: OppType) => {
    setPendingType(t);
    setOppSelectorOpen(false);
    setFormReason('');
    setFormStatus('active');
    setFormDQ('positive');
    setFormError('');
    setFormOpen(true);
    flashFormSkeleton();
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
    flashFormSkeleton();
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setPendingType(null);
  };

  const save = async () => {
    const reason = formReason.trim();
    if (!reason) { setFormError('⚠  Reason is required.'); return; }
    if (!/[\p{L}\p{N}]/u.test(reason)) {
      setFormError('⚠  Reason must contain letters or numbers, not only special characters.');
      return;
    }
    if (!pendingType) { setFormError('Internal error: opportunity type missing.'); return; }
    setFormError('');
    setSaving(true);
    try {
      if (editingId !== null) {
        const payload: any = { reason, status: formStatus };
        if (pendingType === 'disqualified') payload.dq_status = formDQ;
        const res = await api.put(`/sales/lead-ack-reasons/${editingId}`, payload, { params: branchParam() });
        setData(prev => ({
          ...prev,
          [pendingType]: prev[pendingType].map(r => r.id === editingId ? res.data : r),
        }));
        toast.success('Saved', 'Reason updated successfully');
      } else {
        const payload: any = {
          opportunity_type: pendingType,
          reason,
          status: formStatus,
        };
        if (pendingType === 'disqualified') payload.dq_status = formDQ;
        const res = await api.post('/sales/lead-ack-reasons', payload, { params: branchParam() });
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

  /* Trash button now opens a confirmation modal first. The actual
   * PUT (status → inactive) runs in confirmInactivate so the user
   * has a clear "Cancel" path before flipping a reason out of view. */
  const requestInactivate = (row: Reason) => {
    if (!canDelete) return;
    if (row.status === 'inactive') return;
    setInactivateTarget(row);
  };

  const confirmInactivate = async () => {
    const row = inactivateTarget;
    if (!row) return;
    setInactivating(true);
    try {
      const res = await api.put(`/sales/lead-ack-reasons/${row.id}`, { status: 'inactive' }, { params: branchParam() });
      setData(prev => ({
        ...prev,
        [row.opportunity_type]: prev[row.opportunity_type].map(r => r.id === row.id ? res.data : r),
      }));
      toast.info('Marked as Inactive', row.reason);
      setInactivateTarget(null);
    } catch (err: any) {
      toast.error('Update failed', err?.response?.data?.message || 'Could not mark inactive');
    } finally {
      setInactivating(false);
    }
  };

  /* ─── No-access early return ─── */
  if (!canView) {
    return (
      <div className="lam-root">
        <style>{SCOPED_CSS}</style>
        <div className="lam-no-access">
          <i className="ri-lock-2-line lam-no-access-icon" />
          <div className="lam-no-access-title">No access</div>
          <div className="lam-no-access-sub">You don't have permission to view Lead Acknowledgement Master. Ask your branch admin to grant <strong>can_view</strong> on Sales Matrix → Lead Acknowledgement Master.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="lam-root">
      <style>{SCOPED_CSS}</style>

      {/* ── Hero strip — clean white card with dark icon tile +
              dark title (mirrors the HR Employee page recipe used
              across the project, instead of the violet gradient
              hero used elsewhere on Sales). ── */}
      <div className="lam-hero">
        <span className="lam-hero__accent" />
        <div className="lam-hero-icon">
          <i className="ri-checkbox-circle-line" />
        </div>
        <div className="lam-hero-text">
          <div className="lam-hero-title">Lead Acknowledgement</div>
          <div className="lam-hero-sub">Manage qualification reasons for the sales pipeline</div>
        </div>
        <div className="lam-hero-actions">
          {canAdd && (
            <button type="button" className="lam-add-btn" onClick={openAdd}>
              <i className="ri-add-line" />
              Add New Reason
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs + Search row — tabs sit inside a single segmented
              pill container so the row reads as one control with the
              active tab "selected" inside, matching the rest of the
              sales surfaces. ── */}
      <div className="lam-tabs-row">
        <div className="lam-tabs" role="tablist">
          {TAB_KEYS.map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`lam-tab ${tab === t ? 'is-active' : ''}`}
              onClick={() => switchTab(t)}
            >
              <span className="lam-tab-label">{TAB_LABELS[t]}</span>
            </button>
          ))}
        </div>
        <div className="lam-search">
          <i className="ri-search-line lam-search-icon" />
          <input
            type="text"
            placeholder="Search by reason…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
          {q && (
            <button type="button" className="lam-search-clear" onClick={() => { setQ(''); setPage(1); }} aria-label="Clear search">
              <i className="ri-close-line" />
            </button>
          )}
        </div>
      </div>

      {/* ── Table card ── */}
      <div className="lam-table-card">
        <div className="lam-table-wrap" ref={wrapRef}>
          <table className="lam-table" style={{ tableLayout: 'fixed', minWidth: 560 }}>
            <thead>
              <tr>
                {/* Column widths mirror the IDIMS figma: a narrow Sr No, a
                    wide Reason, and balanced Status / Action columns whose
                    header + content are centre-aligned. */}
                <th style={{ width: tab === 'disqualified' ? '10%' : '12%' }}>Sr No</th>
                <th style={{ width: tab === 'disqualified' ? '34%' : '44%' }}>{COLUMN_HEADERS[tab]}</th>
                {tab === 'disqualified' && <th style={{ width: '18%', textAlign: 'center' }}>DQ Status</th>}
                <th style={{ width: tab === 'disqualified' ? '19%' : '22%', textAlign: 'center', paddingLeft: 70 }}>Status</th>
                <th style={{ width: tab === 'disqualified' ? '19%' : '22%', textAlign: 'center', paddingLeft: 50 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="lam-skel-row">
                  <td className="lam-td-sr"><span className="lam-skel lam-skel-badge" /></td>
                  <td className="lam-td-reason">
                    <span className="lam-skel lam-skel-line" style={{ width: `${72 - (i % 3) * 14}%` }} />
                  </td>
                  {tab === 'disqualified' && (
                    <td style={{ textAlign: 'center' }}><span className="lam-skel lam-skel-pill" /></td>
                  )}
                  <td style={{ textAlign: 'center', paddingLeft: 70 }}><span className="lam-skel lam-skel-pill" /></td>
                  <td style={{ textAlign: 'center', paddingLeft: 50 }}>
                    <div className="lam-actions">
                      <span className="lam-skel lam-skel-btn" />
                      <span className="lam-skel lam-skel-btn" />
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={tab === 'disqualified' ? 5 : 4} className="lam-empty">
                  <i className="ri-inbox-line lam-empty-icon" />
                  No reasons found
                </td></tr>
              )}
              {!loading && rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="lam-td-sr"><span className="lam-sr-badge">{startIdx + i + 1}</span></td>
                  <td className="lam-td-reason"><ReasonCell text={r.reason} /></td>
                  {tab === 'disqualified' && (
                    <td style={{ textAlign: 'center' }}>
                      {r.dq_status === 'positive'
                        ? <span className="lam-badge lam-positive"><i className="ri-arrow-up-line" />Positive</span>
                        : <span className="lam-badge lam-negative"><i className="ri-arrow-down-line" />Negative</span>}
                    </td>
                  )}
                  <td style={{ textAlign: 'center', paddingLeft: 70 }}>
                    {r.status === 'active'
                      ? <span className="lam-badge lam-active">Active</span>
                      : <span className="lam-badge lam-inactive">Inactive</span>}
                  </td>
                  <td style={{ textAlign: 'center', paddingLeft: 50 }}>
                    <div className="lam-actions">
                      {canEdit && (
                        <Tooltip label="Edit reason" themed>
                          <button type="button" aria-label="Edit" className="lam-ab lam-edit" onClick={() => openEdit(r)}>
                            <i className="ri-pencil-line" />
                          </button>
                        </Tooltip>
                      )}
                      {canDelete && (
                        <Tooltip label={r.status === 'inactive' ? 'Already inactive' : 'Mark inactive'} themed>
                          <button
                            type="button"
                            aria-label={r.status === 'inactive' ? 'Already inactive' : 'Mark inactive'}
                            aria-disabled={r.status === 'inactive'}
                            className={`lam-ab lam-archive ${r.status === 'inactive' ? 'lam-ab-muted' : ''}`}
                            onClick={() => requestInactivate(r)}
                          >
                            <i className="ri-delete-bin-6-line" />
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

        {/* Pagination — matches the project's master-page footer:
            plain "Showing N of M Results" on the left, numbered page
            buttons with prev/next arrows on the right. Rows-per-page
            selector dropped per design parity (rpp stays at 10 by
            default; the underlying state + math are preserved). */}
        <div className="lam-pagination">
          <span className="lam-pag-info">
            {total === 0
              ? 'No records found'
              : <>Showing <strong>{startIdx + 1}</strong>–<strong>{startIdx + rows.length}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="lam-pag-right">
            <div className="lam-rows">
              <span>Rows per page</span>
              <span className="lam-rows-val">{rpp}</span>
              <i className="ri-arrow-down-s-line lam-rows-caret" />
              <select
                className="lam-rows-sel"
                value={rpp}
                onChange={e => { autoFitRef.current = false; setRpp(Number(e.target.value)); setPage(1); }}
                aria-label="Rows per page"
              >
                {[...new Set([rpp, 10, 20, 30, 40, 50])].sort((a, b) => a - b).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            {/* Page navigation only appears when there's more than one page —
                matches the My-Workplace footer: a "page / pages" pill + arrows. */}
            {pages > 1 && (
              <>
                <span className="lam-pag-range">{safePage} / {pages}</span>
                <div className="lam-pag-btns">
                  <button
                    type="button"
                    className="lam-pag-btn"
                    disabled={safePage <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <i className="ri-arrow-left-s-line" />
                  </button>
                  <button
                    type="button"
                    className="lam-pag-btn"
                    disabled={safePage >= pages || total === 0}
                    onClick={() => setPage(p => Math.min(pages, p + 1))}
                    aria-label="Next page"
                  >
                    <i className="ri-arrow-right-s-line" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Opportunity-type selector modal ── */}
      {/* No backdrop-click-to-close — users were losing partially filled
          forms by misclicking the overlay. Close only via the X / Cancel
          button or the ESC key. */}
      {oppSelectorOpen && (
        <div className="lam-overlay">
          <div className="lam-modal lam-modal-md" onMouseDown={e => e.stopPropagation()}>
            <div className="lam-modal-header">
              <div className="lam-modal-hicon"><i className="ri-folder-add-line" /></div>
              <div className="lam-modal-htext">
                <div className="lam-modal-title">Select Opportunity Type</div>
                <div className="lam-modal-sub">Choose where to store this reason</div>
              </div>
              <button type="button" className="lam-modal-close" onClick={() => setOppSelectorOpen(false)} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="lam-modal-body">
              <p className="lam-modal-helper">Select the opportunity type for which you want to add a new reason:</p>
              <div className="lam-opp-options">
                <button type="button" className="lam-opp lam-opp-qualified" onClick={() => selectOpp('qualified')}>
                  <div className="lam-opp-icon"><i className="ri-checkbox-circle-line" /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Qualified Opportunity</div>
                    <div className="lam-opp-sub">Add reason for qualifying a lead</div>
                  </div>
                  <i className="ri-arrow-right-s-line lam-opp-chev" />
                </button>
                <button type="button" className="lam-opp lam-opp-disqualified" onClick={() => selectOpp('disqualified')}>
                  <div className="lam-opp-icon"><i className="ri-close-circle-line" /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Disqualified Opportunity</div>
                    <div className="lam-opp-sub">Add reason for disqualifying a lead</div>
                  </div>
                  <i className="ri-arrow-right-s-line lam-opp-chev" />
                </button>
                <button type="button" className="lam-opp lam-opp-clarity" onClick={() => selectOpp('clarity_pending')}>
                  <div className="lam-opp-icon"><i className="ri-question-line" /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Clarity Pending Opportunity</div>
                    <div className="lam-opp-sub">Add reason for pending clarification</div>
                  </div>
                  <i className="ri-arrow-right-s-line lam-opp-chev" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit modal — clean two-column form. Reason
              textarea spans the full width; Status / DQ Status sit
              side-by-side in equal columns. ── */}
      {formOpen && pendingType && (
        /* No backdrop-click-to-close — users were losing partially filled
           forms by misclicking the overlay. Close only via Cancel or ESC. */
        <div className="lam-overlay lam-overlay-strong">
          <div className="lam-modal lam-modal-lg lam-modal-noclose" onMouseDown={e => e.stopPropagation()}>
            <div className="lam-modal-header lam-modal-header-rich">
              <span className="lam-mh-orb lam-mh-orb-tr" aria-hidden />
              <span className="lam-mh-orb lam-mh-orb-br" aria-hidden />
              <span className="lam-mh-orb lam-mh-orb-bl" aria-hidden />
              <span className="lam-mh-sheen" aria-hidden />
              <div className="lam-modal-hicon">
                <i className={editingId !== null ? 'ri-edit-line' : 'ri-add-circle-line'} />
              </div>
              <div className="lam-modal-htext">
                <div className="lam-modal-title">{editingId !== null ? 'Edit Reason' : `Add ${TAB_SHORT[pendingType]} Reason`}</div>
                <div className="lam-modal-sub">{TAB_LABELS[pendingType]}</div>
              </div>
            </div>

            <div className="lam-modal-body">
              {formLoading ? (
                /* Field skeleton — mirrors the real form shape (label +
                   textarea, then the Status / DQ Status row) so the inputs
                   resolve in place rather than popping in cold. */
                <>
                  <div className="lam-fld">
                    <span className="lam-skel lam-skel-flabel" />
                    <span className="lam-skel lam-skel-ftext" />
                  </div>
                  <div className={`lam-row ${pendingType === 'disqualified' ? 'cols-2' : 'cols-1'}`} style={{ marginTop: 18 }}>
                    <div className="lam-fld">
                      <span className="lam-skel lam-skel-flabel" />
                      <span className="lam-skel lam-skel-finput" />
                    </div>
                    {pendingType === 'disqualified' && (
                      <div className="lam-fld">
                        <span className="lam-skel lam-skel-flabel" />
                        <span className="lam-skel lam-skel-finput" />
                      </div>
                    )}
                  </div>
                </>
              ) : (<>
              {/* Reason — full width row */}
              <div className="lam-fld">
                <label className="lam-lbl">Reason <span className="lam-req">*</span></label>
                <textarea
                  className="lam-textarea"
                  placeholder="Enter reason (max 500 characters)"
                  maxLength={500}
                  rows={3}
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                />
                <div className={`lam-char-count ${formReason.length >= 450 ? (formReason.length >= 500 ? 'lam-cc-max' : 'lam-cc-warn') : ''}`}>
                  <span>{formReason.length}</span>
                  <span className="lam-char-max">/500</span>
                </div>
              </div>

              {/* Status / DQ Status — equal-width 2-column row */}
              <div className={`lam-row ${pendingType === 'disqualified' ? 'cols-2' : 'cols-1'}`}>
                <div className="lam-fld">
                  <label className="lam-lbl">Status <span className="lam-req">*</span></label>
                  <MasterSelect
                    value={formStatus}
                    options={[
                      { value: 'active',   label: 'Active' },
                      { value: 'inactive', label: 'Inactive' },
                    ]}
                    onChange={(v) => setFormStatus(v as Status)}
                  />
                </div>
                {pendingType === 'disqualified' && (
                  <div className="lam-fld">
                    <label className="lam-lbl">DQ Status <span className="lam-req">*</span></label>
                    <MasterSelect
                      value={formDQ}
                      options={[
                        { value: 'positive', label: 'Positive' },
                        { value: 'negative', label: 'Negative' },
                      ]}
                      onChange={(v) => setFormDQ(v as DQ)}
                    />
                  </div>
                )}
              </div>

              {formError && <div className="lam-error"><i className="ri-error-warning-line" /> {formError}</div>}
              </>)}
            </div>

            <div className="lam-modal-footer lam-modal-footer-right">
              <div className="lam-footer-actions">
                <button type="button" className="lam-btn lam-btn-light" onClick={closeForm} disabled={saving}>Cancel</button>
                <button type="button" className="lam-btn lam-btn-primary" onClick={save} disabled={saving}>
                  {saving ? <>
                    <span className="lam-spinner" aria-hidden />
                    Saving…
                  </> : <>
                    <i className="ri-save-3-line" />
                    Save Reason
                  </>}
                </button>
              </div>
            </div>
            {/* While saving, lock the whole form so no other field/button can be used. */}
            {saving && (
              <div className="lam-save-lock" aria-live="polite" aria-busy="true">
                <span className="lam-save-lock-spinner" />
                <span className="lam-save-lock-text">{editingId !== null ? 'Updating…' : 'Saving…'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mark Inactive confirmation — reuses the project's
          destructive-confirmation modal so the styling and dark-mode
          coverage stay consistent with Delete flows elsewhere. ── */}
      <DeleteConfirmModal
        open={!!inactivateTarget}
        title="Mark Reason Inactive"
        itemName={inactivateTarget?.reason}
        subMessage="This reason will be hidden from the active dropdowns across the sales pipeline. You can re-activate it later from the edit screen."
        actionVerb="Mark inactive"
        confirmLabel="Mark Inactive"
        confirmingLabel="Marking…"
        confirmIcon="ri-archive-line"
        loading={inactivating}
        onClose={() => { if (!inactivating) setInactivateTarget(null); }}
        onConfirm={confirmInactivate}
      />
    </div>
  );
}

/* ─── Reason cell — caps the visible text at 30 chars and wraps a
 *      Tooltip so the full reason is available on hover. Short
 *      reasons render as plain text without the tooltip overhead. */
const REASON_MAX_CHARS = 60;
function ReasonCell({ text }: { text: string }) {
  const raw = text ?? '';
  if (raw.length <= REASON_MAX_CHARS) return <>{raw}</>;
  return (
    <Tooltip label={raw} maxWidth={420} themed>
      <span className="lam-reason-trunc">{raw.slice(0, REASON_MAX_CHARS).trimEnd()}…</span>
    </Tooltip>
  );
}

/* ─── Scoped CSS — violet palette matching the Sales module. Every
 *      rule lives under `.lam-*` so this surface can't leak into
 *      sibling pages. Dark-mode coverage mirrors light-mode pixel
 *      for pixel — every rule has a `[data-bs-theme="dark"]`
 *      counterpart further down. */
const SCOPED_CSS = `
.lam-root {
  font-family: var(--font-sans);
  background: linear-gradient(180deg, #faf7ff 0%, #f5f3ff 100%);
  /* Sit flush at the container gutter (no horizontal break-out / own side
     padding) so the left/right margin matches the Customer & Consignee pages.
     Top break-out is kept so the fixed-height table layout still fills. */
  padding: 14px 0 22px;
  margin: -1rem 0 0;
  /* Fixed available height (viewport minus the top header + horizontal menu)
     so the table card fills the screen, the table scrolls INSIDE it, and the
     pagination stays pinned at the bottom — no big empty area below the card,
     no page scroll. */
  height: calc(100vh - 130px);
  overflow: hidden;
  display: flex; flex-direction: column; gap: 16px;
  color: #111827;
  font-size: 13.5px;
}
.lam-root *, .lam-root *::before, .lam-root *::after { box-sizing: border-box; }

/* ─── No-access placeholder ─── */
.lam-no-access {
  background: #fff; border: 1.5px solid #ddd6fe; border-radius: 16px;
  padding: 36px 28px; text-align: center;
  box-shadow: 0 4px 18px rgba(124,58,237,.10);
  max-width: 640px; margin: 24px auto;
}
.lam-no-access-icon {
  display: inline-flex; width: 56px; height: 56px; border-radius: 50%;
  align-items: center; justify-content: center;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  color: #6d28d9; font-size: 26px; margin-bottom: 12px;
}
.lam-no-access-title { font-size: 18px; font-weight: 800; color: #4c1d95; letter-spacing: -0.01em; }
.lam-no-access-sub   { font-size: 12.5px; color: #6b7280; margin-top: 8px; line-height: 1.65; max-width: 520px; margin-left: auto; margin-right: auto; }

/* ─── HERO — soft lavender gradient strip with a violet icon tile
   and matching dark-violet title. Brings the page identity back to
   the Sales-module palette while keeping the layout flat (no large
   gradient hero card, no orbs). */
.lam-hero {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 13px; flex-wrap: wrap;
  /* Glassy violet banner — the prototype hero gradient + a white top-sheen
     (inset) and left accent bar so it reads as glass. */
  background: linear-gradient(100deg, #f5f3ff 0%, #ede9fe 55%, #ddd6fe 100%);
  border: 1px solid #c4b5fd;
  border-radius: 16px;
  /* Match the My-Workplace banner footprint: compact 58px strip, padding
     0 20px with content vertically centred. */
  min-height: 58px;
  padding: 0 20px;
  box-shadow: 0 2px 0 rgba(255,255,255,.7) inset, 0 2px 10px rgba(139,92,246,.10), 0 1px 4px rgba(0,0,0,.04);
}
/* Decorative corner orb — the faint violet circle the figma tucks into the
   banner's top-right; clipped by overflow:hidden so it reads as a soft
   half-circle glow behind the action button. */
.lam-hero::before {
  content: ''; position: absolute; right: -10px; top: -10px;
  width: 80px; height: 80px; border-radius: 50%;
  background: rgba(139, 92, 246, .07);
  pointer-events: none;
}
[data-bs-theme="dark"] .lam-hero::before { background: rgba(167, 139, 250, .10); }
/* Top sheen. */
.lam-hero::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent);
  border-radius: 16px 16px 0 0;
}
.lam-hero > * { position: relative; z-index: 1; }
/* Left accent strip — same 4px violet gradient bar the Customer & Consignee
   hero strips carry, so all three top containers read as one design family.
   Declared after the .lam-hero > * rule so its absolute position + z-index win. */
.lam-hero__accent {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
  border-radius: 16px 0 0 16px;
  z-index: 2;
}
.lam-hero-icon {
  width: 38px; height: 38px; border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  display: inline-flex; align-items: center; justify-content: center;
  color: #ffffff; font-size: 18px; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(124,58,237,0.30);
}
.lam-hero-text { flex: 1 1 240px; min-width: 0; }
.lam-hero-title { font-size: 14.5px; font-weight: 800; letter-spacing: -0.4px; line-height: 1.2; color: #4c1d95; }
.lam-hero-sub   { font-size: 10.5px; color: #6d28d9; margin-top: 1px; font-weight: 500; line-height: 1.4; opacity: 0.85; }

.lam-hero-actions {
  display: inline-flex; align-items: center; gap: 10px;
  flex-shrink: 0; flex-wrap: wrap;
}
.lam-back-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px; border-radius: 999px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #475569;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; flex-shrink: 0; white-space: nowrap;
  transition: background .18s ease, border-color .18s ease, color .18s ease, transform .18s ease;
}
.lam-back-btn i { font-size: 15px; }
.lam-back-btn:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #1a1530;
  transform: translateX(-2px);
}
.lam-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 10px; border: none; min-height: 34px;
  /* Glossy violet CTA — the project's brand gradient + inner white
     highlight & soft violet glow. Sized to the My-Workplace toolbar button. */
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; flex-shrink: 0; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
  box-shadow: 0 4px 16px rgba(139,92,246,.45), 0 2px 6px rgba(124,58,237,.25), 0 1px 0 rgba(255,255,255,.22) inset;
  transition: transform .18s ease, box-shadow .22s ease, background .18s ease;
}
.lam-add-btn i { font-size: 15px; }
.lam-add-btn:hover {
  background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 55%, #7c3aed 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(139,92,246,.55), 0 3px 8px rgba(124,58,237,.30), 0 1px 0 rgba(255,255,255,.22) inset;
}

/* ─── KPI grid ─── */
.lam-kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.lam-kpi-tile {
  position: relative;
  background: #fff;
  border: 1px solid rgba(124,58,237,0.14);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 2px 10px rgba(124,58,237,0.05);
  overflow: hidden;
  text-align: left;
  font: inherit; color: inherit;
  transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease;
}
.lam-kpi-tile:disabled { cursor: default; }
.lam-kpi-tile.is-clickable { cursor: pointer; }
.lam-kpi-tile.is-clickable:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 28px rgba(124,58,237,0.14), 0 4px 10px rgba(15,23,42,0.05);
  border-color: rgba(124,58,237,0.40);
}
.lam-kpi-strip-top { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.lam-kpi-body { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lam-kpi-text { min-width: 0; flex: 1; }
.lam-kpi-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  color: #6b7280; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lam-kpi-value {
  font-size: 28px; font-weight: 800; line-height: 1.05; color: #1f2937;
  margin-top: 6px; letter-spacing: -0.01em;
}
.lam-kpi-icon {
  width: 40px; height: 40px; border-radius: 11px;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 19px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.10);
  flex-shrink: 0;
}

/* ─── Tabs + search row — segmented pill container with all three
   tabs inside. Active tab paints as a violet gradient pill within
   the white shell; inactive tabs stay flat with a soft count chip. */
.lam-tabs-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* Figma tabs: standalone pills (no shared shell) — inactive read as light
   outlined pills, the active tab is a solid violet gradient pill. */
/* Figma tabs: a single segmented pill container (soft violet shell) with
   the tabs inside it — inactive read as flat grey text, the active tab is a
   solid violet gradient pill within the shell. */
.lam-tabs {
  /* Mirrors the Customer .smc-pill-group — glassy white shell with a violet
     border, so the Lead Ack tabs read identically to the Customer tabs. */
  display: inline-flex; align-items: center; gap: 2px;
  height: 50px;
  background: rgba(255, 255, 255, .5);
  border: 1.5px solid #c4b5fd;
  border-radius: 12px;
  padding: 4px;
  flex-shrink: 0;
  backdrop-filter: blur(4px);
  box-shadow: 0 2px 8px rgba(109, 40, 217, .1);
  overflow-x: auto;
  scrollbar-width: none;
}
.lam-tabs::-webkit-scrollbar { display: none; }
.lam-tab {
  /* Mirrors the Customer .smc-pill. */
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 16px; height: 34px;
  background: transparent;
  border: 0;
  border-radius: 9px;
  color: #6d28d9;
  box-shadow: none;
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  transition: all .18s ease;
}
.lam-tab-icon { font-size: 14px; opacity: 0.85; }
.lam-tab:hover:not(.is-active) { color: #5b21b6; background: rgba(124,58,237,.08); }
.lam-tab.is-active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,0.30);
}
/* Selected tab stays the solid violet pill on hover (same as the Customer
   tabs — no fade-out). */
.lam-tab.is-active:hover {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,0.30);
}
.lam-tab.is-active .lam-tab-icon { opacity: 1; }
.lam-tab-count {
  background: #f1f5f9; color: #475569;
  font-size: 10.5px; font-weight: 800;
  padding: 1px 8px; border-radius: 999px;
  min-width: 22px; text-align: center;
  transition: all .18s ease;
}
.lam-tab.is-active .lam-tab-count {
  background: rgba(15,23,42,0.45);
  color: #fff;
}

/* ─── Search bar — project-standard neutral recipe. Matches the
   .search-box pattern used in HR Employees and master pages: white
   card bg, slate icon/placeholder, theme-token border. Picks up the
   violet ring only on focus. */
.lam-search {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  background: var(--vz-card-bg, #ffffff);
  border: 1px solid var(--vz-border-color, #e2e8f0);
  border-radius: 8px;
  padding: 6px 14px;
  flex: 1 1 320px; min-width: 220px;
  transition: border-color .15s, box-shadow .15s;
}
.lam-search:hover { border-color: #cbd5e1; }
.lam-search:focus-within { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
.lam-search-icon { color: var(--vz-secondary-color, #6b7280); font-size: 15px; flex-shrink: 0; }
.lam-search input {
  border: none; background: transparent; outline: none;
  font-family: inherit; font-size: 13px; color: #1e293b; width: 100%;
}
.lam-search input::placeholder { color: var(--vz-secondary-color, #94a3b8); font-weight: 400; opacity: 0.75; }
.lam-search-clear {
  background: transparent; border: none; cursor: pointer;
  color: #94a3b8; padding: 0; width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  transition: all .15s;
}
.lam-search-clear:hover { background: #f1f5f9; color: #475569; }

/* ─── Table card ─── */
.lam-table-card {
  background: #fff;
  border: 1px solid rgba(124,58,237,0.16);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 14px rgba(124,58,237,0.07);
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
/* Fills the card and scrolls the rows internally; the pagination (the card's
   last child) stays pinned at the bottom and always visible. */
.lam-table-wrap {
  flex: 1; min-height: 0; overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #ddd6fe transparent;
}
/* Thin themed scrollbar (replaces the chunky default). */
.lam-table-wrap::-webkit-scrollbar { width: 9px; height: 9px; }
.lam-table-wrap::-webkit-scrollbar-track { background: transparent; }
.lam-table-wrap::-webkit-scrollbar-thumb {
  background: #c4b5fd; border-radius: 8px;
  border: 2px solid transparent; background-clip: content-box;
}
.lam-table-wrap::-webkit-scrollbar-thumb:hover { background: #a78bfa; background-clip: content-box; }
[data-bs-theme="dark"] .lam-table-wrap { scrollbar-color: rgba(167,139,250,.4) transparent; }
[data-bs-theme="dark"] .lam-table-wrap::-webkit-scrollbar-thumb { background: rgba(167,139,250,.4); background-clip: content-box; }
.lam-table { width: 100%; border-collapse: separate; border-spacing: 0; }
/* Sticky gradient header — stays fixed while the rows scroll inside the card.
   The gradient lives on the <tr> so it spans the whole row as one continuous
   band; making the whole <thead> sticky keeps that band intact (the cells
   stay transparent, so there's no per-column segmentation). */
.lam-table thead {
  position: sticky; top: 0; z-index: 5;
}
.lam-table thead tr {
  background: linear-gradient(90deg, #5b21b6 0%, #6d28d9 25%, #7c3aed 55%, #8b5cf6 80%, #a78bfa 100%);
  box-shadow: 0 2px 10px rgba(124,58,237,0.30);
}
.lam-table thead th { text-shadow: 0 1px 3px rgba(0,0,0,0.20); }
.lam-table thead th {
  padding: 13px 14px; text-align: left; white-space: nowrap;
  background: transparent;
  border-bottom: none;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffffff;
}
.lam-table thead th:first-child { padding-left: 18px; }
.lam-table tbody tr { transition: background .12s ease; }
.lam-table tbody tr:nth-child(even) td { background: #faf7ff; }
.lam-table tbody tr:hover td { background: #ede9fe !important; }
.lam-table tbody td {
  padding: 5px 14px;
  font-size: 12.5px;
  color: #334155;
  border-bottom: 1px solid #f5f3ff;
  vertical-align: middle;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.lam-table tbody td:first-child { padding-left: 18px; }
.lam-table tbody tr:last-child td { border-bottom: none; }
.lam-td-reason { font-weight: 500; color: #1f2937; line-height: 1.55; white-space: normal; }
.lam-reason-trunc {
  display: inline-block; max-width: 100%;
  cursor: help;
}
.lam-empty {
  text-align: center; padding: 38px 16px !important;
  color: #94a3b8; font-style: italic; font-size: 13px;
}
.lam-empty-icon {
  display: inline-flex; width: 42px; height: 42px; border-radius: 50%;
  align-items: center; justify-content: center;
  background: #f5f3ff; color: #a78bfa; font-size: 22px;
  margin-bottom: 8px;
}
.lam-empty .lam-spinner-violet {
  display: inline-block; width: 14px; height: 14px; margin-right: 8px;
  border: 2px solid #ddd6fe; border-top-color: #7c3aed; border-radius: 50%;
  vertical-align: -3px;
  animation: lam-spin .7s linear infinite;
}

/* ─── Skeleton shimmer — shown while the reasons list loads. Each
   placeholder mirrors the real column shape (Sr-No badge / reason
   line / status pill / action chips) and sweeps a light lavender
   gradient across, so the table keeps its structure instead of
   collapsing to a single spinner row. */
.lam-skel-row td { background: transparent !important; }
.lam-skel-row:hover td { background: transparent !important; }
.lam-skel {
  display: inline-block;
  background: linear-gradient(90deg, #efe9fb 25%, #e2d8f7 37%, #efe9fb 63%);
  background-size: 400% 100%;
  animation: lam-shimmer 1.4s ease infinite;
}
.lam-skel-badge { width: 28px; height: 24px; border-radius: 7px; }
.lam-skel-line  { height: 12px; border-radius: 999px; vertical-align: middle; }
.lam-skel-pill  { width: 64px; height: 20px; border-radius: 999px; }
.lam-skel-btn   { width: 30px; height: 30px; border-radius: 8px; }
/* Form-field skeletons — used while the Add/Edit modal settles in. */
.lam-skel-flabel { display: block; width: 90px; height: 11px; border-radius: 999px; margin-bottom: 6px; }
.lam-skel-ftext  { display: block; width: 100%; height: 96px; border-radius: 8px; }
.lam-skel-finput { display: block; width: 100%; height: 38px; border-radius: 8px; }
@keyframes lam-shimmer {
  0%   { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

.lam-td-sr { font-weight: 700; color: #1e293b; }
/* Rounded-square Sr-No badge — outlined violet chip matching the Figma. */
.lam-sr-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px; height: 24px; padding: 0 7px; border-radius: 7px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe); color: #7c3aed;
  border: 1px solid #c4b5fd;
  font-size: 11.5px; font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* Status badges — flat pill, no dot. Matches the project-wide
   master pages where the dot indicator was dropped per UX request. */
.lam-badge {
  display: inline-block;
  border-radius: 999px; padding: 3px 12px;
  font-size: 11.5px; font-weight: 700;
  line-height: 1.3; white-space: nowrap;
}
.lam-active   { background: #dcfce7; color: #15803d; }
.lam-inactive { background: #fee2e2; color: #b91c1c; }
.lam-positive { background: #dbeafe; color: #1e40af; }
.lam-negative { background: #fee2e2; color: #b91c1c; }
.lam-badge.lam-positive,
.lam-badge.lam-negative { display: inline-flex; align-items: center; gap: 4px; }
.lam-badge i { font-size: 12px; }

/* Action buttons — project-standard recipe (mirrors MasterPage's
   ActionBtn). Neutral 30×30 chip using theme tokens; on hover the
   border + text + bg tint to the action color (primary/danger/info).
   Theme tokens auto-adapt to dark mode so we don't need a separate
   override block. */
.lam-actions { display: inline-flex; gap: 4px; justify-content: center; }
.lam-ab {
  width: 26px; height: 26px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 12.5px; padding: 0;
  transition: background .15s ease, border-color .15s ease, color .15s ease, transform .12s ease;
}
/* Coloured tiles by default (Figma) — blue edit, red delete. */
.lam-edit {
  background: rgba(37,99,235,0.10);
  border-color: rgba(37,99,235,0.22);
  color: #2563eb;
}
.lam-edit:hover:not([aria-disabled="true"]) {
  background: rgba(37,99,235,0.18); border-color: #2563eb; transform: translateY(-1px);
}
.lam-archive {
  background: rgba(220,38,38,0.10);
  border-color: rgba(220,38,38,0.22);
  color: #dc2626;
}
.lam-archive:hover:not([aria-disabled="true"]) {
  background: rgba(220,38,38,0.18); border-color: #dc2626; transform: translateY(-1px);
}
.lam-ab[aria-disabled="true"] {
  opacity: 0.55; cursor: not-allowed;
}
.lam-ab-muted {
  opacity: 0.55;
}
.lam-ab-muted:hover { background: var(--vz-secondary-bg); border-color: var(--vz-border-color); color: var(--vz-secondary-color); }

/* ─── Pagination — project-standard footer. Plain "Showing N of M
   Results" on the left, numbered page chips (active = violet
   gradient) with prev/next arrows on the right. No rows-per-page
   selector; the rpp state stays in the component at the default 10. */
.lam-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px;
  background: #fff;
  border-top: 1px solid #ede9fe;
  flex-wrap: wrap; gap: 10px;
}
/* Footer — plain "Showing N–M of T Results" on the left; uniform 32×32
   numbered page buttons (active = violet) with prev/next arrows on the
   right. Matches the project-standard pagination (HR Employees / Customers). */
.lam-pag-info { font-size: 12.5px; font-weight: 500; color: #475569; }
.lam-pag-info strong { color: #1f2937; font-weight: 800; }
.lam-pag-right { display: inline-flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* Rows-per-page pill — styled in the page's own violet language (not a raw
   native control). The <select> is appearance:none and only shows its value;
   a remix chevron sits on the right. */
.lam-rows {
  position: relative; display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; color: #6d28d9;
  background: #fff; border: 1px solid #e0d9f7;
  padding: 5px 30px 5px 12px; border-radius: 8px;
  cursor: pointer;
}
.lam-rows:hover { border-color: #c4b5fd; }
.lam-rows-val { font-size: 12.5px; font-weight: 800; color: #7c3aed; }
/* The real <select> overlays the whole pill (transparent) so a click
   anywhere on it opens the dropdown — only the value text + chevron show. */
.lam-rows-sel {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer; border: none;
  font-family: inherit;
}
.lam-rows-caret {
  position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  pointer-events: none; color: #7c3aed; font-size: 16px;
}
/* "page / pages" pill — violet counterpart of the My-Workplace footer pill. */
.lam-pag-range {
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  border: none; padding: 5px 18px; border-radius: 20px;
  box-shadow: 0 3px 12px rgba(124,58,237,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  white-space: nowrap;
}
.lam-pag-btns { display: inline-flex; align-items: center; gap: 6px; }
.lam-pag-btn {
  width: 32px; height: 32px; padding: 0;
  border-radius: 50%;
  border: 1.5px solid #ddd6fe;
  background: #fff;
  cursor: pointer;
  color: #7c3aed; font-size: 16px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .22s ease;
  font-family: inherit;
}
.lam-pag-btn i { font-size: 16px; }
.lam-pag-btn:hover:not(:disabled):not(.is-active) {
  background: #f5f3ff; border-color: #c4b5fd; color: #5b21b6;
}
.lam-pag-btn.is-active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: #7c3aed; color: #fff;
  box-shadow: 0 2px 6px rgba(109,40,217,.30);
  cursor: default;
}
.lam-pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ─── Modals (opp selector + form) — overlay scrolls when the
   modal body taller than the viewport (long forms on small
   screens) so the user can always reach the footer Cancel/Save.
   Padding adds safe-area on every edge; flex centring keeps the
   card aligned to viewport center on every screen size. */
.lam-overlay {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  z-index: 9200;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  overflow-y: auto;
  animation: lam-fade .20s ease;
}
/* Stronger dim variant — used for the Add/Edit form so the modal
   pops cleanly off the page (the lighter default suits the
   opp-type picker which is more "menu" than "form"). */
.lam-overlay-strong { background: rgba(15,23,42,0.72); }
@keyframes lam-fade { from { opacity: 0; } to { opacity: 1; } }
.lam-modal {
  background: #fff; border-radius: 18px; overflow: hidden;
  box-shadow:
    0 28px 70px rgba(15,23,42,0.45),
    0 10px 26px rgba(76,29,149,0.22),
    0 0 0 1px rgba(255,255,255,0.06);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 40px);
  margin: auto;
  position: relative;   /* positioning context for the saving lock overlay */
  animation: lam-pop .22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Saving lock — blankets the whole form so no field/button can be used mid-save. */
.lam-save-lock {
  position: absolute; inset: 0; z-index: 40;
  display: flex; flex-direction: column; gap: 11px;
  align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.62);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  cursor: progress;
}
.lam-save-lock-spinner {
  width: 38px; height: 38px; border-radius: 50%;
  border: 3.5px solid rgba(124, 58, 237, 0.22);
  border-top-color: #7c3aed;
  animation: lam-spin .7s linear infinite;
}
.lam-save-lock-text { font-size: 12.5px; font-weight: 700; color: #6d28d9; letter-spacing: .2px; }
[data-bs-theme="dark"] .lam-save-lock { background: rgba(26, 21, 48, 0.66); }
[data-bs-theme="dark"] .lam-save-lock-spinner { border-color: rgba(167, 139, 250, 0.22); border-top-color: #a78bfa; }
[data-bs-theme="dark"] .lam-save-lock-text { color: #c4b5fd; }
@keyframes lam-pop {
  0%   { opacity: 0; transform: scale(0.94) translateY(8px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
.lam-modal-md { width: min(92vw, 460px); }
.lam-modal-lg { width: min(94vw, 720px); }
.lam-modal-header {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #7c3aed 100%);
  padding: 20px 22px;
  display: flex; align-items: center; gap: 14px;
  flex-shrink: 0;
}
.lam-modal-header::before {
  content: ''; position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px);
  background-size: 18px 18px; pointer-events: none;
}

/* ── Rich header variant — layered radial glows + diagonal sheen
   (same recipe as the project's MasterPage modal). Applied to the
   Add/Edit form modal so it reads as a real material with depth,
   not a flat purple band. ── */
.lam-modal-header-rich {
  background:
    linear-gradient(135deg, #2b1d6b 0%, #4c1d95 28%, #6d28d9 55%, #7c3aed 78%, #a78bfa 100%);
  padding: 24px 24px;
}
.lam-mh-orb {
  position: absolute; border-radius: 50%;
  pointer-events: none;
}
.lam-mh-orb-tr {
  top: -50px; right: -30px; width: 200px; height: 200px;
  background: radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(167,139,250,0.18) 35%, transparent 70%);
}
.lam-mh-orb-br {
  bottom: -60px; right: 80px; width: 180px; height: 180px;
  background: radial-gradient(circle, rgba(196,181,253,0.45) 0%, transparent 70%);
}
.lam-mh-orb-bl {
  bottom: -50px; left: -30px; width: 160px; height: 160px;
  background: radial-gradient(circle, rgba(139,111,232,0.36) 0%, transparent 70%);
}
.lam-mh-sheen {
  position: absolute; inset: 0;
  background: linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.10) 100%);
  pointer-events: none;
}
.lam-modal-hicon {
  position: relative; z-index: 2;
  width: 44px; height: 44px; border-radius: 12px;
  background: rgba(255,255,255,0.18);
  border: 1.5px solid rgba(255,255,255,0.30);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0,0,0,0.22);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.lam-modal-htext { flex: 1; min-width: 0; padding-right: 40px; position: relative; z-index: 2; }
/* When the modal is rendered without a top-right X (lam-modal-noclose),
   drop the reserved padding so the title block breathes evenly across
   the header instead of looking left-shifted. */
.lam-modal-noclose .lam-modal-htext { padding-right: 0; }
.lam-modal-title { font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -0.01em; }
.lam-modal-sub   { font-size: 12px; color: rgba(255,255,255,0.82); margin-top: 4px; }
.lam-modal-close {
  position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  z-index: 2;
  width: 34px; height: 34px; border-radius: 10px;
  background: rgba(255,255,255,0.12); color: #fff;
  border: 1px solid rgba(255,255,255,0.25);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px;
  transition: background .15s, transform .12s;
}
.lam-modal-close:hover {
  background: rgba(255,255,255,0.22);
  border-color: rgba(255,255,255,0.40);
  transform: translateY(-50%) rotate(90deg);
}

.lam-modal-body { padding: 24px 24px 20px; background: #faf7ff; overflow-y: auto; flex: 1; }
.lam-modal-helper { font-size: 12.5px; color: #6b7280; margin-bottom: 14px; line-height: 1.6; }

/* Opportunity-type selector buttons */
.lam-opp-options { display: flex; flex-direction: column; gap: 12px; }
.lam-opp {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 14px;
  cursor: pointer; text-align: left; width: 100%;
  font-family: inherit;
  border: 1.5px solid;
  background: #fff;
  transition: transform .18s ease, box-shadow .22s ease, border-color .18s ease, background .18s ease;
  box-shadow: 0 2px 8px rgba(15,23,42,0.06);
}
.lam-opp:hover { transform: translateY(-2px); }
.lam-opp:active { transform: translateY(0); }
.lam-opp-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
  border: 1.5px solid;
}
.lam-opp-text { flex: 1; min-width: 0; }
.lam-opp-title { font-size: 13.5px; font-weight: 800; line-height: 1.25; }
.lam-opp-sub   { font-size: 11.5px; margin-top: 3px; font-weight: 500; }
.lam-opp-chev  { font-size: 18px; opacity: 0.65; transition: transform .18s ease; }
.lam-opp:hover .lam-opp-chev { transform: translateX(3px); opacity: 1; }

.lam-opp-qualified    { background: #f0fdf4; border-color: #86efac; }
.lam-opp-qualified:hover { background: #dcfce7; border-color: #4ade80; box-shadow: 0 10px 22px rgba(34,197,94,.20); }
.lam-opp-qualified .lam-opp-icon { background: #dcfce7; border-color: #bbf7d0; color: #16a34a; }
.lam-opp-qualified .lam-opp-title,
.lam-opp-qualified .lam-opp-chev { color: #15803d; }
.lam-opp-qualified .lam-opp-sub  { color: #16a34a; }

.lam-opp-disqualified    { background: #fff7ed; border-color: #fdba74; }
.lam-opp-disqualified:hover { background: #ffedd5; border-color: #fb923c; box-shadow: 0 10px 22px rgba(234,88,12,.20); }
.lam-opp-disqualified .lam-opp-icon { background: #ffedd5; border-color: #fed7aa; color: #ea580c; }
.lam-opp-disqualified .lam-opp-title,
.lam-opp-disqualified .lam-opp-chev { color: #c2410c; }
.lam-opp-disqualified .lam-opp-sub  { color: #ea580c; }

.lam-opp-clarity    { background: #eff6ff; border-color: #93c5fd; }
.lam-opp-clarity:hover { background: #dbeafe; border-color: #60a5fa; box-shadow: 0 10px 22px rgba(37,99,235,.20); }
.lam-opp-clarity .lam-opp-icon { background: #dbeafe; border-color: #bfdbfe; color: #2563eb; }
.lam-opp-clarity .lam-opp-title,
.lam-opp-clarity .lam-opp-chev { color: #1d4ed8; }
.lam-opp-clarity .lam-opp-sub  { color: #2563eb; }

/* ─── Form fields — clean block layout. Each .lam-fld is a
   self-contained label+input column. Rows of fields are wrapped in
   .lam-row which uses CSS grid with minmax(0, 1fr) so native form
   controls can't push columns wider than their grid track. */
.lam-fld { display: block; min-width: 0; }
.lam-fld + .lam-fld { margin-top: 0; }
.lam-modal-body > .lam-fld + .lam-row,
.lam-modal-body > .lam-row + .lam-fld,
.lam-modal-body > .lam-row + .lam-row { margin-top: 2px; }
.lam-lbl {
  display: block;
  font-size: 11px; font-weight: 700; color: #4c1d95;
  letter-spacing: 0.04em; text-transform: uppercase;
  margin-bottom: 6px;
}
.lam-row {
  display: grid; gap: 16px;
  align-items: start;
}
.lam-row.cols-1 { grid-template-columns: minmax(0, 1fr); }
.lam-row.cols-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.lam-row > .lam-fld { width: 100%; min-width: 0; }
.lam-row > .lam-fld > * { width: 100%; box-sizing: border-box; }
.lam-req { color: #e11d48; margin-left: 2px; }
.lam-textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 10px 12px;
  font-family: inherit; font-size: 13px; color: #1e293b;
  background: #fff; outline: none; resize: vertical;
  min-height: 96px; line-height: 1.55;
  transition: border-color .15s, box-shadow .15s;
}
.lam-textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
.lam-textarea::placeholder { color: #94a3b8; font-weight: 400; }
.lam-char-count { font-size: 10.5px; color: #94a3b8; text-align: right; margin-top: 1px; line-height: 1.1; transition: color .15s; }
.lam-char-max   { color: #cbd5e1; }
.lam-cc-warn    { color: #ea580c; font-weight: 700; }
.lam-cc-warn .lam-char-max { color: #fdba74; }
.lam-cc-max     { color: #dc2626; font-weight: 800; }
.lam-cc-max .lam-char-max  { color: #f87171; }

.lam-select-wrap { position: relative; width: 100%; }
.lam-select {
  width: 100%; box-sizing: border-box;
  border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 9px 32px 9px 12px;
  font-family: inherit; font-size: 13px; color: #1e293b; font-weight: 500;
  background: #fff; outline: none; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  transition: border-color .15s, box-shadow .15s;
}
.lam-select:hover { border-color: #cbd5e1; }
.lam-select:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
.lam-select-caret {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  pointer-events: none; color: #64748b; font-size: 16px;
}
.lam-error {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #b91c1c; margin-top: 12px; font-weight: 600;
  background: #fee2e2; padding: 8px 12px; border-radius: 8px;
  border: 1px solid rgba(239,68,68,0.30);
}
.lam-error i { font-size: 14px; }

.lam-modal-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px;
  background: #fff;
  border-top: 1px solid #ede9fe;
  flex-shrink: 0;
}
/* Drop-in variant for footers that only contain the action group —
   actions hug the right edge instead of being justified to both sides. */
.lam-modal-footer-right { justify-content: flex-end; }
.lam-footer-actions { display: flex; gap: 8px; }
.lam-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: all .18s ease;
}
.lam-btn i { font-size: 14px; }
.lam-btn-light { background: #fff; color: #6d28d9; border-color: #ddd6fe; }
.lam-btn-light:hover:not(:disabled) {
  background: #f5f3ff; border-color: #c4b5fd;
  transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,.18);
}
.lam-btn-primary {
  background: linear-gradient(135deg, #6d28d9, #7c3aed); color: #fff;
  border: none;
  box-shadow: 0 4px 14px rgba(124,58,237,.40);
}
.lam-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(124,58,237,.50);
}
.lam-btn:disabled { opacity: 0.65; cursor: not-allowed; }
.lam-spinner {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
  display: inline-block;
  animation: lam-spin .7s linear infinite;
}
@keyframes lam-spin { to { transform: rotate(360deg); } }

/* ─── DARK MODE ─── */
[data-bs-theme="dark"] .lam-root { background: linear-gradient(180deg, #14101d 0%, #1a1530 100%); color: #cbd5e1; }

[data-bs-theme="dark"] .lam-no-access {
  background: #1a1530; border-color: rgba(167,139,250,.30);
  box-shadow: 0 4px 18px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .lam-no-access-icon { background: rgba(124,58,237,.18); color: #c4b5fd; }
[data-bs-theme="dark"] .lam-no-access-title { color: #ede9fe; }
[data-bs-theme="dark"] .lam-no-access-sub   { color: #9aa0b4; }

[data-bs-theme="dark"] .lam-hero {
  background:
    radial-gradient(ellipse at top right, rgba(167,139,250,0.12), transparent 60%),
    radial-gradient(ellipse at bottom left, rgba(124,58,237,0.10), transparent 60%),
    linear-gradient(135deg, #2a2150 0%, #241c44 50%, #1d1638 100%);
  border-color: rgba(167,139,250,0.22);
  box-shadow: 0 6px 24px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .lam-hero::after { background: linear-gradient(180deg, rgba(255,255,255,.06), transparent); }
[data-bs-theme="dark"] .lam-hero-icon { background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%); }
[data-bs-theme="dark"] .lam-hero-title { color: #ede9fe; }
[data-bs-theme="dark"] .lam-hero-sub   { color: #c4b5fd; opacity: 1; }
[data-bs-theme="dark"] .lam-back-btn {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.28);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .lam-back-btn:hover {
  background: rgba(167,139,250,.10);
  border-color: rgba(167,139,250,.50);
  color: #ede9fe;
}

[data-bs-theme="dark"] .lam-kpi-tile {
  background: #1a1530; border-color: rgba(167,139,250,.28);
  box-shadow: 0 4px 14px rgba(0,0,0,0.30);
}
[data-bs-theme="dark"] .lam-kpi-tile.is-clickable:hover {
  border-color: rgba(167,139,250,.55);
  box-shadow: 0 14px 32px rgba(0,0,0,0.50), 0 4px 10px rgba(0,0,0,0.30);
}
[data-bs-theme="dark"] .lam-kpi-label { color: #9aa0b4; }
[data-bs-theme="dark"] .lam-kpi-value { color: #ede9fe; }

[data-bs-theme="dark"] .lam-tabs {
  background: rgba(124,58,237,.12);
  border: 1px solid rgba(167,139,250,.25);
  box-shadow: none;
}
[data-bs-theme="dark"] .lam-tab {
  background: transparent;
  border: none;
  color: #9aa0b4;
  box-shadow: none;
}
[data-bs-theme="dark"] .lam-tab:hover:not(.is-active) { color: #ede9fe; background: rgba(167,139,250,.14); }
[data-bs-theme="dark"] .lam-tab.is-active { background: linear-gradient(135deg, #8b5cf6, #7c3aed); border-color: transparent; color: #fff; }
[data-bs-theme="dark"] .lam-tab.is-active:hover {
  background: linear-gradient(100deg, rgba(167,139,250,.22) 0%, rgba(124,58,237,.20) 100%);
  color: #ede9fe;
  box-shadow: 0 2px 10px rgba(0,0,0,.30), 0 1px 0 rgba(255,255,255,.08) inset;
}
[data-bs-theme="dark"] .lam-tab-count { background: rgba(255,255,255,.06); color: #c4b5fd; }
[data-bs-theme="dark"] .lam-tab.is-active .lam-tab-count { background: rgba(0,0,0,.32); color: #fff; }

[data-bs-theme="dark"] .lam-search {
  background: #1a1530;
  border-color: rgba(167,139,250,0.25);
}
[data-bs-theme="dark"] .lam-search:hover { border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .lam-search:focus-within { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
[data-bs-theme="dark"] .lam-search input { color: #e6e8ec; }
[data-bs-theme="dark"] .lam-search input::placeholder { color: #b0b4bd; opacity: 1; }
[data-bs-theme="dark"] .lam-search-icon { color: #b0b4bd; }
[data-bs-theme="dark"] .lam-search-clear:hover { background: rgba(255,255,255,0.06); color: #ede9fe; }

[data-bs-theme="dark"] .lam-table-card {
  background: #1a1530; border-color: rgba(167,139,250,.25);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .lam-table thead tr {
  background: linear-gradient(90deg, #7c3aed 0%, #6d28d9 60%, #5b21b6 100%);
}
[data-bs-theme="dark"] .lam-table thead th {
  background: transparent;
  color: #f5f3ff;
  border-bottom-color: transparent;
}
[data-bs-theme="dark"] .lam-table tbody td { color: #cbd5e1; border-bottom-color: rgba(167,139,250,.10); }
[data-bs-theme="dark"] .lam-table tbody tr:nth-child(even) td { background: rgba(15,23,42,0.50); }
[data-bs-theme="dark"] .lam-table tbody tr:hover td { background: rgba(124,58,237,.10) !important; }
[data-bs-theme="dark"] .lam-td-sr     { color: #ede9fe; }
[data-bs-theme="dark"] .lam-sr-badge  { background: rgba(124,58,237,.18); color: #c4b5fd; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lam-td-reason { color: #ede9fe; }
[data-bs-theme="dark"] .lam-empty { color: #64748b; }
[data-bs-theme="dark"] .lam-empty-icon { background: rgba(124,58,237,.16); color: #a78bfa; }
[data-bs-theme="dark"] .lam-skel {
  background: linear-gradient(90deg, #241c3a 25%, #322750 37%, #241c3a 63%);
  background-size: 400% 100%;
}

/* Dark-mode status pills — softer tints so they don't burn out on
   the deep purple table. Action buttons (.lam-ab) already auto-adapt
   via the vz-* CSS variables; no override needed. */
[data-bs-theme="dark"] .lam-active   { background: rgba(34,197,94,.20);  color: #86efac; }
[data-bs-theme="dark"] .lam-inactive { background: rgba(239,68,68,.20);  color: #fca5a5; }
[data-bs-theme="dark"] .lam-positive { background: rgba(59,130,246,.22); color: #93c5fd; }
[data-bs-theme="dark"] .lam-negative { background: rgba(239,68,68,.20);  color: #fca5a5; }

[data-bs-theme="dark"] .lam-pagination {
  background: #1a1530;
  border-top-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .lam-pag-info { color: #9aa0b4; }
[data-bs-theme="dark"] .lam-pag-range {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  box-shadow: 0 3px 12px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.08) inset;
}
[data-bs-theme="dark"] .lam-pag-info strong { color: #ede9fe; }
[data-bs-theme="dark"] .lam-select option { background: #1a1530; color: #ede9fe; }
[data-bs-theme="dark"] .lam-pag-btn {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.30);
  color: #c4b5fd;
  box-shadow: none;
}
[data-bs-theme="dark"] .lam-pag-btn:hover:not(:disabled):not(.is-active) {
  background: rgba(124,58,237,.20);
  border-color: rgba(167,139,250,.50);
  color: #ede9fe;
}
[data-bs-theme="dark"] .lam-pag-btn.is-active {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  border-color: #7c3aed; color: #fff;
  box-shadow: 0 2px 8px rgba(124,58,237,.45);
}
[data-bs-theme="dark"] .lam-rows {
  background: rgba(255,255,255,.04); border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
[data-bs-theme="dark"] .lam-rows-sel { color: #c4b5fd; }
[data-bs-theme="dark"] .lam-rows-caret { color: #c4b5fd; }
[data-bs-theme="dark"] select.lam-rows-sel { color-scheme: dark; }
[data-bs-theme="dark"] .lam-rows-sel option { background: #1a1530; color: #ede9fe; }

[data-bs-theme="dark"] .lam-modal { background: #1a1530; box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 4px 24px rgba(0,0,0,.30); }
[data-bs-theme="dark"] .lam-modal-body { background: #221a3a; }
[data-bs-theme="dark"] .lam-modal-helper { color: #9aa0b4; }
[data-bs-theme="dark"] .lam-modal-footer { background: #1a1530; border-top-color: rgba(167,139,250,.20); }

[data-bs-theme="dark"] .lam-textarea,
[data-bs-theme="dark"] .lam-select {
  background: #14101d; color: #ede9fe;
  border-color: rgba(167,139,250,.28);
}
[data-bs-theme="dark"] .lam-textarea::placeholder { color: #64748b; }
[data-bs-theme="dark"] .lam-textarea:focus,
[data-bs-theme="dark"] .lam-select:focus { border-color: #a78bfa; box-shadow: 0 0 0 4px rgba(167,139,250,.18); }
[data-bs-theme="dark"] .lam-lbl { color: #c4b5fd; }
[data-bs-theme="dark"] .lam-char-count { color: #64748b; }
[data-bs-theme="dark"] .lam-char-max { color: #322750; }
[data-bs-theme="dark"] .lam-error { background: rgba(239,68,68,.16); color: #fca5a5; border-color: rgba(239,68,68,.40); }

[data-bs-theme="dark"] .lam-btn-light {
  background: rgba(255,255,255,.04); color: #c4b5fd; border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .lam-btn-light:hover:not(:disabled) {
  background: rgba(124,58,237,.14); border-color: rgba(167,139,250,.50); color: #ede9fe;
  box-shadow: 0 4px 12px rgba(0,0,0,.40);
}

/* Opp-type selector tiles — gentler tints in dark mode so the high
   saturation doesn't fight the dark backdrop. */
[data-bs-theme="dark"] .lam-opp { background: rgba(255,255,255,0.03); box-shadow: 0 3px 10px rgba(0,0,0,.45); }
[data-bs-theme="dark"] .lam-opp-qualified    { border-color: rgba(34,197,94,.45); }
[data-bs-theme="dark"] .lam-opp-qualified:hover { background: rgba(34,197,94,.10); border-color: rgba(34,197,94,.60); box-shadow: 0 10px 24px rgba(0,0,0,.50); }
[data-bs-theme="dark"] .lam-opp-qualified .lam-opp-icon { background: rgba(34,197,94,.18); border-color: rgba(34,197,94,.40); color: #6ee7b7; }
[data-bs-theme="dark"] .lam-opp-qualified .lam-opp-title,
[data-bs-theme="dark"] .lam-opp-qualified .lam-opp-chev { color: #86efac; }
[data-bs-theme="dark"] .lam-opp-qualified .lam-opp-sub  { color: #4ade80; }

[data-bs-theme="dark"] .lam-opp-disqualified    { border-color: rgba(234,88,12,.50); }
[data-bs-theme="dark"] .lam-opp-disqualified:hover { background: rgba(234,88,12,.10); border-color: rgba(234,88,12,.65); box-shadow: 0 10px 24px rgba(0,0,0,.50); }
[data-bs-theme="dark"] .lam-opp-disqualified .lam-opp-icon { background: rgba(234,88,12,.18); border-color: rgba(234,88,12,.40); color: #fdba74; }
[data-bs-theme="dark"] .lam-opp-disqualified .lam-opp-title,
[data-bs-theme="dark"] .lam-opp-disqualified .lam-opp-chev { color: #fdba74; }
[data-bs-theme="dark"] .lam-opp-disqualified .lam-opp-sub  { color: #fb923c; }

[data-bs-theme="dark"] .lam-opp-clarity    { border-color: rgba(37,99,235,.50); }
[data-bs-theme="dark"] .lam-opp-clarity:hover { background: rgba(37,99,235,.10); border-color: rgba(37,99,235,.65); box-shadow: 0 10px 24px rgba(0,0,0,.50); }
[data-bs-theme="dark"] .lam-opp-clarity .lam-opp-icon { background: rgba(37,99,235,.18); border-color: rgba(37,99,235,.40); color: #93c5fd; }
[data-bs-theme="dark"] .lam-opp-clarity .lam-opp-title,
[data-bs-theme="dark"] .lam-opp-clarity .lam-opp-chev { color: #93c5fd; }
[data-bs-theme="dark"] .lam-opp-clarity .lam-opp-sub  { color: #60a5fa; }

/* ─── RESPONSIVE ─── */
@media (max-width: 1100px) {
  .lam-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  /* Hero: icon + text on one row, the action button wraps to its own row
     below and stays auto-width (right-aligned) rather than stretching. */
  .lam-hero { min-height: 0; padding: 14px 18px; }
  .lam-hero-actions { width: 100%; justify-content: flex-end; }
  .lam-tabs-row { flex-direction: column; align-items: stretch; }
  .lam-tabs { width: 100%; overflow-x: auto; }
  .lam-search { max-width: 100%; }
}
@media (max-width: 720px) {
  .lam-root { padding: 12px 12px 18px; font-size: 13px; }
  .lam-hero { padding: 14px 16px; gap: 12px; }
  .lam-hero-title { font-size: 16px; }
  .lam-hero-sub   { font-size: 11.5px; }
  .lam-hero-icon  { width: 42px; height: 42px; font-size: 20px; }
  .lam-hero-text  { flex: 1 1 100%; }
  .lam-pagination { padding: 10px 12px; flex-direction: column; align-items: stretch; gap: 10px; }
  .lam-pag-btns   { justify-content: center; flex-wrap: wrap; }
}
@media (max-width: 520px) {
  .lam-overlay { padding: 12px; }
  .lam-kpi-grid { grid-template-columns: 1fr; }
  .lam-row.cols-2 { grid-template-columns: minmax(0, 1fr); }
  .lam-modal { border-radius: 16px; max-height: calc(100vh - 24px); }
  .lam-modal-md, .lam-modal-lg { width: 100%; }
  .lam-modal-header { padding: 16px 18px; gap: 12px; }
  .lam-modal-header-rich { padding: 18px 18px; }
  .lam-modal-hicon { width: 40px; height: 40px; font-size: 20px; }
  .lam-modal-title { font-size: 15px; }
  .lam-modal-sub   { font-size: 11px; }
  .lam-modal-body   { padding: 18px 16px 14px; }
  .lam-modal-footer { padding: 12px 16px; flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .lam-modal-close  { right: 14px; }
  .lam-modal-htext  { padding-right: 30px; }
  .lam-footer-actions { width: 100%; justify-content: stretch; }
  .lam-footer-actions .lam-btn { flex: 1; justify-content: center; }
  .lam-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .lam-opp { padding: 12px 14px; gap: 10px; }
  .lam-opp-icon { width: 38px; height: 38px; font-size: 20px; }
  .lam-opp-title { font-size: 12.5px; }
  .lam-opp-sub   { font-size: 10.5px; }
}
@media (max-width: 400px) {
  .lam-root { padding: 10px 8px 14px; font-size: 12.5px; }
  .lam-hero { padding: 12px 12px; gap: 10px; }
  .lam-hero-title { font-size: 14.5px; }
  .lam-hero-sub   { font-size: 10.5px; }
  .lam-hero-icon  { width: 38px; height: 38px; font-size: 18px; }
  .lam-hero-actions { flex-direction: column; gap: 8px; }
  .lam-back-btn,
  .lam-add-btn { width: 100%; }
  .lam-tab { padding: 6px 10px; font-size: 11.5px; gap: 5px; }
  .lam-tab-icon { font-size: 12px; }
  .lam-pag-info { font-size: 11.5px; }
  .lam-pag-btn { min-width: 28px; height: 28px; font-size: 14px; }
  .lam-pag-num { min-width: 28px; height: 28px; font-size: 12px; }
}
`;
