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
 *   Ported from New_IDIMS_6.0's Stage3ProductSourcing.tsx + the matching
 *   /api/product-directory / sourcing-status / mark-as-done endpoints,
 *   scaled down to CBC's lead_products table (one combined row, no
 *   separate procurement-orders module).
 *
 *   Three sub-tabs partition the mapped products by sourcing_status:
 *     · Product Details      — rows where sourcing_status is NULL
 *     · Sourcing Required    — sourcing_status = 'required'
 *     · Sourcing Not Required — sourcing_status = 'not_required'
 *
 *   Per-row actions:
 *     · Product Details:   pick Required / Not Required via dropdown.
 *                          Inactive / draft products are constrained to
 *                          Required only (server returns 422 otherwise).
 *     · Sourcing Required: hit "Mark Sourced" once procurement is
 *                          complete. Equivalent to IDIMS's "Mark as Done"
 *                          on product_directories.
 *
 *   Save & Next gates (mirrors IDIMS validateForNextStage):
 *     1. At least one product mapped to the lead.
 *     2. Every row has a sourcing_status (no NULLs).
 *     3. Every product master is `active` (inactive/draft must be cleared
 *        on the Product Master first — same as IDIMS).
 *     4. Every Sourcing Required row has procurement_done = true.
 *   When all four pass, we PUT lead_stage_id = 4 and navigate forward.
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
  // Sourcing Required tab: rows the user has ticked for the next
  // Create Procurement batch. Only rows without an existing procurement
  // can be selected — the others render a Mark Sourced button instead.
  const [selectedIds, setSelectedIds]       = useState<Set<number>>(new Set());
  const [procModalOpen, setProcModalOpen]   = useState(false);
  // Detail viewer for the PROC-### pill (Required tab).
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

  /* ── Bucketed views — drive both the tab counts and the table body. */
  const detailsRows      = useMemo(() => rows.filter(r => r.sourcing_status === null),         [rows]);
  const requiredRows     = useMemo(() => rows.filter(r => r.sourcing_status === 'required'),    [rows]);
  const notRequiredRows  = useMemo(() => rows.filter(r => r.sourcing_status === 'not_required'),[rows]);
  const inactiveRows     = useMemo(
    () => rows.filter(r => (r.product_status ?? '').toLowerCase() !== 'active'),
    [rows],
  );
  // Required rows that don't yet have a procurement — these are the ones
  // selectable for the next Create Procurement batch.
  const procurableRows = useMemo(
    () => requiredRows.filter(r => r.procurement_id == null),
    [requiredRows],
  );

  const visibleRows = tab === 'details' ? detailsRows : tab === 'required' ? requiredRows : notRequiredRows;

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
      toast.success('Updated', `Marked "${row.product_name ?? 'product'}" as ${status === 'required' ? 'Sourcing Required' : 'Not Required'}`);
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not update sourcing status');
    } finally {
      setUpdatingId(null);
    }
  };

  /* ── Selection helpers for the Required tab ─────────────────────── */
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allProcurableSelected = procurableRows.length > 0 && procurableRows.every(r => selectedIds.has(r.id));
  const toggleSelectAll = () => {
    setSelectedIds(allProcurableSelected ? new Set() : new Set(procurableRows.map(r => r.id)));
  };

  const selectedProducts: SelectedProduct[] = useMemo(
    () => procurableRows
      .filter(r => selectedIds.has(r.id))
      .map(r => ({
        id:                   r.id,
        product_id:           r.product_id,
        product_code:         r.product_code,
        product_name:         r.product_name,
        status:               r.product_status,
        default_qty:          r.quantity,
        default_target_price: r.target_price,
        currency:             r.currency,
      })),
    [procurableRows, selectedIds],
  );

  const onCreateProcurementClick = () => {
    if (selectedProducts.length === 0) {
      toast.warning('No rows selected', 'Tick at least one Sourcing Required row first');
      return;
    }
    setProcModalOpen(true);
  };

  const onProcurementCreated = () => {
    setSelectedIds(new Set());
    void fetchRows();
  };

  /* ── Mark Sourced (IDIMS "Mark as Done") ─────────────────────────── */
  const onMarkSourced = async (row: Row) => {
    if (!leadId) return;
    setMarkingId(row.id);
    try {
      await api.patch(`/sales/leads/${leadId}/products/${row.id}/mark-sourced`);
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, procurement_done: true } : r));
      toast.success('Sourced', `"${row.product_name ?? 'Product'}" marked sourced`);
    } catch (e: any) {
      toast.error('Mark failed', e?.response?.data?.message ?? 'Could not mark as sourced');
    } finally {
      setMarkingId(null);
    }
  };

  /* ── Save & Next — validateForNextStage equivalent + lead_stage_id PUT. */
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
      toast.warning(
        'Sourcing status pending',
        `${detailsRows.length} product(s) still need a sourcing status — set Required or Not Required to continue`,
      );
      setTab('details');
      return;
    }
    if (inactiveRows.length > 0) {
      toast.warning(
        'Inactive products',
        `${inactiveRows.length} product(s) are inactive or draft. Activate them on the Product Master before advancing.`,
      );
      return;
    }
    const unsourced = requiredRows.filter(r => !r.procurement_done);
    if (unsourced.length > 0) {
      toast.warning(
        'Procurement incomplete',
        `${unsourced.length} Sourcing Required product(s) still need to be marked sourced`,
      );
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
            <div className="smd-stg-head-sub">● Product and supplier sourcing in progress</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Inactive warning banner — surfaces even when the user is on another tab */}
        {inactiveRows.length > 0 && (
          <div className="smd-st3-warn">
            <span className="smd-st3-warn-icon">⚠</span>
            <div>
              <strong>{inactiveRows.length} product{inactiveRows.length === 1 ? '' : 's'} not active.</strong>{' '}
              Activate them on the Product Master before this opportunity can advance to Stage 4.
              <div className="smd-st3-warn-list">{inactiveRows.map(r => r.product_name).filter(Boolean).join(', ')}</div>
            </div>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="smd-st3-tabs">
          <button
            className={`smd-st3-tab smd-st3-tab-detail ${tab === 'details' ? 'active' : ''}`}
            onClick={() => setTab('details')}
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
            </svg>
            Product Details
            <span className="smd-st3-tab-count">{detailsRows.length}</span>
          </button>
          <button
            className={`smd-st3-tab smd-st3-tab-req ${tab === 'required' ? 'active' : ''}`}
            onClick={() => setTab('required')}
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            Sourcing Required
            <span className="smd-st3-tab-count">{requiredRows.length}</span>
          </button>
          <button
            className={`smd-st3-tab smd-st3-tab-not ${tab === 'not_required' ? 'active' : ''}`}
            onClick={() => setTab('not_required')}
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Sourcing Not Required
            <span className="smd-st3-tab-count">{notRequiredRows.length}</span>
          </button>
        </div>

        {/* Table card */}
        <div className="smd-st3-table-card">
          <div className="smd-st3-table-head">
            <div className="smd-st3-table-head-left">
              <div className="smd-st3-table-head-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
              </div>
              <div>
                <div className="smd-st3-table-head-title">
                  {tab === 'details' && <>Pending Sourcing Status <span className="smd-st3-head-pill">{detailsRows.length}</span></>}
                  {tab === 'required' && <>Sourcing Required <span className="smd-st3-head-pill">{requiredRows.length}</span></>}
                  {tab === 'not_required' && <>Sourcing Not Required <span className="smd-st3-head-pill">{notRequiredRows.length}</span></>}
                </div>
                <div className="smd-st3-table-head-sub">
                  {tab === 'details'      && 'Pick a sourcing path for each row to proceed'}
                  {tab === 'required'     && 'Mark each row sourced once procurement is complete'}
                  {tab === 'not_required' && 'Read-only — these products skip procurement'}
                </div>
              </div>
            </div>
            <div className="smd-st3-legend">
              {tab === 'required' && procurableRows.length > 0 && (
                <button
                  type="button"
                  className="smd-st3-create-proc-btn"
                  onClick={onCreateProcurementClick}
                  disabled={selectedIds.size === 0}
                >
                  + Create Procurement {selectedIds.size > 0 && <span className="smd-st3-create-count">{selectedIds.size}</span>}
                </button>
              )}
              <span className="smd-st3-legend-item smd-st3-legend-active">● Active: either path</span>
              <span className="smd-st3-legend-item smd-st3-legend-inactive">● Inactive: Required only</span>
            </div>
          </div>

          <div className="smd-st3-table-wrap">
            <table className="smd-st3-table">
              <thead>
                <tr>
                  {tab === 'required' && (
                    <th style={{ width: 32 }}>
                      {procurableRows.length > 0 && (
                        <input
                          type="checkbox"
                          className="smd-st3-cb"
                          checked={allProcurableSelected}
                          onChange={toggleSelectAll}
                          aria-label="Select all procurable rows"
                        />
                      )}
                    </th>
                  )}
                  <th>SR</th>
                  <th>CODE</th>
                  <th>PRODUCT NAME</th>
                  <th>STATUS</th>
                  <th>QTY</th>
                  <th>TARGET PRICE</th>
                  <th>CURRENCY</th>
                  {tab === 'required' && (
                    <th style={{ width: 100 }}>PROCUREMENT</th>
                  )}
                  <th>{tab === 'details' ? 'SOURCING STATUS' : tab === 'required' ? 'ACTION' : 'STATUS'}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={tab === 'required' ? 10 : 8} className="smd-st3-empty">Loading…</td></tr>
                )}
                {!loading && visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={tab === 'required' ? 10 : 8} className="smd-st3-empty">
                      {tab === 'details'
                        ? rows.length === 0
                          ? 'No products mapped yet — open Product Directory from the toolbar to map one.'
                          : 'All mapped products have a sourcing status set.'
                        : tab === 'required'
                          ? 'No products marked Sourcing Required.'
                          : 'No products marked Not Required.'}
                    </td>
                  </tr>
                )}
                {!loading && visibleRows.map((r, idx) => {
                  const statusLc = (r.product_status ?? '').toLowerCase();
                  const isInactive = statusLc !== 'active';
                  return (
                    <tr key={r.id}>
                      {tab === 'required' && (
                        <td>
                          {r.procurement_id == null ? (
                            <input
                              type="checkbox"
                              className="smd-st3-cb"
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
                              aria-label={`Select ${r.product_name ?? 'product'} for procurement`}
                            />
                          ) : null}
                        </td>
                      )}
                      <td><span className="smd-st3-num">{idx + 1}</span></td>
                      <td><span className="smd-st3-code">{r.product_code ?? `P-${String(r.product_id).padStart(3, '0')}`}</span></td>
                      <td>
                        <div className="smd-st3-prod">
                          <div className="smd-st3-prod-name">{r.product_name ?? '—'}</div>
                        </div>
                      </td>
                      <td>
                        <span className={`smd-st3-status ${statusLc === 'active' ? 'smd-st3-status-active' : statusLc === 'draft' ? 'smd-st3-status-draft' : 'smd-st3-status-inactive'}`}>
                          ● {statusLc ? statusLc.charAt(0).toUpperCase() + statusLc.slice(1) : '—'}
                        </span>
                      </td>
                      <td>{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                      <td>{r.target_price != null ? Number(r.target_price).toLocaleString() : '—'}</td>
                      <td><span className="smd-st3-currency">{r.currency}</span></td>
                      {tab === 'required' && (
                        <td>
                          {r.procurement_id != null ? (
                            <button
                              type="button"
                              className="smd-st3-proc-pill"
                              title="View procurement details"
                              onClick={() => setProcViewId(r.procurement_id)}
                            >
                              PROC-{String(r.procurement_id).padStart(3, '0')}
                            </button>
                          ) : (
                            <span className="smd-st3-proc-empty">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        {tab === 'details' && (
                          updatingId === r.id ? (
                            <span className="smd-st3-spin">Saving…</span>
                          ) : (
                            <div style={{ minWidth: 160 }}>
                              <MasterSelect
                                value={r.sourcing_status ?? ''}
                                onChange={(v) => {
                                  if (v === 'required' || v === 'not_required') {
                                    void onSourcingChange(r, v);
                                  }
                                }}
                                options={
                                  isInactive
                                    ? SOURCING_OPTIONS.filter(o => o.value === 'required')
                                    : SOURCING_OPTIONS
                                }
                                placeholder="— Select —"
                              />
                            </div>
                          )
                        )}
                        {tab === 'required' && (
                          r.procurement_done ? (
                            <span className="smd-st3-sourced">✓ Sourced</span>
                          ) : r.procurement_id != null ? (
                            <button
                              type="button"
                              className="smd-st3-mark-btn"
                              onClick={() => void onMarkSourced(r)}
                              disabled={markingId === r.id}
                            >
                              {markingId === r.id ? 'Marking…' : 'Mark Sourced'}
                            </button>
                          ) : (
                            <label className="smd-st3-cb-wrap" title="Select for next procurement">
                              <input
                                type="checkbox"
                                className="smd-st3-cb"
                                checked={selectedIds.has(r.id)}
                                onChange={() => toggleSelect(r.id)}
                              />
                              <span>Select</span>
                            </label>
                          )
                        )}
                        {tab === 'not_required' && (
                          <span className="smd-st3-skip">Skipped</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ All mapped products must have a sourcing status and any Required ones must be Sourced before advancing.
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
        }}
        selectedProducts={selectedProducts}
        onClose={() => setProcModalOpen(false)}
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
.smd-st3-warn {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 9px 12px; margin-bottom: 12px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 1px solid #fbbf24; border-radius: 10px;
  color: #78350f; font-size: 11.5px; line-height: 1.4;
}
.smd-st3-warn-icon { font-size: 14px; line-height: 1; padding-top: 1px; }
.smd-st3-warn-list { margin-top: 3px; font-size: 10.5px; color: #92400e; font-style: italic; }

.smd-st3-tabs { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.smd-st3-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border-radius: 10px;
  background: #fff; border: 1px solid; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  font-family: inherit;
}
.smd-st3-tab-detail { color: #6d28d9; border-color: #c4b5fd; }
.smd-st3-tab-detail.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.smd-st3-tab-req    { color: #d97706; border-color: #fde68a; }
.smd-st3-tab-req.active { background: #fffbeb; }
.smd-st3-tab-not    { color: #047857; border-color: #a7f3d0; }
.smd-st3-tab-not.active { background: #ecfdf5; }
.smd-st3-tab-count {
  background: rgba(255,255,255,.3); color: inherit;
  font-size: 10.5px; font-weight: 800; padding: 1px 7px; border-radius: 20px;
}
.smd-st3-tab:not(.active) .smd-st3-tab-count { background: #f5f3ff; color: #6d28d9; }

.smd-st3-table-card {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: hidden;
}
.smd-st3-table-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #faf5ff; border-bottom: 1px solid #e9d5ff; flex-wrap: wrap; }
.smd-st3-table-head-left { display: flex; align-items: center; gap: 9px; }
.smd-st3-table-head-icon { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg,#7c3aed,#6d28d9); display: flex; align-items: center; justify-content: center; }
.smd-st3-table-head-title { font-size: 13px; font-weight: 700; color: #4c1d95; display: flex; align-items: center; gap: 7px; }
.smd-st3-head-pill { background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 800; padding: 1px 8px; border-radius: 20px; }
.smd-st3-table-head-sub { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
.smd-st3-legend { display: flex; gap: 8px; font-size: 10.5px; font-weight: 600; }
.smd-st3-legend-active   { color: #10b981; }
.smd-st3-legend-inactive { color: #ef4444; }

.smd-st3-table-wrap { overflow-x: auto; }
.smd-st3-table { width: 100%; border-collapse: collapse; min-width: 760px; }
.smd-st3-table thead th {
  padding: 9px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280;
  background: #faf5ff; border-bottom: 1px solid #e9d5ff;
}
.smd-st3-table tbody td {
  padding: 10px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
}
.smd-st3-empty {
  text-align: center; padding: 22px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}
.smd-st3-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #f5f3ff; color: #6d28d9; font-size: 11px; font-weight: 800;
}
.smd-st3-code {
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 700;
  background: #faf5ff; color: #6d28d9; padding: 3px 8px; border-radius: 7px; border: 1px solid #e9d5ff;
}
.smd-st3-prod-name { font-weight: 700; color: #1e293b; }
.smd-st3-status { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
.smd-st3-status-active   { background: #d1fae5; color: #047857; }
.smd-st3-status-inactive { background: #fee2e2; color: #dc2626; }
.smd-st3-status-draft    { background: #fef3c7; color: #b45309; }
.smd-st3-currency {
  font-size: 11px; font-weight: 700;
  background: #faf5ff; color: #6d28d9; padding: 2px 8px; border-radius: 7px;
}
.smd-st3-spin {
  display: inline-block; font-size: 11px; color: #6d28d9; font-style: italic;
}
.smd-st3-mark-btn {
  padding: 5px 11px; border-radius: 7px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff; border: none;
  font-size: 11px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  box-shadow: 0 2px 6px rgba(16,185,129,.30);
  transition: all .15s;
}
.smd-st3-mark-btn:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
.smd-st3-mark-btn:disabled { opacity: .6; cursor: not-allowed; }
.smd-st3-sourced {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  background: #d1fae5; color: #047857;
  font-size: 11px; font-weight: 800;
}
.smd-st3-skip {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  background: #e0f2fe; color: #0369a1;
  font-size: 11px; font-weight: 700;
}
.smd-st3-proc-pill {
  display: inline-block; padding: 3px 9px; border-radius: 20px;
  background: linear-gradient(135deg, #ddd6fe, #c4b5fd);
  color: #4c1d95; border: 1px solid #a78bfa;
  font-family: 'Inter', monospace; font-size: 10.5px; font-weight: 800;
  letter-spacing: .02em;
}
.smd-st3-proc-empty { color: #cbd5e1; font-weight: 700; }
.smd-st3-cb {
  width: 14px; height: 14px; cursor: pointer; accent-color: #7c3aed;
  margin: 0;
}
.smd-st3-cb-wrap {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 10.5px; font-weight: 700; color: #6d28d9;
}
.smd-st3-create-proc-btn {
  padding: 6px 13px; border-radius: 8px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff; border: none; cursor: pointer;
  font-family: inherit; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; gap: 6px;
  box-shadow: 0 2px 6px rgba(16,185,129,.30);
  transition: all .15s;
}
.smd-st3-create-proc-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669, #047857);
  transform: translateY(-1px);
}
.smd-st3-create-proc-btn:disabled { opacity: .55; cursor: not-allowed; filter: grayscale(.3); }
.smd-st3-create-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: rgba(255,255,255,.28); color: #fff;
  font-size: 10px; font-weight: 800;
}

/* Dark mode */
[data-bs-theme="dark"] .smd-st3-warn,
[data-layout-mode="dark"] .smd-st3-warn {
  background: linear-gradient(135deg, rgba(245,158,11,.12), rgba(245,158,11,.18));
  border-color: rgba(245,158,11,.40); color: #fbbf24;
}
[data-bs-theme="dark"] .smd-st3-warn-list,
[data-layout-mode="dark"] .smd-st3-warn-list { color: #fde68a; }
[data-bs-theme="dark"] .smd-st3-table-card,
[data-layout-mode="dark"] .smd-st3-table-card {
  background: #14102a; border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .smd-st3-table-head,
[data-layout-mode="dark"] .smd-st3-table-head {
  background: #1a1538; border-bottom-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .smd-st3-table-head-title,
[data-layout-mode="dark"] .smd-st3-table-head-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-st3-table-head-sub,
[data-layout-mode="dark"] .smd-st3-table-head-sub { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .smd-st3-table thead th,
[data-layout-mode="dark"] .smd-st3-table thead th {
  background: #1a1538; color: #c4b5fd; border-bottom-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .smd-st3-table tbody td,
[data-layout-mode="dark"] .smd-st3-table tbody td {
  color: #ede9fe; border-bottom-color: rgba(167, 139, 250, .18);
}
[data-bs-theme="dark"] .smd-st3-prod-name,
[data-layout-mode="dark"] .smd-st3-prod-name { color: #ede9fe; }
[data-bs-theme="dark"] .smd-st3-empty,
[data-layout-mode="dark"] .smd-st3-empty { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .smd-st3-num,
[data-layout-mode="dark"] .smd-st3-num {
  background: rgba(124, 58, 237, .22); color: #c4b5fd;
}
[data-bs-theme="dark"] .smd-st3-code,
[data-layout-mode="dark"] .smd-st3-code {
  background: rgba(124, 58, 237, .18); color: #c4b5fd; border-color: rgba(167, 139, 250, .35);
}
[data-bs-theme="dark"] .smd-st3-currency,
[data-layout-mode="dark"] .smd-st3-currency {
  background: rgba(124, 58, 237, .18); color: #c4b5fd;
}
[data-bs-theme="dark"] .smd-st3-tab,
[data-layout-mode="dark"] .smd-st3-tab {
  background: #1f1845;
}
[data-bs-theme="dark"] .smd-st3-tab-detail,
[data-layout-mode="dark"] .smd-st3-tab-detail { color: #c4b5fd; border-color: rgba(167, 139, 250, .35); }
[data-bs-theme="dark"] .smd-st3-tab-detail.active,
[data-layout-mode="dark"] .smd-st3-tab-detail.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
[data-bs-theme="dark"] .smd-st3-tab-req,
[data-layout-mode="dark"] .smd-st3-tab-req { color: #fbbf24; border-color: rgba(245,158,11,.35); }
[data-bs-theme="dark"] .smd-st3-tab-req.active,
[data-layout-mode="dark"] .smd-st3-tab-req.active { background: rgba(245,158,11,.18); }
[data-bs-theme="dark"] .smd-st3-tab-not,
[data-layout-mode="dark"] .smd-st3-tab-not { color: #6ee7b7; border-color: rgba(16,185,129,.35); }
[data-bs-theme="dark"] .smd-st3-tab-not.active,
[data-layout-mode="dark"] .smd-st3-tab-not.active { background: rgba(16,185,129,.18); }
[data-bs-theme="dark"] .smd-st3-tab:not(.active) .smd-st3-tab-count,
[data-layout-mode="dark"] .smd-st3-tab:not(.active) .smd-st3-tab-count {
  background: rgba(124, 58, 237, .22); color: #c4b5fd;
}
[data-bs-theme="dark"] .smd-st3-head-pill,
[data-layout-mode="dark"] .smd-st3-head-pill {
  background: rgba(245,158,11,.18); color: #fbbf24;
}
[data-bs-theme="dark"] .smd-st3-status-active,
[data-layout-mode="dark"] .smd-st3-status-active {
  background: rgba(16,185,129,.18); color: #6ee7b7;
}
[data-bs-theme="dark"] .smd-st3-status-inactive,
[data-layout-mode="dark"] .smd-st3-status-inactive {
  background: rgba(239,68,68,.18); color: #fca5a5;
}
[data-bs-theme="dark"] .smd-st3-status-draft,
[data-layout-mode="dark"] .smd-st3-status-draft {
  background: rgba(245,158,11,.18); color: #fde68a;
}
[data-bs-theme="dark"] .smd-st3-sourced,
[data-layout-mode="dark"] .smd-st3-sourced {
  background: rgba(16,185,129,.18); color: #6ee7b7;
}
[data-bs-theme="dark"] .smd-st3-skip,
[data-layout-mode="dark"] .smd-st3-skip {
  background: rgba(14,165,233,.18); color: #7dd3fc;
}
[data-bs-theme="dark"] .smd-st3-proc-pill,
[data-layout-mode="dark"] .smd-st3-proc-pill {
  background: rgba(124, 58, 237, .25); color: #c4b5fd; border-color: rgba(167, 139, 250, .50);
}
[data-bs-theme="dark"] .smd-st3-proc-empty,
[data-layout-mode="dark"] .smd-st3-proc-empty { color: rgba(167, 139, 250, .35); }
[data-bs-theme="dark"] .smd-st3-cb-wrap,
[data-layout-mode="dark"] .smd-st3-cb-wrap { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-st3-cb,
[data-layout-mode="dark"] .smd-st3-cb { accent-color: #a78bfa; }
`;
