import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import Tooltip from '../../../../components/ui/Tooltip';
import '../../../../components/ui/DataTable.css';
import '../../../p2p/p2p-master-management/supplier-management/supplier-management.css';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import { LEAD_ACK_CSS as SCOPED_CSS } from './leadAckStyles';
import LeadAckReasonModal, { LEAD_ACK_TYPE_LABELS, type OppType, type LeadAckReason as Reason } from './LeadAckReasonModal';

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

type GroupedReasons = {
  qualified: Reason[];
  disqualified: Reason[];
  clarity_pending: Reason[];
};

const TAB_KEYS: OppType[] = ['qualified', 'disqualified', 'clarity_pending'];
const TAB_LABELS = LEAD_ACK_TYPE_LABELS;
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

  // Dynamic rows-per-page — auto-fit the number of rows to the space between the
  // table's top and the viewport bottom, so the page fills the screen (same as
  // CLM Segment Master / the QPI list). Stops overriding once the user manually
  // picks a value in the footer dropdown.
  const scrollRef  = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true);
  useEffect(() => {
    const recompute = () => {
      if (!autoFitRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      /* Measured, not estimated (same fix as the Customers / Consignee lists):
         the scroll box is flex-sized to the card, so its height minus the header
         row is exactly the space the rows get; the row height is the real one.
         The old fixed 46/46/60px guesses could round a fitting last row away. */
      const theadH = (el.querySelector('thead') as HTMLElement | null)?.offsetHeight || 46;
      const rowEl  = el.querySelector('tbody tr:not(.lam-skel-row)') as HTMLElement | null;
      const rowH   = rowEl?.getBoundingClientRect().height || 46;
      const avail  = el.clientHeight - theadH;
      if (avail <= 0) return;
      // +2: sub-pixel row heights must not cost a whole row.
      const fit = Math.max(4, Math.floor((avail + 2) / rowH));
      setRpp(prev => (prev === fit ? prev : fit));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(t); t = setTimeout(recompute, 140); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loading, q, rpp]);

  // Add / Edit Reason popup — shared with Sales Matrix Stage 2 (LeadAckReasonModal).
  const [modalOpen, setModalOpen]   = useState(false);
  const [editingRow, setEditingRow] = useState<Reason | null>(null);

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
    setEditingRow(null);
    setModalOpen(true);
  };

  const openEdit = (row: Reason) => {
    if (!canEdit) return;
    setEditingRow(row);
    setModalOpen(true);
  };

  const onReasonSaved = (row: Reason, mode: 'add' | 'edit') => {
    const t = row.opportunity_type;
    if (mode === 'edit') {
      setData(prev => ({ ...prev, [t]: prev[t].map(r => r.id === row.id ? row : r) }));
    } else {
      setData(prev => ({ ...prev, [t]: [...prev[t], row] }));
      setTab(t);
      setPage(1);
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

      {/* ── Header strip — the Supplier list's header (.sup-fig .cstrip), same as
              the Customers / Consignee / Quotations V/S PI lists. ── */}
      <div className="sup-fig">
        <div className="cstrip">
          <span className="cstrip__accent" />
          <span className="cstrip__glow" />
          <span className="cstrip__sheen" />
          <div className="cstrip__left">
            <div className="cstrip__avatar-wrap">
              <div className="cstrip__avatar"><i className="ri-checkbox-circle-line" style={{ fontSize: 17, color: '#fff' }} /></div>
              <span className="cstrip__online-dot" />
            </div>
            <div className="min-w-0">
              <div className="cstrip__title">Lead Acknowledgement</div>
              <div className="cstrip__sub">Manage qualification reasons for the sales pipeline</div>
            </div>
          </div>
          {canAdd && (
            <div className="cstrip__right">
              <button type="button" className="cstrip__action-btn" onClick={openAdd}>
                <span className="cstrip__action-btn-sheen" />
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add New Reason
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Table card — the Customers list card (dt-root hr-dt): toolbar with the
              list tab rail + search, the list header band, and the worklist pager. ── */}
      <div className="lam-table-card dt-root hr-dt" data-accent="violet">
        <div className="lam-toolbar">
          <div className="dt-tabrail hr-dt flex-shrink-0" data-accent="violet">
            <div className="dt-tabs" role="tablist">
              {TAB_KEYS.map(t => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`dt-tab ${tab === t ? 'on' : 'off'}`}
                  onClick={() => switchTab(t)}
                >
                  {TAB_LABELS[t]} <span className="dt-tab-count">{(data[t] || []).length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="dt-search">
            <i className="ri-search-line dt-search-icon" />
            <input
              type="text"
              autoComplete="off"
              placeholder="Search by reason…"
              value={q}
              onChange={e => { setQ(e.target.value); setPage(1); }}
            />
            {q && (
              <button type="button" className="dt-search-clear" onClick={() => { setQ(''); setPage(1); }} aria-label="Clear search">
                <i className="ri-close-line" />
              </button>
            )}
          </div>
        </div>
        <div className="lam-table-wrap" ref={scrollRef}>
          <table className="lam-table dt-table" style={{ tableLayout: 'fixed', minWidth: 560 }}>
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
                  <td className="lam-td-sr"><span className="dt-serial">{startIdx + i + 1}</span></td>
                  <td className="lam-td-reason"><ReasonCell text={r.reason} /></td>
                  {tab === 'disqualified' && (
                    <td style={{ textAlign: 'center' }}>
                      {/* Same pill as Status (.smc-wa): Positive green, Negative red. */}
                      {r.dq_status === 'positive'
                        ? <span className="smc-wa yes smc-wa--icon"><i className="ri-arrow-up-line" />Positive</span>
                        : <span className="smc-wa no smc-wa--icon"><i className="ri-arrow-down-line" />Negative</span>}
                    </td>
                  )}
                  <td style={{ textAlign: 'center', paddingLeft: 70 }}>
                    {/* Same pill as the Customers list WhatsApp Yes / No (.smc-wa). */}
                    {r.status === 'active'
                      ? <span className="smc-wa yes">Active</span>
                      : <span className="smc-wa no">Inactive</span>}
                  </td>
                  <td style={{ textAlign: 'center', paddingLeft: 50 }}>
                    {/* Same buttons as the Customers list actions (.smc-act), with its edit icon. */}
                    <div className="lam-actions">
                      {canEdit && (
                        <Tooltip label="Edit reason" themed>
                          <button type="button" aria-label="Edit" className="smc-act smc-act-edit" onClick={() => openEdit(r)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                        </Tooltip>
                      )}
                      {canDelete && (
                        <Tooltip label={r.status === 'inactive' ? 'Already inactive' : 'Mark inactive'} themed>
                          <button
                            type="button"
                            aria-label={r.status === 'inactive' ? 'Already inactive' : 'Mark inactive'}
                            aria-disabled={r.status === 'inactive'}
                            className="smc-act smc-act-del"
                            onClick={() => requestInactivate(r)}
                          >
                            <i className="ri-delete-bin-6-line fs-14" />
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

        {/* Pagination — identical to the Customers module footer
            (TableContainerReactTable's `worklistPagination` band, global
            .tc-wl-* styles): "Showing X–Y of Z" pill, Rows-per-page select
            with the same 5/10/15/25/50 options, "page / pages" pill and
            prev/next arrows always visible (disabled at the bounds). */}
        <div className="tc-wl-pag">
          <span className="tc-wl-info">
            {total === 0
              ? 'No records'
              : <>Showing <span className="tc-wl-hl">{startIdx + 1}–{Math.min(startIdx + rpp, total)}</span> of <span className="tc-wl-hl">{total}</span></>}
          </span>
          <div className="tc-wl-right">
            <span className="tc-wl-rows">
              Rows per page:
              <select
                value={rpp}
                onChange={e => { autoFitRef.current = false; setRpp(parseInt(e.target.value, 10)); setPage(1); }}
                aria-label="Rows per page"
              >
                {[...new Set([rpp, 5, 10, 15, 25, 50])].sort((a, b) => a - b).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </span>
            <span className="tc-wl-range">{safePage} / {pages}</span>
            <div className="tc-wl-nav">
              <button
                type="button"
                className="tc-wl-btn"
                disabled={safePage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <i className="ri-arrow-left-s-line"></i>
              </button>
              <button
                type="button"
                className="tc-wl-btn"
                disabled={safePage >= pages}
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                aria-label="Next page"
              >
                <i className="ri-arrow-right-s-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Add / Edit Reason popup (shared with Sales Matrix Stage 2) ── */}
      <LeadAckReasonModal
        open={modalOpen}
        editing={editingRow}
        onClose={() => { setModalOpen(false); setEditingRow(null); }}
        onSaved={onReasonSaved}
      />

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
