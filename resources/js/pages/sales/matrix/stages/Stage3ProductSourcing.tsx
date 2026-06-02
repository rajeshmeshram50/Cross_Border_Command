import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import CreateProcurementModal, { type SelectedProduct } from './CreateProcurementModal';
import ProcurementDetailsModal from './ProcurementDetailsModal';
import VendorMappingsModal from './VendorMappingsModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 3: Product Sourcing
 *
 *  Custom CBC design (pill-style tabs, amber-tinted Sourcing Required
 *  card, per-row "+ Create" CTA, footer progress bar). Backend behaviour
 *  unchanged: sourcing_status, mark-sourced, procurement create — same
 *  endpoints we've been hardening through the negative + security suites.
 * ───────────────────────────────────────────────────────────────────── */

type Tab = 'details' | 'required' | 'not_required';

type Row = {
  id:                number;
  product_id:        number;
  product_code:      string | null;
  product_name:      string | null;
  product_status:    string | null;
  currency:          string;
  quantity:          number | string | null;
  target_price:      number | string | null;
  notes:             string | null;
  sourcing_status:   'required' | 'not_required' | null;
  procurement_done:  boolean;
  procurement_id:    number | null;
  vendor_count:      number;
};

const SOURCING_OPTIONS = [
  { value: 'required',     label: 'Sourcing Required' },
  { value: 'not_required', label: 'Not Required' },
];

export default function Stage3ProductSourcing({ header, onPrev, onNext, reloadLead, embedded }: StageProps) {
  const toast = useToast();

  const [tab, setTab]                       = useState<Tab>('details');
  const [rows, setRows]                     = useState<Row[]>([]);
  const [loading, setLoading]               = useState(false);
  const [updatingId, setUpdatingId]         = useState<number | null>(null);
  const [markingId, setMarkingId]           = useState<number | null>(null);
  const [advancing, setAdvancing]           = useState(false);
  const [selectedIds, setSelectedIds]       = useState<Set<number>>(new Set());
  const [procModalOpen, setProcModalOpen]   = useState(false);
  const [procModalRows, setProcModalRows]   = useState<SelectedProduct[]>([]);
  const [procViewId, setProcViewId]         = useState<number | null>(null);
  // Row whose vendor mappings to show (Vendor Count column click → popup).
  const [vendorMapRow, setVendorMapRow]     = useState<Row | null>(null);

  const leadId = header.leadId;

  /* Ref to the readiness checklist so we can scroll it into view + flash
   * it when the user clicks Save & Next while issues remain. Beats a
   * blink-and-it's-gone toast because the user can read the list, click
   * straight into the failing tab, and watch issues drop off as they fix
   * them. */
  const readinessRef = useRef<HTMLDivElement | null>(null);
  const [readinessFlash, setReadinessFlash] = useState(false);

  /* Initial-mount fetch flips the loading flag (shows skeleton). For
   * after-action refreshes (post Create Procurement, post Mark Sourced)
   * we want the table to update silently so users don't see a jarring
   * full-table skeleton flash for what is actually a single-row change. */
  const fetchRows = useCallback(async (showSkeleton = true) => {
    if (!leadId) { setRows([]); return; }
    if (showSkeleton) setLoading(true);
    try {
      const { data } = await api.get<{ status: boolean; data: Row[] }>(`/sales/leads/${leadId}/products`);
      setRows(data.data ?? []);
    } catch {
      toast.error('Load failed', 'Could not load the lead’s product directory');
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, [leadId, toast]);

  useEffect(() => { void fetchRows(true); }, [fetchRows]);

  /* ── Bucketed views ─────────────────────────────────────────────── */
  const detailsRows     = useMemo(() => rows.filter(r => r.sourcing_status === null),         [rows]);
  const requiredRows    = useMemo(() => rows.filter(r => r.sourcing_status === 'required'),    [rows]);
  const notRequiredRows = useMemo(() => rows.filter(r => r.sourcing_status === 'not_required'),[rows]);
  const inactiveRows    = useMemo(
    () => rows.filter(r => (r.product_status ?? '').toLowerCase() !== 'active'),
    [rows],
  );
  const procurableRows  = useMemo(
    () => requiredRows.filter(r => r.procurement_id == null),
    [requiredRows],
  );

  /* Product Details progress — how many rows have a sourcing decision. */
  const detailsTotal = rows.length;
  const detailsSet   = rows.filter(r => r.sourcing_status !== null).length;
  /* Sourcing Required progress — how many required rows are marked done. */
  const requiredDone = requiredRows.filter(r => r.procurement_done).length;

  /* Friendly readiness checklist — every item that would block Save &
   * Next is surfaced here as a one-line action, so the user can see ALL
   * blockers at once instead of fixing one and tripping the next toast.
   * Each item carries an optional CTA that either flips to the right
   * tab or scrolls to the right row. The Save & Next handler reuses
   * `pendingChecks.length` for its disabled/badge state. */
  type Check = {
    key:    string;
    title:  string;
    sub:    string;
    ctaLabel?: string;
    onCta?:  () => void;
  };
  const pendingChecks = useMemo<Check[]>(() => {
    const out: Check[] = [];
    if (!leadId) {
      out.push({
        key:   'no-lead',
        title: 'Open this stage from the Lead Worksheet',
        sub:   'The opportunity context is missing — re-open this lead to save progress.',
      });
      return out;
    }
    if (rows.length === 0) {
      out.push({
        key:   'no-products',
        title: 'Map at least one product',
        sub:   'Use the toolbar Product Directory to add products to this opportunity.',
      });
      return out;
    }
    if (detailsRows.length > 0) {
      out.push({
        key:      'unset-sourcing',
        title:    `${detailsRows.length} product${detailsRows.length === 1 ? '' : 's'} need a sourcing status`,
        sub:      'Choose “Sourcing Required” or “Not Required” for every product on the Product Details tab.',
        ctaLabel: 'Go to Product Details',
        onCta:    () => setTab('details'),
      });
    }
    if (inactiveRows.length > 0) {
      out.push({
        key:      'inactive',
        title:    `${inactiveRows.length} product${inactiveRows.length === 1 ? '' : 's'} not active`,
        sub:      'Activate them under Masters → Products before advancing this stage.',
      });
    }
    const pendingProc = requiredRows.filter(r => !r.procurement_done);
    if (pendingProc.length > 0) {
      out.push({
        key:      'pending-proc',
        title:    `${pendingProc.length} sourcing-required product${pendingProc.length === 1 ? '' : 's'} pending`,
        sub:      pendingProc.some(r => r.procurement_id == null)
          ? 'Create a procurement and then click “Mark as Done” on each row.'
          : 'Click “Mark as Done” on each row once procurement is complete.',
        ctaLabel: 'Go to Sourcing Required',
        onCta:    () => setTab('required'),
      });
    }
    return out;
  }, [leadId, rows.length, detailsRows.length, inactiveRows.length, requiredRows]);
  const isReady = pendingChecks.length === 0;

  /* ── Set sourcing status ─────────────────────────────────────────── */
  const onSourcingChange = async (row: Row, status: 'required' | 'not_required') => {
    if (!leadId) return;
    setUpdatingId(row.id);
    try {
      const { data } = await api.patch<{ status: boolean; data: Row }>(
        `/sales/leads/${leadId}/products/${row.id}/sourcing-status`,
        { sourcing_status: status },
      );
      setRows(prev => prev.map(r => r.id === row.id ? {
        ...r,
        sourcing_status:  data.data.sourcing_status,
        procurement_done: data.data.procurement_done,
      } : r));
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not update sourcing status');
    } finally {
      setUpdatingId(null);
    }
  };

  /* ── Selection ───────────────────────────────────────────────────── */
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const rowToSelected = (r: Row): SelectedProduct => ({
    id:                   r.id,
    product_id:           r.product_id,
    product_code:         r.product_code,
    product_name:         r.product_name,
    status:               r.product_status,
    default_qty:          r.quantity,
    default_target_price: r.target_price,
    currency:             r.currency,
  });

  /* ── Open Create Procurement modal ─────────────────────────────── */
  const onCreateOne = (row: Row) => {
    if (!leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet first');
      return;
    }
    setProcModalRows([rowToSelected(row)]);
    setProcModalOpen(true);
  };

  const onCreateGroup = () => {
    if (selectedIds.size === 0) {
      toast.warning('Pick at least one row', 'Tick the checkboxes for the products to bundle');
      return;
    }
    const picks = procurableRows.filter(r => selectedIds.has(r.id)).map(rowToSelected);
    setProcModalRows(picks);
    setProcModalOpen(true);
  };

  const onProcurementCreated = async () => {
    /* B25: clear selection AFTER the refetch resolves so a slow server
     *  doesn't leave the table briefly showing stale "checked" rows
     *  alongside a "Create Procurement" CTA that has already fired. The
     *  silent reload still drives the table content; we just gate the
     *  UI reset on its completion. */
    setProcModalRows([]);
    await fetchRows(false);
    setSelectedIds(new Set());
  };

  /* ── Mark Sourced ────────────────────────────────────────────────── */
  const onMarkSourced = async (row: Row) => {
    if (!leadId) return;
    setMarkingId(row.id);
    try {
      /* B26: trust the server's echo for `procurement_done` instead of
       *  optimistically flipping to true. If the API actually rejected
       *  the call (e.g., 409 idempotency from B24) but the catch branch
       *  is swallowed, the optimistic update would have left the UI
       *  permanently lying. Reading the response body keeps state in
       *  lock-step with the DB. */
      const res = await api.patch<{ data?: { procurement_done?: boolean } }>(
        `/sales/leads/${leadId}/products/${row.id}/mark-sourced`,
      );
      const done = res.data?.data?.procurement_done === true;
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, procurement_done: done } : r));
      toast.success('Sourced', `"${row.product_name ?? 'Product'}" marked done`);
    } catch (e: any) {
      toast.error('Mark failed', e?.response?.data?.message ?? 'Could not mark as done');
      /* On failure, refetch the row so the UI never lies. Cheap because
       * fetchRows hits a single endpoint with a small payload. */
      void fetchRows(false);
    } finally {
      setMarkingId(null);
    }
  };

  /* ── Save & Next ─────────────────────────────────────────────────── */
  /* If anything in the readiness checklist is pending we don't throw a
   * toast — we scroll the panel into view and pulse it for 1.2s so the
   * user can read the full list, then click into the failing tab. The
   * panel always reflects current state so they get live feedback as
   * they fix items. */
  const onSaveAndNext = async () => {
    if (!isReady) {
      toast.warning(
        pendingChecks[0]?.title ?? 'Not ready to advance',
        pendingChecks[0]?.sub ?? 'Finish sourcing for every product before advancing to Stage 4.',
      );
      return;
    }
    setAdvancing(true);
    try {
      await api.put(`/sales/leads/${leadId}`, { lead_stage_id: 4 });
      toast.success('Stage advanced', 'Moving to Price Shared (Stage 4)…');
      reloadLead?.();
      onNext();
    } catch (e: any) {
      toast.error('Could not advance', e?.response?.data?.message ?? 'Network or server error — please try again.');
    } finally {
      setAdvancing(false);
    }
  };

  /* ──────────────────────────── render ──────────────────────────── */
  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE3_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="10" />
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 3: Product Sourcing</div>
            <div className="smd-stg-head-sub"><span className="smd-stg-head-dot" />Product and vendor sourcing in progress</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Pill tabs */}
        <div className="s3-tabs">
          <button
            type="button"
            className={`s3-tab s3-tab-details ${tab === 'details' ? 'active' : ''}`}
            onClick={() => setTab('details')}
          >
            <span className="s3-tab-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
              </svg>
            </span>
            <span>Product Details</span>
            <span className="s3-tab-count">{detailsRows.length}</span>
          </button>

          <button
            type="button"
            className={`s3-tab s3-tab-req ${tab === 'required' ? 'active' : ''}`}
            onClick={() => setTab('required')}
          >
            <span className="s3-tab-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <circle cx="12" cy="12" r="10" />
              </svg>
            </span>
            <span>Sourcing Required</span>
            <span className="s3-tab-count">{requiredRows.length}</span>
          </button>

          <button
            type="button"
            className={`s3-tab s3-tab-not ${tab === 'not_required' ? 'active' : ''}`}
            onClick={() => setTab('not_required')}
          >
            <span className="s3-tab-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span>Sourcing Not Required</span>
            <span className="s3-tab-count">{notRequiredRows.length}</span>
          </button>
        </div>

        {/* ─── PRODUCT DETAILS TAB ─── */}
        {tab === 'details' && (
          <div className="s3-card s3-card-violet smd-fade-in" key="t-details">
            <div className="s3-card-head">
              <div className="s3-card-head-left">
                <div className="s3-card-icon s3-card-icon-violet">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                </div>
                <div>
                  <div className="s3-card-title">
                    All Mapped Products <span className="s3-card-count s3-card-count-violet">{detailsRows.length}</span>
                  </div>
                  <div className="s3-card-sub">Assign sourcing status to each product to proceed</div>
                </div>
              </div>
              <div className="s3-legend">
                <span className="s3-legend-pill s3-legend-on">
                  <span className="s3-legend-pill-dot" />
                  Active: either tab
                </span>
                <span className="s3-legend-pill s3-legend-off">
                  <span className="s3-legend-pill-dot" />
                  Inactive: Required only
                </span>
              </div>
            </div>

            <div className="s3-table-wrap">
              <table className="s3-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>SR</th>
                    <th style={{ width: 110 }}>CODE</th>
                    <th>PRODUCT NAME</th>
                    <th style={{ width: 100 }}>STATUS</th>
                    <th style={{ width: 80 }}>QTY</th>
                    <th style={{ width: 130 }}>TARGET PRICE</th>
                    <th style={{ width: 80 }}>CURRENCY</th>
                    <th style={{ width: 170 }}>SOURCING STATUS</th>
                    <th style={{ width: 130 }}>SET</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 3 }).map((_, i) => (
                    <tr key={`skd-${i}`} className="smd-fade-in">
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-chip" /></td>
                      <td><span className="smd-skel smd-skel-name" /></td>
                      <td><span className="smd-skel smd-skel-pill" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-chip" /></td>
                      <td><span className="smd-skel smd-skel-input" /></td>
                      <td><span className="smd-skel smd-skel-pill" /></td>
                    </tr>
                  ))}
                  {!loading && detailsRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="s3-empty">
                        {rows.length === 0
                          ? 'No products mapped — use the toolbar Product Directory to add some.'
                          : 'All mapped products have a sourcing status — check the Sourcing Required / Not Required tabs.'}
                      </td>
                    </tr>
                  )}
                  {!loading && detailsRows.map((r, idx) => {
                    const statusLc = (r.product_status ?? '').toLowerCase();
                    const isInactive = statusLc !== 'active';
                    return (
                      <tr key={r.id}>
                        <td><span className="s3-sr s3-sr-violet">{idx + 1}</span></td>
                        <td><span className="s3-code s3-code-violet">{r.product_code ?? `P-${String(r.product_id).padStart(3,'0')}`}</span></td>
                        <td>
                          <div className="s3-prod-name">{r.product_name ?? '—'}</div>
                        </td>
                        <td>
                          <span className={`s3-pill ${statusLc === 'active' ? 's3-pill-active' : statusLc === 'draft' ? 's3-pill-draft' : 's3-pill-inactive'}`}>
                            ● {statusLc ? statusLc.charAt(0).toUpperCase() + statusLc.slice(1) : '—'}
                          </span>
                        </td>
                        <td>{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                        <td className="s3-price">$ {r.target_price != null ? Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                        <td><span className="s3-curr">{r.currency}</span></td>
                        <td>
                          {updatingId === r.id ? (
                            <span className="s3-spin">Saving…</span>
                          ) : (
                            <MasterSelect
                              value={r.sourcing_status ?? ''}
                              onChange={(v) => {
                                if (v === 'required' || v === 'not_required') void onSourcingChange(r, v);
                              }}
                              options={isInactive ? SOURCING_OPTIONS.filter(o => o.value === 'required') : SOURCING_OPTIONS}
                              placeholder="— Select —"
                            />
                          )}
                        </td>
                        <td>
                          {r.sourcing_status === 'required' && (
                            <span className="s3-set s3-set-required">↗ Required</span>
                          )}
                          {r.sourcing_status === 'not_required' && (
                            <span className="s3-set s3-set-notreq">→ Not Required</span>
                          )}
                          {r.sourcing_status === null && (
                            <span className="s3-set s3-set-none">— not set</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* PROGRESS bar */}
            <div className="s3-progress">
              <span className="s3-progress-label">PROGRESS</span>
              <div className="s3-progress-bar">
                <div
                  className="s3-progress-fill s3-progress-fill-violet"
                  style={{ width: detailsTotal > 0 ? `${(detailsSet / detailsTotal) * 100}%` : '0%' }}
                />
              </div>
              <span className="s3-progress-count">{detailsSet} / {detailsTotal} set</span>
            </div>
          </div>
        )}

        {/* ─── SOURCING REQUIRED TAB ─── */}
        {tab === 'required' && (
          <div className="smd-fade-in" key="t-required">
            <div className="s3-warn">
              <span className="s3-warn-ico">⚠</span>
              <span>Complete procurement for all required products before proceeding to the next stage.</span>
            </div>

            <div className="s3-card s3-card-amber">
              <div className="s3-card-head s3-card-head-amber">
                <div className="s3-card-head-left">
                  <div className="s3-card-icon s3-card-icon-amber">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
                      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                    </svg>
                  </div>
                  <div>
                    <div className="s3-card-title">
                      Sourcing Required <span className="s3-card-count s3-card-count-amber">{requiredRows.length}</span>
                    </div>
                    <div className="s3-card-sub s3-card-sub-italic">
                      Check rows and click "Create Group Procurement" to bundle multiple products
                    </div>
                  </div>
                </div>
              </div>

              <div className="s3-table-wrap">
                <table className="s3-table s3-table-amber">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th style={{ width: 50 }}>SR</th>
                      <th style={{ width: 110 }}>CODE</th>
                      <th>PRODUCT NAME</th>
                      <th style={{ width: 90 }}>STATUS</th>
                      <th style={{ width: 70 }}>QTY</th>
                      <th style={{ width: 120 }}>TARGET PRICE</th>
                      <th style={{ width: 80 }}>CURRENCY</th>
                      <th style={{ width: 120 }}>PROCUREMENT ID</th>
                      <th style={{ width: 150 }}>SOURCING STATUS</th>
                      <th style={{ width: 100 }}>VENDOR COUNT</th>
                      <th style={{ width: 110 }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && Array.from({ length: 3 }).map((_, i) => (
                      <tr key={`skr-${i}`} className="smd-fade-in">
                        <td><span className="smd-skel" style={{ width: 16, height: 16, borderRadius: 4 }} /></td>
                        <td><span className="smd-skel smd-skel-num" /></td>
                        <td><span className="smd-skel smd-skel-chip" /></td>
                        <td><span className="smd-skel smd-skel-name" /></td>
                        <td><span className="smd-skel smd-skel-pill" /></td>
                        <td><span className="smd-skel smd-skel-num" /></td>
                        <td><span className="smd-skel smd-skel-num" /></td>
                        <td><span className="smd-skel smd-skel-chip" /></td>
                        <td><span className="smd-skel smd-skel-chip" /></td>
                        <td><span className="smd-skel smd-skel-btn" /></td>
                        <td><span className="smd-skel smd-skel-num" /></td>
                        <td><span className="smd-skel smd-skel-btn" /></td>
                      </tr>
                    ))}
                    {!loading && requiredRows.length === 0 && (
                      <tr><td colSpan={12} className="s3-empty">No products marked Sourcing Required yet.</td></tr>
                    )}
                    {!loading && requiredRows.map((r, idx) => {
                      const statusLc = (r.product_status ?? '').toLowerCase();
                      const hasProc = r.procurement_id != null;
                      return (
                        <tr key={r.id}>
                          <td>
                            {!hasProc && (
                              <input
                                type="checkbox"
                                className="s3-cb"
                                checked={selectedIds.has(r.id)}
                                onChange={() => toggleSelect(r.id)}
                              />
                            )}
                          </td>
                          <td><span className="s3-sr s3-sr-amber">{idx + 1}</span></td>
                          <td><span className="s3-code s3-code-amber">{r.product_code ?? `P-${String(r.product_id).padStart(3,'0')}`}</span></td>
                          <td><div className="s3-prod-name">{r.product_name ?? '—'}</div></td>
                          <td>
                            <span className={`s3-pill ${statusLc === 'active' ? 's3-pill-active' : statusLc === 'draft' ? 's3-pill-draft' : 's3-pill-inactive'}`}>
                              ● {statusLc ? statusLc.charAt(0).toUpperCase() + statusLc.slice(1) : '—'}
                            </span>
                          </td>
                          <td>{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                          <td className="s3-price">$ {r.target_price != null ? Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                          <td><span className="s3-curr">{r.currency}</span></td>
                          <td>
                            {hasProc ? (
                              <button
                                type="button"
                                className="s3-proc-pill"
                                onClick={() => setProcViewId(r.procurement_id)}
                              >
                                PROC-{String(r.procurement_id).padStart(3,'0')}
                              </button>
                            ) : (
                              <span className="s3-dash">—</span>
                            )}
                          </td>
                          <td>
                            {!hasProc && (
                              <span className="s3-pending">— pending</span>
                            )}
                            {hasProc && !r.procurement_done && (
                              <button
                                type="button"
                                className="s3-mark-btn"
                                onClick={() => void onMarkSourced(r)}
                                disabled={markingId === r.id}
                              >
                                {markingId === r.id ? 'Marking…' : '✓ Mark as Done'}
                              </button>
                            )}
                            {hasProc && r.procurement_done && (
                              <span className="s3-done">✓ Done</span>
                            )}
                          </td>
                          <td>
                            {r.vendor_count > 0 ? (
                              <button
                                type="button"
                                className="s3-vendor-count"
                                title="View vendor mappings"
                                onClick={() => setVendorMapRow(r)}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                                </svg>
                                {r.vendor_count}
                              </button>
                            ) : (
                              <span className="s3-dash">—</span>
                            )}
                          </td>
                          <td>
                            {!hasProc && (
                              <button type="button" className="s3-create-btn" onClick={() => onCreateOne(r)}>
                                + Create
                              </button>
                            )}
                            {hasProc && (
                              <span className="s3-created">✓ Created</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Procurement progress bar */}
              <div className="s3-progress s3-progress-amber">
                <span className="s3-progress-label">PROCUREMENT PROGRESS</span>
                <div className="s3-progress-bar">
                  <div
                    className="s3-progress-fill s3-progress-fill-amber"
                    style={{ width: requiredRows.length > 0 ? `${(requiredDone / requiredRows.length) * 100}%` : '0%' }}
                  />
                </div>
                <span className="s3-progress-count">{requiredDone} / {requiredRows.length} done</span>
              </div>
            </div>

            {/* Create Group Procurement button — shows when selection > 0 */}
            {selectedIds.size > 0 && (
              <div className="s3-cta-row">
                <button type="button" className="s3-group-btn" onClick={onCreateGroup}>
                  + Create Group Procurement
                  <span className="s3-group-count">{selectedIds.size}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── SOURCING NOT REQUIRED TAB ─── */}
        {tab === 'not_required' && (
          <div className="s3-card s3-card-mint smd-fade-in" key="t-notreq">
            <div className="s3-card-head s3-card-head-mint">
              <div className="s3-card-head-left">
                <div className="s3-card-icon s3-card-icon-mint">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <div className="s3-card-title">
                    Sourcing Not Required <span className="s3-card-count s3-card-count-mint">{notRequiredRows.length}</span>
                  </div>
                  <div className="s3-card-sub">Read-only — these products skip procurement</div>
                </div>
              </div>
            </div>

            <div className="s3-table-wrap">
              <table className="s3-table s3-table-mint">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>SR</th>
                    <th style={{ width: 110 }}>CODE</th>
                    <th>PRODUCT NAME</th>
                    <th style={{ width: 100 }}>STATUS</th>
                    <th style={{ width: 80 }}>QTY</th>
                    <th style={{ width: 130 }}>TARGET PRICE</th>
                    <th style={{ width: 80 }}>CURRENCY</th>
                    <th style={{ width: 100 }}>VENDOR COUNT</th>
                    <th style={{ width: 120 }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 2 }).map((_, i) => (
                    <tr key={`skn-${i}`} className="smd-fade-in">
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-chip" /></td>
                      <td><span className="smd-skel smd-skel-name" /></td>
                      <td><span className="smd-skel smd-skel-pill" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-chip" /></td>
                      <td><span className="smd-skel smd-skel-num" /></td>
                      <td><span className="smd-skel smd-skel-pill" /></td>
                    </tr>
                  ))}
                  {!loading && notRequiredRows.length === 0 && (
                    <tr><td colSpan={9} className="s3-empty">No products marked Not Required.</td></tr>
                  )}
                  {!loading && notRequiredRows.map((r, idx) => {
                    const statusLc = (r.product_status ?? '').toLowerCase();
                    return (
                      <tr key={r.id}>
                        <td><span className="s3-sr s3-sr-mint">{idx + 1}</span></td>
                        <td><span className="s3-code s3-code-mint">{r.product_code ?? `P-${String(r.product_id).padStart(3,'0')}`}</span></td>
                        <td><div className="s3-prod-name">{r.product_name ?? '—'}</div></td>
                        <td>
                          <span className={`s3-pill ${statusLc === 'active' ? 's3-pill-active' : statusLc === 'draft' ? 's3-pill-draft' : 's3-pill-inactive'}`}>
                            ● {statusLc ? statusLc.charAt(0).toUpperCase() + statusLc.slice(1) : '—'}
                          </span>
                        </td>
                        <td>{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                        <td className="s3-price">$ {r.target_price != null ? Number(r.target_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                        <td><span className="s3-curr">{r.currency}</span></td>
                        <td>
                          {r.vendor_count > 0 ? (
                            <button
                              type="button"
                              className="s3-vendor-count"
                              title="View vendor mappings"
                              onClick={() => setVendorMapRow(r)}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                              </svg>
                              {r.vendor_count}
                            </button>
                          ) : (
                            <span className="s3-dash">—</span>
                          )}
                        </td>
                        <td><span className="s3-skip">Skipped</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Footer — pipeline navigation; hidden when opened as a toolbar popup. */}
      {!embedded && (
      <div className="smd-stg-foot">
        <div className={`smd-stg-foot-note ${isReady ? 's3-foot-note-ok' : ''}`}>
          {isReady ? (
            <>✓ <strong>Ready :</strong> All checks passed — click Save &amp; Next to advance.</>
          ) : (
            <>⚠ <strong>{pendingChecks.length} pending :</strong> Complete sourcing for every product to advance.</>
          )}
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev} type="button">← Previous</button>
          <button
            className="smd-stg-btn smd-stg-btn-primary"
            onClick={() => void onSaveAndNext()}
            disabled={advancing}
            type="button"
            title="Save & Next"
          >
            {advancing ? 'Advancing…' : 'Save & Next →'}
          </button>
        </div>
      </div>
      )}

      <CreateProcurementModal
        open={procModalOpen}
        leadId={leadId ?? null}
        leadContext={{
          oppId:        header.oppId,
          oppDate:      header.oppDate,
          customer:     header.customer,
          customerCode: header.customerCode,
          country:      header.country,
          assignedTo:   header.salespersonName,
          status:       header.qualified ? 'Qualified' : header.disqualified ? 'Disqualified' : 'Pending',
        }}
        preSelectedProducts={procModalRows}
        availableProducts={procurableRows.map(rowToSelected)}
        onClose={() => { setProcModalOpen(false); setProcModalRows([]); }}
        onCreated={onProcurementCreated}
      />
      <ProcurementDetailsModal
        open={procViewId != null}
        procurementId={procViewId}
        onClose={() => setProcViewId(null)}
      />
      <VendorMappingsModal
        open={vendorMapRow != null}
        productId={vendorMapRow?.product_id ?? null}
        productCode={vendorMapRow?.product_code ?? null}
        productName={vendorMapRow?.product_name ?? null}
        targetPrice={vendorMapRow?.target_price ?? null}
        currency={vendorMapRow?.currency ?? null}
        onClose={() => setVendorMapRow(null)}
      />
    </>
  );
}

const STAGE3_CSS = `
/* Header — green status dot (replaces the literal ●) + suppress the shared
   pulsing ::before dot so the ACTIVE badge's own ● isn't doubled. */
.smd-stg-head-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34,197,94,.22);
  margin-right: 6px; vertical-align: middle;
}
.smd-stg-head-badge::before { display: none; }

/* ═══════════════════════════════ READINESS PANEL ═══════════════════════════════
 * Persistent, friendly version of what used to be a one-shot toast.
 * Two variants:
 *   .s3-ready-warn — amber, lists pending blockers with inline CTAs.
 *   .s3-ready-ok   — slim mint ribbon, lets the user know they're clear.
 * .s3-ready-flash triggers a 1.2s shake when the user clicks Save & Next
 * while blockers remain, drawing their eye back to the panel. */
.s3-ready {
  border-radius: 12px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1.5px solid transparent;
}
.s3-ready-warn {
  background: linear-gradient(135deg, #fffbeb, #fef3c7);
  border-color: #fcd34d;
  color: #78350f;
}
.s3-ready-ok {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border-color: #6ee7b7;
  color: #064e3b;
  padding: 10px 14px;
}
@keyframes s3-ready-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-3px); }
  80%      { transform: translateX(3px); }
}
.s3-ready-flash {
  animation: s3-ready-shake .6s ease-in-out 0s 2;
  box-shadow: 0 0 0 4px rgba(251, 191, 36, .25);
}
.s3-ready-head {
  display: flex; align-items: flex-start; gap: 10px;
}
.s3-ready-icon {
  width: 26px; height: 26px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.55); color: #b45309;
  flex-shrink: 0;
}
.s3-ready-ok .s3-ready-icon { background: rgba(255,255,255,.65); color: #047857; }
.s3-ready-text { flex: 1; min-width: 0; }
.s3-ready-title {
  font-size: 12.5px; font-weight: 800; letter-spacing: -.2px;
  line-height: 1.25;
}
.s3-ready-sub {
  font-size: 11px; font-weight: 600; margin-top: 2px;
  opacity: .85; line-height: 1.4;
}
.s3-ready-list {
  list-style: none; margin: 10px 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px;
}
.s3-ready-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 9px;
  background: rgba(255,255,255,.65);
  border: 1px solid rgba(252, 191, 36, .50);
}
.s3-ready-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #d97706;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(217, 119, 6, .18);
}
.s3-ready-item-body { flex: 1; min-width: 0; }
.s3-ready-item-title {
  font-size: 11.5px; font-weight: 800; color: #78350f;
  line-height: 1.3;
}
.s3-ready-item-sub {
  font-size: 10.5px; font-weight: 600; color: #92400e;
  margin-top: 2px; line-height: 1.4;
}
.s3-ready-cta {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff;
  font-family: inherit; font-size: 10.5px; font-weight: 800;
  box-shadow: 0 2px 6px rgba(217,119,6,.30);
  transition: all .12s;
}
.s3-ready-cta:hover { background: linear-gradient(135deg, #b45309, #92400e); transform: translateY(-1px); }

/* Footer note variants — green when ready, amber when blocked. */
.s3-foot-note-ok {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5) !important;
  border-color: #6ee7b7 !important;
  color: #047857 !important;
}
.s3-foot-note-ok strong { color: #064e3b !important; }

/* Save & Next, blocked state — desaturated + amber outline so the user
 * sees at a glance the button isn't currently the "happy path." Click
 * still fires onSaveAndNext, which scrolls to the checklist. */
.s3-next-blocked {
  background: linear-gradient(135deg, #94a3b8, #64748b) !important;
  box-shadow: 0 2px 6px rgba(100, 116, 139, .30) !important;
  position: relative;
}
.s3-next-blocked:hover {
  background: linear-gradient(135deg, #64748b, #475569) !important;
}

/* ═══════════════════════════════ TABS ═══════════════════════════════ */
.s3-tabs { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.s3-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 12px; border-radius: 9px;
  border: 1.5px solid; background: #fff;
  font-family: inherit; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.s3-tab-ico { display: inline-flex; align-items: center; justify-content: center; }
.s3-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  font-size: 10px; font-weight: 800;
}
/* Product Details — violet */
.s3-tab-details          { color: #7c3aed; border-color: #ddd6fe; }
.s3-tab-details:hover    { background: #faf5ff; }
.s3-tab-details.active   { background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; border-color: #6d28d9; box-shadow: 0 4px 12px rgba(124,58,237,.30); }
.s3-tab-details .s3-tab-count          { background: #ede9fe; color: #6d28d9; }
.s3-tab-details.active .s3-tab-count   { background: rgba(255,255,255,.22); color: #fff; }
/* Sourcing Required — amber */
.s3-tab-req              { color: #d97706; border-color: #fde68a; }
.s3-tab-req:hover        { background: #fffbeb; }
.s3-tab-req.active       { background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff; border-color: #d97706; box-shadow: 0 4px 12px rgba(217,119,6,.30); }
.s3-tab-req .s3-tab-count          { background: #fef3c7; color: #b45309; }
.s3-tab-req.active .s3-tab-count   { background: rgba(255,255,255,.22); color: #fff; }
/* Sourcing Not Required — mint */
.s3-tab-not              { color: #047857; border-color: #a7f3d0; }
.s3-tab-not:hover        { background: #ecfdf5; }
.s3-tab-not.active       { background: linear-gradient(135deg,#10b981,#059669); color: #fff; border-color: #059669; box-shadow: 0 4px 12px rgba(16,185,129,.30); }
.s3-tab-not .s3-tab-count          { background: #d1fae5; color: #047857; }
.s3-tab-not.active .s3-tab-count   { background: rgba(255,255,255,.22); color: #fff; }

/* ═══════════════════════════════ WARN BANNER ═══════════════════════════════ */
.s3-warn {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 16px; margin-bottom: 12px;
  background: linear-gradient(135deg,#fffbeb,#fef3c7);
  border: 1.5px solid #fcd34d; border-radius: 12px;
  color: #92400e; font-size: 12.5px; font-weight: 600;
}
.s3-warn-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #fef3c7; color: #b45309; font-size: 13px; flex-shrink: 0;
}

/* ═══════════════════════════════ CARD ═══════════════════════════════ */
.s3-card {
  background: #fff;
  border: 1.5px solid; border-radius: 14px;
  overflow: hidden;
}
.s3-card-violet { border-color: #ddd6fe; }
.s3-card-amber  { border-color: #fde68a; background: linear-gradient(180deg,#fffdf5,#fff); }
.s3-card-mint   { border-color: #a7f3d0; background: linear-gradient(180deg,#f0fdf4,#fff); }

.s3-card-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 13px 18px;
  background: linear-gradient(180deg, #faf5ff, #f5f3ff);
  border-bottom: 1.5px solid #ede9fe;
  gap: 12px; flex-wrap: wrap;
}
.s3-card-head-amber {
  background: linear-gradient(180deg, #fef3c7, #fef9e7);
  border-bottom-color: #fde68a;
}
.s3-card-head-mint {
  background: linear-gradient(180deg, #d1fae5, #ecfdf5);
  border-bottom-color: #a7f3d0;
}

.s3-card-head-left { display: flex; gap: 10px; align-items: center; }
.s3-card-icon {
  width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.s3-card-icon-violet { background: linear-gradient(135deg,#7c3aed,#6d28d9); }
.s3-card-icon-amber  { background: linear-gradient(135deg,#f59e0b,#d97706); }
.s3-card-icon-mint   { background: linear-gradient(135deg,#10b981,#059669); }

.s3-card-title { font-size: 13.5px; font-weight: 800; color: #3b0764; display: flex; align-items: center; gap: 8px; }
.s3-card-head-amber .s3-card-title { color: #78350f; }
.s3-card-head-mint  .s3-card-title { color: #064e3b; }
.s3-card-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; color: #fff;
}
.s3-card-count-violet { background: linear-gradient(135deg,#7c3aed,#6d28d9); }
.s3-card-count-amber  { background: linear-gradient(135deg,#f59e0b,#d97706); }
.s3-card-count-mint   { background: linear-gradient(135deg,#10b981,#059669); }

.s3-card-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.s3-card-sub-italic { font-style: italic; color: #b45309; }

.s3-legend { display: flex; gap: 8px; flex-wrap: wrap; }
.s3-legend-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
}
.s3-legend-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.s3-legend-on  { background: #dcfce7; color: #15803d; }
.s3-legend-off { background: #fee2e2; color: #b91c1c; }

/* ═══════════════════════════════ TABLE ═══════════════════════════════ */
.s3-table-wrap { overflow-x: auto; background: #fff; }
.s3-table { width: 100%; border-collapse: collapse; min-width: 880px; }
/* Table header — light lavender gradient matching the Product Sourcing
   popup's table (gradient on the tr so it sweeps the whole row; cells stay
   transparent). The amber Sourcing-Required table keeps its own header via
   the .s3-table-amber override below. */
.s3-table thead tr {
  background: linear-gradient(135deg, #f8f5ff, #ede9fe);
}
.s3-table thead th {
  padding: 11px 14px; text-align: left;
  font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #a78bfa;
  background: transparent;
  border-bottom: 1px solid #e9d5ff;
  white-space: nowrap;
}
.s3-table-amber thead th {
  background: linear-gradient(180deg, #fefce8, #fef9c3);
  color: #78350f;
  border-bottom: 1.5px solid #fde68a;
}
.s3-table-mint thead tr { background: transparent; }
.s3-table-mint thead th {
  background: linear-gradient(180deg, #059669, #047857);
  color: #fff;
  border-bottom: 1.5px solid #047857;
}
.s3-table tbody tr { transition: background .12s; }
.s3-table tbody tr:hover { background: #faf5ff; }
.s3-table-amber tbody tr:hover { background: #fffbeb; }
.s3-table tbody td {
  padding: 8px 10px; font-size: 11px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
  white-space: nowrap;
}
.s3-empty { text-align: center; padding: 26px 14px; color: #94a3b8; font-style: italic; }

.s3-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  font-size: 10px; font-weight: 800;
}
.s3-sr-violet { background: #ede9fe; color: #6d28d9; }
.s3-sr-amber  { background: #fef3c7; color: #b45309; }
.s3-sr-mint   { background: #d1fae5; color: #047857; }

.s3-code {
  display: inline-block; white-space: nowrap;
  font-family: 'Inter',monospace; font-size: 10px; font-weight: 700;
  padding: 2px 7px; border-radius: 7px; border: 1.5px solid;
}
.s3-code-violet { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
.s3-code-amber  { background: #fef3c7; color: #b45309; border-color: #fde68a; }
.s3-code-mint   { background: #d1fae5; color: #047857; border-color: #a7f3d0; }

.s3-prod-name { font-weight: 700; color: #1e293b; font-size: 12.5px; }

.s3-pill {
  display: inline-block; white-space: nowrap;
  padding: 2px 8px; border-radius: 999px;
  font-size: 9.5px; font-weight: 800;
}
.s3-pill-active   { background: #d1fae5; color: #047857; }
.s3-pill-inactive { background: #fee2e2; color: #dc2626; }
.s3-pill-draft    { background: #fef3c7; color: #b45309; }

.s3-price { color: #047857; font-weight: 700; }
.s3-curr {
  display: inline-block; padding: 3px 9px; border-radius: 6px;
  background: #eff6ff; color: #1d4ed8;
  border: 1px solid #bfdbfe;
  font-size: 11px; font-weight: 800;
}

.s3-spin { color: #6d28d9; font-style: italic; font-size: 11.5px; }

/* SET column pills */
.s3-set { display: inline-block; padding: 4px 11px; border-radius: 999px; font-size: 10.5px; font-weight: 800; }
.s3-set-required { background: #fef3c7; color: #b45309; border: 1.5px solid #fcd34d; }
.s3-set-notreq   { background: #d1fae5; color: #047857; border: 1.5px solid #6ee7b7; }
.s3-set-none     { color: #94a3b8; font-style: italic; font-weight: 600; background: transparent; border: none; }

/* Sourcing Required tab specifics */
.s3-cb {
  width: 17px; height: 17px; cursor: pointer; accent-color: #d97706;
  margin: 0;
}
.s3-dash { color: #cbd5e1; font-weight: 700; font-size: 13px; }
.s3-proc-pill {
  display: inline-block; background: transparent; border: none; cursor: pointer;
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 800;
  padding: 3px 11px; border-radius: 999px;
  background: #fef3c7; color: #b45309;
  border: 1.5px solid #fcd34d;
  text-decoration: underline; text-decoration-color: #d97706;
}
.s3-proc-pill:hover { background: #fde68a; }
/* Vendor Count chip — clickable, opens the vendor-mappings popup. */
.s3-vendor-count {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 800;
  padding: 4px 12px; border-radius: 999px;
  background: #ecfdf5; color: #047857; border: 1.5px solid #6ee7b7;
  transition: background .15s, transform .12s;
}
.s3-vendor-count:hover { background: #d1fae5; transform: translateY(-1px); }
.s3-pending { color: #d97706; font-style: italic; font-size: 11.5px; font-weight: 600; }
.s3-mark-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #f97316, #ea580c);
  color: #fff;
  font-family: inherit; font-size: 11px; font-weight: 700;
  border-radius: 7px;
  box-shadow: 0 2px 6px rgba(249,115,22,.30);
  transition: all .12s;
}
.s3-mark-btn:hover:not(:disabled) { background: linear-gradient(135deg, #ea580c, #c2410c); transform: translateY(-1px); }
.s3-mark-btn:disabled { opacity: .55; cursor: not-allowed; }
.s3-done {
  display: inline-block;
  padding: 4px 11px; border-radius: 999px;
  background: #d1fae5; color: #047857;
  font-size: 10.5px; font-weight: 800;
}
.s3-create-btn {
  display: inline-flex; align-items: center;
  padding: 6px 14px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(217,119,6,.30);
  transition: all .12s;
}
.s3-create-btn:hover { background: linear-gradient(135deg, #d97706, #b45309); transform: translateY(-1px); box-shadow: 0 4px 10px rgba(217,119,6,.40); }
.s3-created {
  display: inline-block;
  padding: 4px 11px; border-radius: 999px;
  background: transparent; color: #b45309;
  border: 1.5px solid #fcd34d;
  font-size: 10.5px; font-weight: 800;
}

.s3-skip {
  display: inline-block;
  padding: 4px 11px; border-radius: 999px;
  background: #d1fae5; color: #047857;
  font-size: 10.5px; font-weight: 800;
}

/* ═══════════════════════════════ PROGRESS BAR ═══════════════════════════════ */
.s3-progress {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px;
  background: #faf5ff;
  border-top: 1.5px solid #ede9fe;
  font-size: 10.5px;
}
.s3-progress-amber {
  background: #fef9c3;
  border-top-color: #fde68a;
}
.s3-progress-label {
  font-weight: 800; color: #6d28d9; letter-spacing: .1em;
}
.s3-progress-amber .s3-progress-label { color: #b45309; }
.s3-progress-bar {
  flex: 1; height: 7px;
  background: #ede9fe; border-radius: 999px; overflow: hidden;
}
.s3-progress-amber .s3-progress-bar { background: #fde68a; }
.s3-progress-fill { height: 100%; border-radius: 999px; transition: width .25s; }
.s3-progress-fill-violet { background: linear-gradient(90deg,#7c3aed,#6d28d9); }
.s3-progress-fill-amber  { background: linear-gradient(90deg,#f59e0b,#d97706); }
.s3-progress-count {
  font-weight: 800; color: #6d28d9;
  font-variant-numeric: tabular-nums;
}
.s3-progress-amber .s3-progress-count { color: #b45309; }

/* Group create CTA */
.s3-cta-row { display: flex; justify-content: center; padding: 16px 0 4px; }
.s3-group-btn {
  padding: 10px 24px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 700;
  border-radius: 10px;
  display: inline-flex; align-items: center; gap: 10px;
  box-shadow: 0 4px 12px rgba(217,119,6,.35);
}
.s3-group-btn:hover { background: linear-gradient(135deg, #b45309, #92400e); transform: translateY(-1px); }
.s3-group-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 24px; padding: 0 8px; border-radius: 999px;
  background: rgba(255,255,255,.28); color: #fff;
  font-size: 11.5px; font-weight: 800;
}

/* Dark mode */
[data-bs-theme="dark"] .s3-tab { background: #1a1538; }
[data-bs-theme="dark"] .s3-tab-details          { color: #c4b5fd; border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .s3-tab-details:hover    { background: #2a2150; }
[data-bs-theme="dark"] .s3-tab-req              { color: #fbbf24; border-color: rgba(252,191,36,.35); }
[data-bs-theme="dark"] .s3-tab-req:hover        { background: rgba(252,191,36,.10); }
[data-bs-theme="dark"] .s3-tab-not              { color: #6ee7b7; border-color: rgba(110,231,183,.35); }
[data-bs-theme="dark"] .s3-tab-not:hover        { background: rgba(110,231,183,.10); }
[data-bs-theme="dark"] .s3-card { background: #14102a; }
[data-bs-theme="dark"] .s3-card-violet { border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .s3-card-amber  { border-color: rgba(252,191,36,.35); background: #1a1538; }
[data-bs-theme="dark"] .s3-card-mint   { border-color: rgba(110,231,183,.35); background: #1a1538; }
[data-bs-theme="dark"] .s3-card-head { background: rgba(124,58,237,.10); border-bottom-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .s3-card-head-amber { background: rgba(252,191,36,.12); border-bottom-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .s3-card-head-mint { background: rgba(110,231,183,.12); border-bottom-color: rgba(110,231,183,.30); }
[data-bs-theme="dark"] .s3-card-title { color: #ede9fe; }
[data-bs-theme="dark"] .s3-card-head-amber .s3-card-title { color: #fde68a; }
[data-bs-theme="dark"] .s3-card-head-mint .s3-card-title { color: #6ee7b7; }
[data-bs-theme="dark"] .s3-card-sub { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s3-table-wrap { background: #14102a; }
/* The light thead-tr gradient bleeds through the translucent th in dark
   mode — neutralise it so the header reads as a dark amber bar. */
[data-bs-theme="dark"] .s3-table thead tr { background: transparent; }
[data-bs-theme="dark"] .s3-table-amber thead th { background: linear-gradient(180deg, rgba(120,53,15,.55), rgba(120,53,15,.40)); color: #fde68a; border-bottom-color: rgba(252,191,36,.35); }
[data-bs-theme="dark"] .s3-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .s3-table tbody tr:hover { background: rgba(124,58,237,.12); }
[data-bs-theme="dark"] .s3-table-amber tbody tr:hover { background: rgba(252,191,36,.10); }
[data-bs-theme="dark"] .s3-sr-violet { background: rgba(124,58,237,.22); color: #c4b5fd; }
[data-bs-theme="dark"] .s3-sr-amber  { background: rgba(252,191,36,.20); color: #fde68a; }
[data-bs-theme="dark"] .s3-sr-mint   { background: rgba(110,231,183,.20); color: #6ee7b7; }
[data-bs-theme="dark"] .s3-code-violet { background: rgba(124,58,237,.18); color: #c4b5fd; border-color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .s3-code-amber  { background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.40); }
[data-bs-theme="dark"] .s3-code-mint   { background: rgba(110,231,183,.18); color: #6ee7b7; border-color: rgba(110,231,183,.40); }
[data-bs-theme="dark"] .s3-prod-name { color: #ede9fe; }
[data-bs-theme="dark"] .s3-empty { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s3-pill-active   { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .s3-pill-inactive { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .s3-pill-draft    { background: rgba(245,158,11,.18); color: #fde68a; }
[data-bs-theme="dark"] .s3-price { color: #6ee7b7; }
[data-bs-theme="dark"] .s3-curr { background: rgba(96,165,250,.18); color: #93c5fd; border-color: rgba(96,165,250,.40); }
[data-bs-theme="dark"] .s3-set-required { background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.40); }
[data-bs-theme="dark"] .s3-set-notreq   { background: rgba(110,231,183,.18); color: #6ee7b7; border-color: rgba(110,231,183,.40); }
[data-bs-theme="dark"] .s3-set-none     { color: rgba(196,181,253,.45); }
[data-bs-theme="dark"] .s3-progress { background: rgba(124,58,237,.12); border-top-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .s3-progress-amber { background: rgba(252,191,36,.12); border-top-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .s3-progress-label { color: #c4b5fd; }
[data-bs-theme="dark"] .s3-progress-amber .s3-progress-label { color: #fde68a; }
[data-bs-theme="dark"] .s3-progress-bar { background: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .s3-progress-amber .s3-progress-bar { background: rgba(252,191,36,.20); }
[data-bs-theme="dark"] .s3-progress-count { color: #c4b5fd; }
[data-bs-theme="dark"] .s3-progress-amber .s3-progress-count { color: #fde68a; }
[data-bs-theme="dark"] .s3-warn { background: rgba(252,191,36,.14); border-color: rgba(252,191,36,.40); color: #fbbf24; }
[data-bs-theme="dark"] .s3-warn-ico { background: rgba(252,191,36,.20); color: #fde68a; }
[data-bs-theme="dark"] .s3-pending { color: #fbbf24; }
[data-bs-theme="dark"] .s3-done    { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .s3-skip    { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .s3-created { color: #fde68a; border-color: rgba(252,191,36,.40); }
[data-bs-theme="dark"] .s3-dash    { color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .s3-proc-pill { background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.45); }
[data-bs-theme="dark"] .s3-proc-pill:hover { background: rgba(252,191,36,.28); }
[data-bs-theme="dark"] .s3-vendor-count { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(110,231,183,.45); }
[data-bs-theme="dark"] .s3-vendor-count:hover { background: rgba(16,185,129,.28); }

/* Readiness panel — dark mode. Warn variant uses translucent amber on
 * the deep-slate body; ok variant uses translucent mint. Items + CTAs
 * mirror the light scheme. */
[data-bs-theme="dark"] .s3-ready-warn {
  background: linear-gradient(135deg, rgba(252,191,36,.10), rgba(252,191,36,.18));
  border-color: rgba(252,191,36,.40);
  color: #fbbf24;
}
[data-bs-theme="dark"] .s3-ready-ok {
  background: linear-gradient(135deg, rgba(16,185,129,.10), rgba(16,185,129,.18));
  border-color: rgba(110,231,183,.40);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .s3-ready-icon {
  background: rgba(252,191,36,.18); color: #fde68a;
}
[data-bs-theme="dark"] .s3-ready-ok .s3-ready-icon {
  background: rgba(16,185,129,.18); color: #6ee7b7;
}
[data-bs-theme="dark"] .s3-ready-item {
  background: rgba(20,16,42,.55);
  border-color: rgba(252,191,36,.35);
}
[data-bs-theme="dark"] .s3-ready-item-title { color: #fde68a; }
[data-bs-theme="dark"] .s3-ready-item-sub   { color: #fbbf24; }
[data-bs-theme="dark"] .s3-ready-dot {
  background: #fbbf24;
  box-shadow: 0 0 0 3px rgba(251,191,36,.25);
}
[data-bs-theme="dark"] .s3-ready-cta {
  background: linear-gradient(135deg, #f59e0b, #b45309);
  box-shadow: 0 2px 8px rgba(245,158,11,.40);
}
[data-bs-theme="dark"] .s3-foot-note-ok {
  background: linear-gradient(135deg, rgba(16,185,129,.12), rgba(16,185,129,.20)) !important;
  border-color: rgba(110,231,183,.40) !important;
  color: #6ee7b7 !important;
}
[data-bs-theme="dark"] .s3-foot-note-ok strong { color: #a7f3d0 !important; }
[data-bs-theme="dark"] .s3-next-blocked {
  background: linear-gradient(135deg, #475569, #334155) !important;
  box-shadow: 0 2px 6px rgba(15,23,42,.50) !important;
  color: #cbd5e1 !important;
}
[data-bs-theme="dark"] .s3-next-blocked:hover {
  background: linear-gradient(135deg, #334155, #1e293b) !important;
}
`;
