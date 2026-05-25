import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import CreateProcurementModal, { type SelectedProduct } from './CreateProcurementModal';
import ProcurementDetailsModal from './ProcurementDetailsModal';

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
};

const SOURCING_OPTIONS = [
  { value: 'required',     label: 'Sourcing Required' },
  { value: 'not_required', label: 'Not Required' },
];

export default function Stage3ProductSourcing({ header, onPrev, onNext, reloadLead }: StageProps) {
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

  const leadId = header.leadId;

  const fetchRows = useCallback(async () => {
    if (!leadId) { setRows([]); return; }
    setLoading(true);
    try {
      const { data } = await api.get<{ status: boolean; data: Row[] }>(`/sales/leads/${leadId}/products`);
      setRows(data.data ?? []);
    } catch {
      toast.error('Load failed', 'Could not load the lead’s product directory');
    } finally {
      setLoading(false);
    }
  }, [leadId, toast]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

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

  const onProcurementCreated = () => {
    setSelectedIds(new Set());
    setProcModalRows([]);
    void fetchRows();
  };

  /* ── Mark Sourced ────────────────────────────────────────────────── */
  const onMarkSourced = async (row: Row) => {
    if (!leadId) return;
    setMarkingId(row.id);
    try {
      await api.patch(`/sales/leads/${leadId}/products/${row.id}/mark-sourced`);
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, procurement_done: true } : r));
      toast.success('Sourced', `"${row.product_name ?? 'Product'}" marked done`);
    } catch (e: any) {
      toast.error('Mark failed', e?.response?.data?.message ?? 'Could not mark as done');
    } finally {
      setMarkingId(null);
    }
  };

  /* ── Save & Next ─────────────────────────────────────────────────── */
  const onSaveAndNext = async () => {
    if (!leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet to enable advancing');
      return;
    }
    if (rows.length === 0) {
      toast.warning('No products mapped', 'Open the Product Directory toolbar and map at least one product first');
      return;
    }
    if (detailsRows.length > 0) {
      toast.warning('Sourcing status pending', `${detailsRows.length} product(s) still need a sourcing status`);
      setTab('details');
      return;
    }
    if (inactiveRows.length > 0) {
      toast.warning('Inactive products', `${inactiveRows.length} product(s) are inactive or draft. Activate them on the Product Master first.`);
      return;
    }
    const unsourced = requiredRows.filter(r => !r.procurement_done);
    if (unsourced.length > 0) {
      toast.warning('Procurement incomplete', `${unsourced.length} Sourcing Required product(s) still need to be marked done`);
      setTab('required');
      return;
    }
    setAdvancing(true);
    try {
      await api.put(`/sales/leads/${leadId}`, { lead_stage_id: 4 });
      reloadLead?.();
      onNext();
    } catch (e: any) {
      toast.error('Advance failed', e?.response?.data?.message ?? 'Could not move to Stage 4');
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
            <div className="smd-stg-head-sub">● Product and vendor sourcing in progress</div>
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
          <div className="s3-card s3-card-violet">
            <div className="s3-card-head">
              <div className="s3-card-head-left">
                <div className="s3-card-icon s3-card-icon-violet">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                </div>
                <div>
                  <div className="s3-card-title">
                    All Mapped Products <span className="s3-card-count s3-card-count-violet">{rows.length}</span>
                  </div>
                  <div className="s3-card-sub">Assign sourcing status to each product to proceed</div>
                </div>
              </div>
              <div className="s3-legend">
                <span className="s3-legend-dot s3-dot-active">● Active: either tab</span>
                <span className="s3-legend-dot s3-dot-inactive">● Inactive: Required only</span>
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
                  {loading && <tr><td colSpan={9} className="s3-empty">Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={9} className="s3-empty">No products mapped — use the toolbar Product Directory to add some.</td></tr>
                  )}
                  {!loading && rows.map((r, idx) => {
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
          <>
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
                    {loading && <tr><td colSpan={12} className="s3-empty">Loading…</td></tr>}
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
                          <td><span className="s3-dash">—</span></td>
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
          </>
        )}

        {/* ─── SOURCING NOT REQUIRED TAB ─── */}
        {tab === 'not_required' && (
          <div className="s3-card s3-card-mint">
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
                    <th style={{ width: 120 }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="s3-empty">Loading…</td></tr>}
                  {!loading && notRequiredRows.length === 0 && (
                    <tr><td colSpan={8} className="s3-empty">No products marked Not Required.</td></tr>
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

      {/* Footer */}
      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ <strong>Note :</strong> Add product details and shortlist vendors to proceed.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev} type="button">← Previous</button>
          <button
            className="smd-stg-btn smd-stg-btn-primary"
            onClick={() => void onSaveAndNext()}
            disabled={advancing}
            type="button"
          >
            {advancing ? 'Advancing…' : 'Save & Next →'}
          </button>
        </div>
      </div>

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
    </>
  );
}

const STAGE3_CSS = `
/* ═══════════════════════════════ TABS ═══════════════════════════════ */
.s3-tabs { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.s3-tab {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 9px 18px; border-radius: 999px;
  border: 1.5px solid; background: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.s3-tab-ico { display: inline-flex; align-items: center; justify-content: center; }
.s3-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; font-weight: 800;
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

.s3-legend { display: flex; gap: 14px; }
.s3-legend-dot { font-size: 10.5px; font-weight: 700; }
.s3-dot-active   { color: #10b981; }
.s3-dot-inactive { color: #ef4444; }

/* ═══════════════════════════════ TABLE ═══════════════════════════════ */
.s3-table-wrap { overflow-x: auto; background: #fff; }
.s3-table { width: 100%; border-collapse: collapse; min-width: 880px; }
.s3-table thead th {
  padding: 11px 14px; text-align: left;
  font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #fff;
  background: linear-gradient(180deg, #1e1b4b, #312e81);
  white-space: nowrap;
}
.s3-table-amber thead th {
  background: linear-gradient(180deg, #fefce8, #fef9c3);
  color: #78350f;
  border-bottom: 1.5px solid #fde68a;
}
.s3-table tbody tr { transition: background .12s; }
.s3-table tbody tr:hover { background: #faf5ff; }
.s3-table-amber tbody tr:hover { background: #fffbeb; }
.s3-table tbody td {
  padding: 12px 14px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
}
.s3-empty { text-align: center; padding: 26px 14px; color: #94a3b8; font-style: italic; }

.s3-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 8px;
  font-size: 11.5px; font-weight: 800;
}
.s3-sr-violet { background: #ede9fe; color: #6d28d9; }
.s3-sr-amber  { background: #fef3c7; color: #b45309; }
.s3-sr-mint   { background: #d1fae5; color: #047857; }

.s3-code {
  display: inline-block;
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: 8px; border: 1.5px solid;
}
.s3-code-violet { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
.s3-code-amber  { background: #fef3c7; color: #b45309; border-color: #fde68a; }
.s3-code-mint   { background: #d1fae5; color: #047857; border-color: #a7f3d0; }

.s3-prod-name { font-weight: 700; color: #1e293b; font-size: 12.5px; }

.s3-pill {
  display: inline-block;
  padding: 4px 11px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800;
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
[data-bs-theme="dark"] .s3-table-amber thead th { background: rgba(252,191,36,.15); color: #fde68a; border-bottom-color: rgba(252,191,36,.30); }
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
`;
